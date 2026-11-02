import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Listing, ListingSchema } from "../src/claims/schema.ts";
import {
  canonicalJson,
  leafHash,
  merkleProof,
  merkleRoot,
  verifyMerkleProof,
} from "../src/passport/merkle.ts";
import {
  issuePassport,
  proveFact,
  publicKeyOf,
  verifyFactProof,
  verifyPassport,
} from "../src/passport/passport.ts";

const fx = (id: string): Listing =>
  ListingSchema.parse(
    JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "listings", `${id}.json`), "utf8"),
    ),
  );
const key = () => ({
  id: "aval-test",
  privateKeyPem: generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
});
const now = new Date("2026-11-03T12:00:00Z");

describe("Merkle tree", () => {
  it("proves each leaf of trees of any size, and rejects a wrong leaf or root", () => {
    for (const n of [1, 2, 3, 5, 8, 13]) {
      const leaves = Array.from({ length: n }, (_, i) => leafHash({ i }));
      const root = merkleRoot(leaves);
      for (let i = 0; i < n; i++)
        expect(verifyMerkleProof(leaves[i] as string, merkleProof(leaves, i), root)).toBe(true);
      expect(verifyMerkleProof(leafHash({ i: 999 }), merkleProof(leaves, 0), root)).toBe(false);
      expect(
        verifyMerkleProof(
          leaves[0] as string,
          merkleProof(leaves, 0),
          merkleRoot([...leaves, leafHash("x")]),
        ),
      ).toBe(false);
    }
  });

  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
    );
  });
});

describe("Listing Passport", () => {
  it("is issued from the public view only: no address, no exact price, nothing held back", () => {
    const p = issuePassport(fx("demo-1"), key(), { now });
    const text = JSON.stringify(p).toLowerCase();
    for (const s of ["irarrazaval", "3550", "1204", "5250", "4900", "wardrobe", "bright"])
      expect(text).not.toContain(s);
    expect(p.facts.some((f) => f.provenance === "visually_verified")).toBe(true);
    expect(verifyPassport(p, { now })).toEqual({ valid: true, reasons: [] });
  });

  it("detects any tampering: a changed fact, a promoted provenance, an added or removed fact", () => {
    const p = issuePassport(fx("demo-1"), key(), { now });
    const edit = (f: (c: typeof p) => void) => {
      const c = structuredClone(p);
      f(c);
      return verifyPassport(c, { now });
    };
    expect(
      edit((c) => {
        (c.facts[0] as { statement: string }).statement = "Has a pool";
      }).valid,
    ).toBe(false);
    expect(
      edit((c) => {
        (
          c.facts.find((f) => f.provenance === "broker_declared") as { provenance: string }
        ).provenance = "visually_verified";
      }).valid,
    ).toBe(false);
    expect(
      edit((c) => {
        c.facts.push({
          id: "x",
          statement: "Free gift",
          provenance: "visually_verified",
          evidence: "seen",
        });
      }).valid,
    ).toBe(false);
    expect(
      edit((c) => {
        c.facts.pop();
      }).valid,
    ).toBe(false);
    expect(
      edit((c) => {
        c.header.merkle_root = "0".repeat(64);
      }).reasons.join(),
    ).toMatch(/signature/);
  });

  it("rejects a forged signature, an untrusted issuer, and an expired or future-dated passport", () => {
    const k = key();
    const p = issuePassport(fx("demo-1"), k, { now });
    const forged = {
      ...p,
      header: { ...p.header, issuer: { id: "x", public_key: publicKeyOf(key().privateKeyPem) } },
    };
    expect(verifyPassport(forged, { now }).valid).toBe(false);
    expect(
      verifyPassport(p, { now, trustedKeys: [publicKeyOf(key().privateKeyPem)] }).reasons.join(),
    ).toMatch(/trusted/);
    expect(verifyPassport(p, { now, trustedKeys: [p.header.issuer.public_key] }).valid).toBe(true);
    expect(verifyPassport(p, { now: new Date("2026-12-30T00:00:00Z") }).reasons.join()).toMatch(
      /expired/,
    );
    expect(verifyPassport(p, { now: new Date("2026-10-01T00:00:00Z") }).reasons.join()).toMatch(
      /future/,
    );
  });

  it("proves a single fact without revealing the others, and the proof breaks if the fact is altered", () => {
    const p = issuePassport(fx("demo-1"), key(), { now });
    const id = p.facts.find((f) => f.provenance === "visually_verified")?.id as string;
    const proof = proveFact(p, id);
    expect(JSON.stringify(proof)).not.toContain(
      p.facts.find((f) => f.id !== id && f.provenance === "broker_stated")?.statement ??
        "unreachable",
    );
    expect(verifyFactProof(proof, { now })).toEqual({ valid: true, reasons: [] });
    expect(
      verifyFactProof({ ...proof, fact: { ...proof.fact, statement: "Something else" } }, { now })
        .valid,
    ).toBe(false);
    expect(() => proveFact(p, "nope")).toThrow(/No fact/);
  });

  it("binds the evidence picture: its hash is part of the fact, so swapping the image breaks verification", () => {
    const dir = mkdtempSync(join(tmpdir(), "aval-pass-"));
    mkdirSync(join(dir, "evidence"), { recursive: true });
    const listing = fx("demo-1");
    const verifiedClaim = listing.claims.find(
      (c) => c.provenance === "visually_verified" && c.evidence?.image,
    );
    expect(verifiedClaim).toBeDefined();
    writeFileSync(join(dir, verifiedClaim?.evidence?.image as string), "the real frame");
    const p = issuePassport(listing, key(), { now, listingDir: dir });
    const f = p.facts.find((x) => x.id === verifiedClaim?.id);
    expect(f?.evidence_image_sha256).toMatch(/^[0-9a-f]{64}$/);
    const swapped = structuredClone(p);
    (
      swapped.facts.find((x) => x.id === verifiedClaim?.id) as { evidence_image_sha256: string }
    ).evidence_image_sha256 = "0".repeat(64);
    expect(verifyPassport(swapped, { now }).valid).toBe(false);
  });

  it("will not issue a public passport for a seller that serves only identified agents", () => {
    expect(() => issuePassport(fx("casa-la-reina"), key(), { now })).toThrow(/does not serve/);
  });

  it("carries commitments to other records (attachments) inside the signature", () => {
    const p = issuePassport(fx("demo-1"), key(), {
      now,
      attachments: { title_review: "a".repeat(64) },
    });
    expect(verifyPassport(p, { now }).valid).toBe(true);
    const c = structuredClone(p);
    (c.header.attachments as Record<string, string>).title_review = "b".repeat(64);
    expect(verifyPassport(c, { now }).valid).toBe(false);
  });
});
