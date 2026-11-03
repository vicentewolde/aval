import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import type { Listing } from "../claims/schema.ts";
import { loadPublicReview } from "../diligence/review.ts";
import type { Store } from "../store.ts";
import { MAX_QUESTION_CHARS } from "./answer.ts";
import type { GatewayCore } from "./core.ts";
import { type IntentParser, MAX_REQUEST_CHARS, RuleIntentParser } from "./intent.ts";
import {
  BADGE,
  COLOR,
  esc,
  NOT_FOUND,
  policyLines,
  publicFacts,
  reviewBox,
  STYLE,
} from "./pages.ts";
import { assertMayRead, type Caller } from "./policy.ts";
import { type Criteria, CriteriaSchema, type Match, searchListings } from "./search.ts";

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
}

const EXTRA_STYLE = `
body{max-width:980px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap}
.hero{background:#f6f4ef;border-radius:14px;padding:1.4rem 1.2rem;margin:1rem 0}
.hero input[type=text]{width:100%;font:inherit;padding:.8rem 1rem;border:1px solid #cfc9bb;border-radius:10px;box-sizing:border-box}
.hero button,.btn{background:#1f5e3b;color:#fff;border:0;border-radius:10px;padding:.7rem 1.2rem;font:inherit;cursor:pointer;margin-top:.6rem}
.btn.alt{background:#fff;color:#1f5e3b;border:1px solid #1f5e3b}
.chips{display:flex;flex-wrap:wrap;gap:.4rem;margin:.6rem 0}.chip{background:#e8efe9;border-radius:99px;padding:2px 12px;font-size:14px}
.card{border:1px solid #ddd;border-radius:12px;padding:1rem 1.1rem;margin:1rem 0}
.card h2{margin:.1rem 0 .2rem;font-size:1.2rem}
.pill{border-radius:99px;padding:2px 10px;font-size:12px;color:#fff}.ok{background:#0a7d4b}.maybe{background:#9a6700}.no{background:#b3261e}
.rows{margin:.6rem 0;padding:0;list-style:none}.rows li{padding:.25rem 0;border-bottom:1px solid #eee;font-size:15px}
.ic{display:inline-block;width:1.4em;font-weight:700}
.grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:1.2rem;align-items:start}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
video{width:100%;border-radius:12px;background:#000;max-height:70vh}
.ph{background:#eee;border-radius:12px;padding:3rem 1rem;text-align:center;color:#666}
.chs{display:flex;flex-direction:column;gap:.4rem;max-height:70vh;overflow:auto}
.ch{display:flex;gap:.6rem;align-items:center;text-align:left;border:1px solid #ddd;background:#fff;border-radius:10px;padding:.4rem .6rem;font:inherit;cursor:pointer;width:100%}
.ch.on{border-color:#0a7d4b;background:#eef7f1}.ch .t{font-variant-numeric:tabular-nums;color:#666;min-width:2.6em}
.ch img{width:56px;height:40px;object-fit:cover;border-radius:6px}.ch .s{flex:1;font-size:14px}
.tiles{display:flex;gap:.6rem;flex-wrap:wrap;margin:1rem 0}.tile{background:#f4f4f4;border-radius:10px;padding:.5rem .9rem}.tile b{font-size:1.3rem;display:block}
form.f label{display:block;margin:.5rem 0 .15rem;font-size:14px;color:#444}
form.f input,form.f textarea,form.f select{width:100%;font:inherit;padding:.5rem .6rem;border:1px solid #cfc9bb;border-radius:8px;box-sizing:border-box}
form.f .cb{display:flex;gap:.5rem;align-items:flex-start;margin-top:.6rem;font-size:13px}form.f .cb input{width:auto;margin-top:.2rem}
.ans{background:#f4f4f4;border-radius:10px;padding:.7rem .9rem;margin-top:.6rem;white-space:pre-wrap}.err{color:#b3261e}
.cit{font-size:12px;color:#555;margin:.2rem 0 0;padding-left:1.1rem}
`;

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

