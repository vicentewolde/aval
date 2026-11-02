import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importAgentSalesRow, listingIdFrom } from "../src/adapters/agentsales.ts";
import type { Listing } from "../src/claims/schema.ts";
import { declaredClaims } from "../src/claims/verify.ts";
import { visibleFacts } from "../src/gateway/policy.ts";
import { searchListings } from "../src/gateway/search.ts";

const rows = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "fixtures", "agentsales-export.json"), "utf8"),
) as unknown[];
const at = "2026-11-02T00:00:00Z";

function toListing(raw: unknown): Listing {
  const i = importAgentSalesRow(raw, { at });
  return {
    id: i.id,
    createdAt: at,
    declared: i.declared,
    policy: i.policy,
    claims: [...declaredClaims(i.declared, "agentsales", at), ...i.extraClaims],
  };
}

describe("AgentSales adapter", () => {
  it("maps the spreadsheet row, with Chilean number formats, to a declared listing", () => {
    const i = importAgentSalesRow(rows[0], { at });
    expect(i.id).toBe("as-p-101");
    expect(i.declared).toMatchObject({
      operation: "sale",
      commune: "Nunoa",
      price: { amount: 4350, currency: "UF" },
      area_m2: 58,
      bedrooms: 2,
      bathrooms: 2,
      pets_allowed: true,
    });
    expect(i.declared.address).toBe("Av. Grecia 1450 (fictional), unit 702");
    const ids = i.extraClaims.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "d-parking",
        "d-floor",
        "d-orientation",
        "d-year",
        "d-expenses",
        "d-furnished",
        "d-amenity-1",
        "d-amenity-3",
      ]),
    );
    expect(i.extraClaims.find((c) => c.id === "d-parking")?.statement).toBe("1 parking space");
    expect(i.extraClaims.find((c) => c.id === "d-orientation")?.statement).toBe("Faces norte");
  });

  it("maps mostrar_direccion_exacta to the seller's address policy and splits amenity strings", () => {
    expect(importAgentSalesRow(rows[0], { at }).policy.showExactAddress).toBe(false);
    const b = importAgentSalesRow(rows[1], { at });
    expect(b.policy.showExactAddress).toBe(true);
    expect(b.declared.operation).toBe("rent");
    expect(
      b.extraClaims.filter((c) => c.id.startsWith("d-amenity")).map((c) => c.statement),
    ).toEqual(["Conserjeria 24 horas", "Lavanderia"]);
    expect(b.extraClaims.some((c) => c.id === "d-parking")).toBe(false); // 0 parking spaces is not a claim
  });

  it("never imports internal notes or the broker's taste words", () => {
    for (const row of rows) {
      const listing = toListing(row);
      const json = JSON.stringify(listing).toLowerCase();
      for (const secret of [
        "4.000",
        "4000",
        "contado",
        "no comentar",
        "hermano",
        "viaja",
        "luminoso",
        "silencioso",
        "espectacular",
      ])
        expect(json).not.toContain(secret);
    }
  });

  it("makes imported structured data searchable, with declared provenance, and honors the policy", () => {
    const [a, b] = rows.map(toListing) as [Listing, Listing];
    const r = searchListings(
      [a, b],
      { agentId: "x", tier: "verified" },
      {
        operation: "sale",
        min_bedrooms: 2,
        pets_required: true,
        must_have: ["parking", "gimnasio"],
        max_price: { amount: 5000, currency: "UF" },
      },
    );
    const m = r.matches[0];
    expect(m?.listing_id).toBe("as-p-101");
    expect(m?.fit).toBe("all criteria met");
    expect(m?.criteria.find((c) => c.criterion === "has parking")?.basis).toMatchObject({
      provenance: "broker_declared",
      fact_id: "d-parking",
    });
    expect(JSON.stringify(r)).not.toContain("Grecia");
    // The second listing shows its address because its broker said so.
    expect(
      visibleFacts(b, { agentId: "x", tier: "verified" }).some((f) => f.id === "d-address"),
    ).toBe(true);
  });

  it("rejects bad data loudly instead of guessing", () => {
    expect(() => importAgentSalesRow({ ...(rows[0] as object), operacion: "permuta" })).toThrow(
      /Unknown operation/,
    );
    expect(() => importAgentSalesRow({ ...(rows[0] as object), moneda: "USD" })).toThrow(
      /Unknown currency/,
    );
    expect(() => importAgentSalesRow({ id_propiedad: "x" })).toThrow();
  });

  it("derives a safe, stable listing id", () => {
    expect(listingIdFrom("P-101")).toBe("as-p-101");
    expect(listingIdFrom("Propiedad Ñuñoa #7/B")).toBe("as-propiedad-nunoa-7-b");
    expect(listingIdFrom("A".repeat(200)).length).toBeLessThanOrEqual(62);
  });
});
