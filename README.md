# Briefstamp

Previously FlowProof. The existing repository, demo URL and storage identifiers are retained for compatibility.

Turn website requirements into approved browser checks and evidence-backed delivery reports. **An open model proposes, the developer approves, and the browser records what happened.**

[Live demo](https://flowproof-demo.onrender.com) · [Browser acceptance workflow](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Evidence and limitations](docs/DEPLOYMENT.md)

The landing page introduces the workflow with original conceptual artwork and a labelled interactive sample. Choose **Open demo** to enter the real workspace. For a short review path, see [the entry evidence guide](docs/HACKATHON_ENTRY.md). See the [requirement-by-requirement PRD status](docs/PRD_STATUS.md) for completed capabilities and remaining gaps.

Briefstamp includes a local working product and an isolated public-demo mode. It includes a React delivery cockpit, safe typed acceptance checks, a real Playwright runner, screenshot and redacted text evidence, standalone HTML reports, PostgreSQL persistence, failure retrieval, and a GitHub Actions workflow. Integration readiness and measured model results are shown honestly in the app. Audits capture the original brief, target and generator at run time. Incomplete exports retain every planned requirement and disclose missing evidence.

**Verified hosted release:** `25efaeef` is live on the existing Free Render service. One real native Gemma request ran through two Mastra workflow steps: 335 input / 300 output tokens, 7.893 seconds, 149.18 MiB child maximum RSS. Unapproved execution returned 409; after verifier approval, real Chromium observed healthy **5 passed / 1 unverified** → broken **2 passed / 3 failed / 1 unverified** → restored **5 passed / 1 unverified**. This is synthetic agent verification, not human validation. Protected Backboard write/retrieval also succeeded; its two-call allowance is exhausted. [Hosted receipt](docs/evidence/hosted-open-model/2026-10-15T10-04-04Z/receipt.json) · [Gemma scope and retained failures](docs/PUBLIC_GEMMA.md).

Real Tinker baseline and LoRA runs used confirmed promotional credits. On the same 24-example holdout, LoRA used **69.55% fewer input tokens**, implying **55.52% lower inference-only cost** at recorded uncached rates. Reference matches fell from **23/24 to 22/24**, browser correctness from **19/20 to 18/20**, and latency increased. Training plus one-day storage would amortize after 87 comparable requests; that projection was not executed and no net saving was demonstrated at 24 requests. The 96-example synthetic pilot has **zero human-validated examples**. [Exact calculations and raw results](docs/MODEL_RESULTS.md).

A real strict-TLS trial probe verified two projects/audits, ten recovered screenshots and lexical/vector retrieval, then removed its temporary schema. A later user-approved isolated hosted schema/role attempt stopped **before DDL** because inherited PUBLIC metadata privileges failed the isolation preflight; no role, schema or Render database credential was created. The separate dedicated-service CA remains unverified, with certificate/hostname checks enabled. **Public-demo Tiger persistence is still disabled.** [Tiger proof](docs/TIGER_VERIFICATION.md) · [Current deployment gates](docs/DEPLOYMENT.md).

![Briefstamp compares a broken audit with a restored synthetic website](docs/evidence/acceptance-comparison.jpg)

Actual local UI after three browser audits. The public brief plan shows three recoveries; the separate CI fixture plan asserts four regressions and recoveries.

## Run locally, no paid account required

```sh
npm ci --legacy-peer-deps
npx playwright install chromium
npm run dev
```

Open http://127.0.0.1:5173. The server listens only on loopback by default. With no configuration, data persists to `data/state.json`. The sample site is served through browser routing and makes no network requests.

1. Choose **Open demo**, then open the Forma Studio sample.
2. Review the proposed checks. Edit any interpretation and approve the checks.
3. Run the audit and inspect the actual screenshots and observed text.
4. Switch the sample to the broken version, reapprove and run again.
5. Switch back to healthy, reapprove and rerun. **What changed?** compares the same assertions across audits. Changed expectations, manual judgments and missing results cannot count as a fix.
6. Download a portable HTML report with embedded screenshots. Use the browser print dialog for PDF.

The welcoming/trustworthy requirement is intentionally unverified, because a deterministic browser assertion cannot establish it.

## Verification

```sh
npm run verify
npm run audit:plan -- briefstamp-plan.json
```

`audit:sample` executes healthy, broken and restored-healthy sample states in Chromium with the same approved fixture plan. It requires four regressions and four recoveries, while the subjective requirement stays unverified. Each run exports JSON, screenshots and a standalone HTML report; CI also writes a readable job summary. Unit tests exercise schema and network guards. A saved approved plan can run in GitHub Actions. CI stores screenshots and audit JSON as artifacts. Current remote execution evidence is tracked in [deployment evidence](docs/DEPLOYMENT.md).

## Optional configuration

Copy `.env.example` to `.env`. Keep it private. The app loads `.env` through Node's environment loader.

- **PostgreSQL:** set `DATABASE_URL`. TLS certificate verification is enabled; only trusted local PostgreSQL should set `DATABASE_SSL=false`. The app creates dedicated `flowproof_*` tables. It is a single-process MVP: run one replica. Audit evidence is persisted as database byte arrays after a completed run, so downloaded reports can survive an ephemeral host restart. The separate Shared Free Tiger service fails strict certificate verification; its direct adapter remains blocked. The successful no-card trial probe was isolated and temporary. Do not disable verification or upgrade to bypass the Shared Free limitation.
- **Local open model:** run Ollama with a supported completion model, set `FLOWPROOF_AI_ENABLED=true`, `FLOWPROOF_OLLAMA_MODEL=gemma3:4b` (or your installed Qwen model). Every plan records its actual provider. Invalid responses fall back to an explicitly labeled conservative rule parser. There is no default remote AI billing path. A real three-requirement Gemma workflow produced a failed heading and then recovery, with nine screenshots and grounded commentary; two full-brief attempts timed out. See [Gemma evidence](docs/GEMMA_WORKFLOW.md) and reproduce with `node --import tsx scripts/verify-gemma-workflow.ts --run-local-model --supported-brief`.
- **Failure vectors:** with PostgreSQL and local `all-minilm:22m`, set `FLOWPROOF_EMBEDDINGS=true`. Failure descriptions are embedded locally and searched using actual cosine similarity plus lexical ranking in PostgreSQL. The portable array implementation uses a full scan appropriate to a small demo. It does not claim pgvector acceleration.
- **Tinker:** see [measured results](docs/MODEL_RESULTS.md) and [reproduction instructions](docs/MODEL_EVALUATION.md). Recorded baseline, training and paired-browser receipts are bundled. New provider work requires independently confirmed free credits and shared token/cost budgets. A [real one-heading operator workflow](docs/TINKER_WORKFLOW.md) passed the approval boundary and healthy/broken/restored browser checks through a fresh Tinker sampler. It uses a verified no-thinking Qwen template at the raw endpoint; the earlier rejected chat-mode attempts remain recorded. This is separate from the quality benchmark. The public demo never calls Tinker.

- **Native Gemma sample proposals:** the hosted, consented action uses `gemma-4-26b-a4b-it` only for the fixed synthetic brief. It checks current free-only pricing, applies quotas and preserves unapproved checks. Edited visitor/client text is rejected. Free-use confirmation expires October 20, 2026; the pricing result is cached for at most one hour. [Configuration boundary and actual hosted evidence](docs/PUBLIC_GEMMA.md).
- **Mastra and Sentry:** the verified hosted Gemma proposal uses two real isolated Mastra steps (149.18 MiB child maximum RSS; compiled CI workflow 174.54 MiB). Browser checks remain deterministic; no autonomous agent or durable Mastra store is claimed. Sentry now has a separate configured Briefstamp project under a verified sponsored entitlement with paid overage disabled. Child-only tracing has local SDK evidence, but the new release and a trace visible in Sentry remain pending. [Evidence boundaries](docs/DEPLOYMENT.md).
- **Temporal:** opt-in local durable audits passed real retry and server/worker restart checks; [setup and proof](docs/TEMPORAL.md). No paid cloud worker is required or claimed.
- **Backboard:** one protected hosted write/search retrieved all six synthetic audit statuses unchanged. The immediate observed deduction was $0.01 from free credits, paid balance unchanged; the earlier local proof spent a separate observed $0.01. Operator token and visitor ownership are mandatory. The hosted two-operation allowance is exhausted and its account proof expires within 24 hours. [Receipt and existing-credit boundary](docs/BACKBOARD_VERIFICATION.md).
- **Other providers:** [SerpApi’s real Free-plan search](docs/evidence/serpapi/2026-10-15T07-38-38-984Z/receipt.json) and [Entire’s scoped local import/readback](docs/ENTIRE.md) have receipts. ElevenLabs synthetic narration remains unverified. See the [current integration ledger](docs/INTEGRATIONS.md).

## Hosting and operating boundaries

`render.yaml` and `Dockerfile` define a **free** Render web service with Chromium and its Linux dependencies. No database, paid worker, persistent disk or model API is required. Deployment evidence is tracked in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Public demo:** `FLOWPROOF_PUBLIC=true` and `FLOWPROOF_DEMO=true` enable isolated visitor sessions. Only the synthetic sample can be audited. Initial drafts use a labelled deterministic parser; the opt-in Gemma route is verified above. Opening `#demo` shows Review and the Gemma action without automatically calling a model. Model lab displays saved Tinker experiments without calling Tinker. Sessions expire after 30 minutes and disappear on restart; download reports before leaving. The demo allows 20 simultaneous sessions, four audits per visitor, one running audit at a time and 24 audits per hour. Do not enter private client information. No Tiger database or local Ollama runtime is loaded in this mode. Protected Backboard actions require the operator token and session ownership; anonymous visitors cannot spend its credits. Free-host allowance files are ephemeral and do not establish a cross-deployment durable budget.

**Private operator mode:** Public hosting without `FLOWPROOF_DEMO=true` requires an operator token of at least 32 characters. Enter it in app Settings. This mode has no multi-user account system. A configured database is required to retain projects and completed evidence across ephemeral-host restarts. Local Ollama is not reachable from a cloud service.

Free Render services sleep after inactivity and have shared monthly limits. Auto-deploy is disabled in the supplied blueprint so deployments can follow verified CI. Never upgrade the plan or attach paid resources to work around free-tier limits.

## Safety and limitations

External audits require explicit owner/authorized-auditor attestation, HTTPS public destinations and reviewed checks. The runner pins validated IPs, validates every redirect, denies private networks and non-GET requests, restricts requests to the original origin, blocks JavaScript, service workers and WebSockets, and bounds resource usage. It never submits forms or runs model-written browser code. These constraints intentionally make some JavaScript-heavy websites untestable; results must be blocked or unverified rather than fabricated passes.

Client input, URLs, captured text, logs and screenshots require careful handling. The runner redacts common credential and personal-information patterns and masks form controls. Automated redaction cannot establish that every private detail is removed; review evidence before sharing. HTML reports escape captured text. No client telemetry is sent to sponsors.

Planned sponsor integrations are not counted as functioning integrations. The public evidence is in [deployment evidence](docs/DEPLOYMENT.md), plus the app's connection and evaluation screens. Private local build receipts are retained separately. See [integration status](docs/INTEGRATIONS.md).
