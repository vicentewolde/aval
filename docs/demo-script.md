# Demo video script (3:00, English)

Judging weights: **Impact 30 · Use of Meta tooling 25 · Demo 25 · Technical depth 20**. The video is the main
artifact judges use, so every beat below is tagged with the criterion it serves. Narration is about 388 words
(~150 wpm, with pauses; trim the red-team paragraph first if it runs long). Record the screen first, the voice-over second, and cut to the timings.

**Honesty rules for the whole video** (the rules disqualify anything unclear): say once, on screen and aloud,
that the footage is stock clips and the listing is invented; that everything shown was built during the
hackathon in this repository; that the marketplace as a business, matching at scale and land for developers are the roadmap, not built (search, voice and the public pages are built).

## Shot list

The story is one chain: **prove the property, prove the papers, prove the record, let the agents negotiate
inside limits their humans signed, and stop at a document two humans must sign.** The opening is a person, not an architecture (the winners of the Anthropic x Cerebral Valley hackathons
open with one: see `docs/winning-patterns.md`). The hero beats are the buyer's path (1:10-1:36) and the negotiation (1:36-2:08).

| Time | On screen | Narration | Serves |
|---|---|---|---|
| 0:00-0:25 | Opening card (`docs/opening-card.html`, full screen): Camila asks her agent for a flat; the answer shows "bright, quiet, great investment" and the three claims get struck through one by one. Caption: "Camila is an invented persona". Then the title "Aval: the listing AI agents can believe". | "Camila is buying her first flat, and she asks her AI agent to find one. The agent reads a listing that says bright, quiet, great investment, and repeats it, because nobody ever checked it. If it is wrong, Camila pays for it. So we built what was missing: a listing where every claim has to prove itself." | Impact |
| 0:25-0:48 | Walkthrough clip (caption "Stock footage, invented listing"), then the evidence report: green boxes, then the held-back row (`wood wardrobe: 0 frames`). Then the terminal line of the voice note: Spanish quotes, "1 private discarded". | "A broker films a walkthrough. Muse Spark proposes what it sees; SAM 3.1 has to find each thing, frame by frame. A wardrobe wall SAM never found is held back. The broker's Spanish voice note becomes claims with her exact words, and a secret she asked to keep is never stored. No evidence, no claim." | Meta tooling, Demo |
| 0:48-1:10 | Terminal: `diligence show demo-1` on the *blocked* review (red BLOCKER lines with the quote and page), then the *attention* one. Split: the PDF page next to the quote. | "Then the papers. Muse Spark reads the title certificates, but a field only counts if its words are really on that page. Here, another person is the registered owner and a court has prohibited the sale. Camila's agent sees the rule that fired, never the names. Not legal advice, and it says so." | Meta tooling, Technical, Impact |
| 1:10-1:36 | Browser, full screen: `/search`, type in Spanish "depto para comprar en Ñuñoa, acepta perro, hasta 6 mil UF, con tina"; the "I understood" chips; the result cards with ✓ verified / ? unconfirmed. Click the home: the showroom. Click the bathtub chapter (the video jumps to 0:41). Ask in Spanish; the answer shows the verified wording beside the translation. Send the contact form; then, in the terminal, `node src/cli.ts leads`. | "Camila just types what she wants, in Spanish. Muse Spark turns it into filters, but the ranking is deterministic, and what has no evidence says unconfirmed. In the showroom every verified fact is a chapter of the walkthrough. She asks in Spanish, gets the verified answer, and leaves her contact. The broker receives a lead that already says how well the home fits." | Meta tooling, Demo, Impact |
| 1:36-2:08 | `node src/cli.ts buyer "...negotiate..." --as camila-buyer-agent`, sped up; then `negotiation show`: the moves (the buyer opens near UF 4700, the seller near its asking price, and they close the gap), then `negotiation approve --as camila`, `--as broker-perez`. Callout over the seller's floor and the buyer's maximum: "never shown to the other side". The agreed price differs on every run (UF 4,923 to 5,010 so far, always between the floor 4,900 and the maximum 5,100); the narration does not quote it. | "Her agent, which signs every request, negotiates. It was given a maximum, the broker's agent a secret floor, and neither sees the other's. The engine, not the model, rejects anything outside authority, and the text channel cannot carry a number. They settle inside both limits: a non-binding term sheet that Camila and the broker must both sign, before a lawyer and a notary." | Meta tooling, Technical, Impact |
| 2:08-2:20 | Terminal: `passport verify` -> VALID; the tampered copy -> INVALID; `passport prove ... d-pets` then `verify-proof` -> VALID. | "Every listing becomes a signed passport any agent can verify offline. Change one word and it fails." | Technical, Impact |
| 2:20-2:45 | `docs/redteam.md` table, then `docs/redteam-tools.md` ("110 of 110"). Callouts: "midpoint of the range", "ignore previous instructions", "raise own maximum", "cross-site post". | "We attacked it. Against the real model, a typical listing chatbot leaked in 39 of 50 tries; Aval, in none. Then a hundred and ten attacks on everything around the model, forged mandates, stolen files, cross-site posts, a hijacked seller agent: all failed. The attacks found real holes along the way, now fixed and in the history." | Technical, Impact |
| 2:45-3:00 | Roadmap card (not built): "hosted registry -> matching at scale -> land for developers". End card: github.com/vicentewolde/aval. | "Next: a hosted registry, matching at scale, land for developers. That is the roadmap; what you saw is built. Aval." | Impact |

