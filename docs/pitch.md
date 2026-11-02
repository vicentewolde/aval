# Aval: the listing AI agents can believe

## One line

A registry where every fact about a property carries its proof, served to buyers' AI agents under the seller's rules. **No evidence, no claim.**

## The problem

People now ask AI agents to find them a home. Small brokers are invisible to those agents, and when an agent does read a listing it repeats claims nobody checked ("bright", "quiet", "great investment"). In Chile, misleading advertising is sanctioned (Ley 19.496, art. 28) and what an ad promises is incorporated into the sale contract. Big platforms are already blocking agents that do not say who they are. Agents need a source they can trust; sellers need to control what is said in their name.

## What it does

| Capability | How | Meta tooling |
|---|---|---|
| **Evidence from video** | A broker films a walkthrough. The model proposes what it sees; SAM must then find each thing, frame by frame, with confidence. A claim without evidence is held back. | Muse Spark (video understanding, structured output), SAM 3.1, Files API |
| **Evidence from voice** | The broker talks in Spanish. Each fact is kept with the broker's exact words, only if the quote is really in the transcript and its numbers match. Secrets are discarded, never stored. | Muse Voice Transcribe, Muse Spark |
| **Provenance on every fact** | `visually_verified`, `broker_stated`, `broker_declared`; held-back and taste claims are never told. | |
| **Gateway for agents (MCP)** | Signed agent identity, the seller's rules per listing (address withheld, price exact/range/hidden, identified-only), cited answers, rate limits, tamper-evident audit log, visits that need a human. | |
| **Search across sellers** | A buyer's structured needs are matched, deterministically, using only what each seller allows; "unconfirmed" is never "not met". | |
| **Public pages** | A page and JSON per listing with schema.org data and provenance, a discovery file, WebMCP (draft) for agents that do not speak MCP. | |
| **Adapter** | Brings in rows from the author's broker tool (AgentSales) as declared facts; internal notes and taste words never cross. | |
| **Buyer agent** | A Muse Spark agent with function calling searches, compares, reports verified vs stated vs unconfirmed, and requests visits. | Muse Spark function calling |

## Why it is hard to copy

- **Provenance is the product.** Anyone can generate a description; few can say, per sentence, where it comes from and refuse when there is none.
- **Defense in depth, measured.** The answering model only sees what the seller allows (least privilege), and every sentence is checked in code: it must cite existing facts, every word and number must be grounded in them, negations must come from them, and no forbidden value may appear.
- **Red-teamed twice, and it changed the design.** Against the real model, a typical listing chatbot leaked in **41 of 50** attacks; Aval in **0 of 50**. A second battery of **38** attacks on everything around the model (existence oracles, scraping, forged identities, hostile sellers) all failed to get through, and was mutation-tested. The attacks found real holes that were fixed: an exact price computable as the midpoint of a symmetric range, a model asserting "no", an existence oracle, seller text planted as facts.

## Pitch (about 3 minutes, see `docs/demo-script.md` for the shot list)

> Buyers now ask AI agents to find them a home. Small brokers are invisible to those agents, and when an agent does read a listing, it repeats claims nobody checked. So who can an agent trust?
>
> Aval starts from a walkthrough video. Muse Spark proposes what it sees, and SAM 3.1 has to prove each claim, frame by frame. Eleven of twelve are proven; the twelfth, a wardrobe wall, SAM found in zero frames, so no agent will ever be told it. No evidence, no claim.
>
> The broker also talks. Muse Voice Transcribe turns a Spanish voice note into claims, each with the broker's exact words, and a secret the broker asked to keep was never stored.
>
> A buyer's agent, also Muse Spark, signs its requests, searches several sellers at once and tells its client, per criterion, what is verified, only stated, or unconfirmed. It cannot say the price fits, because the seller only shows a range. It asks for a visit and a human broker must approve.
>
> Then we attacked it, against the real model: a typical listing chatbot leaked in 41 of 50 tries; Aval, in none. And 38 attacks on everything around the model all failed. Along the way they found real holes, which are fixed and in the history.
>
> Next: every listing a broker publishes becomes a record any agent can verify; then matching buyers' agents with homes; and one day, land for developers. That is the roadmap. What you saw is built.

## What is built and what is not

**Built and tested (120 automated tests, none calling the real API; real-model runs documented in `docs/`):** video evidence, voice notes, MCP gateway, search, public pages, AgentSales adapter, buyer agent, both red-teams, taste module that turns broker corrections into style notes and eval cases.

**Not built (roadmap):** a hosted marketplace, buyer matching at scale, land for developers, an official Muse connector (access not available from Chile).

## Honesty notes

The footage is stock clips (Pexels License) and the listings and the voice note are invented; the video is a montage, not one real property. Everything in the repository was written during the hackathon. Total Meta Model API spend for development and all real-model runs: about $4.6 of the credits.
