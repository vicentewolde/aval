import { CSS, esc, icon, MARK } from "../gateway/ui.ts";

/**
 * HTML for the parts of the video that are not the product's own pages: a terminal that reveals real
 * command output, the captions (transparent, laid over the video), and a few slides drawn with the same
 * design system. Everything is dark, like the pages recorded for the video.
 */
const BASE = `${CSS}
html,body{margin:0;height:100%;overflow:hidden}
body{display:flex;align-items:center;justify-content:center}
.stagebox{width:100%;height:100%;padding:64px 90px 150px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center}
.t-red{color:#ff7d72}.t-green{color:#3fdc9a}.t-yellow{color:#f0b94e}.t-blue{color:#82aaff}.t-cyan{color:#5cd6e6}.t-bold{font-weight:700}.t-dim{opacity:.55}
`;

const doc = (body: string, extra = ""): string =>
  `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${BASE}${extra}</style></head><body>${body}</body></html>`;

/** A terminal window showing the lines revealed so far. `lines` are already HTML (see ansiToHtml). */
export function terminalPage(title: string, lines: string[], cursor = true): string {
  const body = `<div class="stagebox"><div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(title)}</span></div>
<pre>${lines.join("\n")}${cursor ? '<span class="cur"></span>' : ""}</pre></div></div>`;
  return doc(
    body,
    `.win{background:#070d0a;border:1px solid #22322c;border-radius:16px;box-shadow:0 30px 80px -30px rgba(0,0,0,.8);overflow:hidden;width:100%}
.bar{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #1a2823;background:#0c1511}
.bar i{width:13px;height:13px;border-radius:50%;background:#2a3b34;display:block}.bar span{margin-left:12px;font:500 15px var(--mono);color:#7d9189}
pre{margin:0;padding:22px 28px 26px;font:500 17px/1.45 var(--mono);color:#dbe7e2;white-space:pre-wrap;word-break:break-word;height:462px;overflow:hidden}
.cur{display:inline-block;width:.6em;height:1.1em;background:#3fdc9a;vertical-align:-.2em;margin-left:2px}
.p{color:#3fdc9a}`,
  );
}

