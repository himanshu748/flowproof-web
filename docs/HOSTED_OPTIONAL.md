# Hosted evidence review, search, sample speech and memory

**Storage update, October 16 at 16:32 UTC:** [pgvector and independent score proof](evidence/tiger-pgvector/2026-10-16T16-16-50Z/) supersedes the array-storage limitation for the current deployment. Earlier dated agent receipts below retain their original array implementation and model usage; the new query proof makes no fresh model/search request. Three fixed MiniLM queries, exact ranking and the existing expiry/budget limits remain.


## Public judge walkthrough

**Earlier verification under the original 12-run cap:** [four retained public attempts](evidence/judge-agent/2026-10-16T13-07-24Z/receipt.json) leave **eight of twelve shared slots** at 13:42 UTC. One tokenless HTTP run completed both tools and model turns. The latest in-app browser attempt returned Google HTTP 500 `INTERNAL` before tool selection; the earlier browser search timeout remains unknown upstream. No successful complete agent screen was observed in the in-app browser. Provider reliability remains unresolved. [Earlier source and green CI](evidence/judge-agent/2026-10-16T13-07-24Z/search-wait-deployment.json) · [390px recovery QA](evidence/judge-agent/2026-10-16T13-07-24Z/ui-qa.json).


**Public judge flow verified:** [open the evidence agent](https://flowproof-demo.onrender.com/#agent), approve the fixed checks, run Chromium, then consent to Gemma selecting Tiger history and SerpApi search. [Actual public-route receipts](evidence/judge-agent/2026-10-16T13-07-24Z/) retain both a complete tokenless run and the earlier upstream model failure; the four old operator allowances remain spent.

The [new `#agent` path](https://flowproof-demo.onrender.com/#agent) is designed for a judge to prepare the fixed sample, review and approve template checks, run Chromium, inspect saved Tiger evidence, then explicitly consent to native Gemma's bounded tool loop. It requires the owning visitor session and exact hosted HTTPS origin, without an operator token. [Step-by-step guide](JUDGE_GUIDE.md#optional-public-evidence-agent).

The same durable grant, expanded through a separate append-only seal without resetting spent slots, permits **100 runs total, six/hour, one/session**, at most **two model calls and one search per run**, ending **October 20 at 00:00 UTC**. The shared 12-model-request hourly limit also covers proposals. A reserved run stays spent on failure; saved results can be reloaded without repeating providers. All four earlier operator-agent tranches and the standalone search/speech/memory reservations below remain consumed. The [new public receipts](evidence/judge-agent/2026-10-16T13-07-24Z/) are separate from those older operator routes, which remain protected. [Grant and funding boundaries](PROVIDER_ALLOWANCES.md#separate-public-judge-grant-verified-public-route).

## Native Gemma evidence-agent loop: verified at 12:15 UTC

The [October 16 hosted receipt](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/receipt.json) verifies a complete operator-only loop on the existing **Free Render** service, source `f990d9a14ae95dc322e4d81a411e9dd764ff9207`. Google-hosted `gemma-4-26b-a4b-it` selected the history and search tools, received their actual results, and cited both in its second response. [Actual model and tool output](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/agent-run.json) · [CI: 871 application tests, 19 Python tests, build and real Chromium audits](https://github.com/himanshu748/flowproof-web/actions/runs/38898518897).

| Step | Actual observation |
| --- | --- |
| Model selects tools | Native HTTP 200; selected `failure_history` with `mobile_paraphrase`, plus `search_visibility`. Reported usage: **517 input / 38 output tokens**. |
| Tiger history tool | Three saved failure rows returned. Mobile overflow ranked first, cosine **0.3781263417931506**, lexical score **0** and lexical rank **null**. The separate keyword control `horizontal` returned one match; the paraphrase-only lexical control returned none. |
| SerpApi search tool | One actual provider request returned **HTTP 200 in 379 ms** with zero matching results for `site:flowproof-demo.onrender.com`. Tool duration was 397 ms. This does not prove de-indexing, rankings, acceptance or an uncached search. |
| Model cites observations | Native HTTP 200; cited returned historical failures and the zero-result search snapshot. Reported usage: **1,242 input / 735 output tokens**. |

Both model calls succeeded on their first attempt: **1,759 input / 773 output / 2,532 total tokens**, with no retries. Complete outer JSON fences and empty thought parts were normalized before strict validation, as recorded in each transport receipt. This is a native Google JSON tool loop. Mastra's separately evidenced role remains proposal generation and validation; this run does not establish a Mastra Agent integration.

The history path executes real Tiger SQL over **precomputed 384-dimensional MiniLM vectors in PostgreSQL arrays**, combined with lexical ranks by reciprocal rank fusion. It permits three fixed query vectors and exact-text catalog matches. It uses neither pgvector nor arbitrary hosted embedding inference. These three rows demonstrate the fixed query path, not a general retrieval-quality benchmark. They belong to the same saved source audit; no earlier cross-project or historical-timeline breadth is implied.

The source browser audit remained **2 passed / 3 failed / 0 blocked / 1 unverified**, with exact before/after equality. Duplicate execution returned **409**; tokenless and cross-visitor requests returned **404**; missing consent returned **400**. Approval came from the automated synthetic verifier, not a customer. Tool/model findings remain separate from browser outcomes and cannot mark a requirement passed.

Earlier attempts remain visible: [invalid JSON after HTTP 200](evidence/hosted-evidence-agent/2026-10-16T11-30-58Z/receipt.json), [HTTP 500 `INTERNAL`](evidence/hosted-evidence-agent/2026-10-16T11-44-46Z/receipt.json), and [real Tiger citations with a timed-out search](evidence/hosted-evidence-agent/2026-10-16T11-59-52Z/receipt.json). The timeout has no retained transport completion receipt, so its upstream result remains unknown. None of these reservations was refunded.

All four agent tranches are now consumed: **12 model requests and four agent searches reserved**, versus **six observed model requests**, including the HTTP 500 with unreported usage. The final search has a successful transport receipt; the earlier timed-out search remains unresolved. The standalone search below is an additional, separately spent allowance. [Verified spent configuration](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/spent-reservations.json) · [Funding and expiry details](PROVIDER_ALLOWANCES.md).

## Earlier standalone optional proof: 09:13 UTC

**Verified October 16, 2026 on the existing Free Render service**, source `64a62729018fc2372611c7b21bfffecf3b779556`. [Exact hosted receipt](evidence/hosted-optional/2026-10-16T09-13-12Z/receipt.json) · [CI: 571 application tests, 19 Python tests, build and real browser audits](https://github.com/himanshu748/flowproof-web/actions/runs/38878045224).

These are operator-protected application integrations. Public visitors cannot spend these allowances. Each operation also requires the operator's own visitor session and project/audit. This proof made zero model calls; its sample checks are explicitly labelled templates, separate from the [fresh live-homepage Gemma flow](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json).

| Integration | Actual hosted operation | Retained observation |
| --- | --- | --- |
| SerpApi | One `site:flowproof-demo.onrender.com` search for the fixed, owner-authorized homepage | [Zero matching results](evidence/hosted-optional/2026-10-16T09-13-12Z/serpapi-search.json). An empty search snapshot is not proof of de-indexing and does not change an audit outcome. |
| ElevenLabs | One counts-only synthetic narration; fixed stock voice `JBFqnCBsd6RMkjVDRZzb`, adapter model `eleven_multilingual_v2` | [Actual MP3](evidence/hosted-optional/2026-10-16T09-13-12Z/elevenlabs-synthetic-report.mp3), 92,386 bytes, independently decoded as 22.987755 seconds of 22,050 Hz mono MP3. [Decoder sidecar](evidence/hosted-optional/2026-10-16T09-13-12Z/elevenlabs-decoding-verification.json). Audible wording/listening remains unverified because this session cannot receive audio. |
| Backboard | One write, then one search after a single indexing delay; existing dedicated assistant, no inference | [Search](evidence/hosted-optional/2026-10-16T09-13-12Z/backboard-search.json) retrieved all six matching assertion facts from the [completed browser audit](evidence/hosted-optional/2026-10-16T09-13-12Z/synthetic-audit.json). |
| Tiger Data | Save the same completed sample audit and read it back | Exact JSON equality and the Tiger storage header were verified. Screenshots are separate downloaded artifacts; Tiger retains references. |

The actual broken sample recorded **2 passed, 3 failed, 0 blocked and 1 unverified**. Execution returned 409 before explicit verifier approval. Anonymous and cross-visitor provider requests returned 404; substituted request fields returned 400 before provider I/O. The source audit remained deeply equal after the optional operations. No forms, purchases or destructive actions ran. [Portable HTML report](evidence/hosted-optional/2026-10-16T09-13-12Z/synthetic-report.html).

## Audio and attribution

**Voice generated with ElevenLabs. Noncommercial synthetic demonstration only.** The transmitted [347-character text](evidence/hosted-optional/2026-10-16T09-13-12Z/elevenlabs-narration.txt) reads the actual audit counts and fixed limitations. No names, client requirements, URL, DOM or screenshots were transmitted. Model/voice attribution comes from the fixed request configuration, not independent response metadata. No cloned voice or commercial narration rights are claimed.

The reservation was 347 characters; the response's `character-cost` header reported 153. The immediate subscription counter was unchanged. These are distinct observations, not a reconciled invoice or a claim of zero consumption. Original runtime receipts retain `decodingVerified: false` and `listeningVerified: false`; the later decoder sidecar adds only what was independently checked.

## Funding and consumed reservations

[Fresh account observations](evidence/provider-refresh/2026-10-16/account-observations.json) preceded the scoped key transfer. [Post-run observations](evidence/provider-refresh/2026-10-16/post-account-observations.json) found SerpApi at 216 remaining searches, Backboard free credit $4.98 → $4.97 with paid credit unchanged, auto-reload off and no payment method, and ElevenLabs still at a $0 next invoice with overage flags disabled. Account-wide differences are not exclusive attribution, final invoices or universal deduction rules. Existing ElevenLabs sponsor-redemption provenance remains unknown.

The 09:13 UTC allowance permitted one search, one speech call of at most 1,000 characters, and one Backboard write/search pair capped at $0.03 of explicitly approved existing credit. All four operation reservations are consumed. Their counters were also written back to Render's configuration, so a later deployment cannot recreate the allowance from zero. [Spent-reservation readback](evidence/provider-refresh/2026-10-16/spent-reservations.json). Historical spent tranches remain retained; the later agent allowances above are separate.

Free Render's disk is ephemeral. Neither the local ledger nor a refreshed account timestamp is durable authority to replenish budgets. The preparation helper refuses repeat SerpApi/ElevenLabs setup when any existing hosted proof is present. Further operations require a separately reviewed allowance; scheduled rechecks authorize no new provider calls. [Allowance boundaries and scheduled checks](PROVIDER_ALLOWANCES.md).

## Reproduction

[`scripts/verify-hosted-optional.ts`](../scripts/verify-hosted-optional.ts) performs zero HTTP requests by default. Its explicit live mode requires a full independently verified deployment SHA and a private operator-token file. It exclusively creates an off-host reservation before any network request, performs auth/approval controls first, and never retries or refunds a failed provider operation. Do not rerun the spent October 16 state, delete its file, or reuse these proof budgets.

```sh
# Safe default: no credential reads or HTTP calls.
node --import tsx scripts/verify-hosted-optional.ts
```

The [October 16 allowance check](evidence/judge-agent/2026-10-16T14-14-32Z/funding.json) confirmed enough existing free search capacity for the owner-approved **100-total-run expansion**, with the same grant UUID, four spent judge slots and 96 remaining at that check. The base grant, all prior reservations, six/hour, one/session, per-run request limits and October 20 cutoff remain unchanged; no model or search request was made by that check. [Refreshed no-card Tiger trial boundary](evidence/judge-agent/2026-10-16T14-14-32Z/tiger-funding.json).

[Live expansion readback](evidence/judge-agent/2026-10-16T14-14-32Z/verification.json) confirmed **100 total / four spent / 96 remaining**, unchanged original grant and results, and HTTP 200 for `/#demo`. The [in-app browser copy check](evidence/judge-agent/2026-10-16T14-14-32Z/ui.json) observed the optional placement and a 390px layout without page overflow. These checks made no model or search calls and do not resolve the retained upstream provider failures.
