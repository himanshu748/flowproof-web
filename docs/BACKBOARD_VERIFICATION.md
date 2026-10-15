# Backboard: real audit memory and retrieval

**Verified October 15, 2026:** the actual Briefstamp Backboard adapter stored an anonymous summary of a completed synthetic audit, then retrieved the same audit with its failed heading and all six observed statuses intact. [Sanitized live receipt](evidence/backboard/2026-10-15T09-28-55-074Z/receipt.json).

This was an operator-run cloud integration test. It does not establish public-demo deployment, client-data suitability, lifetime free eligibility or general retrieval quality. The saved memory is historical context, not a new audit or new proof that a website passes.

## What executed

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

The [official pricing page](https://backboard.io/pricing) lists trial memory access and published memory-operation prices up to $0.01. The local proof conservatively reserved $0.01 for setup overhead and $0.01 for each of its two memory operations, totaling **$0.03 of existing credits**. Setup overhead is a reservation, not a claimed provider fee. The [billing documentation](https://docs.backboard.io/concepts/billing) describes the read-only balance API and starter credits; this account's API did not return an explicit grant expiry. The announced [MLH/DEV state-management offer](https://backboard.io/blog/stateful-agents-real-orchestration) was not treated as proof that this account redeemed it.

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
