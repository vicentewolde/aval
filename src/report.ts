import type { Claim, Listing } from "./claims/schema.ts";
import { visibleFacts } from "./gateway/policy.ts";

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );

const BADGE: Record<Claim["provenance"], [string, string]> = {
  visually_verified: ["#0a7d4b", "verified by video"],
  broker_declared: ["#555", "declared by broker"],
  unverified: ["#b26a00", "held back: no evidence"],
  subjective: ["#8a3ffc", "never stated"],
};

function row(c: Claim): string {
  const [color, label] = BADGE[c.provenance];
  const ev =
    c.evidence?.kind === "visual"
      ? `${c.evidence.image ? `<a href="${esc(c.evidence.image)}"><img src="${esc(c.evidence.image)}" alt="evidence for ${esc(c.id)}"></a>` : ""}<div class="m">${esc(c.evidence.concept ?? "")} · ${c.evidence.frames_detected} frames · t=${c.evidence.t_sec?.toFixed(1)}s · conf ${c.evidence.confidence ?? "n/a"}</div>`
      : c.note
        ? `<div class="m">${esc(c.note)}</div>`
        : "";
  return `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.statement)}</td><td><span class="b" style="background:${color}">${label}</span></td><td>${ev}</td></tr>`;
}

const ORDER: Record<Claim["provenance"], number> = {
  visually_verified: 0,
  unverified: 1,
  subjective: 2,
  broker_declared: 3,
};

function card(c: Claim): string {
  if (c.evidence?.kind !== "visual" || !c.evidence.image) return "";
  return `<figure><a href="${esc(c.evidence.image)}"><img src="${esc(c.evidence.image)}" alt="evidence for ${esc(c.id)}"></a><figcaption><b>${esc(c.statement)}</b><span>${esc(c.evidence.concept ?? "")} · ${c.evidence.frames_detected} frames · conf ${c.evidence.confidence?.toFixed(2) ?? "n/a"}</span></figcaption></figure>`;
}

/** A single static page: every claim, its proof, and exactly what a buyer's agent would be told. */
export function renderReport(listing: Listing): string {
  const counts = { visually_verified: 0, broker_declared: 0, unverified: 0, subjective: 0 };
  for (const c of listing.claims) counts[c.provenance]++;
  const agent = visibleFacts(listing, { agentId: null, tier: "anonymous" });
  return `<!doctype html><meta charset="utf-8"><title>Aval evidence report: ${esc(listing.id)}</title>
<style>html{color-scheme:light}body{background:#fff;font:15px/1.45 system-ui,sans-serif;max-width:1180px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.5rem;vertical-align:top;text-align:left}
img{max-width:280px;border-radius:6px;display:block}.b{color:#fff;border-radius:99px;padding:2px 10px;font-size:12px;white-space:nowrap}
.m{color:#666;font-size:12px;margin-top:4px}.k{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}.k div{background:#f4f4f4;border-radius:8px;padding:.6rem 1rem}
.k b{font-size:1.5rem;display:block}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}figure{margin:0}figure img{width:100%;aspect-ratio:9/16;object-fit:contain;background:#111;max-width:100%}figcaption{font-size:12px;margin-top:6px}figcaption span{display:block;color:#666}h2{margin-top:2rem}</style>
<h1>${esc(listing.declared.title)}</h1><p>${esc(listing.declared.commune)} · ${listing.declared.operation} · listing <code>${esc(listing.id)}</code></p>
<div class="k"><div><b>${counts.visually_verified}</b>verified by video</div><div><b>${counts.broker_declared}</b>declared by broker</div><div><b>${counts.unverified}</b>held back</div><div><b>${counts.subjective}</b>never stated</div></div>
<h2>The proof: what the video shows (each box is what SAM 3.1 found)</h2>
<div class="g">${listing.claims.map(card).join("")}</div>
<h2>Every claim, held back first (broker view)</h2>
<table><tr><th>id</th><th>statement</th><th>status</th><th>evidence</th></tr>${[...listing.claims]
    .sort((a, b) => ORDER[a.provenance] - ORDER[b.provenance])
    .filter((c) => c.provenance !== "visually_verified")
    .map(row)
    .join("")}</table>
<h2>What a buyer's agent is told (policy applied)</h2>
<ul>${agent.map((f) => `<li>${esc(f.statement)} <span class="m">— ${esc(f.evidence)}</span></li>`).join("")}</ul>
<p class="m">Exact address ${listing.policy.showExactAddress ? "shared" : "withheld"} · price ${listing.policy.priceVisibility}${listing.policy.priceVisibility === "range" ? ` (±${Math.round(listing.policy.priceRangePct * 100)}%)` : ""} · anonymous agents ${listing.policy.allowAnonymousAgents ? "read-only" : "not served"}.</p>`;
}
