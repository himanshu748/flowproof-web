# Hosted search, sample speech and memory

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

The new allowance permitted one search, one speech call of at most 1,000 characters, and one Backboard write/search pair capped at $0.03 of explicitly approved existing credit. All four operation reservations are consumed. Their counters were also written back to Render's configuration, so a later deployment cannot recreate the allowance from zero. [Spent-reservation readback](evidence/provider-refresh/2026-10-16/spent-reservations.json). Historical spent tranches remain retained.

Free Render's disk is ephemeral. Neither the local ledger nor a refreshed account timestamp is durable authority to replenish budgets. The preparation helper refuses repeat SerpApi/ElevenLabs setup when any existing hosted proof is present. Further operations require a separately reviewed allowance; scheduled rechecks authorize no new provider calls. [Allowance boundaries and scheduled checks](PROVIDER_ALLOWANCES.md).

## Reproduction

[`scripts/verify-hosted-optional.ts`](../scripts/verify-hosted-optional.ts) performs zero HTTP requests by default. Its explicit live mode requires a full independently verified deployment SHA and a private operator-token file. It exclusively creates an off-host reservation before any network request, performs auth/approval controls first, and never retries or refunds a failed provider operation. Do not rerun the spent October 16 state, delete its file, or reuse these proof budgets.

```sh
# Safe default: no credential reads or HTTP calls.
node --import tsx scripts/verify-hosted-optional.ts
```
