import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Listing } from "../claims/schema.ts";
import { loadPublicReview, reviewAttachments } from "../diligence/review.ts";
import { type Issuer, issuePassport, publicKeyOf } from "../passport/passport.ts";
import type { Store } from "../store.ts";
import { type Caller, PolicyDenied, type VisibleFact, visibleFacts } from "./policy.ts";
import { esc, icon, proofMeter, provBadge, shell, type Theme, themeFrom } from "./ui.ts";

/**
 * Public pages for agents that do not speak MCP (and for people): a page and a JSON document per
 * listing, a listings index, and a discovery file. Everything is rendered from `visibleFacts` for the
 * ANONYMOUS tier, the same single door the gateway uses, so a page can never show more than an
 * unidentified agent may know: no address unless the seller allows it, the price only as the seller
 * allows, nothing held back. A seller that serves only identified agents gets a 404, not a stub.
 */
const PUBLIC: Caller = { agentId: null, tier: "anonymous" };

export const MCP_TOOLS = [
  "list_listings",
  "search_listings",
  "get_facts",
  "get_policy",
  "get_title_review",
  "ask_listing",
  "request_visit",
  "negotiation_start",
  "negotiation_offer",
  "negotiation_accept",
  "negotiation_walk_away",
  "negotiation_status",
] as const;

/** JSON that is safe inside <script>: no "</script>", no HTML comments, no line separators. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function publicFacts(listing: Listing): VisibleFact[] | null {
  try {
    return visibleFacts(listing, PUBLIC);
  } catch (err) {
    if (err instanceof PolicyDenied) return null;
    throw err;
  }
}

export const BADGE: Record<VisibleFact["provenance"], string> = {
  visually_verified: "verified by video",
  broker_stated: "said by the broker",
  broker_declared: "declared by the broker",
};

function numberFrom(facts: VisibleFact[], id: string, re: RegExp): number | undefined {
  const f = facts.find((x) => x.id === id);
  const m = f && re.exec(f.statement);
  return m ? Number(m[1]) : undefined;
}

const ISO_CURRENCY = { UF: "CLF", CLP: "CLP" } as const;

/** schema.org RealEstateListing; provenance rides along as a PropertyValue on every feature. */
export function listingJsonLd(
  listing: Listing,
  facts: VisibleFact[],
  url: string,
): Record<string, unknown> {
  const bedrooms = numberFrom(facts, "d-bedrooms", /^(\d+) bedroom/);
  const bathrooms = numberFrom(facts, "d-bathrooms", /^(\d+) bathroom/);
  const area = numberFrom(facts, "d-area", /^(\d+(?:\.\d+)?) m2/);
  const pets = facts.find((f) => f.id === "d-pets");
  const priceFact = facts.find((f) => f.id === "d-price");
  const exact = priceFact && /^Price (UF|CLP) (\d+)$/.exec(priceFact.statement);
  const range =
    priceFact && /^Price between (UF|CLP) (\d+) and (?:UF|CLP) (\d+)/.exec(priceFact.statement);
  const addressFact = facts.find((f) => f.id === "d-address");
  const offers: Record<string, unknown> = {
    "@type": "Offer",
    businessFunction:
      listing.declared.operation === "sale"
        ? "http://purl.org/goodrelations/v1#Sell"
        : "http://purl.org/goodrelations/v1#LeaseOut",
  };
  if (exact) {
    offers.price = Number(exact[2]);
    offers.priceCurrency = ISO_CURRENCY[exact[1] as "UF" | "CLP"];
  } else if (range) {
    offers.priceSpecification = {
      "@type": "PriceSpecification",
      minPrice: Number(range[2]),
      maxPrice: Number(range[3]),
      priceCurrency: ISO_CURRENCY[range[1] as "UF" | "CLP"],
    };
  } else {
    offers.description = "Price on request: the seller does not disclose it.";
  }
  const about: Record<string, unknown> = { "@type": "Accommodation" };
  if (bedrooms !== undefined) about.numberOfBedrooms = bedrooms;
  if (bathrooms !== undefined) about.numberOfBathroomsTotal = bathrooms;
  if (area !== undefined)
    about.floorSize = { "@type": "QuantitativeValue", value: area, unitCode: "MTK" };
  if (pets) about.petsAllowed = pets.statement === "Pets allowed";
  about.address = {
    "@type": "PostalAddress",
    addressLocality: listing.declared.commune,
    addressCountry: "CL",
    ...(addressFact ? { streetAddress: addressFact.statement.replace(/^Address: /, "") } : {}),
  };
  about.amenityFeature = facts
    .filter((f) => !f.id.startsWith("d-") || f.id.startsWith("d-amenity") || f.id === "d-parking")
    .map((f) => ({
      "@type": "LocationFeatureSpecification",
      name: f.statement,
      value: true,
      additionalProperty: [
        { "@type": "PropertyValue", propertyID: "aval:provenance", value: f.provenance },
        { "@type": "PropertyValue", propertyID: "aval:evidence", value: f.evidence },
      ],
    }));
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "@id": url,
    url,
    name: listing.declared.title,
    about,
    offers,
  };
}

