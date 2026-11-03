/**
 * Builds the demo video from the product itself: the narration comes from docs/demo-script.md, the voice is
 * ElevenLabs (or the macOS voice as a stand-in when there is no key), every picture is captured from the
 * running platform, and captions are burned in. Nothing is staged by hand.
 *
 *   node scripts/video/make-video.ts [--offline] [--force] [--tts auto|elevenlabs|say] [--voice Samantha]
 *
 * --offline runs the gateway with no model (no spend). Without it the search, the Spanish answer and the
 * translation use Muse Spark (about $0.03). The result is out/video/aval-prototype.mp4 and an .srt file.
 * Needs Google Chrome, ffmpeg and (for the documents scene) pdftoppm. ELEVENLABS_API_KEY goes in .env.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runToolChecks } from "../../src/redteam/tool-checks.ts";
import { ansiToHtml, stripAnsi } from "../../src/video/ansi.ts";
import { Chrome, type Page } from "../../src/video/cdp.ts";
import { parseNarration, type Scene } from "../../src/video/narration.ts";
import {
  captionPage,
  documentPage,
  endPage,
  mandatesPage,
  quotesPage,
  redTeamPage,
  roadmapPage,
  terminalPage,
} from "../../src/video/slides.ts";
import { type Cue, cuesFromWords, shiftCues, toSrt } from "../../src/video/subtitles.ts";
import { ElevenLabsTts, SayTts, type Spoken, type Tts } from "../../src/video/tts.ts";

for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m?.[1] && process.env[m[1]] === undefined)
    process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
}

const { values } = parseArgs({
  options: {
    offline: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    tts: { type: "string", default: "auto" },
    voice: { type: "string", default: "Samantha" },
    scenes: { type: "string" },
  },
});

const OUT = "out/video";
const FPS = 8; // capture rate of animated sequences; the final video is 30 fps
const W = 1440;
const H = 810;
const SCALE = 1920 / W;
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const LEAD = 0.35; // silence before each scene's narration
const TAIL = 0.6;
const log = (m: string) => console.log(`[video] ${m}`);
const ffmpeg = (args: string[]) =>
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });

type Segment =
  | { kind: "frames"; dir: string; n: number }
  | { kind: "still"; png: string; seconds: number };

// ------------------------------------------------------------------ helpers

function cli(args: string[], opts: { color?: boolean } = {}): string {
  try {
    return execFileSync("node", ["src/cli.ts", ...args], {
      env: {
        ...process.env,
        AVAL_BUDGET_USD: "8",
        ...(opts.color === false ? {} : { FORCE_COLOR: "1" }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    return `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`;
  }
}

const prompt = (cmd: string): string => `\u001b[32m$\u001b[39m ${cmd}`;
const dimText = (t: string): string => `\u001b[2m${t}\u001b[22m`;

const frameDir = (name: string): string => {
  const d = join(OUT, "frames", name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
};
class Frames {
  n = 0;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  async shot(p: Page): Promise<void> {
    await p.shot(join(this.dir, `${String(this.n++).padStart(5, "0")}.png`));
  }
  /** Holds the current screen for `count` frames: one capture, copied. */
  async hold(p: Page, count: number): Promise<void> {
    if (count <= 0) return;
    await this.shot(p);
    const last = join(this.dir, `${String(this.n - 1).padStart(5, "0")}.png`);
    for (let i = 1; i < count; i++)
      copyFileSync(last, join(this.dir, `${String(this.n++).padStart(5, "0")}.png`));
  }
  seg(): Segment {
    return { kind: "frames", dir: this.dir, n: this.n };
  }
}

