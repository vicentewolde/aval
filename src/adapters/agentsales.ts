import { z } from "zod";
import {
  type Claim,
  DEFAULT_POLICY,
  type Declared,
  DeclaredSchema,
  type Policy,
} from "../claims/schema.ts";
import { type Rejection, screenSellerText } from "./sanitize.ts";

/**
 * Adapter for AgentSales (the author's separate, earlier broker tool), the first planned source of
 * supply. It reads one row of AgentSales' spreadsheet / listing export as plain JSON, with the column
 * keys AgentSales already uses (`id_propiedad`, `dormitorios`, `acepta_mascotas`...). Aval imports no
 * AgentSales code and AgentSales needs no change: the contract is this file's schema.
 *
 * What crosses the border, and what never does:
 *  - structured data becomes `broker_declared` claims (the broker entered it; no video proves it);
 *  - `mostrar_direccion_exacta` becomes the seller's address policy;
 *  - `notas_internas` (never published by AgentSales) and `destacados` (the broker's taste words) are
 *    dropped on purpose and cannot be imported, even by mistake.
 */
const yes = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["si", "sí", "yes", "true", "1", "x"].includes(s)) return true;
    if (["no", "false", "0"].includes(s)) return false;
  }
  return null;
};

const num = z.preprocess(
  (v) =>
    typeof v === "string" && v.trim() !== "" ? Number(v.replace(/\./g, "").replace(",", ".")) : v,
  z.number(),
);

export const AgentSalesRowSchema = z.object({
  id_propiedad: z.string().min(1).max(60),
  operacion: z.string(),
  tipo: z.string().optional(),
  region: z.string().optional(),
  comuna: z.string().min(2),
  direccion: z.string().nullable().optional(),
  numero_unidad: z.union([z.string(), z.number()]).nullable().optional(),
  mostrar_direccion_exacta: z.unknown().optional(),
  precio: num,
  moneda: z.string(),
  sup_util_m2: num.nullable().optional(),
  dormitorios: num.nullable().optional(),
  banos: num.nullable().optional(),
  estacionamientos: num.nullable().optional(),
  piso: num.nullable().optional(),
  orientacion: z.string().nullable().optional(),
  ano_construccion: num.nullable().optional(),
  gastos_comunes_clp: num.nullable().optional(),
  amoblado: z.unknown().optional(),
  acepta_mascotas: z.unknown().optional(),
  amenities: z
    .union([z.array(z.string()), z.string()])
    .nullable()
    .optional(),
  // Present in AgentSales rows, deliberately never read:
  notas_internas: z.unknown().optional(),
  destacados: z.unknown().optional(),
});
export type AgentSalesRow = z.infer<typeof AgentSalesRowSchema>;

export function listingIdFrom(externalRef: string): string {
  const id = externalRef
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `as-${id}`.slice(0, 62);
}

export interface Imported {
  id: string;
  declared: Declared;
  policy: Policy;
  /** Declared claims beyond the core ones (parking, floor, orientation, amenities...). */
  extraClaims: Claim[];
  /** Seller text that was refused (hostile, promotional or contact details) and why. */
  rejected: Rejection[];
}

export function importAgentSalesRow(
  raw: unknown,
  opts: { priceVisibility?: Policy["priceVisibility"]; at?: string } = {},
): Imported {
  const r = AgentSalesRowSchema.parse(raw);
  const at = opts.at ?? new Date().toISOString();
  const op = r.operacion.trim().toLowerCase();
  const operation = ["venta", "sale"].includes(op)
    ? "sale"
    : ["arriendo", "rent", "alquiler"].includes(op)
      ? "rent"
      : null;
  if (!operation)
    throw new Error(`Unknown operation "${r.operacion}" (expected venta or arriendo)`);
  const currency = r.moneda.trim().toUpperCase();
  if (currency !== "UF" && currency !== "CLP")
    throw new Error(`Unknown currency "${r.moneda}" (expected UF or CLP)`);
  const showAddress = yes(r.mostrar_direccion_exacta) === true;
  const address = [
    r.direccion,
    r.numero_unidad === null || r.numero_unidad === undefined ? null : `unit ${r.numero_unidad}`,
  ]
    .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
    .join(", ");

  const rejected: Rejection[] = [];
  // Fields that become the title or a structured fact: a hostile value is a hard error, not a guess.
  for (const [field, value] of [
    ["tipo", r.tipo],
    ["comuna", r.comuna],
    ["orientacion", r.orientacion],
    ["direccion", r.direccion],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const bad = screenSellerText(field, value, 120);
    if (bad && bad.reason !== "taste or promotional word")
      throw new Error(`Refused ${field}: ${bad.reason} ("${bad.value}")`);
  }

  const declared = DeclaredSchema.parse({
    title: `${r.tipo ?? "Property"} in ${r.comuna}`,
    operation,
    commune: r.comuna,
    address: address || null,
    price: { amount: r.precio, currency },
    area_m2: r.sup_util_m2 ?? null,
    bedrooms: r.dormitorios ?? null,
    bathrooms: r.banos ?? null,
    pets_allowed: yes(r.acepta_mascotas),
  });

  const mk = (id: string, category: Claim["category"], statement: string): Claim => ({
    id,
    category,
    statement,
    provenance: "broker_declared",
    evidence: {
      kind: "declared",
      frame: null,
      t_sec: null,
      box: null,
      confidence: null,
      concept: `imported from AgentSales row ${r.id_propiedad} at ${at}`,
      frames_detected: 0,
      image: null,
      quote: null,
    },
    note: null,
  });
  const extra: Claim[] = [];
  if (r.estacionamientos && r.estacionamientos > 0)
    extra.push(
      mk(
        "d-parking",
        "feature",
        `${r.estacionamientos} parking ${r.estacionamientos === 1 ? "space" : "spaces"}`,
      ),
    );
  if (r.piso !== null && r.piso !== undefined)
    extra.push(mk("d-floor", "layout", `Floor ${r.piso}`));
  if (r.orientacion)
    extra.push(mk("d-orientation", "layout", `Faces ${r.orientacion.toLowerCase()}`));
  if (r.ano_construccion) extra.push(mk("d-year", "other", `Built in ${r.ano_construccion}`));
  if (r.gastos_comunes_clp)
    extra.push(mk("d-expenses", "other", `Common expenses CLP ${r.gastos_comunes_clp} per month`));
  const furnished = yes(r.amoblado);
  if (furnished !== null)
    extra.push(mk("d-furnished", "other", furnished ? "Furnished" : "Unfurnished"));
  const amenities = Array.isArray(r.amenities)
    ? r.amenities
    : typeof r.amenities === "string"
      ? r.amenities.split(/[,;|]/)
      : [];
  const accepted: string[] = [];
  for (const a of amenities
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, 30)) {
    const bad = screenSellerText("amenities", a);
    if (bad) rejected.push(bad);
    else if (accepted.length < 20) accepted.push(a);
  }
  accepted.forEach((a, i) => extra.push(mk(`d-amenity-${i + 1}`, "feature", a)));

  return {
    id: listingIdFrom(r.id_propiedad),
    declared,
    // AgentSales publishes the price on the portals, so an imported listing shows it by default.
    policy: {
      ...DEFAULT_POLICY,
      showExactAddress: showAddress,
      priceVisibility: opts.priceVisibility ?? "exact",
    },
    extraClaims: extra,
    rejected,
  };
}