const mmss = (t: number): string =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** A readable line per understood criterion, shown to the buyer so a misreading is visible. */
export function describeCriteria(c: Criteria): string[] {
  const out: string[] = [];
  if (c.operation) out.push(c.operation === "sale" ? "to buy" : "to rent");
  if (c.commune) out.push(c.commune);
  if (c.min_bedrooms !== undefined) out.push(`${c.min_bedrooms}+ bedrooms`);
  if (c.min_bathrooms !== undefined) out.push(`${c.min_bathrooms}+ bathrooms`);
  if (c.min_area_m2 !== undefined) out.push(`${c.min_area_m2}+ m2`);
  if (c.max_price)
    out.push(`up to ${c.max_price.currency} ${c.max_price.amount.toLocaleString("en-US")}`);
  if (c.pets_required) out.push("pets allowed");
  for (const m of c.must_have ?? []) out.push(`with ${m}`);
  return out;
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

function criteriaParam(c: Criteria): string {
  return Object.keys(c).length > 0 ? `?c=${encodeURIComponent(JSON.stringify(c))}` : "";
}

const mark = (status: string): string =>
  status === "met"
    ? `<span class="ic" style="color:#0a7d4b">✓</span>`
    : status === "not_met"
      ? `<span class="ic" style="color:#b3261e">✗</span>`
      : `<span class="ic" style="color:#9a6700">?</span>`;

function matchCard(m: Match, criteria: Criteria): string {
  const pill =
    m.fit === "all criteria met"
      ? `<span class="pill ok">all criteria met</span>`
      : `<span class="pill maybe">some unconfirmed</span>`;
  const rows = m.criteria
    .map((c) => {
      const prov = c.basis
        ? ` <span class="b" style="background:${COLOR[c.basis.provenance]}">${BADGE[c.basis.provenance]}</span>`
        : "";
      const note = c.note
        ? ` <span class="m">${esc(c.note)}</span>`
        : c.status === "unconfirmed"
          ? ` <span class="m">no evidence either way</span>`
          : "";
      return `<li>${mark(c.status)}${esc(c.criterion)}${prov}${note}</li>`;
    })
    .join("");
  return `<div class="card"><div class="top"><h2><a href="/l/${esc(m.listing_id)}/showroom${esc(criteriaParam(criteria))}">${esc(m.title)}</a></h2>${pill}</div>
<div class="m">${esc(m.commune)} · ${m.operation === "sale" ? "for sale" : "for rent"}</div>
<ul class="rows">${rows}</ul>
<a class="btn alt" href="/l/${esc(m.listing_id)}/showroom${esc(criteriaParam(criteria))}">Open the showroom</a></div>`;
}

const EXAMPLES = [
  "2 dormitorios en Ñuñoa, acepta perro, hasta UF 6000, con tina",
  "a loft to rent in Providencia, 1 bedroom",
  "house in La Reina with garden and parking",
];

function renderSearch(
  q: string,
  criteria: Criteria,
  results: { matches: Match[]; excluded: Array<{ listing_id: string; reason: string }> },
  communes: string[],
  note: string | null,
): string {
  const chips = describeCriteria(criteria);
  const examples = EXAMPLES.map(
    (e) => `<a class="chip" href="/search?q=${encodeURIComponent(e)}">${esc(e)}</a>`,
  ).join(" ");
  const excluded =
    results.excluded.length > 0
      ? `<details class="box"><summary>${results.excluded.length} left out, with the reason</summary><ul>${results.excluded
          .map((e) => `<li>${esc(e.listing_id)}: ${esc(e.reason)}</li>`)
          .join("")}</ul></details>`
      : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Find a home · Aval</title><meta name="description" content="Search homes where every fact carries its proof.">
<style>${STYLE}${EXTRA_STYLE}</style></head><body>
<div class="top"><h1>Find a home</h1><span class="m"><a href="/listings">All listings</a> · <a href="/.well-known/aval.json">for agents</a></span></div>
<div class="hero"><form method="get" action="/search">
<label for="q"><b>Describe what you are looking for</b> <span class="m">(Spanish or English)</span></label>
<input id="q" type="text" name="q" maxlength="${MAX_REQUEST_CHARS}" value="${esc(q)}" placeholder="${esc(EXAMPLES[0] as string)}" autocomplete="off">
<button type="submit">Search</button>
<details style="margin-top:.8rem"><summary class="m">Or use filters</summary>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin-top:.6rem">
<label class="m">Operation<select name="operation"><option value="">any</option><option value="sale"${criteria.operation === "sale" ? " selected" : ""}>buy</option><option value="rent"${criteria.operation === "rent" ? " selected" : ""}>rent</option></select></label>
<label class="m">District<input type="text" name="commune" list="communes" value="${esc(criteria.commune ?? "")}"></label>
<label class="m">Bedrooms (min)<input type="number" name="beds" min="0" max="10" value="${criteria.min_bedrooms ?? ""}"></label>
<label class="m">Budget (max)<input type="number" name="max" min="1" value="${criteria.max_price?.amount ?? ""}"></label>
<label class="m">Currency<select name="cur"><option>UF</option><option${criteria.max_price?.currency === "CLP" ? " selected" : ""}>CLP</option></select></label>
<label class="m">Must have (comma separated)<input type="text" name="have" value="${esc((criteria.must_have ?? []).join(", "))}"></label>
<label class="m"><input type="checkbox" name="pets" value="1"${criteria.pets_required ? " checked" : ""}> pets allowed</label>
</div><datalist id="communes">${communes.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></details>
</form><div class="chips">${examples}</div></div>
${chips.length > 0 ? `<p><b>I understood:</b></p><div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div><p class="m">A criterion with no evidence is shown as <b>unconfirmed</b>, never as met or missed.${note ? ` ${esc(note)}` : ""}</p>` : ""}
<h2>${results.matches.length} ${results.matches.length === 1 ? "home" : "homes"}</h2>
${results.matches.map((m) => matchCard(m, criteria)).join("") || `<div class="box">No home matches yet. Try fewer requirements.</div>`}
${excluded}
<p class="m">Ranking is deterministic and uses only what each seller allows to be shown. The language model only translates your words into the filters above; it never sees the listings.</p>
</body></html>`;
}

/** The showroom's only script: static text (so its hash is fixed). Everything it shows is set with textContent. */
const SHOWROOM_SCRIPT = `(()=>{
const b=document.body,id=b.dataset.id;let crit;try{crit=b.dataset.criteria?JSON.parse(b.dataset.criteria):undefined}catch(e){}
const v=document.getElementById('v'),chs=[...document.querySelectorAll('.ch[data-t]')];
const mark=el=>{chs.forEach(x=>x.classList.toggle('on',x===el))};
chs.forEach(el=>el.addEventListener('click',()=>{if(!v)return;v.currentTime=parseFloat(el.dataset.t);v.play().catch(()=>{});mark(el);v.scrollIntoView({behavior:'smooth',block:'center'})}));
if(v)v.addEventListener('timeupdate',()=>{let cur=null;for(const el of chs){if(parseFloat(el.dataset.t)<=v.currentTime+0.25)cur=el}const on=document.querySelector('.ch.on');if(cur&&!(on&&on.dataset.t===cur.dataset.t))mark(cur)});
const post=async(path,body)=>{try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,json:await r.json().catch(()=>({}))}}catch(e){return{status:0,json:{}}}};
const LABEL={visually_verified:'verified by video',broker_stated:'said by the broker',broker_declared:'declared by the broker'};
const askF=document.getElementById('ask');
const show=(box,text,cls)=>{box.replaceChildren();const p=document.createElement('div');p.textContent=text;if(cls)p.className=cls;box.appendChild(p);return p};
if(askF)askF.addEventListener('submit',async e=>{e.preventDefault();const box=document.getElementById('answer');const q=askF.q.value.trim();if(!q)return;show(box,'Checking the verified facts...');
const r=await post('/l/'+encodeURIComponent(id)+'/ask',{question:q});
if(r.status!==200){show(box,r.json.message||'Could not answer right now.','err');return}
show(box,r.json.answer);const ul=document.createElement('ul');ul.className='cit';for(const c of r.json.citations||[]){const li=document.createElement('li');li.textContent=(LABEL[c.provenance]||c.provenance)+': '+c.evidence;ul.appendChild(li)}box.appendChild(ul)});
document.querySelectorAll('[data-q]').forEach(el=>el.addEventListener('click',()=>{if(askF){askF.q.value=el.dataset.q;askF.requestSubmit()}}));
const leadF=document.getElementById('lead');
if(leadF)leadF.addEventListener('submit',async e=>{e.preventDefault();const box=document.getElementById('leadout');
const body={name:leadF.name.value,contact:leadF.contact.value,message:leadF.message.value,consent:leadF.consent.checked};
if(leadF.slot&&leadF.slot.value)body.slot=leadF.slot.value;if(crit)body.criteria=crit;
if(!body.consent){show(box,'Please tick the box so the broker may contact you.','err');return}
const r=await post('/l/'+encodeURIComponent(id)+'/lead',body);
if(r.status!==200){show(box,r.json.message||'Could not send right now.','err');return}
const f=r.json.fit||{};const txt=r.json.duplicate?'You already asked about this home; the broker has your details.':'Sent. The broker will contact you.';
show(box,txt);if(f.status==='all_met'||f.status==='some_unconfirmed'){const p=document.createElement('div');p.className='m';p.textContent='What you asked for, met: '+(f.met||[]).length+(f.unconfirmed&&f.unconfirmed.length?'; to confirm with the broker: '+f.unconfirmed.join(', '):'')+'.';box.appendChild(p)}
leadF.reset()});
})();`;
export const SHOWROOM_SCRIPT_HASH = createHash("sha256").update(SHOWROOM_SCRIPT).digest("base64");

function renderShowroom(listing: Listing, store: Store, criteria: Criteria): string {
  const facts = publicFacts(listing) ?? [];
  const dir = store.listingDir(listing.id);
  const mediaOk = listing.policy.publicMedia === true && existsSync(join(dir, "clip.mp4"));
  const byId = new Map(facts.map((f) => [f.id, f]));
  const chapters = listing.claims
    .filter(
      (c) => c.provenance === "visually_verified" && byId.has(c.id) && c.evidence?.t_sec != null,
    )
    .sort((a, b) => (a.evidence?.t_sec ?? 0) - (b.evidence?.t_sec ?? 0));
  const chapterHtml = chapters
    .map((c) => {
      const t = c.evidence?.t_sec ?? 0;
      const img =
        mediaOk &&
        c.evidence?.image &&
        /^evidence\/[A-Za-z0-9_-]+\.(jpg|png)$/.test(c.evidence.image)
          ? `<img loading="lazy" alt="" src="/l/${esc(listing.id)}/${esc(c.evidence.image)}">`
          : "";
      const body = `<span class="t">${mmss(t)}</span>${img}<span class="s">${esc(c.statement)}<br><span class="m">${c.evidence?.frames_detected ?? 0} frames${c.evidence?.confidence != null ? ` · confidence ${c.evidence.confidence.toFixed(2)}` : ""}</span></span><span class="b" style="background:${COLOR.visually_verified}">verified</span>`;
      return mediaOk
        ? `<button type="button" class="ch" data-t="${t}">${body}</button>`
        : `<div class="ch">${body}</div>`;
    })
    .join("");
  const count = (p: string) => facts.filter((f) => f.provenance === p).length;
  const stated = facts.filter((f) => f.provenance === "broker_stated");
  const declared = facts.filter((f) => f.provenance === "broker_declared");
  const fitRows =
    Object.keys(criteria).length > 0
      ? (() => {
          const r = searchListings([listing], PUBLIC, { ...criteria, limit: 1 });
          const m = r.matches[0];
          if (!m)
            return `<div class="box"><b>Your search vs this home</b><p>${esc(r.excluded[0]?.reason ?? "This home does not fit.")}</p></div>`;
          return `<div class="box"><b>Your search vs this home</b><ul class="rows">${m.criteria.map((c) => `<li>${mark(c.status)}${esc(c.criterion)}${c.basis ? ` <span class="b" style="background:${COLOR[c.basis.provenance]}">${BADGE[c.basis.provenance]}</span>` : c.status === "unconfirmed" ? ` <span class="m">no evidence either way: ask the broker</span>` : ""}</li>`).join("")}</ul></div>`;
        })()
      : "";
  const slots = listing.policy.visitSlots;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(listing.declared.title)} · Showroom · Aval</title><meta name="description" content="Walkthrough where every fact carries its proof.">
<style>${STYLE}${EXTRA_STYLE}</style></head>
<body data-id="${esc(listing.id)}" data-criteria="${esc(Object.keys(criteria).length > 0 ? JSON.stringify(criteria) : "")}">
<p class="m"><a href="/search${esc(criteriaParam(criteria))}">← Search</a> · <a href="/l/${esc(listing.id)}">Facts page</a></p>
<h1>${esc(listing.declared.title)}</h1>
<p class="m">${esc(listing.declared.commune)} · ${listing.declared.operation === "sale" ? "for sale" : "for rent"} · <code>${esc(listing.id)}</code></p>
<div class="tiles"><div class="tile"><b>${count("visually_verified")}</b>verified by video</div><div class="tile"><b>${count("broker_stated")}</b>said by the broker</div><div class="tile"><b>${count("broker_declared")}</b>declared by the broker</div></div>
<div class="grid">
<div>${mediaOk ? `<video id="v" controls preload="metadata" playsinline src="/l/${esc(listing.id)}/media/clip.mp4"></video><p class="m">Click a chapter to jump to the moment where each verified fact was found. Facts that could not be found in the video are not shown here.</p>` : `<div class="ph">The seller has not published the walkthrough video. The verified moments are listed on the right.</div>`}</div>
<div><b>Chapters, each one verified</b><div class="chs" style="margin-top:.5rem">${chapterHtml || `<span class="m">No verified moments yet.</span>`}</div></div>
</div>
${fitRows}
${reviewBox(loadPublicReview(dir))}
<div class="grid"><div>
<h2>What the broker said <span class="m">(not independently verified)</span></h2>
<ul class="rows">${[...stated, ...declared].map((f) => `<li>${esc(f.statement)} <span class="b" style="background:${COLOR[f.provenance]}">${BADGE[f.provenance]}</span><br><span class="m">${esc(f.evidence)}</span></li>`).join("") || '<li class="m">Nothing yet.</li>'}</ul>
<div class="box"><b>What the seller's rules mean for you</b><ul>${policyLines(listing)
    .map((l) => `<li>${esc(l)}</li>`)
    .join("")}</ul></div>
</div><div>
<h2>Ask about this home</h2>
<form id="ask" class="f" autocomplete="off"><input name="q" type="text" maxlength="${MAX_QUESTION_CHARS}" placeholder="Does it have a bathtub?" required><button class="btn" type="submit">Ask</button></form>
<div class="chips"><button type="button" class="chip" data-q="Does it have a bathtub?">bathtub?</button><button type="button" class="chip" data-q="Are pets allowed?">pets?</button><button type="button" class="chip" data-q="How much are the common expenses?">common expenses?</button></div>
<div id="answer" aria-live="polite"></div>
<h2>Talk to the broker</h2>
<form id="lead" class="f" autocomplete="off">
<label for="n">Your name</label><input id="n" name="name" maxlength="80" required>
<label for="c">Email or phone</label><input id="c" name="contact" maxlength="120" required>
<label for="m">Message (optional)</label><textarea id="m" name="message" maxlength="500" rows="3"></textarea>
${slots.length > 0 ? `<label for="s">Preferred visit (a human broker confirms)</label><select id="s" name="slot"><option value="">no preference</option>${slots.map((s) => `<option>${esc(s)}</option>`).join("")}</select>` : ""}
<div class="cb"><input id="k" type="checkbox" name="consent"><label for="k" style="margin:0">I agree that the broker contacts me about this home and keeps my details for that purpose. I can ask for them to be deleted.</label></div>
<button class="btn" type="submit">Send to the broker</button>
<p class="m">Demo build: please use invented details.</p>
</form><div id="leadout" aria-live="polite"></div>
<noscript><p class="m">Asking and contacting the broker need JavaScript.</p></noscript>
</div></div>
<p class="m">Signed record: <a href="/l/${esc(listing.id)}/passport.json">passport.json</a> · Facts for agents: <a href="/l/${esc(listing.id)}.json">${esc(listing.id)}.json</a></p>
<script>${SHOWROOM_SCRIPT}</script></body></html>`;
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

export function createBuyerWeb(deps: BuyerWebDeps) {
  const intent = deps.intent ?? new RuleIntentParser();
  const rule = new RuleIntentParser();
  const parses = new Limiter();
  const searches = new Limiter();
  const asks = new Limiter();
  const leads = new Limiter();

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
        criteria = await parser.parse(q, communes);
      }
      criteria = { ...criteria, ...criteriaFromParams(url.searchParams) };
      const r = searchListings(listings, PUBLIC, { ...criteria, limit: 10 });
      sendHtml(
        req,
        res,
        200,
        renderSearch(q, criteria, r, communes, note),
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
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
        else sendJson(res, 200, { answer: r.data.answer, citations: r.data.citations });
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
      sendHtml(
        req,
        res,
        200,
        renderShowroom(listing, deps.store, criteria),
        `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; script-src 'sha256-${SHOWROOM_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
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
