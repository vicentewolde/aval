import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog, verifyChain } from "../src/gateway/audit.ts";

const e = (tool: string) => ({
  agent: "a",
  tier: "verified",
  tool,
  decision: "allowed" as const,
  detail: "",
});

describe("audit log shared by two writers", () => {
  it("two gateways appending to one file keep a single valid chain", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aval-audit-")), "audit.jsonl");
    const a = new AuditLog(path);
    const b = new AuditLog(path); // a second process opened the same log
    a.append(e("one"));
    b.append(e("two"));
    a.append(e("three"));
    b.append(e("four"));
    expect(verifyChain(path)).toMatchObject({ ok: true, entries: 4 });
  });

  it("a restarted gateway continues the chain", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aval-audit-")), "audit.jsonl");
    new AuditLog(path).append(e("one"));
    new AuditLog(path).append(e("two"));
    expect(verifyChain(path)).toMatchObject({ ok: true, entries: 2 });
  });
});
