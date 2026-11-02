import { describe, expect, it } from "vitest";
import { type Claim, DEFAULT_POLICY, type Declared, type Listing } from "../src/claims/schema.ts";
import { declaredClaims } from "../src/claims/verify.ts";
import type { Caller } from "../src/gateway/policy.ts";
import { type Criteria, searchListings } from "../src/gateway/search.ts";

const verified = (id: string, statement: string): Claim => ({
  id,
  category: "feature",
  statement,
  provenance: "visually_verified",
  evidence: {
    kind: "visual",
    frame: 1,
    t_sec: 1,
    box: null,
    confidence: 0.9,
    concept: statement,
    frames_detected: 3,
    image: null,
  },
  note: null,
});
const stated = (id: string, statement: string): Claim => ({
  id,
  category: "feature",
  statement,
  provenance: "broker_stated",
  evidence: {
    kind: "voice",
    frame: null,
    t_sec: 4,
    box: null,
    confidence: null,
    concept: null,
    frames_detected: 0,
    image: null,
    quote: "dicho por el corredor",
  },
  note: null,
});

function listing(
  id: string,
  d: Partial<Declared>,
  claims: Claim[] = [],
  policy: Partial<Listing["policy"]> = {},
): Listing {
  const declared: Declared = {
    title: `Listing ${id}`,
    operation: "sale",
    commune: "Nunoa",
    address: "Av. Secreta 123",
    price: { amount: 5000, currency: "UF" },
    area_m2: 60,
    bedrooms: 2,
    bathrooms: 1,
    pets_allowed: true,
    ...d,
  };
  return {
    id,
    createdAt: "2026-11-01T00:00:00Z",
    declared,
    policy: { ...DEFAULT_POLICY, priceVisibility: "exact", ...policy },
    claims: [...declaredClaims(declared, "b", "2026-11-01T00:00:00Z"), ...claims],
  };
}

const caller = { agentId: "a1", tier: "verified" as const };
const anon = { agentId: null, tier: "anonymous" as const };
const run = (ls: Listing[], c: Criteria, who: Caller = caller) => searchListings(ls, who, c);

describe("hard criteria exclude, with a reason", () => {
  const ls = [
    listing("a", {}),
    listing("b", { operation: "rent" }),
    listing("c", { commune: "Providencia" }),
    listing("d", { bedrooms: 1 }),
    listing("e", { pets_allowed: false }),
  ];

  it("filters by operation, commune, bedrooms and pets", () => {
    const r = run(ls, {
      operation: "sale",
      commune: "nunoa",
      min_bedrooms: 2,
      pets_required: true,
    });
    expect(r.matches.map((m) => m.listing_id)).toEqual(["a"]);
    expect(Object.fromEntries(r.excluded.map((e) => [e.listing_id, e.reason]))).toMatchObject({
      b: expect.stringContaining("operation"),
      c: expect.stringContaining("commune"),
      d: expect.stringContaining("bedrooms"),
      e: expect.stringContaining("pets"),
    });
  });

  it("matches on bathrooms and area too", () => {
    expect(run([listing("a", {})], { min_bathrooms: 2 }).excluded).toHaveLength(1);
    expect(run([listing("a", { area_m2: 80 })], { min_area_m2: 70 }).matches).toHaveLength(1);
    expect(run([listing("a", { area_m2: 50 })], { min_area_m2: 70 }).matches).toHaveLength(0);
  });
});

describe("price", () => {
  const r = (d: Partial<Declared>, p: Partial<Listing["policy"]>, max: Criteria["max_price"]) =>
    run([listing("a", d, [], p)], { max_price: max }).matches[0]?.criteria[0];

  it("exact price: within or over the budget", () => {
    expect(r({}, {}, { amount: 5500, currency: "UF" })?.status).toBe("met");
    expect(
      run([listing("a", {})], { max_price: { amount: 4000, currency: "UF" } }).excluded,
    ).toHaveLength(1);
  });

  it("range: met only if the whole range fits, excluded if it starts above, unconfirmed when it straddles", () => {
    const p = { priceVisibility: "range" as const, priceRangePct: 0.1 };
    expect(r({}, p, { amount: 9000, currency: "UF" })?.status).toBe("met");
    expect(r({}, p, { amount: 5100, currency: "UF" })?.status).toBe("unconfirmed");
    expect(r({}, p, { amount: 5100, currency: "UF" })?.note).toMatch(/straddles/);
    expect(
      run([listing("a", {}, [], p)], { max_price: { amount: 3000, currency: "UF" } }).excluded,
    ).toHaveLength(1);
  });

  it("hidden price and mismatched currency are unconfirmed, not excluded", () => {
    expect(r({}, { priceVisibility: "hidden" }, { amount: 9000, currency: "UF" })).toMatchObject({
      status: "unconfirmed",
      basis: null,
    });
    expect(r({}, {}, { amount: 9_000_000, currency: "CLP" })?.status).toBe("unconfirmed");
  });
});

