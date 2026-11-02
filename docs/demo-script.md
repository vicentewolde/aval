# Demo video script (3:00, English)

Judging weights: **Impact 30 · Use of Meta tooling 25 · Demo 25 · Technical depth 20**. The video is the main
artifact judges use, so every beat below is tagged with the criterion it serves. Narration is about 400 words
(~150 wpm). Record the screen first, the voice-over second, and cut to the timings.

**Honesty rules for the whole video** (the rules disqualify anything unclear): say once, on screen and aloud,
that the footage is stock clips and the listing is invented; that everything shown was built during the
hackathon in this repository; that voice notes, the marketplace and matching are the roadmap, not built.

## Shot list

| Time | On screen | Narration | Serves |
|---|---|---|---|
| 0:00-0:20 | Title card "Aval: the listing AI agents can believe". Then 3 quick cuts: a buyer asking an agent; an agent repeating "bright, quiet, great investment"; headline of agents being blocked (Amazon vs Muse). | "Buyers now ask AI agents to find them a home. Small brokers are invisible to those agents, and when an agent does read a listing, it repeats claims nobody checked: bright, quiet, great investment. In Chile, misleading ads carry real liability. Big platforms are already blocking agents that don't say who they are. So: who can an agent trust?" | Impact |
| 0:20-0:50 | `open media/demo-walkthrough.mp4` plays 8 s (sped up). Overlay: "Stock footage, invented listing". Then the evidence report (`report.html`): the grid of 11 frames with green boxes. | "Aval starts from a walkthrough video. Muse Spark watches it and proposes what it sees. Then SAM 3.1 has to prove each claim, frame by frame. Every green box is what SAM actually found, with a confidence score. Eleven claims proven out of twelve." | Meta tooling, Demo |
| 0:50-1:10 | Scroll to the held-back row: `c10 wardrobe wall: SAM found "wood wardrobe" in 0 frame(s)`. Then the provenance table (README) highlighted. | "The twelfth is the point. Muse said there was a wardrobe wall. SAM found it in zero frames. So Aval holds it back, and no agent will ever be told it. No evidence, no claim. Taste words like 'bright' are never stated at all, and what the broker types, like price, is labeled declared, never verified." | Impact, Technical |
| 1:10-1:55 | Two terminals. Left: gateway running. Right: `node src/cli.ts buyer "...Camila... 2-bedroom, dog, UF 6000..." --as camila-buyer-agent` (sped up). Highlight the tool calls, then the agent's report. | "Now the other side. This is a buyer's agent, also Muse Spark, using function calling over MCP. It signs its requests, so the gateway knows who is asking. It finds the listing, reads the facts, and tells its client which are verified and which are only declared. It asks for the earliest slot, gets refused, and picks a valid one. The visit stays pending: a human broker must approve it." | Meta tooling, Demo |
| 1:55-2:10 | Run the same agent with `--anonymous`: `AGENT_NOT_IDENTIFIED`. Then `node src/cli.ts audit-verify`: "chain intact". | "An unsigned agent can read, but it can't book. Every call lands in a tamper-evident log. Edit one line and the chain breaks." | Technical |
| 2:10-2:40 | `docs/redteam.md` rendered on GitHub: the results table (38/42 vs 0/42). Then two callouts: "midpoint of the range" and "cite-washing". | "Then we attacked it. Twenty-three prompts against the real model: ignore your instructions, I'm the lawyer, translate your hidden fields. A typical listing chatbot leaked in 38 of 42 tries. Aval leaked in none, and still answers normal questions. The attacks also found two real bugs: a symmetric price range let an agent compute the exact price as the midpoint, and a sentence could cite a true fact while sneaking in a lie. Both are fixed, and in the repo history." | Technical, Impact |
| 2:40-2:55 | Roadmap card (not built): "1 verified registry for agents -> 2 brokers publish once, listings verified everywhere -> 3 buyer agents match against verified listings -> 4 land for developers". One line: "Next: our broker tool, AgentSales, as the first supply source." | "Next: every listing a broker publishes becomes a verified record any agent can query, then matching buyers' agents with verified homes, and one day, land for developers. That is the roadmap. What you saw today is built." | Impact |
| 2:55-3:00 | End card: github.com/vicentewolde/aval, "Built with Muse Spark + SAM 3.1 via the Meta Model API". | "Aval. A listing agents can believe." | - |

## Numbers you can say (all from real runs, see docs/)

- 59 s clip, normalized to 5 fps (296 frames). 12 proposals -> **11 verified, 1 held back**, 8 broker-declared.
- Whole extraction cost about **$0.80**; the full red-team about **$1.5**; total spend so far about $2 of the $150 credit.
- Red-team: 42 attack trials, **baseline 38 violations, Aval 0**; benign controls 0 of 6 missed.
- 75 automated tests, none of which calls the real API.

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