/** Reveals a command and its real output on a terminal, a few lines per frame. */
async function terminal(
  p: Page,
  name: string,
  title: string,
  command: string,
  output: string,
  hold = 10,
  maxFrames = 36,
): Promise<Segment> {
  const f = new Frames(frameDir(name));
  const lines = output
    .replace(/\n+$/, "")
    .split("\n")
    .map((l) => ansiToHtml(l));
  const cmd = `<span class="p">$</span> ${command.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}`;
  for (const k of [0.25, 0.6, 1]) {
    await p.html(
      terminalPage(title, [
        `<span class="p">$</span> ${command.slice(0, Math.ceil(command.length * k)).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}`,
      ]),
    );
    await f.shot(p);
  }
  const step = Math.max(1, Math.ceil(lines.length / maxFrames));
  const plain = [command, ...output.replace(/\n+$/, "").split("\n")].map((l) => stripAnsi(l));
  const all = [cmd, ...lines];
  // A real terminal scrolls: keep the newest lines in view (about 17 wrapped rows at this size).
  const tail = (upto: number): string[] => {
    const shown = all.slice(0, upto + 1);
    let rows = 0;
    let from = shown.length;
    while (from > 0) {
      const r = Math.max(1, Math.ceil(((plain[from - 1] ?? "").length || 1) / 108));
      if (rows + r > 17) break;
      rows += r;
      from--;
    }
    return shown.slice(from);
  };
  for (let i = step; i < lines.length + step; i += step) {
    const upto = Math.min(i, lines.length);
    await p.html(terminalPage(title, tail(upto), i >= lines.length));
    await f.shot(p);
  }
  await f.hold(p, hold);
  return f.seg();
}

