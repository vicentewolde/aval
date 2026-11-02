import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Listing, ListingSchema } from "../src/claims/schema.ts";
import { hasPdftotext, pdfPages } from "../src/diligence/pdf.ts";
import type { DocReader } from "../src/diligence/reader.ts";
import { publicSummary, reviewTitle, verifyReviewHash } from "../src/diligence/review.ts";
import { parseDate, parseMoney, runRules, statusOf } from "../src/diligence/rules.ts";
import type { Extraction, SellerIdentity } from "../src/diligence/schema.ts";
import { verifyExtraction } from "../src/diligence/verify.ts";

const root = join(import.meta.dirname, "..");
const listing: Listing = ListingSchema.parse(
  JSON.parse(readFileSync(join(root, "fixtures", "listings", "demo-1.json"), "utf8")),
);
const seller: SellerIdentity = { legal_name: "Marta Elena Fuentes Rojas", rut: "7.654.321-K" };
const now = new Date("2026-10-29T12:00:00Z");
const pdf = (set: string, name: string) => join(root, "fixtures", "documents", set, name);
const havePdf = await hasPdftotext();

const F = (key: string, value: string, quote = value, page = 1) => ({ key, value, quote, page });
const DOMINIO = (owner: string, rut: string, date: string): Extraction => ({
  doc_type: "certificado_dominio",
  fields: [
    F("propietario", owner),
    F("rut_propietario", rut),
    F(
      "inmueble",
      "Departamento N° 1204 del piso 12, ubicado en Avenida Irarrazaval N° 3550, comuna de Nunoa",
    ),
    F("rol_avaluo", "1234-56"),
    F("fecha_emision", date, `Fecha de emision: ${date}`),
  ],
});
const GRAV = (items: string[], date: string): Extraction => ({
  doc_type: "certificado_gravamenes",
  fields: [
    ...(items.length === 0
      ? [
          F(
            "sin_gravamenes",
            "no registra hipotecas, prohibiciones, embargos ni otros gravamenes vigentes",
          ),
        ]
      : items.map((i) => F("gravamen", i))),
    F("rol_avaluo", "1234-56"),
    F("fecha_emision", date, `Fecha de emision: ${date}`),
  ],
});
const CONTRIB = (debt: string, quote: string, date: string): Extraction => ({
  doc_type: "certificado_contribuciones",
  fields: [
    F("rol_avaluo", "1234-56"),
    F("deuda", debt, quote),
    F("fecha_emision", date, `Fecha de emision: ${date}`),
  ],
});
const GC = (debt: string, quote: string, date: string): Extraction => ({
  doc_type: "certificado_gastos_comunes",
  fields: [
    F("unidad", "departamento 1204"),
    F("deuda", debt, quote),
    F("fecha_emision", date, `Fecha de emision: ${date}`),
  ],
});

