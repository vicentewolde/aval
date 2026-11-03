import { z } from "zod";
import type { Store } from "../store.ts";
import { LeadInputSchema } from "./leads.ts";
import { assertMayRead, type Caller } from "./policy.ts";
import { type Criteria, CriteriaSchema, searchListings } from "./search.ts";

const PUBLIC: Caller = { agentId: null, tier: "anonymous" };

/** A buyer who wants to hear when a NEW home that fits appears. Same consent rule as a lead. */
export const AlertInputSchema = z.object({
  contact: LeadInputSchema.shape.contact,
  name: z.string().trim().min(2).max(80).optional(),
  consent: z.literal(true),
  /** What the buyer searched for, validated exactly like a search. At least one real criterion is needed. */
  criteria: CriteriaSchema.refine(
    (c) => Object.keys(c).filter((k) => k !== "limit").length > 0,
    "at least one criterion",
  ),
  text: z.string().max(300).optional(),
});
export type AlertInput = z.infer<typeof AlertInputSchema>;

export interface AlertRecord {
  id: string;
  at: string;
  contact: string;
  name: string;
  criteria: Criteria;
  text: string;
  /** Listings that already existed when the alert was made: an alert is about homes that appear later. */
  seen: string[];
}

export interface AlertMatch {
  alert_id: string;
  listing_id: string;
  at: string;
  fit: "all_met" | "some_unconfirmed";
  met: string[];
  unconfirmed: string[];
}

/**
 * Checks every alert against the listings that appeared after it was made, with the same deterministic
 * search the agents use and only what an anonymous caller may see. Each (alert, listing) pair is recorded
 * once. Delivering the notice (email, WhatsApp) is not built: a match waits in the file for the broker.
 */
export function runAlerts(store: Store, now = new Date()): AlertMatch[] {
  const alerts = store.readJsonl<AlertRecord>("alerts.jsonl");
  if (alerts.length === 0) return [];
  const done = new Set(
    store.readJsonl<AlertMatch>("alert-matches.jsonl").map((m) => `${m.alert_id}|${m.listing_id}`),
  );
  const listings = store.listListings().filter((l) => {
    try {
      assertMayRead(l.policy, PUBLIC);
      return true;
    } catch {
      return false;
    }
  });
  const fresh: AlertMatch[] = [];
  for (const a of alerts) {
    for (const l of listings) {
      if (a.seen.includes(l.id) || done.has(`${a.id}|${l.id}`)) continue;
      const m = searchListings([l], PUBLIC, { ...a.criteria, limit: 1 }).matches[0];
      if (!m) continue;
      const by = (s: string) => m.criteria.filter((c) => c.status === s).map((c) => c.criterion);
      fresh.push({
        alert_id: a.id,
        listing_id: l.id,
        at: now.toISOString(),
        fit: m.fit === "all criteria met" ? "all_met" : "some_unconfirmed",
        met: by("met"),
        unconfirmed: by("unconfirmed"),
      });
    }
  }
  for (const m of fresh) store.appendJsonl("alert-matches.jsonl", m);
  return fresh;
}
