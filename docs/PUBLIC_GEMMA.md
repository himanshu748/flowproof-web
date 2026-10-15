# Gemma proposals in the public sample workflow

**Stage: real provider and browser execution verified through the public router locally; the new Render deployment is pending verification.** The earlier verified deployment uses labelled deterministic initial drafts. Do not treat the candidate's local success as proof that its new button is already working on Render.

The product flow is: **the open model proposes, the developer reviews and approves, the deterministic browser records what happened.** Gemma cannot provide browser scripts or mark its own assertions passed. The model lab's saved Tinker evaluation is a separate experiment.

## Actual native API proof

On October 15 at 09:42 UTC, the public-router HTTP workflow made one real request to Google's native `generateContent` API using `gemma-4-26b-a4b-it`. HTTP 200 produced a validated plan for the fixed six-requirement synthetic Forma Studio brief. The response reported **335 input tokens, 300 output tokens and 7,937 ms** request latency. These are one-run observations, not a model-quality or latency benchmark.

The unchanged plan was approved by an **automated synthetic test harness**, not a person, and executed in real Chromium:

| Synthetic website | Passed | Failed | Blocked | Unverified |
|---|---:|---:|---:|---:|
| Healthy | 5 | 0 | 0 | 1 |
| Intentionally broken | 2 | 3 | 0 | 1 |
| Restored healthy | 5 | 0 | 0 | 1 |

The run retained 15 PNG screenshots, three portable HTML reports, raw provider response, unapproved proposal and per-audit JSON. The subjective requirement remained unverified. This establishes one working model-to-browser path on synthetic data, not correctness for arbitrary client briefs.

Reviewed public evidence: [execution receipt](evidence/public-gemma/2026-10-15T09-42-19Z/receipt.json), [sanitized provider response](evidence/public-gemma/2026-10-15T09-42-19Z/provider-response.json), and [unapproved proposal](evidence/public-gemma/2026-10-15T09-42-19Z/unapproved-proposal.json). The proposal contains only the fixed Forma Studio sample, and every check starts unapproved. The provider response identifier is omitted; the receipt records that redaction and the original response hash. Full local reports, PNGs and original artifacts remain at `work/public-gemma/2026-10-15T09-42-19.237Z/`; report hashes are retained in the public receipt. This is local public-router evidence, not a Render deployment receipt.

The [four earlier unsuccessful invocations](evidence/public-gemma/2026-10-15T09-42-19Z/earlier-failures.json) include two transport failures before any model call, and two attempted provider requests that did not produce an accepted plan. One of the latter returned HTTP 200 but failed validation. They are not counted as successful generations. Original logs remain in `outputs/public-gemma-local-smoke.log` and the individual `work/public-gemma/` directories.

## Free-use and privacy boundary

[Google's published pricing](https://ai.google.dev/gemini-api/docs/pricing?hl=en) lists Gemma 4 input/output as free and its paid tier as unavailable. The application checks that exact pricing section before generation and caches a successful check for at most one hour. It also requires an explicit free-use configuration with a bounded expiry. Missing or changed pricing fails closed before the model request.

Free-tier inputs may be used to improve Google's products. The UI requires consent, and the server accepts **only its original fixed synthetic brief** for this route. Edited visitor or private client text is rejected. The API key stays server-side. Each visitor receives at most two attempts; the process permits twelve attempts per hour, one generation at a time, and no simultaneous audit. Attempts are reserved before requests; there is no automatic retry or silent success fallback. These in-memory quotas reset on process restart and are not a durable distributed billing control.

The adapter bounds input size, response size, output tokens and duration. It permits six finite assertion kinds and validates the model's interpretation against the original requirements. Empty provider thinking markers and a complete JSON code fence may be removed as transport normalization; assertion fields are not invented or repaired. Invalid proposals leave the existing plan unchanged and report an error. Initial deterministic drafts remain explicitly labelled.

Sources: [native Gemma adapter](../server/providers/gemma-google.ts), [pricing verifier](../server/providers/gemma-free-pricing.ts), [public route and quotas](../server/demo.ts), [proposal validation](../server/generator.ts).

## Remaining hosted gates

- Verify the deployed source revision and make a fresh actual Gemma request through Render.
- Preserve the unapproved-plan rejection and healthy/broken/restored browser results from that hosted session.
- Link the sanitized release receipt and confirm the visible generator identifies the actual model/provider.
- Verify the new isolated Mastra workflow on that live provider path. Its local SDK fixture passed within approximately 169.93 MiB; this is not yet hosted or live-provider Mastra evidence.

The earlier [Ollama/Gemma 3 proof](GEMMA_WORKFLOW.md) remains separate: a three-requirement local workflow succeeded, while two full-brief attempts timed out. The new native Gemma 4 result does not retroactively change those failures.
