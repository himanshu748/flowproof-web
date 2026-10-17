# A hosted Gemma answer from Backboard memory

On **October 17, 2026 at 04:42:47 UTC**, Briefstamp's protected hosted route retrieved the existing six-fact synthetic audit record from Backboard and used it in one real Gemma answer. The model selected three failed assertions and cited all six facts as the boundary of its answer. Every assertion and citation passed validation. [Dated receipt](evidence/backboard/2026-10-17T04-42-47Z/receipt.json) · [Actual answer, facts and attempts](evidence/backboard/2026-10-17T04-42-47Z/memory-answer.json).

The question was **“What failed on mobile and was it fixed?”** The validated answer identifies the saved horizontal-overflow failure, also cites the failed heading and image alternative-text checks, and says a repair is **not proven by these six retrieved facts**. It does not say no repair exists elsewhere. No restored-audit record was supplied to this turn.

## What actually ran

| Observation | Retained result |
|---|---|
| Hosted source | `92112b3f5ee580f1729146070878cf9bbc4f9b19`, existing Free Render service |
| Backboard memory search | HTTP 200, 1,893 ms; three records returned, one matching the pinned historical source |
| Retrieved evidence | One existing October 16 record containing six facts: three failed, two passed, one unverified |
| Model | Backboard → OpenRouter → `google/gemma-4-26b-a4b-it` |
| Model response | HTTP 200, `COMPLETED`, 3,441 ms; **2,127 input / 627 output / 2,754 total tokens** |
| Validated citations | Three exact assertion claims; all six unique supporting fact IDs |
| Dedicated reservation | One durable Tiger tranche; two units consumed, no retry or refund |
| Browser audit used to reserve the proof | Two passed, three failed, zero blocked, one unverified; unchanged after the answer and Tiger round trip |
| Public judge allowance | Four spent before and after; zero slots consumed by this proof |
| Earlier reservations | All 90 retained private records and every older Render environment value unchanged |

The answer source is the separately identified **October 16 historical memory**, not the October 17 visitor-owned audit used for the durable reservation. [Returned facts](evidence/backboard/2026-10-17T04-42-47Z/retrieved-facts.json) · [Reservation audit](evidence/backboard/2026-10-17T04-42-47Z/reservation-audit.json).

## Citation and approval boundary

The server sends only the actual returned, schema-checked six facts to Gemma. It requires the pinned project/audit hashes and ordered fact hash; missing, altered, ambiguous or foreign records cannot become model context. There is no local-fact fallback. The real returned Backboard memory ID is retained separately from application citation IDs derived from the returned content hash and fact index.

Gemma returns typed JSON assertions, not unrestricted prose. The validator checks each ID, kind and status, the failed overflow assertion, all six supporting IDs and the bounded `not_proven_by_retrieved_facts` resolution. A deterministic renderer presents those validated assertions. The displayed prose is **not verbatim model prose**. A separate Python check independently recomputed all six app IDs, matched every claim and compared the facts with the retained October 16 source. [Server check](evidence/backboard/2026-10-17T04-42-47Z/citation-check.json) · [Independent check](evidence/backboard/2026-10-17T04-42-47Z/independent-citation-check.json).

Operator authentication precedes body parsing. Explicit consent, a completed visitor-owned audit and exact Tiger readback precede reservation. A globally unique Tiger tranche plus append-only operation reservations prevent replay across restarts or disk replacement. Anonymous calls returned 404, missing consent 400 and a repeated proof 409. This answer cannot approve checks or change browser results.

## Funding and limits

The owner separately approved one memory search and one model message, reserving **$0.10 of existing mixed Backboard credit**. This did not reuse Task 1's spent grant. The immediate account observation changed free credit **$4.97 → $4.96** and paid credit **$4.997888 → $4.997553**. Those account-wide differences are not exclusive attribution or a final invoice. Auto-reload stayed off, no payment method was configured, and no purchase, new assistant, service or credential transfer occurred. [Funding](evidence/backboard/2026-10-17T04-42-47Z/funding.json) · [Post-account observation](evidence/backboard/2026-10-17T04-42-47Z/account-observation.json) · [Spent configuration](evidence/backboard/2026-10-17T04-42-47Z/spent-configuration.json).

The API has no confirmed per-request dollar/output-token cap; byte/time limits do not establish one. The new grant is spent without refund. Its funding confirmation expires October 18 at 04:26:22.861 UTC, within the unchanged October 20 cutoff. Further calls need a separately approved grant. Implicit memory, tools and web search were off during the model message; retrieval was the explicit preceding search. This proves one fixed historical question, not a general project chatbot, general retrieval quality or current website acceptance.

[Source CI](https://github.com/himanshu748/flowproof-web/actions/runs/39003204540) passed **1,346 app tests, 19 Python tests, build, browser acceptance, real Chromium audits and the free-runtime check**. [Implementation](../server/providers/backboard-memory-answer.ts) · [Allowance guard](../server/backboard-answer-gate.ts) · [Safe-default verifier](../scripts/verify-hosted-backboard-answer.ts) · [Artifact hashes](evidence/backboard/2026-10-17T04-42-47Z/manifest.json).
