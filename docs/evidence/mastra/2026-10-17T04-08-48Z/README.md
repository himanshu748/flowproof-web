# Real hosted Mastra Agent over Backboard/OpenRouter Gemma

**Verified October 17, 2026, 04:08:48–04:09:47 UTC** on the existing Free Render service, source `049d7b72725f5d11e3f548ba8aa76f8d823b239a`. This is a new, real protected provider run. The [earlier Google HTTP 500](../2026-10-17T03-42-59Z/) remains recorded; its reservation was not refunded.

Mastra's actual `Agent` selected and executed registered `failure_history` and `search_visibility` tools, then requested the second Gemma turn. Backboard routed `google/gemma-4-26b-a4b-it` through OpenRouter. The integration uses a validated text-JSON bridge to AI SDK tool calls, **not provider-native function calling**. The SDK's two steps, chosen tool arguments, observations, model output, exact citation IDs and provider identity are retained in [agent-run.json](agent-run.json).

| Actual hosted measurement | Result |
|---|---|
| Tool-selection request | HTTP 200 `COMPLETED`; **530 input / 34 output tokens**; **2,431 ms** |
| Summary request | HTTP 200 `COMPLETED`; **1,264 input / 753 output tokens**; **4,400 ms** |
| Total provider-reported usage | **1,794 input / 787 output / 2,581 total tokens** |
| Mastra tool calls | `failure_history` → `tool-1`; `search_visibility` → `tool-2`; both observed, once each |
| Tiger history | Three actual saved failures; pgvector/full-text RRF; mobile overflow first, cosine **0.378126416634895**, RRF **0.01639344262295082**, lexical score **0** |
| Search | The exact owned-homepage `site:flowproof-demo.onrender.com` query; HTTP 200; **zero matches** |
| Model citations | **Seven validated findings**: three current failed checks, the same three retrieved failures, one zero-result search snapshot |
| Browser outcome | **2 passed / 3 failed / 0 blocked / 1 unverified**, unchanged after the model |
| Storage | Independent strict-TLS Tiger readback matched the entire browser audit JSON |
| Public judge grant | **Four spent before and after; 96 of 100 remain. Zero judge slots consumed** |
| Private grant | One durable Tiger reservation; all four units and the $0.20 existing-credit reservation remain consumed without refund |
| Prior records | **75** private records unchanged; all previous Render environment values preserved |
| Main demo after the proof | [HTTP 200 for `/#demo` and `/health`](public-http.json); the in-app browser loaded the unapproved six-check review screen |

Durations cover the complete provider request/response handling, not isolated model compute. Token counts are the provider's returned fields, not estimates. [Full verifier receipt](receipt.json) · [Actual source audit](source-audit.json) · [Captured mobile browser screenshot](mobile-failure.png) · [Exact-source CI](ci.json) · [Deployment readback](deployment.json).

## What Mastra did

The first SDK step finished with two tool calls using the model-selected arguments: `failure_history({queryId: "mobile_paraphrase"})` and `search_visibility({})`. Mastra invoked both registered tools and supplied their typed observations to its second model step. That step returned the actual validated findings. The receipt preserves the real SDK `@mastra/core` version **1.77.0**, step usage and tool-call/result IDs. The native-Google `modelTurns` array is empty for this proof; the actual Backboard results are explicitly in **`backboardModelTurns`**.

The source audit is `e1f2c32f-33c4-4847-888d-4f3fad3d1263`. Its cited heading, image-alt and overflow checks are respectively `d04bc02b-dfa8-44ae-a185-c09ef8ddc106`, `434efa32-e662-4be1-89b7-c648b8101fbd` and `b2a1b02c-ef5f-412d-bb0c-42811b04cc4f`. The same IDs occur in the actual audit, retrieved rows and model findings. No assertion or approval can be changed by the agent.

Unapproved browser execution returned **409**. Tokenless agent access returned **404**; missing model consent returned **400**. Repeating the already reserved private run returned **409**, before another provider request. The verifier is an owner-instructed synthetic harness, **not customer acceptance**. The [existing process-local approval suspend/resume proof](../../mastra-approval/2026-10-16T17-33-15Z/) and its source are unchanged.

## Public route versus protected proof

The public route now selects **Mastra Agent over Google-hosted Gemma**, under its existing consent and confirmed-free allowance. Its first new hosted Google attempt failed; no successful anonymous Mastra run is claimed here. This separately authorized proof used **Backboard/OpenRouter** behind the protected operator route, with memory, provider tools, search and media generation disabled in both model messages. The only search was the model-selected server SerpApi tool. No Backboard memory retrieval or memory-grounded answer ran; that remains a separate task.

The older native engine remains a **deliberate configuration fallback**. There is no automatic engine/provider fallback, retry or grant refund after a failure. Each new proof operation was reserved before I/O, after confirming a globally UNIQUE Tiger tranche. [Spent configuration](spent-configuration.json). The public grant retains 100 total/six hourly/one session and the October 20, 2026 00:00 UTC cutoff.

## Existing credits, not a free-only model claim

The owner explicitly approved a new four-unit proof and **up to $0.20 of existing mixed Backboard credit**, after being told that its account also held paid credit. The [funding record](funding.json) preserves the actual observation timestamps; it does not refresh an old spent grant. No card, top-up, subscription, service, credential transfer or billing-setting change occurred. No provider-enforced per-request dollar cap is claimed.

The [account observations](account-observation.json) show free credit unchanged at **$4.97**, while paid credit moved from **$4.998257 to $4.997888**, a **$0.000369 account-wide decrease**. Auto-reload remained off and no payment method was configured. This is **not exclusive attribution, a final invoice or a general free-first rule**. It is not described as free-only inference. SerpApi remained on its **$0 Free Plan**, with zero extra credits and **210 searches remaining** after its one search.

## Verification boundaries

The exact source passed **1,241 app tests, 19 Python tests, build, real Chromium audits and both isolated Mastra replays** in [GitHub Actions](https://github.com/himanshu748/flowproof-web/actions/runs/39001093360). The [offline Backboard replay](offline-backboard-replay.json) uses retained Google outputs inside synthetic Backboard envelopes; it is explicitly distinct from the real provider run above.

This is one fixed synthetic audit and one owned-domain search. Retrieval uses the existing precomputed MiniLM catalog and exact query scope; empty search is not evidence of de-indexing or acceptance. A successful run is not an uptime or quality benchmark. Sentry browser/agent tracing and a Backboard memory-grounded answer were not added in this task. Existing Temporal, Tiger, SerpApi, Gemma, Tinker and Render proof folders were not edited.
