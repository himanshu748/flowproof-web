# Tinker application workflow smoke

This opt-in check exercises one current Tinker sampler through the application's actual generator and Mastra workflow, requires explicit synthetic test-harness approval, and runs the unchanged proposed heading assertion in Chromium against healthy and deliberately broken built-in samples. `--restore` also checks recovery. It is separate from the frozen baseline and LoRA quality benchmark and does not alter any benchmark receipts or metrics.

By default, `node --import tsx scripts/verify-tinker-workflow.ts` reports `not_run` with zero provider and browser calls. It does not configure credentials, confirm an allowance, create resources, train a model or download anything.

The [successful raw-completion receipt](evidence/tinker-workflow/2026-10-15T08-16-59-106Z/receipt.json) records one real Tinker request on October 15: HTTP 200, 205 prompt tokens and 50 completion tokens. The application returned the actual Tinker checkpoint as generator, rejected the unapproved assertion before entering the runner, then used explicit synthetic harness approval. Actual Chromium checks passed on the healthy sample, failed on the broken sample and passed again after restoration. The [regression/recovery comparison](evidence/tinker-workflow/2026-10-15T08-16-59-106Z/comparisons.json), screenshots and embedded-image HTML reports are linked by the [artifact manifest](evidence/tinker-workflow/2026-10-15T08-16-59-106Z/manifest.json). Browser summaries made zero model calls.

Three earlier, separately authorized chat-mode attempts were retained unchanged:

| Attempt                                                                                   | Observed provider result                                                                        | Application outcome                                                                                                      |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Initial contract](evidence/tinker-workflow/2026-10-15T08-01-16-227Z/receipt.json)        | HTTP 400; usage not reported                                                                    | Deterministic fallback rejected as Tinker evidence; no browser execution.                                                |
| [Corrected contract](evidence/tinker-workflow/2026-10-15T08-04-17-444Z/receipt.json)      | HTTP 200; 203 prompt and 1,924 completion tokens                                                | The model appended a period to the copied requirement. The then-strict source binding rejected it; no browser execution. |
| [Reviewed source binding](evidence/tinker-workflow/2026-10-15T08-08-38-000Z/receipt.json) | HTTP 200; 203 prompt and 2,048 completion tokens, `finishReason: "length"`, empty final content | The response reached the fixed output cap without a complete plan; no source normalization or browser execution.         |

The second request removed the optional `reasoning_effort` parameter. Before the third, the production adapter received a reviewed rule that accepts only one extra sentence period outside the closing quotation mark, then restores the original source verbatim. Assertion kind, expected literal, path and viewport stay unchanged. The verifier records `sourceCopyNormalizedCount` when an accepted complete plan reaches that stage. This is source-attribution normalization, not repair of test semantics or a change to benchmark scoring.

All three original receipts and manifests remain immutable. Their failures led to the separately budgeted `/completions` application proof with an explicitly rendered no-thinking prompt. A [preflight attempt](evidence/tinker-workflow/2026-10-15T08-15-50-199Z/receipt.json) made zero provider calls because the private allowance metadata did not satisfy its schema; correcting that metadata consumed no provider request. The successful raw-completion request used the same selected brief and checkpoint. Its `sourceCopyNormalizedCount` is 1: the extra outside-quote period was restored to the original source text, with all assertion fields unchanged. This is one application smoke, not evidence of a quality improvement. The original quality benchmark remains unchanged.

## Explicit run

After independently confirming included free credits and disabled paid overage, prepare the private credential-bound allowance described in [OPTIONAL_PROVIDERS.md](OPTIONAL_PROVIDERS.md). The adapter must be enabled with `BRIEFSTAMP_TINKER_ENABLED=true`, a current `TINKER_MODEL_PATH`, server-side `TINKER_API_KEY` and `BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE`. Keep these values in an ignored, private environment file. The checkpoint must match a completed v2 training receipt and remain within its recorded TTL, capped at 24 hours.

```sh
node --env-file=work/private-runtime.env --import tsx \
  scripts/verify-tinker-workflow.ts --run-provider \
  --training-receipt work/current-training.json --restore
```

The verifier allows exactly one network model request to the application's fixed Tinker `/completions` endpoint. The request contains the explicit Qwen3.5 Hugging Face chat template with thinking disabled, the original requirement payload, and the `<|im_end|>` stop marker; it does not rely on the provider's default chat renderer. Actual completion text is captured from `choices.text`. The native allowance guard reserves the full bounded token request before sending it. Failed requests consume that reservation; the verifier never retries. Browser summaries use observed results without further model calls. A deterministic fallback, malformed plan, expired checkpoint or unavailable service is retained as a failed or blocked attempt, never provider success.

## Evidence and limits

Each attempt writes a unique `work/tinker-workflow/<timestamp>/` directory, including failures. A successful attempt also publishes synthetic artifacts under `docs/evidence/tinker-workflow/<timestamp>/`, with a SHA-256 manifest. The three failed chat-mode attempts and zero-call preflight above were separately checked for private material and published unchanged for transparency. The verifier records only stages actually reached: request bodies without headers, selected actual response content and reported usage when available, generator and sampler identity, checkpoint expiry and source hashes. The successful run adds approval rejection with zero runner calls, the harness-approved plan, browser execution receipts, three screenshots, three HTML reports and regression/recovery comparisons. Those browser artifacts do not exist for the failed attempts.

Provider response IDs, account and organization fields, HTTP headers, private allowance evidence, environment files and credentials are excluded. A response hash links the selected fields to the observed provider response; the full provider envelope is not published. Missing token usage stays null. The smoke records the free-resource gate, not an independently measured billing charge.

The harness changes only approval flags. This is not human approval, customer acceptance, a new quality evaluation, or evidence of live Tinker inference on the public Render demo. The successful receipt proves the local application modules with a real remote Tinker request and real browser execution. Its temporary checkpoint expires on October 16 at 07:55:53 UTC; preserved evidence remains available after expiry, while future live calls require a current checkpoint and fresh confirmed-free allowance.
