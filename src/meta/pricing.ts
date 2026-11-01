/**
 * Standard-mode prices from https://dev.meta.ai/docs/pricing-rate-limits (read 2026-10-26).
 * Kept in one place so the budget guard and the docs agree. USD per 1M tokens unless noted.
 */
export const TOKEN_PRICES = {
  "muse-spark-1.3": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-wonder-1.0": { input: 4.0, cachedInput: 0.2, output: 20.0 },
} as const;

export type TokenModel = keyof typeof TOKEN_PRICES;

export const SAM_USD_PER_1000_VIDEO_FRAMES = 0.2;
export const SAM_USD_PER_1000_IMAGES = 2.5;
export const VOICE_USD_PER_HOUR = 0.18;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
}

export function tokenCostUsd(model: TokenModel, usage: Usage): number {
  const p = TOKEN_PRICES[model];
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const fresh = Math.max(0, usage.input_tokens - cached);
  return (fresh * p.input + cached * p.cachedInput + usage.output_tokens * p.output) / 1_000_000;
}

/** Worst case before sending: every input token fresh and the whole output allowance used. */
export function maxTokenCostUsd(
  model: TokenModel,
  estInputTokens: number,
  maxOutputTokens: number,
): number {
  const p = TOKEN_PRICES[model];
  return (estInputTokens * p.input + maxOutputTokens * p.output) / 1_000_000;
}

export function samVideoCostUsd(frames: number): number {
  return (frames / 1000) * SAM_USD_PER_1000_VIDEO_FRAMES;
}

export function samImageCostUsd(images: number): number {
  return (images / 1000) * SAM_USD_PER_1000_IMAGES;
}
