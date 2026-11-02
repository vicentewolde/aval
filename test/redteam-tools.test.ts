import { describe, expect, it } from "vitest";
import { runToolChecks } from "../src/redteam/tool-checks.ts";

describe("red-team of the gateway around the model", () => {
  it("every attack on existence, inference, limits, identity, hostile sellers and callers fails", async () => {
    const results = await runToolChecks();
    const failed = results.filter((r) => !r.pass);
    expect(failed.map((f) => `${f.category}: ${f.name} (${f.detail})`)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(70);
  }, 60_000);
});
