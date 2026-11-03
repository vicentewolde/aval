import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentSalesRowSchema, importAgentSalesRow } from "../src/adapters/agentsales.ts";
import { COLUMNS, cell, exportAgentSalesRow, toCsv } from "../src/adapters/agentsales-export.ts";
import { type Listing, ListingSchema } from "../src/claims/schema.ts";
import { declaredClaims } from "../src/claims/verify.ts";

const root = join(import.meta.dirname, "..", "fixtures");
const rows = JSON.parse(readFileSync(join(root, "agentsales-export.json"), "utf8")) as unknown[];
const at = "2026-11-02T00:00:00Z";
const fx = (id: string): Listing =>
  ListingSchema.parse(JSON.parse(readFileSync(join(root, "listings", `${id}.json`), "utf8")));

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

describe("export to the AgentSales column format", () => {
  it("round-trips: what comes out imports back to the same listing", () => {
    for (const raw of rows) {
      const a = toListing(raw);
      const out = exportAgentSalesRow(a, { plain: true });
      expect(AgentSalesRowSchema.safeParse(out).success).toBe(true);
      const b = toListing(out);
      expect(b.id).toBe(a.id);
      expect(b.declared).toEqual({ ...a.declared, title: b.declared.title });
      expect(b.policy.showExactAddress).toBe(a.policy.showExactAddress);
      const am = (l: Listing) =>
        l.claims
          .filter((c) => c.id.startsWith("d-amenity"))
          .map((c) => c.statement)
          .sort();
      expect(am(b)).toEqual(am(a)); // the broker's own declared amenities come back unchanged
      const stmts = (l: Listing) =>
        l.claims
          .filter((c) => c.id.startsWith("d-") && !c.id.startsWith("d-amenity"))
          .map((c) => c.statement.toLowerCase())
          .sort();
      expect(
        stmts(b).filter((s) => /parking|floor|faces|built|expenses|furnished/.test(s)),
      ).toEqual(stmts(a).filter((s) => /parking|floor|faces|built|expenses|furnished/.test(s)));
    }
  });

  it("keeps the broker's declared amenities after the verified ones, and adds nothing that was only said", () => {
    const l = fx("demo-1");
    const declared = {
      ...l,
      claims: [
        ...l.claims,
        {
          ...l.claims[0]!,
          id: "d-amenity-1",
          statement: "Gimnasio",
          provenance: "broker_declared" as const,
        },
      ],
    };
    const am = exportAgentSalesRow(declared).amenities as string[];
    expect(am.at(-1)).toBe("Gimnasio");
    expect(am.indexOf("Gimnasio")).toBeGreaterThan(0);
    const said = l.claims.filter((c) => c.provenance === "broker_stated").map((c) => c.statement);
    for (const x of am) expect(said).not.toContain(x);
  });

  it("puts only video-verified facts in amenities for a listing with no declared amenities, and leaves taste and internal notes empty", () => {
    const l = fx("demo-1");
    const row = exportAgentSalesRow(l);
    const verified = l.claims
      .filter((c) => c.provenance === "visually_verified")
      .map((c) => c.statement.replace(/\s+/g, " ").trim());
    expect(row.amenities).toEqual(expect.arrayContaining([verified[0]]));
    for (const a of row.amenities as string[]) expect(verified).toContain(a);
    const notVerified = l.claims
      .filter((c) => c.provenance !== "visually_verified")
      .map((c) => c.statement);
    for (const a of row.amenities as string[]) expect(notVerified).not.toContain(a);
    expect(row.destacados).toBeNull();
    expect(row.notas_internas).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/wood wardrobe/i); // the claim SAM could not find is held back
  });

  it("never exports a claim that is held back or subjective", () => {
    const l = fx("demo-1");
    const held = l.claims
      .filter((c) => c.provenance === "unverified" || c.provenance === "subjective")
      .map((c) => c.statement);
    expect(held.length).toBeGreaterThan(0);
    const text = JSON.stringify(exportAgentSalesRow(l));
    for (const h of held) expect(text).not.toContain(h);
  });

  it("maps operation, pets, address policy and the optional aval columns", () => {
    const row = exportAgentSalesRow(fx("demo-1"), {
      base: "http://127.0.0.1:8788/",
      reviewStatus: "needs_attention",
    });
    expect(row).toMatchObject({
      operacion: "venta",
      comuna: "Nunoa",
      moneda: "UF",
      mostrar_direccion_exacta: "no",
      acepta_mascotas: "si",
      aval_showroom_url: "http://127.0.0.1:8788/l/demo-1/showroom",
      aval_title_review: "needs_attention",
    });
    expect(row.aval_verified_facts).toBeGreaterThan(5);
    const plain = exportAgentSalesRow(fx("demo-1"), { plain: true, base: "http://x" });
    expect(Object.keys(plain).some((k) => k.startsWith("aval_"))).toBe(false);
  });
});

describe("CSV", () => {
  it("has the AgentSales columns first, in a fixed order, then the aval ones that are present", () => {
    const csv = toCsv([exportAgentSalesRow(fx("demo-1"), { base: "http://x" })]);
    const header = csv.split("\n")[0] as string;
    expect(header.startsWith(COLUMNS.join(","))).toBe(true);
    expect(header.endsWith("aval_showroom_url,aval_verified_facts")).toBe(true);
    expect(csv.split("\n").length).toBe(3);
  });
  it("quotes commas and quotes, and flattens line breaks", () => {
    expect(cell('a "b", c')).toBe('"a ""b"", c"');
    expect(cell("line1\nline2")).toBe("line1 line2");
    expect(cell(["x", "y"])).toBe('"x, y"');
    expect(cell(null)).toBe("");
  });
  it("defuses spreadsheet formulas but leaves numbers alone", () => {
    for (const evil of ['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1)"])
      expect(cell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(cell(-1)).toBe("-1");
    expect(cell(4350)).toBe("4350");
  });
  it("a verified statement that looks like a formula cannot run when the CSV is opened", () => {
    const l = fx("demo-1");
    const evil = {
      ...l,
      claims: l.claims.map((c, i) =>
        c.provenance === "visually_verified" &&
        i === l.claims.findIndex((x) => x.provenance === "visually_verified")
          ? { ...c, statement: "=cmd|' /C calc'!A0" }
          : c,
      ),
    };
    const csv = toCsv([exportAgentSalesRow(evil)]);
    expect(csv).not.toMatch(/(^|,)"?=cmd/);
    expect(csv).toContain("'=cmd");
  });
});
