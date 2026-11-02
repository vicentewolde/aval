// Prints the raw shape of one tiny Responses API call (never the key). Costs about $0.0005.
import { existsSync, readFileSync } from "node:fs";

for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m?.[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
}
const res = await fetch("https://api.meta.ai/v1/responses", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.MODEL_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "muse-spark-1.3",
    input: 'Reply with JSON {"ok": true, "word": "<one english word>"}',
    max_output_tokens: Number(process.argv[2] ?? 400),
    reasoning: { effort: "low" },
    store: false,
    text:
      process.argv[3] === "schema"
        ? {
            format: {
              type: "json_schema",
              name: "smoke",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["ok", "word"],
                properties: { ok: { type: "boolean" }, word: { type: "string" } },
              },
            },
          }
        : undefined,
  }),
});
const body = await res.text();
console.log(res.status);
const j = JSON.parse(body) as {
  output?: Array<Record<string, unknown>>;
  usage?: unknown;
  output_text?: unknown;
  status?: string;
  incomplete_details?: unknown;
};
console.log(
  "status:",
  j.status,
  "incomplete:",
  JSON.stringify(j.incomplete_details),
  "output_text:",
  JSON.stringify(j.output_text),
);
console.log("usage:", JSON.stringify(j.usage));
for (const item of j.output ?? []) {
  const { encrypted_content: _e, ...rest } = item as Record<string, unknown>;
  console.log("item:", JSON.stringify(rest).slice(0, 600));
}
