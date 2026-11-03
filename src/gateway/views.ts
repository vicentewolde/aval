import type { Listing } from "../claims/schema.ts";
import { MAX_QUESTION_CHARS } from "./answer.ts";
import { policyLines } from "./pages.ts";
import type { VisibleFact } from "./policy.ts";
import type { Match } from "./search.ts";
import { type Criteria } from "./search.ts";
import {
  esc,
  icon,
  type Provenance,
  proofMeter,
  provBadge,
  sha256b64,
  shell,
  statusIcon,
  type Theme,
} from "./ui.ts";

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

export function criteriaParam(c: Criteria): string {
  return Object.keys(c).length > 0 ? `?c=${encodeURIComponent(JSON.stringify(c))}` : "";
}

const mmss = (t: number): string =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const EXAMPLES = [
  "2 dormitorios en Ñuñoa, acepta perro, hasta UF 6000, con tina",
  "a loft to rent in Providencia, 1 bedroom",
  "house in La Reina with garden and parking",
];

// ---------------------------------------------------------------- search

export interface ResultExtras {
  /** A verified evidence frame to show as the cover, when the seller publishes its media. */
  cover: string | null;
  proof: { verified: number; said: number; declared: number };
}

/** The search page's only script: static text, so its hash is fixed. It posts the alert form as JSON. */
const SEARCH_SCRIPT = `(()=>{
const f=document.getElementById('alert');if(!f)return;
const box=document.getElementById('alertout');
const show=(t,c)=>{box.replaceChildren();const p=document.createElement('div');p.textContent=t;if(c)p.className=c;box.appendChild(p)};
f.addEventListener('submit',async e=>{e.preventDefault();
if(!f.consent.checked){show('Please tick the box so we may contact you.','err');return}
let criteria;try{criteria=JSON.parse(document.body.dataset.criteria||'{}')}catch(x){criteria={}}
const body={contact:f.contact.value,consent:true,criteria,text:document.body.dataset.q||''};if(f.name.value)body.name=f.name.value;
let r;try{const res=await fetch('/alerts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});r={status:res.status,json:await res.json().catch(()=>({}))}}catch(x){r={status:0,json:{}}}
if(r.status!==200){show(r.json.message||'Could not save the alert right now.','err');return}
show(r.json.duplicate?'You already have this alert.':'Saved. You will be told when a new home that fits appears.','ok');f.reset()});
})();`;
export const SEARCH_SCRIPT_HASH = sha256b64(SEARCH_SCRIPT);

function alertPanel(criteria: Criteria): string {
  if (Object.keys(criteria).filter((k) => k !== "limit").length === 0) return "";
  return `<section class="panel" aria-labelledby="alert-h"><h3 id="alert-h">${icon("bell")} Tell me when a new home like this appears</h3>
<p class="muted small" style="margin:0">Only homes that appear after you save are matched. For now the broker sends the notice. Demo build: use invented details.</p>
<form id="alert" autocomplete="off"><div class="field"><label for="ac">Email or phone</label><input id="ac" type="text" name="contact" maxlength="120" required></div>
<div class="field"><label for="an">Your name (optional)</label><input id="an" type="text" name="name" maxlength="80"></div>
<label class="consent"><input id="ak" type="checkbox" name="consent"><span>I agree to be contacted about homes that fit this search and that my details are kept for that purpose. I can ask for them to be deleted.</span></label>
<button class="btn" type="submit">Save this search</button></form><div id="alertout" class="out" aria-live="polite"></div></section>`;
}

