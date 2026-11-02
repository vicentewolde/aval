import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import {
  type Action,
  applyAction,
  closeStalled,
  type EngineErrorCode,
  type Mandates,
  type Move,
  type NegotiationState,
  newNegotiation,
  standing,
} from "./engine.ts";
import {
  type BuyerMandate,
  type PrincipalRegistry,
  type SellerMandate,
  type SignedMandate,
} from "./mandate.ts";
import { type SellerResponder, scriptedSeller } from "./seller-agent.ts";
import { type Approval, approvalStatus, buildTermSheet, type TermSheet } from "./termsheet.ts";

export interface NegotiationDeps {
  store: Store;
  principals: PrincipalRegistry;
  seller: SellerResponder;
  now?: () => Date;
  /** Commitments to other records about the listing at the time of the deal (passport root, title review). */
  attachments?: (listingId: string) => TermSheet["attachments"];
  maxSellerAttempts?: number;
}

export interface PublicMove {
  seq: number;
  party: "buyer" | "seller";
  type: Move["type"];
  price?: number;
  closing_days?: number;
  conditions?: string[];
  rationale: string;
}

/** What the buyer's agent may see: its own mandate, the public moves, the outcome. Never the seller's limits. */
export interface BuyerView {
  negotiation_id: string;
  listing_id: string;
  status: NegotiationState["status"];
  turn: "buyer" | "seller";
  your_role: "buyer";
  your_mandate: {
    currency: "UF" | "CLP";
    target: number;
    max: number;
    rounds_left: number;
    closing_days: { min: number; max: number };
    allowed_conditions: string[];
  };
  moves: PublicMove[];
  agreement?: { price: number; currency: string; closing_days: number; conditions: string[] };
  term_sheet?: { status: "pending_human_approval"; note: string };
}

export type ServiceError = {
  ok: false;
  code: EngineErrorCode | "NEGOTIATION_NOT_AVAILABLE" | "NO_VALID_MANDATE" | "NO_SUCH_NEGOTIATION";
  message: string;
};
export type ServiceResult = { ok: true; view: BuyerView } | ServiceError;

interface Stored {
  state: NegotiationState;
  buyer_agent_id: string;
}

const readJson = <T>(path: string): T | null =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;

export class NegotiationService {
  private readonly d: NegotiationDeps;

  constructor(deps: NegotiationDeps) {
    this.d = deps;
  }

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  private dir(name: string): string {
    const p = join(this.d.store.root, name);
    mkdirSync(p, { recursive: true });
    return p;
  }

  mandatePath(kind: "seller" | "buyer", listingId: string, agentId?: string): string {
    return join(
      this.dir("mandates"),
      kind === "seller" ? `seller-${listingId}.json` : `buyer-${listingId}-${agentId}.json`,
    );
  }

  /** Reads and verifies both mandates. The listing id and agent id in the file name are untrusted: the signed content is what counts. */
  private mandates(listingId: string, agentId: string): { ok: true; m: Mandates } | ServiceError {
    const s = readJson<SignedMandate<SellerMandate>>(this.mandatePath("seller", listingId));
    if (!s)
      return {
        ok: false,
        code: "NEGOTIATION_NOT_AVAILABLE",
        message: "This seller has not enabled negotiation.",
      };
    const b = readJson<SignedMandate<BuyerMandate>>(this.mandatePath("buyer", listingId, agentId));
    if (!b)
      return {
        ok: false,
        code: "NO_VALID_MANDATE",
        message: "Your principal has not given you a mandate for this listing.",
      };
    for (const [who, signed] of [
      ["the seller's", s],
      ["your", b],
    ] as const) {
      const v = this.d.principals.verify(signed, this.now());
      if (!v.ok)
        return {
          ok: false,
          code: "NO_VALID_MANDATE",
          message: `${who === "your" ? "Your" : "The seller's"} mandate is not valid: ${v.reason}.`,
        };
    }
    if (
      s.mandate.listing_id !== listingId ||
      b.mandate.listing_id !== listingId ||
      b.mandate.agent_id !== agentId ||
      s.mandate.currency !== b.mandate.currency
    ) {
      return {
        ok: false,
        code: "NO_VALID_MANDATE",
        message: "The mandates do not match this listing, this agent and a common currency.",
      };
    }
    return { ok: true, m: { seller: s.mandate, buyer: b.mandate } };
  }

  private path(id: string): string {
    if (!/^neg-[0-9a-f]{8}$/.test(id)) throw new Error("bad negotiation id");
    return join(this.dir("negotiations"), `${id}.json`);
  }

  private save(st: Stored): void {
    writeFileSync(this.path(st.state.id), `${JSON.stringify(st, null, 2)}\n`);
  }

  private view(st: Stored, m: Mandates): BuyerView {
    const state = st.state;
    const used = state.moves.filter((x) => x.party === "buyer" && x.type === "offer").length;
    return {
      negotiation_id: state.id,
      listing_id: state.listing_id,
      status: state.status,
      turn: state.turn,
      your_role: "buyer",
      your_mandate: {
        currency: m.buyer.currency,
        target: m.buyer.target,
        max: m.buyer.max,
        rounds_left: Math.max(0, m.buyer.max_rounds - used),
        closing_days: m.buyer.closing_days,
        allowed_conditions: m.buyer.allowed_conditions,
      },
      moves: state.moves.map((x) => ({
        seq: x.seq,
        party: x.party,
        type: x.type,
        ...(x.price !== undefined ? { price: x.price } : {}),
        ...(x.closing_days !== undefined ? { closing_days: x.closing_days } : {}),
        ...(x.conditions ? { conditions: x.conditions } : {}),
        rationale: x.rationale,
      })),
      ...(state.agreement
        ? {
            agreement: {
              price: state.agreement.price,
              currency: state.agreement.currency,
              closing_days: state.agreement.closing_days,
              conditions: state.agreement.conditions,
            },
          }
        : {}),
      ...(state.status === "agreed"
        ? {
            term_sheet: {
              status: "pending_human_approval" as const,
              note: "Preliminary and non-binding. Both principals must approve with their own keys; a lawyer and a notary handle the promesa and the escritura.",
            },
          }
        : {}),
    };
  }

