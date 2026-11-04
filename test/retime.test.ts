import { describe, expect, it } from "vitest";
import { retime } from "../src/video/retime.ts";

describe("fitting a screen recording to its narration slot", () => {
  it("leaves an exact take alone", () => {
    expect(retime(20, 20)).toEqual({ factor: 1, pad: 0, trim: 0, warning: null });
  });
  it("speeds up a take that is a little long", () => {
    const r = retime(30, 25);
    expect(r.factor).toBeCloseTo(25 / 30);
    expect(r.pad).toBe(0);
    expect(r.trim).toBe(0);
    expect(r.warning).toBeNull();
  });
  it("slows a short take a little and holds the last frame for the rest", () => {
    const r = retime(20, 30);
    expect(r.factor).toBeCloseTo(1.25);
    expect(r.pad).toBeCloseTo(5);
  });
  it("lets a long terminal run (two minutes into 26 s) play fast, and says so", () => {
    const r = retime(120, 26);
    expect(1 / r.factor).toBeCloseTo(120 / 26);
    expect(r.trim).toBe(0);
    expect(r.warning).toMatch(/sped up 4\.6x/);
  });
  it("cuts the end only when even the top speed is not enough, and warns", () => {
    const r = retime(300, 20);
    expect(r.factor).toBeCloseTo(1 / 6);
    expect(r.trim).toBeCloseTo(300 / 6 - 20);
    expect(r.warning).toMatch(/too long/);
  });
  it("rejects nonsense lengths", () => {
    expect(() => retime(0, 10)).toThrow();
    expect(() => retime(10, -1)).toThrow();
  });
  it("the resulting length always equals the slot", () => {
    for (const [rec, target] of [
      [12, 22],
      [40, 22],
      [22, 22],
      [90, 26],
      [5, 8],
    ] as const) {
      const r = retime(rec, target);
      expect(rec * r.factor + r.pad - r.trim).toBeCloseTo(target, 5);
    }
  });
});
