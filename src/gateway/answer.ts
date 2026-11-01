import type { Listing } from "../claims/schema.ts";
import { forbiddenStrings, type VisibleFact } from "./policy.ts";

export interface AnswerSegment {
  text: string;
  claim_ids: string[];
}

export interface ModelAnswer {
  segments: AnswerSegment[];
  cannot_answer: boolean;
}

/** The language model behind `ask`. It only ever sees facts the policy already allowed. */
export interface AnswerModel {
  answer(input: { question: string; facts: VisibleFact[] }): Promise<ModelAnswer>;
}

export interface AnswerResult {
  answer: string;
  citations: Array<{ claim_id: string; provenance: VisibleFact["provenance"]; evidence: string }>;
  refused: "NO_VERIFIED_FACT" | null;
  /** Things worth a human's attention (injection attempts, blocked leaks). They never change what is allowed. */
  flags: string[];
}

export const MAX_QUESTION_CHARS = 500;
export const REFUSAL = "I can't confirm that from verified facts about this listing.";

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/ignore (all |any |the )?(previous|prior|above|earlier)/i, "override-instructions"],
  [/disregard (the |your )?(rules|instructions|policy)/i, "override-instructions"],
  [/(system|developer) (prompt|message|instructions)/i, "probes-system-prompt"],
  [/you are now|act as|pretend (to be|you)|jailbreak|developer mode/i, "role-play"],
  [
    /(reveal|show|print|dump|leak).{0,40}(rules|policy|prompt|hidden|secret|instructions)/i,
    "reveals-internals",
  ],
  [/(exact|full|precise|real).{0,20}(address|location|street)|dirección exacta/i, "asks-address"],
  [
    /(lowest|minimum|floor|bottom|best).{0,20}(price|offer)|precio (mínimo|piso)|exact price/i,
    "asks-price-floor",
  ],
  [/[A-Za-z0-9+/]{60,}={0,2}/, "encoded-payload"],
  [/<\/?(system|assistant|tool|untrusted)/i, "fake-markup"],
];

/** Lowercases and removes digit separators, so "5.800", "5,800" and "5 800" all read as 5800. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/(?<=\d)[.,\s\u00a0](?=\d)/g, "");
}

export function detectInjection(question: string): string[] {
  const flags = new Set<string>();
  for (const [re, name] of INJECTION_PATTERNS) if (re.test(question)) flags.add(name);
  return [...flags];
}

/**
 * Defense in depth. Layer 1: the model sees only allowed facts. Layer 2 (here): whatever it says is
 * checked in code: every sentence must cite facts that exist and are assertable, and nothing the
 * seller forbids (exact address, exact price under a range policy) may appear in the text.
 * A model that has been fully jailbroken still cannot get past this function.
 */
export async function answerQuestion(args: {
  question: string;
  listing: Listing;
  facts: VisibleFact[];
  model: AnswerModel;
}): Promise<AnswerResult> {
  const question = args.question.slice(0, MAX_QUESTION_CHARS);
  const flags = detectInjection(args.question);
  if (args.question.length > MAX_QUESTION_CHARS) flags.push("question-truncated");
  const byId = new Map(args.facts.map((f) => [f.id, f]));
  const forbidden = forbiddenStrings(args.listing);

  const raw = await args.model.answer({ question, facts: args.facts });
  const kept: AnswerSegment[] = [];
  for (const seg of raw.segments) {
    const ids = seg.claim_ids;
    if (ids.length === 0 || !ids.every((id) => byId.has(id))) {
      flags.push("uncited-or-unknown-claim-dropped");
      continue;
    }
    const lower = normalize(seg.text);
    if (forbidden.some((s) => lower.includes(normalize(s)))) {
      flags.push("forbidden-value-blocked");
      continue;
    }
    kept.push(seg);
  }
  if (raw.cannot_answer || kept.length === 0) {
    return {
      answer: REFUSAL,
      citations: [],
      refused: "NO_VERIFIED_FACT",
      flags: [...new Set(flags)],
    };
  }
  const cited = [...new Set(kept.flatMap((s) => s.claim_ids))];
  return {
    answer: kept.map((s) => s.text.trim()).join(" "),
    citations: cited.map((id) => {
      const f = byId.get(id) as VisibleFact;
      return { claim_id: id, provenance: f.provenance, evidence: f.evidence };
    }),
    refused: null,
    flags: [...new Set(flags)],
  };
}
