import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import type { Listing } from "../claims/schema.ts";
import { loadPublicReview } from "../diligence/review.ts";
import type { Store } from "../store.ts";
import { MAX_QUESTION_CHARS } from "./answer.ts";
import type { GatewayCore } from "./core.ts";
import { type IntentParser, MAX_REQUEST_CHARS, RuleIntentParser } from "./intent.ts";
import { coverFor, NOT_FOUND, publicFacts, reviewBox } from "./pages.ts";
import { assertMayRead, type Caller } from "./policy.ts";
import { type Criteria, CriteriaSchema, type Match, searchListings } from "./search.ts";
import { type AnswerTranslator, looksSpanish } from "./translate.ts";
import { esc, themeFrom } from "./ui.ts";
import {
  criteriaParam,
  type ResultExtras,
  renderSearch,
  renderShowroom,
  SEARCH_SCRIPT_HASH,
  SHOWROOM_SCRIPT_HASH,
} from "./views.ts";

/**
 * The human side of the registry: a search page that understands what a buyer types, a showroom per
 * listing (walkthrough with a chapter for every verified fact, questions, documents, a contact form) and
 * the small JSON endpoints behind it. Everything goes through the same single door as agents (the
 * anonymous tier of the policy), so a buyer can never see more than an unidentified agent may know, and
 * the walkthrough video is shown only when the seller's policy says publicMedia.
 */
const PUBLIC: Caller = { agentId: null, tier: "anonymous" };
const MAX_JSON_BODY = 8_000;
const HOUR = 3_600_000;

class Limiter {
  private readonly hits = new Map<string, number[]>();
  allow(key: string, max: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < HOUR);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export interface BuyerWebDeps {
  store: Store;
  core: GatewayCore;
  intent?: IntentParser;
  translate?: AnswerTranslator;
}

function sendHtml(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  html: string,
  csp: string,
): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "content-security-policy": csp,
  });
  res.end(req.method === "HEAD" ? undefined : html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function notFound(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(404, {
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : NOT_FOUND);
}

function criteriaFromParams(sp: URLSearchParams): Criteria {
  const c: Record<string, unknown> = {};
  const op = sp.get("operation");
  if (op === "sale" || op === "rent") c.operation = op;
  const commune = sp.get("commune")?.trim();
  if (commune) c.commune = commune.slice(0, 60);
  for (const [param, key] of [
    ["beds", "min_bedrooms"],
    ["baths", "min_bathrooms"],
    ["area", "min_area_m2"],
  ] as const) {
    const v = Number(sp.get(param));
    if (sp.get(param) && Number.isFinite(v)) c[key] = v;
  }
  const max = Number(sp.get("max"));
  const cur = sp.get("cur");
  if (sp.get("max") && Number.isFinite(max) && (cur === "UF" || cur === "CLP"))
    c.max_price = { amount: max, currency: cur };
  if (sp.get("pets")) c.pets_required = true;
  const have = (sp.get("have") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
  if (have.length > 0) c.must_have = have.slice(0, 8).map((x) => x.slice(0, 40));
  const parsed = CriteriaSchema.safeParse(c);
  return parsed.success ? parsed.data : {};
}

async function readJson(
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json")
    return { ok: false, status: 415, message: "Send application/json." };
  const origin = req.headers.origin;
  if (
    origin &&
    req.headers.host &&
    origin !== `http://${req.headers.host}` &&
    origin !== `https://${req.headers.host}`
  )
    return { ok: false, status: 403, message: "Cross-site requests are not accepted." };
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_JSON_BODY) return { ok: false, status: 413, message: "Request too large." };
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_JSON_BODY) return { ok: false, status: 413, message: "Request too large." };
    chunks.push(chunk as Buffer);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, message: "That is not valid JSON." };
  }
}

