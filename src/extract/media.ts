import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SAMPLE_FPS = 5;
export const MAX_VIDEO_SECONDS = 150;

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
}

export async function probe(path: string): Promise<VideoInfo> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    path,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: Array<{ width: number; height: number }>;
    format?: { duration?: string };
  };
  const s = j.streams?.[0];
  const d = Number(j.format?.duration);
  if (!s || !Number.isFinite(d)) throw new Error(`Not a readable video: ${path}`);
  return { durationSec: d, width: s.width, height: s.height };
}

/**
 * SAM bills per frame and the API wants H.264 mp4. A 720p, 5 fps copy with faststart is enough to
 * see rooms and fittings, and keeps a 90 s clip near 450 frames per concept (about $0.09).
 */
export async function normalize(input: string, output: string): Promise<VideoInfo> {
  const info = await probe(input);
  if (info.durationSec > MAX_VIDEO_SECONDS) {
    throw new Error(
      `Video is ${Math.round(info.durationSec)}s; the limit is ${MAX_VIDEO_SECONDS}s to keep spend predictable.`,
    );
  }
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-vf",
    `fps=${SAMPLE_FPS},scale=w='if(gt(iw,ih),-2,720)':h='if(gt(iw,ih),720,-2)'`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    output,
  ]);
  return probe(output);
}

export interface BoxPx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
}

/** Saves the frame at `tSec` with the detection drawn on it: the picture a human or judge can check. */
export async function extractEvidenceFrame(
  video: string,
  tSec: number,
  box: BoxPx | null,
  output: string,
): Promise<void> {
  const filters: string[] = [];
  if (box) {
    const x = Math.max(0, Math.round(box.x1));
    const y = Math.max(0, Math.round(box.y1));
    const w = Math.max(2, Math.round(box.x2 - box.x1));
    const h = Math.max(2, Math.round(box.y2 - box.y1));
    filters.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0x00e676@0.9:t=4`);
  }
  const args = ["-y", "-v", "error", "-ss", tSec.toFixed(2), "-i", video, "-frames:v", "1"];
  if (filters.length > 0) args.push("-vf", filters.join(","));
  args.push("-q:v", "3", output);
  await run("ffmpeg", args);
}
