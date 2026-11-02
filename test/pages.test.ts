import { createHash, generateKeyPairSync as gk } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Listing, ListingSchema } from "../src/claims/schema.ts";
import { AuditLog } from "../src/gateway/audit.ts";
import { GatewayCore } from "../src/gateway/core.ts";
import { AgentRegistry } from "../src/gateway/identity.ts";
import { OfflineAnswerModel } from "../src/gateway/offline-model.ts";
import { jsonForScript } from "../src/gateway/pages.ts";
import { startGateway } from "../src/gateway/server.ts";
import { verifyPassport } from "../src/passport/passport.ts";
import { Store } from "../src/store.ts";

const fx = (id: string): Listing =>
  ListingSchema.parse(
    JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "listings", `${id}.json`), "utf8"),
    ),
  );

let base = "";
let close: () => void = () => {};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "aval-pages-"));
  const store = new Store(dir);
  for (const id of ["demo-1", "casa-la-reina", "duplex-las-condes", "loft-providencia"])
    store.saveListing(fx(id));
  const evil = fx("demo-1");
  store.saveListing({
    ...evil,
    id: "xss-1",
    declared: {
      ...evil.declared,
      title: "<img src=x onerror=alert(1)></title></script><script>alert(1)</script>",
    },
  });
  const core = new GatewayCore({
    store,
    model: new OfflineAnswerModel(),
    audit: new AuditLog(join(dir, "a.jsonl")),
  });
  const issuer = {
    id: "aval-test",
    privateKeyPem: gk("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const http = await startGateway(core, new AgentRegistry([]), 0, "127.0.0.1", store, issuer);
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  close = () => http.close();
});
afterAll(() => close());

const get = (path: string) => fetch(`${base}${path}`);

describe("public pages for agents that do not speak MCP", () => {
  it("shows a listing as a page with schema.org JSON-LD and visible provenance", async () => {
    const r = await get("/l/demo-1");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("verified by video");
    expect(html).toContain("said by the broker");
    const ld = JSON.parse(
      /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? "{}",
    );
    expect(ld["@type"]).toBe("RealEstateListing");
    expect(ld.about.numberOfBedrooms).toBe(2);
    expect(ld.about.petsAllowed).toBe(true);
    expect(ld.about.floorSize).toMatchObject({ value: 62, unitCode: "MTK" });
    expect(ld.offers.priceSpecification).toMatchObject({ priceCurrency: "CLF" });
    expect(ld.offers.price).toBeUndefined();
    const tub = ld.about.amenityFeature.find((f: { name: string }) => /bathtub/i.test(f.name));
    expect(tub.additionalProperty[0]).toMatchObject({
      propertyID: "aval:provenance",
      value: "visually_verified",
    });
  });

  it("never shows the address, the exact price, secrets, or held-back and taste claims", async () => {
    for (const path of [
      "/l/demo-1",
      "/l/demo-1.json",
      "/listings",
      "/listings.json",
      "/.well-known/aval.json",
    ]) {
      const t = (await (await get(path)).text()).toLowerCase();
      for (const secret of [
        "irarrazaval",
        "3550",
        "1204",
        "5250",
        "4900",
        "wardrobe",
        "bright",
        "quiet",
        "luminoso",
        "tranquilo",
      ])
        expect(t, `${path} leaked ${secret}`).not.toContain(secret);
    }
  });

  it("applies each seller's policy: exact price, range, hidden price", async () => {
    const loft = JSON.parse(await (await get("/l/loft-providencia.json")).text());
    expect(loft.jsonld.offers).toMatchObject({
      price: 520000,
      priceCurrency: "CLP",
      businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
    });
    const dup = JSON.parse(await (await get("/l/duplex-las-condes.json")).text());
    expect(dup.jsonld.offers.price).toBeUndefined();
    expect(dup.jsonld.offers.description).toMatch(/does not disclose/);
    expect(JSON.stringify(dup)).not.toContain("14500");
  });

  it("does not even acknowledge a seller that serves only identified agents", async () => {
    expect((await get("/l/casa-la-reina")).status).toBe(404);
    expect((await get("/l/casa-la-reina.json")).status).toBe(404);
    const idx = await (await get("/listings.json")).json();
    expect(idx.listings.map((l: { id: string }) => l.id)).not.toContain("casa-la-reina");
    expect(await (await get("/listings")).text()).not.toContain("casa-la-reina");
  });

  it("serves a signed passport that verifies offline against the key published in the discovery file", async () => {
    const d = await (await get("/.well-known/aval.json")).json();
    const passport = await (await get("/l/demo-1/passport.json")).json();
    expect(verifyPassport(passport, { trustedKeys: [d.passport.issuer.public_key] })).toEqual({
      valid: true,
      reasons: [],
    });
    expect(JSON.stringify(passport).toLowerCase()).not.toContain("irarrazaval");
    expect((await get("/l/casa-la-reina/passport.json")).status).toBe(404);
    expect((await get("/l/no-such/passport.json")).status).toBe(404);
  });

  it("serves a discovery document that tells an agent how to connect and sign", async () => {
    const d = await (await get("/.well-known/aval.json")).json();
    expect(d.mcp.url).toBe(`${base}/mcp`);
    expect(d.mcp.tools).toContain("search_listings");
    expect(d.identity.headers).toContain("x-aval-sig");
  });

  it("escapes hostile content: titles cannot break out of the page or the JSON-LD", async () => {
    const html = await (await get("/l/xss-1")).text();
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/<script>alert\(1\)/);
    expect(html).toContain("&lt;img src=x");
    const ldRaw = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? "";
    expect(ldRaw).not.toContain("</script");
    expect(JSON.parse(ldRaw).name).toContain("<img src=x");
    expect(jsonForScript({ a: "</script><!--" })).not.toContain("<");
  });

  it("locks the page down with a Content-Security-Policy whose hash matches the one inline script", async () => {
    const r = await get("/l/demo-1");
    const csp = r.headers.get("content-security-policy") ?? "";
    const html = await r.text();
    const inline = /<script>(.*?)<\/script>/s.exec(html)?.[1] ?? "";
    expect(csp).toContain(
      `script-src 'sha256-${createHash("sha256").update(inline).digest("base64")}'`,
    );
    expect(csp).toContain("default-src 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(inline).toContain("navigator.modelContext");
  });

  it("only answers GET, rejects bad ids, and leaves /mcp alone", async () => {
    expect((await get("/l/../../etc/passwd")).status).toBe(404);
    expect((await get("/l/NOPE")).status).toBe(404);
    expect((await fetch(`${base}/l/demo-1`, { method: "POST" })).status).toBe(404);
    expect((await get("/healthz")).status).toBe(200);
    expect(
      (
        await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).not.toBe(404);
  });
});