/** Serves a file from the listing folder with Range support (browsers need it to seek in a video). */
function serveFile(req: IncomingMessage, res: ServerResponse, path: string, type: string): void {
  const size = statSync(path).size;
  const base = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  const range = req.headers.range;
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (m[1] === "" && m[2] === "")) {
      res.writeHead(416, { ...base, "content-range": `bytes */${size}` }).end();
      return;
    }
    if (m[1] === "") {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== "") end = Math.min(end, Number(m[2]));
    }
    if (start >= size || start > end) {
      res.writeHead(416, { ...base, "content-range": `bytes */${size}` }).end();
      return;
    }
    status = 206;
  }
  const headers: Record<string, string | number> = { ...base, "content-length": end - start + 1 };
  if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(path, { start, end }).pipe(res);
}

export { SEARCH_SCRIPT_HASH, SHOWROOM_SCRIPT_HASH };

/** What a result card needs beyond the match: how the facts are proven and, if the seller publishes media, a cover frame. */
function resultExtras(listing: Listing, store: Store): ResultExtras {
  const facts = publicFacts(listing) ?? [];
  const n = (p: string) => facts.filter((f) => f.provenance === p).length;
  const cover = coverFor(listing, store);
  return {
    cover,
    proof: {
      verified: n("visually_verified"),
      said: n("broker_stated"),
      declared: n("broker_declared"),
    },
  };
}

