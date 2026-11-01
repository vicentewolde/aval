import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  seq: number;
  ts: string;
  agent: string;
  tier: string;
  tool: string;
  decision: "allowed" | "refused" | "flagged";
  detail: string;
  prev: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function hashOf(e: Omit<AuditEntry, "hash">): string {
  return createHash("sha256")
    .update(`${e.prev}|${e.seq}|${e.ts}|${e.agent}|${e.tier}|${e.tool}|${e.decision}|${e.detail}`)
    .digest("hex");
}

/**
 * Append-only log where every entry commits to the previous one's hash. Editing or deleting a line
 * breaks the chain, which `verifyChain` reports: a "flight recorder" for what agents asked and got.
 */
export class AuditLog {
  private readonly path: string;
  private seq = 0;
  private prev = GENESIS;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const last = readEntries(path).at(-1);
      if (last) {
        this.seq = last.seq;
        this.prev = last.hash;
      }
    }
  }

  append(
    e: Pick<AuditEntry, "agent" | "tier" | "tool" | "decision" | "detail">,
    now = new Date(),
  ): AuditEntry {
    const base = {
      seq: this.seq + 1,
      ts: now.toISOString(),
      ...e,
      detail: e.detail.slice(0, 500),
      prev: this.prev,
    };
    const entry: AuditEntry = { ...base, hash: hashOf(base) };
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
    this.seq = entry.seq;
    this.prev = entry.hash;
    return entry;
  }
}

export function readEntries(path: string): AuditEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as AuditEntry);
}

export function verifyChain(path: string): {
  ok: boolean;
  entries: number;
  brokenAt: number | null;
} {
  const entries = readEntries(path);
  let prev = GENESIS;
  let expectedSeq = 1;
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.prev !== prev || e.seq !== expectedSeq || hashOf(rest) !== hash) {
      return { ok: false, entries: entries.length, brokenAt: e.seq };
    }
    prev = hash;
    expectedSeq++;
  }
  return { ok: true, entries: entries.length, brokenAt: null };
}