async function typeInto(
  p: Page,
  sel: string,
  text: string,
  f: Frames,
  perFrame = 3,
): Promise<void> {
  for (let i = perFrame; i < text.length + perFrame; i += perFrame) {
    await p.eval(
      `(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value=${JSON.stringify(text.slice(0, i))};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await p.sleep(40);
    await f.shot(p);
  }
}

/** Seeks the showroom video to each time and captures the page, so the product's own SAM boxes appear. */
async function scrub(p: Page, f: Frames, times: number[]): Promise<void> {
  for (const t of times) {
    await p.front();
    await p.eval(
      `(async()=>{const v=document.getElementById('v');await new Promise(r=>{const h=()=>{v.removeEventListener('seeked',h);r()};v.addEventListener('seeked',h);setTimeout(r,2500);if(Math.abs(v.currentTime-${t})<0.01){r();return}v.currentTime=${t}})})()`,
      15_000,
    );
    await p.sleep(420);
    await f.shot(p);
  }
}
const range = (a: number, b: number, step: number): number[] => {
  const out: number[] = [];
  for (let t = a; t <= b + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
};

async function waitFor(p: Page, expr: string, ms = 30_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await p.eval<boolean>(expr)) return true;
    await p.sleep(300);
  }
  return false;
}

async function gatewayUp(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("the gateway did not start");
}

// ------------------------------------------------------------------ voice

async function narrate(scenes: Scene[]): Promise<Spoken[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  const choice = values.tts === "auto" ? (key ? "elevenlabs" : "say") : values.tts;
  if (choice === "elevenlabs" && !key)
    throw new Error(
      "ELEVENLABS_API_KEY is not set: add it to .env (never in chat) or use --tts say",
    );
  const tts: Tts =
    choice === "elevenlabs"
      ? new ElevenLabsTts({
          apiKey: key as string,
          voiceId: process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM",
          ...(process.env.ELEVENLABS_MODEL_ID ? { modelId: process.env.ELEVENLABS_MODEL_ID } : {}),
        })
      : new SayTts(values.voice);
  log(
    `voice: ${tts.engine}${tts.engine === "say" ? ` (${values.voice}), a stand-in until ELEVENLABS_API_KEY is set` : ""}`,
  );
  mkdirSync(join(OUT, "audio"), { recursive: true });
  const out: Spoken[] = [];
  for (const s of scenes) {
    const base = join(OUT, "audio", `scene-${s.index}-${tts.engine}`);
    const cache = `${base}.json`;
    if (!values.force && existsSync(cache)) {
      const c = JSON.parse(readFileSync(cache, "utf8")) as { text: string; spoken: Spoken };
      if (c.text === s.narration && existsSync(c.spoken.audioPath)) {
        out.push(c.spoken);
        continue;
      }
    }
    const spoken = await tts.synth(s.narration, base);
    writeFileSync(cache, JSON.stringify({ text: s.narration, spoken }));
    out.push(spoken);
    log(`scene ${s.index + 1}: ${spoken.durationSec.toFixed(1)} s of narration`);
  }
  return out;
}

// ------------------------------------------------------------------ captures

interface Ctx {
  web: Page;
  slide: Page;
}

async function sceneOpening(c: Ctx): Promise<Segment[]> {
  const f = new Frames(frameDir("s1-opening"));
  await c.slide.html(readFileSync("docs/opening-card.html", "utf8"));
  for (const t of range(0, 22.5, 1 / FPS)) {
    await c.slide.eval(
      `document.getAnimations().forEach(a=>{a.pause();a.currentTime=${t * 1000}})`,
    );
    await f.shot(c.slide);
  }
  return [f.seg()];
}

async function sceneEvidence(c: Ctx): Promise<Segment[]> {
  const segs: Segment[] = [];
  await c.web.goto(`${BASE}/l/demo-1/showroom?theme=dark`);
  await c.web.sleep(1200);
  const f = new Frames(frameDir("s2-showroom"));
  await scrub(c.web, f, range(0.2, 12.8, 0.2));
  segs.push(f.seg());
  const l = JSON.parse(readFileSync(".aval/listings/demo-1/listing.json", "utf8")) as {
    claims: Array<{
      provenance: string;
      statement: string;
      evidence: { quote?: string | null } | null;
    }>;
  };
  const rows = l.claims
    .filter((x) => x.provenance === "broker_stated" && x.evidence?.quote)
    .slice(0, 6)
    .map((x) => ({ quote: x.evidence?.quote as string, claim: x.statement }));
  await c.slide.html(quotesPage(rows, "Her exact words become claims."));
  await c.slide.sleep(200);
  const png = join(OUT, "frames", "s2-quotes.png");
  await c.slide.shot(png);
  segs.push({ kind: "still", png, seconds: 5 });
  return segs;
}

async function sceneDocuments(c: Ctx): Promise<Segment[]> {
  const dir = ".aval/listings/demo-1";
  const original = readFileSync(join(dir, "title-review.json"), "utf8");
  const segs: Segment[] = [];
  try {
    copyFileSync("docs/examples/title-review-blocked.json", join(dir, "title-review.json"));
    segs.push(
      await terminal(
        c.slide,
        "s3-blocked",
        "aval: title review",
        "node src/cli.ts diligence show demo-1",
        cli(["diligence", "show", "demo-1"]),
        12,
        30,
      ),
    );
    execFileSync("pdftoppm", [
      "-png",
      "-r",
      "110",
      "-f",
      "1",
      "-l",
      "1",
      "fixtures/documents/blocked/01-dominio.pdf",
      join(OUT, "frames", "dominio"),
    ]);
    const pdf = readdirSync(join(OUT, "frames")).find(
      (x) => x.startsWith("dominio") && x.endsWith(".png"),
    );
    if (pdf) {
      const data = `data:image/png;base64,${readFileSync(join(OUT, "frames", pdf)).toString("base64")}`;
      await c.slide.html(
        documentPage(
          data,
          "OWNER_IS_NOT_SELLER",
          "The owner on the certificate of title is not the person selling.",
          ["Propietario: Ricardo Andres Mella Soto"],
          1,
        ),
      );
      await c.slide.sleep(300);
      const png = join(OUT, "frames", "s3-doc.png");
      await c.slide.shot(png);
      segs.push({ kind: "still", png, seconds: 6 });
    }
    segs.push(
      await terminal(
        c.slide,
        "s3-public",
        "what the agent is told",
        "node src/cli.ts diligence show demo-1 --public",
        cli(["diligence", "show", "demo-1", "--public"]),
        14,
        24,
      ),
    );
  } finally {
    writeFileSync(join(dir, "title-review.json"), original);
  }
  return segs;
}

async function sceneBuyer(c: Ctx): Promise<Segment[]> {
  const segs: Segment[] = [];
  const q = "depto para comprar en Ñuñoa, acepta perro, hasta 6 mil UF, con tina";
  const f1 = new Frames(frameDir("s4-search"));
  await c.web.goto(`${BASE}/search?theme=dark`);
  await f1.hold(c.web, 5);
  await typeInto(c.web, "#q", q, f1, 3);
  await f1.hold(c.web, 3);
  await c.web.goto(`${BASE}/search?theme=dark&q=${encodeURIComponent(q)}`);
  await c.web.sleep(1500);
  await f1.hold(c.web, 8);
  await c.web.eval("window.scrollTo({top:520})");
  await c.web.sleep(500);
  await f1.hold(c.web, 8);
  segs.push(f1.seg());

  const crit = encodeURIComponent(
    JSON.stringify({
      operation: "sale",
      commune: "Nunoa",
      min_bedrooms: 2,
      max_price: { amount: 6000, currency: "UF" },
      pets_required: true,
      must_have: ["bathtub"],
    }),
  );
  const f2 = new Frames(frameDir("s4-showroom"));
  await c.web.goto(`${BASE}/l/demo-1/showroom?theme=dark&c=${crit}`);
  await c.web.sleep(1000);
  await f2.hold(c.web, 4);
  await scrub(c.web, f2, range(38.6, 41.6, 0.2));
  await f2.hold(c.web, 8);
  segs.push(f2.seg());

  const f3 = new Frames(frameDir("s4-ask"));
  await c.web.eval("document.getElementById('ask').scrollIntoView({block:'center'})");
  await c.web.sleep(500);
  await typeInto(c.web, "#aq", "¿Tiene tina?", f3, 3);
  await c.web.eval("document.getElementById('ask').requestSubmit()");
  await waitFor(
    c.web,
    "(document.getElementById('answer').innerText||'').length>20 && !/Checking/.test(document.getElementById('answer').innerText)",
    40_000,
  );
  await c.web.sleep(500);
  await f3.hold(c.web, 14);
  await c.web.eval("document.getElementById('lead').scrollIntoView({block:'center'})");
  await c.web.sleep(400);
  await c.web.eval(
    `(()=>{const f=document.getElementById('lead');f.name.value='Camila Soto';f.contact.value='camila@example.com';f.message.value='I would like to visit with my dog.';f.consent.checked=true})()`,
  );
  await f3.hold(c.web, 5);
  await c.web.eval("document.getElementById('lead').requestSubmit()");
  await waitFor(c.web, "/Sent/.test(document.getElementById('leadout').innerText)", 15_000);
  await c.web.sleep(400);
  await f3.hold(c.web, 12);
  segs.push(f3.seg());

  segs.push(
    await terminal(
      c.slide,
      "s4-leads",
      "the broker's view",
      "node src/cli.ts leads",
      cli(["leads"]),
      14,
      12,
    ),
  );
  const id = /^(lead-[0-9a-f]+)/m.exec(stripAnsi(cli(["leads"], { color: false })))?.[1];
  if (id) cli(["leads", "delete", id], { color: false });
  return segs;
}

async function sceneNegotiation(c: Ctx): Promise<Segment[]> {
  const segs: Segment[] = [];
  await c.slide.html(mandatesPage());
  await c.slide.sleep(300);
  const png = join(OUT, "frames", "s5-mandates.png");
  await c.slide.shot(png);
  segs.push({ kind: "still", png, seconds: 6 });
  const list = stripAnsi(cli(["negotiation", "list"], { color: false }))
    .split("\n")
    .filter((l) => /agreed/.test(l));
  const id = list.at(-1)?.split(/\s+/)[0];
  if (!id) return segs;
  segs.push(
    await terminal(
      c.slide,
      "s5-show",
      "negotiation: the moves",
      `node src/cli.ts negotiation show ${id}`,
      cli(["negotiation", "show", id]),
      10,
      20,
    ),
  );
  const a1 = cli(["negotiation", "approve", id, "--as", "camila"]);
  const a2 = cli(["negotiation", "approve", id, "--as", "broker-perez"]);
  segs.push(
    await terminal(
      c.slide,
      "s5-approve",
      "two humans sign",
      `node src/cli.ts negotiation approve ${id} --as camila`,
      `${a1}${prompt(`node src/cli.ts negotiation approve ${id} --as broker-perez`)}\n${a2}`,
      14,
      8,
    ),
  );
  return segs;
}

async function scenePassport(c: Ctx): Promise<Segment[]> {
  const p = ".aval/listings/demo-1/passport.json";
  const tampered = join(OUT, "tampered-passport.json");
  writeFileSync(tampered, readFileSync(p, "utf8").replace("Pets allowed", "Pets not allowed"));
  const proof = join(OUT, "proof.json");
  writeFileSync(proof, cli(["passport", "prove", p, "d-pets"], { color: false }));
  const out = [
    cli(["passport", "verify", p]).trim(),
    "",
    dimText("# change one word and check again"),
    prompt("node src/cli.ts passport verify tampered-passport.json"),
    cli(["passport", "verify", tampered]).trim(),
    "",
    dimText("# prove a single fact without revealing the rest"),
    prompt("node src/cli.ts passport verify-proof proof.json"),
    cli(["passport", "verify-proof", proof]).trim(),
  ].join("\n");
  return [
    await terminal(
      c.slide,
      "s6-passport",
      "aval: signed passport",
      "node src/cli.ts passport verify .aval/listings/demo-1/passport.json",
      out,
      12,
      14,
    ),
  ];
}

async function sceneRedTeam(c: Ctx): Promise<Segment[]> {
  const res = (
    JSON.parse(readFileSync("docs/redteam-results.json", "utf8")) as {
      totals: { attackTrials: number; baselineViolations: number; avalFinalViolations: number };
    }
  ).totals;
  log("running the attack battery for the slide (no model)");
  const checks = await runToolChecks();
  const byCat = new Map<string, { total: number; passed: number }>();
  for (const k of checks) {
    const e = byCat.get(k.category) ?? { total: 0, passed: 0 };
    e.total++;
    if (k.pass) e.passed++;
    byCat.set(k.category, e);
  }
  const cats = [...byCat.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 7);
  await c.slide.html(
    redTeamPage({
      baseline: res.baselineViolations,
      aval: res.avalFinalViolations,
      trials: res.attackTrials,
      checks: checks.length,
      passed: checks.filter((k) => k.pass).length,
      categories: cats,
    }),
  );
  const f = new Frames(frameDir("s7-redteam"));
  for (const t of range(0, 2, 1 / FPS)) {
    await c.slide.eval(
      `document.getAnimations().forEach(a=>{a.pause();a.currentTime=${t * 1000}})`,
    );
    await f.shot(c.slide);
  }
  await f.hold(c.slide, 24);
  return [f.seg()];
}

async function sceneEnd(c: Ctx): Promise<Segment[]> {
  const segs: Segment[] = [];
  for (const [name, html, seconds] of [
    ["s8-roadmap", roadmapPage(), 4],
    ["s8-end", endPage(), 5],
  ] as const) {
    await c.slide.html(html);
    await c.slide.sleep(250);
    const png = join(OUT, "frames", `${name}.png`);
    await c.slide.shot(png);
    segs.push({ kind: "still", png, seconds });
  }
  return segs;
}

// ------------------------------------------------------------------ composition

function renderSegment(seg: Segment, seconds: number, out: string): void {
  const base = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "17",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
  ];
  if (seg.kind === "frames") {
    ffmpeg([
      "-framerate",
      String(seg.n / seconds),
      "-i",
      join(seg.dir, "%05d.png"),
      "-vf",
      "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p",
      "-t",
      seconds.toFixed(3),
      ...base,
      out,
    ]);
  } else {
    const n = Math.round(seconds * 30);
    ffmpeg([
      "-loop",
      "1",
      "-framerate",
      "30",
      "-i",
      seg.png,
      "-vf",
      `scale=3840:2160:flags=lanczos,zoompan=z='1+0.035*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=1920x1080:fps=30,format=yuv420p`,
      "-frames:v",
      String(n),
      ...base,
      out,
    ]);
  }
}

