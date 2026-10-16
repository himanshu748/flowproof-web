# Hosted evidence agent — verified

On October 16, 2026, the existing Free Render service ran a native Google-hosted Gemma text-JSON tool loop against an approved, completed synthetic audit. [Full verifier receipt](receipt.json) · [Actual model turns and tools](agent-run.json).

1. Real Chromium recorded **2 passed / 3 failed / 1 unverified**. Tiger saved and returned the same [source audit](source-audit.json).
2. Gemma selected `failure_history(mobile_paraphrase)` and `search_visibility({})`. Selection used **517 input / 38 output tokens**, HTTP 200.
3. Tiger's scoped SQL combined full-text ranking and cosine ranking with RRF. It returned three saved failures; mobile overflow ranked first, cosine **0.3781263417931506**. The paraphrase had zero lexical matches; `horizontal` separately matched the mobile failure. [Independent cosine calculation](independent-cosine.json) · [Zero-match control](lexical-control.json) · [Positive control](lexical-positive-control.json).
4. SerpApi returned **HTTP 200** for the fixed owned domain, with **zero results**. Its transport took **379 ms**. This is a search observation, not evidence of de-indexing, ranking or acceptance; uncached freshness is not established. [Actual result](serpapi-search.json) · [Transport metadata](serpapi-transport.json).
5. A second actual Gemma turn consumed both observations and cited three returned failures plus `search_snapshot: resultCount 0`. It used **1,242 input / 735 output tokens**, HTTP 200. Both turns removed an exact whole JSON fence; no generated fields were repaired. No retry was needed in this run.

The verifier confirmed that the audit remained unchanged. Duplicate execution returned **409**, cross-visitor and tokenless requests **404**, and missing consent **400**. Approval was by an automated synthetic verifier, not a customer.

The run used source [`f990d9a`](https://github.com/himanshu748/flowproof-web/commit/f990d9a14ae95dc322e4d81a411e9dd764ff9207), whose [CI passed 871 app tests, 19 Python tests, build and real Chromium audits](https://github.com/himanshu748/flowproof-web/actions/runs/38898518897). The verifier's own SHA-256 is recorded in `receipt.json`. [Artifact hashes](manifest.json).

The embeddings are genuine precomputed **384-dimensional `all-minilm:22m`** vectors for exact source texts and three fixed queries. Storage uses PostgreSQL arrays, **not pgvector**; this does not establish hosted embedding inference, arbitrary-query support or retrieval quality at scale. Tiger is a credit-covered, no-card metered trial with strict TLS and an October 20 application cutoff. The native evidence loop is separate from the existing Mastra proposal workflow.

All four allowance UUIDs were independently confirmed in Tiger and carried forward as spent in Render. Across them, **12 model requests and four agent searches were reserved; six model HTTP attempts actually occurred**. One earlier HTTP 500 omitted usage, and the earlier timed-out search's upstream completion is unknown. No unused reservation was refunded. The older standalone search allowance remains separately spent. [Spent readback](spent-reservations.json) · [Funding and cumulative boundaries](../../agent-allowance/2026-10-16/README.md).

Earlier failures remain history: [invalid JSON](../2026-10-16T11-30-58Z/README.md), [HTTP 500](../2026-10-16T11-44-46Z/README.md), and [Tiger success with a search timeout](../2026-10-16T11-59-52Z/README.md).
