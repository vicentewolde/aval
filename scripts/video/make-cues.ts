/**
 * The guide for recording by hand: one card per scene with the narration, how long the take should be, what
 * to show and the commands to paste, a timer, and a button that plays that scene's voice so you can follow it.
 *   node scripts/video/make-cues.ts   ->   out/live/cues.html   (open it in Chrome, on a screen you do not record)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CSS, esc } from "../../src/gateway/ui.ts";
import { parseNarration } from "../../src/video/narration.ts";

const LEAD = 0.35;
const TAIL = 0.6;
const BASE = "http://127.0.0.1:8788";

interface Plan {
  live: boolean;
  title: string;
  steps: string[];
  commands: string[];
}

const PLAN: Plan[] = [
  {
    live: false,
    title: "Opening card",
    steps: ["Not recorded by hand: the animated card is already generated. Skip this one."],
    commands: [],
  },
  {
    live: true,
    title: "The evidence",
    steps: [
      "Chrome, dark theme: open the showroom and click three chapters (the table, the TV, the sofa) so the green SAM boxes appear on the video.",
      "Open the evidence report and scroll slowly to the grid of boxes and then to the row of held-back claims.",
    ],
    commands: [`${BASE}/l/demo-1/showroom?theme=dark`, "open .aval/listings/demo-1/report.html"],
  },
  {
    live: true,
    title: "The papers",
    steps: [
      "Before recording, set the blocked review. Then show the terminal with the red BLOCKER lines and the quote.",
      "Optional: open the PDF page next to it. When you finish, put the normal state back.",
    ],
    commands: [
      "node scripts/video/demo-state.ts blocked",
      "node src/cli.ts diligence show demo-1",
      "open fixtures/documents/blocked/01-dominio.pdf",
      "node scripts/video/demo-state.ts attention",
    ],
  },
  {
    live: true,
    title: "The buyer",
    steps: [
      "Chrome, dark theme, full window: type the Spanish request in the search box, show the chips and the result cards.",
      "Open the first home (the one that says demo), click the bathtub chapter (the video jumps and a box appears), ask the question in Spanish, send the contact form with invented data and the consent box ticked.",
      "In the terminal, show the broker's view with leads, then delete the test lead.",
    ],
    commands: [
      `${BASE}/search?theme=dark`,
      "depto para comprar en Ñuñoa, acepta perro, hasta 6 mil UF, con tina",
      "¿Tiene tina?",
      "Camila Soto  /  camila@example.com",
      "node src/cli.ts leads",
      "node src/cli.ts leads delete <lead-id>",
    ],
  },
  {
    live: true,
    title: "The negotiation",
    steps: [
      "Terminal: run the buyer agent and let it finish (about two minutes: it is sped up in the edit). Do not cut it.",
      "Then list the negotiations (the newest is the last line), show the moves, and approve as both people.",
    ],
    commands: [
      'AVAL_BUDGET_USD=8 node src/cli.ts buyer "Negotiate the purchase of demo-1 for Camila: start a negotiation, open near her target, concede in small steps, accept only inside her mandate, then report what was agreed and what still has to happen." --as camila-buyer-agent --url http://127.0.0.1:8788/mcp',
      "node src/cli.ts negotiation list",
      "node src/cli.ts negotiation show <id>",
      "node src/cli.ts negotiation approve <id> --as camila",
      "node src/cli.ts negotiation approve <id> --as broker-perez",
    ],
  },
  {
    live: true,
    title: "The passport",
    steps: [
      "Terminal, quick: verify (VALID), verify the tampered copy (INVALID), prove one fact and verify the proof (VALID). Paste the three lines one after another.",
    ],
    commands: [
      "node src/cli.ts passport verify .aval/listings/demo-1/passport.json",
      "sed 's/Pets allowed/Pets not allowed/' .aval/listings/demo-1/passport.json > /tmp/tampered-passport.json && node src/cli.ts passport verify /tmp/tampered-passport.json",
      "node src/cli.ts passport prove .aval/listings/demo-1/passport.json d-pets > /tmp/proof.json && node src/cli.ts passport verify-proof /tmp/proof.json",
    ],
  },
  {
    live: false,
    title: "The attacks",
    steps: [
      "Not recorded by hand: the slide with the real numbers is already generated. Skip this one.",
    ],
    commands: [],
  },
  {
    live: false,
    title: "Roadmap and end card",
    steps: ["Not recorded by hand: both cards are already generated. Skip this one."],
    commands: [],
  },
];

const scenes = parseNarration(readFileSync("docs/demo-script.md", "utf8"));
const rows = scenes.map((s, i) => {
  const cache = `out/video/audio/scene-${i}-elevenlabs.json`;
  const spoken = existsSync(cache)
    ? (JSON.parse(readFileSync(cache, "utf8")) as { spoken: { durationSec: number } }).spoken
        .durationSec
    : s.narration.split(/\s+/).length / 2.6;
  const target = spoken + LEAD + TAIL;
  const plan = PLAN[i] as Plan;
  return { s, plan, target, audio: `../video/audio/scene-${i}-elevenlabs.mp3` };
});

const card = (
  r: (typeof rows)[number],
  i: number,
) => `<section class="card sc ${r.plan.live ? "" : "skip"}" id="s${i + 1}" data-target="${r.target.toFixed(1)}">
<div class="hd"><div><div class="eyebrow">Scene ${i + 1}${r.plan.live ? "" : " · not recorded by hand"}</div><h2>${esc(r.plan.title)}</h2></div>
<div class="tm"><b class="el">0:00</b><span class="mono muted">of ${r.target.toFixed(0)} s</span></div></div>
<p class="narr">${esc(r.s.narration)}</p>
<ol class="steps">${r.plan.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
${r.plan.commands.length > 0 ? `<div class="cmds">${r.plan.commands.map((c) => `<code>${esc(c)}</code>`).join("")}</div>` : ""}
${r.plan.live ? `<div class="row"><button class="btn go" type="button">Start timer</button><button class="btn btn--ghost say" type="button" data-src="${esc(r.audio)}">Play the voice</button><span class="mono muted">save as out/live/scene-${i + 1}.mov</span></div>` : ""}
</section>`;

const total = rows.reduce((a, r) => a + r.target, 0);
const html = `<!doctype html><html data-theme="dark" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recording guide · Aval</title>
<style>${CSS}
.wrap{max-width:980px;padding-top:2rem;padding-bottom:4rem}.sc{padding:1.3rem 1.5rem;margin:1.2rem 0;display:grid;gap:.9rem}
.sc.skip{opacity:.55}.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.tm{text-align:right;display:grid}.tm b{font:700 2.2rem var(--mono);letter-spacing:-.03em}
.narr{font-size:1.25rem;line-height:1.5;margin:0;padding:.9rem 1.1rem;background:var(--surface-2);border-radius:10px}
.steps{margin:0;padding-left:1.2rem;display:grid;gap:.4rem}.cmds{display:grid;gap:.4rem}
.cmds code{display:block;background:#070d0a;border:1px solid var(--line);border-radius:8px;padding:.55rem .8rem;font:500 .85rem var(--mono);overflow-x:auto;white-space:pre-wrap;word-break:break-all;user-select:all}
.tm.ok b{color:var(--verified)}.tm.warn b{color:var(--maybe)}
</style></head><body><main class="wrap"><div class="eyebrow">Recording guide</div><h1 style="font-size:2.4rem">Scene by scene</h1>
<p class="lead">Record each scene as its own take and save it as <span class="mono">out/live/scene-N.mov</span>. The timing does not have to be exact: the editor fits each take to its narration (it can speed up, slow down a little, and hold the last frame). Aim for the time on each card. The cards that say "not recorded by hand" are already generated.</p>
<p class="muted small">Whole video: about ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}. Before you start: <code class="mono">node scripts/video/demo-state.ts reset</code> and the gateway running on port 8788. Keep this page on a screen you do not record, and record with no microphone.</p>
${rows.map(card).join("")}</main>
<script>(()=>{const fmt=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');let cur=null;
document.querySelectorAll('.sc').forEach(sc=>{const go=sc.querySelector('.go');if(!go)return;const el=sc.querySelector('.el'),tm=sc.querySelector('.tm'),target=+sc.dataset.target;let t0=0,timer=null;
go.addEventListener('click',()=>{if(timer){clearInterval(timer);timer=null;go.textContent='Start timer';return}t0=Date.now();go.textContent='Stop';timer=setInterval(()=>{const s=(Date.now()-t0)/1000;el.textContent=fmt(s);tm.className='tm '+(Math.abs(s-target)<=target*0.15?'ok':s>target*1.15?'warn':'')},200)});
const say=sc.querySelector('.say');say.addEventListener('click',()=>{if(cur){cur.pause();cur=null}const a=new Audio(say.dataset.src);cur=a;a.play().catch(()=>{say.textContent='Voice file not found'})})})})();</script></body></html>`;

mkdirSync("out/live", { recursive: true });
writeFileSync("out/live/cues.html", html);
console.log(`out/live/cues.html (${rows.length} scenes, ${Math.round(total)} s)`);
