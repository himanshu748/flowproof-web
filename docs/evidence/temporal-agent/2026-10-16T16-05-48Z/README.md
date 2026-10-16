# Evidence-agent recovery in real Temporal CI

[CI run 38929162466](https://github.com/himanshu748/flowproof-web/actions/runs/38929162466) passed at source `70cc00119a7a22ffaadb073cee8cfff8a4751411`. [Receipt](receipt.json) and [publication hashes](publication-manifest.json) retain the unmodified CI JSON.

| Control | Actual event-history result |
|---|---|
| First Gemma selection receives an injected HTTP 500 | 2 attempts, 1 retry, then completion |
| Worker SIGKILL after Tiger completes | New worker resumes the same workflow/run; reservation, selection and Tiger keep completion event IDs 7, 13 and 19 |
| Search receives an injected pre-dispatch timeout | 2 attempts, 1 retry, then completion |
| Final Gemma summary | 1 attempt; source browser audit unchanged |
| Permanent HTTP 400 | FAILED after 1 selection attempt; no answer |
| Invalid summary citation | FAILED after 1 summary attempt; no answer |
| Persistent injected HTTP 500 | FAILED after 3 selection attempts; no answer |

Compare [before worker death](recovery-before-worker-kill.json) with [completed history](recovery-completed-history.json). The [ledger](recovery-ledger.json) holds one immutable logical fixture reservation, with phase attempts 2/1/2/1. No completed pre-kill activity was rescheduled. [Permanent](permanent-failed-history.json), [validation](validation-failed-history.json) and [exhausted](exhausted-failed-history.json) histories retain actual terminal failures.

Temporal compacts intermediate retries: counts come from `ActivityTaskStarted.attempt`, together with scheduled/completed event IDs, rather than counting worker log lines or only terminal failure events. See [Temporal event history](https://docs.temporal.io/encyclopedia/event-history).

This proves real workflow execution and recovery on a development server in CI. Model and tool responses replay the cited October 16 native receipt; historical usage is not new inference. New model calls: 0; new search calls: 0; public judge reservations: 0. No persistent worker is hosted on Render. Unknown external-call completion fails closed; exactly-once delivery to providers without native idempotency is not claimed. All earlier evidence remains unchanged. [Browser acceptance CI 38929162586](https://github.com/himanshu748/flowproof-web/actions/runs/38929162586) also passed at the same source: 1,020 app tests, 19 Python tests, build, public runtime and real Chromium audits.
