/**
 * A screen recording is made by a person, so its length never matches the narration exactly. This works out
 * how to fit one take into the scene's slot: speed it up or slow it down within limits, hold the last frame
 * if it is still short, and cut the end only if it is too long even at the top speed.
 */
export interface Retime {
  /** Multiplier for presentation timestamps (below 1 plays faster). */
  factor: number;
  /** Seconds to hold the last frame at the end. */
  pad: number;
  /** Seconds cut from the end. */
  trim: number;
  warning: string | null;
}

export function retime(
  recorded: number,
  target: number,
  opts: { maxSpeedUp?: number; maxSlowDown?: number } = {},
): Retime {
  const maxUp = opts.maxSpeedUp ?? 6;
  const maxSlow = opts.maxSlowDown ?? 1.25;
  if (!(recorded > 0) || !(target > 0)) throw new Error("both lengths must be positive");
  const ratio = target / recorded;
  if (ratio >= 1) {
    const factor = Math.min(ratio, maxSlow);
    return { factor, pad: Math.max(0, target - recorded * factor), trim: 0, warning: null };
  }
  const factor = Math.max(ratio, 1 / maxUp);
  const length = recorded * factor;
  const trim = Math.max(0, length - target);
  const speed = 1 / factor;
  const warning =
    trim > 0.05
      ? `too long even at ${speed.toFixed(1)}x: the last ${trim.toFixed(1)} s are cut`
      : speed > 3
        ? `sped up ${speed.toFixed(1)}x`
        : null;
  return { factor, pad: 0, trim: trim > 0.05 ? trim : 0, warning };
}
