import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runBuyerAgent } from "./agent/buyer.ts";
import { connectAgent } from "./agent/signed-client.ts";
import { DEFAULT_POLICY, DeclaredSchema, PolicySchema } from "./claims/schema.ts";
import { ingestVideo } from "./extract/ingest.ts";
import { MuseProposer, SamSegmenter } from "./extract/muse.ts";
import { MuseAnswerModel } from "./gateway/answer-model.ts";
import { AuditLog, verifyChain } from "./gateway/audit.ts";
import { GatewayCore, type VisitRecord } from "./gateway/core.ts";
import { type AgentRecord, AgentRegistry } from "./gateway/identity.ts";
import { OfflineAnswerModel } from "./gateway/offline-model.ts";
import { startGateway } from "./gateway/server.ts";
import { MetaClient } from "./meta/client.ts";
import { renderReport } from "./report.ts";
import { SpendGuard } from "./spend.ts";
import { Store } from "./store.ts";
import { applyClaimEdit, evalCases, styleGuide, styleNotes } from "./taste/edits.ts";

function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2]?.replace(/^["']|["']$/g, "") ?? "";
  }
}

function client(guard: SpendGuard): MetaClient {
  const apiKey = process.env.MODEL_API_KEY ?? "";
  if (!apiKey)
    throw new Error(
      "MODEL_API_KEY is not set (put it in .env). Use --offline to run without the API.",
    );
  return new MetaClient({ apiKey, guard });
}

const USAGE = `aval <command>

  ingest <video> --id <id> --declared <file.json> [--policy <file.json>] [--broker <name>]
  report <id>                              evidence report (HTML) for a listing
  serve [--port 8787] [--offline]          MCP gateway for buyer agents
  agent-keygen <id> <name> <operator>      create a signing key and register the agent
  visits [approve|decline <visit-id>]      visit requests from agents (a human decides)
  edit <listing> <claim> "<new wording>"   broker correction (feeds the taste module)
  taste                                    what the corrections taught, and eval cases
  buyer "<goal>" [--as <agent-id>|--anonymous] [--url <mcp-url>]   a Muse Spark buyer agent using the gateway
  budget                                   spend so far against the ceiling
  audit-verify                             check the audit log's hash chain`;

