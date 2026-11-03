import type { Claim, Listing } from "./claims/schema.ts";
import { visibleFacts } from "./gateway/policy.ts";
import { CSS, esc, icon, MARK, type Provenance, provBadge } from "./gateway/ui.ts";

const REPORT_CSS = `
.rep-top{border-bottom:1px solid var(--line)}
.rep-top .wrap{display:flex;align-items:center;gap:.7rem;height:56px}
.rep-top .brand{font-size:1.05rem}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem;margin:1.6rem 0 .4rem}
.kpi{padding:.9rem 1rem}.kpi b{display:block;font-size:2rem;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;margin-bottom:.35rem}
.kpi span{font-size:.85rem;color:var(--muted)}
.kpi--v b{color:var(--verified)}.kpi--s b{color:var(--said)}.kpi--h b{color:var(--maybe)}.kpi--n b{color:var(--bad)}
.proofgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:1rem;margin-top:1rem}
.fig{margin:0;overflow:hidden}
.fig .im{aspect-ratio:9/16;background:#050806;display:block}
.fig .im img{width:100%;height:100%;object-fit:contain;display:block}
.fig figcaption{padding:.75rem .85rem .9rem;display:grid;gap:.3rem}
.fig b{font-weight:600;font-size:.93rem;line-height:1.3}
.sec{margin-top:2.6rem}.sec>p{margin:.4rem 0 0}
.held{display:grid;gap:.6rem;margin-top:1rem}
.held article{padding:.8rem 1rem;display:grid;gap:.35rem}
.badge--held{--c:var(--maybe)}.badge--never{--c:var(--bad)}
.told{list-style:none;margin:1rem 0 0;padding:0;display:grid;gap:0}
.told li{display:grid;gap:.2rem;padding:.7rem 0;border-top:1px solid var(--line)}
.told li:first-child{border-top:0}
`;

const HELD: Record<string, { label: string; cls: string; ic: string }> = {
  unverified: { label: "Held back: no evidence", cls: "held", ic: "question" },
  subjective: { label: "Never stated: a taste word", cls: "never", ic: "x" },
};

const badge = (c: Claim): string => {
  if (c.provenance === "unverified" || c.provenance === "subjective") {
    const h = HELD[c.provenance] as { label: string; cls: string; ic: string };
    return `<span class="badge badge--${h.cls}">${icon(h.ic)}${h.label}</span>`;
  }
  return provBadge(c.provenance as Provenance);
};

function figure(c: Claim): string {
  if (c.evidence?.kind !== "visual" || !c.evidence.image) return "";
  return `<figure class="card fig"><a class="im" href="${esc(c.evidence.image)}"><img loading="lazy" src="${esc(c.evidence.image)}" alt="evidence for ${esc(c.id)}"></a><figcaption><b>${esc(c.statement)}</b><span class="mono muted">${esc(c.evidence.concept ?? "")} · ${c.evidence.frames_detected} frames · conf ${c.evidence.confidence?.toFixed(2) ?? "n/a"}</span></figcaption></figure>`;
}

function heldCard(c: Claim): string {
  const ev =
    c.evidence?.kind === "voice"
      ? `<span class="small muted">"${esc(c.evidence.quote ?? "")}" · around ${c.evidence.t_sec?.toFixed(0)}s of the note</span>`
      : c.note
        ? `<span class="small muted">${esc(c.note)}</span>`
        : "";
  return `<article class="card"><div class="res-head"><b>${esc(c.statement)}</b>${badge(c)}</div>${ev}<span class="mono muted">${esc(c.id)}</span></article>`;
}

const ORDER: Record<Claim["provenance"], number> = {
  visually_verified: 0,
  broker_stated: 1,
  unverified: 2,
  subjective: 3,
  broker_declared: 4,
};

/** A single static page: every claim, its proof, and exactly what a buyer's agent would be told. */
export function renderReport(listing: Listing): string {
  const counts = {
    visually_verified: 0,
    broker_stated: 0,
    broker_declared: 0,
    unverified: 0,
    subjective: 0,
  };
  for (const c of listing.claims) counts[c.provenance]++;
  const agent = visibleFacts(listing, { agentId: null, tier: "anonymous" });
  const kpi = (n: number, label: string, cls: string) =>
    `<div class="card kpi kpi--${cls}"><b>${n}</b><span>${label}</span></div>`;
  const others = [...listing.claims]
    .sort((a, b) => ORDER[a.provenance] - ORDER[b.provenance])
    .filter((c) => c.provenance !== "visually_verified");
  const p = listing.policy;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aval evidence report: ${esc(listing.id)}</title><style>${CSS}${REPORT_CSS}</style></head><body>
<header class="rep-top"><div class="wrap"><span class="brand">${MARK}Aval</span><span class="muted small">Evidence report</span></div></header>
<main class="wrap">
<section class="hero" style="padding-bottom:.4rem"><div class="eyebrow">Evidence report</div><h1 style="font-size:clamp(1.8rem,4vw,2.6rem)">${esc(listing.declared.title)}</h1>
<div class="chips" style="margin-top:.9rem"><span class="chip chip--soft">${esc(listing.declared.commune)}</span><span class="chip chip--soft">${listing.declared.operation}</span><span class="chip chip--soft mono">listing ${esc(listing.id)}</span></div>
<div class="kpis">${kpi(counts.visually_verified, "verified by video", "v")}${kpi(counts.broker_stated, "said in voice note", "s")}${kpi(counts.broker_declared, "declared by broker", "d")}${kpi(counts.unverified, "held back", "h")}${kpi(counts.subjective, "never stated", "n")}</div></section>
<section class="sec"><h2>The proof: what the video shows</h2><p class="muted">Each box is what SAM 3.1 found. A claim without a box is not told to anyone.</p>
<div class="proofgrid">${listing.claims.map(figure).join("")}</div></section>
<section class="sec"><h2>Every claim that is not proven by video, held back first</h2><p class="muted">Broker view.</p>
<div class="held">${others.map(heldCard).join("")}</div></section>
<section class="sec"><h2>What a buyer's agent is told</h2><p class="muted">Policy applied: this is the only thing an unidentified agent can learn.</p>
<ul class="told">${agent.map((f) => `<li><span>${esc(f.statement)}</span><span class="small muted">${esc(f.evidence)}</span></li>`).join("")}</ul>
<p class="small muted">Exact address ${p.showExactAddress ? "shared" : "withheld"} · price ${p.priceVisibility}${p.priceVisibility === "range" ? ` (±${Math.round(p.priceRangePct * 100)}%)` : ""} · anonymous agents ${p.allowAnonymousAgents ? "read-only" : "not served"}.</p></section>
</main><footer class="foot"><div class="wrap"><span><b>No evidence, no claim.</b> Every fact here says where it comes from.</span></div></footer></body></html>`;
}
