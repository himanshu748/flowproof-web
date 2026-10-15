# Live-site Gemma diagnosis and rerun

## What the original failure establishes

The [12:15 UTC native diagnostic](evidence/hosted-website/2026-10-15-gemma-incident/native-http-500.json) received **Google HTTP 500 before response parsing**. The earlier hosted route returned HTTP 503 for several classes of failure, so that status alone does not establish a provider error. The old adapter discarded the provider error body. Google's internal root cause cannot be recovered from that receipt.

The original owner-authorized homepage request is **1,928 UTF-8 bytes**, with six fixed public requirements. It uses `gemma-4-26b-a4b-it`, native `v1beta …:generateContent`, server-side `x-goog-api-key`, temperature 0, an 1,800-output-token cap and `thinkingLevel: "minimal"`. There is no private client prompt. [Google's Gemma API documentation](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) confirms the model and minimal/high thinking settings; native system instructions are supported. No bad API parameter or excessive input size has been demonstrated.

## Current checks

At **15:00 UTC on October 15**, the exact model metadata endpoint authenticated successfully (HTTP 200), advertising `generateContent`, a 262,144 input-token limit and a 32,768 output-token limit. This establishes current authentication/model access, not inference health. Briefstamp's existing Render service remains **Free**. Its explicit Gemma free-use gate expires October 20; its Sentry confirmation is dated October 15. The official free-only pricing check runs before inference and fails closed if its expected table changes. No billing settings were changed.

The [current preflight](evidence/gemma-rerun-preflight-2026-10-15/gemma_live_preflight.json) preserves these checks. The narrowly filtered Render log query for Gemma errors between 12:09 and 12:17 UTC returned no retained entries. We do not have Google's internal service logs or an account-wide rate-limit dashboard receipt. The saved 500 is not an observed 401/403 authentication rejection or 429 quota rejection; that does not prove a historical auth/quota issue was impossible.

A [new native diagnostic at 15:00 UTC](evidence/gemma-rerun-preflight-2026-10-15/gemma_native_rerun.json) passed the fresh pricing check but timed out after **30,003 ms** without a complete HTTP response. Its single 1,928-byte attempt has no HTTP status or reported token usage. Its outcome is unknown, so it was not automatically retried. This is a distinct failure from the earlier observed HTTP 500, not proof of a global outage.

## Bounded retry and receipt change

Only explicit HTTP **500, 502, 503 and 504** trigger retry: at most **three total attempts**, with 1-second then 2-second exponential backoff and an unchanged request/model. All fetches, response reads and backoff share one **30-second deadline**, inside the existing 45-second child-process deadline. Network failures, timeouts, HTTP 400/401/403/429, malformed successful responses and invalid plans are not retried. Mastra workflow retries remain disabled.

The server reserves all three possible physical calls before pricing or generation against its existing twelve-call hourly ceiling; unused/failed reservations are not refunded. Consequently no more than four generation requests can start per process per hour. The two-generation visitor limit, single model/browser lock, session ownership, stale-plan guard and explicit approval boundary remain in place.

Each attempt retains its number, HTTP status, request byte count, duration, retry delay, allowlisted Google status and validated reported token usage. Missing usage is **unknown**, never zero. Raw bodies, keys, headers, response IDs, thoughts and stacks are excluded. Typed failure details now survive the isolated Mastra process. Tiger's strict audit schema accepts the same bounded metadata so successful model provenance can round-trip with an audit.

No already-supported, confirmed-free alternate remote Gemma host exists in this repository. Local Ollama is a separate local integration and cannot serve as hosted proof. No new account, endpoint or paid fallback was silently substituted.

## Reproduced application contract issue

The [15:24 hosted attempt](evidence/hosted-website/2026-10-15T15-24-02Z/receipt.json) received HTTP 200 with **338 input / 306 output tokens**, then correctly rejected an invalid plan. A [native final-answer diagnostic](evidence/gemma-rerun-preflight-2026-10-15/viewport-contract-failure.json) reproduced the exact problem: the model put `"390px"` in `viewport`, whose only supported values are `"desktop"` and `"mobile"`. The old wording (“mobile means exactly 390px”) left room for that interpretation. This explains the new validation rejection, **not Google's historical HTTP 500**.

The prompt now explicitly requires the exact enum strings and forbids pixel widths in that field. Validation was not relaxed and model output is not repaired. The request increased to **2,153 bytes**. One [real post-change diagnostic](evidence/gemma-rerun-preflight-2026-10-15/viewport-contract-fixed.json) returned a valid six-check proposal on its first HTTP 200 attempt: **389 input / 296 output tokens**, including `"viewport":"mobile"`. This is a single contract check, not a quality benchmark. Both unsuccessful diagnostics remain visible.

The in-app browser also exposed an unbounded pending request. Ordinary API calls now abort locally after 55 seconds (bootstrap remains 65 seconds), release the controls and ask the operator to refresh saved state before retrying. Model writes and approvals are never automatically replayed; a lost response has an unknown server outcome.

## Rerun outcome

**Verified on the existing Free Render service**, source `2e3c3397`, live at 15:32:37 UTC. The [new hosted receipt](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json) records one actual Google Gemini API attempt using `gemma-4-26b-a4b-it`: HTTP 200, **389 input / 296 output tokens**, 2,153 request bytes. No retry was needed in this successful run; the three-attempt behavior is covered by offline tests.

| Approved plan | Passed | Failed | Blocked | Unverified |
|---|---:|---:|---:|---:|
| Original live-homepage assertions | 5 | 0 | 0 | 1 |
| Deliberately wrong heading expectation | 4 | 1 | 0 | 1 |

The verifier first received HTTP 409 for unapproved execution, then explicitly approved the model's executable assertions. Both completed audits matched their Tiger reads exactly; session-scoped lexical retrieval found the failed heading. Another visitor was denied access. Ten real PNGs and two embedded-image HTML reports are retained. Changing the expectation did not break or modify the website.

Sentry trace **`70ef2a9b80da4b60bd4bc104ed1ec823`** was independently verified in the authenticated Briefstamp dashboard at **16:32 UTC (22:02 IST)** on October 15: the proposal root and both generation/validation child spans were present. The [later verification sidecar](evidence/hosted-website/2026-10-15T15-37-09Z/sentry-verification.json) and [dashboard screenshot](evidence/hosted-website/2026-10-15T15-37-09Z/sentry-trace.jpg) establish ingestion. The original worker receipt retains `ingestionVerified: false`, reflecting what it could establish at execution. This verifies proposal tracing only; browser-audit tracing and error-event ingestion remain unverified. [Exact timings and earlier separate proof](SENTRY_HOSTED.md).

The [separate in-app browser flow](evidence/hosted-website/2026-10-15T15-37-09Z/in-app-receipt.json) also generated with Gemma, approved the checks, observed 5/0/1, confirmed the Tiger save and downloaded the report through the UI. These were agent verification actions, not human/customer acceptance.

The README's current-live-site template caveat has been removed because this new flow used Gemma end to end. The video still demonstrates its original labelled template workflow. Historical template receipts, timeout, invalid output and original 500 remain unchanged. The original upstream 500's internal cause remains unknown; the reproduced application issue was the distinct viewport contract mismatch.
