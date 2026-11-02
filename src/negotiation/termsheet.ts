import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalJson } from "../passport/merkle.ts";
import type { Mandates, NegotiationState } from "./engine.ts";
import type { Condition } from "./mandate.ts";
import { mandateCommitment, type PrincipalRegistry } from "./mandate.ts";

/**
 * What a successful negotiation produces is NOT a contract: it is a preliminary, non-binding term sheet
 * that two humans must each approve with their own key. The agents can propose; only people commit. It
 * ties the deal to the evidence: the commitment to each side's mandate (so anyone can later check the
 * price was within authority without seeing the limits), the head of the move log, the Listing
 * Passport root and the title-review hash at the time.
 */
export interface TermSheet {
  id: string;
  listing_id: string;
  price: number;
  currency: "UF" | "CLP";
  closing_days: number;
  conditions: Condition[];
  agreed_at: string;
  parties: { buyer: { principal: string; agent_id: string }; seller: { principal: string } };
  commitments: { buyer_mandate: string; seller_mandate: string };
  transcript_head: string;
  attachments: { passport_root?: string; title_review?: string };
  non_binding: true;
  notice: string;
}

export interface Approval {
  principal: string;
  at: string;
  signature: string;
}

export const NOTICE =
  "Preliminary and non-binding. A promesa de compraventa and the escritura require a lawyer and a notary; this sheet only records what two agents proposed within their principals' authority.";

export function buildTermSheet(
  state: NegotiationState,
  m: Mandates,
  attachments: TermSheet["attachments"] = {},
): TermSheet {
  if (state.status !== "agreed" || !state.agreement)
    throw new Error("only an agreed negotiation has a term sheet");
  return {
    id: state.id,
    listing_id: state.listing_id,
    price: state.agreement.price,
    currency: state.agreement.currency,
    closing_days: state.agreement.closing_days,
    conditions: state.agreement.conditions,
    agreed_at: state.agreement.agreed_at,
    parties: {
      buyer: { principal: m.buyer.principal, agent_id: m.buyer.agent_id },
      seller: { principal: m.seller.principal },
    },
    commitments: {
      buyer_mandate: mandateCommitment(m.buyer),
      seller_mandate: mandateCommitment(m.seller),
    },
    transcript_head: state.moves.at(-1)?.hash ?? "",
    attachments,
    non_binding: true,
    notice: NOTICE,
  };
}

export function approveTermSheet(
  ts: TermSheet,
  principal: string,
  privateKeyPem: string,
  now = new Date(),
): Approval {
  const at = now.toISOString();
  return {
    principal,
    at,
    signature: sign(
      null,
      Buffer.from(canonicalJson({ ts, principal, at })),
      createPrivateKey(privateKeyPem),
    ).toString("base64"),
  };
}

export interface ApprovalStatus {
  buyer: boolean;
  seller: boolean;
  complete: boolean;
}

/** Each side counts only if its own principal's registered key signed this exact sheet. */
export function approvalStatus(
  ts: TermSheet,
  approvals: Approval[],
  principals: PrincipalRegistry,
): ApprovalStatus {
  const valid = (principal: string): boolean =>
    approvals.some((a) => {
      const pub = principals.publicKeyOf(a.principal);
      if (a.principal !== principal || !pub) return false;
      try {
        return verify(
          null,
          Buffer.from(canonicalJson({ ts, principal: a.principal, at: a.at })),
          createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" }),
          Buffer.from(a.signature, "base64"),
        );
      } catch {
        return false;
      }
    });
  const buyer = valid(ts.parties.buyer.principal);
  const seller = valid(ts.parties.seller.principal);
  return { buyer, seller, complete: buyer && seller };
}
