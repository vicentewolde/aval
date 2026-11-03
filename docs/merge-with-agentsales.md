# From this repository to one real-estate product

Aval (this repository) was built during the hackathon, from scratch, to prove one thing: **every claim about
a property carries its proof**. The author also runs a separate, earlier broker tool, AgentSales, that does
the operational side: loading listings, preparing copy and media, approving, scheduling, publishing to the
portals and social networks, and tracking. The plan is to merge them into a single product after the
hackathon. This document is that plan. Nothing here is built yet, except the two file bridges in section 7.

## 1. Why they fit

Each one is missing what the other has.

| Operations (AgentSales) | Trust (Aval) | The product they make together |
|---|---|---|
| Writes copy for each channel with an AI and an automatic review | Facts with evidence: video, voice, documents | Copy that can only say what is proven, each sentence tied to its proof |
| Publishes to the portals and social networks, after a human approves | A registry that buyers' AI agents can query and trust | One more channel next to the others: "publish to the agent registry" |
| Has no lead capture yet (planned) | A showroom, consented contacts with a *fit* against the buyer's search, saved searches | Own lead capture before any paid advertising |
| Human approval and a calendar | Visits that need approval, a term sheet that needs two signatures | One approval flow from first contact to a signed proposal |
| Several brokers in one installation | Signed mandates, a signed passport per listing | Each broker or office with its own identity and disclosure policy |

## 2. Rules of the merge

1. **The submitted commit is frozen.** It is tagged `hackathon-submission` and never rewritten. The merge
   happens afterwards, and only after the judging is over.
2. **No code crosses before the merge.** This repository contains no AgentSales code and AgentSales has no
   Aval code. The only link today is a file format (section 7).
3. **The merge happens in the AgentSales repository,** through its own process: a spec first, then an ADR
   for each structural decision, small branches, tests with the code. Aval modules are ported in, not
   copied wholesale.
4. **Aval is not rewritten to look like AgentSales.** Its core has no infrastructure dependencies on purpose;
   that is what makes it portable.

## 3. Entities

| In Aval today | In the unified product (to confirm against AgentSales' data model at merge time) |
|---|---|
| Listing (declared data, policy, claims) | The existing listing record, plus a claims table linked to it |
| Claim (statement, provenance, evidence) | New: `visually_verified`, `broker_stated`, `broker_declared`, `unverified`, `subjective`; evidence points to a media item and a frame or a quote |
| Policy (address, price visibility, visits, `publicMedia`) | A per-listing disclosure policy, editable in the panel |
| Video and voice note | The existing media items, with the processing steps added (Muse Spark, SAM, transcription) |
| Seller and buyer principals, mandates | Broker users and buyer profiles, with the signed mandates stored per negotiation |
| Lead, saved search and its matches | Lead capture: the leads table that the planned lead work needs, with the listing and the office as attribution |
| Visit request | A visit in the calendar, approved by the broker |
| Title review, passport, term sheet | Documents attached to the listing and to the negotiation, with their hashes |
| The gateway for agents | A publication target of kind "agent registry", next to the portals |

## 4. Modules

**Port almost as they are** (pure TypeScript, no I/O, tests move with them): claim schema and verification,
the disclosure policy, the deterministic search, the intent reader, the negotiation engine, the title-review
rules and PDF-page verification, the passport (Merkle and signatures), the sanitizer for seller text.

**Replace the infrastructure:**

| Aval today | Unified product |
|---|---|
| Plain files under `.aval/` | The database, with migrations |
| Local clip and evidence frames | Object storage with signed URLs; the showroom serves from there |
| `MetaClient` (one provider) | A model port with several providers: Meta models for video, segmentation and voice; the provider AgentSales already uses for copy |
| Own HTTP server and MCP | Mounted in the existing API |
| Hash-chained audit file | An append-only table, same hash chain |
| CLI commands | The same commands in the existing CLI, plus panel screens |

## 5. Phases

| Phase | Goal | Done when |
|---|---|---|
| M0 | Tag the submission; write the spec and ADRs in AgentSales | The spec is approved; this document is reconciled with the real data model |
| M1 | Port the pure core as new packages | The moved tests pass unchanged in the AgentSales workspace |
| M2 | Claims, leads and alerts in the database; stores replaced | A listing keeps its claims across restarts; the repository tests pass |
| M3 | Processing pipeline: video, voice and documents become claims | One listing goes from upload to verified facts in the panel |
| M4 | Copy only from verified claims; the agent registry as a publication target | A caption is produced with every sentence tied to a claim; publishing to the registry appears in tracking. A working prototype of the first half already exists here: `node src/cli.ts caption` (writer, sentence-by-sentence checker, list of what was refused) |
| M5 | Showroom, search and consented lead capture inside the product; negotiation behind a feature flag | A buyer's contact reaches the broker's calendar with its fit |

Every phase keeps the existing publishing in dry-run by default, as AgentSales already does.

## 6. Decisions still open

- **Which model for which job.** Meta for video understanding, segmentation and voice (the hackathon work);
  another provider may be better for long copy. The model port should make this a configuration, not a rewrite.
- **Personal data.** Leads and saved searches hold names and contacts. Chile's data-protection law
  (Ley 21.719) needs a lawyer's review before any real buyer data is stored; until then, demo data only.
- **Where the showroom lives:** inside the broker's panel domain or on the broker's own domain.
- **Legal reading of the term sheet.** It is non-binding by design; its wording needs a lawyer before real use.
- **Packaging and price:** not decided; the first goal is a pilot office, not revenue.

## 7. Bridges that already work (no merge needed)

Both use AgentSales' own column format, so AgentSales needs no change:

- **In:** `node src/cli.ts import-agentsales <export.json>` turns rows into declared listings; add a video to
  verify them. Internal notes and the broker's taste words never cross.
- **Out:** `node src/cli.ts export-agentsales <id…|--all> --format csv|json [--base <url>] [--plain]` writes a
  row per listing. `amenities` carries what the video verified, then the amenities the broker had already
  declared; nothing that was only said in a voice note, and never held-back or subjective claims. The
  optional `aval_*` columns (showroom link, verified-fact count, document-review status, the Spanish Instagram caption) need a
  configurable field in AgentSales; use `--plain` to leave them out. The file contains the real address:
  it is the broker's own data for the broker's own tool, so it stays out of any public place.

## 8. Not goals

Replacing AgentSales' publishing, calendar or approvals; building another CRM; a hosted marketplace before
there is a pilot office; any claim that the term sheet or the document review replaces a lawyer or a notary.
