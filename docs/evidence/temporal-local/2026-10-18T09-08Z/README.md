# Local hosted-runtime preparation, October 18

**This is local evidence, not hosted Render evidence.** Gemma and both tool callbacks replay retained native receipts from October 16. Fresh model requests: **0**. Fresh search requests: **0**. Public judge reservations: **0**. Retained callback executions in each successful run: **2 model turns, 1 Tiger lookup, 1 search**. Reported model usage/latencies inside fixture outputs belong to the original October 16 responses, not October 18 inference.

The final [Node 22 verification](temporal-hosted-node22-3.json) starts the real public-demo app locally, the official Temporal CLI 1.9.1/server 1.32.0, matching SDK 1.24.0 and a real SDK worker. A controlled pre-dispatch failure causes one actual Temporal retry. After Tiger finishes, only the dedicated SDK Worker shuts down and is recreated. The workflow/run identities and completed activity event IDs remain unchanged; selection takes **2 attempts**, Tiger/search/summary **1 attempt each**, with no repeated callback.

[Before-worker-restart history](before-worker-restart.history.json), [completed history](completed.history.json) and the [runtime receipt](receipt.json) support that observation. The restart is graceful and controlled; it is not a crash recovery, web-process restart, SQLite host-loss recovery or fresh native provider proof.

After the child and CLI exit, real Chromium executes the broken sample. Its outcomes are **2 passed, 3 failed, 0 blocked, 1 unverified**. The five actual automated-check [screenshots](screenshots/) are retained. The local system Chromium binary was provided through the test environment's Playwright browser path; the Render Docker image still uses normal Playwright installation.

The final Node **22.23.3** run used parent heap **96 MiB**, child heap **64 MiB**, CLI `GOMEMLIMIT=64MiB` and `GOGC=20`. Recursive sampled memory peaks:

| Phase | PSS KiB | RSS KiB |
|---|---:|---:|
| Temporal workflow | 525,176 | 578,540 |
| Immediately after child exit | 221,025 | 224,064 |
| Later Chromium | 521,526 | 798,684 |

Overall PSS exceeds **512 MiB = 524,288 KiB**. These are local sampled process-tree values, not a Render cgroup measurement; kernel/file-cache charges are not proven bounded. **Hosted Temporal remains disabled; safe free-instance capacity is unverified.**

Earlier measured preparations remain beside the final receipt:

- [Initial configuration failure](temporal-hosted-local-1.json): the SDK rejected cached-workflows/poller settings before any workflow/provider execution. Fixed by disabling workflow caching.
- [Corrected standalone local recovery](temporal-hosted-local-2.json): verified fixture recovery; measured parent/direct-child RSS **436,792 KiB** only, not a complete web/browser measurement.
- [Early full-app run 1](temporal-hosted-fullapp-1.json) and [run 2](temporal-hosted-fullapp-2.json): lifecycle passed, but “completed six rows” was insufficient proof that Chromium executed. These receipts are superseded by observed pass/fail assertions in the later verifier; they must not be cited as successful Chromium evidence.
- [Isolated run 1](temporal-hosted-fullapp-isolated-1.json): lifecycle passed; its browser row-count caveat also applies.
- [Isolated run 2](temporal-hosted-fullapp-isolated-2.json): workflow only; **592,080 KiB RSS** after modest memory tuning.
- [Isolated Node 24 run 3](temporal-hosted-fullapp-isolated-3.json): actual Chromium observations; recursive peak **832,608 KiB RSS**, **561,632 KiB PSS**. Temporal PSS **561,632**, after child exit **243,437**, Chromium **555,873 KiB**.
- [Node 22 parent-128/child-96 run](temporal-hosted-node22-1.json): **534,697 KiB PSS**, **797,136 KiB RSS**.
- [Node 22 parent-96/child-96 run](temporal-hosted-node22-2.json): **553,316 KiB PSS**, **801,580 KiB RSS**.

[Manifest](manifest.json) identifies the base commit, dirty worktree and hashes of retained bytes. It intentionally does not claim an exact committed-source or CI verification. Raw worker logs and SQLite were not published. The implementation still requires exact-SHA CI and actual hosted verification before live claims.

## Final compiled entry measurement

The [compiled app plus compiled verifier](temporal-hosted-node22-compiled-2.json) uses native Node **22.23.3**, parent heap **96 MiB**, child heap **64 MiB**, and CLI `GOMEMLIMIT=64MiB` / `GOGC=20`, with no `tsx` runtime. Its local functional proof passed, and recursive sampled memory was:

| Phase | PSS KiB | RSS KiB |
|---|---:|---:|
| Temporal workflow | 482,457 | 535,968 |
| After child/CLI exit | 182,093 | 185,888 |
| Later actual Chromium | 491,322 | 768,256 |

Peak PSS was about **479.8 MiB**, roughly **32.2 MiB** below 512 MiB. This improves the earlier over-budget source-runtime measurements but does not prove Render cgroup/kernel/cache capacity or hosted success. The earlier [compiled app with a `tsx` verifier](temporal-hosted-node22-compiled-1.json) reached **540,956 KiB PSS**, and is retained for comparison.

The final compiled [before-restart history](compiled-before-worker-restart.history.json), [completed history](compiled-completed.history.json), [runtime receipt](compiled-receipt.json), and five real [Chromium screenshots](compiled-screenshots/) are retained separately. These still use retained provider callbacks, with zero fresh model/search requests or public grant reservations.
