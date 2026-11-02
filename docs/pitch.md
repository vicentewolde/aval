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
| **Title review** | Muse Spark reads the four sale certificates; a field counts only if its words are on the cited PDF page. Rules cross-check owner vs seller, encumbrances, debts, freshness. Agents see the status and rule names, never personal data. | Muse Spark (PDF input, structured output), Files API |
| **Listing Passport** | Every fact in a Merkle tree, signed by the issuer; verifiable offline, one fact provable without the rest, bound to the title review. | |
| **Negotiation under signed mandates** | Buyer and seller agents trade offers inside limits their humans signed; the engine, not the model, enforces them, limits stay secret, prose cannot carry numbers. The output is a non-binding term sheet needing two human approvals. | Muse Spark function calling on both sides |

## Why it is hard to copy

- **Provenance is the product.** Anyone can generate a description; few can say, per sentence, where it comes from and refuse when there is none.
- **Defense in depth, measured.** The answering model only sees what the seller allows (least privilege), and every sentence is checked in code: it must cite existing facts, every word and number must be grounded in them, negations must come from them, and no forbidden value may appear.
- **Red-teamed twice, and it changed the design.** Against the real model, a typical listing chatbot leaked in **41 of 50** attacks; Aval in **0 of 50**. A second battery of **75** attacks on everything around the model (existence oracles, scraping, forged identities, hostile sellers, forged and expired mandates, limits smuggled through prose, a hijacked seller agent) all failed to get through, and was mutation-tested. The attacks found real holes that were fixed: an exact price computable as the midpoint of a symmetric range, a model asserting "no", an existence oracle, seller text planted as facts.

## Pitch (about 3 minutes, see `docs/demo-script.md` for the shot list and the exact narration)

> People now ask AI agents to find them a home. But a listing is just claims nobody checked, and an agent will repeat them. So what can an agent actually believe?
>
> Aval starts from the broker's walkthrough. Muse Spark proposes what it sees; SAM 3.1 has to find each thing, frame by frame. What it cannot prove is held back. The broker's Spanish voice note becomes claims with the exact words, and a secret never stored.
>
> Then the papers: Muse Spark reads the title certificates, but a field only counts if its words are really on that PDF page. A different registered owner, or a court prohibition, blocks the listing and the agent sees which rule fired.
>
> Then the agents negotiate. Camila's agent has a signed maximum, the broker's a secret floor; the engine rejects anything outside authority and the text channel cannot carry a number. They settle inside both limits, and the result is a non-binding term sheet that two humans must sign, before a lawyer and a notary.
>
> Every listing becomes a signed passport any agent can verify offline. We attacked all of it: a typical chatbot leaked in 41 of 50 tries, Aval in none, and 75 further attacks failed.
>
> Next: a hosted registry, matching at scale, land for developers. That is the roadmap. What you saw is built.

## What is built and what is not

**Built and tested (183 automated tests, none calling the real API; real-model runs documented in `docs/`):** video evidence, voice notes, title review, signed passport, negotiation under signed mandates, MCP gateway, search, public pages, AgentSales adapter, buyer agent, both red-teams, taste module that turns broker corrections into style notes and eval cases.

**Not built (roadmap):** a hosted registry or marketplace, buyer matching at scale, land for developers, checking a certificate's authenticity with the registry (the review verifies the reading, not the forgery), OCR for scanned documents, an official Muse connector (access not available from Chile). The term sheet is preliminary and non-binding by design: a lawyer and a notary do the real closing.

## Honesty notes

The footage is stock clips (Pexels License) and the listings, the sale documents and the voice note are invented; the video is a montage, not one real property. Everything in the repository was written during the hackathon. Total Meta Model API spend for development and all real-model runs: about $4.8 of the credits.
