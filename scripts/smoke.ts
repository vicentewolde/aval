/**
 * First real calls, tiny on purpose. Run with a small ceiling:
 *   AVAL_BUDGET_USD=2 node scripts/smoke.ts [clip.mp4]
 * 1. text + structured output (checks auth and the text.format shape)  ~ $0.0002
 * 2. optional: upload a clip, ask SAM for one concept, print what it found  ~ $0.05
 * Use only clips you own and do not mind sharing: free credits let Meta use content to improve its products.
 */
import { existsSync, readFileSync } from "node:fs";
import { normalize } from "../src/extract/media.ts";
import { MetaClient } from "../src/meta/client.ts";
import { SpendGuard } from "../src/spend.ts";

for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m?.[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
}

const guard = SpendGuard.fromEnv();
const client = new MetaClient({ apiKey: process.env.MODEL_API_KEY ?? "", guard });

const r = await client.respond({
  model: "muse-spark-1.3",
  input: 'Reply with JSON {"ok": true, "word": "<one english word>"}',
  jsonSchema: {
    name: "smoke",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "word"],
      properties: { ok: { type: "boolean" }, word: { type: "string" } },
    },
  },
  maxOutputTokens: 64,
  reasoningEffort: "low",
  estInputTokens: 50,
  label: "smoke:text",
});
console.log("text ok:", r.text, `($${r.costUsd.toFixed(6)})`);

const clip = process.argv[2];
if (clip) {
  const out = ".aval/smoke-clip.mp4";
  const info = await normalize(clip, out);
  const frames = Math.floor(info.durationSec * 5);
  const fileId = await client.uploadFile(out, 3600);
  try {
    const sam = await client.segmentVideo({
      concept: "window",
      fileId,
      frames,
      label: "smoke:sam",
    });
    const hits = sam.frames.filter((f) => f.objects.length > 0).length;
    console.log(
      `SAM "window": ${hits}/${frames} frames with detections, first:`,
      JSON.stringify(sam.frames[0]?.objects[0]?.box),
      "conf",
      sam.frames[0]?.objects[0]?.confidence,
    );
  } finally {
    await client.deleteFile(fileId).catch(() => {});
  }
}
console.log(`spent so far: $${guard.spentUsd.toFixed(4)} of $${guard.budgetUsd}`);
