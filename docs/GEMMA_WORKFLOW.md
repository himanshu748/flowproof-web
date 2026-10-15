# Local Gemma workflow evidence

Briefstamp can use an installed Gemma model to propose finite acceptance checks and offer suggestions grounded in observed results. The public Render demo does not run a model. This document records an explicitly opted-in local experiment, separate from the Tinker evaluation and from customer validation.

## Reproduce without a model provider

Prerequisites: Node.js, the repository dependencies, Playwright Chromium, and an already-installed `gemma3:4b` model served by Ollama at `http://127.0.0.1:11434`. Installations are separate actions: the experiment never downloads a model or browser and never provisions infrastructure.

```sh
node --import tsx scripts/verify-gemma-workflow.ts --run-local-model
```

Omitting `--run-local-model` exits before model access. The experiment restricts application fetches to that fixed loopback address and permits at most two chat calls per invocation: one proposal and one optional explanation. It creates a unique run directory and retains failed attempts. An invocation never retries generation or selects among responses. It unsets `DATABASE_URL`, uses its own evidence directory, and never initializes or modifies the application's saved projects.

The workflow calls the actual application functions:

1. Record the installed model digest, quantization and Ollama version, plus source-file hashes.
2. Pass all six original lines of `SAMPLE_BRIEF` to `generateChecks` once. Preserve the raw model response and the application's normalized, unapproved proposal separately. A deterministic fallback makes the experiment fail.
3. Demonstrate that the real runner rejects the unapproved executable checks.
4. Approve the unchanged assertions through this explicitly opted-in **test harness**. This is not human approval, dataset validation or client acceptance.
5. Run real Chromium against the healthy, deliberately broken, then restored synthetic website using the same assertion semantics.
6. Call `summarizeAudit` on the broken result once. Preserve its response and verify it cannot change the recorded results.
7. Save each immutable audit, actual screenshots, portable HTML report and comparison, with a SHA-256 file manifest.

The browser uses the built-in fictional Forma Studio pages. It does not visit a client website or submit forms. Only the generated assertions are measured; unsupported or subjective requirements remain unverified. Restoring the fixture proves recovery only for assertions that actually ran.

## Recorded attempts

- The first invocation was blocked by the local execution sandbox before any model request. Its [failure receipt](evidence/gemma-workflow/2026-10-15T05-48-32-488Z/receipt.json) records **zero model calls**.
- The first real full-brief invocation exceeded the application's unchanged 60-second model deadline and returned a clearly labelled deterministic fallback. Its [failure receipt](evidence/gemma-workflow/2026-10-15T05-50-26-106Z/receipt.json) and [fallback proposal](evidence/gemma-workflow/2026-10-15T05-50-26-106Z/proposal-before-approval.json) are retained. One chat request was attempted; no complete model response or usage counts were received. No checks were approved or audited by that invocation.
- A single rerun of the exact same brief, model, prompt, options and 60-second application deadline, after concurrent browser tests stopped, also timed out. Its [receipt](evidence/gemma-workflow/2026-10-15T05-52-59-736Z/receipt.json) records `TimeoutError` after 60,134 ms and null token counts. This was an operational timeout retry, not selection of a better model answer. The harness now records the outbound request before awaiting a response so a timeout retains more diagnostic evidence.

**The full six-requirement Gemma workflow has not been demonstrated by these attempts.** Their deterministic fallback plans are not represented as AI output.

A separate diagnostic mode uses three supported predicates (the heading, visible positioning text and a visible link label). It deliberately excludes destination behavior, image meaning, mobile overflow and visual tone. It is not a replacement result for the original full brief:

```sh
node --import tsx scripts/verify-gemma-workflow.ts --run-local-model --supported-brief
```

## Observed narrower workflow

The separate three-requirement invocation **passed on October 15, 2026**. Its [receipt](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/receipt.json), [raw generation response](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/generation-raw-response.json), [unapproved plan](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/proposal-before-approval.json), [comparisons](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/comparisons.json) and [file hashes](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/manifest.json) are preserved alongside every failure above.

The installed model was `gemma3:4b`, 4.3B parameters, GGUF `Q4_K_M`, served by Ollama 0.31.1. Its installed artifact digest was `a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a`. The application reported **Ollama (local)**, not a parser fallback. The unapproved plan was rejected before Chromium execution. The test harness then changed only the approval flags.

| Assertion | Healthy | Intentionally broken | Restored |
|---|---|---|---|
| Exact homepage heading | Passed | Failed | Passed |
| Visible positioning text | Passed | Passed | Passed |
| Visible “Start a project” link label | Passed | Passed | Passed |

This establishes **one observed regression and one observed recovery with unchanged assertions**. The label check correctly continues to pass when the link's destination is broken: destination behavior was not asserted. The narrow run does not test alternative-text meaning, mobile overflow, subjective tone or the original destination requirement.

All nine executed assertions have actual Chromium screenshots. The [healthy report](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/healthy-report.html), [broken report](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/broken-report.html) and [restored report](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/recovered-report.html) embed their images and preserve the source brief and generator context. The model's [actual explanation response](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/explanation-raw-response.json) suggested checking the missing heading. The harness verified that this commentary did not change any result or evidence.

| Local call | Measured response time | Reported prompt tokens | Reported completion tokens |
|---|---:|---:|---:|
| Three-requirement generation | 24,607 ms | 283 | 159 |
| Grounded explanation | 20,967 ms | 196 | 86 |

These are the first complete responses for this narrower brief, with no response selection. Across the documented sequence there were four attempted chat calls: two full-brief timeouts, one narrower proposal and one explanation. The separate sandbox failure made zero chat calls. No remote provider or paid resource was used. Tokens from timed-out calls are unknown and are not counted as zero.

## Interpretation limits

This is one synthetic brief, not a model-quality benchmark. The application deliberately applies deterministic safety and scope guards after the model response. Some feasible browser checks may therefore be conservatively declined. Compare the raw model output with the normalized plan before attributing an interpretation to Gemma.

Reported prompt and completion token counts come from Ollama's actual `prompt_eval_count` and `eval_count` fields; missing fields remain null. Wall-clock timings are measured locally. There is no remote inference charge, but these timings are not representative latency estimates for other hardware or a hosted product.

Nothing here establishes human review, real customer acceptance, a Tinker improvement, hosted Gemma inference, or complete coverage of the original brief.
