# Title review: reading the sale documents without trusting the reader

A sale in Chile starts with four certificates: *certificado de dominio vigente* and *certificado de hipotecas
y gravamenes* (Conservador de Bienes Raices), *deuda de contribuciones* (Tesoreria) and *gastos comunes*
(the building's administration). A broker normally reads them by hand. `diligence check` reads them with
Muse Spark and keeps the rule that runs through all of Aval: **no evidence, no claim**.

```
PDF --pdftotext--> text of every page            (the independent witness; the model never touches it)
PDF --Muse Spark--> fields {key, value, quote, page}
                    kept only if value AND quote are really on that page of the PDF text
                    and the document's own title says the type the model claimed
fields --rules (code, no model)--> findings, each with its evidence (document, page, quote)
```

What the rules check: the owner and RUT on the title against the seller (private `seller.json`, never
served); the property against the listing's commune and street; the *rol de avaluo* across documents;
encumbrances (a mortgage is a warning; a prohibition, embargo or court order is a blocker); outstanding
debts; whether each certificate is fresh (over 30 days is flagged, a heuristic to confirm with the notary);
and missing documents. The status is `blocked`, `needs_attention`, `clear` or `incomplete`: a missing or
unreadable document is never read as clean.

An agent calling `get_title_review` gets the status, the number of documents and the *names* of the rules
that fired. Never names, RUTs, quotes or amounts: those stay with the seller. A listing with no documents
returns `not_reviewed`, which is not `clear`. The review is hashed (sha256 of its canonical JSON); a review
edited on disk is ignored, and the hash is bound into the passport and the term sheet.

## Real-model results (Muse Spark 1.3 reading the invented sample PDFs, ~$0.03 per set)

| Set | What it contains | Result |
|---|---|---|
| `fixtures/documents/ok` | owner = seller, no encumbrances, no debts, 4 days old | `clear` |
| `fixtures/documents/attention` | mortgage with a bank, property tax debt $148.320, common expenses $86.500 | `needs_attention` (mortgage + 2 debts, each with its quote) |
| `fixtures/documents/blocked` | another owner, a court prohibition to sell, a mortgage, 89 days old | `blocked` (owner is not the seller, encumbrance blocks the sale, stale certificates) |

The saved reviews are in `docs/examples/`. Every PDF is invented, marked "DOCUMENTO DE EJEMPLO - SIN VALOR
LEGAL" and built by `scripts/make-diligence-docs.sh`.

## What stops a fooled model

A test (`test/diligence.test.ts`) feeds the *blocked* PDFs to a reader that lies: it reports a clean
encumbrance certificate and the seller as owner. The claimed quotes are not on those pages, so the fields are
dropped, the status cannot be `clear` and no "owner matches" or "no encumbrances" finding exists.

## Honest limits

- Not legal advice, and it says so in every review. A lawyer and a notary do the real title study.
- It verifies that the reader read the PDF correctly, not that the PDF is authentic: a forged certificate
  with a consistent text layer passes. Checking the CBR's electronic verification code is the next step.
- A scanned PDF with no text layer cannot be verified this way: every field comes back unverified and the
  status is `incomplete`. OCR as a second witness is roadmap.
- Only the four certificates above, in Spanish, with the sample layouts. Real ones vary.
