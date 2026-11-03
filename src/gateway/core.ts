import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publicSummary, type TitleReview, verifyReviewHash } from "../diligence/review.ts";
import type { Action } from "../negotiation/engine.ts";
import type { NegotiationService } from "../negotiation/service.ts";
import type { Store } from "../store.ts";
import { AlertInputSchema, type AlertRecord } from "./alerts.ts";
import type { AnswerModel, AnswerResult } from "./answer.ts";
import { answerQuestion } from "./answer.ts";
import type { AuditLog } from "./audit.ts";
import { LeadInputSchema, type LeadRecord, leadFit } from "./leads.ts";
import {
  assertMayRead,
  assertMayRequestVisit,
  type Caller,
  PolicyDenied,
  type VisibleFact,
  visibleFacts,
} from "./policy.ts";
import { type Criteria, searchListings } from "./search.ts";

export type TitleReviewView =
  | ReturnType<typeof publicSummary>
  | { status: "not_reviewed"; note: string };

export type Outcome<T> = ({ ok: true } & T) | { ok: false; code: string; message: string };

export interface VisitRecord {
  id: string;
  listing_id: string;
  agent: string;
  slot: string;
  note: string;
  status: "pending" | "approved" | "declined";
  at: string;
}

interface Deps {
  store: Store;
  model: AnswerModel;
  audit: AuditLog;
  negotiation?: NegotiationService;
  now?: () => Date;
}

const HOUR = 3_600_000;
export const LEADS_PER_HOUR = 60;
export const SEARCHES_PER_HOUR = 120;

