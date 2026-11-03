import { z } from "zod";
import type { Listing } from "../claims/schema.ts";
import type { Caller } from "./policy.ts";
import { type Criteria, CriteriaSchema, searchListings } from "./search.ts";

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,}$/;
const digits = (s: string): number => s.replace(/\D/g, "").length;

/** A buyer who wants to hear from the broker. Nothing is stored without the explicit consent flag. */
export const LeadInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  contact: z
    .string()
    .trim()
    .max(120)
    .refine(
      (c) => EMAIL.test(c) || (digits(c) >= 8 && /^[+\d\s().-]+$/.test(c)),
      "an email or a phone number",
    ),
  message: z.string().max(500).optional(),
  consent: z.literal(true),
  slot: z.string().max(40).optional(),
  /** What the buyer searched for, so the broker sees how well this home fits. Validated like any search. */
  criteria: CriteriaSchema.optional(),
});
export type LeadInput = z.infer<typeof LeadInputSchema>;

export interface LeadFit {
  status: "all_met" | "some_unconfirmed" | "not_a_fit" | "no_criteria";
  met: string[];
  unconfirmed: string[];
  not_met: string[];
}

export interface LeadRecord {
  id: string;
  listing_id: string;
  at: string;
  name: string;
  contact: string;
  message: string;
  slot: string | null;
  fit: LeadFit;
  source: "showroom";
}

/** How this home fits what the buyer asked for, computed by the same deterministic search the agents use. */
export function leadFit(listing: Listing, caller: Caller, criteria: Criteria | undefined): LeadFit {
  if (!criteria || Object.keys(criteria).filter((k) => k !== "limit").length === 0)
    return { status: "no_criteria", met: [], unconfirmed: [], not_met: [] };
  const r = searchListings([listing], caller, { ...criteria, limit: 1 });
  const m = r.matches[0];
  if (!m) {
    return {
      status: "not_a_fit",
      met: [],
      unconfirmed: [],
      not_met: r.excluded.map((e) => e.reason),
    };
  }
  const by = (s: string) => m.criteria.filter((c) => c.status === s).map((c) => c.criterion);
  return {
    status: m.fit === "all criteria met" ? "all_met" : "some_unconfirmed",
    met: by("met"),
    unconfirmed: by("unconfirmed"),
    not_met: by("not_met"),
  };
}