function buildScene(index: number, segs: Segment[], total: number): string {
  const natural = segs.map((s) => (s.kind === "frames" ? s.n / FPS : s.seconds));
  const sum = natural.reduce((a, b) => a + b, 0);
  const dir = join(OUT, "segs");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  segs.forEach((s, j) => {
    const seconds = (natural[j] as number) * (total / sum);
    const f = join(dir, `s${index}-${j}.mp4`);
    renderSegment(s, seconds, f);
    files.push(f);
  });
  const list = join(dir, `s${index}.txt`);
  writeFileSync(list, files.map((f) => `file '${join(process.cwd(), f)}'`).join("\n"));
  const joined = join(dir, `scene-${index}.mp4`);
  ffmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `fade=t=in:st=0:d=0.25,fade=t=out:st=${(total - 0.3).toFixed(2)}:d=0.3`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "17",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    joined,
  ]);
  return joined;
}

const NOTES: Record<number, string> = {
  1: "Stock footage, invented listing",
  2: "Invented documents. Not legal advice.",
  4: "Non-binding: a lawyer and a notary come next",
  7: "Roadmap, not built",
};

async function renderCaptions(
  slide: Page,
  scenes: Scene[],
  starts: number[],
  durs: number[],
  spoken: Spoken[],
): Promise<{ file: string; cues: Cue[] }> {
  const dir = join(OUT, "captions");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const blank = join(dir, "blank.png");
  await slide.html(captionPage([]));
  await slide.shot(blank, { transparent: true });
  const all: Cue[] = [];
  const timeline: Array<{ png: string; dur: number }> = [];
  let cursor = 0;
  let n = 0;
  const cap = async (lines: string[], note?: string): Promise<string> => {
    const png = join(dir, `c${n++}.png`);
    await slide.html(captionPage(lines, note));
    await slide.shot(png, { transparent: true });
    return png;
  };
  for (const s of scenes) {
    const i = s.index;
    const cues = shiftCues(
      cuesFromWords((spoken[i] as Spoken).words),
      (starts[i] as number) + LEAD,
    );
    all.push(...cues);
    const sceneEnd = (starts[i] as number) + (durs[i] as number);
    const sceneStart = starts[i] as number;
    // "Roadmap, not built" belongs to the roadmap card only, not to the closing card after it.
    const noteUntil = sceneStart + (durs[i] as number) * (i === 7 ? 0.5 : 1);
    const noteAt = (t: number): string | undefined => (t < noteUntil ? NOTES[i] : undefined);
    if (sceneStart > cursor) timeline.push({ png: blank, dur: sceneStart - cursor });
    cursor = sceneStart;
    for (const cue of cues) {
      const start = Math.max(cue.start, cursor);
      if (start > cursor) {
        const n = noteAt(cursor);
        timeline.push({ png: n ? await cap([], n) : blank, dur: start - cursor });
      }
      const end = Math.max(cue.end + 0.12, start + 0.4);
      timeline.push({ png: await cap(cue.lines, noteAt(start)), dur: end - start });
      cursor = end;
    }
    if (sceneEnd > cursor) {
      const n = noteAt(cursor);
      timeline.push({ png: n ? await cap([], n) : blank, dur: sceneEnd - cursor });
    }
    cursor = sceneEnd;
  }
  const list = join(dir, "captions.txt");
  writeFileSync(
    list,
    `${timeline.map((t) => `file '${join(process.cwd(), t.png)}'\nduration ${t.dur.toFixed(3)}`).join("\n")}\nfile '${join(process.cwd(), timeline.at(-1)?.png ?? blank)}'\n`,
  );
  const file = join(dir, "captions.mov");
  ffmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    "fps=30,format=rgba",
    "-c:v",
    "qtrle",
    file,
  ]);
  return { file, cues: all };
}

