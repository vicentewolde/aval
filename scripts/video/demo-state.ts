/**
 * Puts the demo data in the state a scene needs, for recording by hand.
 *   node scripts/video/demo-state.ts blocked     the title review that finds another owner and a court prohibition
 *   node scripts/video/demo-state.ts attention   the review with a mortgage and two debts (the normal state)
 *   node scripts/video/demo-state.ts reset       attention, and no leads or saved searches left over
 * Only the invented demo-1 listing is touched.
 */
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = ".aval/listings/demo-1";
const mode = process.argv[2];
const swap = (name: "blocked" | "attention") => {
  copyFileSync(`docs/examples/title-review-${name}.json`, join(dir, "title-review.json"));
  console.log(`title review: ${name}`);
};

if (mode === "blocked" || mode === "attention") swap(mode);
else if (mode === "reset") {
  swap("attention");
  for (const f of [".aval/leads.jsonl", ".aval/alerts.jsonl", ".aval/alert-matches.jsonl"])
    if (existsSync(f)) writeFileSync(f, "");
  console.log("leads and saved searches cleared");
} else {
  console.log("usage: node scripts/video/demo-state.ts blocked | attention | reset");
  process.exitCode = 1;
}
