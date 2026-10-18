# Temporal recovery: full evidence agent and browser audit

Temporal is optional and disabled by default. The existing operator audit service remains separate from the new, disabled hosted evidence-agent path. The integration accepts only a loopback Temporal address and creates no cloud resources or billable services.

The workflow schedules the existing approved Playwright audit as an activity. Activity retries are bounded to three attempts and eight minutes total. Invalid plans and safety violations become nonretryable application failures. Actual failed or blocked browser observations remain failed or blocked; workflow completion never means every requirement passed.


## October 18 hosted upgrade: implemented, blocked from enabling

The new hosted path is **not verified live on Render** and must remain disabled. `FLOWPROOF_TEMPORAL_HOSTED_ENABLED` defaults off. Local testing used the actual CLI/SDK with explicitly retained provider fixtures, not fresh model/search calls or a public grant reservation. The [local verification and histories](evidence/temporal-local/2026-10-18T09-08Z/README.md) preserve the successful controlled retry/worker restart, memory measurement and initial failed configuration attempt.

The implementation accepts only an already committed Tiger judge reservation, keeping its maximum **2 model calls and 1 search call**. The web process retains credentials and session/source guards. A bundled child hosts the SDK and starts official CLI **1.9.1 / server 1.32.0**, with matching SDK **1.24.0**, binding gRPC to **127.0.0.1:7233**, disabling the Temporal UI and storing SQLite at `<FLOWPROOF_DATA_DIR>/temporal-hosted/history.sqlite`. Gemma selection, Tiger lookup, SerpApi search and Gemma summary are separate real Temporal activities. Empty tool selection abstains without a second model call. Every request has a shared **90-second** deadline, provider attempts remain one per logical operation, and ambiguous provider completion fails closed instead of repeating a dispatch. A completed phase cache can reuse a response after a lost activity completion.

Each run has a dedicated task queue and worker. The trusted controlled test injects one transient failure **before** model dispatch, then gracefully shuts down and recreates only that run's SDK worker after Tiger completes. The same workflow/run resumes from actual history without repeating completed activities; this is a controlled worker restart, not a process crash or host disk recovery test. Status/attempt counts are derived from actual Temporal history; the phase comes from a workflow query. The child, its worker and CLI exit after the run, releasing memory before another browser audit. No paid plan or Temporal Cloud resource is created.

The final native compiled verifier and compiled app used Node **22.23.3**, a **96 MiB** parent heap, **64 MiB** isolated-child heap, and CLI `GOMEMLIMIT=64MiB` / `GOGC=20`. After Temporal stopped, real Chromium returned **2 passed, 3 failed, 0 blocked and 1 unverified** checks. The [compiled receipt](evidence/temporal-local/2026-10-18T09-08Z/temporal-hosted-node22-compiled-2.json) records these sampled process-tree PSS peaks:

| Phase | PSS KiB |
|---|---:|
| Temporal workflow | 482,457 |
| After child exit | 182,093 |
| Later Chromium / overall maximum | 491,322 |

The overall peak is about **479.8 MiB**, roughly **32.2 MiB** below a 512 MiB instance. This is local fixture evidence; Render cgroup, kernel and file-cache charges and its Chromium version remain unverified. **Do not enable the hosted flag until actual capacity is observed on the existing free service.**

Earlier source-loaded designs exceeded the budget: the Node 24 full-app run reached **561,632 KiB PSS**, Node 22 source-loaded variants reached **534,697**, **553,316** and **525,176 KiB PSS**, and a compiled app with the verifier still using `tsx` reached **540,956 KiB PSS**. Their original receipts and phase measurements remain in the [local evidence index](evidence/temporal-local/2026-10-18T09-08Z/README.md). Initial SDK configuration failure and early browser row-count measurements that did not prove Chromium execution are also retained. They are not hosted successes or free-plan capacity passes.