function buildAudio(spoken: Spoken[], durs: number[]): string {
  const dir = join(OUT, "audio");
  const files: string[] = [];
  spoken.forEach((s, i) => {
    const f = join(dir, `padded-${i}.wav`);
    ffmpeg([
      "-i",
      s.audioPath,
      "-af",
      `adelay=${Math.round(LEAD * 1000)}:all=1,apad=whole_dur=${(durs[i] as number).toFixed(3)}`,
      "-ar",
      "44100",
      "-ac",
      "1",
      f,
    ]);
    files.push(f);
  });
  const list = join(dir, "padded.txt");
  writeFileSync(list, files.map((f) => `file '${join(process.cwd(), f)}'`).join("\n"));
  const out = join(dir, "narration.wav");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  return out;
}

// ------------------------------------------------------------------ main

mkdirSync(join(OUT, "frames"), { recursive: true });
const scenes = parseNarration(readFileSync("docs/demo-script.md", "utf8"));
log(`${scenes.length} scenes from docs/demo-script.md`);
const spoken = await narrate(scenes);
const durs = spoken.map((s) => s.durationSec + LEAD + TAIL);
const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0));

const only = values.scenes ? new Set(values.scenes.split(",").map(Number)) : null;
const gateway = spawn(
  "node",
  ["src/cli.ts", "serve", "--port", String(PORT), ...(values.offline ? ["--offline"] : [])],
  { env: { ...process.env, AVAL_BUDGET_USD: "8" }, stdio: "ignore" },
);
const chrome = await Chrome.launch();
try {
  await gatewayUp();
  const ctx: Ctx = { web: await chrome.page(W, H, SCALE), slide: await chrome.page(W, H, SCALE) };
  const makers: Array<(c: Ctx) => Promise<Segment[]>> = [
    sceneOpening,
    sceneEvidence,
    sceneDocuments,
    sceneBuyer,
    sceneNegotiation,
    scenePassport,
    sceneRedTeam,
    sceneEnd,
  ];
  const sceneFiles: string[] = [];
  for (let i = 0; i < makers.length; i++) {
    const reuse = join(OUT, "segs", `scene-${i}.mp4`);
    if (only && !only.has(i + 1) && existsSync(reuse)) {
      log(`scene ${i + 1}: reusing the previous capture`);
      sceneFiles.push(reuse);
      continue;
    }
    log(`capturing scene ${i + 1}`);
    const segs = await (makers[i] as (c: Ctx) => Promise<Segment[]>)(ctx);
    sceneFiles.push(buildScene(i, segs, durs[i] as number));
  }
  log("captions");
  const cap = await renderCaptions(ctx.slide, scenes, starts, durs, spoken);
  writeFileSync(join(OUT, "aval-prototype.srt"), toSrt(cap.cues));
  log("assembling");
  const list = join(OUT, "segs", "all.txt");
  writeFileSync(list, sceneFiles.map((f) => `file '${join(process.cwd(), f)}'`).join("\n"));
  const silent = join(OUT, "video-silent.mp4");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
  const audio = buildAudio(spoken, durs);
  ffmpeg([
    "-i",
    silent,
    "-i",
    audio,
    "-i",
    cap.file,
    "-filter_complex",
    "[0:v][2:v]overlay=format=auto[v]",
    "-map",
    "[v]",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "19",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-shortest",
    join(OUT, "aval-prototype.mp4"),
  ]);
  const total = durs.reduce((a, b) => a + b, 0);
  log(
    `done: ${join(OUT, "aval-prototype.mp4")} (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}), subtitles ${join(OUT, "aval-prototype.srt")}`,
  );
} finally {
  await chrome.close();
  gateway.kill();
}
