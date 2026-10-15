# Gemma proposals in the public sample workflow

**Verified on the free Render service on October 15, 2026:** source `e43dbe7430368292ff9b225f4bf5e3236c2d03c0` generated a real Gemma proposal through a two-step Mastra workflow, rejected an unapproved audit, and executed healthy, broken and restored pages in Chromium. [Hosted receipt](evidence/hosted-open-model/2026-10-15T10-55-27Z/receipt.json) · [Deployment and CI](DEPLOYMENT.md).

The product flow is: **the open model proposes, the developer reviews and approves, the deterministic browser records what happened.** Gemma cannot provide browser scripts or mark assertions passed. The model lab's frozen Tinker evaluation and the later [protected hosted Tinker workflow](HOSTED_TINKER.md) are separate experiments.

## Latest live-homepage incident, October 15

Release `816d869e` exposes a second fixed brief for the owner-authorized homepage. Its actual network audit is [verified with deterministic checks](evidence/hosted-website/2026-10-15T12-19-58Z/receipt.json), with zero model calls. Hosted generation attempts returned [HTTP 503](evidence/hosted-website/2026-10-15-gemma-incident/hosted-attempt-503.json); a bounded native diagnostic at 12:15 UTC confirmed [Google HTTP 500 before parsing](evidence/hosted-website/2026-10-15-gemma-incident/native-http-500.json). No new live-site AI success is claimed. The UI retained its explicitly labelled draft; this is not a hidden AI fallback. The successful 10:55 synthetic evidence below remains dated historical proof. [Judge guide](JUDGE_GUIDE.md).

## Earlier actual hosted provider and browser proof, 10:55 UTC

The verifier made one real request to Google's native `generateContent` API using `gemma-4-26b-a4b-it`. The validated response reported **335 input tokens, 300 output tokens and a 7.502-second provider/validation call**. Sentry observed the whole proposal root at **22.09 seconds**, including startup; these durations measure different scopes. Mastra executed `generate-google-gemma` and `validate-indexed-proposal` in an isolated child process, whose observed maximum resident memory was **175.07 MiB**. These are one-run observations, not a quality or latency benchmark.

The [proposal](evidence/hosted-open-model/2026-10-15T10-55-27Z/generated-project.json) began unapproved. The server returned **HTTP 409** when the verifier tried to run it. An automated verifier then approved its unchanged executable checks; this was **agent approval of synthetic test data, not human acceptance**.

| Synthetic website | Passed | Failed | Blocked | Unverified |
|---|---:|---:|---:|---:|
| [Healthy](evidence/hosted-open-model/2026-10-15T10-55-27Z/healthy-audit.json) | 5 | 0 | 0 | 1 |
| [Intentionally broken](evidence/hosted-open-model/2026-10-15T10-55-27Z/broken-audit.json) | 2 | 3 | 0 | 1 |
| [Restored healthy](evidence/hosted-open-model/2026-10-15T10-55-27Z/restored-audit.json) | 5 | 0 | 0 | 1 |

Fifteen actual screenshots and three portable reports with embedded screenshots were downloaded. Their originals remain private; the public receipt retains sizes and hashes alongside synthetic audit JSON. The subjective requirement stayed unverified. Cross-visitor project, audit and report requests returned 404. This proves one hosted model-to-browser path on fixed synthetic data, not arbitrary client-brief correctness.

The same hosted proposal produced a [Sentry trace verified in its dashboard](SENTRY_HOSTED.md): root `briefstamp.proposal` and its generation/validation children. The earlier [25efaeef hosted run](evidence/hosted-open-model/2026-10-15T10-04-04Z/receipt.json) remains intact, including its separate protected Backboard proof; the newer run did not repeat those memory calls.

## Free-use and privacy boundary

Opening `#demo` enters the Review screen and exposes the Gemma action without making a model request. Initial drafts remain explicitly labelled rules. The visitor must consent and request generation.

[Google's published pricing](https://ai.google.dev/gemini-api/docs/pricing?hl=en) lists Gemma 4 input/output as free and its paid tier as unavailable. The application verifies that pricing section before generation, caching a successful check for at most one hour. Its explicit free-use configuration expires on **October 20, 2026** and requires a fresh operator check before extension. Missing, expired or changed pricing fails closed before a model request.

Free-tier inputs may be used to improve Google's products. The server accepts **only its original fixed synthetic brief or the fixed owner-authorized homepage brief**; edited visitor or private client text is rejected. The key stays server-side. Limits are two attempts per visitor, twelve per hour per process, one generation at a time and no simultaneous audit. Attempts are reserved before I/O; there is no automatic retry or silent success fallback. These quotas reset on process restart and are not durable distributed billing controls.

The adapter bounds sizes, output tokens and duration and permits six finite assertion kinds. Invalid schemas and unsupported quoted-text interpretations are rejected. The model chooses the assertion kinds and quoted literals; source paths, viewport and non-text descriptions are bound by the server to the actual finite predicate. Transport normalization may remove empty thinking markers or a complete JSON fence. Fixed image/viewport descriptions were verified in this deployed release; model-chosen kinds and quoted literals remain visible. The separate frozen Tinker benchmark is unchanged.

Sources: [native adapter](../server/providers/gemma-google.ts), [pricing verifier](../server/providers/gemma-free-pricing.ts), [public route and quotas](../server/demo.ts), [proposal validation](../server/generator.ts). Protected Backboard memory has [separate operator-only evidence and exhausted proof limits](BACKBOARD_VERIFICATION.md); it is not an anonymous public memory service.

## Earlier results remain visible

Before deployment, the [local public-router proof](evidence/public-gemma/2026-10-15T09-42-19Z/receipt.json) made one native request: 335 input / 300 output tokens, 7.937 seconds, and the same three browser outcomes. Its [sanitized response](evidence/public-gemma/2026-10-15T09-42-19Z/provider-response.json) and [unapproved proposal](evidence/public-gemma/2026-10-15T09-42-19Z/unapproved-proposal.json) are public. The response identifier was removed, with the original hash and redaction recorded. Full local artifacts remain in `work/public-gemma/2026-10-15T09-42-19.237Z/`.

[Four earlier unsuccessful native invocations](evidence/public-gemma/2026-10-15T09-42-19Z/earlier-failures.json) are retained: two transport failures before a model call and two provider attempts without an accepted plan, including one HTTP 200 response rejected by validation. They are not successful generations. Original logs remain in `outputs/public-gemma-local-smoke.log`.

The earlier [Ollama/Gemma 3 proof](GEMMA_WORKFLOW.md) is separate: three requirements succeeded while two full-brief attempts timed out. Later success does not erase these failures. Hosted Sentry proposal ingestion is now [independently verified](SENTRY_HOSTED.md). The later `2a8eae95` release independently verified [protected hosted Tinker](HOSTED_TINKER.md), [Tiger persistence/lexical retrieval](TIGER_VERIFICATION.md) and [Temporal hosted CI recovery](TEMPORAL.md). Those later receipts do not rerun or replace this Gemma/Sentry proof.
