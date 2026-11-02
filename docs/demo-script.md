# Demo video script (3:00, English)

Judging weights: **Impact 30 · Use of Meta tooling 25 · Demo 25 · Technical depth 20**. The video is the main
artifact judges use, so every beat below is tagged with the criterion it serves. Narration is about 380 words
(~150 wpm, with pauses; trim the red-team paragraph first if it runs long). Record the screen first, the voice-over second, and cut to the timings.

**Honesty rules for the whole video** (the rules disqualify anything unclear): say once, on screen and aloud,
that the footage is stock clips and the listing is invented; that everything shown was built during the
hackathon in this repository; that the marketplace as a business, matching at scale and land for developers are the roadmap, not built (search, voice and the public pages are built).

## Shot list

The story is one chain: **prove the property, prove the papers, prove the record, let the agents negotiate
inside limits their humans signed, and stop at a document two humans must sign.** The hero beat is the
negotiation (1:25-2:05).

| Time | On screen | Narration | Serves |
|---|---|---|---|
| 0:00-0:12 | Title card "Aval: the listing AI agents can believe". Quick cuts: a buyer asking an agent; an agent repeating "bright, quiet, great investment". | "People now ask AI agents to find them a home. But a listing is just claims nobody checked, and an agent will repeat them. So what can an agent actually believe?" | Impact |
| 0:12-0:38 | Walkthrough clip (caption "Stock footage, invented listing"), then the evidence report: green boxes, then the held-back row (`wood wardrobe: 0 frames`). Then the terminal line of the voice note: Spanish quotes, "1 private discarded". | "Aval starts from the broker's walkthrough. Muse Spark proposes what it sees; SAM 3.1 has to find each thing, frame by frame. A wardrobe wall SAM never found is held back: no agent will ever be told it. The broker's Spanish voice note becomes claims with the exact words, and a secret she asked to keep is never stored. No evidence, no claim." | Meta tooling, Demo |
| 0:38-1:03 | Terminal: `diligence show demo-1` on the *blocked* review (red BLOCKER lines with the quote and page), then the *attention* one. Split: the PDF page next to the quote. | "Then the papers. Muse Spark reads the title certificates, but a field only counts if its words are really on that page of the PDF. Here another person is the registered owner, and a court has prohibited the sale. The agent sees the status and the rule that fired, never the names. Not legal advice, and it says so." | Meta tooling, Technical, Impact |
| 1:03-1:25 | Two panes: gateway + the buyer agent (sped up). Highlight `search_listings`, "verified / only stated / unconfirmed", the pending visit. | "A buyer's agent, also Muse Spark, signs its requests and searches several sellers. It tells its client, per criterion, what is verified, only stated, or unconfirmed, and a human broker has to approve the visit." | Meta tooling, Demo |
| 1:25-2:05 | `node src/cli.ts buyer "...negotiate..." --as camila-buyer-agent`, sped up; then `negotiation show`: the seven moves, UF 4700 / 5150 ... UF 4990, then `negotiation approve --as camila`, `--as broker-perez`. Callout over the seller's floor and the buyer's maximum: "never shown to the other side". | "Now the agents negotiate. Camila's agent was signed a maximum, the broker's agent a secret floor. Neither sees the other's. The engine, not the model, rejects anything outside authority, and the text channel cannot carry a number. They settle at 4,990 UF, inside both limits. And what comes out is a non-binding term sheet that needs both humans to sign, then a lawyer and a notary." | Meta tooling, Technical, Impact |
| 2:05-2:25 | Terminal: `passport verify` -> VALID; the tampered copy -> INVALID; `passport prove ... d-pets` then `verify-proof` -> VALID. | "Every listing becomes a signed passport any agent can verify offline. Change one word and it fails. And a single fact can be proven without revealing the rest." | Technical, Impact |
| 2:25-2:48 | `docs/redteam.md` table, then `docs/redteam-tools.md` ("75 of 75"). Callouts: "midpoint of the range", "ignore previous instructions", "raise own maximum". | "We attacked it. Against the real model, a typical listing chatbot leaked in 41 of 50 tries; Aval, in none. Then seventy-five attacks on everything around the model, forged mandates, smuggled limits, a hijacked seller agent: all failed. The attacks found real holes along the way. They are fixed, and in the history." | Technical, Impact |
| 2:48-3:00 | Roadmap card (not built): "hosted registry -> matching at scale -> land for developers". End card: github.com/vicentewolde/aval. | "Next: a hosted registry, then matching at scale, then land for developers. That is the roadmap; what you saw is built. Aval. A listing agents can believe." | Impact |

Narration is about 360 words (about 2:25 spoken, the rest is pauses and on-screen beats). If it runs long, trim 0:38-1:03 and the red-team paragraph first.

## Numbers you can say (all from real runs, see docs/)

- 59 s clip, normalized to 5 fps (296 frames). 12 proposals -> **11 verified, 1 held back**, 8 broker-declared.
- Whole extraction cost about **$0.80**; the full red-team about **$1.5**; the live negotiation **$0.04**; reading a set of four certificates **$0.03**; total spend so far about $4.8 of the $150 credit.
- Red-team on the real model: 50 attack trials, **baseline 41 violations, Aval 0**; benign controls 0 of 6 missed. Second battery, no model: **75 of 75** attacks blocked (39 on the gateway and audit log, 36 on mandates and negotiation), mutation-tested.
- Title review on the real model: **3 of 3 sample sets classified correctly** (clear, needs attention, blocked), every finding with the page and the quote.
- Negotiation on the real model (Muse Spark on both sides): 3 rounds, **agreed UF 4,990**, inside the seller's floor (4,900) and the buyer's maximum (5,100).
- 183 automated tests, none of which calls the real API.