/** The caption band (and an optional note) over a transparent page, one image per caption state. */
export function captionPage(lines: string[], note?: string): string {
  const text = lines.map((l) => `<div>${esc(l)}</div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.cap{position:absolute;left:0;right:0;bottom:62px;display:flex;justify-content:center}
.cap .box{background:rgba(4,8,6,.78);color:#fff;border-radius:14px;padding:14px 30px 16px;font-size:40px;line-height:1.28;font-weight:600;text-align:center;letter-spacing:-.005em;text-shadow:0 2px 8px rgba(0,0,0,.6);max-width:1560px}
.note{position:absolute;left:46px;top:40px;background:rgba(4,8,6,.8);color:#cfe6dc;border:1px solid rgba(63,220,154,.45);border-radius:10px;padding:9px 16px;font:600 22px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.01em}
</style></head><body>${note ? `<div class="note">${esc(note)}</div>` : ""}${lines.length > 0 ? `<div class="cap"><div class="box">${text}</div></div>` : ""}</body></html>`;
}

export interface QuoteRow {
  quote: string;
  claim: string;
}
/** The broker's voice note: each Spanish quote next to the claim it supports. */
export function quotesPage(rows: QuoteRow[], header: string): string {
  const items = rows
    .map(
      (r) =>
        `<li><span class="q">"${esc(r.quote)}"</span><span class="a">${icon("arrow")}</span><span class="c">${esc(r.claim)}</span></li>`,
    )
    .join("");
  return doc(
    `<div class="stagebox"><div class="eyebrow">${icon("mic")} Voice note, in Spanish</div><h1 style="font-size:46px;margin:.3em 0 .45em">${esc(header)}</h1><ul class="qs">${items}</ul>
<p class="muted" style="font-size:19px;margin:.9em 0 0">A claim is kept only if the quote is really in the transcript and its numbers match. A secret the broker asks to keep is never stored.</p></div>`,
    `.qs{list-style:none;margin:0;padding:0;display:grid;gap:9px}
.qs li{display:grid;grid-template-columns:minmax(0,1.1fr) 36px minmax(0,1fr);gap:18px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 20px}
.q{font:500 19px var(--mono);color:var(--said)}.c{font-size:21px;font-weight:600}.a{color:var(--verified)}.a .i{width:28px;height:28px}`,
  );
}

/** A PDF page next to the finding the rules drew from it, with the page and the exact quote. */
export function documentPage(
  pdfPngDataUri: string,
  rule: string,
  message: string,
  quotes: string[],
  page: number,
): string {
  return doc(
    `<div class="stagebox"><div class="dg"><div class="pdf"><img alt="certificate page" src="${pdfPngDataUri}"><span class="stamp">Invented document</span></div>
<div><div class="eyebrow">${icon("doc")} Title review</div><h1 style="font-size:44px;margin:.4em 0 .3em;color:var(--bad)">${esc(rule)}</h1><p style="font-size:26px;line-height:1.4;margin:0 0 1em">${esc(message)}</p>
${quotes.map((q) => `<div class="qt"><span class="mono">certificate, page ${page}</span><b>"${esc(q)}"</b></div>`).join("")}
<p class="muted" style="font-size:21px;margin:1.2em 0 0">A field counts only if its words are on that page of the PDF. The agent is told the rule that fired, never the names. Not legal advice.</p></div></div></div>`,
    `.dg{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:56px;align-items:center}
.pdf{position:relative;border-radius:10px;overflow:hidden;box-shadow:0 30px 70px -30px #000;max-height:880px;display:flex;justify-content:center;background:#fff}
.pdf img{width:100%;height:auto;max-height:880px;object-fit:contain;display:block}
.stamp{position:absolute;right:14px;top:14px;background:#b3261e;color:#fff;font:700 15px var(--mono);padding:6px 12px;border-radius:6px;letter-spacing:.06em;text-transform:uppercase}
.qt{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--bad);border-radius:10px;padding:14px 20px;margin:10px 0;display:grid;gap:4px}.qt b{font-size:25px;font-weight:600}`,
  );
}

/** Two sealed limits: neither agent ever sees the other's. */
export function mandatesPage(): string {
  return doc(
    `<div class="stagebox"><div class="eyebrow">${icon("shield")} Negotiation under signed mandates</div><h1 style="font-size:48px;margin:.3em 0 .7em">Each agent has a limit its human signed.</h1>
<div class="mg"><div class="m"><div class="eyebrow">Camila's agent</div><b>Maximum</b><span class="lock">${icon("shield")} never shown to the seller</span></div>
<div class="vs">vs</div><div class="m"><div class="eyebrow">The broker's agent</div><b>Floor</b><span class="lock">${icon("shield")} never shown to the buyer</span></div></div>
<p class="muted" style="font-size:26px;margin:1.2em 0 0;max-width:1200px">The engine, not the model, rejects anything outside authority. The text channel cannot carry a number. The result is a non-binding term sheet that both humans must sign.</p></div>`,
    `.mg{display:grid;grid-template-columns:1fr 70px 1fr;gap:20px;align-items:center}
.m{background:var(--surface);border:1px solid var(--line-strong);border-radius:18px;padding:26px 34px;display:grid;gap:12px}
.m b{font-size:52px;letter-spacing:-.03em}.lock{display:flex;gap:10px;align-items:center;font-size:24px;color:var(--verified)}
.vs{text-align:center;font:600 22px var(--mono);color:var(--muted)}`,
  );
}

export interface RedTeam {
  baseline: number;
  aval: number;
  trials: number;
  checks: number;
  passed: number;
  categories: Array<{ name: string; total: number; passed: number }>;
}
/** The red-team numbers as bars that grow (animated with CSS so any frame can be captured). */
export function redTeamPage(r: RedTeam): string {
  const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
  const rows = r.categories
    .map(
      (c) =>
        `<div class="cr"><span>${esc(c.name)}</span><div class="bar2"><i class="grow g" style="--w:${pct(c.passed, c.total)}"></i></div><b>${c.passed}/${c.total}</b></div>`,
    )
    .join("");
  return doc(
    `<div class="stagebox"><div class="eyebrow">${icon("shield")} We attacked it</div>
<div class="rt"><div><h2 style="font-size:34px;margin:0 0 .8em">Against the real model, ${r.trials} attacks</h2>
<div class="big"><span>Typical listing chatbot</span><div class="bar2 tall"><i class="grow r" style="--w:${pct(r.baseline, r.trials)}"></i></div><b class="t-red">${r.baseline} / ${r.trials} leaked</b></div>
<div class="big"><span>Aval</span><div class="bar2 tall"><i class="grow g" style="--w:${Math.max(0.6, (r.aval / r.trials) * 100)}%"></i></div><b class="t-green">${r.aval} / ${r.trials} leaked</b></div></div>
<div><h2 style="font-size:34px;margin:0 0 .3em">Around the model: <span class="t-green">${r.passed} of ${r.checks}</span> blocked</h2><p class="muted" style="margin:0 0 1em;font-size:22px">Forged mandates, stolen files, cross-site posts, a hijacked seller agent. No model involved.</p>${rows}</div></div></div>`,
    `.rt{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:26px;align-items:start}
.big{display:grid;gap:10px;margin-bottom:34px}.big span{font-size:24px;color:var(--muted)}.big b{font-size:44px;letter-spacing:-.02em}
.bar2{height:14px;background:var(--surface-2);border-radius:99px;overflow:hidden}.bar2.tall{height:30px}
.bar2 i{display:block;height:100%;border-radius:99px;width:var(--w)}.bar2 .g{background:var(--verified)}.bar2 .r{background:var(--bad)}
.cr{display:grid;grid-template-columns:190px 1fr 74px;gap:16px;align-items:center;margin:11px 0;font-size:21px}.cr b{font:600 20px var(--mono);text-align:right}
@keyframes grow{from{width:0}}.grow{animation:grow 1.6s cubic-bezier(.2,.7,.2,1) both}`,
  );
}

export function roadmapPage(): string {
  const step = (n: string, t: string) =>
    `<div class="stp"><span class="n">${n}</span><b>${t}</b></div>`;
  return doc(
    `<div class="stagebox"><div class="eyebrow">Roadmap, not built</div><h1 style="font-size:54px;margin:.3em 0 .8em">What comes next.</h1>
<div class="rm">${step("1", "A hosted registry")}<span class="ar">${icon("arrow")}</span>${step("2", "Matching at scale")}<span class="ar">${icon("arrow")}</span>${step("3", "Land for developers")}</div>
<p class="muted" style="font-size:26px;margin:1.3em 0 0">What you saw is built. This part is the plan.</p></div>`,
    `.rm{display:flex;gap:20px;align-items:center}.stp{background:var(--surface);border:1px dashed var(--line-strong);border-radius:18px;padding:34px 40px;display:grid;gap:10px}
.stp b{font-size:38px;letter-spacing:-.02em}.stp .n{font:600 20px var(--mono);color:var(--muted)}.ar{color:var(--muted)}.ar .i{width:44px;height:44px}`,
  );
}

export function endPage(): string {
  return doc(
    `<div class="stagebox" style="align-items:flex-start;padding-left:140px"><div class="big-mark">${MARK}</div><h1 style="font-size:104px;margin:0;letter-spacing:-.04em">Aval</h1>
<p style="font-size:34px;margin:.2em 0 0;color:var(--muted)">The listing AI agents can believe.</p><p style="font-size:34px;margin:.1em 0 .8em;font-weight:700">No evidence, no claim.</p>
<div class="mono" style="font-size:26px;color:var(--ink)">github.com/vicentewolde/aval</div>
<p class="muted" style="font-size:22px;margin:1em 0 0;font-family:var(--mono)">Muse Spark · SAM 3.1 · Muse Voice Transcribe · Meta Model API</p>
<p class="muted" style="font-size:22px;margin:.4em 0 0;font-family:var(--mono)">Built during the hackathon</p></div>`,
    `.big-mark .mark{width:88px;height:88px;margin-bottom:10px}`,
  );
}
