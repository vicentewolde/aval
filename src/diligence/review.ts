import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Listing } from "../claims/schema.ts";
import { canonicalJson } from "../passport/merkle.ts";
import { pdfPages } from "./pdf.ts";
import type { DocReader } from "./reader.ts";
import { type Finding, type ReviewStatus, runRules, statusOf } from "./rules.ts";
import type { SellerIdentity } from "./schema.ts";
import { type VerifiedDoc, verifyExtraction } from "./verify.ts";

export const DISCLAIMER =
  "Automated reading of the documents provided. Not legal advice and not a substitute for a lawyer or a notary: a title study before a promesa or escritura must be done by one.";

export interface TitleReview {
  aval_title_review: 1;
  listing_id: string;
  created_at: string;
  status: ReviewStatus;
  /** sha256 of each PDF reviewed: the review is about exactly those bytes. */
  documents: Array<{ file: string; sha256: string; doc_type: string; type_confirmed: boolean }>;
  findings: Finding[];
  disclaimer: string;
  /** sha256 of the canonical JSON of everything above. Bound into passports and term sheets. */
  hash: string;
}

export async function reviewTitle(opts: {
  listing: Listing;
  seller: SellerIdentity;
  files: string[];
  reader: DocReader;
  now: Date;
}): Promise<TitleReview> {
  const docs: VerifiedDoc[] = [];
  const documents: TitleReview["documents"] = [];
  for (const file of opts.files) {
    const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
    const pages = await pdfPages(file);
    const extraction = await opts.reader.read(file);
    const verified = verifyExtraction(extraction, pages);
    docs.push(verified);
    documents.push({
      file: basename(file),
      sha256,
      doc_type: verified.doc_type,
      type_confirmed: verified.type_confirmed,
    });
  }
  const findings = runRules(docs, opts.seller, opts.listing, opts.now);
  const body = {
    aval_title_review: 1 as const,
    listing_id: opts.listing.id,
    created_at: opts.now.toISOString(),
    status: statusOf(findings, docs),
    documents,
    findings,
    disclaimer: DISCLAIMER,
  };
  return { ...body, hash: createHash("sha256").update(canonicalJson(body)).digest("hex") };
}

export function verifyReviewHash(r: TitleReview): boolean {
  const { hash, ...body } = r;
  return createHash("sha256").update(canonicalJson(body)).digest("hex") === hash;
}

/**
 * What an agent or a public page may see: the status, how many documents and the rule names that fired.
 * Never names, RUTs, quotes or amounts: those are the seller's private data.
 */
export function publicSummary(r: TitleReview): {
  status: ReviewStatus;
  documents: number;
  blockers: string[];
  warnings: string[];
  review_hash: string;
  disclaimer: string;
} {
  return {
    status: r.status,
    documents: r.documents.filter((d) => d.type_confirmed).length,
    blockers: [...new Set(r.findings.filter((f) => f.severity === "blocker").map((f) => f.rule))],
    warnings: [...new Set(r.findings.filter((f) => f.severity === "warning").map((f) => f.rule))],
    review_hash: r.hash,
    disclaimer: r.disclaimer,
  };
}

/** The review's hash and status as attachments for a passport or term sheet; empty if none (or tampered). */
export function reviewAttachments(listingDir: string): Record<string, string> {
  const path = join(listingDir, "title-review.json");
  if (!existsSync(path)) return {};
  const r = JSON.parse(readFileSync(path, "utf8")) as TitleReview;
  if (!verifyReviewHash(r)) return {};
  return { title_review: r.hash, title_review_status: r.status };
}
