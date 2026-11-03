import type { Claim, Listing } from "../claims/schema.ts";
import { type AgentSalesRow, AgentSalesRowSchema } from "./agentsales.ts";

/**
 * The reverse of the AgentSales adapter: a listing in Aval becomes a row in the same column format, so
 * a broker who runs AgentSales can load Aval's result with the import they already have, with no change
 * to AgentSales.
 *
 * What goes out, and what never does:
 *  - structured columns come from the seller's declared data (price, rooms, floor, parking...);
 *  - `amenities` holds the facts verified in the video first, then any amenity the broker already
 *    declared in their own AgentSales sheet (returned unchanged, it is their data). What was only said
 *    in a voice note is never added, so Aval never asserts in that column something nobody proved;
 *  - `destacados` (taste words) and `notas_internas` are always empty: Aval never produces either;
 *  - held-back and subjective claims never leave.
 * The file contains the seller's real address (it is the broker's own data, going to the broker's own
 * tool): treat it as private and do not publish it.
 */
export interface ExportOptions {
  /** Base URL of the showroom, e.g. http://127.0.0.1:8788. Adds the aval_showroom_url column when given. */
  base?: string;
  /** Status of the sale-document review, when there is one (clear, needs_attention, blocked, incomplete). */
  reviewStatus?: string;
  /** The verified caption (Spanish, Instagram) when one exists, as an extra column. */
  caption?: string;
  /** Only the plain AgentSales columns, with no aval_* extras (those need a configurable field in AgentSales). */
  plain?: boolean;
}

export type ExportedRow = AgentSalesRow & {
  aval_showroom_url?: string;
  aval_verified_facts?: number;
  aval_title_review?: string;
  aval_caption?: string;
};

export const COLUMNS = [
  "id_propiedad",
  "operacion",
  "tipo",
  "comuna",
  "direccion",
  "mostrar_direccion_exacta",
  "precio",
  "moneda",
  "sup_util_m2",
  "dormitorios",
  "banos",
  "estacionamientos",
  "piso",
  "orientacion",
  "ano_construccion",
  "gastos_comunes_clp",
  "amoblado",
  "acepta_mascotas",
  "amenities",
  "destacados",
  "notas_internas",
] as const;
export const EXTRA_COLUMNS = [
  "aval_showroom_url",
  "aval_verified_facts",
  "aval_title_review",
] as const;

export const TYPES: Array<[RegExp, string]> = [
  [/^departamento\b/i, "Departamento"],
  [/^casa\b/i, "Casa"],
  [/^oficina\b/i, "Oficina"],
  [/^loft\b/i, "Loft"],
  [/^duplex\b/i, "Duplex"],
  [/^local\b/i, "Local"],
  [/^terreno\b/i, "Terreno"],
  [/^estudio\b/i, "Estudio"],
];

const declaredText = (claims: Claim[], id: string): string | null =>
  claims.find((c) => c.id === id && c.provenance === "broker_declared")?.statement ?? null;

const siNo = (v: boolean | null): string | null => (v === null ? null : v ? "si" : "no");

export function exportAgentSalesRow(listing: Listing, opts: ExportOptions = {}): ExportedRow {
  const d = listing.declared;
  const external = listing.id.startsWith("as-") ? listing.id.slice(3) : listing.id;
  const titleType = TYPES.find(([re]) => re.test(d.title))?.[1];
  const parking = /^(\d+) parking/.exec(declaredText(listing.claims, "d-parking") ?? "")?.[1];
  const floor = /^Floor (-?\d+)/.exec(declaredText(listing.claims, "d-floor") ?? "")?.[1];
  const faces = /^Faces (.+)$/.exec(declaredText(listing.claims, "d-orientation") ?? "")?.[1];
  const year = /^Built in (\d{4})/.exec(declaredText(listing.claims, "d-year") ?? "")?.[1];
  const expenses = /^Common expenses CLP (\d+)/.exec(
    declaredText(listing.claims, "d-expenses") ?? "",
  )?.[1];
  const furnished = declaredText(listing.claims, "d-furnished");

  const verified = listing.claims
    .filter((c) => c.provenance === "visually_verified" && c.evidence?.t_sec != null)
    .sort((a, b) => (a.evidence?.t_sec ?? 0) - (b.evidence?.t_sec ?? 0))
    .map((c) => c.statement.replace(/\s+/g, " ").trim())
    .slice(0, 20);
  const declaredAmenities = listing.claims
    .filter((c) => c.provenance === "broker_declared" && /^d-amenity-\d+$/.test(c.id))
    .map((c) => c.statement.replace(/\s+/g, " ").trim());
  const amenities = [...verified];
  for (const a of declaredAmenities)
    if (amenities.length < 20 && !amenities.some((x) => x.toLowerCase() === a.toLowerCase()))
      amenities.push(a);

  const row: ExportedRow = {
    id_propiedad: external,
    operacion: d.operation === "sale" ? "venta" : "arriendo",
    ...(titleType ? { tipo: titleType } : {}),
    comuna: d.commune,
    direccion: d.address,
    mostrar_direccion_exacta: listing.policy.showExactAddress ? "si" : "no",
    precio: d.price.amount,
    moneda: d.price.currency,
    sup_util_m2: d.area_m2,
    dormitorios: d.bedrooms,
    banos: d.bathrooms,
    estacionamientos: parking ? Number(parking) : null,
    piso: floor ? Number(floor) : null,
    orientacion: faces ? faces.charAt(0).toUpperCase() + faces.slice(1) : null,
    ano_construccion: year ? Number(year) : null,
    gastos_comunes_clp: expenses ? Number(expenses) : null,
    amoblado: furnished === null ? null : furnished === "Furnished" ? "si" : "no",
    acepta_mascotas: siNo(d.pets_allowed),
    amenities,
    destacados: null,
    notas_internas: null,
  };
  if (!opts.plain) {
    if (opts.base)
      row.aval_showroom_url = `${opts.base.replace(/\/+$/, "")}/l/${listing.id}/showroom`;
    row.aval_verified_facts = verified.length;
    if (opts.reviewStatus) row.aval_title_review = opts.reviewStatus;
    if (opts.caption) row.aval_caption = opts.caption;
  }
  // The same contract the importer enforces: an export that AgentSales' format would reject is a bug here.
  AgentSalesRowSchema.parse(row);
  return row;
}

/** A spreadsheet cell: no line breaks, and nothing a spreadsheet would run as a formula. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = Array.isArray(value) ? value.join(", ") : String(value);
  s = s.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  if (typeof value !== "number" && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportedRow[]): string {
  const extras = EXTRA_COLUMNS.filter((c) => rows.some((r) => r[c] !== undefined));
  const cols = [...COLUMNS, ...extras] as const;
  const lines = [cols.join(",")];
  for (const r of rows)
    lines.push(cols.map((c) => cell((r as Record<string, unknown>)[c])).join(","));
  return `${lines.join("\n")}\n`;
}
