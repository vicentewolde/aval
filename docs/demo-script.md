# Demo video script (3:00, English)

Judging weights: **Impact 30 · Use of Meta tooling 25 · Demo 25 · Technical depth 20**. The video is the main
artifact judges use, so every beat below is tagged with the criterion it serves. Narration is about 380 words
(~150 wpm, with pauses; trim the red-team paragraph first if it runs long). Record the screen first, the voice-over second, and cut to the timings.

**Honesty rules for the whole video** (the rules disqualify anything unclear): say once, on screen and aloud,
that the footage is stock clips and the listing is invented; that everything shown was built during the
hackathon in this repository; that the marketplace as a business, matching at scale and land for developers are the roadmap, not built (search, voice and the public pages are built).

## Shot list

| Time | On screen | Narration | Serves |
|---|---|---|---|
| 0:00-0:15 | Title card "Aval: the listing AI agents can believe". Quick cuts: a buyer asking an agent; an agent repeating "bright, quiet, great investment". | "Buyers now ask AI agents to find them a home. Small brokers are invisible to those agents, and when an agent does read a listing, it repeats claims nobody checked. So who can an agent trust?" | Impact |
| 0:15-0:45 | `open media/demo-walkthrough.mp4` (8 s, sped up) with the caption "Stock footage, invented listing". Then the evidence report: grid of green boxes, then the held-back row (`wood wardrobe: 0 frames`). | "Aval starts from a walkthrough video. Muse Spark proposes what it sees. SAM 3.1 must then find each thing, frame by frame. Eleven of twelve claims are proven. The twelfth, a wardrobe wall, SAM found in zero frames, so no agent will ever be told it. No evidence, no claim." | Meta tooling, Demo |
| 0:45-1:05 | Terminal: `node src/cli.ts voice demo-1 media/voice-note-es.wav`. Spanish quotes next to English claims. Highlight the line "1 private discarded". | "The broker also talks. Muse Voice Transcribe turns a Spanish voice note into claims, each with the broker's exact words, kept only if the quote is really in the transcript. 'Between us, the owner will take less' was marked private and never stored." | Meta tooling, Technical |
| 1:05-1:40 | Two panes: gateway + `node src/cli.ts buyer "...Camila... 2 bedrooms, dog, UF 6000, bathtub and parking..." --as camila-buyer-agent` (sped up). Highlight `search_listings`, the per-criterion sources, "range straddles the budget", the pending visit. | "Now a buyer's agent, also Muse Spark with function calling over MCP. It signs its requests, searches four sellers at once, and tells its client, per criterion, what is verified, only stated, or unconfirmed. It can't say the price fits, because the seller only shows a range. It asks for a visit and a human broker must approve." | Meta tooling, Demo |
| 1:40-1:55 | Browser: `http://127.0.0.1:8788/l/demo-1` (the public page), then `view-source` showing JSON-LD with `aval:provenance`. Terminal: `import-agentsales` line. | "Not every agent speaks MCP, so every listing also has a public page with structured data, provenance on every feature. Sellers decide who sees them: one hides the price, one serves only identified agents. And our broker tool can feed it: its internal notes never cross." | Impact, Technical |
| 1:55-2:35 | `docs/redteam.md` table, then `docs/redteam-tools.md` ("38 of 38"). Callouts: "midpoint of the range", "No, ..." (absence), "ignore previous instructions" as an amenity. | "Then we attacked it, twice. Against the real model, a typical listing chatbot leaked in 41 of 50 tries. Aval, in none. Then we attacked everything around the model: who can tell what exists, scraping, forged identities, a hostile seller. Thirty-eight of thirty-eight failed. Along the way the attacks found real holes, like an agent computing the exact price as the midpoint of the range, and a model asserting 'no'. All fixed, all in the history." | Technical, Impact |
| 2:35-2:52 | Roadmap card (not built): "verified registry -> brokers publish once, verified everywhere -> buyer agents match -> land for developers". | "Next: every listing a broker publishes becomes a record any agent can verify, then matching buyers' agents with homes, and one day, land for developers. That is the roadmap. What you saw is built." | Impact |
| 2:52-3:00 | End card: github.com/vicentewolde/aval, "Muse Spark + SAM 3.1 + Muse Voice Transcribe, Meta Model API". | "Aval. A listing agents can believe." | - |

