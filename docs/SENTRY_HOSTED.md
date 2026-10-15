# Sentry: verified hosted proposal traces

**The live-homepage proposal trace was independently verified in Sentry’s authenticated dashboard at 16:32 UTC (22:02 IST) on October 15, 2026.** The later [dashboard verification receipt](evidence/hosted-website/2026-10-15T15-37-09Z/sentry-verification.json) establishes ingestion for the exact trace emitted by the [15:37 application run](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json), from source `2e3c3397ea5a594ecb329f7b52ef373fe1049161`.

## Latest independently observed trace

Trace `70ef2a9b80da4b60bd4bc104ed1ec823` appeared in the separate Briefstamp project with three spans:

| Operation | Observed duration | Status |
| --- | ---: | --- |
| `briefstamp.proposal` | 21.39 seconds | `ok` |
| `briefstamp.proposal.generate` | 7.49 seconds | Not separately recorded in the sidecar |
| `briefstamp.proposal.validate` | 1.62 milliseconds | Not separately recorded in the sidecar |

![Authenticated Sentry dashboard showing the exact live-homepage proposal trace and its two child spans](evidence/hosted-website/2026-10-15T15-37-09Z/sentry-trace.jpg)

The original runtime and audit receipts retain `ingestionVerified: false`: the worker could establish a flush, but could not inspect the dashboard. The later sidecar supplies independent ingestion proof without rewriting those records. This verification made no new model calls or billing/configuration changes. It covers proposal generation only, not browser-audit tracing or error-event ingestion. Span durations are observations from one run, not a latency benchmark.

## Earlier synthetic proposal proof

The separate [10:55 application run](evidence/hosted-open-model/2026-10-15T10-55-27Z/receipt.json), from source `e43dbe7430368292ff9b225f4bf5e3236c2d03c0`, has its own [dashboard receipt](evidence/hosted-open-model/2026-10-15T10-55-27Z/sentry-verification.json) and [screenshot](evidence/hosted-open-model/2026-10-15T10-55-27Z/sentry-trace.jpg). Trace `4ca80cb2a546425ea0f191022b862ed1` showed a 22.09-second root with status `ok`, a 7.59-second generation child and a 0.43-millisecond validation child. The native Gemma provider/validation call took 7.502 seconds, used 335 input / 300 output tokens, and the isolated worker reached 175.07 MiB maximum RSS. Its later browser audits are separate from this proposal trace.

## Privacy and resource boundary

The real Sentry SDK is loaded only in the isolated proposal worker when explicitly enabled with a fresh, at-most-24-hour funding confirmation. Disabled or stale configurations do not load it. Each child caps delivery at three envelopes; the public model-request quotas provide the wider execution bound.

The final transport allowlist retains fixed operation names, trace/span identifiers, timing/status and bounded check counts. It excludes client briefs, model output, cookies, credentials, screenshots, attachments and raw diagnostic messages. Sentry can derive hosting-server metadata from its own ingestion request. Local SDK tests verify parent/child trace identity and private-field exclusion.

A sponsored entitlement with paid overage disabled was verified before configuration. No billing or FieldIssue settings changed. This does not establish browser-audit tracing, error-event ingestion, indefinite entitlement or all-provider observability. Further hosted use still requires a fresh confirmation and the same bounded configuration.

Sources: [child workflow](../server/gemma-workflow-child.ts), [privacy transport](../server/observability.ts), [earlier local SDK proof](ORCHESTRATION_OBSERVABILITY.md), [deployment ledger](DEPLOYMENT.md).