async function main(): Promise<void> {
  loadDotEnv();
  const [cmd, ...rest] = process.argv.slice(2);
  const store = new Store();
  const guard = SpendGuard.fromEnv();
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      id: { type: "string" },
      declared: { type: "string" },
      policy: { type: "string" },
      broker: { type: "string", default: "broker-1" },
      port: { type: "string", default: "8787" },
      offline: { type: "boolean", default: false },
      as: { type: "string" },
      anonymous: { type: "boolean", default: false },
      url: { type: "string", default: "http://127.0.0.1:8787/mcp" },
    },
  });

  switch (cmd) {
    case "ingest": {
      const [video] = positionals;
      if (!video || !values.id || !values.declared)
        throw new Error("ingest needs <video> --id <id> --declared <file.json>");
      const declared = DeclaredSchema.parse(JSON.parse(readFileSync(values.declared, "utf8")));
      const policy = values.policy
        ? PolicySchema.parse(JSON.parse(readFileSync(values.policy, "utf8")))
        : DEFAULT_POLICY;
      const c = client(guard);
      const segmenter = new SamSegmenter(c);
      try {
        const r = await ingestVideo({
          id: values.id,
          video,
          declared,
          policy,
          brokerId: values.broker,
          store,
          proposer: new MuseProposer(c),
          segmenter,
          styleNotes: styleNotes(styleGuide(store)),
          log: (m) => console.log(m),
        });
        console.log(`\n${r.listing.claims.length} claims:`, r.counts);
        console.log(`spent so far: $${guard.spentUsd.toFixed(4)} of $${guard.budgetUsd}`);
        console.log(`next: node src/cli.ts report ${values.id}`);
      } finally {
        await segmenter.close();
      }
      return;
    }
    case "report": {
      const [id] = positionals;
      const listing = id ? store.loadListing(id) : null;
      if (!id || !listing) throw new Error("report needs an existing listing id");
      const out = join(store.listingDir(id), "report.html");
      writeFileSync(out, renderReport(listing));
      console.log(out);
      return;
    }
    case "serve": {
      const audit = new AuditLog(join(store.root, "audit.jsonl"));
      const model = values.offline ? new OfflineAnswerModel() : new MuseAnswerModel(client(guard));
      const registry = AgentRegistry.fromFile(join(store.root, "agents.json"));
      const core = new GatewayCore({ store, model, audit });
      const port = Number(values.port);
      await startGateway(core, registry, port);
      console.log(
        `Aval gateway on http://127.0.0.1:${port}/mcp (${values.offline ? "offline model, no spend" : "Muse Spark"})`,
      );
      return;
    }
    case "agent-keygen": {
      const [id, name, operator] = positionals;
      if (!id || !name || !operator) throw new Error("agent-keygen needs <id> <name> <operator>");
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      mkdirSync(join(store.root, "keys"), { recursive: true });
      writeFileSync(
        join(store.root, "keys", `${id}.pem`),
        privateKey.export({ type: "pkcs8", format: "pem" }),
        { mode: 0o600 },
      );
      const path = join(store.root, "agents.json");
      const agents: AgentRecord[] = existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf8")) as AgentRecord[])
        : [];
      agents.push({
        id,
        name,
        operator,
        publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      });
      writeFileSync(path, `${JSON.stringify(agents, null, 2)}\n`);
      console.log(`registered ${id}; private key in .aval/keys/${id}.pem (never commit it)`);
      return;
    }
    case "visits": {
      const [action, id] = positionals;
      const all = store.readJsonl<VisitRecord>("visits.jsonl");
      if (action === "approve" || action === "decline") {
        const v = all.find((x) => x.id === id);
        if (!v) throw new Error("no such visit");
        store.appendJsonl("visits.jsonl", {
          ...v,
          status: action === "approve" ? "approved" : "declined",
          at: new Date().toISOString(),
        });
        console.log(`${action}d ${id}`);
        return;
      }
      const latest = new Map(all.map((v) => [v.id, v]));
      for (const v of latest.values())
        console.log(
          `${v.id}  ${v.status.padEnd(8)}  ${v.listing_id}  ${v.slot}  agent=${v.agent}  ${v.note}`,
        );
      return;
    }
    case "edit": {
      const [listing, claim, ...text] = positionals;
      if (!listing || !claim || text.length === 0)
        throw new Error('edit needs <listing> <claim> "<new wording>"');
      const e = applyClaimEdit(store, listing, claim, text.join(" "));
      console.log(`"${e.before}" -> "${e.after}"`);
      return;
    }
    case "taste": {
      const g = styleGuide(store);
      console.log(JSON.stringify(g, null, 2));
      console.log(`eval cases: ${evalCases(store).length}`);
      return;
    }
    case "buyer": {
      const goal = positionals.join(" ");
      if (!goal)
        throw new Error(
          'buyer needs a goal, e.g. buyer "Find a 2-bedroom in Nunoa that allows pets"',
        );
      const identity =
        values.anonymous || !values.as
          ? undefined
          : {
              agentId: values.as,
              privateKeyPem: readFileSync(join(store.root, "keys", `${values.as}.pem`), "utf8"),
            };
      const mcp = await connectAgent(values.url, identity);
      try {
        const r = await runBuyerAgent({
          llm: client(guard),
          mcp,
          goal,
          log: (l) => console.log(l),
        });
        console.log(
          `\n${r.finalText}\n\n(agent cost $${r.costUsd.toFixed(4)}; spent so far $${guard.spentUsd.toFixed(4)} of $${guard.budgetUsd})`,
        );
      } finally {
        await mcp.close();
      }
      return;
    }
    case "budget":
      console.log(
        `spent $${guard.spentUsd.toFixed(4)} of $${guard.budgetUsd} ($${guard.remainingUsd.toFixed(4)} left)`,
      );
      return;
    case "audit-verify": {
      const v = verifyChain(join(store.root, "audit.jsonl"));
      console.log(
        v.ok ? `chain intact: ${v.entries} entries` : `CHAIN BROKEN at entry ${v.brokenAt}`,
      );
      process.exitCode = v.ok ? 0 : 1;
      return;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
