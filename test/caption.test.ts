import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Listing, ListingSchema } from "../src/claims/schema.ts";
import {
  buildCaption,
  type Caption,
  CaptionError,
  type CaptionModel,
  type CaptionSegment,
  verifyCaptionHash,
} from "../src/copy/caption.ts";
import { OfflineCaptionModel } from "../src/copy/caption-models.ts";

const fx = (id: string): Listing =>
  ListingSchema.parse(
    JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "listings", `${id}.json`), "utf8"),
    ),
  );
const fake = (segments: CaptionSegment[]): CaptionModel => ({ write: async () => ({ segments }) });
const demo = fx("demo-1");

describe("verified caption (offline writer)", () => {
  it("every sentence cites available facts; address, price, held-back and taste never appear", async () => {
    const cap = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "en",
      model: new OfflineCaptionModel(),
      base: "http://x",
    });
    expect(cap.sentences.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(demo.claims.map((c) => c.id));
    for (const s of cap.sentences) for (const id of s.claim_ids) expect(ids.has(id)).toBe(true);
    for (const forbidden of ["Irarrazaval", "3550", "5250", "wardrobe", "bright", "quiet"])
      expect(cap.text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    expect(cap.link).toBe("http://x/l/demo-1/showroom");
    expect(cap.hashtags).toEqual(["#forsale", "#nunoa", "#departamento"]);
    expect(cap.text).toContain("See the verified walkthrough");
  });
  it("says what it left out and why, without storing the exact price or the address", async () => {
    const cap = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "en",
      model: new OfflineCaptionModel(),
    });
    const reasons = cap.withheld.map((w) => w.reason).join("|");
    expect(reasons).toMatch(/no evidence in the video/);
    expect(reasons).toMatch(/taste word/);
    expect(reasons).toMatch(/only said by the broker/);
    const stored = JSON.stringify(cap);
    expect(stored).not.toMatch(/5250|Irarrazaval|3550/);
    expect(cap.withheld.some((w) => /wardrobe/i.test(w.statement))).toBe(true);
  });
  it("uses facts only said in a voice note only when asked", async () => {
    const floor = demo.claims.find((c) => /floor 12/i.test(c.statement));
    if (!floor) throw new Error("fixture changed");
    const m2 = fake([
      { text: "Located on floor 12.", claim_ids: [floor.id] },
      { text: "For sale.", claim_ids: ["d-operation"] },
      { text: "2 bedrooms.", claim_ids: ["d-bedrooms"] },
    ]);
    const without = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "en",
      model: m2,
    });
    expect(without.text).not.toContain("floor 12");
    expect(without.dropped[0]?.reason).toMatch(/not available for copy/);
    const withIt = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "en",
      model: m2,
      includeStated: true,
    });
    expect(withIt.text).toContain("floor 12");
  });
  it("works for a seller that serves only identified agents (a public ad is not the registry)", async () => {
    const cap = await buildCaption({
      listing: fx("casa-la-reina"),
      channel: "instagram",
      language: "en",
      model: new OfflineCaptionModel(),
    });
    expect(cap.sentences.length).toBeGreaterThan(1);
  });
});

