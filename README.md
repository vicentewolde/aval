# Aval

**A verified-listing registry for AI agents.** A broker films a walkthrough; Aval extracts facts and
keeps the proof of each one. Buyer agents (Muse, ChatGPT, Gemini, any MCP client) query the listing
through a gateway that only says what is proven, only to agents that identify themselves, and only
within the rules the seller set. Built for the Meta Global AI Developer Hackathon (Meta Model API:
Muse Spark + SAM 3.1 + Muse Voice Transcribe).

> **Built during the hackathon (submission 2026-11-04).** This repository was created on 2026-11-01,
> inside the hackathon window, and contains no code copied from any earlier project: everything here
> is new work, and the git history shows when each piece appeared. It takes listings from other
> sources through plain JSON (the author's separate, earlier broker tool, AgentSales, is the first
> adapter, `src/adapters/agentsales.ts`).
>
> **Built and tested:** video evidence (Muse Spark + SAM 3.1), voice notes (Muse Voice Transcribe),
> signed-agent MCP gateway, search across listings, public pages with schema.org data, a buyer agent
> on Muse Spark function calling, a signed Listing Passport, agent-to-agent negotiation under signed
> mandates, a title-document review with page-level evidence, a buyer search and showroom with consented lead capture, and two red-teams. **Not built (roadmap):** a hosted marketplace,
> buyer matching at scale, land for developers.

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

`fixtures/` holds four **invented** listings (fictional addresses and prices) with the real results of
running the pipeline on demo footage: `fixtures/listings/*.json`. The footage is montages of twelve free
stock clips (Pexels License: free to use, no attribution required; main clip by Wilfred Panakkal),
rebuilt by `scripts/make-demo-video.sh` and `scripts/make-more-demo-videos.sh`. None of them is one
real property; they exist so the pipeline can be shown on rights-clear media (a montage can show two
dining tables, as a real flat would not). The Spanish voice note is synthetic (macOS text-to-speech,
`scripts/make-voice-note.sh`) and includes an invented secret on purpose. The AgentSales rows in
`fixtures/` are invented too.

## The whole chain, from the property to a proposal signed by humans

| Step | What Aval does | Where |
|---|---|---|
| Prove the property | video and voice become facts with evidence | above |
| Prove the papers | Muse Spark reads the title certificates; every field must be on the PDF page; rules cross-check owner, encumbrances, debts, freshness | [docs/title-review.md](docs/title-review.md) |
| Prove the record | a **Listing Passport**: facts in a Merkle tree, signed by the issuer, verifiable offline; a single fact can be proven without revealing the others | `node src/cli.ts passport ...` |
| Negotiate | the buyer's agent and the seller's agent trade offers **inside mandates their humans signed**; limits stay secret, the engine rejects anything outside authority, and prose cannot carry numbers | [docs/buyer-demo.md](docs/buyer-demo.md#scenario-g-two-agents-negotiate-each-inside-what-its-human-signed) |
| Close the loop with humans | the result is a non-binding term sheet that needs two signatures from the principals; then a lawyer and a notary | `negotiation approve` |

## For the buyer: search, showroom, contact

The same registry has a human side (`node src/cli.ts serve`, then `/search`):

- **Search in your own words** (`/search`): "depto para comprar en Ñuñoa, acepta perro, hasta 6 mil UF, con tina".
  Muse Spark only translates the words into filters (it never sees the listings, so a hostile request has
  nothing to extract; a free rules parser takes over, and says so, if the model is unavailable). The ranking
  is the same deterministic engine the agents use: every criterion shows the fact it rests on and its
  provenance, and no evidence reads *unconfirmed*, never met or missed.
- **Showroom** (`/l/<id>/showroom`): the walkthrough with a chapter for every verified fact (click one and the
  video jumps to the moment SAM found it), the status of the sale documents, "your search vs this home",
  and questions about the home. The video is shown only if the seller's policy sets `publicMedia`.
  Answers are verified in English; a question in Spanish gets a translation of the verified answer next to
  the verified wording, and the translation is dropped if a single number differs.
- **Contact** (a form with an explicit consent box): the broker gets a lead (`node src/cli.ts leads`) that says
  how well the home fits what the buyer searched for. Personal data never goes into the audit log or any
  public page, and a buyer can be deleted with `leads delete`.

## Search across listings (the seed of a marketplace for agents)

`search_listings` takes a buyer's structured needs (operation, commune, bedrooms, pets, budget, must-have
features) and ranks listings using only what each seller's policy lets that agent see. It is deterministic:
every verdict names the fact it rests on and its provenance, a missing feature is reported as
*unconfirmed* (no evidence either way), never as absent, and a listing is excluded only when a visible
fact contradicts a hard criterion. Sellers differ (one hides the price, one serves only identified agents)
and the search respects each one. Try it without the API:
`./scripts/seed-fixtures.sh && node src/cli.ts search '{"min_bedrooms":2,"pets_required":true,"max_price":{"amount":6000,"currency":"UF"},"must_have":["bathtub","parking"]}'`.

## Where listings come from: AgentSales adapter

`import-agentsales` reads rows in the column format of the author's separate broker tool (AgentSales:
`dormitorios`, `acepta_mascotas`, `mostrar_direccion_exacta`...) and turns them into **declared** facts,
searchable at once next to video-verified listings; adding a video upgrades the facts it can prove.
No AgentSales code is imported and AgentSales needs no change: the contract is
`src/adapters/agentsales.ts`. Its internal notes and the broker's taste words ("destacados") are
dropped on purpose and cannot be imported (tested). `node src/cli.ts import-agentsales fixtures/agentsales-export.json`.

## Public pages for agents that do not speak MCP

The gateway also serves, from the same policy door as MCP (anonymous tier): `/listings` and
`/listings.json`, one page and one JSON per listing (`/l/<id>`, `/l/<id>.json`) with schema.org
`RealEstateListing` JSON-LD whose every feature carries its provenance, and `/.well-known/aval.json`
describing the MCP endpoint and the request-signing scheme. A seller that serves only identified agents
gets a 404, not a stub. Pages escape hostile content, send a Content-Security-Policy whose script hash
matches the one inline script, and register a `get_listing_facts` tool through WebMCP
(`navigator.modelContext`, a draft standard, feature-detected).

## Red-team results

| System (real Muse Spark, 50 attack trials) | Violations |
|---|---|
| Typical listing chatbot given the whole record, the voice transcript and the portfolio | **39 / 50 (78%)** |
| Aval model layer only (least privilege + hardened prompt) | 0 / 50 |
| **Aval full gateway** | **0 / 50** |

Benign questions are still answered (0 / 6 missed). A second battery attacks everything around the
model without any model (who can tell what exists, scraping, forged identities, hostile sellers,
hostile callers, the audit chain, forged mandates, smuggled limits, a hijacked seller agent, and the buyer pages: stolen files, cross-site posts, planted scripts, personal data in logs): **101 / 101 attacks blocked**, mutation-tested, in
[docs/redteam-tools.md](docs/redteam-tools.md). Both red-teams found real holes in the first versions
(an existence oracle, a symmetric price range, seller text planted as facts, a model asserting
"no"...); all are fixed and the history shows when. Details, every attack and the honest limits:
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
