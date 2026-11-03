import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Listing, ListingSchema } from "../src/claims/schema.ts";
import { runAlerts } from "../src/gateway/alerts.ts";
import { AuditLog } from "../src/gateway/audit.ts";
import { GatewayCore } from "../src/gateway/core.ts";
import { OfflineAnswerModel } from "../src/gateway/offline-model.ts";
import { Store } from "../src/store.ts";

const fx = (id: string): Listing =>
  ListingSchema.parse(
    JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "listings", `${id}.json`), "utf8"),
    ),
  );
const anon = { agentId: null, tier: "anonymous" } as const;

function world(initial = ["loft-providencia"]) {
  const dir = mkdtempSync(join(tmpdir(), "aval-alerts-"));
  const store = new Store(dir);
  for (const id of initial) store.saveListing(fx(id));
  const core = new GatewayCore({
    store,
    model: new OfflineAnswerModel(),
    audit: new AuditLog(join(dir, "audit.jsonl")),
  });
  return { dir, store, core };
}
const input = (over: Record<string, unknown> = {}) => ({
  contact: "camila@example.com",
  consent: true,
  criteria: { operation: "sale", commune: "Nunoa", min_bedrooms: 2 },
  text: "2 dormitorios en Ñuñoa",
  ...over,
});

describe("saved searches", () => {
  it("match only homes that appear after the alert, once, with their evidence", async () => {
    const { store, core } = world(["loft-providencia", "demo-1"]);
    const r = await core.createAlert(anon, input());
    expect(r).toMatchObject({ ok: true, data: { duplicate: false } });
    expect(runAlerts(store)).toEqual([]); // demo-1 already existed: not "new"
    store.saveListing({ ...fx("demo-1"), id: "nunoa-new" });
    const fresh = runAlerts(store);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({
      listing_id: "nunoa-new",
      fit: expect.stringMatching(/all_met|some_unconfirmed/),
    });
    expect(fresh[0]?.met.length).toBeGreaterThan(0);
    expect(runAlerts(store)).toEqual([]); // recorded once
  });
  it("does not match a new home that contradicts a hard criterion", async () => {
    const { store, core } = world();
    await core.createAlert(anon, input());
    store.saveListing({ ...fx("duplex-las-condes"), id: "las-condes-new" });
    expect(runAlerts(store)).toEqual([]);
  });
  it("never matches a seller that serves only identified agents", async () => {
    const { store, core } = world();
    await core.createAlert(anon, input({ criteria: { commune: "La Reina" } }));
    store.saveListing({ ...fx("casa-la-reina"), id: "reina-new" });
    expect(runAlerts(store)).toEqual([]);
  });
  it("refuses without consent, without a real criterion, or with bad contact data", async () => {
    const { core } = world();
    for (const bad of [
      { consent: false },
      { criteria: {} },
      { criteria: { limit: 3 } },
      { contact: "nope" },
      { criteria: { min_bedrooms: 99 } },
    ])
      expect(await core.createAlert(anon, input(bad))).toMatchObject({
        ok: false,
        code: "INVALID_ALERT",
      });
  });
  it("does not store the same buyer and search twice", async () => {
    const { core } = world();
    const a = await core.createAlert(anon, input());
    const b = await core.createAlert(anon, input({ contact: "CAMILA@example.com" }));
    expect(b).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(a.ok && b.ok && a.data.alert_id === b.data.alert_id).toBe(true);
  });
  it("keeps the contact out of the audit log and strips control characters", async () => {
    const { dir, core } = world();
    await core.createAlert(anon, input({ name: "Cami\u001b[2J Soto", text: "x\u0007y" }));
    expect(readFileSync(join(dir, "audit.jsonl"), "utf8")).not.toContain("camila@example.com");
    const rec = JSON.parse(readFileSync(join(dir, "alerts.jsonl"), "utf8").trim());
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(rec.name + rec.text)).toBe(false);
  });
});
