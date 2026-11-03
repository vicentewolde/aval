import { generateKeyPairSync, generateKeyPairSync as genKeys } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { importAgentSalesRow } from "./adapters/agentsales.ts";
import { exportAgentSalesRow, toCsv } from "./adapters/agentsales-export.ts";
import { runBuyerAgent } from "./agent/buyer.ts";
import { connectAgent } from "./agent/signed-client.ts";
import { DEFAULT_POLICY, DeclaredSchema, PolicySchema } from "./claims/schema.ts";
import { declaredClaims } from "./claims/verify.ts";
import {
  buildCaption,
  type Caption,
  CaptionError,
  type Channel,
  verifyCaptionHash,
} from "./copy/caption.ts";
import { MuseCaptionModel, OfflineCaptionModel } from "./copy/caption-models.ts";
import { MuseDocReader } from "./diligence/reader.ts";
import {
  loadPublicReview,
  publicSummary,
  reviewAttachments,
  reviewTitle,
  type TitleReview,
  verifyReviewHash,
} from "./diligence/review.ts";
import { ingestVideo, ingestVoice } from "./extract/ingest.ts";
import { MuseProposer, SamSegmenter } from "./extract/muse.ts";
import { MuseVoiceProposer } from "./extract/voice.ts";
import { type AlertMatch, type AlertRecord, runAlerts } from "./gateway/alerts.ts";
import { MuseAnswerModel } from "./gateway/answer-model.ts";
import { AuditLog, verifyChain } from "./gateway/audit.ts";
import { GatewayCore, type VisitRecord } from "./gateway/core.ts";
import { type AgentRecord, AgentRegistry } from "./gateway/identity.ts";
import { MuseIntentParser, RuleIntentParser } from "./gateway/intent.ts";
import type { LeadRecord } from "./gateway/leads.ts";
import { OfflineAnswerModel } from "./gateway/offline-model.ts";
import { CriteriaSchema } from "./gateway/search.ts";
import { startGateway } from "./gateway/server.ts";
import { MuseTranslator } from "./gateway/translate.ts";
import { MetaClient } from "./meta/client.ts";
import {
  type BuyerMandate,
  CONDITIONS,
  newSalt,
  PrincipalRegistry,
  type SellerMandate,
  signMandate,
} from "./negotiation/mandate.ts";
import { MuseSeller, scriptedSeller } from "./negotiation/seller-agent.ts";
import { NegotiationService } from "./negotiation/service.ts";
import { approvalStatus, approveTermSheet } from "./negotiation/termsheet.ts";
import {
  type FactProof,
  issuePassport,
  type Passport,
  proveFact,
  verifyFactProof,
  verifyPassport,
} from "./passport/passport.ts";
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

/** After new supply arrives, see whether any saved search now has a match. Delivering the notice is not built. */
function reportAlerts(store: Store): void {
  const fresh = runAlerts(store);
  if (fresh.length > 0)
    console.log(`${fresh.length} saved search(es) now match a new home: node src/cli.ts alerts`);
}

