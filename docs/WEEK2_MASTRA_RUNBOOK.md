# Week 2 Mastra approval runbook

The upgrade uses real `@mastra/core` **1.77.0** suspension/resumption, an immutable run-bound proposal digest, explicit approval IDs, and one-shot browser dispatch. The web process never imports the Mastra runtime eagerly. Native snapshots travel through the public workflow storage API and remain only in the web process's memory. Each SDK process exits before visitor review or Chromium execution. Process or host loss still loses pending approval state.

The [retained local proof](evidence/mastra-local/2026-10-18T09-10-22-823Z/README.md) includes genuine native snapshots, actual Chromium screenshots, the failed resident-worker approach, a failed missing-browser run, and the corrected compiled-entrypoint failure. It is not hosted evidence. Local selected Node 22/heap 96 PSS was 495.79 MiB without Temporal; hosted cgroup behavior and Chromium 156 remain separate checks.

## Local reproduction

Use installed dependencies and Node 22. Do not introduce provider keys. The verifier injects the retained Gemma proposal and offline pricing preflight, while exercising the actual full demo router, native workflow and safe Chromium runner. It creates a fresh directory under `work/mastra-approval-http/`; evidence is never overwritten.

```bash
npx vite build --ssr server/hosted-approval-child.ts --outDir dist-approval-worker
npx vite build --ssr scripts/verify-approval-http.ts --target node22 --outDir dist-approval-http
node --max-old-space-size=96 dist-approval-http/verify-approval-http.js --run-local
```

The machine needs a working Playwright Chromium installation. In the retained execution environment, the first default browser launch failed because that binary was absent. The successful runs used the already installed Chromium 154 via `PLAYWRIGHT_BROWSERS_PATH=/tmp/briefstamp-system-playwright`, not a new browser download or a hosted browser. That temporary path is specific to this environment. Do not assume it exists elsewhere.

The lower-level script also exercises the actual SDK/runner handoff, preserving both native snapshots:

```bash
node --max-old-space-size=96 --import tsx scripts/verify-approval-worker.ts --run-local
```

The HTTP proof reports RSS and PSS by phase. Its fixture model produces no fresh usage values and consumes no public model/search reservations. Do not describe injected local pricing as a grant validation.

Regression checks cover real SDK approval, invalid/stale IDs, digest binding, tampered native snapshots, one-shot ambiguous execution, and HTTP plan immutability:

```bash
npx vitest run tests/approval-workflow.test.ts tests/hosted-approval.test.ts tests/demo-approval.test.ts --no-file-parallelism
npx tsc --noEmit
```

The native worker test builds its own child artifact, so it also runs from a clean checkout. Existing workflow tests use offline proposer/browser ports explicitly labeled as such; the separate HTTP verifier uses real Chromium.

## Hosted execution after central integration

The feature is opt-in via the existing deployment configuration's `BRIEFSTAMP_MASTRA_APPROVAL_ENABLED`; this runbook does not enable it. Build/test the final committed SHA, require all relevant CI to be green on that exact SHA, deploy only the existing free Render service, and read back `/health` to confirm its `sourceCommit`. Confirm actual free-account funding and existing provider reservations through their supported account interfaces before any hosted model request. A local fixture, stale grant receipt, or pricing mock cannot satisfy that prerequisite.

Use the central verifier only after those checks and supported account sign-in. Ordinary secure sign-in is separate from granting new credentials, expanded access, billing, or paid plans. Never put passwords, keys or tokens in chat or command arguments.

```bash
node --import tsx scripts/verify-week2-hosted.ts --run --mode mastra --output work/NEW_MASTRA_HOSTED_DIRECTORY --expected-sha DEPLOYED_40_HEX_SHA
```

Replace both placeholders with a new evidence directory and the deployed exact SHA. This command is intentionally not automatic. It performs genuine hosted requests using the existing session quotas, including one controlled test approval. It must preserve its explicit test-actor label and the original unapproved proposal. Record successful and failed responses, token receipts, actual selected tools, validated citations, SDK lifecycle and screenshot evidence as produced; never fill missing values from local fixtures or old runs.

Do not retry a failed reservation or uncertain provider operation, raise quotas, alter billing, introduce Temporal Cloud, or upgrade Render. Inspect the retained result and existing server receipts first. Save genuine hosted success only under `docs/evidence/mastra-hosted/<timestamp>/`; keep local reproduction under `mastra-local`. A hostname, a successful build, or the local receipt does not establish hosted execution.
