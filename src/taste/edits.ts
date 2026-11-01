import type { Store } from "../store.ts";

export interface EditRecord {
  at: string;
  listing_id: string;
  claim_id: string;
  before: string;
  after: string;
}

export interface StyleGuide {
  /** Words the broker keeps deleting. */
  avoid: string[];
  /** The broker consistently shortens statements. */
  shorter: boolean;
  examples: Array<{ before: string; after: string }>;
  edits: number;
}

const EDITS = "taste-edits.jsonl";

const words = (s: string): string[] => s.toLowerCase().match(/[a-záéíóúñ]{4,}/g) ?? [];

/**
 * Every correction the broker makes is a free label: an eval case ("given this, the broker wanted
 * that") and a style signal fed back into the next extraction prompt. Wording only: edits can
 * never change provenance, so taste can never turn an unproven claim into a proven one.
 */
export function recordEdit(store: Store, rec: EditRecord): void {
  store.appendJsonl(EDITS, rec);
}

export function applyClaimEdit(
  store: Store,
  listingId: string,
  claimId: string,
  after: string,
  now = new Date(),
): EditRecord {
  const listing = store.loadListing(listingId);
  if (!listing) throw new Error(`No such listing: ${listingId}`);
  const claim = listing.claims.find((c) => c.id === claimId);
  if (!claim) throw new Error(`No such claim: ${claimId}`);
  const text = after.trim();
  if (!text || text.length > 200) throw new Error("Statement must be 1-200 characters.");
  const rec: EditRecord = {
    at: now.toISOString(),
    listing_id: listingId,
    claim_id: claimId,
    before: claim.statement,
    after: text,
  };
  claim.statement = text;
  store.saveListing(listing);
  recordEdit(store, rec);
  return rec;
}

export function styleGuide(store: Store): StyleGuide {
  const edits = store.readJsonl<EditRecord>(EDITS);
  const removed = new Map<string, number>();
  let shortened = 0;
  for (const e of edits) {
    const after = new Set(words(e.after));
    for (const w of new Set(words(e.before)))
      if (!after.has(w)) removed.set(w, (removed.get(w) ?? 0) + 1);
    if (e.after.length < e.before.length * 0.85) shortened++;
  }
  return {
    avoid: [...removed.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w)
      .slice(0, 12),
    shorter: edits.length >= 2 && shortened / edits.length >= 0.5,
    examples: edits.slice(-3).map((e) => ({ before: e.before, after: e.after })),
    edits: edits.length,
  };
}

export function styleNotes(g: StyleGuide): string {
  if (g.edits === 0) return "";
  const lines: string[] = [];
  if (g.avoid.length > 0)
    lines.push(`Avoid these words, the broker keeps deleting them: ${g.avoid.join(", ")}.`);
  if (g.shorter) lines.push("Prefer shorter statements.");
  for (const e of g.examples) lines.push(`Broker changed "${e.before}" to "${e.after}".`);
  return lines.join("\n");
}

/** Regression cases for the extraction prompt: what the broker wanted instead of what was proposed. */
export function evalCases(store: Store): Array<{ input: string; expected: string }> {
  return store.readJsonl<EditRecord>(EDITS).map((e) => ({ input: e.before, expected: e.after }));
}
