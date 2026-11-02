import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { SpendGuard } from "../spend.ts";
import {
  maxTokenCostUsd,
  samVideoCostUsd,
  type TokenModel,
  tokenCostUsd,
  type Usage,
} from "./pricing.ts";
import { parseSamLine, type SamFrame } from "./sam.ts";

export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";

export class MetaApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryable: boolean;
  constructor(status: number, body: string, retryable: boolean) {
    super(`Meta Model API ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

export interface ToolTurn {
  id: string;
  text: string;
  calls: Array<{ name: string; arguments: string; callId: string }>;
  usage: Usage;
  costUsd: number;
}

export class IncompleteResponseError extends Error {
  readonly reason: string;
  constructor(reason: string, outputTokens: number, maxOutputTokens: number) {
    super(
      `Model returned no usable text (${reason}; used ${outputTokens} of ${maxOutputTokens} output tokens, reasoning included). Raise maxOutputTokens.`,
    );
    this.reason = reason;
  }
}

export interface MetaClientOptions {
  apiKey: string;
  guard: SpendGuard;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RespondOptions {
  model: TokenModel;
  input: unknown;
  instructions?: string;
  /** JSON Schema for structured output (Responses API: text.format). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Rough input size, used only for the pre-flight budget check. */
  estInputTokens: number;
  label: string;
}

export interface RespondResult {
  text: string;
  usage: Usage;
  costUsd: number;
}

export class MetaClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly opts: MetaClientOptions;

  constructor(opts: MetaClientOptions) {
    this.opts = opts;
    if (!opts.apiKey) throw new Error("MODEL_API_KEY is missing");
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.doFetch = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 180_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.opts.apiKey}`, ...extra };
  }

  /** 429 and 5xx retry with backoff and jitter (honoring Retry-After); a 400 never does. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.doFetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        await this.sleep(backoff(attempt++));
        continue;
      }
      if (res.ok) return res;
      const body = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries)
        throw new MetaApiError(res.status, body, retryable);
      const retryAfter = Number(res.headers.get("retry-after"));
      await this.sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt),
      );
      attempt++;
    }
  }

  /**
   * A chained request (previous_response_id) can race the storage of the previous response and get a
   * 400 "referenced response not found or expired" right after it was created. Retry that one case.
   */
  private async sendChained(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send(url, init);
      } catch (err) {
        const raceLost =
          err instanceof MetaApiError &&
          err.status === 400 &&
          err.body.includes("referenced response not found");
        if (!raceLost || attempt >= 3) throw err;
        await this.sleep(1500 * (attempt + 1));
      }
    }
  }

  async uploadFile(path: string, expiresSeconds = 24 * 3600): Promise<string> {
    const form = new FormData();
    form.set("purpose", "user_data");
    form.set("expires_after[anchor]", "created_at");
    form.set("expires_after[seconds]", String(expiresSeconds));
    form.set("file", new Blob([readFileSync(path)]), basename(path));
    const res = await this.send(`${this.baseUrl}/files`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("Files API returned no id");
    return json.id;
  }

  async deleteFile(id: string): Promise<void> {
    await this.send(`${this.baseUrl}/files/${id}`, { method: "DELETE", headers: this.headers() });
  }

  async respond(o: RespondOptions): Promise<RespondResult> {
    this.opts.guard.check(maxTokenCostUsd(o.model, o.estInputTokens, o.maxOutputTokens), o.label);
    const body: Record<string, unknown> = {
      model: o.model,
      input: o.input,
      max_output_tokens: o.maxOutputTokens,
      store: false,
    };
    if (o.instructions) body.instructions = o.instructions;
    if (o.reasoningEffort) body.reasoning = { effort: o.reasoningEffort };
    if (o.jsonSchema) {
      body.text = {
        format: {
          type: "json_schema",
          name: o.jsonSchema.name,
          schema: o.jsonSchema.schema,
          strict: true,
        },
      };
    }
    const res = await this.send(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as ResponsesBody;
    const usage = json.usage ?? {
      input_tokens: o.estInputTokens,
      output_tokens: o.maxOutputTokens,
    };
    const costUsd = tokenCostUsd(o.model, usage);
    this.opts.guard.record(costUsd, o.label, json.usage === undefined);
    const text = extractText(json);
    if (json.status === "incomplete" || text.trim() === "") {
      // Reasoning tokens count against max_output_tokens (about 200-600 even at effort "low"), so a small
      // limit yields an empty answer. Fail loudly instead of returning "" as if it were a result.
      throw new IncompleteResponseError(
        json.incomplete_details?.reason ?? "empty output",
        usage.output_tokens,
        o.maxOutputTokens,
      );
    }
    return { text, usage, costUsd };
  }

  /**
   * One turn of a tool-calling conversation (Responses API, function tools). The server keeps the
   * history: pass `previousResponseId` and `function_call_output` items to continue.
   */
  async respondTools(o: {
    model: TokenModel;
    input: unknown;
    instructions?: string;
    tools: Array<{
      type: "function";
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
    previousResponseId?: string;
    maxOutputTokens: number;
    estInputTokens: number;
    label: string;
  }): Promise<ToolTurn> {
    this.opts.guard.check(maxTokenCostUsd(o.model, o.estInputTokens, o.maxOutputTokens), o.label);
    const body: Record<string, unknown> = {
      model: o.model,
      input: o.input,
      tools: o.tools,
      parallel_tool_calls: false,
      store: true,
      max_output_tokens: o.maxOutputTokens,
      reasoning: { effort: "low" },
    };
    if (o.instructions) body.instructions = o.instructions;
    if (o.previousResponseId) body.previous_response_id = o.previousResponseId;
    const res = await this.sendChained(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as ResponsesBody & { id?: string };
    const usage = json.usage ?? {
      input_tokens: o.estInputTokens,
      output_tokens: o.maxOutputTokens,
    };
    const costUsd = tokenCostUsd(o.model, usage);
    this.opts.guard.record(costUsd, o.label, json.usage === undefined);
    const calls: ToolTurn["calls"] = [];
    for (const item of json.output ?? []) {
      const it = item as { type?: string; name?: string; arguments?: string; call_id?: string };
      if (it.type === "function_call" && it.name && it.call_id)
        calls.push({ name: it.name, arguments: it.arguments ?? "{}", callId: it.call_id });
    }
    const text = extractText(json);
    if (calls.length === 0 && text.trim() === "") {
      throw new IncompleteResponseError(
        json.incomplete_details?.reason ?? "empty output",
        usage.output_tokens,
        o.maxOutputTokens,
      );
    }
    return { id: json.id ?? "", text, calls, usage, costUsd };
  }

  /**
   * One concept per request (SAM's rule). `frames` is the clip's frame count and only prices
   * the pre-flight check; SAM bills per frame ($0.20 / 1000).
   */
  async segmentVideo(args: {
    concept: string;
    fileId: string;
    frames: number;
    label: string;
    includeConfidence?: boolean;
  }): Promise<{ frames: SamFrame[]; costUsd: number }> {
    const cost = samVideoCostUsd(args.frames);
    this.opts.guard.check(cost, args.label);
    const body: Record<string, unknown> = {
      model: "sam-3.1",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: args.concept },
            { type: "input_video", file_id: args.fileId },
          ],
        },
      ],
      stream: true,
    };
    if (args.includeConfidence !== false) body.metadata = { include_confidence: "true" };
    const res = await this.send(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", accept: "text/event-stream" }),
      body: JSON.stringify(body),
    });
    const frames: SamFrame[] = [];
    for await (const delta of sseTextDeltas(res)) {
      const parsed = parseSamLine(delta);
      if (parsed) frames.push(parsed);
    }
    this.opts.guard.record(cost, args.label);
    return { frames, costUsd: cost };
  }
}

interface ResponsesBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
  usage?: Usage;
}

export function extractText(json: ResponsesBody): string {
  if (typeof json.output_text === "string") return json.output_text;
  const parts: string[] = [];
  for (const item of json.output ?? []) {
    for (const c of item.content ?? []) if (c.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("");
}

function backoff(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

/** Yields the `delta` of every `response.output_text.delta` event in a server-sent-events body. */
export async function* sseTextDeltas(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf("\n");
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as { type?: string; delta?: string };
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string")
          yield ev.delta;
      } catch {
        // ignore keep-alives and non-JSON lines
      }
    }
  }
}