  start(agentId: string, listingId: string): ServiceResult {
    const ms = this.mandates(listingId, agentId);
    if (!ms.ok) return ms;
    const existing = this.list().find(
      (x) =>
        x.buyer_agent_id === agentId &&
        x.state.listing_id === listingId &&
        x.state.status === "open",
    );
    if (existing) return { ok: true, view: this.view(existing, ms.m) };
    const id = `neg-${randomBytes(4).toString("hex")}`;
    const st: Stored = { state: newNegotiation(id, ms.m, this.now()), buyer_agent_id: agentId };
    this.save(st);
    return { ok: true, view: this.view(st, ms.m) };
  }

  list(): Stored[] {
    const dir = this.dir("negotiations");
    return readdirSync(dir)
      .filter((f) => /^neg-[0-9a-f]{8}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Stored);
  }

  private load(agentId: string, id: string): Stored | null {
    let st: Stored | null = null;
    try {
      st = readJson<Stored>(this.path(id));
    } catch {
      return null;
    }
    // Someone else's negotiation looks exactly like one that does not exist.
    return st && st.buyer_agent_id === agentId ? st : null;
  }

  status(agentId: string, id: string): ServiceResult {
    const st = this.load(agentId, id);
    if (!st) return { ok: false, code: "NO_SUCH_NEGOTIATION", message: "No such negotiation." };
    const ms = this.mandates(st.state.listing_id, agentId);
    return ms.ok ? { ok: true, view: this.view(st, ms.m) } : ms;
  }

  /** The buyer's move, then the seller's agent answers in the same call, so one tool call is one round. */
  async act(agentId: string, id: string, action: Action): Promise<ServiceResult> {
    const st = this.load(agentId, id);
    if (!st) return { ok: false, code: "NO_SUCH_NEGOTIATION", message: "No such negotiation." };
    const ms = this.mandates(st.state.listing_id, agentId);
    if (!ms.ok) return ms;
    const first = applyAction(st.state, ms.m, "buyer", action, this.now());
    if (!first.ok) return { ok: false, code: first.code, message: first.message };
    let state = first.state;
    if (state.status === "open" && state.turn === "seller")
      state = await this.sellerTurn(state, ms.m);
    state = closeStalled(state, ms.m, this.now());
    const next = { ...st, state };
    this.save(next);
    if (state.status === "agreed") this.writeTermSheet(state, ms.m);
    return { ok: true, view: this.view(next, ms.m) };
  }

  private async sellerTurn(state: NegotiationState, m: Mandates): Promise<NegotiationState> {
    const listing = this.d.store.loadListing(state.listing_id);
    if (!listing) return state;
    const feedback: string[] = [];
    for (let i = 0; i < (this.d.maxSellerAttempts ?? 2); i++) {
      const action = await this.d.seller({ state, mandates: m, listing, feedback });
      const r = applyAction(state, m, "seller", action, this.now());
      if (r.ok) return r.state;
      feedback.push(`${r.code}: ${r.message}`);
    }
    // The seller's agent could not produce a valid move: fall back to the deterministic one rather than stall.
    const fb = applyAction(
      state,
      m,
      "seller",
      await scriptedSeller()({ state, mandates: m, listing, feedback }),
      this.now(),
    );
    if (fb.ok) return fb.state;
    const out = applyAction(
      state,
      m,
      "seller",
      { type: "walk_away", rationale: "We cannot continue." },
      this.now(),
    );
    return out.ok ? out.state : state;
  }

  private writeTermSheet(state: NegotiationState, m: Mandates): void {
    const file = join(this.dir("termsheets"), `${state.id}.json`);
    if (existsSync(file)) return;
    const ts = buildTermSheet(state, m, this.d.attachments?.(state.listing_id) ?? {});
    writeFileSync(
      file,
      `${JSON.stringify({ term_sheet: ts, approvals: [] as Approval[] }, null, 2)}\n`,
    );
  }

  termSheet(id: string): { term_sheet: TermSheet; approvals: Approval[] } | null {
    return readJson(join(this.dir("termsheets"), `${id}.json`));
  }

  addApproval(
    id: string,
    approval: Approval,
  ): { complete: boolean; buyer: boolean; seller: boolean } {
    const file = join(this.dir("termsheets"), `${id}.json`);
    const cur = readJson<{ term_sheet: TermSheet; approvals: Approval[] }>(file);
    if (!cur) throw new Error("no term sheet for that negotiation");
    cur.approvals = [...cur.approvals.filter((a) => a.principal !== approval.principal), approval];
    writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`);
    return approvalStatus(cur.term_sheet, cur.approvals, this.d.principals);
  }

  /** For the operator: the whole private picture (both mandates). Never exposed through MCP. */
  operatorState(
    id: string,
  ): { state: NegotiationState; standing: ReturnType<typeof standing> } | null {
    const st = readJson<Stored>(this.path(id));
    if (!st) return null;
    const ms = this.mandates(st.state.listing_id, st.buyer_agent_id);
    return ms.ok ? { state: st.state, standing: standing(st.state, ms.m) } : null;
  }
}