describe("the checker removes what a writer should not say", () => {
  const f = (id: string) => demo.claims.find((c) => c.id === id) as Listing["claims"][number];
  const good: CaptionSegment[] = [
    { text: "For sale.", claim_ids: ["d-operation"] },
    { text: "2 bedrooms and 1 bathroom.", claim_ids: ["d-bedrooms", "d-bathrooms"] },
  ];
  const attacks: Array<[string, CaptionSegment, RegExp]> = [
    ["a taste word", { text: "Bright 2 bedrooms.", claim_ids: ["d-bedrooms"] }, /taste/],
    [
      "an invented adjective",
      { text: "Elegant 2 bedrooms.", claim_ids: ["d-bedrooms"] },
      /not found in the cited facts/,
    ],
    [
      "a number word that changes the number",
      { text: "Three bedrooms.", claim_ids: ["d-bedrooms"] },
      /not found in the cited facts/,
    ],
    [
      "a wrong digit",
      { text: "5 bedrooms.", claim_ids: ["d-bedrooms"] },
      /not found in the cited facts/,
    ],
    [
      "an unknown fact id",
      { text: "2 bedrooms.", claim_ids: ["nope"] },
      /cites no fact|not available/,
    ],
    ["no cited fact", { text: "2 bedrooms.", claim_ids: [] }, /cites no fact|not available/],
    [
      "the address",
      { text: "Located at Irarrazaval 3550.", claim_ids: ["d-commune"] },
      /seller does not allow|not found/,
    ],
    [
      "a phone number",
      { text: "Call 2 bedrooms +56 9 1234 5678.", claim_ids: ["d-bedrooms"] },
      /contact details/,
    ],
    [
      "a link",
      { text: "2 bedrooms http://evil.example.", claim_ids: ["d-bedrooms"] },
      /contact details/,
    ],
    [
      "a held-back claim",
      { text: "Wardrobe wall beside bed.", claim_ids: [f("c10")?.id ?? "x"] },
      /not available/,
    ],
  ];
  for (const [name, bad, why] of attacks) {
    it(`drops ${name} and keeps the rest`, async () => {
      const cap = await buildCaption({
        listing: demo,
        channel: "instagram",
        language: "en",
        model: fake([...good, bad]),
      });
      expect(cap.sentences.map((s) => s.english)).toEqual(good.map((g) => g.text));
      expect(cap.dropped).toHaveLength(1);
      expect(cap.dropped[0]?.reason).toMatch(why);
    });
  }
  it("the forbidden-value layer works on its own: a grounded sentence that carries the hidden price is still dropped", async () => {
    // an allowed fact whose text happens to contain the hidden price: grounded, but the seller forbids the number
    const l = {
      ...demo,
      claims: demo.claims.map((c) => (c.id === "d-area" ? { ...c, statement: "5250 m2" } : c)),
    };
    const cap = await buildCaption({
      listing: l,
      channel: "instagram",
      language: "en",
      model: fake([...good, { text: "5250 m2.", claim_ids: ["d-area"] }]),
    });
    expect(cap.sentences.map((s) => s.english)).toEqual(good.map((g) => g.text));
    expect(cap.dropped[0]?.reason).toMatch(/seller does not allow/);
  });
  it("refuses to write a caption when almost nothing survives", async () => {
    await expect(
      buildCaption({
        listing: demo,
        channel: "instagram",
        language: "en",
        model: fake([{ text: "Bright and quiet.", claim_ids: ["d-bedrooms"] }]),
      }),
    ).rejects.toMatchObject({ code: "NOT_ENOUGH_VERIFIED_FACTS" });
  });
  it("leaves the price out under a range policy and allows it when the seller shows it exactly", async () => {
    const priceSeg: CaptionSegment = { text: "Price UF 5250.", claim_ids: ["d-price"] };
    const ranged = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "en",
      model: fake([...good, priceSeg]),
    });
    expect(ranged.text).not.toContain("5250");
    expect(ranged.dropped.length).toBe(1);
    const exact = { ...demo, policy: { ...demo.policy, priceVisibility: "exact" as const } };
    const open = await buildCaption({
      listing: exact,
      channel: "instagram",
      language: "en",
      model: fake([...good, priceSeg]),
    });
    expect(open.text).toContain("5250");
  });
  it("the portal channel allows more sentences than Instagram", async () => {
    const many = demo.claims
      .filter((c) => c.provenance === "visually_verified")
      .map((c) => ({ text: `${c.statement}.`, claim_ids: [c.id] }));
    const ig = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "en",
      model: fake(many),
    });
    const portal = await buildCaption({
      listing: demo,
      channel: "portal",
      language: "en",
      model: fake(many),
    });
    expect(ig.sentences.length).toBe(7);
    expect(portal.sentences.length).toBeGreaterThan(7);
    expect(portal.hashtags).toEqual([]);
  });
});

describe("Spanish and integrity", () => {
  const model = new OfflineCaptionModel();
  it("translates each sentence and keeps the verified English beside it", async () => {
    const cap = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "es",
      model,
      translator: { toSpanish: async (t) => `ES ${t}` },
    });
    expect(cap.sentences[0]?.text.startsWith("ES ")).toBe(true);
    expect(cap.sentences[0]?.english.startsWith("ES ")).toBe(false);
    expect(cap.hashtags).toContain("#venta");
  });
  it("fails loudly instead of mixing languages, or without a translator", async () => {
    await expect(
      buildCaption({
        listing: demo,
        channel: "instagram",
        language: "es",
        model,
        translator: { toSpanish: async () => null },
      }),
    ).rejects.toBeInstanceOf(CaptionError);
    await expect(
      buildCaption({ listing: demo, channel: "instagram", language: "es", model }),
    ).rejects.toMatchObject({ code: "TRANSLATION_UNAVAILABLE" });
  });
  it("a caption edited by hand no longer matches its hash", async () => {
    const cap: Caption = await buildCaption({
      listing: demo,
      channel: "instagram",
      language: "en",
      model,
    });
    expect(verifyCaptionHash(cap)).toBe(true);
    expect(verifyCaptionHash({ ...cap, text: `${cap.text} Best investment in town!` })).toBe(false);
  });
});
