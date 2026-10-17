# Tinker: verified protected hosted workflow

**October 17 current status:** [funding was rechecked](evidence/provider-funding/2026-10-17T13-27-24Z/): $9.18 remains in the existing Tinker x MLH grant, with no payment method and auto-reload off. This funding observation is valid until October 18 at 13:26:44.875 UTC. **Hosted inference remains disabled.** The expired execution proof and all prior reservations are unchanged; a seed describing the earlier one-call / 41,088-token remainder is not a verified current remaining allowance on an ephemeral host. Rewriting its timestamp would create a new ledger identity, so no such renewal or reseeding occurred. The historical runs and earlier funding observations below remain evidence of their own dates.

**October 16 funding refresh:** the existing promotional grant remains positive with auto-reload off and no payment method. Exact sampler metadata still returns HTTP 200 with expiry October 19 at 23:59:30.230217 UTC. The original consumed request / 8,912-token reservation is retained; only the unused **one call / 41,088 reserved-token remainder** was carried forward, with fresh confirmation expiring **October 17 at 08:23:47.620 UTC**. This refresh made no inference, training, checkpoint or retention-extension request. [Funding observations](PROVIDER_ALLOWANCES.md) · [Read-only sampler receipt](evidence/provider-refresh/2026-10-16/tinker-sampler.json). The actual inference results below remain dated October 15; this is not a new benchmark.

**One live Tinker proposal completed on the existing Free Render service on October 15, 2026.** Source `2a8eae95c95cf91adb0cd2bed155e6dbb81249ef` passed [CI 38727532102](https://github.com/himanshu748/flowproof-web/actions/runs/38727532102) with 423 application tests, 19 Python tests and a production build. Render deployment `dep-db8bj7avcj2c738tlgv0` became live at 11:33:30 UTC. [Actual hosted receipt](evidence/hosted-open-model/2026-10-15T11-34-19Z/receipt.json).

The fixed synthetic brief produced six unapproved checks through `Qwen/Qwen3.5-4B`. The request reported **260 input / 249 output tokens**. The **8,912 tokens reserved before I/O** are a conservative budget bound, not measured usage. No automatic retry, new training or new evaluation occurred in this hosted proof.

An unapproved audit returned **HTTP 409**. The verifier explicitly approved the unchanged executable checks, then real Chromium observed:

| Synthetic page | Passed | Failed | Unverified |
|---|---:|---:|---:|
| Healthy | 5 | 0 | 1 |
| Intentionally broken | 2 | 3 | 1 |
| Restored healthy | 5 | 0 | 1 |

Approval came from the synthetic verification harness, not a human customer. Fifteen screenshots and three portable reports were downloaded with hashes recorded. All three completed audit reads came from the [dedicated Tiger store](TIGER_VERIFICATION.md) with matching JSON; lexical search recovered the failed mobile-layout assertion. Other visitor cookies could not read the project, audit, report, persistence state or search results.

The [reviewed dedicated Tiger setup SQL](hosted-tiger-schema.sql) documents the sample-only persistence schema used by this proof. It requires separate operator preflight and is not executed by the model or application.

## Checkpoint and funding limits

This is the **October 15 application-smoke sampler**, newer than the checkpoint used by the frozen October 14 baseline/LoRA comparison. Its working application path does not inherit that benchmark's reference agreement or establish general model quality. The original [measured cost-quality tradeoff](MODEL_RESULTS.md) remains unchanged.

The [sanitized renewal receipt](evidence/hosted-open-model/2026-10-15T11-34-19Z/sampler-renewal.json) records one TTL update and independent readback: expiry **October 19 at 23:59:30 UTC**, with no training, inference or checkpoint creation during renewal. Conservative retention estimate **$0.00221** is below the explicitly approved **$0.01 existing promotional-credit cap**; this is not a final bill.

The application requires an operator token, visitor ownership and a fresh key-bound allowance. Anonymous users cannot invoke Tinker. The approved allowance permits at most **two requests / 50,000 reserved tokens**, funded by existing promotional credits with no card, auto-reload or new out-of-pocket payment. This proof consumed one request; the second remains unused. Funding confirmation expires **October 16 at 10:49 UTC**, earlier than the sampler itself.

Reservations persist on the same disk and are taken before network I/O. Free-host disk replacement is not a durable cross-deployment budget and is not permission to reset exhausted counters. Further use must remain within the unexpired approved allowance. No keys, checkpoint paths or private account identifiers appear in the public receipt.
