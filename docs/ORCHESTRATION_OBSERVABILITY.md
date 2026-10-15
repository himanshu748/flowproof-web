# Mastra coordination and optional Sentry tracing

Briefstamp executes actual Mastra SDK workflows and tools around proposal generation, validation, approval checks, browser execution and summaries. Sentry's actual Node SDK captures manually instrumented operations through a strict privacy boundary. Both integrations work locally without paid resources.

## What was verified

The [final local receipt](evidence/orchestration/2026-10-15T07-19-41-052Z/receipt.json), [captured Sentry envelopes](evidence/orchestration/2026-10-15T07-19-41-052Z/sentry-envelopes.json) and [SHA-256 manifest](evidence/orchestration/2026-10-15T07-19-41-052Z/manifest.json) record the real run on October 15, 2026. The receipt includes dependency versions and hashes of the implementation, runner, generator, verifier and lockfile. The earlier successful run is retained separately.

| Check                               | Observed result                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Actual SDK versions                 | `@mastra/core` 1.77.0; `@sentry/node` 11.7.0                                                    |
| Proposal workflow                   | Four structured draft checks; all unapproved                                                    |
| Approval boundary                   | Unapproved plan rejected before browser execution                                               |
| Healthy synthetic site              | 3 passed; 1 unverified                                                                          |
| Broken synthetic site               | 1 failed; 2 passed; 1 unverified                                                                |
| Browser evidence                    | Six real Chromium screenshots; bytes and SHA-256 recorded                                       |
| Sentry transport                    | Five actual SDK envelopes captured locally, including nested workflow spans and a generic error |
| Privacy check                       | Brief text, heading content and target URL absent from captured envelopes                       |
| Model calls / remote provider calls | 0 / 0                                                                                           |

This run uses the deterministic parser intentionally. It verifies the orchestration and telemetry integrations, not model quality. [Gemma evidence](GEMMA_WORKFLOW.md) and Tinker evaluation evidence have separate provenance. Approval in this proof is performed by an explicitly opted-in synthetic harness, not a human customer. Screenshots remain in `work/orchestration-verification/<run-id>/evidence`; the public receipt records their hashes.

**Not claimed:** Mastra Cloud, persisted Mastra execution state, durable recovery supplied by Mastra, an autonomous Mastra model agent, Sentry hosted ingestion, customer validation, or a Sentry dashboard result. The Sentry status deliberately keeps `hostedVerified: false`. Hosted ingestion needs an independently verified free account allowance and an actual provider receipt before its status can be upgraded in submission materials.

## Application API

```ts
import {
  generateChecksWithOrchestration,
  runAuditWithOrchestration,
} from "./orchestration.js";

// The default has no model calls. It still executes a real Mastra workflow.
const draft = await generateChecksWithOrchestration(brief, {
  allowModel: false,
  onStep: (event) => publishSafeProgress(event),
});

// Save and review draft.checks. The workflow always clears approval flags.
// Only call this after approved checks have been saved in the project and audit.
const completed = await runAuditWithOrchestration(
  project,
  immutableAuditSnapshot,
  saveObservedResult,
  { evidenceRoot, allowModelSummary: false },
);
```

Private application routes can opt into the configured generation adapter using `allowModel: true` and grounded Gemma commentary using `allowModelSummary: true`; adapter-specific free-resource gates still apply. The public demo disables both. Generator identity comes from the actual generator result, not the workflow framework.

The proposal workflow executes `requirement-proposal` followed by `validate-unapproved-proposal`. The audit workflow executes `require-approval`, `execute-approved-browser-checks`, then `summarize-observed-evidence`. Tools expose typed finite schemas; they do not accept or execute model-generated scripts. Every executable assertion must match the current approved plan. Results must contain exactly one matching record per assertion; manual requirements must stay unverified. Expected-value comparison uses the runner's redaction function. Optional commentary receives copied results and cannot mutate the original evidence.

Each successful operation returns an `orchestration` receipt with provider, workflow ID, run ID and safe step timings. `persisted: false` describes the in-memory Mastra engine. The optional `execute` dependency is for trusted host/test injection only and must never come from HTTP request input. A failed workflow throws; it cannot return a completed audit with missing results.

