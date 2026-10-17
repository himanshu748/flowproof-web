# October 17 provider funding and expiry recheck

The scheduled read-only recheck ran at the actual UTC times in [the receipt](receipt.json), after its nominal local schedule. [API observations](api-observations.json) and [authenticated browser observations](ui-observations.json) are separate. No inference, speech, search or memory operation was run.

## Owner attention required

- **Tinker and Sentry application confirmations expired October 17 at 08:23:47.620 UTC (13:53 IST).** The live demo reports both as `not_configured`; their local admission functions return false. Account credit alone does not renew application authority. No timestamp or allowance was rewritten.
- **Tiger billing requires the owner's Google passkey verification.** The database remains reachable through verified TLS 1.3, with restricted-role expiry October 20 at 00:00 UTC. Connectivity does not prove current trial credit or absence of a payment method. The last authenticated billing observation remains history, not a fresh confirmation.

| Provider | Current read-only observation |
| --- | --- |
| Tinker | $9.18 remaining in the existing Tinker x MLH grant; active period displayed Oct 7, 2026–Oct 8, 2027. No payment methods; auto-reload disabled. Existing Briefstamp sampler expires Oct 19 at 23:59:30.230217 UTC. No TTL update or inference. |
| Sentry | Sponsored Team; pay-as-you-go used $0 / limit $0. Spans displayed 2K / 50M, additional spend $0.00. Its application confirmation is expired. No ingestion or export request was sent. |
| Tiger Data | TLS connection and read-only queries succeeded; four public judge reservations and ten operator reservation rows observed. Billing could not be reverified because Google requires owner verification. No SQL writes. |
| Google Gemma | The [official pricing page](https://ai.google.dev/gemini-api/docs/pricing?hl=en) still passed the project's free-only pricing verifier. This is not an inference-health check. |
| Backboard | $4.96 free credit alongside existing paid credit; positive existing balance, auto-reload off, no payment method. No deduction-order guarantee or new spending approval. All earlier grants remain spent. |
| SerpApi | Active Free Plan, monthly price $0, 209 searches remaining, zero extra credits. No search was made. |
| ElevenLabs | Existing active Creator entitlement; 84,249 characters remaining, next invoice $0, both character-overage flags disabled, no open invoices. This is not a permanent-free-plan claim; its proof reservation remains spent. |

All **108** earlier private records and **130 cumulative files** matched their retained hashes. The existing **Free Render** environment matched its latest spent snapshot before and after the check. Public judge reservations remained four; the unchanged grant permits 100 total runs, six/hour and one/visitor, ending **October 20 at 00:00 UTC**. This recheck did not make any reservation reusable or authorize spending the remainder.

A funding-confirmation renewal must carry forward existing reservations, including Tinker's spent token/call ledger and both Task3 Sentry exports. Do **not** rerun `refresh-hosted-provider-proofs.mjs`: it is an initial-only setup helper. No purchase, card, promo redemption, upgrade, training, new service, credential transfer, deployment, provider execution, DEV publication, security change or allowance refund occurred. `.tech` remains declined.

Only the final October 18 check remains authorized. These files record state; they do not modify service configuration or claim that an unavailable integration is live.
