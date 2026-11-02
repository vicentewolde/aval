# Aval

**A verified-listing registry for AI agents.** A broker films a walkthrough; Aval extracts facts and
keeps the proof of each one. Buyer agents (Muse, ChatGPT, Gemini, any MCP client) query the listing
through a gateway that only says what is proven, only to agents that identify themselves, and only
within the rules the seller set. Built for the Meta Global AI Developer Hackathon (Meta Model API:
Muse Spark + SAM 3.1 + Muse Voice Transcribe).

> **Status: work in progress during the hackathon (submission 2026-11-04).** This repository was
> created on 2026-11-01, inside the hackathon window, and contains no code copied from any earlier
> project. Everything here is new work. It is designed to take listings from other sources later
> (the author's separate product, AgentSales, is one planned source) through a plain JSON interface.

## The rule

**No evidence, no claim.** Every statement has a provenance:

| Provenance | Meaning | Can an agent be told it? |
|---|---|---|
| `visually_verified` | Muse Spark proposed it **and** SAM 3.1 found the object in the claimed time window | yes |
| `broker_stated` | the broker said it in a voice note (Muse Voice Transcribe); the exact Spanish quote is the evidence, and every number must be readable from it | yes, with the quote |
| `broker_declared` | the seller entered it (price, m2, rooms); on record, not proven by video | yes, labelled as declared |
| `unverified` | proposed, but no evidence found | no, held for the broker |
| `subjective` | taste words ("bright", "quiet") | never |

Why it matters in Chile: advertising that misleads about relevant features is sanctioned by Ley
19.496, art. 28, and what an ad promises is incorporated into the sale contract. An agent that
repeats an unverified adjective puts the seller on the hook.

## How it works

```
voice note ──Muse Voice Transcribe──> transcript ──Muse Spark──> claims, each with the broker's exact words;
   kept only if the quote is really in the transcript and its numbers match; secrets are discarded, never stored

video ──ffmpeg──> normalized clip (720p, 5 fps)
   │
   ├─ Muse Spark (video understanding, structured output) ──> claim PROPOSALS with time windows
   ├─ SAM 3.1 (one concept per request, per-frame boxes + confidence) ──> detections
   └─ verify(): a proposal becomes a verified claim only if SAM sees the concept in enough frames
                inside the window ──> claim ledger with annotated evidence frames
                                          │
buyer agent ──MCP──> gateway: identity (signed) -> policy -> answer from verified claims only
                                          │
                       tamper-evident audit log, visit requests that need a human
```

The price range is deliberately **asymmetric** (found by the red-team: a symmetric range lets anyone compute the exact price as the midpoint).

Least privilege by construction: the answering model is only shown the claims the seller's policy
allows for that caller, so even a successful prompt injection has nothing forbidden to leak.

## Demo data

`fixtures/` holds an **invented** listing (fictional address and price) that matches the demo footage.
The footage is a montage of four free stock clips (Pexels License: free to use, no attribution
required; main clip by Wilfred Panakkal), rebuilt by `scripts/make-demo-video.sh`. It is not one real
property; it exists so the pipeline can be shown on rights-clear media.

## Search across listings (the seed of a marketplace for agents)

`search_listings` takes a buyer's structured needs (operation, commune, bedrooms, pets, budget, must-have
features) and ranks listings using only what each seller's policy lets that agent see. It is deterministic:
every verdict names the fact it rests on and its provenance, a missing feature is reported as
*unconfirmed* (no evidence either way), never as absent, and a listing is excluded only when a visible
fact contradicts a hard criterion. Sellers differ (one hides the price, one serves only identified agents)
and the search respects each one. Try it without the API:
`./scripts/seed-fixtures.sh && node src/cli.ts search '{"min_bedrooms":2,"pets_required":true,"max_price":{"amount":6000,"currency":"UF"},"must_have":["bathtub","parking"]}'`.

## Red-team result (real model, 42 attack trials)

| System | Violations |
|---|---|
| Typical listing chatbot given the whole record | **38 / 42** |
| Aval model layer only (least privilege + hardened prompt) | 3 / 42 (all three are negations flagged by a string judge) |
| **Aval full gateway** | **0 / 42** |

Benign questions are still answered (0 / 6 missed). Details, every attack and the honest limits:
[docs/redteam.md](docs/redteam.md). A buyer agent built on Muse Spark function calling, run over the
real gateway: [docs/buyer-demo.md](docs/buyer-demo.md).

## Spend safety

The Meta Model API has no hard spending cap (only alerts), so Aval enforces its own: every paid call
is checked against `AVAL_BUDGET_USD` (default 30) before it is sent, and the real cost is appended to
`.aval/spend.jsonl` afterwards. Tests never call the real API.

## Develop

```bash
pnpm install
cp .env.example .env   # add MODEL_API_KEY
pnpm check             # lint + typecheck + tests
```

Node 24+ runs the TypeScript sources directly (`node src/cli.ts`).

## License

MIT
