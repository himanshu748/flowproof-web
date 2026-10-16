# Mastra approval suspension and Chromium handoff

[Actual CI run](https://github.com/himanshu748/flowproof-web/actions/runs/38940485541) executed `@mastra/core` 1.77.0 on source `3fedaef936e6796f45eb342b73997e912fd093cc`. [Receipt](receipt.json) · [Original CI file manifest](manifest.json).

The four SDK steps are `propose-checks`, `validate-proposal`, `await-developer-approval`, and `browser-handoff`. The proposal step explicitly replays an [earlier actual Gemma proposal](../../hosted-open-model/2026-10-15T10-55-27Z/generated-project.json); its original file hash is pinned in the receipt. No new inference, provider call or public judge reservation was used.

1. [Actual suspended state](suspended-state.json): status `suspended`, six unapproved checks, zero browser calls.
2. [Explicit resume payload](resume-payload.json): same run, exact plan digest and six approved check IDs. Approval came from the owner-instructed automated verifier, not a customer or independently observed human acceptance.
3. [Actual resumed state](resumed-state.json): status `success`, one proposal replay and one browser handoff; completed proposal work was not repeated.
4. [Fresh Chromium audit](browser-audit.json): **5 passed / 0 failed / 0 blocked / 1 unverified**. Five PNG screenshots and their byte counts/hashes are retained in `evidence/` and the receipt. Manual requirements stay unverified.

The workflow binds the immutable proposal and brief to the run ID with a digest. Unknown, duplicate, empty or stale IDs and changed payloads fail before browser execution. Synchronous process-local claims prevent repeated/concurrent resumes from duplicating a handoff; failed callbacks never refund that claim. Selected results must match exact IDs, kinds, requirements and expected values. [22 SDK boundary tests](../../../../tests/approval-workflow.test.ts) cover these controls.

This is a **local/CI, process-local proof**. No durable Mastra store, restart recovery, Mastra Cloud or hosted public approval suspension is claimed. The existing public proposal workflow remains separate. Its authorization and approval routes were not changed. [Constructor](../../../../server/approval-workflow.ts) · [Real-browser verifier](../../../../scripts/verify-mastra-approval.ts).

An earlier local attempt suspended and resumed but Chromium launch was denied by the macOS sandbox: five checks were blocked and one remained unverified. Its original files remain under `work/mastra-approval-local-20261016`; it is not counted as browser success. The verifier now requires five actual passed checks and five real PNGs before `verified`. The later authorized local run and this committed-source CI run satisfy that requirement. No old evidence was removed or rewritten.
