import { createHash } from "node:crypto";
import { TYPES } from "../adapters/agentsales-export.ts";
import { hasContactDetails, hasTasteWord } from "../adapters/sanitize.ts";
import type { Listing } from "../claims/schema.ts";
import { stripAccents } from "../extract/spanish.ts";
import { normalize, ungroundedTerms } from "../gateway/answer.ts";
import { forbiddenStrings, type VisibleFact, visibleFacts } from "../gateway/policy.ts";
import type { AnswerTranslator } from "../gateway/translate.ts";
import { canonicalJson } from "../passport/merkle.ts";

/**
 * Copy for a listing that can only say what is proven. The model writes sentences and names the facts
 * each one rests on; the code then checks EVERY sentence the same way answers are checked: the facts must
 * exist and be allowed in copy, every word and number must come from them, and nothing the seller
 * forbids (the address, an exact price under a range policy), no taste word and no contact detail may
 * appear. A sentence that fails is dropped and reported; what was left out, and why, is listed.
 *
 * Only what the seller lets the public see is ever offered to the model (same door as the agents), and
 * by default only facts verified in the video or declared by the broker: what was merely said in a voice
 * note stays out unless asked for.
 */
// The broker's own copy: the same disclosure rules as for any caller (address, price), but a seller that
// serves only identified agents in the registry can still advertise in public.
const BROKER = { agentId: "broker-copy", tier: "verified" } as const;

export type Channel = "instagram" | "portal";
export interface CaptionSegment {
  text: string;
  claim_ids: string[];
}
export interface CaptionModel {
  write(args: {
    facts: VisibleFact[];
    channel: Channel;
    title: string;
    maxSentences: number;
  }): Promise<{ segments: CaptionSegment[] }>;
}