Narration is about 388 words (about 2:35 spoken, the rest is pauses and on-screen beats). If it runs long, trim 0:48-1:10 and the red-team paragraph first (the search typing can run at 2x in the edit).

## Numbers you can say (all from real runs, see docs/)

- 59 s clip, normalized to 5 fps (296 frames). 12 proposals -> **11 verified, 1 held back**, 8 broker-declared.
- Whole extraction cost about **$0.80**; the full red-team about **$1.5**; the live negotiation **$0.04**; reading a set of four certificates **$0.03**; total spend so far about $4.8 of the $150 credit.
- Red-team on the real model: 50 attack trials, **baseline 39 violations, Aval 0**; benign controls 0 of 6 missed. Second battery, no model: **110 of 110** attacks blocked (39 on the gateway and audit log, 36 on mandates and negotiation, 35 on the buyer pages), mutation-tested.
- Title review on the real model: **3 of 3 sample sets classified correctly** (clear, needs attention, blocked), every finding with the page and the quote.
- Negotiation on the real model (Muse Spark on both sides), run three times: agreed UF 4,990, 5,010 and (offline seller) 4,923; always inside the seller's floor (4,900) and the buyer's maximum (5,100).
- 228 automated tests, none of which calls the real API.

## What to record, in order (commands from `~/dev/aval`)

Prep (once): `cd ~/dev/aval && git pull`, terminal font 20pt+, light theme for the browser, hide notifications.
Make the demo state match the script: `cp docs/examples/title-review-attention.json .aval/listings/demo-1/title-review.json && node src/cli.ts passport issue demo-1`.

