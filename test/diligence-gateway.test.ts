import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Listing, ListingSchema } from "../src/claims/schema.ts";
import { reviewAttachments, type TitleReview } from "../src/diligence/review.ts";
import { AuditLog } from "../src/gateway/audit.ts";
import { GatewayCore } from "../src/gateway/core.ts";
import { OfflineAnswerModel } from "../src/gateway/offline-model.ts";
import { canonicalJson } from "../src/passport/merkle.ts";
import { Store } from "../src/store.ts";

const fx = (id: string): Listing =>
  ListingSchema.parse(
    JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "listings", `${id}.json`), "utf8"),
    ),
  );

const review = (status: TitleReview["status"]): TitleReview => {
  const body = {
    aval_title_review: 1 as const,
    listing_id: "demo-1",
    created_at: "2026-10-29T12:00:00.000Z",
    status,
    documents: [
      {
        file: "01-dominio.pdf",
        sha256: "a".repeat(64),
        doc_type: "certificado_dominio",
        type_confirmed: true,
      },
    ],
    findings: [
      {
        severity: "blocker" as const,
        rule: "OWNER_IS_NOT_SELLER",
        message: "The owner on the certificate of title is not the person selling.",
        evidence: [
          {
            doc_type: "certificado_dominio" as const,
            key: "propietario",
            page: 1,
            quote: "Ricardo Andres Mella Soto",
          },
        ],
      },
    ],
    disclaimer: "not legal advice",
  };
  return { ...body, hash: createHash("sha256").update(canonicalJson(body)).digest("hex") };
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "aval-dd-"));
  const store = new Store(dir);
  store.saveListing(fx("demo-1"));
  const core = new GatewayCore({
    store,
    model: new OfflineAnswerModel(),
    audit: new AuditLog(join(dir, "audit.jsonl")),
  });
  return { dir, store, core };
}
const anon = { agentId: null, tier: "anonymous" } as const;

describe("get_title_review", () => {
  it("says 'not reviewed' when there are no documents, never 'clear'", async () => {
    const { core } = setup();
    const r = await core.getTitleReview(anon, "demo-1");
    expect(r).toMatchObject({ ok: true, data: { status: "not_reviewed" } });
  });

  it("serves the status and rule names, and no personal data", async () => {
    const { core, store } = setup();
    writeFileSync(
      join(store.listingDir("demo-1"), "title-review.json"),
      JSON.stringify(review("blocked")),
    );
    const r = await core.getTitleReview(anon, "demo-1");
    expect(r).toMatchObject({
      ok: true,
      data: { status: "blocked", blockers: ["OWNER_IS_NOT_SELLER"] },
    });
    expect(JSON.stringify(r)).not.toContain("Mella");
  });

  it("a review edited on disk (blocked -> clear) is ignored", async () => {
    const { core, store } = setup();
    const forged = { ...review("blocked"), status: "clear" };
    writeFileSync(join(store.listingDir("demo-1"), "title-review.json"), JSON.stringify(forged));
    expect(await core.getTitleReview(anon, "demo-1")).toMatchObject({
      ok: true,
      data: { status: "not_reviewed" },
    });
  });

  it("an unknown listing looks like any other missing one", async () => {
    const { core } = setup();
    expect(await core.getTitleReview(anon, "nope-1")).toMatchObject({
      ok: false,
      code: "LISTING_NOT_FOUND",
    });
  });
});

describe("attachments for passports and term sheets", () => {
  it("binds the review hash and status; nothing for a tampered or missing review", () => {
    const { store } = setup();
    const dir = store.listingDir("demo-1");
    expect(reviewAttachments(dir)).toEqual({});
    const r = review("needs_attention");
    writeFileSync(join(dir, "title-review.json"), JSON.stringify(r));
    expect(reviewAttachments(dir)).toEqual({
      title_review: r.hash,
      title_review_status: "needs_attention",
    });
    writeFileSync(join(dir, "title-review.json"), JSON.stringify({ ...r, status: "clear" }));
    expect(reviewAttachments(dir)).toEqual({});
  });
});
