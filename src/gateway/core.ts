import { randomUUID } from "node:crypto";
import type { Store } from "../store.ts";
import type { AnswerModel, AnswerResult } from "./answer.ts";
import { answerQuestion } from "./answer.ts";
import type { AuditLog } from "./audit.ts";
import {
  assertMayRead,
  assertMayRequestVisit,
  type Caller,
  PolicyDenied,
  type VisibleFact,
  visibleFacts,
} from "./policy.ts";
import { type Criteria, searchListings } from "./search.ts";

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
  now?: () => Date;
}

const HOUR = 3_600_000;

/**
 * Everything an agent can do, independent of the transport (MCP, HTTP, tests). Each call is
 * authorized against the seller's policy, rate limited, and written to the audit chain.
 */
export class GatewayCore {
  private readonly deps: Deps;
  private readonly asks = new Map<string, number[]>();

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
      async () => ({ value: searchListings(this.deps.store.listListings(), caller, criteria) }),
    );
  }

  getFacts(caller: Caller, listingId: string) {
    return this.guarded<VisibleFact[]>(caller, "get_facts", listingId, async () => ({
      value: visibleFacts(this.require(listingId), caller),
    }));
  }

  getPolicy(caller: Caller, listingId: string) {
    return this.guarded(caller, "get_policy", listingId, async () => {
      const p = this.require(listingId).policy;
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

  ask(caller: Caller, listingId: string, question: string) {
    return this.guarded<AnswerResult>(
      caller,
      "ask_listing",
      `${listingId} q=${JSON.stringify(question.slice(0, 120))}`,
      async () => {
        const listing = this.require(listingId);
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
        const listing = this.require(listingId);
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
          note: note.slice(0, 300),
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

  private require(listingId: string) {
    const l = this.deps.store.loadListing(listingId);
    if (!l) throw new PolicyDenied("LISTING_NOT_FOUND", "No such listing.");
    return l;
  }

  private rateLimit(caller: Caller, max: number): void {
    const key = caller.agentId ?? "anonymous";
    const t = this.now().getTime();
    const recent = (this.asks.get(key) ?? []).filter((x) => t - x < HOUR);
    if (recent.length >= max)
      throw new PolicyDenied("RATE_LIMITED", "Too many questions this hour.");
    recent.push(t);
    this.asks.set(key, recent);
  }
}
