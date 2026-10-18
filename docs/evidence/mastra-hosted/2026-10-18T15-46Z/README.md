# Actual hosted Mastra agent — provider summary failure

Exact runtime source `2a610ef8221d22c3b817af0ee343c47008788b15`. This is the one-use continuation of the retained 15:34 source-save failure; the original successful Gemma proposal and native approval/Chromium are not replayed. The continuation uses a separate fresh rules-based real Chromium audit. All old sentinels remain unchanged.

Actual source: 2 passed, 3 failed, 0 blocked, 1 manual unverified, saved to Tiger. Native Mastra Agent selected `failure_history` and `search_visibility`; actual Tiger returned 3 rows, one SerpApi call returned 0 results. Selection Gemma call: HTTP 200, 524 input + 38 output = 562 tokens. Summary Gemma call: HTTP 500 INTERNAL, usage unavailable. The application returned HTTP 503 and marked the existing reservation consumed. No retries, refunds or replacement runs occurred.

`agent-failure.json` contains the actual model attempt metadata, tools and observations. There is no valid completed summary or validated summary citation set. No successful end-to-end Mastra agent result is claimed. Source browser results remain unchanged. Durable judge allowance is now 6/100 consumed, 94 remaining. Five PNGs and the HTML report are actual downloaded hosted browser artifacts.
