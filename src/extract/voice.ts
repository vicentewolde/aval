import { z } from "zod";
import { Category, type Claim } from "../claims/schema.ts";
import type { MetaClient, Transcript } from "../meta/client.ts";
import { digitsIn, numbersIn, stripAccents } from "./spanish.ts";

export const VoiceProposalSchema = z.object({
  claims: z.array(
    z.object({
      id: z.string(),
      category: Category,
      /** Short neutral English statement. */
      statement: z.string(),
      /** The broker's exact words (Spanish), copied contiguously from the transcript. */
      quote: z.string(),
      subjective: z.boolean(),
      /** The broker asked to keep it secret, or it is negotiation or personal information. */
      private: z.boolean(),
    }),
  ),
});
export type VoiceProposal = z.infer<typeof VoiceProposalSchema>["claims"][number];

export interface VoiceProposer {
  propose(transcript: string): Promise<VoiceProposal[]>;
}

const INSTRUCTIONS = `You extract listing facts from a broker's spoken notes about ONE property (the transcript is in Spanish).
Rules:
1. One claim per distinct fact the broker states: building amenities, floor, orientation, parking, common expenses, fittings, appliances, rules. Do NOT repeat price, address, square meters, or the number of bedrooms and bathrooms: those are entered separately.
2. "quote" must be copied exactly from the transcript, as a contiguous excerpt, in Spanish. Never translate it, never paraphrase it.
3. "statement" is short, neutral English. Write every number as digits (24, not twenty-four; 42000, not forty-two thousand) and every number must be readable from the quote.
4. subjective=true for taste or judgement (luminoso, tranquilo, amplio, hermoso, buena ubicacion).
5. private=true for anything the broker asks to keep secret ("no se lo digas a nadie", "entre nosotros"), for negotiation positions, owner's bottom price, and personal data. These will be discarded.
6. Do not infer anything the broker did not say.
Reply as JSON matching the schema.`;

export class MuseVoiceProposer implements VoiceProposer {
  private readonly client: MetaClient;

  constructor(client: MetaClient) {
    this.client = client;
  }

  async propose(transcript: string): Promise<VoiceProposal[]> {
    const r = await this.client.respond({
      model: "muse-spark-1.3",
      instructions: INSTRUCTIONS,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `TRANSCRIPT:\n${transcript}` }],
        },
      ],
      jsonSchema: {
        name: "voice_claims",
        schema: z.toJSONSchema(VoiceProposalSchema) as Record<string, unknown>,
      },
      maxOutputTokens: 6000,
      reasoningEffort: "low",
      estInputTokens: Math.ceil(transcript.length / 2) + 800,
      label: "voice-claims",
    });
    return VoiceProposalSchema.parse(JSON.parse(r.text)).claims;
  }
}

/** Lowercase, no accents, no punctuation, single spaces: so "Clóset, empotrado." matches "closet empotrado". */
export function squash(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface VoiceResult {
  claims: Claim[];
  /** Claims dropped because the broker marked them private. Never stored. */
  discardedPrivate: number;
}

/**
 * Same rule as for video, for speech: no evidence, no claim. A statement is kept only if its quote
 * really appears in the transcript, and every number in the statement can be read off that quote.
 * The quote then becomes the evidence, with the time of the turn it was said in.
 */
export function verifyVoiceClaims(proposals: VoiceProposal[], t: Transcript): VoiceResult {
  const hay = squash(t.transcript);
  const turns = t.turns.map((u) => ({ ...u, text: squash(u.transcript) }));
  const claims: Claim[] = [];
  let discardedPrivate = 0;
  for (const p of proposals) {
    if (p.private) {
      discardedPrivate++;
      continue;
    }
    const base = { id: p.id, category: p.category, statement: p.statement };
    if (p.subjective) {
      claims.push({
        ...base,
        provenance: "subjective",
        evidence: null,
        note: "Taste word: never stated as fact.",
      });
      continue;
    }
    const q = squash(p.quote);
    if (q.length < 6 || !hay.includes(q)) {
      claims.push({
        ...base,
        provenance: "unverified",
        evidence: null,
        note: "The quote is not in the transcript: possible model invention.",
      });
      continue;
    }
    const quoteNumbers = numbersIn(p.quote);
    const stray = digitsIn(p.statement).filter((n) => !quoteNumbers.has(n));
    if (stray.length > 0) {
      claims.push({
        ...base,
        provenance: "unverified",
        evidence: null,
        note: `Number ${stray.join(", ")} cannot be read from the quote.`,
      });
      continue;
    }
    const turn =
      turns.find((u) => u.text.includes(q)) ??
      turns.find((u) => q.includes(u.text) && u.text.length > 0);
    // The API gives turn-level times only (often one turn for the whole note), so place the quote
    // proportionally inside its turn. It is an estimate, and the report and gateway say "around".
    const at = turn
      ? turn.startMs +
        (turn.text.includes(q) ? turn.text.indexOf(q) / Math.max(1, turn.text.length) : 0) *
          (turn.endMs - turn.startMs)
      : null;
    claims.push({
      ...base,
      provenance: "broker_stated",
      evidence: {
        kind: "voice",
        frame: null,
        t_sec: at === null ? null : at / 1000,
        box: null,
        confidence: null,
        concept: null,
        frames_detected: 0,
        image: null,
        quote: p.quote,
      },
      note: null,
    });
  }
  return { claims, discardedPrivate };
}
