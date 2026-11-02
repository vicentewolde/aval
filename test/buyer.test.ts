import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBuyerAgent, type ToolLLM } from "../src/agent/buyer.ts";
import { connectAgent } from "../src/agent/signed-client.ts";
import { ListingSchema } from "../src/claims/schema.ts";
import { AuditLog } from "../src/gateway/audit.ts";
import { GatewayCore } from "../src/gateway/core.ts";
import { AgentRegistry } from "../src/gateway/identity.ts";
import { OfflineAnswerModel } from "../src/gateway/offline-model.ts";
import { startGateway } from "../src/gateway/server.ts";
import { MetaApiError } from "../src/meta/client.ts";
import { Store } from "../src/store.ts";

const listing = ListingSchema.parse(
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "fixtures", "demo-listing.json"), "utf8"),
  ),
);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

let url = "";
let close: () => void = () => {};
let storeDir = "";

beforeAll(async () => {
  storeDir = mkdtempSync(join(tmpdir(), "aval-buyer-"));
  const store = new Store(storeDir);
  store.saveListing(listing);
  const core = new GatewayCore({
    store,
    model: new OfflineAnswerModel(),
    audit: new AuditLog(join(storeDir, "audit.jsonl")),
  });
  const registry = new AgentRegistry([
    {
      id: "buyer-1",
      name: "Buyer",
      operator: "Example",
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    },
  ]);
  const http = await startGateway(core, registry, 0);
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  close = () => http.close();
});
afterAll(() => close());

/** A scripted stand-in for Muse Spark: deterministic tool calls, then a final message. */
function script(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
  final: string,
): ToolLLM {
  let i = 0;
  return {
    respondTools: async () => {
      const c = calls[i++];
      const usage = { input_tokens: 1, output_tokens: 1 };
      return c
        ? {
            id: `r${i}`,
            text: "",
            calls: [{ name: c.name, arguments: JSON.stringify(c.args), callId: `call-${i}` }],
            usage,
            costUsd: 0.001,
          }
        : { id: `r${i}`, text: final, calls: [], usage, costUsd: 0.001 };
    },
  };
}

describe("buyer agent over the real gateway (scripted model)", () => {
  it("discovers, reads verified facts, asks, and requests a visit as an identified agent", async () => {
    const mcp = await connectAgent(url, { agentId: "buyer-1", privateKeyPem: priv });
    const r = await runBuyerAgent({
      llm: script(
        [
          { name: "list_listings", args: {} },
          { name: "get_facts", args: { listing_id: "demo-1" } },
          {
            name: "ask_listing",
            args: { listing_id: "demo-1", question: "does it have a bathtub?" },
          },
          {
            name: "request_visit",
            args: { listing_id: "demo-1", slot: "2026-11-10 10:00", note: "interested" },
          },
        ],
        "Summary.",
      ),
      mcp,
      goal: "Find a flat",
    });
    expect(r.steps.map((s) => s.tool)).toEqual([
      "list_listings",
      "get_facts",
      "ask_listing",
      "request_visit",
    ]);
    expect(r.steps.every((s) => !s.isError)).toBe(true);
    expect(r.steps[1]?.result).not.toContain("irarrazaval");
    expect(r.steps[2]?.result.toLowerCase()).toContain("bathtub");
    expect(JSON.parse(r.steps[3]?.result ?? "{}").status).toBe("pending");
    expect(r.finalText).toBe("Summary.");
    await mcp.close();
  });

  it("an anonymous agent can read but is refused a visit, and the agent loop reports it", async () => {
    const mcp = await connectAgent(url);
    const r = await runBuyerAgent({
      llm: script(
        [
          { name: "get_facts", args: { listing_id: "demo-1" } },
          {
            name: "request_visit",
            args: { listing_id: "demo-1", slot: "2026-11-10 10:00", note: "" },
          },
        ],
        "done",
      ),
      mcp,
      goal: "x",
    });
    expect(r.steps[0]?.isError).toBe(false);
    expect(r.steps[1]?.isError).toBe(true);
    expect(r.steps[1]?.result).toContain("AGENT_NOT_IDENTIFIED");
    await mcp.close();
  });

  it("resumes from a recap when Meta loses the previous response, instead of dying mid-task", async () => {
    const mcp = await connectAgent(url);
    const seen: Array<{ previousResponseId?: string; recap: string }> = [];
    let i = 0;
    const usage = { input_tokens: 1, output_tokens: 1 };
    const llm: ToolLLM = {
      respondTools: async (o) => {
        i++;
        seen.push({
          ...(o.previousResponseId ? { previousResponseId: o.previousResponseId } : {}),
          recap: JSON.stringify(o.input),
        });
        if (i === 1)
          return {
            id: "r1",
            text: "",
            calls: [{ name: "get_facts", arguments: '{"listing_id":"demo-1"}', callId: "c1" }],
            usage,
            costUsd: 0,
          };
        if (i === 2)
          throw new MetaApiError(
            400,
            '{"error":{"message":"referenced response not found or expired"}}',
            false,
          );
        return { id: "r3", text: "Recovered and finished.", calls: [], usage, costUsd: 0 };
      },
    };
    const r = await runBuyerAgent({ llm, mcp, goal: "Find a flat", log: () => {} });
    expect(r.finalText).toBe("Recovered and finished.");
    expect(seen[1]?.previousResponseId).toBe("r1"); // tried the chain first
    expect(seen[2]?.previousResponseId).toBeUndefined(); // then started clean
    expect(seen[2]?.recap).toContain("get_facts"); // with a recap of the work done
    expect(seen[2]?.recap).toContain("Find a flat");
    await mcp.close();
  });

  it("does not hide other errors", async () => {
    const mcp = await connectAgent(url);
    const llm: ToolLLM = {
      respondTools: async () => {
        throw new MetaApiError(400, "something else", false);
      },
    };
    await expect(runBuyerAgent({ llm, mcp, goal: "x" })).rejects.toBeInstanceOf(MetaApiError);
    await mcp.close();
  });

  it("stops at the step limit instead of looping forever", async () => {
    const mcp = await connectAgent(url);
    const forever: ToolLLM = {
      respondTools: async () => ({
        id: "r",
        text: "",
        calls: [{ name: "list_listings", arguments: "{}", callId: "c" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        costUsd: 0,
      }),
    };
    const r = await runBuyerAgent({ llm: forever, mcp, goal: "x", maxSteps: 3 });
    expect(r.steps).toHaveLength(3);
    expect(r.finalText).toMatch(/step limit/);
    await mcp.close();
  });
});