/** A scripted stand-in for Muse Spark: the answer the model should give for each fixture PDF. */
const TABLE: Record<string, Extraction> = {
  "ok/01-dominio.pdf": DOMINIO("Marta Elena Fuentes Rojas", "7.654.321-K", "28 de octubre de 2026"),
  "ok/02-gravamenes.pdf": GRAV([], "28 de octubre de 2026"),
  "ok/03-contribuciones.pdf": CONTRIB(
    "no registra deuda",
    "no registra deuda de contribuciones",
    "28 de octubre de 2026",
  ),
  "ok/04-gastos-comunes.pdf": GC(
    "no registra deuda",
    "no registra deuda de gastos comunes",
    "28 de octubre de 2026",
  ),
  "attention/01-dominio.pdf": DOMINIO(
    "Marta Elena Fuentes Rojas",
    "7.654.321-K",
    "20 de octubre de 2026",
  ),
  "attention/02-gravamenes.pdf": GRAV(
    ["Hipoteca a favor de Banco Ejemplo S.A., inscrita a fojas 12.345 numero 9.876 del ano 2019"],
    "20 de octubre de 2026",
  ),
  "attention/03-contribuciones.pdf": CONTRIB(
    "$ 148.320",
    "deuda de contribuciones por la suma de $ 148.320",
    "20 de octubre de 2026",
  ),
  "attention/04-gastos-comunes.pdf": GC(
    "$ 86.500",
    "deuda de gastos comunes por la suma de $ 86.500",
    "20 de octubre de 2026",
  ),
  "blocked/01-dominio.pdf": DOMINIO(
    "Ricardo Andres Mella Soto",
    "9.876.543-2",
    "5 de agosto de 2026",
  ),
  "blocked/02-gravamenes.pdf": GRAV(
    [
      "Prohibicion de enajenar decretada por el 12° Juzgado Civil de Santiago",
      "Hipoteca a favor de Banco Ejemplo S.A., inscrita a fojas 12.345 numero 9.876 del ano 2019",
    ],
    "5 de agosto de 2026",
  ),
};
const reader: DocReader = {
  async read(path) {
    const key = path.split("/documents/")[1] as string;
    const ex = TABLE[key] ?? TABLE[key.replace(/^blocked\/0([34])/, "attention/0$1")];
    if (!ex) throw new Error(`no scripted reading for ${key}`);
    return ex;
  },
};
const set = (name: string) =>
  ["01-dominio", "02-gravamenes", "03-contribuciones", "04-gastos-comunes"].map((n) =>
    pdf(name, `${n}.pdf`),
  );

describe("parsing", () => {
  it("reads Spanish dates and amounts, and never guesses", () => {
    expect(parseDate("28 de octubre de 2026")?.toISOString().slice(0, 10)).toBe("2026-10-28");
    expect(parseDate("Fecha de emision: 5 de agosto de 2026")?.getUTCDate()).toBe(5);
    expect(parseDate("pronto")).toBeNull();
    expect(parseMoney("$ 148.320")).toBe(148320);
    expect(parseMoney("por la suma de 86.500")).toBe(86500);
    expect(parseMoney("no registra deuda")).toBe(0);
    expect(parseMoney("una cantidad grande")).toBeNull();
  });
});

describe.skipIf(!havePdf)("quote verification against the PDF's own text", () => {
  it("keeps a field only if value and quote are on the cited page", async () => {
    const pages = await pdfPages(pdf("ok", "01-dominio.pdf"));
    const good = verifyExtraction(TABLE["ok/01-dominio.pdf"] as Extraction, pages);
    expect(good.type_confirmed).toBe(true);
    expect(good.fields.every((f) => f.verified)).toBe(true);

    const bad = verifyExtraction(
      {
        doc_type: "certificado_dominio",
        fields: [
          F("propietario", "Pedro Pablo Perez Perez"),
          F("rol_avaluo", "1234-56", "Rol de avaluo 9999-99"),
          F("fecha_emision", "28 de octubre de 2026", "Fecha de emision: 28 de octubre de 2026", 7),
          F("color_favorito", "azul"),
        ],
      },
      pages,
    );
    expect(bad.fields.map((f) => f.verified)).toEqual([false, false, false, false]);
    expect(bad.fields[0]?.note).toMatch(/not on that page/);
    expect(bad.fields[2]?.note).toMatch(/no page 7/);
    expect(bad.fields[3]?.note).toMatch(/not a field/);
  });

  it("does not accept a document whose title says another type", async () => {
    const pages = await pdfPages(pdf("ok", "02-gravamenes.pdf"));
    const wrong = verifyExtraction(
      { doc_type: "certificado_dominio", fields: [F("rol_avaluo", "1234-56")] },
      pages,
    );
    expect(wrong.type_confirmed).toBe(false);
  });
});