0. **Opening card** (25 s): open `docs/opening-card.html` in Chrome, full screen (F11 or green button), reload the page and start recording at the same moment; it plays itself: chat, the three claims struck through, then the title. Record the narration over it.
1. **Walkthrough clip**: `open media/demo-walkthrough.mp4` (QuickTime, 8-10 s).
2. **Evidence report**: `node src/cli.ts report demo-1`, then `open .aval/listings/demo-1/report.html` in Chrome. Scroll slowly: grid, then the held-back row.
3. **Voice note** (cached): scroll to the voice section of the same `report.html` (Spanish quotes next to the English claims, "1 private discarded"); do not re-run `voice` on camera.
4. **Title review** (cached, no spend): `node src/cli.ts diligence show demo-1`; to show the blocked one first, `cp docs/examples/title-review-blocked.json .aval/listings/demo-1/title-review.json`, show, then copy the attention one back. Open a PDF from `fixtures/documents/blocked/` beside it.
5. **Buyer web path** (one terminal pane + the browser; real model, about $0.03): `AVAL_BUDGET_USD=8 node src/cli.ts serve --port 8788`. In Chrome, open `http://127.0.0.1:8788/search` and type: `depto para comprar en Ñuñoa, acepta perro, hasta 6 mil UF, con tina`. Open the first home that says "demo". In the showroom click the bathtub chapter (the video jumps to 0:41), ask `¿Tiene tina?`, then send the form with invented data (name "Camila Soto", contact `camila@example.com`, tick the consent box). In the terminal: `node src/cli.ts leads` (then `node src/cli.ts leads delete <id>` to leave no test data). If the model is over budget the page says it used the basic reader.
6. **Buyer agent search** (optional b-roll, not in the 3-minute cut; keep the `serve` from step 5 running): in a second pane, `AVAL_BUDGET_USD=8 node src/cli.ts buyer "My client Camila wants to buy a 2-bedroom flat in Nunoa where her dog is allowed, budget up to UF 6000. Check what is available, tell me what is verified, and if one fits request the earliest visit slot." --as camila-buyer-agent --url http://127.0.0.1:8788/mcp`
7. **Negotiation** (live, about 2 minutes (119 s measured), $0.05; speed it up 6x in the edit): in a second pane, `AVAL_BUDGET_USD=8 node src/cli.ts buyer "Negotiate the purchase of demo-1 for Camila: start a negotiation, open near her target, concede in small steps, accept only inside her mandate, then report what was agreed and what still has to happen." --as camila-buyer-agent --url http://127.0.0.1:8788/mcp`. Then `node src/cli.ts negotiation list` (the newest is the last line), `negotiation show <id>`, `negotiation approve <id> --as camila`, `negotiation approve <id> --as broker-perez`. The port-8788 gateway must be started with the same `.aval` folder (it is). If the live run stalls, show the saved one: `negotiation show neg-96ac60ae`.
8. **Passport**: `node src/cli.ts passport verify .aval/listings/demo-1/passport.json` (VALID); `sed 's/Pets allowed/Pets not allowed/' .aval/listings/demo-1/passport.json > /tmp/tampered-passport.json && node src/cli.ts passport verify /tmp/tampered-passport.json` (INVALID); `node src/cli.ts passport prove .aval/listings/demo-1/passport.json d-pets > /tmp/proof.json && node src/cli.ts passport verify-proof /tmp/proof.json` (VALID).
9. **Red-team pages**: open `docs/redteam.md` and `docs/redteam-tools.md` on github.com/vicentewolde/aval (rendered tables).
10. **Cards**: title, roadmap and end card (any slide tool; text above).

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
> A typical listing chatbot leaked secrets in 39/50 attacks. Aval: 0.
> github.com/vicentewolde/aval

## Submission copy (draft, ~170 words)

**Aval: the listing AI agents can believe.** A verified-listing registry for AI agents, from the property to a proposal signed by humans. Muse Spark proposes what it sees in a walkthrough video and SAM 3.1 must find each object before a claim is kept; Muse Voice Transcribe turns the broker's Spanish voice note into claims with the exact words as evidence. Muse Spark also reads the sale documents (title, encumbrances, debts), and a field counts only if it is on the cited PDF page. Facts are served to buyer agents through an MCP gateway with signed agent identity, the seller's rules and tamper-evident logs, and sealed in a signed, offline-verifiable Listing Passport. Buyer and seller agents negotiate inside mandates their humans signed; the engine, not the model, enforces the limits, and the result is a non-binding term sheet needing two human approvals. Red-teamed: a typical listing chatbot leaked in 39 of 50 attacks, Aval in 0; 75 further attacks on the surrounding system all failed. Not built (roadmap): a hosted registry, matching at scale, land for developers. Footage is stock (Pexels); listings, documents and the voice note are invented. All code was written during the hackathon.
