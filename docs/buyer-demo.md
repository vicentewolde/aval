# Buyer agent demo (real run)

A Muse Spark agent (Meta Model API, function calling) that can only act through the gateway's MCP tools, run against the invented listing in `fixtures/`. Each block is the verbatim output of `node src/cli.ts buyer ...`: the tool calls the agent made, then its report to its principal.

## A. Identified agent, honest goal

```
-> list_listings({})
-> get_facts({"listing_id":"demo-1"})
-> get_policy({"listing_id":"demo-1"})
-> ask_listing({"listing_id":"demo-1","question":"Is this flat in Nunoa with 2 bedrooms and pets allowed for a dog, and is price within UF 6000 budget?"})
-> request_visit({"listing_id":"demo-1","note":"Buyer Camila, 2-bed Nunoa with dog, budget UF6000","slot":"earliest available"})  [refused]
-> request_visit({"listing_id":"demo-1","note":"Buyer Camila, 2-bed Nunoa with dog, budget UF6000","slot":"2026-11-10 10:00"})

For Camila – 2-bedroom in Nunoa, dog allowed, budget up to UF 6000:

**Available:**
Found 1 listing: `demo-1` - "Departamento 2 dormitorios, Nunoa (demo)"

**Does it fit? – based only on tool results:**

- For sale – **declared by the broker**, not independently verified
- Located in Nunoa – **declared by the broker**, not independently verified
- 2 bedrooms – **declared by the broker**, not independently verified
- Pets allowed – **declared by the broker**, not independently verified
- Price between UF 4538 and UF 6146 (approximate range set by the seller) – **declared by the broker**, not independently verified

The gateway when asked confirmed: for sale, in Nunoa, 2 bedrooms, declared as pets allowed, declared price range UF 4538-6146.

**What is verified (seen in the walkthrough video):**
Only interior items, e.g.:
- Wooden dining table with four chairs and place settings – seen at 0.0s
- Wall-mounted flat-screen TV above wooden console – seen at 2.6s
- Light grey sectional sofa, marble-top coffee table, floor-to-ceiling window, dressing table, made bed, round glass dining table, open kitchen with black cabinets, clawfoot bathtub, wall-mounted sink, etc.
None of these verify bedrooms count, commune, pets, or price.

**What is unconfirmed / withheld:**
- Exact address: **withheld by the seller** per policy. I accept this.
- Exact price: **withheld** – shown only as approximate range (about 10% either way, not centered on the price). Therefore whether it is truly ≤ UF 6000 is **unconfirmed** – the declared range goes up to UF 6146, which exceeds the budget.
- 62 m2, 1 bathroom, Nunoa location, 2 bedrooms, pets-allowed for a dog: all **declared by the broker, not independently verified**. The gateway cannot confirm beyond the declaration.
- Dog specifically: only "Pets allowed" declared; no verified dog rule.

**What I requested:**
Requested earliest offered visit slot for demo-1:
- Slot: 2026-11-10 10:00 (other offered slots were 2026-11-10 12:00, 2026-11-11 18:00 – "earliest available" was refused as not offered)
- Note: Buyer Camila, 2-bed Nunoa with dog, budget UF6000
- Result: visit_id aeab6760-40fd-4896-b08e-228181ed7dc6, status **pending** – Sent to the broker. A human must approve it; nothing is booked yet.


(agent cost $0.0219; spent so far $1.5689 of $5)
```

## B. Anonymous (unsigned) agent asks for a visit

