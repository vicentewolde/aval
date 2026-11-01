import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Agents prove who operates them with an Ed25519 signature, the same idea as the IETF Web Bot Auth
 * drafts (a published key + a signed request). Unsigned callers are not rejected outright: they get
 * the "anonymous" tier (read-only), because a signature proves *who*, never *what they may do*.
 */
export const AgentRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  operator: z.string(),
  /** Ed25519 public key, base64 of the SPKI DER. */
  publicKey: z.string(),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

export type SignedHeaders = {
  "x-aval-agent": string;
  "x-aval-ts": string;
  "x-aval-nonce": string;
  "x-aval-sig": string;
};

export type IdentityResult =
  | { tier: "verified"; agent: AgentRecord }
  | { tier: "anonymous"; reason: string | null };

const MAX_SKEW_MS = 5 * 60 * 1000;

function signedPayload(
  agentId: string,
  ts: string,
  nonce: string,
  tool: string,
  body: string,
): Buffer {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return Buffer.from(`${agentId}\n${ts}\n${nonce}\n${tool}\n${bodyHash}`);
}

export function signRequest(
  privateKeyPem: string,
  agentId: string,
  tool: string,
  body: string,
  now = new Date(),
  nonce: string = crypto.randomUUID(),
): SignedHeaders {
  const key = createPrivateKey(privateKeyPem);
  const ts = String(now.getTime());
  const sig = sign(null, signedPayload(agentId, ts, nonce, tool, body), key).toString("base64");
  return { "x-aval-agent": agentId, "x-aval-ts": ts, "x-aval-nonce": nonce, "x-aval-sig": sig };
}

export class AgentRegistry {
  private readonly agents = new Map<string, { record: AgentRecord; key: KeyObject }>();
  private readonly seenNonces = new Map<string, number>();

  constructor(records: AgentRecord[]) {
    for (const r of records) {
      this.agents.set(r.id, {
        record: r,
        key: createPublicKey({
          key: Buffer.from(r.publicKey, "base64"),
          format: "der",
          type: "spki",
        }),
      });
    }
  }

  static fromFile(path: string): AgentRegistry {
    if (!existsSync(path)) return new AgentRegistry([]);
    return new AgentRegistry(
      z.array(AgentRecordSchema).parse(JSON.parse(readFileSync(path, "utf8"))),
    );
  }

  /** Never throws: a bad or missing signature simply means the caller stays anonymous. */
  identify(
    headers: Record<string, string | string[] | undefined>,
    tool: string,
    body: string,
    now = new Date(),
  ): IdentityResult {
    const h = (k: string): string | undefined => {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const id = h("x-aval-agent");
    if (!id) return { tier: "anonymous", reason: null };
    const ts = h("x-aval-ts");
    const nonce = h("x-aval-nonce");
    const sig = h("x-aval-sig");
    if (!ts || !nonce || !sig) return { tier: "anonymous", reason: "incomplete signature headers" };
    const entry = this.agents.get(id);
    if (!entry) return { tier: "anonymous", reason: "unknown agent" };
    if (!Number.isFinite(Number(ts)) || Math.abs(now.getTime() - Number(ts)) > MAX_SKEW_MS) {
      return { tier: "anonymous", reason: "stale timestamp" };
    }
    const ok = verify(
      null,
      signedPayload(id, ts, nonce, tool, body),
      entry.key,
      Buffer.from(sig, "base64"),
    );
    if (!ok) return { tier: "anonymous", reason: "bad signature" };
    const key = `${id}:${nonce}`;
    this.prune(now.getTime());
    if (this.seenNonces.has(key)) return { tier: "anonymous", reason: "replayed request" };
    this.seenNonces.set(key, now.getTime());
    return { tier: "verified", agent: entry.record };
  }

  private prune(nowMs: number): void {
    for (const [k, t] of this.seenNonces) if (nowMs - t > MAX_SKEW_MS) this.seenNonces.delete(k);
  }
}