function resultCard(m: Match, criteria: Criteria, x: ResultExtras | undefined): string {
  const href = `/l/${esc(m.listing_id)}/showroom${esc(criteriaParam(criteria))}`;
  const allMet = m.fit === "all criteria met";
  const rows = m.criteria
    .map((c) => {
      const prov = c.basis ? provBadge(c.basis.provenance) : "";
      const why = c.note
        ? `<span class="why">${esc(c.note)}</span>`
        : c.status === "unconfirmed"
          ? `<span class="why">No evidence either way. Ask the broker.</span>`
          : "";
      return `<li>${statusIcon(c.status)}<span>${esc(c.criterion)}</span>${prov}${why}</li>`;
    })
    .join("");
  const p = x?.proof ?? { verified: 0, said: 0, declared: 0 };
  return `<article class="card res"><a class="thumb" href="${href}" tabindex="-1" aria-hidden="true">${
    x?.cover
      ? `<img loading="lazy" alt="" src="${esc(x.cover)}">`
      : `<span class="ph">${icon("video")}No walkthrough published</span>`
  }</a><div class="res-body">
<div class="res-head"><div><h2><a href="${href}">${esc(m.title)}</a></h2><div class="muted small">${esc(m.commune)} · ${m.operation === "sale" ? "for sale" : "for rent"}</div></div>
<span class="fit${allMet ? "" : " fit--maybe"}">${allMet ? "All criteria met" : "Some unconfirmed"}</span></div>
<div>${proofMeter(p.verified, p.said, p.declared)}<div class="muted small" style="margin-top:.35rem"><b style="color:var(--verified)">${p.verified}</b> verified in video · ${p.said} said · ${p.declared} declared</div></div>
<ul class="crit">${rows}</ul>
<div class="res-foot"><a class="btn btn--sm" href="${href}">Open the showroom ${icon("arrow")}</a></div></div></article>`;
}

export interface SearchView {
  q: string;
  criteria: Criteria;
  matches: Match[];
  excluded: Array<{ listing_id: string; reason: string }>;
  communes: string[];
  note: string | null;
  extras: Map<string, ResultExtras>;
  url: URL;
  theme: Theme | null;
}

export function renderSearch(v: SearchView): string {
  const chips = describeCriteria(v.criteria);
  const c = v.criteria;
  const examples = EXAMPLES.map(
    (e) => `<a class="chip" href="/search?q=${encodeURIComponent(e)}">${esc(e)}</a>`,
  ).join("");
  const filters = `<details style="margin-top:.9rem;max-width:780px"><summary class="muted small" style="cursor:pointer">Or use filters</summary>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin-top:.7rem">
<div class="field"><label for="f-op">Operation</label><select id="f-op" name="operation"><option value="">any</option><option value="sale"${c.operation === "sale" ? " selected" : ""}>buy</option><option value="rent"${c.operation === "rent" ? " selected" : ""}>rent</option></select></div>
<div class="field"><label for="f-co">District</label><input id="f-co" type="text" name="commune" list="communes" value="${esc(c.commune ?? "")}"></div>
<div class="field"><label for="f-be">Bedrooms (min)</label><input id="f-be" type="number" name="beds" min="0" max="10" value="${c.min_bedrooms ?? ""}"></div>
<div class="field"><label for="f-mx">Budget (max)</label><input id="f-mx" type="number" name="max" min="1" value="${c.max_price?.amount ?? ""}"></div>
<div class="field"><label for="f-cu">Currency</label><select id="f-cu" name="cur"><option>UF</option><option${c.max_price?.currency === "CLP" ? " selected" : ""}>CLP</option></select></div>
<div class="field"><label for="f-hv">Must have (comma separated)</label><input id="f-hv" type="text" name="have" value="${esc((c.must_have ?? []).join(", "))}"></div>
<label class="consent" style="margin:1.9rem 0 0"><input type="checkbox" name="pets" value="1"${c.pets_required ? " checked" : ""}><span>Pets allowed</span></label>
</div><datalist id="communes">${v.communes.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></details>`;
  const excluded =
    v.excluded.length > 0
      ? `<details class="panel"><summary class="muted" style="cursor:pointer">${v.excluded.length} left out, with the reason</summary><ul class="mapped small" style="margin-top:.7rem">${v.excluded.map((e) => `<li><span class="mono">${esc(e.listing_id)}</span> ${esc(e.reason)}</li>`).join("")}</ul></details>`
      : "";
  const body = `<main class="wrap">
<section class="hero"><div class="eyebrow">Verified listings</div>
<h1>Find a home you can verify.</h1>
<p class="lead">Describe it in Spanish or English. Every result shows what is proven, what was only said, and what nobody has checked.</p>
<form method="get" action="/search" role="search"><div class="searchbar">${icon("search")}<label for="q" class="muted" style="position:absolute;left:-9999px">Describe the home you want</label>
<input id="q" type="text" name="q" maxlength="300" value="${esc(v.q)}" placeholder="${esc(EXAMPLES[0] as string)}" autocomplete="off"><button class="btn" type="submit">Search</button></div>${filters}</form>
<div class="chips" style="margin-top:1rem">${examples}</div></section>
${
  chips.length > 0
    ? `<div class="understood"><span class="eyebrow">Understood as</span>${chips.map((x) => `<span class="chip chip--soft">${esc(x)}</span>`).join("")}</div><p class="muted small" style="margin:.2rem 0 0">A criterion with no evidence reads <b>unconfirmed</b>, never met or missed.${v.note ? ` ${esc(v.note)}` : ""}</p>`
    : ""
}
<div class="results" aria-label="Results"><h2 class="muted" style="font-size:1rem;font-weight:600;margin-top:.8rem">${v.matches.length} ${v.matches.length === 1 ? "home" : "homes"}</h2>
${v.matches.map((m) => resultCard(m, v.criteria, v.extras.get(m.listing_id))).join("") || `<div class="panel">No home matches yet. Try fewer requirements.</div>`}</div>
<div class="stack">${excluded}${alertPanel(v.criteria)}</div>
<p class="muted small" style="margin-top:1.4rem">Ranking is deterministic and uses only what each seller allows to be shown. The language model only translates your words into the filters above; it never sees the listings.</p>
</main>`;
  return shell({
    title: "Find a home · Aval",
    description: "Search homes where every fact carries its proof.",
    body,
    active: "search",
    theme: v.theme,
    url: v.url,
    bodyAttrs: `data-q="${esc(v.q)}" data-criteria="${esc(JSON.stringify(v.criteria))}"`,
    script: SEARCH_SCRIPT,
  });
}

