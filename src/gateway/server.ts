import { createServer, type IncomingMessage, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Issuer } from "../passport/passport.ts";
import type { Store } from "../store.ts";
import type { GatewayCore, Outcome } from "./core.ts";
import type { AgentRegistry } from "./identity.ts";
import { handlePublicRequest } from "./pages.ts";
import type { Caller } from "./policy.ts";
import { CriteriaSchema } from "./search.ts";

const MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function asText(o: Outcome<{ data: unknown }>) {
  const payload = o.ok ? o.data : { error: { code: o.code, message: o.message } };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: !o.ok,
  };
}

/**
 * One MCP server per request (stateless). The caller is identified from the signature headers; the
 * signature covers the raw body and the tool name, so a captured request cannot be replayed on
 * another tool or with other arguments.
 */
function buildMcp(
  core: GatewayCore,
  registry: AgentRegistry,
  headers: IncomingMessage["headers"],
  raw: string,
): McpServer {
  const server = new McpServer({ name: "aval-gateway", version: "0.1.0" });
  const who = (tool: string): Caller => {
    const id = registry.identify(headers, tool, raw);
    return id.tier === "verified"
      ? { agentId: id.agent.id, tier: "verified" }
      : { agentId: null, tier: "anonymous" };
  };
  const listingId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

  server.registerTool(
    "list_listings",
    {
      description:
        "List the listings available, with how many verified facts each has. Addresses are never included.",
    },
    async () => asText(await core.listListings(who("list_listings"))),
  );
  server.registerTool(
    "search_listings",
    {
      description:
        "Match a buyer's needs against all listings. Give structured criteria (operation, commune, min_bedrooms, min_bathrooms, min_area_m2, max_price, pets_required, must_have). Returns ranked matches, each criterion with the fact and source it rests on; 'unconfirmed' means there is no evidence either way. Listings that fail a hard criterion are excluded with the reason.",
      inputSchema: CriteriaSchema.shape,
    },
    async (criteria) => asText(await core.search(who("search_listings"), criteria)),
  );
  const negId = z.string().regex(/^neg-[0-9a-f]{8}$/);
  const rationale = z.string().max(240).default("");
  server.registerTool(
    "negotiation_start",
    {
      description:
        "Open (or resume) a price negotiation with the seller's agent on a listing. Requires an identified agent AND a mandate signed by your principal. Returns your own limits and the negotiation id. The seller's limits are never shown.",
      inputSchema: { listing_id: listingId },
    },
    async ({ listing_id }) =>
      asText(await core.negotiationStart(who("negotiation_start"), listing_id)),
  );
  server.registerTool(
    "negotiation_offer",
    {
      description:
        "Make an offer. Figures go in price and closing_days only: the rationale is free text for the other side but may contain NO digits and NO number words, or it is rejected. Offers above your mandate, offers that go backwards, and terms outside your mandate are refused by the engine. The seller's agent answers in the same call.",
      inputSchema: {
        negotiation_id: negId,
        price: z.number().positive().max(1_000_000_000),
        closing_days: z.number().int().min(0).max(365),
        conditions: z
          .array(
            z.enum([
              "subject_to_title_review",
              "subject_to_financing_approval",
              "furnishings_included",
            ]),
          )
          .max(3)
          .default([]),
        rationale,
      },
    },
    async ({ negotiation_id, price, closing_days, conditions, rationale }) =>
      asText(
        await core.negotiationAct(who("negotiation_offer"), "negotiation_offer", negotiation_id, {
          type: "offer",
          price,
          closing_days,
          conditions,
          rationale,
        }),
      ),
  );
  server.registerTool(
    "negotiation_accept",
    {
      description:
        "Accept the seller's current position, if it is within your mandate. Produces a preliminary, non-binding term sheet that both principals must approve.",
      inputSchema: { negotiation_id: negId, rationale },
    },
    async ({ negotiation_id, rationale }) =>
      asText(
        await core.negotiationAct(who("negotiation_accept"), "negotiation_accept", negotiation_id, {
          type: "accept",
          rationale,
        }),
      ),
  );
  server.registerTool(
    "negotiation_walk_away",
    {
      description: "End the negotiation without a deal.",
      inputSchema: { negotiation_id: negId, rationale },
    },
    async ({ negotiation_id, rationale }) =>
      asText(
        await core.negotiationAct(
          who("negotiation_walk_away"),
          "negotiation_walk_away",
          negotiation_id,
          { type: "walk_away", rationale },
        ),
      ),
  );
  server.registerTool(
    "negotiation_status",
    {
      description:
        "The state of a negotiation you opened: moves so far, whose turn it is, rounds left, the outcome.",
      inputSchema: { negotiation_id: negId },
    },
    async ({ negotiation_id }) =>
      asText(
        await core.negotiationAct(
          who("negotiation_status"),
          "negotiation_status",
          negotiation_id,
          null,
        ),
      ),
  );
  server.registerTool(
    "get_facts",
    {
      description:
        "All facts about a listing that are verified or declared by the broker, each with its provenance and evidence summary.",
      inputSchema: { listing_id: listingId },
    },
    async ({ listing_id }) => asText(await core.getFacts(who("get_facts"), listing_id)),
  );
  server.registerTool(
    "get_policy",
    {
      description:
        "The seller's rules for this listing: what is withheld, price visibility, whether visits are possible.",
      inputSchema: { listing_id: listingId },
    },
    async ({ listing_id }) => asText(await core.getPolicy(who("get_policy"), listing_id)),
  );
  server.registerTool(
    "ask_listing",
    {
      description:
        "Ask a question about a listing. Answers come only from verified facts and cite them; otherwise the gateway says it cannot confirm.",
      inputSchema: { listing_id: listingId, question: z.string().min(1).max(2000) },
    },
    async ({ listing_id, question }) =>
      asText(await core.ask(who("ask_listing"), listing_id, question)),
  );
  server.registerTool(
    "request_visit",
    {
      description:
        "Request a visit slot. Requires an identified (signed) agent and a human approval by the broker.",
      inputSchema: {
        listing_id: listingId,
        slot: z.string().max(40),
        note: z.string().max(300).default(""),
      },
    },
    async ({ listing_id, slot, note }) =>
      asText(await core.requestVisit(who("request_visit"), listing_id, slot, note)),
  );
  return server;
}

export function startGateway(
  core: GatewayCore,
  registry: AgentRegistry,
  port: number,
  host = "127.0.0.1",
  store?: Store,
  issuer?: Issuer,
): Promise<Server> {
  const http = createServer(async (req, res) => {
    if (store && handlePublicRequest(req, res, store, issuer)) return;
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    try {
      const raw = await readBody(req);
      const server = buildMcp(core, registry, req.headers, raw);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, JSON.parse(raw));
    } catch {
      if (!res.headersSent)
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "bad request" }));
    }
  });
  return new Promise((resolve) => http.listen(port, host, () => resolve(http)));
}