export function policyLines(listing: Listing): string[] {
  const p = listing.policy;
  return [
    p.showExactAddress
      ? "The seller shares the exact address."
      : "The exact address is withheld by the seller.",
    p.priceVisibility === "exact"
      ? "The price is shown exactly."
      : p.priceVisibility === "range"
        ? "The price is shown only as an approximate range."
        : "The price is not disclosed; ask the broker.",
    p.visitSlots.length > 0
      ? "Visits can be requested only by identified agents, and a human broker must approve each one."
      : "Visits are not open.",
    "Held-back and taste claims are never shown. Every fact below says where it comes from.",
  ];
}

/** The page script is hashed into the Content-Security-Policy, so nothing else can run on it. */
export function webMcpScript(listing: Listing, facts: VisibleFact[]): string {
  const payload = jsonForScript({
    listing_id: listing.id,
    facts: facts.map((f) => ({
      id: f.id,
      statement: f.statement,
      provenance: f.provenance,
      evidence: f.evidence,
    })),
  });
  return `if (typeof navigator !== "undefined" && navigator.modelContext && navigator.modelContext.registerTool) {
  try {
    navigator.modelContext.registerTool({
      name: "get_listing_facts",
      description: "Verified and declared facts about this listing, each with its provenance. Experimental: WebMCP is a draft.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(${payload}) }] }),
    });
  } catch (e) {}
}`;
}

const REVIEW_TEXT: Record<string, string> = {
  clear: "reviewed, nothing found",
  needs_attention: "reviewed, items to settle before closing",
  blocked: "reviewed, a blocking problem was found",
  incomplete: "some documents are missing or could not be verified",
};
const REVIEW_TONE: Record<string, string> = {
  clear: "",
  needs_attention: " fit--maybe",
  blocked: " fit--bad",
  incomplete: " fit--maybe",
};

export function reviewBox(r: ReturnType<typeof loadPublicReview>): string {
  const names = (xs: string[]) =>
    xs.map((x) => esc(x.toLowerCase().replaceAll("_", " "))).join(", ");
  if (!r)
    return `<section class="panel"><h2>${icon("doc")} Sale documents</h2><p class="muted" style="margin:0">Not reviewed: the seller has not provided documents. This is not the same as clear.</p></section>`;
  return `<section class="panel"><div class="res-head"><h2>${icon("doc")} Sale documents</h2><span class="fit${REVIEW_TONE[r.status] ?? " fit--maybe"}">${esc(REVIEW_TEXT[r.status] ?? r.status)}</span></div>
<p style="margin:.5rem 0 0">${r.documents} certificates read.${r.blockers.length ? ` <b class="err">Blocking:</b> ${names(r.blockers)}.` : ""}${r.warnings.length ? ` <b style="color:var(--maybe)">To settle:</b> ${names(r.warnings)}.` : ""}</p>
<p class="small muted" style="margin:.4rem 0 0">Automated reading, not legal advice. Review <span class="mono">${esc(r.review_hash.slice(0, 12))}…</span></p></section>`;
}

