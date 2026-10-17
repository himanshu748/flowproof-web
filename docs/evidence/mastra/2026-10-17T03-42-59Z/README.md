# Mastra Agent: deployed implementation, unsuccessful hosted provider attempt

**Status: hosted end-to-end proof remains incomplete.** On October 17 the existing Free Render service ran source `1e7db19416886e11a8ca488f35190ea3749cc9c3`. The public route now selects a real `@mastra/core` Agent. Its first protected proof request reached Google-hosted `gemma-4-26b-a4b-it`, which returned **HTTP 500 `INTERNAL`**. No tool selection, tool execution, second model turn or generated answer completed.

| Actual hosted observation | Result | Receipt |
|---|---|---|
| Approved Chromium audit | 2 passed / 3 failed / 0 blocked / 1 unverified | [Source audit](source-audit.json) |
| First model request | HTTP 500; 1,005 ms provider request; 1,866 request bytes | [Failed model receipt](agent-run.json) |
| Model usage | Unknown: the error response supplied no token counts | [Exact HTTP error envelope](unexpected-response.json) |
| Completed model-selected tools / cited findings | 0 / 0 | [Failed receipt](agent-run.json) |
| Private allowance | Four units reserved; one model request attempted; entire reservation remains spent | [Run receipt](receipt.json) · [Spent configuration readback](spent-configuration.json) |
| Public judge grant | Four spent before and after; 96 of 100 remain | [Read-only hosted status](public-status.json) |
| Old reservations and configuration | 52 old files unchanged; previous Render settings preserved | [Spent configuration](spent-configuration.json) · [Deployment](deployment.json) |
| Source CI | 1,119 app tests, 19 Python tests, build, runtime and Chromium checks passed | [CI receipt](ci.json) · [Run](https://github.com/himanshu748/flowproof-web/actions/runs/38999360120) |

The original verifier stopped on the route's HTTP 503. A follow-up independently matched the Tiger audit payload, counted one durable private reservation and four public reservations, then failed its status check because it omitted a visitor cookie. A second direct database check timed out. A separate normal visitor bootstrap/status request succeeded and reported `engine: mastra_agent`, 96 remaining runs and zero new provider calls. These verifier failures are retained in [post-failure checks](post-failure-checks.json); they are not presented as a completed end-to-end proof.

## What is implemented and what was actually exercised

The isolated Mastra Agent registers `failure_history` and `search_visibility` using real SDK tools. A narrow bridge translates validated Gemma text JSON into AI SDK tool calls; Mastra executes the chosen tools and requests the next model turn. This is **not provider-native function calling**. Credentials stay in the parent process. Citations are validated against returned facts, and browser acceptance results cannot be changed by the agent.

The [recorded replay](recorded-replay.json) exercised the actual isolated Mastra SDK, both tools and the second turn with retained October 16 provider/tool responses and **zero external calls**. Its model usage, search result and retrieval scores are historical fixture data, not new October 17 inference or retrieval results. CI repeats that replay. The [existing approval suspend/resume proof](../../mastra-approval/2026-10-16T17-33-15Z/) is preserved unchanged; durable hosted approval is not claimed.

The [public status response](public-status.json) and deployed configuration select `mastra_agent`. The older native loop remains available only through a deliberate configuration rollback; there is **no automatic fallback after a failed request**. Changing orchestration does not replenish its 100-total/six-hourly/one-session allowance or October 20 cutoff.

## Funding and Backboard alternative inspection

Before activation, read-only checks confirmed Google free-only Gemma pricing and an Active SerpApi Free Plan with 211 searches remaining, zero monthly price and zero extra credits. No inference/search was used by those checks. [Funding](funding.json) · [Official pricing observation](gemma-free-pricing.json).

After the failure, the owner asked about using Backboard for Gemma. The [account read](backboard-preflight.json) found $4.97 free credit, $4.998257 paid credit, auto-reload off and no payment method. An unqualified exact-name lookup returned 404 and the [Google catalog](backboard-google-catalog.json) contained no Gemma entries. The [OpenRouter catalog](backboard-openrouter-catalog.json) did list `google/gemma-4-26b-a4b-it`, with input/output rates of $0.0765/$0.255 per million tokens. These are catalog/account observations, **not a Backboard model result or a guarantee that inference would debit only free credit**. No thread, assistant, memory or inference request was made. Another live proof requires a separately approved reservation; this spent proof cannot be renewed or reset.

The provider's internal reason for the HTTP 500 remains unknown. No cause, successful answer, token count or hosted tool result has been invented. Existing Temporal, Tiger, SerpApi, Gemma and Tinker evidence remains unchanged.