const USAGE = `aval <command>

  ingest <video> --id <id> --declared <file.json> [--policy <file.json>] [--broker <name>]
  import-agentsales <export.json> [--row <id_propiedad> --video <mp4>]   bring in AgentSales rows (declared facts; add a video to verify them)
  search '<criteria json>' [--anonymous]    match a buyer's needs against all listings (no model, no spend)
  ask <id> "<question>"                    ask the gateway directly (real Muse Spark answering)
  voice <id> <audio>                       add what the broker said in a voice note (Muse Voice Transcribe)
  report <id>                              evidence report (HTML) for a listing
  serve [--port 8787] [--offline]          MCP gateway for buyer agents
  agent-keygen <id> <name> <operator>      create a signing key and register the agent
  visits [approve|decline <visit-id>]      visit requests from agents (a human decides)
  caption <id> [--channel instagram|portal] [--language es|en] [--base <url>] [--include-stated] [--offline]   copy that can only say what is proven, each sentence tied to its evidence
  export-agentsales <id…>|--all            the reverse of import-agentsales: a row in the AgentSales column format (verified-only amenities; --format csv|json, --out, --base <url>, --plain)
  alerts [run|delete <alert-id>]           saved buyer searches and the new homes that now match them (sending the notice is not built)
  leads [--id <listing>]|delete <lead-id>  buyers who asked to be contacted from the showroom, with how well the home fits what they searched
  edit <listing> <claim> "<new wording>"   broker correction (feeds the taste module)
  taste                                    what the corrections taught, and eval cases
  buyer "<goal>" [--as <agent-id>|--anonymous] [--url <mcp-url>]   a Muse Spark buyer agent using the gateway
  principal keygen <id> <name>             a human who signs mandates and approvals
  mandate seller|buyer <listing> --principal <id> ...   what a principal authorizes an agent to do (signed)
  negotiation list|show <id>|approve <id> --as <principal>   negotiations, term sheets, human approval
  passport init|issue <id>|verify <file>|prove <file> <fact>|verify-proof <file>   signed, offline-verifiable listing record
  diligence check <id> <pdfs…> [--seller-name "<name>" --seller-rut <rut>]   read the title documents, cross-check them (Muse Spark reads, rules decide)
  diligence show <id> [--public]           the stored review (--public: what agents see)
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
      principal: { type: "string" },
      agent: { type: "string" },
      asking: { type: "string" },
      floor: { type: "string" },
      target: { type: "string" },
      max: { type: "string" },
      rounds: { type: "string", default: "5" },
      days: { type: "string", default: "30-90" },
      conditions: { type: "string", default: "subject_to_title_review" },
      "valid-days": { type: "string", default: "30" },
      currency: { type: "string", default: "UF" },
      "seller-name": { type: "string" },
      "seller-rut": { type: "string" },
      public: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      format: { type: "string", default: "json" },
      out: { type: "string" },
      plain: { type: "boolean", default: false },
      base: { type: "string" },
      channel: { type: "string", default: "instagram" },
      language: { type: "string" },
      "include-stated": { type: "boolean", default: false },
      row: { type: "string" },
      video: { type: "string" },
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
        reportAlerts(store);
      } finally {
        await segmenter.close();
      }
      return;
    }
    case "import-agentsales": {
      const [file] = positionals;
      if (!file) throw new Error("import-agentsales needs <export.json>");
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(
        (r) => !values.row || (r as { id_propiedad?: string }).id_propiedad === values.row,
      );
      if (rows.length === 0) throw new Error("no matching rows");
      if (values.video && rows.length !== 1)
        throw new Error("--video needs exactly one row (use --row <id_propiedad>)");
      for (const raw of rows) {
        const at = new Date().toISOString();
        const imp = importAgentSalesRow(raw, { at });
        if (values.video) {
          const c = client(guard);
          const segmenter = new SamSegmenter(c);
          try {
            await ingestVideo({
              id: imp.id,
              video: values.video,
              declared: imp.declared,
              policy: imp.policy,
              brokerId: "agentsales",
              store,
              proposer: new MuseProposer(c),
              segmenter,
              styleNotes: styleNotes(styleGuide(store)),
              log: (m) => console.log(m),
            });
          } finally {
            await segmenter.close();
          }
          const l = store.loadListing(imp.id);
          if (l) {
            l.claims.push(...imp.extraClaims);
            store.saveListing(l);
          }
        } else {
          store.saveListing({
            id: imp.id,
            createdAt: at,
            declared: imp.declared,
            policy: imp.policy,
            claims: [...declaredClaims(imp.declared, "agentsales", at), ...imp.extraClaims],
          });
        }
        console.log(
          `${imp.id}: ${imp.declared.title}, ${imp.extraClaims.length + 7} declared facts${values.video ? " + video evidence" : " (declared only: add a video to verify)"}`,
        );
      }
      reportAlerts(store);
      return;
    }
    case "search": {
      const [raw] = positionals;
      if (!raw)
        throw new Error(
          'search needs criteria JSON, e.g. search \'{"min_bedrooms":2,"pets_required":true}\'',
        );
      let criteria: ReturnType<typeof CriteriaSchema.parse>;
      try {
        criteria = CriteriaSchema.parse(JSON.parse(raw));
      } catch (err) {
        const why =
          err instanceof SyntaxError
            ? "that is not valid JSON. Is there a space before --anonymous, and are the quotes balanced?"
            : "the criteria do not match the schema";
        throw new Error(
          `search: ${why} (${err instanceof Error ? err.message.split("\n")[0] : err})`,
        );
      }
      const audit = new AuditLog(join(store.root, "audit.jsonl"));
      const core = new GatewayCore({ store, model: new OfflineAnswerModel(), audit });
      const caller = values.anonymous
        ? { agentId: null, tier: "anonymous" as const }
        : { agentId: "cli", tier: "verified" as const };
      const r = await core.search(caller, criteria);
      if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
      for (const m of r.data.matches) {
        console.log(`\n${m.listing_id}  [${m.fit}]  score ${m.score}  ${m.title}`);
        for (const c of m.criteria)
          console.log(
            `   ${c.status.padEnd(11)} ${c.criterion}${c.basis ? `   <- ${c.basis.provenance}: ${c.basis.statement}` : ""}${c.note ? `   (${c.note})` : ""}`,
          );
      }
      for (const e of r.data.excluded) console.log(`\nexcluded ${e.listing_id}: ${e.reason}`);
      return;
    }
    case "ask": {
      const [id, ...q] = positionals;
      if (!id || q.length === 0) throw new Error('ask needs <listing-id> "<question>"');
      const audit = new AuditLog(join(store.root, "audit.jsonl"));
      const core = new GatewayCore({ store, model: new MuseAnswerModel(client(guard)), audit });
      const r = await core.ask({ agentId: "cli", tier: "verified" }, id, q.join(" "));
      console.log(JSON.stringify(r.ok ? r.data : r, null, 2));
      return;
    }
    case "voice": {
      const [id, audio] = positionals;
      if (!id || !audio) throw new Error("voice needs <listing-id> <audio file>");
      const c = client(guard);
      const r = await ingestVoice({
        listingId: id,
        audio,
        store,
        transcriber: { transcribe: (wav, secs) => c.transcribe(wav, secs) },
        proposer: new MuseVoiceProposer(c),
        log: (m) => console.log(m),
      });
      const voice = r.listing.claims.filter((x) => /^s\d+$/.test(x.id));
      for (const x of voice)
        console.log(
          `${x.id.padEnd(4)} ${x.provenance.padEnd(14)} ${x.statement}${x.evidence?.quote ? `   <- "${x.evidence.quote}"` : ""}${x.note ? `   (${x.note})` : ""}`,
        );
      console.log(
        `\n${r.added} voice claims kept, ${r.discardedPrivate} private discarded. spent $${guard.spentUsd.toFixed(4)} of $${guard.budgetUsd}`,
      );
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
      const principals = PrincipalRegistry.fromFile(join(store.root, "principals.json"));
      const issuerKeyPath = join(store.root, "keys", "issuer.pem");
      const issuerForDeals = existsSync(issuerKeyPath)
        ? { id: "aval-issuer", privateKeyPem: readFileSync(issuerKeyPath, "utf8") }
        : undefined;
      const negotiation = new NegotiationService({
        store,
        principals,
        seller: values.offline ? scriptedSeller() : new MuseSeller(client(guard)).respond,
        attachments: (listingId) => {
          const l = store.loadListing(listingId);
          return l && issuerForDeals
            ? {
                passport_root: issuePassport(l, issuerForDeals).header.merkle_root,
                ...reviewAttachments(store.listingDir(listingId)),
              }
            : {};
        },
      });
      const core = new GatewayCore({ store, model, audit, negotiation });
      const port = Number(values.port);
      const issuerKey = join(store.root, "keys", "issuer.pem");
      await startGateway(
        core,
        registry,
        port,
        "127.0.0.1",
        store,
        existsSync(issuerKey)
          ? { id: "aval-issuer", privateKeyPem: readFileSync(issuerKey, "utf8") }
          : undefined,
        values.offline ? new RuleIntentParser() : new MuseIntentParser(client(guard)),
        values.offline ? undefined : new MuseTranslator(client(guard)),
      );
      console.log(`Buyer pages: http://127.0.0.1:${port}/search (search) and /l/<id>/showroom`);
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
    case "leads": {
      const [sub, leadId] = positionals;
      const all = store.readJsonl<LeadRecord>("leads.jsonl");
      if (sub === "delete") {
        if (!leadId || !all.some((l) => l.id === leadId)) throw new Error("leads delete <lead-id>");
        const path = join(store.root, "leads.jsonl");
        writeFileSync(
          path,
          all
            .filter((l) => l.id !== leadId)
            .map((l) => `${JSON.stringify(l)}\n`)
            .join(""),
        );
        console.log(`deleted ${leadId} (the buyer's details are gone)`);
        return;
      }
      const rows = all.filter((l) => !values.id || l.listing_id === values.id);
      if (rows.length === 0) console.log("no leads yet");
      const clean = (x: string) => x.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
      for (const l of rows.reverse()) {
        const fit =
          l.fit.status === "no_criteria"
            ? "no search attached"
            : l.fit.status === "not_a_fit"
              ? `NOT A FIT (${l.fit.not_met.join("; ")})`
              : `${l.fit.status === "all_met" ? "fits" : "fits so far"}: ${l.fit.met.length} met${l.fit.unconfirmed.length ? `, to confirm: ${l.fit.unconfirmed.join(", ")}` : ""}${l.fit.not_met.length ? `, not met: ${l.fit.not_met.join(", ")}` : ""}`;
        console.log(
          `${l.id}  ${l.at.slice(0, 16)}  ${l.listing_id}  ${clean(l.name)}  <${clean(l.contact)}>${l.slot ? `  visit: ${l.slot}` : ""}`,
        );
        console.log(`    ${fit}${l.message ? `\n    "${clean(l.message)}"` : ""}`);
      }
      return;
    }
    case "caption": {
      const [id] = positionals;
      const l = id ? store.loadListing(id) : null;
      if (!id || !l)
        throw new Error(
          "caption <id> [--channel instagram|portal] [--language es|en] [--base <url>] [--include-stated] [--offline]",
        );
      if (values.channel !== "instagram" && values.channel !== "portal")
        throw new Error("--channel must be instagram or portal");
      const language = values.language ?? (values.offline ? "en" : "es");
      if (language !== "en" && language !== "es") throw new Error("--language must be en or es");
      const c = values.offline ? null : client(guard);
      try {
        const cap = await buildCaption({
          listing: l,
          channel: values.channel as Channel,
          language,
          model: c ? new MuseCaptionModel(c) : new OfflineCaptionModel(),
          ...(c ? { translator: new MuseTranslator(c) } : {}),
          ...(values.base ? { base: values.base } : {}),
          includeStated: values["include-stated"],
        });
        const out = join(store.listingDir(id), `caption-${cap.channel}-${cap.language}.json`);
        writeFileSync(out, `${JSON.stringify(cap, null, 2)}\n`);
        console.log(`\n${cap.text}\n`);
        console.log("Each sentence and the proof it rests on:");
        const byId = new Map(l.claims.map((x) => [x.id, x]));
        cap.sentences.forEach((s, i) => {
          const why = s.claim_ids.map((cid) => {
            const claim = byId.get(cid);
            const e = claim?.evidence;
            return claim?.provenance === "visually_verified"
              ? `${cid} verified in the video${e?.t_sec != null ? ` at ${e.t_sec}s (${e.frames_detected} frames)` : ""}`
              : `${cid} declared by the broker`;
          });
          console.log(`  ${i + 1}. ${s.english}\n     <- ${why.join("; ")}`);
        });
        if (cap.withheld.length > 0) {
          console.log("\nLeft out, and why:");
          for (const w of cap.withheld) console.log(`  - ${w.statement}: ${w.reason}`);
        }
        if (cap.dropped.length > 0) {
          console.log("\nThe writer proposed these and the checker removed them:");
          for (const d of cap.dropped) console.log(`  - "${d.text}": ${d.reason}`);
        }
        console.log(`\n${out}  (hash ${cap.hash.slice(0, 16)}...)`);
      } catch (e) {
        if (e instanceof CaptionError) throw new Error(`${e.code}: ${e.message}`);
        throw e;
      }
      return;
    }
    case "export-agentsales": {
      const wanted = values.all ? store.listListings().map((l) => l.id) : positionals;
      if (wanted.length === 0)
        throw new Error(
          "export-agentsales <id…> | --all [--format json|csv] [--out file] [--base <url>] [--plain]",
        );
      if (values.format !== "json" && values.format !== "csv")
        throw new Error("--format must be json or csv");
      const exported = wanted.map((id) => {
        const l = store.loadListing(id);
        if (!l) throw new Error(`no such listing: ${id}`);
        const review = loadPublicReview(store.listingDir(id));
        const capPath = join(store.listingDir(id), "caption-instagram-es.json");
        const cap = existsSync(capPath)
          ? (JSON.parse(readFileSync(capPath, "utf8")) as Caption)
          : null;
        return exportAgentSalesRow(l, {
          ...(cap && verifyCaptionHash(cap) ? { caption: cap.text } : {}),
          ...(values.base ? { base: values.base } : {}),
          ...(review ? { reviewStatus: review.status } : {}),
          plain: values.plain,
        });
      });
      const body =
        values.format === "csv" ? toCsv(exported) : `${JSON.stringify(exported, null, 2)}\n`;
      const out =
        values.out ??
        join(
          store.root,
          "exports",
          `agentsales-${values.all ? "all" : wanted.join("+")}.${values.format}`,
        );
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, body, { mode: 0o600 });
      console.log(
        `${out}\n${exported.length} listing(s). The file holds the real addresses (your own data, for your own tool): do not publish it.`,
      );
      console.log(
        `Verified-only amenities: ${exported.map((r) => `${r.id_propiedad}=${(r.amenities as string[]).length}`).join(", ")}`,
      );
      return;
    }
    case "alerts": {
      const [sub, alertId] = positionals;
      const alerts = store.readJsonl<AlertRecord>("alerts.jsonl");
      const path = join(store.root, "alerts.jsonl");
      if (sub === "run") {
        const fresh = runAlerts(store);
        console.log(
          fresh.length === 0
            ? "no new matches"
            : `${fresh.length} new match(es): node src/cli.ts alerts`,
        );
        return;
      }
      if (sub === "delete") {
        if (!alertId || !alerts.some((a) => a.id === alertId))
          throw new Error("alerts delete <alert-id>");
        writeFileSync(
          path,
          alerts
            .filter((a) => a.id !== alertId)
            .map((a) => `${JSON.stringify(a)}\n`)
            .join(""),
        );
        const mpath = join(store.root, "alert-matches.jsonl");
        const keep = store
          .readJsonl<AlertMatch>("alert-matches.jsonl")
          .filter((m) => m.alert_id !== alertId);
        writeFileSync(mpath, keep.map((m) => `${JSON.stringify(m)}\n`).join(""));
        console.log(`deleted ${alertId} (the buyer's details are gone)`);
        return;
      }
      if (alerts.length === 0) console.log("no saved searches yet");
      const matches = store.readJsonl<AlertMatch>("alert-matches.jsonl");
      const clean = (x: string) => x.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
      for (const a of alerts) {
        console.log(
          `${a.id}  ${a.at.slice(0, 16)}  ${clean(a.name || "(no name)")}  <${clean(a.contact)}>  watching since ${a.seen.length} listings existed`,
        );
        console.log(`    search: ${clean(a.text) || JSON.stringify(a.criteria)}`);
        for (const m of matches.filter((x) => x.alert_id === a.id))
          console.log(
            `    NEW MATCH ${m.listing_id} (${m.fit === "all_met" ? "everything met" : `to confirm: ${m.unconfirmed.join(", ")}`}) at ${m.at.slice(0, 16)}`,
          );
      }
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
    case "principal": {
      const [sub, id, ...nameParts] = positionals;
      if (sub !== "keygen" || !id || nameParts.length === 0)
        throw new Error("principal keygen <id> <name>");
      const keyPath = join(store.root, "keys", `principal-${id}.pem`);
      if (existsSync(keyPath)) throw new Error("that principal already has a key");
      const { publicKey, privateKey } = genKeys("ed25519");
      mkdirSync(join(store.root, "keys"), { recursive: true });
      writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
      const regPath = join(store.root, "principals.json");
      const reg = existsSync(regPath)
        ? (JSON.parse(readFileSync(regPath, "utf8")) as Array<{
            id: string;
            name: string;
            publicKey: string;
          }>)
        : [];
      reg.push({
        id,
        name: nameParts.join(" "),
        publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      });
      writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
      console.log(
        `principal ${id} registered; private key in .aval/keys/principal-${id}.pem (never commit it)`,
      );
      return;
    }
    case "mandate": {
      const [kind, listingId] = positionals;
      if ((kind !== "seller" && kind !== "buyer") || !listingId || !values.principal)
        throw new Error("mandate seller|buyer <listing> --principal <id> ...");
      const pem = readFileSync(
        join(store.root, "keys", `principal-${values.principal}.pem`),
        "utf8",
      );
      const [d0, d1] = values.days.split("-").map(Number);
      const now = new Date();
      const base = {
        id: `m-${newSalt().slice(0, 8)}`,
        listing_id: listingId,
        principal: values.principal,
        currency: values.currency as "UF" | "CLP",
        max_rounds: Number(values.rounds),
        allowed_conditions: values.conditions
          .split(",")
          .filter((c): c is (typeof CONDITIONS)[number] =>
            (CONDITIONS as readonly string[]).includes(c),
          ),
        issued_at: now.toISOString(),
        expires_at: new Date(
          now.getTime() + Number(values["valid-days"]) * 86_400_000,
        ).toISOString(),
        salt: newSalt(),
        closing_days: { min: d0 ?? 30, max: d1 ?? d0 ?? 90 },
      };
      const svc = new NegotiationService({
        store,
        principals: PrincipalRegistry.fromFile(join(store.root, "principals.json")),
        seller: scriptedSeller(),
      });
      if (kind === "seller") {
        if (!values.asking || !values.floor)
          throw new Error("seller mandate needs --asking and --floor");
        const m: SellerMandate = {
          ...base,
          kind: "seller",
          asking: Number(values.asking),
          floor: Number(values.floor),
        };
        writeFileSync(
          svc.mandatePath("seller", listingId),
          `${JSON.stringify(signMandate(m, pem), null, 2)}\n`,
          { mode: 0o600 },
        );
        console.log(
          `seller mandate signed for ${listingId} (asking and floor stored privately; the floor is never in the listing)`,
        );
      } else {
        if (!values.agent || !values.target || !values.max)
          throw new Error("buyer mandate needs --agent, --target and --max");
        const m: BuyerMandate = {
          ...base,
          kind: "buyer",
          agent_id: values.agent,
          target: Number(values.target),
          max: Number(values.max),
        };
        writeFileSync(
          svc.mandatePath("buyer", listingId, values.agent),
          `${JSON.stringify(signMandate(m, pem), null, 2)}\n`,
          { mode: 0o600 },
        );
        console.log(`buyer mandate signed for agent ${values.agent} on ${listingId}`);
      }
      return;
    }
    case "negotiation": {
      const [sub, id] = positionals;
      const svc = new NegotiationService({
        store,
        principals: PrincipalRegistry.fromFile(join(store.root, "principals.json")),
        seller: scriptedSeller(),
      });
      if (sub === "list" || !sub) {
        for (const x of svc.list())
          console.log(
            `${x.state.id}  ${x.state.status.padEnd(11)} ${x.state.listing_id}  agent=${x.buyer_agent_id}  moves=${x.state.moves.length}`,
          );
        return;
      }
      if (!id) throw new Error("negotiation show|approve <id>");
      if (sub === "show") {
        const op = svc.operatorState(id);
        if (!op) throw new Error("no such negotiation (or its mandates are no longer valid)");
        for (const m of op.state.moves)
          console.log(
            `${String(m.seq).padStart(2)}. ${m.party.padEnd(6)} ${m.type.padEnd(9)} ${m.price !== undefined ? `${op.state.currency} ${m.price}, ${m.closing_days} days` : ""}  "${m.rationale}"${m.flags.length ? `  [flags: ${m.flags.join(",")}]` : ""}`,
          );
        console.log(
          `status: ${op.state.status}${op.state.agreement ? `  agreed ${op.state.currency} ${op.state.agreement.price}, ${op.state.agreement.closing_days} days` : ""}`,
        );
        const ts = svc.termSheet(id);
        if (ts) {
          const st = approvalStatus(
            ts.term_sheet,
            ts.approvals,
            PrincipalRegistry.fromFile(join(store.root, "principals.json")),
          );
          console.log(
            `term sheet: non-binding; approvals buyer=${st.buyer ? "yes" : "pending"} seller=${st.seller ? "yes" : "pending"}${st.complete ? "  -> both principals approved" : ""}`,
          );
        }
        return;
      }
      if (sub === "approve") {
        if (!values.as) throw new Error("negotiation approve <id> --as <principal>");
        const ts = svc.termSheet(id);
        if (!ts) throw new Error("no term sheet yet: the negotiation did not reach an agreement");
        const a = approveTermSheet(
          ts.term_sheet,
          values.as,
          readFileSync(join(store.root, "keys", `principal-${values.as}.pem`), "utf8"),
        );
        const r = svc.addApproval(id, a);
        console.log(
          `approved as ${values.as}. buyer=${r.buyer ? "yes" : "pending"} seller=${r.seller ? "yes" : "pending"}${r.complete ? "  -> BOTH PRINCIPALS APPROVED (still non-binding: a lawyer and a notary come next)" : ""}`,
        );
        return;
      }
      throw new Error("negotiation list | show <id> | approve <id> --as <principal>");
    }
    case "passport": {
      const [sub, a, b] = positionals;
      const keyPath = join(store.root, "keys", "issuer.pem");
      const issuer = () => {
        if (!existsSync(keyPath)) throw new Error("no issuer key yet: run `passport init` first");
        return { id: "aval-issuer", privateKeyPem: readFileSync(keyPath, "utf8") };
      };
      if (sub === "init") {
        if (existsSync(keyPath)) throw new Error("issuer key already exists");
        mkdirSync(join(store.root, "keys"), { recursive: true });
        writeFileSync(
          keyPath,
          genKeys("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }),
          { mode: 0o600 },
        );
        console.log(
          `issuer key created; public key: ${(await import("./passport/passport.ts")).publicKeyOf(readFileSync(keyPath, "utf8"))}`,
        );
      } else if (sub === "issue") {
        const l = a ? store.loadListing(a) : null;
        if (!a || !l) throw new Error("passport issue needs an existing listing id");
        const p = issuePassport(l, issuer(), {
          listingDir: store.listingDir(a),
          attachments: reviewAttachments(store.listingDir(a)),
        });
        const out = join(store.listingDir(a), "passport.json");
        writeFileSync(out, `${JSON.stringify(p, null, 2)}\n`);
        console.log(
          `${out}\n${p.facts.length} facts, merkle root ${p.header.merkle_root.slice(0, 16)}..., valid until ${p.header.expires_at.slice(0, 10)}`,
        );
      } else if (sub === "verify" && a) {
        const r = verifyPassport(JSON.parse(readFileSync(a, "utf8")) as Passport);
        console.log(
          r.valid
            ? "VALID: signature, Merkle root and dates check out (offline)"
            : `INVALID: ${r.reasons.join("; ")}`,
        );
        process.exitCode = r.valid ? 0 : 1;
      } else if (sub === "prove" && a && b) {
        console.log(
          JSON.stringify(proveFact(JSON.parse(readFileSync(a, "utf8")) as Passport, b), null, 2),
        );
      } else if (sub === "verify-proof" && a) {
        const r = verifyFactProof(JSON.parse(readFileSync(a, "utf8")) as FactProof);
        console.log(
          r.valid
            ? "VALID: this fact is part of the signed passport"
            : `INVALID: ${r.reasons.join("; ")}`,
        );
        process.exitCode = r.valid ? 0 : 1;
      } else {
        throw new Error(
          "passport init | issue <id> | verify <file> | prove <file> <fact-id> | verify-proof <file>",
        );
      }
      return;
    }
    case "diligence": {
      const [sub, id, ...files] = positionals;
      const l = id ? store.loadListing(id) : null;
      if (!sub || !id || !l) throw new Error("diligence check <id> <pdfs…> | show <id> [--public]");
      const dir = store.listingDir(id);
      const reviewPath = join(dir, "title-review.json");
      if (sub === "show") {
        if (!existsSync(reviewPath)) throw new Error("no review yet: run `diligence check` first");
        const r = JSON.parse(readFileSync(reviewPath, "utf8")) as TitleReview;
        if (!verifyReviewHash(r)) throw new Error("the stored review failed its integrity check");
        if (values.public) {
          console.log(JSON.stringify(publicSummary(r), null, 2));
          return;
        }
        console.log(
          `${r.status.toUpperCase()}  (${r.documents.length} documents, review ${r.hash.slice(0, 16)}...)`,
        );
        for (const f of r.findings) {
          const tag =
            f.severity === "blocker" ? "BLOCKER" : f.severity === "warning" ? "warning" : "ok     ";
          console.log(`  ${tag}  ${f.rule}: ${f.message}`);
          for (const e of f.evidence.slice(0, 2))
            console.log(`           ${e.doc_type} p.${e.page}: "${e.quote}"`);
        }
        console.log(`\n${r.disclaimer}`);
        return;
      }
      if (sub !== "check" || files.length === 0) throw new Error("diligence check <id> <pdfs…>");
      const sellerPath = join(dir, "seller.json");
      if (values["seller-name"] && values["seller-rut"]) {
        writeFileSync(
          sellerPath,
          `${JSON.stringify({ legal_name: values["seller-name"], rut: values["seller-rut"] })}\n`,
          { mode: 0o600 },
        );
      }
      if (!existsSync(sellerPath))
        throw new Error(
          "who is the seller? pass --seller-name and --seller-rut once (kept private, never served)",
        );
      const seller = JSON.parse(readFileSync(sellerPath, "utf8")) as {
        legal_name: string;
        rut: string;
      };
      const r = await reviewTitle({
        listing: l,
        seller,
        files,
        reader: new MuseDocReader(client(guard)),
        now: new Date(),
      });
      writeFileSync(reviewPath, `${JSON.stringify(r, null, 2)}\n`);
      console.log(
        `${reviewPath}\nstatus: ${r.status}  (run \`diligence show ${id}\` for the findings)`,
      );
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