export function createBuyerWeb(deps: BuyerWebDeps) {
  const intent = deps.intent ?? new RuleIntentParser();
  const rule = new RuleIntentParser();
  const parses = new Limiter();
  const searches = new Limiter();
  const asks = new Limiter();
  const leads = new Limiter();
  const alertsLimit = new Limiter();

  return async function handleBuyerRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const ip = req.socket.remoteAddress ?? "unknown";
    const get = req.method === "GET" || req.method === "HEAD";

    if (path === "/search" && get) {
      if (!searches.allow(ip, 120)) {
        res.writeHead(429, { "content-type": "text/plain" }).end("Too many searches this hour.");
        return true;
      }
      const listings = deps.store.listListings();
      const communes = [
        ...new Set(
          listings
            .filter((l) => {
              try {
                assertMayRead(l.policy, PUBLIC);
                return true;
              } catch {
                return false;
              }
            })
            .map((l) => l.declared.commune),
        ),
      ];
      const q = (url.searchParams.get("q") ?? "").slice(0, MAX_REQUEST_CHARS);
      let criteria: Criteria = {};
      let note: string | null = null;
      if (q.trim()) {
        const parser = parses.allow(ip, 40) ? intent : rule;
        if (parser === rule && intent !== rule) note = "Too many requests: used the basic reader.";
        const reading = await parser.parse(q, communes);
        criteria = reading.criteria;
        if (reading.reader === "rules" && !(intent instanceof RuleIntentParser))
          note =
            "The language model was unavailable, so a basic reader was used: check what was understood.";
      }
      criteria = { ...criteria, ...criteriaFromParams(url.searchParams) };
      const r = searchListings(listings, PUBLIC, { ...criteria, limit: 10 });
      const extras = new Map<string, ResultExtras>();
      for (const m of r.matches) {
        const l = listings.find((x) => x.id === m.listing_id);
        if (l) extras.set(m.listing_id, resultExtras(l, deps.store));
      }
      sendHtml(
        req,
        res,
        200,
        renderSearch({
          q,
          criteria,
          matches: r.matches,
          excluded: r.excluded,
          communes,
          note,
          extras,
          url,
          theme: themeFrom(url),
        }),
        `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; script-src 'sha256-${SEARCH_SCRIPT_HASH}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      );
      return true;
    }

    if (path === "/alerts" && req.method === "POST") {
      if (!alertsLimit.allow(ip, 10)) {
        sendJson(res, 429, { message: "Too many requests this hour." });
        return true;
      }
      const body = await readJson(req);
      if (!body.ok) {
        sendJson(res, body.status, { message: body.message });
        return true;
      }
      const r = await deps.core.createAlert(PUBLIC, body.value);
      if (!r.ok)
        sendJson(res, r.code === "INVALID_ALERT" ? 400 : r.code === "RATE_LIMITED" ? 429 : 500, {
          code: r.code,
          message: r.message,
        });
      else sendJson(res, 200, r.data);
      return true;
    }

    const m =
      /^\/l\/([a-z0-9][a-z0-9-]{0,62})\/(showroom|media\/clip\.mp4|evidence\/([A-Za-z0-9_-]{1,40})\.(jpg|png)|ask|lead)$/.exec(
        path,
      );
    if (!m) return false;
    const id = m[1] as string;
    const what = m[2] as string;
    const listing = deps.store.loadListing(id);
    const served = listing ? publicFacts(listing) !== null : false;

    if (what === "ask" || what === "lead") {
      if (req.method !== "POST") return false;
      if (!listing || !served) {
        notFound(req, res);
        return true;
      }
      if (!(what === "ask" ? asks : leads).allow(ip, what === "ask" ? 40 : 10)) {
        sendJson(res, 429, { message: "Too many requests this hour." });
        return true;
      }
      const body = await readJson(req);
      if (!body.ok) {
        sendJson(res, body.status, { message: body.message });
        return true;
      }
      if (what === "ask") {
        const question = (body.value as { question?: unknown } | null)?.question;
        if (
          typeof question !== "string" ||
          question.trim() === "" ||
          question.length > MAX_QUESTION_CHARS
        ) {
          sendJson(res, 400, { message: "Ask a question of up to 500 characters." });
          return true;
        }
        const r = await deps.core.ask(PUBLIC, id, question);
        if (!r.ok)
          sendJson(res, r.code === "RATE_LIMITED" ? 429 : 400, {
            code: r.code,
            message: r.message,
          });
        else {
          let translation: { language: "es"; text: string } | null = null;
          if (deps.translate && r.data.refused === null && looksSpanish(question)) {
            const t = await deps.translate.toSpanish(r.data.answer);
            if (t) translation = { language: "es", text: t };
          }
          sendJson(res, 200, { answer: r.data.answer, citations: r.data.citations, translation });
        }
        return true;
      }
      const r = await deps.core.captureLead(PUBLIC, id, body.value);
      if (!r.ok)
        sendJson(res, r.code === "INVALID_LEAD" ? 400 : r.code === "RATE_LIMITED" ? 429 : 404, {
          code: r.code,
          message: r.message,
        });
      else sendJson(res, 200, r.data);
      return true;
    }

    if (!get) return false;
    if (!listing || !served) {
      notFound(req, res);
      return true;
    }
    if (what === "showroom") {
      let criteria: Criteria = {};
      const raw = url.searchParams.get("c");
      if (raw && raw.length <= 1500) {
        try {
          const parsed = CriteriaSchema.safeParse(JSON.parse(raw));
          if (parsed.success) criteria = parsed.data;
        } catch {
          /* ignore a malformed criteria parameter */
        }
      }
      const facts = publicFacts(listing) ?? [];
      const fitResult =
        Object.keys(criteria).length > 0
          ? searchListings([listing], PUBLIC, { ...criteria, limit: 1 })
          : null;
      const dir = deps.store.listingDir(listing.id);
      sendHtml(
        req,
        res,
        200,
        renderShowroom({
          listing,
          facts,
          criteria,
          mediaOk: listing.policy.publicMedia === true && existsSync(join(dir, "clip.mp4")),
          fit: fitResult?.matches[0] ?? null,
          fitExcluded:
            fitResult && !fitResult.matches[0]
              ? (fitResult.excluded[0]?.reason ?? "This home does not fit.")
              : null,
          docs: reviewBox(loadPublicReview(dir)),
          url,
          theme: themeFrom(url),
        }),
        `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; script-src 'sha256-${SHOWROOM_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      );
      return true;
    }
    // media: only when the seller published it
    if (listing.policy.publicMedia !== true) {
      notFound(req, res);
      return true;
    }
    const dir = resolve(deps.store.listingDir(id));
    const file =
      what === "media/clip.mp4" ? join(dir, "clip.mp4") : join(dir, "evidence", `${m[3]}.${m[4]}`);
    const safe = resolve(file);
    if (!safe.startsWith(dir + sep) || !existsSync(safe) || !statSync(safe).isFile()) {
      notFound(req, res);
      return true;
    }
    serveFile(
      req,
      res,
      safe,
      what === "media/clip.mp4" ? "video/mp4" : m[4] === "png" ? "image/png" : "image/jpeg",
    );
    return true;
  };
}
