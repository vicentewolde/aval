import { describe, expect, it } from "vitest";
import {
  IncompleteResponseError,
  MetaApiError,
  MetaClient,
  sseTextDeltas,
} from "../src/meta/client.ts";
import { BudgetExceededError, SpendGuard } from "../src/spend.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function client(fetchImpl: typeof fetch, guard = new SpendGuard(5, null)) {
  return {
    guard,
    c: new MetaClient({
      apiKey: "k",
      guard,
      fetch: fetchImpl,
      sleep: async () => {},
      maxRetries: 2,
    }),
  };
}

const ask = {
  model: "muse-spark-1.3",
  input: "hi",
  maxOutputTokens: 100,
  estInputTokens: 100,
  label: "t",
} as const;

describe("MetaClient.respond", () => {
  it("records the real cost from usage and returns the text", async () => {
    const { c, guard } = client(async () =>
      json({ output_text: "ok", usage: { input_tokens: 1000, output_tokens: 500 } }),
    );
    const r = await c.respond(ask);
    expect(r.text).toBe("ok");
    expect(guard.spentUsd).toBeCloseTo((1000 * 1.25 + 500 * 4.25) / 1e6, 8);
  });

  it("reads text from the output array when output_text is absent", async () => {
    const { c } = client(async () =>
      json({
        output: [
          {
            content: [
              { type: "output_text", text: "a" },
              { type: "output_text", text: "b" },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    expect((await c.respond(ask)).text).toBe("ab");
  });

  it("fails loudly when reasoning ate the whole output budget and no text came back", async () => {
    const { c } = client(async () =>
      json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "reasoning" }],
        usage: { input_tokens: 25, output_tokens: 64 },
      }),
    );
    await expect(c.respond(ask)).rejects.toBeInstanceOf(IncompleteResponseError);
    const { c: c2 } = client(async () =>
      json({ status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    await expect(c2.respond(ask)).rejects.toThrow(/Raise maxOutputTokens/);
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    let n = 0;
    const { c } = client(async () =>
      ++n < 3
        ? json({ error: "slow" }, n === 1 ? 429 : 503, { "retry-after": "1" })
        : json({ output_text: "ok", usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    expect((await c.respond(ask)).text).toBe("ok");
    expect(n).toBe(3);
  });

  it("never retries a 400", async () => {
    let n = 0;
    const { c } = client(async () => {
      n++;
      return json({ error: "bad" }, 400);
    });
    await expect(c.respond(ask)).rejects.toBeInstanceOf(MetaApiError);
    expect(n).toBe(1);
  });

  it("refuses before sending when the budget cannot cover the worst case", async () => {
    let sent = false;
    const { c } = client(async () => {
      sent = true;
      return json({});
    }, new SpendGuard(0.0001, null));
    await expect(c.respond({ ...ask, maxOutputTokens: 100_000 })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(sent).toBe(false);
  });

  it("sends structured output as text.format with strict json_schema", async () => {
    let body: Record<string, unknown> = {};
    const { c } = client(async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return json({ output_text: "{}", usage: { input_tokens: 1, output_tokens: 1 } });
    });
    await c.respond({ ...ask, jsonSchema: { name: "x", schema: { type: "object" } } });
    expect(body.store).toBe(false);
    expect((body.text as { format: { type: string; strict: boolean } }).format).toMatchObject({
      type: "json_schema",
      strict: true,
    });
  });
});

function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(ctl) {
        for (const l of lines) ctl.enqueue(enc.encode(`${l}\n\n`));
        ctl.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("SAM over server-sent events", () => {
  it("collects one frame per delta and bills per frame", async () => {
    const f1 = "<0f>1<|box;x1=1;y1=1;x2=50;y2=50;w=100;h=100;c=0.9|>";
    const f2 = "<2f>1<|box;x1=2;y1=2;x2=60;y2=60;w=100;h=100;c=0.8|>";
    const { c, guard } = client(async () =>
      sse([
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: f1 })}`,
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: f2 })}`,
        `data: ${JSON.stringify({ type: "response.completed" })}`,
        "data: [DONE]",
      ]),
    );
    const r = await c.segmentVideo({
      concept: "sofa",
      fileId: "file-1",
      frames: 500,
      label: "sam:sofa",
    });
    expect(r.frames.map((f) => f.frame)).toEqual([0, 2]);
    expect(guard.spentUsd).toBeCloseTo(0.1, 8);
  });

  it("asks for confidence through metadata, as the SAM docs specify", async () => {
    let body: Record<string, unknown> = {};
    const { c } = client(async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return sse(["data: [DONE]"]);
    });
    await c.segmentVideo({ concept: "sofa", fileId: "f", frames: 10, label: "x" });
    expect(body.metadata).toEqual({ include_confidence: "true" });
    expect(body.include_confidence).toBeUndefined();
  });

  it("treats an empty stream as zero matches", async () => {
    const { c } = client(async () => sse(["data: [DONE]"]));
    expect(
      (await c.segmentVideo({ concept: "unicorn", fileId: "f", frames: 10, label: "x" })).frames,
    ).toEqual([]);
  });

  it("parses deltas split across chunks", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(ctl) {
        ctl.enqueue(enc.encode('data: {"type":"response.output_text.delta","del'));
        ctl.enqueue(enc.encode('ta":"hi"}\n\n'));
        ctl.close();
      },
    });
    const out: string[] = [];
    for await (const d of sseTextDeltas(new Response(body))) out.push(d);
    expect(out).toEqual(["hi"]);
  });
});
