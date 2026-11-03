import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ansiToHtml, stripAnsi } from "../src/video/ansi.ts";
import { parseNarration, wordCount } from "../src/video/narration.ts";
import { cuesFromWords, srtTime, toSrt, wrapLines } from "../src/video/subtitles.ts";
import { ElevenLabsTts, estimateWords, wordsFromAlignment } from "../src/video/tts.ts";

const script = readFileSync(join(import.meta.dirname, "..", "docs", "demo-script.md"), "utf8");
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("narration comes from the demo script", () => {
  const scenes = parseNarration(script);
  it("reads every scene of the shot list, in order, with its words", () => {
    expect(scenes.length).toBe(8);
    expect(scenes.every((s) => wordCount(s.narration) > 10)).toBe(true);
    expect(scenes[0]?.narration).toMatch(/^Camila is buying her first flat/);
    expect(scenes.at(-1)?.narration).toMatch(/Aval\.$/);
  });
  it("fits a three-minute video at a calm pace", () => {
    const words = scenes.reduce((n, s) => n + wordCount(s.narration), 0);
    expect(words).toBeGreaterThan(300);
    expect(words).toBeLessThan(430); // 150 words per minute is about 2:50 of speech
  });
});

describe("captions", () => {
  const text = scenes0();
  function scenes0() {
    return parseNarration(script)[0]?.narration ?? "";
  }
  it("wraps into at most two balanced lines", () => {
    const lines = wrapLines(
      "Camila is buying her first flat, and she asks her AI agent to find one.",
    );
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.length <= 42)).toBe(true);
  });
  it("groups timed words into short cues that keep every word, in order", () => {
    const words = estimateWords(text, 24);
    const cues = cuesFromWords(words);
    expect(cues.length).toBeGreaterThan(3);
    for (const c of cues) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      expect(c.lines.every((l) => l.length <= 42)).toBe(true);
      expect(c.end - c.start).toBeLessThanOrEqual(5.6);
      expect(c.end).toBeGreaterThan(c.start);
    }
    expect(cues.map((c) => c.lines.join(" ")).join(" ")).toBe(words.map((w) => w.text).join(" "));
    for (let i = 1; i < cues.length; i++)
      expect((cues[i] as { start: number }).start).toBeGreaterThanOrEqual(
        (cues[i - 1] as { end: number }).end - 0.001,
      );
  });
  it("writes SRT times and blocks", () => {
    expect(srtTime(3723.456)).toBe("01:02:03,456");
    expect(toSrt([{ start: 0.5, end: 2, lines: ["Hello", "world"] }])).toBe(
      "1\n00:00:00,500 --> 00:00:02,000\nHello\nworld\n",
    );
  });
});

describe("word timings", () => {
  it("turns ElevenLabs' character times into word times", () => {
    const words = wordsFromAlignment({
      characters: ["H", "i", " ", "y", "o", "u"],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    });
    expect(words).toEqual([
      { text: "Hi", start: 0, end: 0.2 },
      { text: "you", start: 0.3, end: 0.6 },
    ]);
  });
  it("estimates words inside the audio when there is no alignment", () => {
    const w = estimateWords("One two three, four.", 4);
    expect(w).toHaveLength(4);
    expect(w[0]?.start).toBeGreaterThan(0);
    expect((w.at(-1) as { end: number }).end).toBeLessThanOrEqual(4);
    for (let i = 1; i < w.length; i++)
      expect((w[i] as { start: number }).start).toBeGreaterThan(
        (w[i - 1] as { start: number }).start,
      );
  });
});

describe("ElevenLabs client (no real call)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aval-tts-"));
  const mp3 = (() => {
    if (!hasFfmpeg) return "";
    const p = join(dir, "tone.mp3");
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      p,
    ]);
    return readFileSync(p).toString("base64");
  })();

  it.skipIf(!hasFfmpeg)(
    "sends the key only as a header, asks for timestamps, and reads audio and alignment",
    async () => {
      let seen: { url: string; init: RequestInit } | undefined;
      const tts = new ElevenLabsTts({
        apiKey: "sk-test-key",
        voiceId: "voice123",
        fetch: (async (url: string, init: RequestInit) => {
          seen = { url, init };
          return new Response(
            JSON.stringify({
              audio_base64: mp3,
              alignment: {
                characters: ["O", "k"],
                character_start_times_seconds: [0, 0.1],
                character_end_times_seconds: [0.1, 0.2],
              },
            }),
            { status: 200 },
          );
        }) as unknown as typeof fetch,
      });
      const out = await tts.synth("Ok", join(dir, "scene"));
      expect(seen?.url).toContain("/v1/text-to-speech/voice123/with-timestamps");
      expect((seen?.init.headers as Record<string, string>)["xi-api-key"]).toBe("sk-test-key");
      expect(String(seen?.init.body)).not.toContain("sk-test-key");
      expect(JSON.parse(String(seen?.init.body))).toMatchObject({
        text: "Ok",
        model_id: "eleven_multilingual_v2",
      });
      expect(existsSync(out.audioPath)).toBe(true);
      expect(out.durationSec).toBeGreaterThan(0.5);
      expect(out.words).toEqual([{ text: "Ok", start: 0, end: 0.2 }]);
      expect(out.engine).toBe("elevenlabs");
    },
  );

  it("reports an error without ever echoing the key", async () => {
    const tts = new ElevenLabsTts({
      apiKey: "sk-secret-123",
      voiceId: "v",
      fetch: (async () =>
        new Response('{"detail":"invalid key sk-secret-123"}', {
          status: 401,
        })) as unknown as typeof fetch,
    });
    const err = await tts.synth("x", join(dir, "e")).catch((e: Error) => e);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("sk-secret-123");
  });
});

describe("terminal text to HTML", () => {
  const ESC = String.fromCharCode(27);
  it("keeps color and weight, escapes markup, and strips codes for plain text", () => {
    const line = `${ESC}[1m${ESC}[33mNEEDS${ESC}[39m${ESC}[22m <b>x</b> ${ESC}[2mdim${ESC}[22m`;
    const html = ansiToHtml(line);
    expect(html).toContain('<span class="t-bold t-yellow">NEEDS</span>');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('<span class="t-dim">dim</span>');
    expect(stripAnsi(line)).toBe("NEEDS <b>x</b> dim");
  });
});
