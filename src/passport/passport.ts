import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Listing } from "../claims/schema.ts";
import { publicFacts } from "../gateway/pages.ts";
import type { VisibleFact } from "../gateway/policy.ts";
import {
  canonicalJson,
  leafHash,
  merkleProof,
  merkleRoot,
  type ProofStep,
  sha256,
  verifyMerkleProof,
} from "./merkle.ts";

/**
 * A Listing Passport is the listing's public record, signed. It lists exactly what an unidentified agent
 * may be told (no address, no secrets, nothing held back), commits to every fact in a Merkle tree, and
 * signs the root with the issuer's key. Anyone (an agent, an insurer, a buyer's lawyer) can check it
 * offline without trusting this server, and can check ONE fact without seeing the others.
 */
export interface PassportFact {
  id: string;
  statement: string;
  provenance: VisibleFact["provenance"];
  evidence: string;
  /** SHA-256 of the annotated evidence frame, so the picture itself is bound to the claim. */
  evidence_image_sha256?: string;
}

export interface PassportHeader {
  aval_passport: 1;
  listing_id: string;
  title: string;
  issued_at: string;
  expires_at: string;
  issuer: { id: string; public_key: string };
  merkle_root: string;
  fact_count: number;
  /** Optional commitments to other records about the listing (e.g. the title review). */
  attachments?: Record<string, string>;
}

export interface Passport {
  header: PassportHeader;
  /** Ed25519 over canonicalJson(header), base64. */
  signature: string;
  facts: PassportFact[];
}

export interface Issuer {
  id: string;
  privateKeyPem: string;
}

const DAY = 86_400_000;

export function publicKeyOf(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: "spki", format: "der" })
    .toString("base64");
}

function imageHash(listingDir: string | null, listing: Listing, id: string): string | undefined {
  const image = listing.claims.find((c) => c.id === id)?.evidence?.image;
  if (!listingDir || !image) return undefined;
  const path = join(listingDir, image);
  return existsSync(path) ? sha256(readFileSync(path)) : undefined;
}

export function issuePassport(
  listing: Listing,
  issuer: Issuer,
  opts: {
    now?: Date;
    validDays?: number;
    listingDir?: string | null;
    attachments?: Record<string, string>;
  } = {},
): Passport {
  const facts = publicFacts(listing);
  if (!facts)
    throw new Error(
      "This seller does not serve unidentified agents; there is no public passport to issue.",
    );
  const now = opts.now ?? new Date();
  const pf: PassportFact[] = facts.map((f) => {
    const h = imageHash(opts.listingDir ?? null, listing, f.id);
    return {
      id: f.id,
      statement: f.statement,
      provenance: f.provenance,
      evidence: f.evidence,
      ...(h ? { evidence_image_sha256: h } : {}),
    };
  });
  const header: PassportHeader = {
    aval_passport: 1,
    listing_id: listing.id,
    title: listing.declared.title,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (opts.validDays ?? 30) * DAY).toISOString(),
    issuer: { id: issuer.id, public_key: publicKeyOf(issuer.privateKeyPem) },
    merkle_root: merkleRoot(pf.map(leafHash)),
    fact_count: pf.length,
    ...(opts.attachments && Object.keys(opts.attachments).length > 0
      ? { attachments: opts.attachments }
      : {}),
  };
  const signature = sign(
    null,
    Buffer.from(canonicalJson(header)),
    createPrivateKey(issuer.privateKeyPem),
  ).toString("base64");
  return { header, signature, facts: pf };
}

export interface VerifyResult {
  valid: boolean;
  reasons: string[];
}

function signatureOk(header: PassportHeader, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(header.issuer.public_key, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(canonicalJson(header)), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Offline check. Pass `trustedKeys` to require that the issuer is one you already trust. */
export function verifyPassport(
  p: Passport,
  opts: { now?: Date; trustedKeys?: string[] } = {},
): VerifyResult {
  const reasons: string[] = [];
  if (p.header?.aval_passport !== 1) reasons.push("unknown passport version");
  if (!signatureOk(p.header, p.signature)) reasons.push("the signature does not match the header");
  if (merkleRoot(p.facts.map(leafHash)) !== p.header.merkle_root)
    reasons.push(
      "the facts do not match the signed Merkle root (something was added, removed or edited)",
    );
  if (p.facts.length !== p.header.fact_count)
    reasons.push("the number of facts does not match the header");
  const now = (opts.now ?? new Date()).getTime();
  if (now > Date.parse(p.header.expires_at)) reasons.push("the passport has expired");
  if (now < Date.parse(p.header.issued_at) - 5 * 60_000)
    reasons.push("the passport is dated in the future");
  if (opts.trustedKeys && !opts.trustedKeys.includes(p.header.issuer.public_key))
    reasons.push("the issuer is not one of the trusted keys");
  return { valid: reasons.length === 0, reasons };
}

export interface FactProof {
  header: PassportHeader;
  signature: string;
  fact: PassportFact;
  path: ProofStep[];
}

/** Selective disclosure: prove one fact belongs to the signed passport, revealing none of the others. */
export function proveFact(p: Passport, factId: string): FactProof {
  const index = p.facts.findIndex((f) => f.id === factId);
  if (index < 0) throw new Error(`No fact ${factId} in this passport`);
  return {
    header: p.header,
    signature: p.signature,
    fact: p.facts[index] as PassportFact,
    path: merkleProof(p.facts.map(leafHash), index),
  };
}

export function verifyFactProof(
  proof: FactProof,
  opts: { now?: Date; trustedKeys?: string[] } = {},
): VerifyResult {
  const reasons: string[] = [];
  if (!signatureOk(proof.header, proof.signature))
    reasons.push("the signature does not match the header");
  if (!verifyMerkleProof(leafHash(proof.fact), proof.path, proof.header.merkle_root))
    reasons.push("the fact is not part of the signed Merkle root");
  if ((opts.now ?? new Date()).getTime() > Date.parse(proof.header.expires_at))
    reasons.push("the passport has expired");
  if (opts.trustedKeys && !opts.trustedKeys.includes(proof.header.issuer.public_key))
    reasons.push("the issuer is not one of the trusted keys");
  return { valid: reasons.length === 0, reasons };
}
