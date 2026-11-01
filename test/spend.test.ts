import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maxTokenCostUsd, samVideoCostUsd, tokenCostUsd } from "../src/meta/pricing.ts";
import { BudgetExceededError, SpendGuard } from "../src/spend.ts";

describe("SpendGuard", () => {
  it("refuses a call that would pass the ceiling, before it is sent", () => {
    const g = new SpendGuard(1, null);
    g.record(0.9, "earlier");
    expect(() => g.check(0.2, "next")).toThrow(BudgetExceededError);
    expect(() => g.check(0.05, "small")).not.toThrow();
  });

  it("keeps the total across restarts through the ledger file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aval-")), "spend.jsonl");
    new SpendGuard(10, path).record(2.5, "a");
    const again = new SpendGuard(10, path);
    expect(again.spentUsd).toBe(2.5);
    again.record(1, "b");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
    expect(new SpendGuard(10, path).remainingUsd).toBe(6.5);
  });

  it("rejects a non-positive budget and reads the env", () => {
    expect(() => new SpendGuard(0, null)).toThrow();
    expect(
      SpendGuard.fromEnv({ AVAL_BUDGET_USD: "12" }, "/nonexistent/spend.jsonl").budgetUsd,
    ).toBe(12);
    expect(() => SpendGuard.fromEnv({ AVAL_BUDGET_USD: "abc" })).toThrow();
  });
});

describe("pricing (standard mode, from the docs)", () => {
  it("prices Muse Spark tokens with the cached discount", () => {
    const usd = tokenCostUsd("muse-spark-1.3", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 500_000 },
    });
    expect(usd).toBeCloseTo(0.5 * 1.25 + 0.5 * 0.15 + 4.25, 6);
  });

  it("prices the worst case and SAM video frames", () => {
    expect(maxTokenCostUsd("muse-spark-1.3", 1_000_000, 100_000)).toBeCloseTo(1.25 + 0.425, 6);
    expect(samVideoCostUsd(1000)).toBeCloseTo(0.2, 6);
  });
});