export class CaptionError extends Error {
  readonly code: "NOT_ENOUGH_VERIFIED_FACTS" | "TRANSLATION_UNAVAILABLE";
  constructor(code: CaptionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface Caption {
  aval_caption: 1;
  listing_id: string;
  channel: Channel;
  language: "en" | "es";
  created_at: string;
  /** What to publish: the sentences, the link and the hashtags. */
  text: string;
  sentences: Array<{ text: string; english: string; claim_ids: string[]; provenance: string[] }>;
  hashtags: string[];
  link: string | null;
  /** Claims that were not used, and why. */
  withheld: Array<{ statement: string; reason: string }>;
  /** Sentences the model wrote and the checker removed, and why. */
  dropped: Array<{ text: string; reason: string }>;
  hash: string;
}

export interface CaptionOptions {
  listing: Listing;
  channel: Channel;
  language: "en" | "es";
  model: CaptionModel;
  translator?: AnswerTranslator;
  base?: string;
  includeStated?: boolean;
  now?: Date;
}

const endWithPunctuation = (t: string): string =>
  /[.!?…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`;

const MAX_SENTENCES: Record<Channel, number> = { instagram: 7, portal: 14 };

function allowedFacts(listing: Listing, includeStated: boolean): VisibleFact[] {
  return visibleFacts(listing, BROKER).filter((f) => {
    if (f.provenance === "broker_stated" && !includeStated) return false;
    // An approximate range is not an advertised price: copy leaves the price out unless the seller shows it exactly.
    if (f.id === "d-price" && listing.policy.priceVisibility !== "exact") return false;
    return true;
  });
}

function whyWithheld(
  listing: Listing,
  claim: Listing["claims"][number],
  includeStated: boolean,
): string | null {
  if (claim.id === "d-address") return "the address is never used in copy";
  if (claim.id === "d-price" && listing.policy.priceVisibility !== "exact")
    return "the seller shows only a range, not a price";
  switch (claim.provenance) {
    case "unverified":
      return "no evidence in the video (held back)";
    case "subjective":
      return "a taste word, never asserted";
    case "broker_stated":
      return includeStated
        ? null
        : "only said by the broker, not verified (use --include-stated to allow)";
    default:
      return null;
  }
}

function hashtags(listing: Listing, language: "en" | "es"): string[] {
  const slug = (s: string) => stripAccents(s.toLowerCase()).replace(/[^a-z0-9]/g, "");
  const type = TYPES.find(([re]) => re.test(listing.declared.title))?.[1];
  const op =
    listing.declared.operation === "sale"
      ? language === "es"
        ? "venta"
        : "forsale"
      : language === "es"
        ? "arriendo"
        : "forrent";
  return [
    ...new Set([op, slug(listing.declared.commune), type ? slug(type) : ""].filter(Boolean)),
  ].map((t) => `#${t}`);
}

export async function buildCaption(o: CaptionOptions): Promise<Caption> {
  const facts = allowedFacts(o.listing, o.includeStated === true);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const forbidden = forbiddenStrings(o.listing);
  const max = MAX_SENTENCES[o.channel];
  const raw = await o.model.write({
    facts,
    channel: o.channel,
    title: o.listing.declared.title,
    maxSentences: max,
  });

  const kept: Array<{ text: string; claim_ids: string[] }> = [];
  const dropped: Caption["dropped"] = [];
  const seen = new Set<string>();
  for (const seg of raw.segments) {
    const text = seg.text.replace(/\s+/g, " ").trim();
    const drop = (reason: string) => dropped.push({ text: text.slice(0, 160), reason });
    if (text === "") continue;
    if (seg.claim_ids.length === 0 || !seg.claim_ids.every((id) => byId.has(id))) {
      drop("cites no fact, or a fact that is not available for copy");
      continue;
    }
    if (forbidden.some((s) => normalize(text).includes(normalize(s)))) {
      drop("contains something the seller does not allow (address or exact price)");
      continue;
    }
    if (hasTasteWord(text)) {
      drop("taste or promotional word");
      continue;
    }
    if (hasContactDetails(text)) {
      drop("contact details or a link");
      continue;
    }
    const bad = ungroundedTerms(
      text,
      seg.claim_ids.map((id) => byId.get(id) as VisibleFact),
    );
    if (bad.length > 0) {
      drop(`words or numbers not found in the cited facts: ${bad.join(", ")}`);
      continue;
    }
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    if (kept.length < max) kept.push({ text, claim_ids: [...new Set(seg.claim_ids)] });
  }
  if (kept.length < 2)
    throw new CaptionError(
      "NOT_ENOUGH_VERIFIED_FACTS",
      `Only ${kept.length} sentence(s) survived verification: there is not enough proven to write a caption.`,
    );

  let sentences = kept.map((k) => ({ ...k, english: k.text }));
  if (o.language === "es") {
    if (!o.translator)
      throw new CaptionError(
        "TRANSLATION_UNAVAILABLE",
        "A Spanish caption needs the translator (not available offline). Use --language en.",
      );
    const translated = await Promise.all(
      sentences.map((s) => o.translator?.toSpanish(s.english) ?? Promise.resolve(null)),
    );
    if (translated.some((t) => t === null))
      throw new CaptionError(
        "TRANSLATION_UNAVAILABLE",
        "A sentence could not be translated faithfully (its numbers changed or the model was unavailable). Try again or use --language en.",
      );
    sentences = sentences.map((s, i) => ({
      ...s,
      text: endWithPunctuation(translated[i] as string),
    }));
  }

  const link = o.base ? `${o.base.replace(/\/+$/, "")}/l/${o.listing.id}/showroom` : null;
  const tags = o.channel === "instagram" ? hashtags(o.listing, o.language) : [];
  const text = [
    sentences.map((s) => s.text).join("\n"),
    link
      ? `${o.language === "es" ? "Mira el recorrido verificado" : "See the verified walkthrough"}: ${link}`
      : "",
    tags.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");

  const withheld: Caption["withheld"] = [];
  for (const c of o.listing.claims) {
    const why = whyWithheld(o.listing, c, o.includeStated === true);
    if (why)
      withheld.push({
        statement:
          c.id === "d-address"
            ? "(the address)"
            : c.id === "d-price"
              ? "(the exact price)"
              : c.statement,
        reason: why,
      });
  }
  const body = {
    aval_caption: 1 as const,
    listing_id: o.listing.id,
    channel: o.channel,
    language: o.language,
    created_at: (o.now ?? new Date()).toISOString(),
    text,
    sentences: sentences.map((s) => ({
      text: s.text,
      english: s.english,
      claim_ids: s.claim_ids,
      provenance: [...new Set(s.claim_ids.map((id) => (byId.get(id) as VisibleFact).provenance))],
    })),
    hashtags: tags,
    link,
    withheld,
    dropped,
  };
  return { ...body, hash: createHash("sha256").update(canonicalJson(body)).digest("hex") };
}

/** A stored caption whose contents no longer match its hash (edited by hand) is not trusted. */
export function verifyCaptionHash(c: Caption): boolean {
  const { hash, ...body } = c;
  return createHash("sha256").update(canonicalJson(body)).digest("hex") === hash;
}