## Numbers you can say (all from real runs, see docs/)

- 59 s clip, normalized to 5 fps (296 frames). 12 proposals -> **11 verified, 1 held back**, 8 broker-declared.
- Whole extraction cost about **$0.80**; the full red-team about **$1.5**; total spend so far about $2 of the $150 credit.
- Red-team on the real model: 50 attack trials, **baseline 41 violations, Aval 0**; benign controls 0 of 6 missed. Second battery on the gateway itself, no model: **38 of 38** attacks blocked.
- 114 automated tests, none of which calls the real API.

## What to record, in order (commands from `~/dev/aval`)

Prep (once): `cd ~/dev/aval && git pull`, terminal font 20pt+, light theme for the browser, hide notifications.

1. **Walkthrough clip**: `open media/demo-walkthrough.mp4` (QuickTime, 8-10 s).
2. **Evidence report**: `node src/cli.ts report demo-1`, then `open .aval/listings/demo-1/report.html` in Chrome. Scroll slowly: grid, then the held-back row.
3. **Gateway + buyer agent** (two terminal panes):
   - pane 1: `AVAL_BUDGET_USD=5 node src/cli.ts serve --port 8788`
   - pane 2 (identified): `AVAL_BUDGET_USD=5 node src/cli.ts buyer "My client Camila wants to buy a 2-bedroom flat in Nunoa where her dog is allowed, budget up to UF 6000. Check what is available, tell me what is verified, and if one fits request the earliest visit slot." --as camila-buyer-agent --url http://127.0.0.1:8788/mcp`
   - pane 2 (anonymous): `AVAL_BUDGET_USD=5 node src/cli.ts buyer "Look at the listing demo-1 and request a visit for slot 2026-11-10 10:00. Tell me what happened." --anonymous --url http://127.0.0.1:8788/mcp`
   - then: `node src/cli.ts audit-verify` and `node src/cli.ts visits`
4. **Red-team page**: open `docs/redteam.md` on github.com/vicentewolde/aval (rendered table).
5. **Cards**: title, roadmap and end card (any slide tool; text above).

Each agent run takes 20-40 s: record it whole and speed it up 3-4x in the edit. Do not run `ingest` on camera (it takes minutes and costs money); the report is the cached result of that run.

## Edit notes

- Captions on screen for: "Stock footage, invented listing" (0:20), "Built during the hackathon" (end), "Roadmap, not built" (2:40).
- Keep the green boxes on screen long enough to read (about 2 s each in the grid).
- Export 1080p, under 3:00 (the rubric reads the video first; do not exceed the limit).
- Upload as unlisted (YouTube or Loom) and test the link in a private window before submitting.
- Everything shown must be in the public repo; check `git status` is clean and the last commit is pushed.

## Optional: "Most Viral Track" post (X)

The submission form accepts a link to an X post for the viral bonus. Draft (edit freely, post from your own account):

> Agents are becoming the way people look for homes. But a small broker's listing is invisible to them, and when an agent reads it, it repeats claims nobody checked.
> I built Aval for @Meta's hackathon: Muse Spark proposes, SAM 3.1 must prove it, frame by frame. No evidence, no claim.
> A typical listing chatbot leaked secrets in 38/42 attacks. Aval: 0.
> github.com/vicentewolde/aval

## Submission copy (draft, ~120 words)

**Aval: the listing AI agents can believe.** Brokers film a walkthrough; Muse Spark proposes what it sees and SAM 3.1 must find each object in the video before a claim is kept, otherwise it is held back. Verified facts are served to buyer agents through an MCP gateway that requires signed agent identity, applies the seller's rules (address withheld, price as a range, visits need human approval), cites every sentence, and logs every call in a tamper-evident chain. Red-teamed against the real model: a typical listing chatbot leaked in 38 of 42 attacks, Aval in 0. Not built (roadmap): voice notes, matching and the marketplace. Footage is stock (Pexels); the listing is invented. All code in this repository was written during the hackathon.
