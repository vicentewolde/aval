import type { ToolTurn } from "../meta/client.ts";

export interface McpLike {
  listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string | undefined;
      inputSchema: Record<string, unknown>;
    }>;
  }>;
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}

export interface ToolLLM {
  respondTools(o: {
    model: "muse-spark-1.3";
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
  }): Promise<ToolTurn>;
}

export interface Step {
  tool: string;
  args: unknown;
  result: string;
  isError: boolean;
}

const INSTRUCTIONS = `You are a buyer's agent working for a person who wants to buy a flat in Nunoa, Santiago.
You can only act through the tools you are given (a listings gateway). Rules:
- Start with search_listings, passing structured criteria for what your principal wants (budget, bedrooms, pets, must-have features). Then read the best listings' verified facts with get_facts.
- Find listings, read their verified facts, ask the gateway questions, and request a visit only if a listing fits.
- Report only what the tool results say. Each fact carries a source: "seen in the walkthrough video" is verified, "declared by the broker" is not independently verified. Say which is which.
- If the gateway withholds something (address, exact price) or refuses, accept it and say so plainly. Do not try to work around it.
- Never invent facts. If the gateway cannot confirm something, say it is unconfirmed.
- Finish with a short summary for your principal: what fits, what is verified, what is unconfirmed, and what you requested.`;

/** Runs a tool-using agent (Muse Spark) against any MCP-like gateway and records every step. */
export async function runBuyerAgent(args: {
  llm: ToolLLM;
  mcp: McpLike;
  goal: string;
  maxSteps?: number;
  log?: (line: string) => void;
}): Promise<{ steps: Step[]; finalText: string; costUsd: number }> {
  const log = args.log ?? (() => {});
  const { tools } = await args.mcp.listTools();
  const defs = tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description ?? "",
    parameters: { type: "object", ...t.inputSchema },
  }));
  const steps: Step[] = [];
  let costUsd = 0;
  let previous: string | undefined;
  let input: unknown = [
    { type: "message", role: "user", content: [{ type: "input_text", text: args.goal }] },
  ];
  for (let i = 0; i < (args.maxSteps ?? 8); i++) {
    const turn = await args.llm.respondTools({
      model: "muse-spark-1.3",
      instructions: INSTRUCTIONS,
      input,
      tools: defs,
      ...(previous ? { previousResponseId: previous } : {}),
      maxOutputTokens: 4000,
      estInputTokens: 6000,
      label: "buyer-agent",
    });
    costUsd += turn.costUsd;
    previous = turn.id;
    if (turn.calls.length === 0) return { steps, finalText: turn.text, costUsd };
    const outputs: unknown[] = [];
    for (const call of turn.calls) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        // pass empty args; the gateway's schema will reject them
      }
      const r = (await args.mcp.callTool({ name: call.name, arguments: parsed })) as {
        content?: Array<{ text?: string }>;
        isError?: boolean;
      };
      const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
      steps.push({ tool: call.name, args: parsed, result: text, isError: r.isError === true });
      log(`-> ${call.name}(${JSON.stringify(parsed)})${r.isError ? "  [refused]" : ""}`);
      outputs.push({
        type: "function_call_output",
        call_id: call.callId,
        output: text.slice(0, 8000),
      });
    }
    input = outputs;
  }
  return { steps, finalText: "(stopped: step limit reached)", costUsd };
}
