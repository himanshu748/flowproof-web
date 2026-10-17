# Sentry: verified hosted browser, agent and proposal traces

## October 17: Chromium and agent traces

The [new protected hosted proof](evidence/sentry/2026-10-17T05-14-26Z/) ran on the existing Free Render service from source `72e8a15e324b4702833b34ca4a116da8deba4a75`. The authenticated in-app dashboard independently verified both exact trace IDs:

| Trace | Actual dashboard observation |
| --- | --- |
| `18a90fd941524460ac662abb0b84dd9e` | Two spans: audit root **16.36 seconds**, browser child **16.35 seconds**; root status `ok` |
| `656bdc691e484bc0a955acb778df323e` | Five spans: agent root **22.35 seconds**, selection **2.07 seconds**, search **800.00 ms**, history **1.54 seconds**, summary **5.38 seconds**; root status `ok` |

[Dashboard receipt and screenshot descriptions](evidence/sentry/2026-10-17T05-14-26Z/sentry-verification.json) · [Browser screenshot](evidence/sentry/2026-10-17T05-14-26Z/sentry-browser.jpg) · [Agent screenshot](evidence/sentry/2026-10-17T05-14-26Z/sentry-agent.jpg). These are observations from one run, not benchmarks. `ok` means the operation completed; its **2 passed / 3 failed / 0 blocked / 1 unverified** browser result was unchanged and round-tripped exactly through Tiger.

The real Mastra Agent used Backboard/OpenRouter `google/gemma-4-26b-a4b-it`, both registered tools and seven validated findings. The [provider receipt](evidence/sentry/2026-10-17T05-14-26Z/receipt.json) records **535/34** selection and **1,266/562** summary input/output tokens, with **1,969 ms** and **5,273 ms** provider durations. Their measured model spans include the bounded wrapper. The dashboard retained model, provider and latency; token-named fields were absent from its [ingested attribute projection](evidence/sentry/2026-10-17T05-14-26Z/dashboard-model-attributes.json). The cause is unconfirmed. Token counts are verified against provider receipts/application measurements, not claimed as independently dashboard-verified.

SDK-free recorders measure execution; an isolated, bounded SDK child exports those actual timestamps **after** Chromium or the agent finishes. Original [browser](evidence/sentry/2026-10-17T05-14-26Z/browser-trace.json) and [agent](evidence/sentry/2026-10-17T05-14-26Z/agent-trace.json) receipts retain `ingestionVerified: false`; the later dashboard sidecar establishes ingestion. This does not establish continuous cross-process propagation, error-event ingestion or automatic tracing of every public visit. Native-loop retries, if used, are one logical-call span; this hosted proof used two single-attempt HTTP 200 model calls with no retries.

The separately approved **four-unit / $0.20 existing mixed-credit** provider grant and **two-export** trace grant are [consumed without refund](evidence/sentry/2026-10-17T05-14-26Z/spent-reservations.json). All 108 earlier records and old Render environment values were preserved; public judge slots stayed **4 → 4**. Each export used a unique Tiger reservation plus exclusive fsynced local intent before SDK launch. The worker gets no model, search, operator or database credential. Funding expires at the unchanged October 17 08:23:47.620 UTC confirmation boundary. No purchases, credential transfers, new services, billing/security changes or live DEV edits occurred. The public route still uses Google.

[Exact deployed source CI](evidence/sentry/2026-10-17T05-14-26Z/ci.json): **1,451 app tests, 19 Python tests**, build, isolated Mastra/public runtime and real Chromium checks. [Tracing source](../server/runtime-trace.ts) · [Grant boundary](../server/runtime-trace-gate.ts) · [Host verifier](../scripts/verify-hosted-sentry-runtime.ts).

## Earlier proposal-only proof

**Fresh October 16 dashboard verification:** trace `c74fe62d211044c4a0a202f69b141542`, emitted by the [new deployed live-homepage Gemma run](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json), appeared in the authenticated Briefstamp-only dashboard with **three spans**: root `briefstamp.proposal` **23.30 seconds**, status **ok**; generation **7.59 seconds**; validation **0.53 milliseconds**. [Independent sidecar](evidence/hosted-website/2026-10-16T09-10-55Z/sentry-verification.json) · [Actual screenshot](evidence/hosted-website/2026-10-16T09-10-55Z/sentry-trace.png). Source `64a62729018fc2372611c7b21bfffecf3b779556`; original worker `ingestionVerified: false` remains unchanged. Sponsored Team entitlement and $0 pay-as-you-go were rechecked before the run. This remains proposal tracing only.

**The live-homepage proposal trace was independently verified in Sentry’s authenticated dashboard at 16:32 UTC (22:02 IST) on October 15, 2026.** The later [dashboard verification receipt](evidence/hosted-website/2026-10-15T15-37-09Z/sentry-verification.json) establishes ingestion for the exact trace emitted by the [15:37 application run](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json), from source `2e3c3397ea5a594ecb329f7b52ef373fe1049161`.

## Earlier October 15 independently observed trace

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

The real Sentry SDK loads in isolated proposal or runtime-export workers under fresh, at-most-24-hour funding confirmation. Disabled or stale configurations do not load it. Proposal children retain their three-envelope bound; runtime exports have two envelopes each and an independent, once-only grant. Both use the final transport allowlist.

The final transport allowlist retains fixed operation names, trace/span identifiers, timing/status, bounded counts, allowlisted model/tool labels, latency and actual numeric usage when present. It excludes client briefs, model output, cookies, credentials, screenshots, attachments and raw diagnostic messages. Sentry can derive hosting-server metadata from its own ingestion request. Local SDK tests verify parent/child trace identity and private-field exclusion.

A sponsored entitlement with paid overage disabled was verified before configuration. No billing or FieldIssue settings changed. The earlier proposal-only evidence did not establish browser-audit tracing; the October 17 runtime proof above extends that scope. Error-event ingestion, indefinite entitlement and all-provider observability remain unverified. Further hosted use still requires a fresh confirmation and the same bounded configuration.

Sources: [child workflow](../server/gemma-workflow-child.ts), [privacy transport](../server/observability.ts), [earlier local SDK proof](ORCHESTRATION_OBSERVABILITY.md), [deployment ledger](DEPLOYMENT.md).