/** A verified evidence frame to use as the cover, only when the seller publishes its media. */
export function coverFor(listing: Listing, store: Store): string | null {
  if (listing.policy.publicMedia !== true) return null;
  const best = listing.claims
    .filter(
      (c) =>
        c.provenance === "visually_verified" &&
        c.evidence?.image &&
        /^evidence\/[A-Za-z0-9_-]+\.(jpg|png)$/.test(c.evidence.image),
    )
    .sort((a, b) => (b.evidence?.frames_detected ?? 0) - (a.evidence?.frames_detected ?? 0))[0];
  const image = best?.evidence?.image;
  return image && existsSync(join(store.listingDir(listing.id), image))
    ? `/l/${listing.id}/${image}`
    : null;
}

const countOf = (facts: VisibleFact[], p: VisibleFact["provenance"]): number =>
  facts.filter((f) => f.provenance === p).length;

export function renderListingPage(
  listing: Listing,
  facts: VisibleFact[],
  baseUrl: string,
  review: ReturnType<typeof loadPublicReview> = null,
  ctx: { url?: URL; theme?: Theme | null } = {},
): { html: string; scriptHash: string } {
  const url = `${baseUrl}/l/${listing.id}`;
  const script = webMcpScript(listing, facts);
  const scriptHash = createHash("sha256").update(script).digest("base64");
  const rank: Record<VisibleFact["provenance"], number> = {
    visually_verified: 0,
    broker_stated: 1,
    broker_declared: 2,
  };
  const v = countOf(facts, "visually_verified");
  const st = countOf(facts, "broker_stated");
  const d = countOf(facts, "broker_declared");
  const rows = [...facts]
    .sort((a, b) => rank[a.provenance] - rank[b.provenance])
    .map(
      (f) =>
        `<li><span>${esc(f.statement)}</span><span>${provBadge(f.provenance)}</span><span class="q">${esc(f.evidence)}</span></li>`,
    )
    .join("");
  const body = `<main class="wrap">
<div class="titlebar"><div><div class="crumbs"><a href="/listings">Listings</a> / Facts</div>
<h1 style="font-size:clamp(1.7rem,3.6vw,2.4rem)">${esc(listing.declared.title)}</h1>
<div class="chips" style="margin-top:.8rem"><span class="chip chip--soft">${esc(listing.declared.commune)}</span><span class="chip chip--soft">${listing.declared.operation === "sale" ? "For sale" : "For rent"}</span><span class="chip chip--soft mono">${esc(listing.id)}</span></div></div>
<div><div style="min-width:240px">${proofMeter(v, st, d)}</div><div class="legend" style="margin-top:.5rem"><span><b style="color:var(--verified)">${v}</b>verified in video</span><span><b>${st}</b>said</span><span><b>${d}</b>declared</span></div>
<p style="margin:.9rem 0 0"><a class="btn btn--sm" href="/l/${esc(listing.id)}/showroom">Open the showroom ${icon("arrow")}</a></p></div></div>
<div class="cols"><section class="panel"><h2>Every fact, with where it comes from</h2><ul class="said" style="margin-top:.5rem">${rows}</ul></section>
<div class="stack"><section class="panel"><h2>What the seller's rules mean for you</h2><ul class="mapped small">${policyLines(
    listing,
  )
    .map((l) => `<li>${esc(l)}</li>`)
    .join("")}</ul></section>
${reviewBox(review)}
<section class="panel"><h2>For AI agents</h2><p class="small muted" style="margin:0 0 .6rem">This is the public, read-only view. Agents that identify themselves can ask questions, search across sellers, request visits and negotiate.</p>
<p class="mono" style="word-break:break-all;margin:.2rem 0 .6rem">${esc(baseUrl)}/mcp</p><div class="chips">${MCP_TOOLS.map((t) => `<span class="chip chip--soft mono">${esc(t)}</span>`).join("")}</div>
<p class="small muted" style="margin:.8rem 0 0">Requests are signed: see <a href="/.well-known/aval.json">/.well-known/aval.json</a>. Facts as JSON: <a href="/l/${esc(listing.id)}.json">${esc(listing.id)}.json</a>. Signed, offline-verifiable record: <a href="/l/${esc(listing.id)}/passport.json">passport.json</a>.</p></section></div></div>
</main>`;
  const html = shell({
    title: `${listing.declared.title} · Aval`,
    description: "Verified facts about this listing, each with its source.",
    body,
    active: "listings",
    theme: ctx.theme ?? null,
    ...(ctx.url ? { url: ctx.url } : {}),
    head: `<link rel="alternate" type="application/json" href="/l/${esc(listing.id)}.json"><link rel="canonical" href="${esc(url)}"><script type="application/ld+json">${jsonForScript(listingJsonLd(listing, facts, url))}</script>`,
    script,
  });
  return { html, scriptHash };
}

