import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Word } from "./subtitles.ts";

/** One narrated scene: the audio file, its length and when each word is spoken. */
export interface Spoken {
  audioPath: string;
  durationSec: number;
  words: Word[];
  engine: "elevenlabs" | "say";
}
export interface Tts {
  readonly engine: Spoken["engine"];
  synth(text: string, outBase: string): Promise<Spoken>;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Turns ElevenLabs' character-level alignment into word timings. */
export function wordsFromAlignment(a: Alignment): Word[] {
  const words: Word[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  const push = () => {
    if (text !== "") words.push({ text, start, end });
    text = "";
  };
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      push();
      return;
    }
    if (text === "") start = a.character_start_times_seconds[i] ?? 0;
    text += ch;
    end = a.character_end_times_seconds[i] ?? end;
  });
  push();
  return words;
}

/** Without alignment (the macOS voice), words are spread over the audio in proportion to their length. */
export function estimateWords(text: string, durationSec: number, leadIn = 0.15): Word[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const weights = parts.map(
    (p) => p.length + 2 + (/[.!?]$/.test(p) ? 4 : /[,;:]$/.test(p) ? 2 : 0),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.1, durationSec - leadIn);
  let t = leadIn;
  return parts.map((p, i) => {
    const d = ((weights[i] as number) / total) * span;
    const w = { text: p, start: t, end: t + d * 0.92 };
    t += d;
    return w;
  });
}

export function probeDuration(path: string): number {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    path,
  ])
    .toString()
    .trim();
  return Number(out);
}

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * ElevenLabs text to speech with character timings (so captions follow the voice exactly).
 * The key is only ever sent as the xi-api-key header and is never printed or put in an error.
 */
export class ElevenLabsTts implements Tts {
  readonly engine = "elevenlabs" as const;
  private readonly o: Required<Omit<ElevenLabsOptions, "fetch">> & { fetch: typeof fetch };

  constructor(o: ElevenLabsOptions) {
    this.o = {
      apiKey: o.apiKey,
      voiceId: o.voiceId,
      modelId: o.modelId ?? "eleven_multilingual_v2",
      baseUrl: o.baseUrl ?? "https://api.elevenlabs.io",
      fetch: o.fetch ?? fetch,
    };
  }

  async synth(text: string, outBase: string): Promise<Spoken> {
    const url = `${this.o.baseUrl}/v1/text-to-speech/${encodeURIComponent(this.o.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
    const res = await this.o.fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.o.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: this.o.modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).replace(this.o.apiKey, "[key]").slice(0, 300);
      throw new Error(`ElevenLabs answered ${res.status}: ${body}`);
    }
    const json = (await res.json()) as { audio_base64?: string; alignment?: Alignment | null };
    if (!json.audio_base64) throw new Error("ElevenLabs returned no audio");
    const audioPath = `${outBase}.mp3`;
    writeFileSync(audioPath, Buffer.from(json.audio_base64, "base64"));
    const durationSec = probeDuration(audioPath);
    const words = json.alignment
      ? wordsFromAlignment(json.alignment)
      : estimateWords(text, durationSec);
    return { audioPath, durationSec, words, engine: "elevenlabs" };
  }
}

/** Fallback voice for a prototype with no ElevenLabs key: the macOS voice. */
export class SayTts implements Tts {
  readonly engine = "say" as const;
  private readonly voice: string;
  private readonly rate: number;

  constructor(voice = "Samantha", rate = 178) {
    this.voice = voice;
    this.rate = rate;
  }

  async synth(text: string, outBase: string): Promise<Spoken> {
    const aiff = `${outBase}.aiff`;
    execFileSync("say", ["-v", this.voice, "-r", String(this.rate), "-o", aiff, text]);
    const audioPath = `${outBase}.wav`;
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      aiff,
      "-ar",
      "44100",
      "-ac",
      "1",
      audioPath,
    ]);
    const durationSec = probeDuration(audioPath);
    return { audioPath, durationSec, words: estimateWords(text, durationSec), engine: "say" };
  }
}
