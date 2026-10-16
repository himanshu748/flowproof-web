# Partial hosted evidence-agent run

**Partial proof, not a successful search-integrated agent run.** The [outer verifier](receipt.json) failed its completion condition because SerpApi timed out. The [actual agent receipt](agent-run.json) is `completed_with_unavailable_tools`, preserving both native model outputs and the unavailable observation. Source: `9be66369f050a9b606d84987d7aed1a8a7e7a47d`. Verification ran October 16, 2026, **11:59:52.257 to 12:00:48.872 UTC** (**17:29:52.257 to 17:30:48.872 IST**).

## What actually ran

| Phase | Native HTTP attempts | Reported input tokens | Reported output tokens | Observed response |
| --- | ---: | ---: | ---: | --- |
| Tool selection | 1, HTTP 200 | 518 | 38 | Selected `failure_history` with `mobile_paraphrase`, and `search_visibility` with an empty argument object |
| Cited findings | 1, HTTP 200 | 1,205 | 763 | Cited three returned Tiger audit/check facts and explicitly marked search unavailable |

Both responses had exact whole `json` fences and empty thought parts, recorded in `transportNormalization`. Only those transport wrappers were removed; generated fields were not repaired. Request/response byte hashes, model version and actual usage are retained. No model retries occurred. This is a bounded native Gemma text-JSON loop, **not a Mastra Agent or provider-native function calling**.

Tiger returned three real saved failures from the same unchanged source audit through PostgreSQL full-text/cosine reciprocal-rank fusion. For the fixed paraphrase “sideways panning on smartphones,” all three lexical scores were zero; the mobile-overflow failure ranked first by cosine, **0.3781263417931506**, with RRF **0.01639344262295082**. The second model turn cited the actual returned audit/check IDs and statuses. These are fixed-catalogue PostgreSQL-array vectors, not pgvector, arbitrary embedding inference or a retrieval-quality benchmark. [Lexical-only empty control](lexical-control.json) · [Positive lexical control](lexical-positive-control.json).

The search callback was invoked **once** and timed out after **10,002 milliseconds**. There is **no completed search response** in this run. The actual upstream request/completion count is **unknown, not zero**; no transport telemetry was retained. An unavailable observation must not be presented as zero search results, de-indexing evidence or a successful SerpApi agent integration. The model correctly returned a `tool_unavailable` finding.

The [source Chromium audit](source-audit.json) recorded **2 passed, 3 failed, 0 blocked and 1 unverified**. [Actual mobile screenshot](observed-mobile-failure.png). Source audit equality and approval states remained unchanged. This is automated synthetic verification, not human acceptance or friend feedback.

## Consumed budget and history

The full **six-model-request / one-search** reservation is consumed without refund, although only two native model requests completed. [Spent-configuration readback](spent-reservations.json) retains the unknown search outcome, known per-phase usage, durable Tiger tranche count and preserved older reservations. No billing change or credential transfer occurred. A fresh timestamp or server restart is not permission to repeat this run.

Earlier [HTTP 500 / INTERNAL failure](../2026-10-16T11-44-46Z/README.md), [HTTP 200 / invalid-model-JSON failure](../2026-10-16T11-30-58Z/README.md) and [pre-provider failures](../pre-provider/README.md) remain separate history. Later timeout changes cannot retroactively make this search complete.

Original artifact bytes are unchanged. Six known secret values from the authorized private resilient-access file were checked against the seven copied artifacts and this documentation; none matched. This is a narrow known-value byte check, not a complete credential scan. The screenshot shows only the built-in synthetic sample.
