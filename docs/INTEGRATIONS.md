# Integration evidence ledger

This file distinguishes implemented local capability from hosted-provider and submission evidence. It is not a sponsor completion checklist. Only reproduce claims with the linked source and a retained execution receipt.

| Integration | Implemented capability | Evidence boundary |
|---|---|---|
| Playwright | Finite validated assertions, actual Chromium execution, screenshots and redacted observed text, healthy and intentionally broken synthetic pages | Run `npm run audit:sample`. Static fixtures are not real client validation. Browser runs against fixture pages are real browser execution, with synthetic targets clearly labelled. |
| Gemma through local Ollama | Optional schema-constrained proposal adapter, forced unapproved checks, optional grounded repair suggestions with fixed observed status counts | `FLOWPROOF_AI_ENABLED` / `FLOWPROOF_GEMMA_ENABLED` explicitly enable installed local models. A real local gemma3:4b single-requirement proposal and evidence-grounded suggestions were returned during development; receipts are in work/gemma-generation-receipt.json and work/gemma-summary-receipt.json. No accuracy benchmark or Tinker equivalence is implied. Fallbacks disclose the actual deterministic provider. |
| PostgreSQL | Projects, audit history and evidence persistence; lexical failure search | Local PostgreSQL is distinct from Tiger Data cloud. A configured connection is not proof of a working database until writes and reads are verified. |
| Tiger Data | PostgreSQL-compatible storage adapter can target a supplied cloud connection | No Tiger Data cloud connection or hosted retrieval has been verified. Do not claim this sponsor integration from a local database. |
| Failure vector retrieval | Optional local all-minilm:22m embeddings and real cosine retrieval combined with lexical search in PostgreSQL | Uses portable PostgreSQL arrays rather than requiring pgvector. Small-scale linear scan, not an indexed high-volume vector system. Requires actual persisted vectors and query execution; configuration alone is not evidence. |
| GitHub Actions | Workflow for real tests, browser audits, approved plan execution and evidence artifact upload | The workflow source exists. A successful remote workflow URL and run SHA are still required to claim Actions execution. |
| Render | Free-service deployment blueprint | No public Render deployment has been verified. Sleep limits and external durable PostgreSQL availability must be checked before claiming a reliable hosted service. |
| Tinker | Guarded training/evaluation commands, grouped candidate dataset, artifact-based model dashboard | No fine-tuning, baseline experiment, checkpoint or improvement recorded. All Qwen/Tinker metrics remain null. See MODEL_EVALUATION.md. |
| Mastra | Not implemented | Do not claim agent orchestration. The application uses ordinary TypeScript service functions. |
| Sentry | Not implemented | Do not claim tracing or provider observability. Local application logs are not a Sentry integration. |
| Temporal | Not implemented | Do not claim durable recovery. In-process audit handling is not a durable Temporal workflow. |
| Entire | No project-specific evidence captured | Do not claim development session evidence merely because an editor or assistant was used. |
| Backboard | Not implemented | Do not claim persistent sponsor memory or R-CLI use. |
| SerpApi | Not implemented | No search visibility analysis. |
| ElevenLabs | Not implemented | No spoken delivery report. |
| .tech domain | Not configured | No domain registration or sponsor claim. |

GitHub Copilot usage, customer invitations, DEV publishing, a public repository, public demo and submission receipts have not been established by this implementation. Those require their own real evidence. No invitations or external messages are sent as a side effect of local tests.

All default application paths run without paid API calls. Optional provider commands must respect the explicit zero-out-of-pocket constraint. Do not add a credit card, incur usage charges, or treat a suggested pricing model as an existing offer.