// ---------------------------------------------------------------- showroom

/** The showroom's only script: static text (so its hash is fixed). Everything it shows is set with textContent. */
const SHOWROOM_SCRIPT = `(()=>{
const b=document.body,id=b.dataset.id;let crit;try{crit=b.dataset.criteria?JSON.parse(b.dataset.criteria):undefined}catch(e){}
const v=document.getElementById('v'),chs=[...document.querySelectorAll('.ch[data-t]')];
const det=document.getElementById('det'),track=document.getElementById('track'),fill=document.getElementById('fill'),head=document.getElementById('head'),clock=document.getElementById('clock');
const fmt=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
let dur=0,ticks=[],locked=null;
const mark=el=>{chs.forEach(x=>x.classList.toggle('on',x===el));ticks.forEach((t,i)=>t.classList.toggle('on',chs[i]===el))};
const seek=(t,el)=>{if(!v)return;v.currentTime=t;v.play().catch(()=>{});locked=el;mark(el)};
function build(){if(!v||!track||dur<=0)return;ticks.forEach(t=>t.remove());ticks=chs.map(el=>{const t=document.createElement('button');t.type='button';t.className='tick';t.style.left=(parseFloat(el.dataset.t)/dur*100)+'%';t.setAttribute('aria-label','Jump to '+el.dataset.label);t.title=fmt(parseFloat(el.dataset.t))+' '+el.dataset.label;t.addEventListener('click',e=>{e.stopPropagation();seek(parseFloat(el.dataset.t),el)});track.appendChild(t);return t})}
if(v){let start=parseFloat(new URLSearchParams(location.search).get('t'));const meta=()=>{dur=v.duration||Math.max(...chs.map(c=>parseFloat(c.dataset.t)),0)+5;build();clock.textContent='0:00 / '+fmt(dur);if(isFinite(start)&&start>=0&&start<dur){if(det)det.style.transition='none';v.currentTime=start;start=NaN}};v.addEventListener('loadedmetadata',meta);if(v.readyState>=1)meta()}
chs.forEach(el=>el.addEventListener('click',()=>{seek(parseFloat(el.dataset.t),el);v&&v.scrollIntoView({behavior:'smooth',block:'center'})}));
if(track)track.addEventListener('click',e=>{if(!v||!dur)return;const r=track.getBoundingClientRect();v.currentTime=Math.max(0,Math.min(dur,(e.clientX-r.left)/r.width*dur));locked=null});
const box=el=>{if(!det||!el||!el.dataset.box){if(det)det.classList.remove('on');return}
const [x1,y1,x2,y2]=el.dataset.box.split(',').map(Number),W=+el.dataset.fw,H=+el.dataset.fh;
det.style.left=(x1/W*100)+'%';det.style.top=(y1/H*100)+'%';det.style.width=((x2-x1)/W*100)+'%';det.style.height=((y2-y1)/H*100)+'%';
det.firstChild.textContent=el.dataset.concept?'SAM 3.1 · '+el.dataset.concept+' · '+el.dataset.conf:'SAM 3.1';det.classList.add('on');
det.firstChild.style.bottom='';det.firstChild.style.top='';if(y1/H<0.1){det.firstChild.style.bottom='auto';det.firstChild.style.top='100%';det.firstChild.style.margin='6px 0 0'}else{det.firstChild.style.margin='0 0 6px'}}
if(v)v.addEventListener('timeupdate',()=>{const t=v.currentTime;if(dur>0){fill.style.width=(t/dur*100)+'%';head.style.left=(t/dur*100)+'%';clock.textContent=fmt(t)+' / '+fmt(dur)}
let near=null,best=1.6;for(const el of chs){const d=Math.abs(parseFloat(el.dataset.t)-t);if(d<=best){best=d;near=el}}
if(locked&&Math.abs(parseFloat(locked.dataset.t)-t)<=1.6)near=locked;else locked=null;
mark(near);box(near)});
if(v)v.addEventListener('pause',()=>{});
const post=async(path,body)=>{try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,json:await r.json().catch(()=>({}))}}catch(e){return{status:0,json:{}}}};
const LABEL={visually_verified:'Verified in video',broker_stated:'Said by the broker',broker_declared:'Declared by the broker'};
const show=(box,text,cls)=>{box.replaceChildren();const p=document.createElement('p');p.textContent=text;if(cls)p.className=cls;box.appendChild(p);return p};
const askF=document.getElementById('ask');
if(askF)askF.addEventListener('submit',async e=>{e.preventDefault();const out=document.getElementById('answer');const q=askF.q.value.trim();if(!q)return;out.className='answer';show(out,'Checking the verified facts...','muted');
const r=await post('/l/'+encodeURIComponent(id)+'/ask',{question:q});
if(r.status!==200){show(out,r.json.message||'Could not answer right now.','err');return}
const tr=r.json.translation;if(tr&&tr.text){show(out,tr.text);const o=document.createElement('p');o.className='small muted';o.textContent='Verified wording (English): '+r.json.answer+' · The Spanish is an automatic translation of that.';out.appendChild(o)}else{show(out,r.json.answer)}
const ul=document.createElement('ul');ul.className='cit';for(const c of r.json.citations||[]){const li=document.createElement('li');li.textContent=(LABEL[c.provenance]||c.provenance)+': '+c.evidence;ul.appendChild(li)}out.appendChild(ul)});
document.querySelectorAll('[data-q]').forEach(el=>el.addEventListener('click',()=>{if(askF){askF.q.value=el.dataset.q;askF.requestSubmit()}}));
const leadF=document.getElementById('lead');
if(leadF)leadF.addEventListener('submit',async e=>{e.preventDefault();const out=document.getElementById('leadout');
const body={name:leadF.name.value,contact:leadF.contact.value,message:leadF.message.value,consent:leadF.consent.checked};
if(leadF.slot&&leadF.slot.value)body.slot=leadF.slot.value;if(crit)body.criteria=crit;
if(!body.consent){show(out,'Please tick the box so the broker may contact you.','err');return}
const r=await post('/l/'+encodeURIComponent(id)+'/lead',body);
if(r.status!==200){show(out,r.json.message||'Could not send right now.','err');return}
const f=r.json.fit||{};show(out,r.json.duplicate?'You already asked about this home; the broker has your details.':'Sent. The broker will contact you.','ok');
if(f.status==='all_met'||f.status==='some_unconfirmed'){const p=document.createElement('p');p.className='small muted';p.textContent='What you asked for, met: '+(f.met||[]).length+(f.unconfirmed&&f.unconfirmed.length?'; to confirm with the broker: '+f.unconfirmed.join(', '):'')+'.';out.appendChild(p)}
leadF.reset()});
})();`;
export const SHOWROOM_SCRIPT_HASH = sha256b64(SHOWROOM_SCRIPT);