## Privacy and free-resource boundary

Mastra's supported `MASTRA_TELEMETRY_DISABLED=1` opt-out is set **before** dynamic SDK imports. Logger, remote exporters, Mastra storage, Studio and CLI are not enabled by this module.

Sentry stays disabled by default. Call `initObservability()` once at application startup; without all hosted gates it returns `mode: "disabled"`. Manually instrument application operations with `traceOperation`; only fixed operation names, numeric result counts and `sample`/`website` target categories are accepted. No project IDs, URLs, client briefs, DOM, screenshots, credentials or model prompts are exported.

Hosted opt-in requires all of the following environment settings, populated only after verifying the account's free allowance:

```dotenv
FLOWPROOF_SENTRY_ENABLED=true
FLOWPROOF_SENTRY_FREE_CONFIRMED=true
FLOWPROOF_SENTRY_FREE_CONFIRMED_AT=<current ISO-8601 verification time>
SENTRY_DSN=<provider-issued HTTPS ingestion DSN>
```

The timestamp must be no more than 24 hours old and cannot be future-dated. The transport also stops sending once that confirmation expires. Environment attestation is a runtime gate, not evidence that the account was verified. No hosted Sentry account or allowance was verified in the local proof. The default transport budget is 50 envelopes per process, hard-bounded to 1–100 through the trusted `maxEnvelopes` option; restarting a process resets that local budget. The account's own free quota and billing controls must therefore also be confirmed before hosted enablement. No card, paid plan, billing change or cloud account creation is performed by this code.

For reproducible local verification, pass `captureEnvelope` to `initObservability`. This selects an in-memory sink, never the provider's network transport. `mode: "local_capture"` and `hostedVerified: false` prevent confusing local capture with hosted ingestion.

Sentry 11.7 has explicit `dataCollection` controls. This integration disables user information, cookies, HTTP headers/bodies/query parameters, GraphQL documents/variables, model input/output, database query data, queues, stack-frame variables and source context. Server names and automatic integrations are disabled. Static transactions and explicit OpenTelemetry setup preserve nested manual spans. Both event processing and the final transport apply an allowlist; attachments, logs, metrics, profiles, private exceptions, stack traces, breadcrumbs and arbitrary metadata are dropped. The only error text is a fixed generic message. No trace headers are propagated to audited websites.

## Reproduce

Use the repository's supported Node version and installed Chromium:

```sh
npm ci
npx playwright install chromium
npx vitest run tests/orchestration.test.ts tests/observability.test.ts --no-file-parallelism
node --import tsx scripts/verify-orchestration.ts --run-local
```

The opt-in flag is required. The verifier uses only synthetic targets and local SDK transport, disables model adapters, avoids database access and preserves a receipt even when verification fails. Each run uses a new output directory and records actual screenshot hashes. Do not label these unit tests or synthetic proof as customer or hosted-provider validation.

The focused suite passed **10 tests**, including approval enforcement, incomplete-result rejection, redacted expectation matching, immutable model-summary input, stale/future free-confirmation rejection, envelope privacy and the actual Sentry local transport cap. The complete TypeScript check also passed in the shared checkout after integration.

## Primary references

- [Mastra workflow overview](https://mastra.ai/docs/workflows/overview)
- [Mastra workflow agents and tools](https://mastra.ai/docs/workflows/agents-and-tools)
- [Mastra createTool reference](https://mastra.ai/reference/tools/create-tool)
- [Mastra analytics opt-out implementation](https://github.com/mastra-ai/mastra/pull/16990)
- [Sentry JavaScript SDK configuration types](https://github.com/getsentry/sentry-javascript/blob/develop/packages/core/src/types/options.ts)
- [Sentry Node SDK](https://github.com/getsentry/sentry-javascript/tree/develop/packages/node)

Implementation was also checked against the installed pinned SDK's TypeScript declarations, including Sentry 11.7's `dataCollection` and static-trace options.