export function renderIndex(
  listings: Listing[],
  _baseUrl: string,
  store?: Store,
  ctx: { url?: URL; theme?: Theme | null } = {},
): string {
  const cards = listings
    .map((l) => ({ l, facts: publicFacts(l) }))
    .filter((x): x is { l: Listing; facts: VisibleFact[] } => x.facts !== null)
    .map(({ l, facts }) => {
      const cover = store ? coverFor(l, store) : null;
      return `<article class="card lc"><a class="thumb" href="/l/${esc(l.id)}/showroom" tabindex="-1" aria-hidden="true">${cover ? `<img loading="lazy" alt="" src="${esc(cover)}">` : `<span class="ph">${icon("video")}No walkthrough published</span>`}</a>
<div class="lc-body"><div class="muted small">${esc(l.declared.commune)} · ${l.declared.operation === "sale" ? "for sale" : "for rent"}</div><h2><a href="/l/${esc(l.id)}/showroom">${esc(l.declared.title)}</a></h2>
${proofMeter(countOf(facts, "visually_verified"), countOf(facts, "broker_stated"), countOf(facts, "broker_declared"))}
<div class="muted small"><b style="color:var(--verified)">${countOf(facts, "visually_verified")}</b> verified · ${countOf(facts, "broker_stated")} said · ${countOf(facts, "broker_declared")} declared</div>
<div class="res-foot"><a class="btn btn--sm" href="/l/${esc(l.id)}/showroom">Showroom</a><a class="btn btn--sm btn--ghost" href="/l/${esc(l.id)}">Facts</a></div></div></article>`;
    })
    .join("");
  const body = `<main class="wrap"><section class="hero"><div class="eyebrow">Registry</div><h1>Listings with their proof.</h1>
<p class="lead">Only what is verified, said by the broker, or declared is shown, and each fact says which.</p>
<p style="margin-top:1.2rem"><a class="btn" href="/search">${icon("search")} Find a home</a></p></section>
<div class="cards">${cards}</div></main>`;
  return shell({
    title: "Listings · Aval",
    description: "Listings whose facts carry their proof.",
    body,
    active: "listings",
    theme: ctx.theme ?? null,
    ...(ctx.url ? { url: ctx.url } : {}),
    head: `<link rel="alternate" type="application/json" href="/listings.json">`,
  });
}

export function listingsJson(listings: Listing[], baseUrl: string): unknown {
  return {
    listings: listings
      .filter((l) => publicFacts(l) !== null)
      .map((l) => ({
        id: l.id,
        title: l.declared.title,
        commune: l.declared.commune,
        operation: l.declared.operation,
        url: `${baseUrl}/l/${l.id}`,
        json: `${baseUrl}/l/${l.id}.json`,
      })),
  };
}

export function listingJson(listing: Listing, facts: VisibleFact[], baseUrl: string): unknown {
  return {
    id: listing.id,
    title: listing.declared.title,
    commune: listing.declared.commune,
    operation: listing.declared.operation,
    rules: policyLines(listing),
    facts: facts.map((f) => ({
      id: f.id,
      statement: f.statement,
      provenance: f.provenance,
      evidence: f.evidence,
    })),
    jsonld: listingJsonLd(listing, facts, `${baseUrl}/l/${listing.id}`),
    mcp: `${baseUrl}/mcp`,
  };
}

