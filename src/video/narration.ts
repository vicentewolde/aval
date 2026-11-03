/**
 * The narration lives in one place: the shot-list table of docs/demo-script.md. The video is built from
 * that table, so the script and the video cannot drift apart.
 */
export interface Scene {
  index: number;
  /** The time slot in the script (informational: the video follows the audio, not these times). */
  slot: string;
  onScreen: string;
  narration: string;
}

export function parseNarration(markdown: string): Scene[] {
  const scenes: Scene[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^\| (\d:\d\d-\d:\d\d) \|/.exec(line);
    if (!m) continue;
    const cells = line
      .slice(1, line.lastIndexOf("|"))
      .split(" | ")
      .map((c) => c.trim());
    const narration = (cells[2] ?? "").replace(/^"|"$/g, "").trim();
    if (narration === "") continue;
    scenes.push({
      index: scenes.length,
      slot: m[1] as string,
      onScreen: cells[1] ?? "",
      narration,
    });
  }
  return scenes;
}

export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
