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
import { startGateway } from "../src/gateway/server.ts";
import { esc, proofMeter, shell, statusIcon, themeFrom } from "../src/gateway/ui.ts";
import { Store } from "../src/store.ts";
import { statusColor } from "../src/style.ts";

const fx = (id: string): Listing =>
  ListingSchema.parse(
    JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "listings", `${id}.json`), "utf8"),
    ),
  );

describe("design system", () => {
  it("escapes what it renders", () => {
    expect(esc(`<img src=x onerror="a">'&`)).toBe(
      "&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;",
    );
  });
  it("pins a theme only when asked, and keeps the rest of the query in the theme links", () => {
    const url = new URL("http://x/search?q=hola&theme=dark");
    expect(themeFrom(url)).toBe("dark");
    expect(themeFrom(new URL("http://x/search?theme=pink"))).toBeNull();
    const pinned = shell({ title: "t", description: "d", body: "", theme: "dark", url });
    expect(pinned).toContain('<html lang="en" data-theme="dark">');
    expect(pinned).toContain("q=hola&amp;theme=light");
    expect(shell({ title: "t", description: "d", body: "" })).toContain('<html lang="en"><head>');
  });
  it("defines every color as a token for both themes", () => {
    const html = shell({ title: "t", description: "d", body: "" });
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain('[data-theme="dark"]');
  });
  it("the proof meter is proportional and labelled for screen readers", () => {
    const m = proofMeter(11, 11, 7);
    expect(m).toContain(
      'aria-label="11 verified in video, 11 said by the broker, 7 declared by the broker"',
    );
    expect(m).toContain("width:37.9%");
    expect(proofMeter(0, 0, 0)).toContain("width:0.0%");
  });
  it("each criterion status has its own icon and meaning", () => {
    expect(statusIcon("met")).toContain("st--ok");
    expect(statusIcon("not_met")).toContain("st--no");
    expect(statusIcon("unconfirmed")).toContain("st--maybe");
  });
});

describe("terminal colors", () => {
  it("map a status to its meaning and switch off with NO_COLOR", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    expect(statusColor("clear")("x")).toContain("\u001b[32m");
    expect(statusColor("blocked")("x")).toContain("\u001b[31m");
    expect(statusColor("needs_attention")("x")).toContain("\u001b[33m");
    process.env.NO_COLOR = "1";
    expect(statusColor("clear")("x")).toBe("x");
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });
});

describe("pages need nothing from the internet", () => {
  let base = "";
  let close: () => void = () => {};
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "aval-ui-"));
    const store = new Store(dir);
    for (const id of ["demo-1", "duplex-las-condes", "loft-providencia"]) store.saveListing(fx(id));
    const core = new GatewayCore({
      store,
      model: new OfflineAnswerModel(),
      audit: new AuditLog(join(dir, "audit.jsonl")),
    });
    const http = await startGateway(core, new AgentRegistry([]), 0, "127.0.0.1", store);
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    close = () => http.close();
  });
  afterAll(() => close());

  for (const path of [
    "/search",
    "/search?q=2+dormitorios",
    "/listings",
    "/l/demo-1",
    "/l/demo-1/showroom",
  ]) {
    it(`${path}: no external stylesheet, script, font or image`, async () => {
      const r = await fetch(`${base}${path}`);
      const html = await r.text();
      expect(r.status).toBe(200);
      expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
      expect(html).not.toMatch(/<script[^>]+src=/i);
      expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
      expect(html).not.toMatch(/<img[^>]+src="https?:/i);
      const csp = r.headers.get("content-security-policy") ?? "";
      expect(csp).not.toMatch(/https?:\/\//);
      expect(html).toContain("<title>");
      expect(html).toContain('<meta name="viewport"');
    });
  }
  it("a pinned theme shows up in the markup", async () => {
    expect(await (await fetch(`${base}/search?theme=dark`)).text()).toContain('data-theme="dark"');
  });
});