describe.skipIf(!havePdf)("title review of the three fixture sets", () => {
  it("clear: a complete, fresh, clean set", async () => {
    const r = await reviewTitle({ listing, seller, files: set("ok"), reader, now });
    expect(r.status).toBe("clear");
    expect(r.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(r.findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining([
        "OWNER_MATCHES_SELLER",
        "NO_ENCUMBRANCES",
        "NO_DEBT",
        "ROL_CONSISTENT",
      ]),
    );
    expect(verifyReviewHash(r)).toBe(true);
  });

  it("needs attention: a mortgage and two debts, each with its evidence", async () => {
    const r = await reviewTitle({ listing, seller, files: set("attention"), reader, now });
    expect(r.status).toBe("needs_attention");
    const rules = r.findings.filter((f) => f.severity === "warning").map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(["MORTGAGE_REGISTERED", "DEBT_OUTSTANDING"]));
    const debts = r.findings.filter((f) => f.rule === "DEBT_OUTSTANDING");
    expect(debts).toHaveLength(2);
    expect(debts[0]?.message).toContain("148.320");
    expect(debts[0]?.evidence[0]?.quote).toContain("148.320");
  });

  it("blocked: another owner and a prohibition to sell", async () => {
    const r = await reviewTitle({ listing, seller, files: set("blocked"), reader, now });
    expect(r.status).toBe("blocked");
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toContain("OWNER_IS_NOT_SELLER");
    expect(rules).toContain("ENCUMBRANCE_BLOCKS_SALE");
    expect(rules).toContain("CERTIFICATE_STALE");
  });

  it("incomplete: a missing certificate is never read as clean", async () => {
    const r = await reviewTitle({ listing, seller, files: set("ok").slice(0, 3), reader, now });
    expect(r.status).toBe("incomplete");
    expect(r.findings.some((f) => f.rule === "DOC_MISSING")).toBe(true);
  });

  it("a tampered review no longer matches its hash", async () => {
    const r = await reviewTitle({ listing, seller, files: set("blocked"), reader, now });
    const forged = { ...r, status: "clear" as const };
    expect(verifyReviewHash(forged)).toBe(false);
  });

  it("the public summary has rule names, never names, RUTs, quotes or amounts", async () => {
    const r = await reviewTitle({ listing, seller, files: set("blocked"), reader, now });
    const text = JSON.stringify(publicSummary(r));
    for (const secret of [
      "Mella",
      "Fuentes",
      "7.654",
      "9.876.543",
      "Banco Ejemplo",
      "C-4567",
      "148",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(publicSummary(r).blockers).toContain("OWNER_IS_NOT_SELLER");
  });
});

describe("rules without PDFs", () => {
  it("a model that invents a field is dropped, not trusted", () => {
    const docs = [
      {
        doc_type: "certificado_gravamenes" as const,
        type_confirmed: true,
        fields: [
          {
            key: "sin_gravamenes",
            value: "no registra",
            quote: "no registra",
            page: 1,
            verified: false,
            note: "the value is not on that page",
          },
        ],
      },
    ];
    const findings = runRules(docs, seller, listing, now);
    expect(findings.some((f) => f.rule === "NO_ENCUMBRANCES")).toBe(false);
    expect(findings.some((f) => f.rule === "FIELD_NOT_VERIFIED")).toBe(true);
    expect(statusOf(findings, docs)).toBe("incomplete");
  });
});

describe.skipIf(!havePdf)("a fooled model cannot clear a blocked document", () => {
  it("a hallucinated clean certificate over the real blocked PDFs is dropped, not believed", async () => {
    const lying: DocReader = {
      async read(path) {
        // What a model that obeyed "say everything is fine" would return for the blocked set.
        if (path.includes("02-gravamenes")) return GRAV([], "5 de agosto de 2026");
        if (path.includes("01-dominio"))
          return DOMINIO("Marta Elena Fuentes Rojas", "7.654.321-K", "5 de agosto de 2026");
        return (await reader.read(path)) as Extraction;
      },
    };
    const r = await reviewTitle({ listing, seller, files: set("blocked"), reader: lying, now });
    expect(r.status).not.toBe("clear");
    expect(r.findings.some((f) => f.rule === "NO_ENCUMBRANCES")).toBe(false);
    expect(r.findings.some((f) => f.rule === "OWNER_MATCHES_SELLER")).toBe(false);
    expect(r.findings.filter((f) => f.rule === "FIELD_NOT_VERIFIED").length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