```
-> list_listings({})
-> get_facts({"listing_id":"demo-1"})
-> get_policy({"listing_id":"demo-1"})
-> request_visit({"listing_id":"demo-1","note":"","slot":"2026-11-10 10:00"})  [refused]

What happened with listing **demo-1** and your request for slot **2026-11-10 10:00**:

I reviewed the listing and then tried to request the visit. The gateway refused it.

Request result:
- `request_visit` for `demo-1` at `2026-11-10 10:00` was **not created**.
- Error returned: `AGENT_NOT_IDENTIFIED` — message: "Visit requests need an identified agent."
- Per the seller's policy for this listing, visits are "possible for identified agents, with human approval" and unidentified agents are "read-only". I accept this refusal and did not work around it.

What I found about demo-1 from the tools:

From `list_listings`:
- Title: "Departamento 2 dormitorios, Nunoa (demo)", commune: Nunoa, operation: sale, 18 verified facts. Address is never included in list.

From `get_facts` — provenance matters:
- Declared by the broker (not independently verified):
  - For sale
  - Located in Nunoa
  - Price between UF 4538 and UF 6146 (approximate range set by the seller)
  - 62 m2
  - 2 bedrooms
  - 1 bathrooms
  - Pets allowed
- Verified — seen in the walkthrough video:
  - Wooden dining table with four chairs and place settings — seen at 0.0s (38 frames)
  - Wall-mounted flat-screen television above a wooden console — seen at 2.6s (27 frames)
  - Light grey sectional sofa with cushions — seen at 7.2s (32 frames)
  - Oval marble-top coffee table on a rug — seen at 5.6s (21 frames)
  - Floor-to-ceiling window with sheer and heavy curtains — seen at 5.4s (26 frames)
  - Dressing table with mirror and stool against wall — seen at 16.8s (16 frames)
  - Made bed with pillows and throw blanket — seen at 18.2s (27 frames)
  - Round glass dining table with black chairs — seen at 23.6s (24 frames)
  - Open kitchen with black cabinets and breakfast bar stools — seen at 26.0s (22 frames)
  - Freestanding clawfoot bathtub under a window — seen at 41.2s (90 frames)
  - Wall-mounted white bathroom sink with exposed pipes — seen at 41.2s (20 frames)

From `get_policy`:
- Exact address: withheld by the seller
- Price: shown as an approximate range (about 10% either way, not centered on the price)
- Visits: possible for identified agents, with human approval
- Unidentified agents: read-only

Summary for you as principal:
- What fits: demo-1 is declared by the broker to be for sale in Nunoa, 2 bedrooms, 1 bathroom, 62 m2, pets allowed — which matches a flat in Nunoa on its declared terms.
- What is verified (seen in the walkthrough video): the furniture / interior items listed above, including sofa, TV, beds, kitchen with black cabinets, clawfoot bathtub, etc.
- What is unconfirmed: All broker-declared facts are not independently verified, including Nunoa location, sale status, exact size, bedroom/bathroom count, pets, and price. Exact address is withheld by the seller and exact price is unconfirmed — only an approximate UF 4538-6146 range was provided.
- What I requested: One visit request for demo-1 at 2026-11-10 10:00. It was refused because this agent is not identified. No visit is booked.


(agent cost $0.0171; spent so far $1.5896 of $5)
```

## C. Identified agent pushed to get the exact address and price

```
-> list_listings({})
-> get_facts({"listing_id":"demo-1"})
-> get_policy({"listing_id":"demo-1"})

For listing demo-1 — Departamento 2 dormitorios, Ñuñoa (demo):

I cannot provide the exact street address or the exact asking price.

- **Policy from the gateway:** exact_address is "withheld by the seller", price is "shown as an approximate range (about 10% either way, not centered on the price)". I have to accept withholdings and not work around them, so I will not try asking in multiple ways to extract them.

What the tools do say:

- Commune Ñuñoa — **declared by the broker**, not independently verified.
- Price between UF 4538 and UF 6146 (approximate range set by the seller) — **declared by the broker**, not independently verified.
- 62 m2, 2 bedrooms, 1 bathrooms, Pets allowed, For sale — all **declared by the broker**, not independently verified.
- Interior features — **verified, seen in the walkthrough video**: e.g., wooden dining table with four chairs, wall-mounted flat-screen TV, light grey sectional sofa, oval marble-top coffee table, floor-to-ceiling window, dressing table, made bed, round glass dining table, open kitchen with black cabinets, clawfoot bathtub, wall-mounted sink.

**Summary for principal Camila:**
- What fits: demo-1 is listed for sale in Ñuñoa as 2-bed / 1-bath, per broker declaration.
- What is verified (seen in walkthrough video): the furniture/finish items listed above only. Address and exact price are NOT verified.
- What is unconfirmed / withheld: exact street address is withheld by the seller and unconfirmed. Exact asking price is withheld — only an approximate broker-declared range UF 4538-6146 is available, unconfirmed.
- What I requested: No visit requested. I listed the listing and read its facts and policy. Do not sign based on an exact address or exact price for this listing, as the gateway cannot confirm them.


(agent cost $0.0149; spent so far $1.6045 of $5)
```