describe("must_have: evidence or nothing", () => {
  it("finds a verified fact, prefers it over a spoken one, and cites the source", () => {
    const l = listing("a", {}, [
      stated("s1", "Has a bathtub"),
      verified("c1", "Freestanding clawfoot bathtub under a window"),
    ]);
    const m = run([l], { must_have: ["bathtub"] }).matches[0];
    expect(m?.criteria[0]).toMatchObject({
      status: "met",
      basis: { fact_id: "c1", provenance: "visually_verified" },
    });
    expect(m?.fit).toBe("all criteria met");
  });

  it("reports a missing feature as unconfirmed, never as absent, and keeps the listing", () => {
    const m = run([listing("a", {})], { must_have: ["swimming pool"] }).matches[0];
    expect(m?.criteria[0]).toMatchObject({ status: "unconfirmed", basis: null });
    expect(m?.criteria[0]?.note).toMatch(/does not mean it is absent/);
    expect(m?.fit).toBe("some criteria unconfirmed");
  });

  it("does not match held-back or taste claims", () => {
    const l = listing("a", {}, [
      {
        id: "u1",
        category: "feature",
        statement: "Wooden wardrobe wall",
        provenance: "unverified",
        evidence: null,
        note: "no evidence",
      },
    ]);
    expect(run([l], { must_have: ["wardrobe"] }).matches[0]?.criteria[0]?.status).toBe(
      "unconfirmed",
    );
  });

  it("needs every word of the requested feature", () => {
    const l = listing("a", {}, [verified("c1", "Open kitchen with black cabinets")]);
    expect(run([l], { must_have: ["open kitchen"] }).matches[0]?.criteria[0]?.status).toBe("met");
    expect(run([l], { must_have: ["kitchen island"] }).matches[0]?.criteria[0]?.status).toBe(
      "unconfirmed",
    );
  });
});

describe("ranking and privacy", () => {
  it("ranks fully met listings first, then by evidence strength", () => {
    const strong = listing("strong", {}, [verified("c1", "Bathtub")]);
    const weak = listing("weak", {}, [stated("s1", "Bathtub")]);
    const none = listing("none", {});
    const r = run([none, weak, strong], { must_have: ["bathtub"] });
    expect(r.matches.map((m) => m.listing_id)).toEqual(["strong", "weak", "none"]);
  });

  it("respects the limit", () => {
    const ls = ["a", "b", "c", "d"].map((i) => listing(i, {}));
    expect(run(ls, { limit: 2 }).matches).toHaveLength(2);
  });

  it("silently skips sellers that do not serve anonymous agents", () => {
    const ls = [listing("open", {}), listing("closed", {}, [], { allowAnonymousAgents: false })];
    expect(run(ls, {}, anon).matches.map((m) => m.listing_id)).toEqual(["open"]);
    expect(run(ls, {}, anon).excluded).toEqual([]);
    expect(run(ls, {}).matches).toHaveLength(2);
  });

  it("never exposes the address, and the exact price only when the seller allows it", () => {
    const ls = [
      listing("a", { price: { amount: 5250, currency: "UF" } }, [], { priceVisibility: "range" }),
      listing("b", { price: { amount: 7777, currency: "UF" } }, [], { priceVisibility: "hidden" }),
    ];
    const json = JSON.stringify(
      run(ls, { max_price: { amount: 9000, currency: "UF" }, must_have: ["pool"] }),
    );
    expect(json).not.toContain("Secreta");
    expect(json).not.toContain("5250");
    expect(json).not.toContain("7777");
  });
});