/** Notes come from outside and end up in a terminal and a log: no control characters, no escape codes. */
export function cleanNote(note: string): string {
  return note
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Everything an agent can do, independent of the transport (MCP, HTTP, tests). Each call is
 * authorized against the seller's policy, rate limited, and written to the audit chain.
 */
export class GatewayCore {
  private readonly deps: Deps;
  private readonly asks = new Map<string, number[]>();
  private readonly searches = new Map<string, number[]>();
  private readonly leads = new Map<string, number[]>();
  private readonly alerts = new Map<string, number[]>();

  constructor(deps: Deps) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private log(
    caller: Caller,
    tool: string,
    decision: "allowed" | "refused" | "flagged",
    detail: string,
  ): void {
    this.deps.audit.append(
      { agent: caller.agentId ?? "anonymous", tier: caller.tier, tool, decision, detail },
      this.now(),
    );
  }

  private async guarded<T>(
    caller: Caller,
    tool: string,
    detail: string,
    run: () => Promise<{ value: T; flags?: string[] }>,
  ): Promise<Outcome<{ data: T }>> {
    try {
      const { value, flags } = await run();
      this.log(
        caller,
        tool,
        flags && flags.length > 0 ? "flagged" : "allowed",
        `${detail}${flags && flags.length > 0 ? ` flags=${flags.join(",")}` : ""}`,
      );
      return { ok: true, data: value };
    } catch (err) {
      if (err instanceof PolicyDenied) {
        this.log(caller, tool, "refused", `${detail} -> ${err.code}`);
        return { ok: false, code: err.code, message: err.message };
      }
      this.log(caller, tool, "refused", `${detail} -> INTERNAL_ERROR`);
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        message: "The gateway could not complete this request.",
      };
    }
  }

  listListings(caller: Caller) {
    return this.guarded(caller, "list_listings", "", async () => {
      const rows = this.deps.store.listListings().flatMap((l) => {
        try {
          assertMayRead(l.policy, caller);
        } catch {
          return [];
        }
        return [
          {
            id: l.id,
            title: l.declared.title,
            commune: l.declared.commune,
            operation: l.declared.operation,
            verified_facts: visibleFacts(l, caller).length,
          },
        ];
      });
      return { value: rows };
    });
  }

  search(caller: Caller, criteria: Criteria) {
    return this.guarded(
      caller,
      "search_listings",
      JSON.stringify(criteria).slice(0, 200),
      async () => {
        this.rateLimit(caller, SEARCHES_PER_HOUR, this.searches);
        return { value: searchListings(this.deps.store.listListings(), caller, criteria) };
      },
    );
  }

  /** Negotiation is only for identified agents holding a signed mandate; the listing check keeps existence private. */
  negotiationStart(caller: Caller, listingId: string) {
    return this.guarded(caller, "negotiation_start", listingId, async () => {
      if (caller.tier !== "verified" || !caller.agentId)
        throw new PolicyDenied(
          "AGENT_NOT_IDENTIFIED",
          "Negotiation needs an identified agent with a signed mandate.",
        );
      this.require(listingId, caller);
      const r = this.deps.negotiation?.start(caller.agentId, listingId);
      if (!r)
        throw new PolicyDenied(
          "NEGOTIATION_NOT_AVAILABLE",
          "This seller has not enabled negotiation.",
        );
      if (!r.ok) throw new PolicyDenied(r.code, r.message);
      return { value: r.view };
    });
  }

  negotiationAct(caller: Caller, tool: string, negotiationId: string, action: Action | null) {
    return this.guarded(
      caller,
      tool,
      `neg=${negotiationId}${action?.type === "offer" ? ` offer price=${action.price}` : action ? ` ${action.type}` : ""}`,
      async () => {
        if (caller.tier !== "verified" || !caller.agentId)
          throw new PolicyDenied(
            "AGENT_NOT_IDENTIFIED",
            "Negotiation needs an identified agent with a signed mandate.",
          );
        const svc = this.deps.negotiation;
        if (!svc)
          throw new PolicyDenied(
            "NEGOTIATION_NOT_AVAILABLE",
            "Negotiation is not enabled on this gateway.",
          );
        const r = action
          ? await svc.act(caller.agentId, negotiationId, action)
          : svc.status(caller.agentId, negotiationId);
        if (!r.ok) throw new PolicyDenied(r.code, r.message);
        return { value: r.view };
      },
    );
  }

  getFacts(caller: Caller, listingId: string) {
    return this.guarded<VisibleFact[]>(caller, "get_facts", listingId, async () => ({
      value: visibleFacts(this.require(listingId, caller), caller),
    }));
  }

  getPolicy(caller: Caller, listingId: string) {
    return this.guarded(caller, "get_policy", listingId, async () => {
      const p = this.require(listingId, caller).policy;
      return {
        value: {
          exact_address: p.showExactAddress ? "shared" : "withheld by the seller",
          price:
            p.priceVisibility === "range"
              ? `shown as an approximate range (about ${Math.round(p.priceRangePct * 100)}% either way, not centered on the price)`
              : p.priceVisibility,
          visits:
            p.visitSlots.length > 0
              ? "possible for identified agents, with human approval"
              : "not open",
          unidentified_agents: p.allowAnonymousAgents ? "read-only" : "not served",
          statement_rule:
            "Only verified or broker-declared facts are stated; each answer cites its facts.",
        },
      };
    });
  }

  /**
   * What the document review found, without names, RUTs, quotes or amounts (those stay with the seller).
   * Only the status and the rule names that fired; the hash ties it to the full review the seller holds.
   * A listing with no review says so: "not reviewed" is never presented as "clear".
   */
  getTitleReview(caller: Caller, listingId: string) {
    return this.guarded<TitleReviewView>(caller, "get_title_review", listingId, async () => {
      this.require(listingId, caller);
      const path = join(this.deps.store.listingDir(listingId), "title-review.json");
      if (!existsSync(path))
        return {
          value: {
            status: "not_reviewed",
            note: "The seller has not provided documents for review.",
          },
        };
      const review = JSON.parse(readFileSync(path, "utf8")) as TitleReview;
      if (!verifyReviewHash(review))
        return {
          value: {
            status: "not_reviewed",
            note: "The stored review failed its integrity check and was not used.",
          },
        };
      return { value: publicSummary(review) };
    });
  }

  /**
   * A buyer asks the broker to get in touch from the showroom. Only with explicit consent; the personal
   * data goes to the seller's lead file and never into the audit log (which records the lead id only).
   * The record carries how well the home fits what the buyer searched for, computed from public facts.
   */
  captureLead(caller: Caller, listingId: string, raw: unknown) {
    return this.guarded(caller, "capture_lead", listingId, async () => {
      const listing = this.require(listingId, caller);
      this.rateLimit(caller, LEADS_PER_HOUR, this.leads);
      const parsed = LeadInputSchema.safeParse(raw);
      if (!parsed.success)
        throw new PolicyDenied(
          "INVALID_LEAD",
          parsed.error.issues.some((i) => i.path[0] === "consent")
            ? "The buyer must agree to be contacted."
            : `Check the form: ${parsed.error.issues.map((i) => i.path.join(".") || "form").join(", ")}.`,
        );
      const input = parsed.data;
      const contact = cleanNote(input.contact);
      const existing = this.deps.store
        .readJsonl<LeadRecord>("leads.jsonl")
        .find(
          (l) =>
            l.listing_id === listingId &&
            l.contact.toLowerCase() === contact.toLowerCase() &&
            this.now().getTime() - Date.parse(l.at) < 24 * HOUR,
        );
      if (existing) return { value: { lead_id: existing.id, duplicate: true, fit: existing.fit } };
      const slot = input.slot && listing.policy.visitSlots.includes(input.slot) ? input.slot : null;
      const rec: LeadRecord = {
        id: `lead-${randomUUID().slice(0, 8)}`,
        listing_id: listingId,
        at: this.now().toISOString(),
        name: cleanNote(input.name).slice(0, 80),
        contact,
        message: cleanNote(input.message ?? "").slice(0, 500),
        slot,
        fit: leadFit(listing, caller, input.criteria),
        source: "showroom",
      };
      this.deps.store.appendJsonl("leads.jsonl", rec);
      return { value: { lead_id: rec.id, duplicate: false, fit: rec.fit } };
    });
  }

  /**
   * A buyer asks to be told when a NEW home that fits their search appears. Explicit consent only; the
   * contact goes to the alerts file, never to the audit log. The alert remembers which listings already
   * existed, so it is about what appears later (see runAlerts).
   */
  createAlert(caller: Caller, raw: unknown) {
    return this.guarded(caller, "create_alert", "", async () => {
      this.rateLimit(caller, LEADS_PER_HOUR, this.alerts);
      const parsed = AlertInputSchema.safeParse(raw);
      if (!parsed.success)
        throw new PolicyDenied(
          "INVALID_ALERT",
          parsed.error.issues.some((i) => i.path[0] === "consent")
            ? "The buyer must agree to be contacted."
            : `Check the form: ${parsed.error.issues.map((i) => i.path.join(".") || "form").join(", ")}.`,
        );
      const input = parsed.data;
      const contact = cleanNote(input.contact);
      const criteria = JSON.stringify(input.criteria);
      const existing = this.deps.store
        .readJsonl<AlertRecord>("alerts.jsonl")
        .find(
          (a) =>
            a.contact.toLowerCase() === contact.toLowerCase() &&
            JSON.stringify(a.criteria) === criteria,
        );
      if (existing) return { value: { alert_id: existing.id, duplicate: true } };
      const rec: AlertRecord = {
        id: `alert-${randomUUID().slice(0, 8)}`,
        at: this.now().toISOString(),
        contact,
        name: cleanNote(input.name ?? "").slice(0, 80),
        criteria: input.criteria,
        text: cleanNote(input.text ?? "").slice(0, 300),
        seen: this.deps.store.listListings().map((l) => l.id),
      };
      this.deps.store.appendJsonl("alerts.jsonl", rec);
      return { value: { alert_id: rec.id, duplicate: false } };
    });
  }

  ask(caller: Caller, listingId: string, question: string) {
    return this.guarded<AnswerResult>(
      caller,
      "ask_listing",
      `${listingId} q=${JSON.stringify(question.slice(0, 120))}`,
      async () => {
        const listing = this.require(listingId, caller);
        const facts = visibleFacts(listing, caller);
        this.rateLimit(caller, listing.policy.maxQuestionsPerHour);
        const result = await answerQuestion({ question, listing, facts, model: this.deps.model });
        return { value: result, flags: result.flags };
      },
    );
  }

  requestVisit(caller: Caller, listingId: string, slot: string, note: string) {
    return this.guarded<{ visit_id: string; status: "pending"; message: string }>(
      caller,
      "request_visit",
      `${listingId} slot=${slot}`,
      async () => {
        const listing = this.require(listingId, caller);
        assertMayRequestVisit(listing.policy, caller);
        if (!listing.policy.visitSlots.includes(slot)) {
          throw new PolicyDenied(
            "SLOT_NOT_OFFERED",
            `That slot is not offered. Offered: ${listing.policy.visitSlots.join(", ")}`,
          );
        }
        const rec: VisitRecord = {
          id: randomUUID(),
          listing_id: listingId,
          agent: caller.agentId ?? "",
          slot,
          note: cleanNote(note).slice(0, 300),
          status: "pending",
          at: this.now().toISOString(),
        };
        this.deps.store.appendJsonl("visits.jsonl", rec);
        return {
          value: {
            visit_id: rec.id,
            status: "pending" as const,
            message: "Sent to the broker. A human must approve it; nothing is booked yet.",
          },
        };
      },
    );
  }

  /**
   * A seller that does not serve this caller looks exactly like a listing that does not exist: same
   * code, same message. Otherwise "only for identified agents" would tell anyone which ids are real.
   */
  private require(listingId: string, caller: Caller) {
    const l = this.deps.store.loadListing(listingId);
    if (l) {
      try {
        assertMayRead(l.policy, caller);
      } catch {
        throw new PolicyDenied("LISTING_NOT_FOUND", "No such listing.");
      }
      return l;
    }
    throw new PolicyDenied("LISTING_NOT_FOUND", "No such listing.");
  }

  private rateLimit(caller: Caller, max: number, bucket: Map<string, number[]> = this.asks): void {
    const key = caller.agentId ?? "anonymous";
    const t = this.now().getTime();
    const recent = (bucket.get(key) ?? []).filter((x) => t - x < HOUR);
    if (recent.length >= max)
      throw new PolicyDenied("RATE_LIMITED", "Too many requests this hour.");
    recent.push(t);
    bucket.set(key, recent);
  }
}