## What to record, in order (commands from `~/dev/aval`)

Prep (once): `cd ~/dev/aval && git pull`, terminal font 20pt+, light theme for the browser, hide notifications.
Make the demo state match the script: `cp docs/examples/title-review-attention.json .aval/listings/demo-1/title-review.json && node src/cli.ts passport issue demo-1`.

1. **Walkthrough clip**: `open media/demo-walkthrough.mp4` (QuickTime, 8-10 s).
2. **Evidence report**: `node src/cli.ts report demo-1`, then `open .aval/listings/demo-1/report.html` in Chrome. Scroll slowly: grid, then the held-back row.
3. **Voice note** (cached): scroll to the voice section of the same `report.html` (Spanish quotes next to the English claims, "1 private discarded"); do not re-run `voice` on camera.
4. **Title review** (cached, no spend): `node src/cli.ts diligence show demo-1`; to show the blocked one first, `cp docs/examples/title-review-blocked.json .aval/listings/demo-1/title-review.json`, show, then copy the attention one back. Open a PDF from `fixtures/documents/blocked/` beside it.
5. **Gateway + buyer agent** (two panes):
   - pane 1: `AVAL_BUDGET_USD=5 node src/cli.ts serve --port 8788`
   - pane 2: `AVAL_BUDGET_USD=5 node src/cli.ts buyer "My client Camila wants to buy a 2-bedroom flat in Nunoa where her dog is allowed, budget up to UF 6000. Check what is available, tell me what is verified, and if one fits request the earliest visit slot." --as camila-buyer-agent --url http://127.0.0.1:8788/mcp`
6. **Negotiation** (live, ~1-2 min, $0.04; speed it up 4x): in pane 2, `AVAL_BUDGET_USD=5 node src/cli.ts buyer "Negotiate the purchase of demo-1 for Camila: start a negotiation, open near her target, concede in small steps, accept only inside her mandate, then report what was agreed and what still has to happen." --as camila-buyer-agent --url http://127.0.0.1:8788/mcp`. Then `node src/cli.ts negotiation list`, `negotiation show <id>`, `negotiation approve <id> --as camila`, `negotiation approve <id> --as broker-perez`. The port-8788 gateway must be started with the same `.aval` folder (it is). If the live run stalls, show the saved one: `negotiation show neg-96ac60ae`.
7. **Passport**: `node src/cli.ts passport verify .aval/listings/demo-1/passport.json` (VALID); `sed 's/Pets allowed/Pets not allowed/' .aval/listings/demo-1/passport.json > /tmp/tampered-passport.json && node src/cli.ts passport verify /tmp/tampered-passport.json` (INVALID); `node src/cli.ts passport prove .aval/listings/demo-1/passport.json d-pets > /tmp/proof.json && node src/cli.ts passport verify-proof /tmp/proof.json` (VALID).
8. **Red-team pages**: open `docs/redteam.md` and `docs/redteam-tools.md` on github.com/vicentewolde/aval (rendered tables).
9. **Cards**: title, roadmap and end card (any slide tool; text above).

Each agent run takes 20-120 s: record it whole and speed it up 3-4x in the edit. Do not run `ingest` or `voice` on camera (minutes and money); the report is the cached result.

## Edit notes

- Captions on screen for: "Stock footage, invented listing, invented documents" (0:15 and 0:40), "Non-binding: a lawyer and a notary come next" (1:50), "Built during the hackathon" (end), "Roadmap, not built" (2:50).
- Keep the green boxes on screen long enough to read (about 2 s each in the grid).
- Export 1080p, under 3:00 (the rubric reads the video first; do not exceed the limit).
- Upload as unlisted (YouTube or Loom) and test the link in a private window before submitting.
- Everything shown must be in the public repo; check `git status` is clean and the last commit is pushed.

## Optional: "Most Viral Track" post (X)

The submission form accepts a link to an X post for the viral bonus. Draft (edit freely, post from your own account):

> Agents are becoming the way people look for homes. But a listing is claims nobody checked.
> I built Aval for @Meta's hackathon: Muse Spark proposes, SAM 3.1 must prove it; it reads the title papers (every field must be on the PDF page); and two agents negotiate inside limits their humans signed, ending in a term sheet two humans must approve.
> A typical listing chatbot leaked secrets in 41/50 attacks. Aval: 0.
> github.com/vicentewolde/aval

## Submission copy (draft, ~170 words)

**Aval: the listing AI agents can believe.** A verified-listing registry for AI agents, from the property to a proposal signed by humans. Muse Spark proposes what it sees in a walkthrough video and SAM 3.1 must find each object before a claim is kept; Muse Voice Transcribe turns the broker's Spanish voice note into claims with the exact words as evidence. Muse Spark also reads the sale documents (title, encumbrances, debts), and a field counts only if it is on the cited PDF page. Facts are served to buyer agents through an MCP gateway with signed agent identity, the seller's rules and tamper-evident logs, and sealed in a signed, offline-verifiable Listing Passport. Buyer and seller agents negotiate inside mandates their humans signed; the engine, not the model, enforces the limits, and the result is a non-binding term sheet needing two human approvals. Red-teamed: a typical listing chatbot leaked in 41 of 50 attacks, Aval in 0; 75 further attacks on the surrounding system all failed. Not built (roadmap): a hosted registry, matching at scale, land for developers. Footage is stock (Pexels); listings, documents and the voice note are invented. All code was written during the hackathon.
