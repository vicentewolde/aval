export interface Word {
  text: string;
  start: number;
  end: number;
}
export interface Cue {
  start: number;
  end: number;
  lines: string[];
}

const SENTENCE_END = /[.!?]["')]?$/;
const CLAUSE_END = /[,;:]["')]?$/;

/** Splits text into at most two balanced lines of up to `max` characters. */
export function wrapLines(text: string, max = 42): string[] {
  if (text.length <= max) return [text];
  const words = text.split(" ");
  let best: string[] = [text];
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > max || b.length > max) continue;
    const gap = Math.abs(a.length - b.length);
    if (gap < bestGap) {
      bestGap = gap;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Groups timed words into caption cues: at most two lines of 42 characters, at most `maxDur` seconds,
 * breaking at sentence ends first and clause ends next, and never leaving a one-word cue behind.
 */
export function cuesFromWords(
  words: Word[],
  opts: { maxChars?: number; maxDur?: number } = {},
): Cue[] {
  const maxChars = (opts.maxChars ?? 42) * 2;
  const maxDur = opts.maxDur ?? 5.5;
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const text = cur.map((w) => w.text).join(" ");
    cues.push({
      start: (cur[0] as Word).start,
      end: (cur[cur.length - 1] as Word).end,
      lines: wrapLines(text, opts.maxChars ?? 42),
    });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    const text = [...cur, w].map((x) => x.text).join(" ");
    const tooLong = text.length > maxChars || w.end - (cur[0]?.start ?? w.start) > maxDur;
    if (cur.length > 0 && tooLong) flush();
    cur.push(w);
    const len = cur.map((x) => x.text).join(" ").length;
    const left = words.length - i - 1;
    if (SENTENCE_END.test(w.text) && cur.length >= 2) flush();
    else if (CLAUSE_END.test(w.text) && len > maxChars * 0.55 && left >= 2) flush();
  }
  flush();
  return cues;
}

const pad = (n: number, w = 2): string => String(Math.floor(n)).padStart(w, "0");
export function srtTime(t: number): string {
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const s = Math.floor(t);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)},${pad(ms, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return `${cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join("\n")}`).join("\n\n")}\n`;
}

/** Shifts every cue by `offset` seconds (a scene's start in the final video). */
export const shiftCues = (cues: Cue[], offset: number): Cue[] =>
  cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset }));