[Render's free-service documentation](https://render.com/docs/free) says that its local filesystem, including SQLite, is lost on redeploy, service restart or spin-down, and free services cannot attach persistent disks. Thus SQLite can preserve Temporal history across the controlled SDK-worker restart on one unchanged host, but **cannot** recover that history after Render host loss. Request-scoped provider callbacks remain in the parent web process and also do not survive a web-process loss. No durable infrastructure, continuous worker availability or hosted success is claimed.

Official APIs checked for this implementation: [CLI server flags and SQLite development persistence](https://docs.temporal.io/cli/command-reference/server), [SDK Worker lifecycle](https://typescript.temporal.io/api/classes/worker.Worker), [SDK workflow bundling](https://typescript.temporal.io/api/namespaces/worker#bundleworkflowcode), and [Render free storage lifecycle](https://render.com/docs/free). The Docker CLI archive is checksum-pinned to the same v1.9.1 release used by the existing CI proof. Workflow code is precompiled using TypeScript and the official SDK bundler; runtime does not run webpack.

Reproduce the local lifecycle/resource test (fixture callbacks, no inference charges):

```sh
npm run build
npx vite build --ssr scripts/verify-hosted-temporal-local.ts --target node22 --outDir dist-temporal-verifier
node --max-old-space-size=96 dist-temporal-verifier/verify-hosted-temporal-local.js \
  --cli /path/to/verified/temporal --output work/temporal-hosted-new \
  --full-app --chromium
```

Install Chromium through the repository's normal Playwright setup first. Browser absence produces a failure rather than a successful browser claim. The output directory must be fresh. The verifier starts its own synthetic local app on port 14310 when `--full-app` is specified, stops the CLI/child it created, and exits that test app at completion.

## Full evidence-agent recovery (October 16)

The [real CI proof](evidence/temporal-agent/2026-10-16T16-05-48Z/README.md) wraps Gemma tool selection, Tiger retrieval, SerpApi search and Gemma summary in separate Temporal activities. [CI run 38929162466](https://github.com/himanshu748/flowproof-web/actions/runs/38929162466) passed with the official development server. A first-selection HTTP 500 retried once. After Tiger completed, the verifier killed the worker with SIGKILL; the new worker resumed the same workflow/run and retained all three pre-kill completion event IDs. Search recovered from an injected pre-dispatch timeout in two attempts. Permanent HTTP 400, invalid citations and three exhausted HTTP 500 attempts all ended FAILED without an answer.

[Raw histories and receipt](evidence/temporal-agent/2026-10-16T16-05-48Z/) derive attempts from Temporal history, not logs. Each activity has exponential backoff (1 second, coefficient 2, maximum interval 4 seconds), at most three attempts and nonretryable safety/validation/4xx errors. Stable workflow-run/activity identities bind a single durable reservation and cached completed responses. The ledger refuses ambiguous in-flight completion instead of dispatching a duplicate. Existing browser acceptance results are validated immutable inputs to separate cited findings.

The provider adapter in this proof **replays retained native responses**. It makes zero fresh model/search requests and uses no public judge reservations. The full agent recovery remains **CI/local only**; the public agent is not served by a persistent Temporal worker. Reproduce using a new output directory:

```sh
node --import tsx scripts/verify-temporal-agent.ts --cli work/temporal-cli/temporal --output work/temporal-agent-unique
```

The original browser-audit proof below is separate and remains unchanged.

## Recorded verification

The [October 15 local proof](evidence/temporal/2026-10-15T07-33-17-054Z/temporal-verification.json) completed with Temporal CLI 1.9.1, server 1.32.0 and matching TypeScript SDK 1.24.0 packages. A controlled first-attempt failure was followed by a real Chromium audit on attempt two: five requirements passed and one manual requirement remained unverified. After both processes restarted, the same workflow and run completed without another browser execution. The report and five screenshot hashes stayed unchanged.

The [publication manifest](evidence/temporal/2026-10-15T07-33-17-054Z/publication-manifest.json) records original and published file hashes. Only local hostnames and absolute repository paths in event histories were redacted. Its recorded source hashes match the implementation used for the successful run. The [portable HTML report](evidence/temporal/2026-10-15T07-33-17-054Z/receipts/da362af8-8c12-4dbc-861f-02e29a582407/report.html) embeds the actual screenshots.

An [earlier readiness attempt](evidence/temporal/2026-10-15T07-22-12-798Z/temporal-verification.json) exceeded the local server startup deadline before creating a workflow and is preserved as blocked. The successful proof used the same deadlines after local storage was freed. This evidence establishes local development-server recovery; Temporal Cloud and production availability remain unverified.

## Start locally

Install matching Temporal TypeScript SDK package versions through the repository lockfile. Download the official CLI for your platform using the [Temporal CLI instructions](https://docs.temporal.io/cli/setup-cli), verify its release checksum, and keep the executable outside source control.

```sh
# A development server, not a production deployment.
temporal server start-dev --ip 127.0.0.1 --headless --db-filename work/temporal.sqlite

# Separate terminal. No cloud account or payment method is required.
FLOWPROOF_TEMPORAL_ENABLED=true \
FLOWPROOF_TEMPORAL_ADDRESS=127.0.0.1:7233 \
node --import tsx scripts/temporal-worker.ts
```

The worker uses one concurrent browser activity. Browser evidence defaults to `<FLOWPROOF_DATA_DIR>/evidence`; the completed activity receipt and portable HTML report default to `<FLOWPROOF_DATA_DIR>/temporal/<audit-id>/`, with `FLOWPROOF_DATA_DIR` defaulting to `data`. Override them with `EVIDENCE_ROOT` and `FLOWPROOF_TEMPORAL_RECEIPT_ROOT`. Keep the worker and operator API on the same trusted evidence storage.

The operator API can call `startApprovedAudit(project, audit)` from `temporal/client.ts`. It independently validates authorization and the approved snapshot and returns the workflow and run IDs. `readTemporalAudit(workflowId)` returns its execution status or the completed audit result, allowing the API to recover its display after restarting. Pending reads avoid worker-dependent queries, so an offline worker cannot hang the API; server RPCs have three-second deadlines. The API must enforce its existing project authorization and approval rules before dispatch and before returning results. No workflow control is exposed to public demo visitors.

For application lifecycle handling, use `dispatchDurableAudit(project, audit, { save, start, read })` and `refreshDurableAudit(audit, { save, read })` from `server/temporal-audit.ts`. Dispatch persists the deterministic workflow ID with an empty pending run ID before contacting Temporal. If a start reply or subsequent save fails, it reconciles that same identity; an unavailable service leaves the saved audit pending with a safe diagnostic. Refresh preserves existing results during outages, adopts a discovered run ID only when none was previously known, and accepts completed results only when the saved project identity, creation time, source snapshot, approved checks and result rows match. The API lifecycle tests inject storage failures and lost replies; they are separate from the recorded real server/worker restart proof above.

## Reproduce the restart proof

```sh
node --import tsx scripts/verify-temporal.ts \
  --cli work/temporal-cli/temporal \
  --output work/temporal-proof-unique
```

The output directory must be new. The command starts its own loopback server on an unused port and stores SQLite history in that directory. It then:

1. Starts a real SDK worker and a workflow containing an explicitly approved built-in sample plan.
2. Injects one transient activity failure before any browser execution.
3. Observes the actual Temporal retry, runs Chromium, and verifies five passed requirements plus one unverified manual requirement.
4. Holds the workflow waiting for a signal after the activity completes.
5. Stops both the worker and server, then restarts them with new process IDs and the same SQLite file.
6. Confirms the same workflow ID and run ID, signals completion, and checks that no new activity or browser execution occurred.
7. Rechecks screenshot and report hashes, preserving the before/after event histories and SDK attempt log.

A successful receipt has `status: "verified"`. A failed or unavailable run records `status: "blocked"` with its actual error; source code and unit tests alone are not proof of durable execution. The verification command stops the processes it started. The workflow's demonstration signal wait is bounded to ten minutes.

`FLOWPROOF_TEMPORAL_PROOF_WORKFLOW_ID` and `FLOWPROOF_TEMPORAL_ATTEMPT_LOG` are trusted worker-side demonstration controls. The operator API does not accept them from user requests. Failure injection rejects external website targets.

## Manual GitHub Actions proof

The [Temporal recovery workflow](../.github/workflows/temporal-proof.yml) **passed on the public GitHub runner** in [run 38727552047](https://github.com/himanshu748/flowproof-web/actions/runs/38727552047), source `2a8eae95c95cf91adb0cd2bed155e6dbb81249ef`, on October 15 at 11:28–11:29 UTC. The [actual receipt](evidence/temporal/2026-10-15T11-28Z/temporal-verification.json) and [execution manifest](evidence/temporal/2026-10-15T11-28Z/ci-manifest.json) retain the exact source and nine evidence-file hashes. Both server and worker changed process IDs; the workflow/run IDs stayed unchanged, with two activity attempts and one browser execution before and after restart. The attempt log remained unchanged and the workflow completed. It runs only through `workflow_dispatch` on the public repository, with `contents: read`, a standard `ubuntu-latest` runner and a twelve-minute deadline. It installs locked npm dependencies and Chromium, then invokes the unchanged verifier with `--cli` and the fresh `work/temporal-ci` output directory. No application build, scheduled run, provider key, Temporal Cloud account or paid worker is required. The job fails unless the resulting receipt says `verified` and names its exact source commit.

The Linux amd64 CLI is pinned to official **v1.9.1**:

- [Release metadata](https://api.github.com/repos/temporalio/cli/releases/tags/v1.9.1) and the [official checksums file](https://github.com/temporalio/cli/releases/download/v1.9.1/checksums.txt) both report archive SHA-256 `09a0326a51db84d02735e53542b9ebd8c4758daf47482a9ab0abce15844e60d5`.
- [Archive](https://github.com/temporalio/cli/releases/download/v1.9.1/temporal_cli_1.9.1_linux_amd64.tar.gz): 45,298,806 bytes. The job verifies the pinned digest before extracting the executable. Only release metadata and the 836-byte checksums file were downloaded during preparation; the binary was not downloaded locally.
- The [release notes](https://github.com/temporalio/cli/releases/tag/v1.9.1) identify bundled development-server version 1.32.0. [Official CLI guidance](https://docs.temporal.io/cli/setup-cli) documents development-server SQLite persistence.

The workflow adds `ci-manifest.json` separately from the verifier's receipt. It records the source commit, Actions run URL, run attempt, pinned archive digest and actual evidence-file hashes. Repository paths and the ephemeral runner hostname are redacted in the logged receipt. A single `BRIEFSTAMP_TEMPORAL_RECEIPT_B64=` line carries the receipt and manifest as base64 JSON, capped at 32 KiB before encoding; the manifest also appears as readable JSON in the logs and the job summary describes the observed restart. A blocked or missing receipt remains a failure.

There is **no artifact upload or cache** in this workflow. PNGs, portable HTML, event histories and the attempt log remain ephemeral runner files; their hashes do not mean those bytes are durably hosted. SQLite, environment files and raw worker/server logs are never included in the receipt packet. The bounded receipt and manifest were recovered from this successful job’s logs, reviewed and published at the links above. The nine hashed evidence files remain ephemeral runner files; their image/report bytes are not durably hosted by this CI proof.

This demonstrates **development-server recovery on hosted CI**, not Temporal Cloud, an always-on worker or recovery on the public Render service. [GitHub documents free standard runner use for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions); this workflow uses no larger runner or paid artifact storage. The earlier local evidence remains valid independently of this remote run.

## Limits and evidence handling

The official CLI development server is free and local; it is not a claim of production uptime or Temporal Cloud deployment. The proof restarts after a browser activity completes. A worker crash during a browser activity can cause a safe, read-only retry, so the integration does not claim exactly-once execution for every failure point. Completed receipts also support idempotent reuse after a lost completion acknowledgement when the same approved snapshot is supplied.

Real client briefs and results appear in local Temporal payloads and SQLite history. Keep that database private. Publish only the explicitly synthetic proof's sanitized receipt, source hashes, histories, attempt records, report and screenshots. Do not publish the SQLite database, worker configuration, credentials or environment files. No secrets are required for the local proof.
