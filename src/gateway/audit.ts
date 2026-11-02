import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
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

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  /**
   * The last entry is read from the file on every append, not remembered: two gateways (or a gateway and
   * a test run) sharing one log would otherwise each extend their own stale tail and fork the chain.
   * Node runs one append at a time within a process; across processes the window is a few microseconds.
   */
  private tail(): { seq: number; prev: string } {
    if (!existsSync(this.path)) return { seq: 0, prev: GENESIS };
    const fd = openSync(this.path, "r");
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, 16_384);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      const last = buf
        .toString("utf8")
        .split("\n")
        .filter((l) => l.trim())
        .at(-1);
      if (!last) return { seq: 0, prev: GENESIS };
      const e = JSON.parse(last) as AuditEntry;
      return { seq: e.seq, prev: e.hash };
    } finally {
      closeSync(fd);
    }
  }

  append(
    e: Pick<AuditEntry, "agent" | "tier" | "tool" | "decision" | "detail">,
    now = new Date(),
  ): AuditEntry {
    const t = this.tail();
    const base = {
      seq: t.seq + 1,
      ts: now.toISOString(),
      ...e,
      detail: e.detail.slice(0, 500),
      prev: t.prev,
    };
    const entry: AuditEntry = { ...base, hash: hashOf(base) };
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
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