export function discoveryDocument(baseUrl: string, issuer?: Issuer): unknown {
  return {
    name: "Aval gateway",
    description: "Listings whose facts carry their proof. No evidence, no claim.",
    mcp: { url: `${baseUrl}/mcp`, transport: "streamable-http", tools: MCP_TOOLS },
    identity: {
      scheme: "ed25519-signed-requests",
      note: "Unsigned agents are served read-only. Visit requests need a registered, signing agent.",
      headers: ["x-aval-agent", "x-aval-ts", "x-aval-nonce", "x-aval-sig"],
      signed_payload:
        "agent_id \\n timestamp_ms \\n nonce \\n tool_name \\n sha256_hex(raw_request_body)",
      max_clock_skew_seconds: 300,
    },
    public: {
      index: `${baseUrl}/listings`,
      index_json: `${baseUrl}/listings.json`,
      listing_page: `${baseUrl}/l/{id}`,
      listing_json: `${baseUrl}/l/{id}.json`,
    },
    provenance: ["visually_verified", "broker_stated", "broker_declared"],
    ...(issuer
      ? {
          passport: {
            url: `${baseUrl}/l/{id}/passport.json`,
            issuer: { id: issuer.id, public_key: publicKeyOf(issuer.privateKeyPem) },
            how_to_verify:
              "Recompute the Merkle root over the facts, compare it with header.merkle_root, and check the Ed25519 signature over the canonical JSON of the header with the issuer key. No call to this server is needed.",
          },
        }
      : {}),
  };
}

export function safeBase(req: IncomingMessage): string {
  const fromEnv = process.env.AVAL_PUBLIC_URL;
  if (fromEnv && /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(fromEnv)) return fromEnv;
  const host = req.headers.host ?? "";
  return /^[A-Za-z0-9.-]+(:\d+)?$/.test(host) ? `http://${host}` : "http://localhost";
}

export function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": `${type}; charset=utf-8`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    ...extra,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

export const NOT_FOUND = "Not found";

/** Returns true when the request was one of the public GET routes (and answers it). */
export function handlePublicRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  issuer?: Issuer,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  const base = safeBase(req);
  const CSP_PLAIN =
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const pageUrl = new URL(req.url ?? "/", "http://localhost");
  const theme = themeFrom(pageUrl);
  if (path === "/" || path === "/listings") {
    send(
      req,
      res,
      200,
      "text/html",
      renderIndex(store.listListings(), base, store, { url: pageUrl, theme }),
      {
        "content-security-policy": CSP_PLAIN,
      },
    );
    return true;
  }
  if (path === "/listings.json") {
    send(
      req,
      res,
      200,
      "application/json",
      JSON.stringify(listingsJson(store.listListings(), base), null, 2),
    );
    return true;
  }
  if (path === "/.well-known/aval.json") {
    send(
      req,
      res,
      200,
      "application/json",
      JSON.stringify(discoveryDocument(base, issuer), null, 2),
    );
    return true;
  }
  const pp = /^\/l\/([a-z0-9][a-z0-9-]{0,62})\/passport\.json$/.exec(path);
  if (pp) {
    const l = store.loadListing(pp[1] as string);
    if (!issuer || !l || !publicFacts(l)) {
      send(req, res, 404, "text/plain", NOT_FOUND);
      return true;
    }
    send(
      req,
      res,
      200,
      "application/json",
      JSON.stringify(
        issuePassport(l, issuer, {
          listingDir: store.listingDir(l.id),
          attachments: reviewAttachments(store.listingDir(l.id)),
        }),
        null,
        2,
      ),
    );
    return true;
  }
  const m = /^\/l\/([a-z0-9][a-z0-9-]{0,62})(\.json)?$/.exec(path);
  if (!m) return false;
  const listing = store.loadListing(m[1] as string);
  const facts = listing ? publicFacts(listing) : null;
  if (!listing || !facts) {
    send(req, res, 404, "text/plain", NOT_FOUND);
    return true;
  }
  if (m[2]) {
    send(
      req,
      res,
      200,
      "application/json",
      JSON.stringify(listingJson(listing, facts, base), null, 2),
    );
    return true;
  }
  const { html, scriptHash } = renderListingPage(
    listing,
    facts,
    base,
    loadPublicReview(store.listingDir(listing.id)),
    { url: pageUrl, theme },
  );
  send(req, res, 200, "text/html", html, {
    "content-security-policy": `${CSP_PLAIN}; script-src 'sha256-${scriptHash}'`,
  });
  return true;
}
