# Tiger pgvector migration and real retrieval

[Successful receipt](receipt.json) · [Fresh hosted browser audit](source-audit.json) · [SQL and query vector](hybrid-query.json) · [Returned rows](hybrid-results.json) · [Independent cosine](independent-cosine.json) · [Migration](tiger-pgvector-migration.json) · [CI](https://github.com/himanshu748/flowproof-web/actions/runs/38931944743)

The existing dedicated no-card trial supports pgvector **0.8.7** and pgvectorscale **0.9.0**, now installed in `public`. All **24** old embeddings received stored generated `vector(384)` values, with old array bytes unchanged. The restricted role already had the necessary type/operator permissions; no grants or connection limits changed. A DiskANN index is valid and ready. The small full-candidate RRF query still uses exact rankings; no index-use or speedup claim is made.

A fresh approved synthetic Chromium audit ran through the deployed Free Render service at `2e0c7d690078657c3e501a0e71ed1494036fc9b1`, persisted to Tiger, and contributed three actual failed checks. The verifier then ran that exact revision's retrieval adapter locally against hosted Tiger using its restricted role. One parameterized SQL statement combines full-text ranking and pgvector cosine ranking with RRF. This is not a new hosted Gemma agent execution.

Query: **sideways panning on smartphones**. All lexical scores were **0**.

| Rank / failure | pgvector SQL cosine | Independently recomputed cosine | RRF |
|---|---:|---:|---:|
| 1 / mobile overflow | 0.378126416634895 | 0.3781263446933457 | 0.01639344262295082 |
| 2 / heading | 0.20973292618194006 | 0.2097328928898144 | 0.016129032258064516 |
| 3 / image alt | 0.023354533589156512 | 0.02335452966233193 | 0.015873015873015872 |

The order is unchanged from the [earlier array-based receipt](../../hosted-evidence-agent/2026-10-16T12-14-14Z/independent-cosine.json). Mobile's previous array dot product was **0.3781263417931506**; the new SQL score differs by **7.484174441296787e-8**. Independent JavaScript recomputation uses stored float32 vector values, both norms and the float32 query; the maximum SQL difference was **7.194154927336882e-8**. These are tiny numerical differences, not a measured retrieval-quality improvement.

The new browser audit remains **2 passed / 3 failed / 0 blocked / 1 unverified**. A different session returned no rows. Judge reservations remained **4 before / 4 after**, with zero model/search calls. Old audits, reservations and evidence were not changed. [Publication hashes](publication-manifest.json) identify all retained bytes.

[Attempt 1](attempt-1/receipt.json) genuinely returned the same three SQL rankings, then failed its independent reader with `too many connections for role "briefstamp_demo_runtime"`. It remains failed. The verifier fix closes its retrieval pool before the independent read and rapidly releases its earlier read connection; it does not increase the role's limit. The successful run is separate.

Limits: three fixed precomputed MiniLM queries and exact text embeddings; no arbitrary hosted embedding inference or quality/latency benchmark. Legacy arrays remain immutable compatibility input to the stored vector column. Tiger is credit-covered trial storage with October 20 access cutoff, not permanent Free. The [fresh billing check](funding.json) confirms positive existing credit and no payment method. Render hosting and all environment variables remained unchanged.
