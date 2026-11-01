import type { AnswerModel, ModelAnswer } from "./answer.ts";

const STOP = new Set([
  "does",
  "have",
  "with",
  "what",
  "which",
  "there",
  "this",
  "that",
  "from",
  "about",
  "tell",
  "your",
  "the",
  "and",
  "for",
  "are",
  "any",
  "has",
  "can",
  "you",
]);
const tokens = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOP.has(t));

/**
 * Deterministic stand-in for Muse Spark: answers with the facts that share words with the question.
 * Used for offline demos and tests so nothing is spent; the verification layer treats it exactly
 * like the real model.
 */
export class OfflineAnswerModel implements AnswerModel {
  async answer({ question, facts }: Parameters<AnswerModel["answer"]>[0]): Promise<ModelAnswer> {
    const q = new Set(tokens(question));
    const hits = facts.filter((f) =>
      tokens(f.statement).some(
        (t) => q.has(t) || [...q].some((w) => w.startsWith(t.slice(0, 5)) && t.length >= 5),
      ),
    );
    if (hits.length === 0) return { segments: [], cannot_answer: true };
    return {
      segments: hits.slice(0, 3).map((f) => ({ text: `${f.statement}.`, claim_ids: [f.id] })),
      cannot_answer: false,
    };
  }
}
