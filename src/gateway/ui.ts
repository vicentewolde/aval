import { createHash } from "node:crypto";

/**
 * The visual system of every page Aval serves to people. One idea runs through it: proof is visible.
 * Green is reserved for "verified" and never used as decoration; the other three provenances and the
 * unconfirmed state have their own fixed colors, so a buyer learns the legend once. The mark is the
 * four corners of a detection box with a check inside, the thing SAM draws around what it finds.
 * System fonts only: nothing is fetched from another host, so the pages look the same offline.
 */
export const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

export type Theme = "light" | "dark";

/** `?theme=dark` or `?theme=light` pins a theme (useful for screenshots and the video); otherwise the OS decides. */
export function themeFrom(url: URL): Theme | null {
  const t = url.searchParams.get("theme");
  return t === "light" || t === "dark" ? t : null;
}

export const sha256b64 = (s: string): string => createHash("sha256").update(s).digest("base64");

const p = (d: string) => `<path d="${d}"/>`;
const ICONS: Record<string, string> = {
  check: p("M5 12.5l4.5 4.5L19 7.5"),
  question: `${p("M9.2 9a2.8 2.8 0 1 1 4.2 2.4c-.9.6-1.4 1.1-1.4 2.1")}<circle cx="12" cy="17.2" r=".6"/>`,
  x: p("M6.5 6.5l11 11M17.5 6.5l-11 11"),
  video: `<rect x="3" y="6" width="12" height="12" rx="2.5"/>${p("M15 10.5l5.5-3v9l-5.5-3")}`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/>${p("M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3")}`,
  pencil: p(
    "M4 20l1-4.2L16.3 4.5a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L8.2 19 4 20zM14.5 6.3l3.2 3.2",
  ),
  search: `<circle cx="11" cy="11" r="6.5"/>${p("M16 16l4.5 4.5")}`,
  arrow: p("M5 12h14M13 6l6 6-6 6"),
  doc: p("M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h5M9.5 15.5h5"),
  shield: p("M12 3l7 3v5.5c0 4.3-2.9 7.6-7 9.5-4.1-1.9-7-5.2-7-9.5V6z"),
  play: p("M8 5.5v13l11-6.5z"),
  bell: p("M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"),
  chat: p("M4 5h16v11H9l-5 4z"),
  mail: `<rect x="3" y="5.5" width="18" height="13" rx="2.5"/>${p("M4 7.5l8 6 8-6")}`,
};

export function icon(name: keyof typeof ICONS | string, cls = ""): string {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;
}

const MARK_PATHS =
  "M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2M8.7 12.4l2.5 2.5 4.3-5";
export const MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${MARK_PATHS}"/></svg>`;
const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0d8a63" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${MARK_PATHS}"/></svg>`)}`;

export type Provenance = "visually_verified" | "broker_stated" | "broker_declared";
const PROV: Record<Provenance, { label: string; cls: string; ic: string }> = {
  visually_verified: { label: "Verified in video", cls: "verified", ic: "video" },
  broker_stated: { label: "Said by the broker", cls: "said", ic: "mic" },
  broker_declared: { label: "Declared by the broker", cls: "declared", ic: "pencil" },
};
export const provBadge = (pv: Provenance): string =>
  `<span class="badge badge--${PROV[pv].cls}">${icon(PROV[pv].ic)}${PROV[pv].label}</span>`;
export const provLabel = (pv: Provenance): string => PROV[pv].label;

export const statusIcon = (status: string): string =>
  status === "met"
    ? `<span class="st st--ok" title="met">${icon("check")}</span>`
    : status === "not_met"
      ? `<span class="st st--no" title="not met">${icon("x")}</span>`
      : `<span class="st st--maybe" title="unconfirmed">${icon("question")}</span>`;

/** A segmented bar of how a listing's facts are proven: verified, said, declared. */
export function proofMeter(v: number, s: number, d: number): string {
  const total = Math.max(1, v + s + d);
  const w = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  return `<div class="meter" role="img" aria-label="${v} verified in video, ${s} said by the broker, ${d} declared by the broker"><i class="m-v" style="width:${w(v)}"></i><i class="m-s" style="width:${w(s)}"></i><i class="m-d" style="width:${w(d)}"></i></div>`;
}

export const CSS = `
:root{
  --bg:#f5f7f6;--surface:#fff;--surface-2:#eef2f0;--ink:#0e1a16;--muted:#5a6b65;--line:#dce4e0;--line-strong:#c4d0ca;
  --verified:#0d8a63;--said:#2f65d1;--declared:#667a73;--maybe:#a8660b;--bad:#c2362f;
  --ring:#0e1a16;--shadow:0 1px 2px rgba(14,26,22,.05),0 8px 24px -12px rgba(14,26,22,.14);
  --font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --r:12px;--r-sm:8px;color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0a110e;--surface:#111b17;--surface-2:#182520;--ink:#e9f1ee;--muted:#93a69f;--line:#22322c;--line-strong:#2f443c;
  --verified:#3fdc9a;--said:#82aaff;--declared:#9cb0a8;--maybe:#f0b94e;--bad:#ff7d72;--ring:#e9f1ee;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px -14px rgba(0,0,0,.7);color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0a110e;--surface:#111b17;--surface-2:#182520;--ink:#e9f1ee;--muted:#93a69f;--line:#22322c;--line-strong:#2f443c;
  --verified:#3fdc9a;--said:#82aaff;--declared:#9cb0a8;--maybe:#f0b94e;--bad:#ff7d72;--ring:#e9f1ee;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px -14px rgba(0,0,0,.7);color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--font);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration-color:var(--line-strong);text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
:focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:6px}
.wrap{max-width:1140px;margin:0 auto;padding-inline:max(18px,env(safe-area-inset-left,0px)) max(18px,env(safe-area-inset-right,0px))}
.i{width:1.15em;height:1.15em;flex:none;vertical-align:-.2em}
.mark{width:26px;height:26px;color:var(--verified)}
/* top bar */
.top{border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.4) blur(10px);position:sticky;top:0;z-index:5}
.top .wrap{display:flex;align-items:center;gap:1.4rem;height:58px}
.brand{display:flex;align-items:center;gap:.55rem;font-weight:700;letter-spacing:-.02em;font-size:1.12rem;text-decoration:none}
.nav{display:flex;gap:.2rem;margin-left:auto}
.nav a{padding:.4rem .75rem;border-radius:99px;text-decoration:none;color:var(--muted);font-size:.93rem;white-space:nowrap}
@media(max-width:480px){.top .wrap{gap:.5rem}.nav a{padding:.4rem .5rem;font-size:.86rem}.brand{font-size:1rem}}
.nav a:hover{color:var(--ink);background:var(--surface-2)}
.nav a[aria-current=page]{color:var(--ink);background:var(--surface-2);font-weight:600}
/* type */
h1,h2,h3{margin:0;text-wrap:balance;letter-spacing:-.022em;line-height:1.12}
h1{font-size:clamp(2rem,4.6vw,3rem);font-weight:700}
h2{font-size:1.28rem;font-weight:650}
h3{font-size:1.02rem;font-weight:650;letter-spacing:-.01em}
.lead{font-size:1.1rem;color:var(--muted);max-width:60ch;margin:.8rem 0 0;text-wrap:pretty}
.eyebrow{font:600 .72rem/1 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.m,.muted{color:var(--muted)}.small{font-size:.86rem}
.mono{font-family:var(--mono);font-size:.82rem;letter-spacing:-.01em}
/* buttons, chips, badges */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;background:var(--ink);color:var(--bg);border:0;border-radius:10px;padding:.72rem 1.2rem;font:600 .97rem var(--font);cursor:pointer;text-decoration:none;transition:transform .12s,opacity .12s}
.btn:hover{opacity:.9}.btn:active{transform:translateY(1px)}
.btn--ghost{background:transparent;color:var(--ink);border:1px solid var(--line-strong)}
.btn--ghost:hover{background:var(--surface-2);opacity:1}
.btn--sm{padding:.45rem .85rem;font-size:.88rem}
.chip{display:inline-flex;align-items:center;gap:.35rem;background:var(--surface);border:1px solid var(--line);border-radius:99px;padding:.28rem .8rem;font-size:.88rem;text-decoration:none;color:var(--ink);cursor:pointer;font-family:var(--font)}
a.chip:hover,button.chip:hover{border-color:var(--line-strong);background:var(--surface-2)}
.chip--soft{background:var(--surface-2);border-color:transparent}
.chips{display:flex;flex-wrap:wrap;gap:.45rem}
.badge{display:inline-flex;align-items:center;gap:.32rem;border-radius:99px;padding:.16rem .6rem .16rem .5rem;font-size:.74rem;font-weight:600;letter-spacing:.01em;white-space:nowrap;--c:var(--declared);color:var(--c);background:color-mix(in srgb,var(--c) 13%,var(--surface));border:1px solid color-mix(in srgb,var(--c) 28%,transparent)}
.badge .i{width:1.05em;height:1.05em}
.badge--verified{--c:var(--verified)}.badge--said{--c:var(--said)}.badge--declared{--c:var(--declared)}
.st{display:inline-grid;place-items:center;width:1.45rem;height:1.45rem;border-radius:50%;flex:none;--c:var(--maybe);color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--surface));border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
.st .i{width:.95rem;height:.95rem}
.st--ok{--c:var(--verified)}.st--no{--c:var(--bad)}.st--maybe{--c:var(--maybe)}
/* surfaces */
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:1.15rem 1.25rem}
.panel h2,.panel h3{margin-bottom:.6rem}
.note{border-left:3px solid var(--line-strong);padding:.2rem 0 .2rem .9rem;color:var(--muted);font-size:.93rem}
.meter{display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--surface-2);gap:2px}
.meter i{display:block;height:100%}.m-v{background:var(--verified)}.m-s{background:var(--said)}.m-d{background:var(--declared);opacity:.55}
/* forms */
.field{display:grid;gap:.3rem;margin:.7rem 0}
.field label{font-size:.85rem;color:var(--muted);font-weight:500}
input[type=text],input[type=number],textarea,select{width:100%;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line-strong);border-radius:10px;padding:.65rem .8rem}
input::placeholder,textarea::placeholder{color:color-mix(in srgb,var(--muted) 70%,transparent)}
input:focus,textarea:focus,select:focus{outline:2px solid var(--ring);outline-offset:1px}
.consent{display:flex;gap:.6rem;align-items:flex-start;margin:.9rem 0 1rem;font-size:.84rem;color:var(--muted)}
.consent input{margin-top:.2rem;accent-color:var(--ink);width:1rem;height:1rem;flex:none}
.err{color:var(--bad)}.ok{color:var(--verified)}
.out{margin-top:.8rem}
/* search */
.hero{padding:clamp(1.8rem,5vw,3.6rem) 0 1.4rem}
.searchbar{display:flex;gap:.5rem;margin-top:1.6rem;padding:.4rem;background:var(--surface);border:1px solid var(--line-strong);border-radius:16px;box-shadow:var(--shadow);max-width:780px}
.searchbar:focus-within{border-color:var(--ink)}
.searchbar .i{margin:auto 0 auto .65rem;color:var(--muted);width:1.3rem;height:1.3rem}
.searchbar input{border:0;background:transparent;padding:.8rem .5rem;font-size:1.05rem;min-width:0;flex:1}
.searchbar input:focus{outline:0}
.searchbar .btn{border-radius:11px}
.understood{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:1.2rem 0 .3rem}
.results{display:grid;gap:1rem;margin:1.2rem 0}
.res{display:grid;grid-template-columns:230px minmax(0,1fr);gap:1.1rem;padding:.8rem;align-items:stretch}
.res .thumb{display:block;width:100%;align-self:start;border-radius:9px;overflow:hidden;background:var(--surface-2);aspect-ratio:16/10;position:relative}
.res .thumb img,.lc .thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.res .thumb .ph,.lc .thumb .ph{position:absolute;inset:0;display:flex;flex-direction:column;gap:.35rem;align-items:center;justify-content:center;color:var(--muted);font-size:.78rem;background:none;padding:0}
.res-body{min-width:0;display:flex;flex-direction:column;gap:.55rem;padding:.2rem .3rem .2rem 0}
.res-head{display:flex;gap:.8rem;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.res-head h2 a{text-decoration:none}.res-head h2 a:hover{text-decoration:underline}
.fit{font-size:.78rem;font-weight:650;padding:.2rem .65rem;border-radius:99px;--c:var(--verified);color:var(--c);background:color-mix(in srgb,var(--c) 13%,var(--surface));border:1px solid color-mix(in srgb,var(--c) 30%,transparent);white-space:nowrap}
.fit--maybe{--c:var(--maybe)}.fit--bad{--c:var(--bad)}
.crit{list-style:none;margin:.2rem 0 0;padding:0;display:grid;gap:.1rem}
.crit li{display:grid;grid-template-columns:1.45rem minmax(0,1fr) auto;gap:.6rem;align-items:center;padding:.38rem 0;border-top:1px solid var(--line);font-size:.93rem}
.crit li:first-child{border-top:0}
.crit .why{grid-column:2/-1;font-size:.82rem;color:var(--muted);margin-top:-.2rem}
.res-foot{margin-top:auto;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
@media(max-width:640px){.res{grid-template-columns:1fr}.res .thumb{aspect-ratio:16/10}}
/* index */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:1.1rem;margin:1rem 0}
.lc{overflow:hidden;display:flex;flex-direction:column}
.lc .thumb{aspect-ratio:16/9;background:var(--surface-2);position:relative;display:block}
.lc-body{padding:1rem 1.1rem 1.1rem;display:flex;flex-direction:column;gap:.55rem;flex:1}
.lc-body h2 a{text-decoration:none}.lc-body h2 a:hover{text-decoration:underline}
/* showroom */
.titlebar{padding:1.6rem 0 1rem;display:flex;flex-wrap:wrap;gap:1rem 2rem;align-items:flex-end;justify-content:space-between}
.crumbs{font-size:.88rem;color:var(--muted);margin-bottom:.7rem}
.crumbs a{text-decoration:none}.crumbs a:hover{text-decoration:underline}
.legend{display:flex;gap:1.1rem;flex-wrap:wrap;font-size:.86rem;color:var(--muted)}
.legend b{color:var(--ink);font-variant-numeric:tabular-nums;font-size:1.05rem;margin-right:.25rem}
.theater{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:1.4rem;align-items:start}
@media(max-width:860px){.theater{grid-template-columns:1fr}}
.stagewrap{background:#050806;border-radius:16px;padding:14px 14px 10px;box-shadow:var(--shadow)}
.stage{position:relative;margin:0 auto;aspect-ratio:var(--ar,16/9);width:min(100%,calc(74vh * var(--arn,1.7777)));border-radius:10px;overflow:hidden;background:#000}
.stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
.det{position:absolute;border:2px solid #3fdc9a;border-radius:4px;pointer-events:none;opacity:0;transition:opacity .18s;box-shadow:0 0 0 1px rgba(0,0,0,.35),0 0 22px rgba(63,220,154,.35)}
.det.on{opacity:1}
.det::before,.det::after{content:"";position:absolute;width:14px;height:14px;border:3px solid #3fdc9a}
.det::before{left:-3px;top:-3px;border-right:0;border-bottom:0;border-radius:5px 0 0 0}
.det::after{right:-3px;bottom:-3px;border-left:0;border-top:0;border-radius:0 0 5px 0}
.det span{position:absolute;left:-2px;bottom:100%;margin-bottom:6px;white-space:nowrap;background:#3fdc9a;color:#04130d;font:600 11px/1 var(--mono);padding:5px 8px;border-radius:6px}
.track{position:relative;height:34px;margin:10px 4px 0;cursor:pointer;touch-action:none}
.track::before{content:"";position:absolute;left:0;right:0;top:15px;height:4px;border-radius:4px;background:#26342e}
.track .fill{position:absolute;left:0;top:15px;height:4px;border-radius:4px;background:#3fdc9a;width:0}
.tick{position:absolute;top:8px;width:10px;height:18px;margin-left:-5px;border:0;padding:0;background:transparent;cursor:pointer}
.tick::after{content:"";position:absolute;left:3px;top:3px;width:4px;height:12px;border-radius:3px;background:#7be8bb;opacity:.85;transition:transform .12s,opacity .12s}
.tick:hover::after,.tick.on::after{opacity:1;transform:scaleY(1.35);background:#fff}
.track .head{position:absolute;top:9px;width:2px;height:16px;background:#fff;border-radius:2px;margin-left:-1px;left:0}
.stagecap{display:flex;justify-content:space-between;color:#8fa59c;font:500 11.5px/1 var(--mono);padding:8px 4px 2px}
.ph{background:var(--surface-2);border-radius:12px;padding:3rem 1.2rem;text-align:center;color:var(--muted)}
.chapters{display:flex;flex-direction:column;gap:.5rem;max-height:calc(74vh + 56px);overflow:auto;padding:2px 4px 2px 2px}
.ch{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:.8rem;align-items:center;text-align:left;width:100%;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:.5rem .7rem .5rem .5rem;font:inherit;color:inherit;cursor:pointer;transition:border-color .12s,background .12s}
button.ch:hover{border-color:var(--line-strong)}
.ch.on{border-color:var(--verified);background:color-mix(in srgb,var(--verified) 9%,var(--surface))}
.ch .th{width:56px;height:56px;border-radius:7px;background:var(--surface-2);overflow:hidden;display:grid;place-items:center;color:var(--muted);font:600 11px var(--mono)}
.ch .th img{width:100%;height:100%;object-fit:cover}
.ch .tx{min-width:0}.ch .tx b{display:block;font-weight:600;font-size:.93rem;line-height:1.3}
.ch .tx .mono{color:var(--muted)}
.ch .tm{font:600 12px var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.cols{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:1.4rem;margin-top:1.6rem;align-items:start}
@media(max-width:860px){.cols{grid-template-columns:1fr}}
.stack{display:grid;gap:1.1rem}
.said{list-style:none;margin:0;padding:0}
.said li{padding:.7rem 0;border-top:1px solid var(--line);display:grid;gap:.25rem}
.said li:first-child{border-top:0}
.said .q{font-size:.84rem;color:var(--muted)}
.answer{background:var(--surface-2);border-radius:10px;padding:.8rem .95rem;margin-top:.8rem}
.answer p{margin:0 0 .4rem}.cit{margin:.5rem 0 0;padding:0;list-style:none;display:grid;gap:.25rem;font-size:.8rem;color:var(--muted)}
.row{display:flex;gap:.6rem;flex-wrap:wrap}
.foot{margin-top:3.2rem;padding:1.6rem 0 2.2rem;border-top:1px solid var(--line);color:var(--muted);font-size:.86rem}
.foot .wrap{display:flex;gap:1rem 2rem;flex-wrap:wrap;justify-content:space-between;align-items:center}
.foot b{color:var(--ink)}
.mapped{display:grid;gap:.5rem;margin:.4rem 0 0;padding:0;list-style:none}
table.t{border-collapse:collapse;width:100%}table.t td,table.t th{border-bottom:1px solid var(--line);padding:.55rem .5rem;text-align:left;vertical-align:top;font-size:.93rem}
.scroll{overflow-x:auto}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;

export interface ShellOptions {
  title: string;
  description: string;
  body: string;
  active?: "search" | "listings" | "";
  theme?: Theme | null;
  /** The current URL, so the theme links keep the rest of the query. */
  url?: URL;
  bodyAttrs?: string;
  head?: string;
  script?: string;
  wide?: boolean;
}

function themeHref(url: URL | undefined, t: Theme): string {
  const u = new URL(url?.href ?? "http://localhost/");
  u.searchParams.set("theme", t);
  return `${u.pathname}${u.search}`;
}

export function shell(o: ShellOptions): string {
  const nav = (href: string, label: string, key: string) =>
    `<a href="${href}"${o.active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="en"${o.theme ? ` data-theme="${o.theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.description)}"><link rel="icon" href="${FAVICON}">
<style>${CSS}</style>${o.head ?? ""}</head><body${o.bodyAttrs ? ` ${o.bodyAttrs}` : ""}>
<header class="top"><div class="wrap"><a class="brand" href="/search" aria-label="Aval home">${MARK}Aval</a>
<nav class="nav" aria-label="Main">${nav("/search", "Search", "search")}${nav("/listings", "Listings", "listings")}<a href="/.well-known/aval.json">For agents</a></nav></div></header>
${o.body}
<footer class="foot"><div class="wrap"><span><b>No evidence, no claim.</b> Every fact here says where it comes from.</span><span>${o.url ? `Theme: <a href="${esc(themeHref(o.url, "light"))}">light</a> · <a href="${esc(themeHref(o.url, "dark"))}">dark</a>` : ""}</span></div></footer>
${o.script ? `<script>${o.script}</script>` : ""}</body></html>`;
}
