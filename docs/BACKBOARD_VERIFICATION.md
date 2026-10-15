# Backboard: real audit memory and retrieval

**Verified October 15, 2026:** the actual Briefstamp Backboard adapter stored an anonymous summary of a completed synthetic audit, then retrieved the same audit with its failed heading and all six observed statuses intact. [Sanitized live receipt](evidence/backboard/2026-10-15T09-28-55-074Z/receipt.json).

That earlier run was an operator-run cloud integration test. Its receipt alone does not establish deployment, client-data suitability, lifetime free eligibility or general retrieval quality. The saved memory is historical context, not a new audit or new proof that a website passes.

## Actual protected hosted proof

On October 15 at 10:04–10:05 UTC, Render release `25efaeefa582ebff29033e4d73e7fe53ece73119` called the same adapter through its protected HTTP routes. One write stored the completed synthetic broken audit; one search retrieved **all six matching facts: three failed, two passed and one unverified**. No inference was requested and no new assistant was created: it reused the dedicated Briefstamp proof assistant. [Hosted receipt](evidence/hosted-open-model/2026-10-15T10-04-04Z/receipt.json) · [write result](evidence/hosted-open-model/2026-10-15T10-04-04Z/backboard-write.json) · [retrieved memory](evidence/hosted-open-model/2026-10-15T10-04-04Z/backboard-search.json).

| Hosted proof credit bucket | Before | Immediately after | Observed deduction |
|---|---:|---:|---:|
| Free | $4.990000 | $4.980000 | $0.010000 |
| Paid | $4.998257 | $4.998257 | $0 |
| Subscription | $0 | $0 | $0 |
| Total | $9.988257 | $9.978257 | $0.010000 |

This immediate account-wide difference is separate from the earlier local proof's $0.01 deduction. It is not a final invoice, exclusive attribution or evidence of a general free-first spending rule. The user authorized existing credits, including the mixed paid bucket; the guard did not pretend the account was free-only. Auto-reload remained disabled, no payment method was configured, and no payment or account setting changed.

The hosted helper requires a constant-time-checked operator token of at least 32 characters and the caller's own visitor session/project/audit. Anonymous and cross-visitor access returned 404. **This is verified operator-only hosted memory, not an anonymous public memory service.**

The separate hosted allowance permitted at most one write and one search within a $0.03 existing-credit cap; both calls were reserved before I/O and **the two-operation allowance is now exhausted**. Its key-bound account proof was checked at October 15 09:29:06 UTC and expires October 16 09:29:06 UTC, within 24 hours. Initialization exclusive-creates the exact proof's ledger and never overwrites spent counters. Restarts on the same disk preserve reservations, but a Free Render disk replacement is ephemeral: this is not a durable cross-deployment budget. A restart or replacement must not be used to regain the spent allowance. Further use requires a fresh separately approved allowance, not resetting this proof.

[Hosted helper](../server/hosted-backboard.ts) and its focused tests cover authentication, proof validation and restart counter preservation. [Release CI](https://github.com/himanshu748/flowproof-web/actions/runs/38716831942) passed 320 application tests and 19 Python tests; contract tests are distinguished from the actual hosted receipt above.

## Earlier local operator proof: what executed

1. Read the existing account balance and verified auto-reload was disabled and no payment method was configured.
2. Reserved $0.01 locally before creating one new, dedicated Briefstamp synthetic-proof assistant. Its tools list was empty; no language-model generation was requested.
3. Called [`rememberAudit`](../server/providers/backboard.ts) with the real hosted broken-sample audit. The request contained only hashed project/audit identifiers, the audit timestamp, assertion kinds and statuses. Names, URLs, requirements, screenshots, DOM text and credentials were excluded. Backboard returned HTTP 201.
4. Waited three seconds for indexing, then called `recallProjectMemory` once. HTTP 200 returned one matching audit record with all six statuses unchanged: three failed, two passed and one unverified. The failed heading was present. No retry or extra memory request ran.
5. Read the balance again. The source audit was not changed and no FieldIssue assistant or database was accessed.

The source was `outputs/integration-release-hosted-2026-10-15/render-broken-audit.json`, SHA-256 `fe665a7fc35ed88e1b26a97cec947fce4c057e687fd91bae0d4d0f5f61c29cdf`. The receipt records the source facts and hashes of the exact adapter, allowance guard and verification script used. Private assistant identifiers and account credentials are withheld; the dedicated synthetic memory remains in that separate assistant.

## Credits actually observed

The user explicitly authorized consuming existing Backboard credits. The preflight found a mixed free/paid balance; the allowance therefore recorded **`freeOnly: false`** and **`existingCreditOnly: true`**, not a fabricated free-grant claim.

| Account credit bucket | Before | Immediately after | Observed deduction |
|---|---:|---:|---:|
| Free | $5.000000 | $4.990000 | $0.010000 |
| Paid | $4.998257 | $4.998257 | $0 |
| Subscription | $0 | $0 | $0 |
| Total | $9.998257 | $9.988257 | $0.010000 |

Auto-reload remained off and no payment method was configured in both responses. No card, top-up, subscription or billing setting was changed. The immediate account-wide difference was **$0.01 from free credits**; paid credits were unchanged. This observation does not prove a universal free-first spending rule, exclude concurrent account activity, or reconcile delayed provider charges.

The [official pricing page](https://backboard.io/pricing) lists trial memory access and published memory-operation prices up to $0.01. The local proof conservatively reserved $0.01 for setup overhead and $0.01 for each of its two memory operations, totaling **$0.03 of existing credits**. Setup overhead is a reservation, not a claimed provider fee. The [billing documentation](https://docs.backboard.io/concepts/billing) describes the read-only balance API and starter credits; this account's API did not return an explicit grant expiry. The current [official dashboard guide](https://docs.backboard.io/dashboard) describes $5 of starter credits valid for 30 days, without a credit card. This public offer is not evidence of this account’s grant source or expiry; the proof relies on the actual account observations above.

## Guard and reproduction

[`free-resource-policy.ts`](../server/providers/free-resource-policy.ts) admits the existing-credit alternative **only for Backboard**, with all of these conditions: explicit environment approval, key-bound account evidence checked within 24 hours, an unexpired allowance, confirmed positive existing credit, disabled auto-reload, no payment method, and a maximum $0.03 reservation. It permits at most one memory write and one memory search. Reservations persist before requests and are not refunded on failure. Every other provider retains the confirmed-free requirement.

[`verify-backboard-credits.ts`](../scripts/verify-backboard-credits.ts) uses the known synthetic audit and private operator credential file. It has no default live action; without its run flag and explicit approval environment variable it reports zero provider calls. A private state file prevents automatically creating a duplicate assistant after success, failure or interruption. Inspect that state before considering any separately authorized future proof.

```sh
# Safe default: no provider requests.
node --import tsx scripts/verify-backboard-credits.ts

# Offline transport/guard tests; no provider credits.
npx vitest run tests/optional-providers.test.ts
```

The focused suite passed **32 tests**, including reservation-before-I/O, stale or mismatched evidence rejection, repeated-operation rejection, credit-cap enforcement and refusal to use this alternative for Tinker, SerpApi or ElevenLabs. TypeScript compilation passed. These tests supplement the real receipt; they do not replace it.

Official request contracts: [Create assistant](https://docs.backboard.io/api-reference/assistants/create), [Add memory](https://docs.backboard.io/api-reference/memories/add), [Search memories](https://docs.backboard.io/api-reference/memories/search).
