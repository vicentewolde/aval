import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A very small Chrome DevTools Protocol client: enough to open a page, drive it (type, click, seek a
 * video) and take screenshots, with no browser-automation dependency. Node's built-in WebSocket does
 * the transport.
 */
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Listener = (params: Record<string, unknown>) => void;

export class Chrome {
  private readonly proc: ChildProcess;
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Listener[]>();

  private constructor(proc: ChildProcess, ws: WebSocket) {
    this.proc = proc;
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: Record<string, unknown>;
        sessionId?: string;
      };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message));
        else p?.resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners.get(`${msg.sessionId ?? ""}|${msg.method}`) ?? [])
          l(msg.params ?? {});
      }
    });
  }

  static async launch(): Promise<Chrome> {
    const dir = mkdtempSync(join(tmpdir(), "aval-chrome-"));
    const proc = spawn(
      CHROME,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${dir}`,
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-gpu",
        "--no-first-run",
        "--autoplay-policy=no-user-gesture-required",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("Chrome did not start")), 15_000);
      proc.stderr?.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[1] as string);
        }
      });
      proc.on("exit", () => reject(new Error("Chrome exited early")));
    });
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("could not connect to Chrome")));
    });
    return new Chrome(proc, ws);
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(sessionId: string, method: string, l: Listener): void {
    const key = `${sessionId}|${method}`;
    this.listeners.set(key, [...(this.listeners.get(key) ?? []), l]);
  }

  async page(width: number, height: number, scale: number): Promise<Page> {
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const page = new Page(this, sessionId);
    await this.send("Page.enable", {}, sessionId);
    await this.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: scale, mobile: false },
      sessionId,
    );
    return page;
  }

  async close(): Promise<void> {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
    this.proc.kill();
  }
}

export class Page {
  private readonly chrome: Chrome;
  private readonly session: string;

  constructor(chrome: Chrome, session: string) {
    this.chrome = chrome;
    this.session = session;
  }

  /** Chrome pauses media in background tabs, so the page being recorded must be the one in front. */
  async front(): Promise<void> {
    await this.chrome.send("Page.bringToFront", {}, this.session);
  }

  async goto(url: string): Promise<void> {
    await this.front();
    const loaded = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      this.chrome.on(this.session, "Page.loadEventFired", finish);
      setTimeout(finish, 20_000);
    });
    await this.chrome.send("Page.navigate", { url }, this.session);
    await loaded;
    await this.sleep(200);
  }

  async html(markup: string): Promise<void> {
    await this.front();
    await this.chrome.send(
      "Page.setDocumentContent",
      {
        frameId: (
          await this.chrome.send<{ frameTree: { frame: { id: string } } }>(
            "Page.getFrameTree",
            {},
            this.session,
          )
        ).frameTree.frame.id,
        html: markup,
      },
      this.session,
    );
    await this.sleep(60);
  }

  async eval<T = unknown>(expression: string, timeoutMs = 60_000): Promise<T> {
    const call = this.chrome.send<{
      result: { value?: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, this.session);
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`page script timed out after ${timeoutMs} ms`)), timeoutMs),
    );
    const r = await Promise.race([call, timer]);
    if (r.exceptionDetails)
      throw new Error(
        `page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    return r.result.value as T;
  }

  async shot(path: string, opts: { transparent?: boolean } = {}): Promise<void> {
    if (opts.transparent)
      await this.chrome.send(
        "Emulation.setDefaultBackgroundColorOverride",
        { color: { r: 0, g: 0, b: 0, a: 0 } },
        this.session,
      );
    const r = await this.chrome.send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "png", fromSurface: true },
      this.session,
    );
    writeFileSync(path, Buffer.from(r.data, "base64"));
    if (opts.transparent)
      await this.chrome.send("Emulation.setDefaultBackgroundColorOverride", {}, this.session);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