export interface ShowroomView {
  listing: Listing;
  facts: VisibleFact[];
  criteria: Criteria;
  mediaOk: boolean;
  fit: Match | null;
  fitExcluded: string | null;
  docs: string;
  url: URL;
  theme: Theme | null;
}

export function renderShowroom(v: ShowroomView): string {
  const l = v.listing;
  const byId = new Map(v.facts.map((f) => [f.id, f]));
  const chapters = l.claims
    .filter(
      (c) => c.provenance === "visually_verified" && byId.has(c.id) && c.evidence?.t_sec != null,
    )
    .sort((a, b) => (a.evidence?.t_sec ?? 0) - (b.evidence?.t_sec ?? 0));
  const frame = chapters.find((c) => c.evidence?.box)?.evidence?.box;
  const fw = frame?.w ?? 1280;
  const fh = frame?.h ?? 720;
  const count = (p: Provenance) => v.facts.filter((f) => f.provenance === p).length;
  const chapterHtml = chapters
    .map((c) => {
      const e = c.evidence;
      const t = e?.t_sec ?? 0;
      const img =
        v.mediaOk && e?.image && /^evidence\/[A-Za-z0-9_-]+\.(jpg|png)$/.test(e.image)
          ? `<img loading="lazy" alt="" src="/l/${esc(l.id)}/${esc(e.image)}">`
          : `<span>${mmss(t)}</span>`;
      const boxAttr = e?.box
        ? ` data-box="${e.box.x1},${e.box.y1},${e.box.x2},${e.box.y2}" data-fw="${e.box.w}" data-fh="${e.box.h}"`
        : "";
      const attrs = `data-t="${t}" data-label="${esc(c.statement)}" data-concept="${esc(e?.concept ?? "")}" data-conf="${e?.confidence != null ? e.confidence.toFixed(2) : ""}"${boxAttr}`;
      const inner = `<span class="th">${img}</span><span class="tx"><b>${esc(c.statement)}</b><span class="mono">${e?.frames_detected ?? 0} frames${e?.confidence != null ? ` · conf ${e.confidence.toFixed(2)}` : ""}</span></span><span class="tm">${mmss(t)}</span>`;
      return v.mediaOk
        ? `<button type="button" class="ch" ${attrs}>${inner}</button>`
        : `<div class="ch" data-label="${esc(c.statement)}">${inner}</div>`;
    })
    .join("");
  const stated = v.facts.filter((f) => f.provenance !== "visually_verified");
  const fitPanel = v.fit
    ? `<section class="panel" aria-labelledby="fit-h"><h2 id="fit-h">Your search vs this home</h2><ul class="crit">${v.fit.criteria.map((c) => `<li>${statusIcon(c.status)}<span>${esc(c.criterion)}</span>${c.basis ? provBadge(c.basis.provenance) : ""}${c.status === "unconfirmed" ? `<span class="why">No evidence either way. Ask the broker.</span>` : ""}</li>`).join("")}</ul></section>`
    : v.fitExcluded
      ? `<section class="panel"><h2>Your search vs this home</h2><p class="muted">${esc(v.fitExcluded)}</p></section>`
      : "";
  const slots = l.policy.visitSlots;
  const video = v.mediaOk
    ? `<div class="stagewrap"><div class="stage" style="--ar:${fw}/${fh};--arn:${(fw / fh).toFixed(4)}"><video id="v" controls preload="metadata" playsinline src="/l/${esc(l.id)}/media/clip.mp4#t=0.5"></video><div class="det" id="det"><span></span></div></div>
<div class="track" id="track" aria-label="Proof timeline: each mark is a verified fact"><div class="fill" id="fill"></div><div class="head" id="head"></div></div>
<div class="stagecap"><span>Green boxes appear where SAM 3.1 found a verified fact</span><span id="clock">0:00</span></div></div>`
    : `<div class="ph">${icon("video")}<p style="margin:.6rem 0 0">The seller has not published the walkthrough video. The verified moments are listed on the right.</p></div>`;
  const body = `<main class="wrap">
<div class="titlebar"><div><div class="crumbs"><a href="/search${esc(criteriaParam(v.criteria))}">Search</a> / <a href="/l/${esc(l.id)}">Facts page</a> / Showroom</div>
<h1 style="font-size:clamp(1.7rem,3.6vw,2.4rem)">${esc(l.declared.title)}</h1>
<div class="chips" style="margin-top:.8rem"><span class="chip chip--soft">${esc(l.declared.commune)}</span><span class="chip chip--soft">${l.declared.operation === "sale" ? "For sale" : "For rent"}</span><span class="chip chip--soft mono">${esc(l.id)}</span></div></div>
<div><div style="min-width:240px">${proofMeter(count("visually_verified"), count("broker_stated"), count("broker_declared"))}</div>
<div class="legend" style="margin-top:.5rem"><span><b style="color:var(--verified)">${count("visually_verified")}</b>verified in video</span><span><b>${count("broker_stated")}</b>said</span><span><b>${count("broker_declared")}</b>declared</span></div></div></div>
<section class="theater"><div>${video}</div>
<div><h2 style="margin-bottom:.7rem">${icon("shield")} Chapters, each one verified</h2><div class="chapters">${chapterHtml || `<span class="muted">No verified moments yet.</span>`}</div></div></section>
<div class="cols"><div class="stack">${fitPanel}${v.docs}
<section class="panel" aria-labelledby="said-h"><h2 id="said-h">What the broker said</h2><p class="muted small" style="margin:0 0 .4rem">Not independently verified.</p>
<ul class="said">${stated.map((f) => `<li><span>${esc(f.statement)}</span><span>${provBadge(f.provenance as Provenance)}</span><span class="q">${esc(f.evidence)}</span></li>`).join("") || `<li class="muted">Nothing yet.</li>`}</ul></section>
<section class="panel"><h2>What the seller's rules mean for you</h2><ul class="mapped small">${policyLines(
    l,
  )
    .map((x) => `<li>${esc(x)}</li>`)
    .join("")}</ul></section></div>
<div class="stack"><section class="panel" aria-labelledby="ask-h"><h2 id="ask-h">${icon("chat")} Ask about this home</h2>
<form id="ask" autocomplete="off"><div class="field"><label for="aq">Your question, in Spanish or English</label><input id="aq" type="text" name="q" maxlength="${MAX_QUESTION_CHARS}" placeholder="¿Tiene tina?" required></div><button class="btn" type="submit">Ask</button></form>
<div class="chips" style="margin-top:.8rem"><button type="button" class="chip" data-q="Does it have a bathtub?">bathtub?</button><button type="button" class="chip" data-q="Are pets allowed?">pets?</button><button type="button" class="chip" data-q="How much are the common expenses?">common expenses?</button></div>
<div id="answer" aria-live="polite"></div></section>
<section class="panel" aria-labelledby="lead-h"><h2 id="lead-h">${icon("mail")} Talk to the broker</h2>
<form id="lead" autocomplete="off"><div class="field"><label for="n">Your name</label><input id="n" type="text" name="name" maxlength="80" required></div>
<div class="field"><label for="c">Email or phone</label><input id="c" type="text" name="contact" maxlength="120" required></div>
<div class="field"><label for="m">Message (optional)</label><textarea id="m" name="message" maxlength="500" rows="3"></textarea></div>
${slots.length > 0 ? `<div class="field"><label for="s">Preferred visit (a human broker confirms)</label><select id="s" name="slot"><option value="">no preference</option>${slots.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>` : ""}
<label class="consent"><input id="k" type="checkbox" name="consent"><span>I agree that the broker contacts me about this home and keeps my details for that purpose. I can ask for them to be deleted.</span></label>
<button class="btn" type="submit">Send to the broker</button><p class="muted small" style="margin:.7rem 0 0">Demo build: please use invented details.</p></form>
<div id="leadout" class="out" aria-live="polite"></div><noscript><p class="muted small">Asking and contacting the broker need JavaScript.</p></noscript></section>
<p class="muted small">Signed record: <a href="/l/${esc(l.id)}/passport.json">passport.json</a> · Facts for agents: <a href="/l/${esc(l.id)}.json">${esc(l.id)}.json</a></p></div></div>
</main>`;
  return shell({
    title: `${l.declared.title} · Showroom · Aval`,
    description: "Walkthrough where every fact carries its proof.",
    body,
    active: "search",
    theme: v.theme,
    url: v.url,
    bodyAttrs: `data-id="${esc(l.id)}" data-criteria="${esc(Object.keys(v.criteria).length > 0 ? JSON.stringify(v.criteria) : "")}"`,
    script: SHOWROOM_SCRIPT,
  });
}
