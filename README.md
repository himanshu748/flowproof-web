# Briefstamp

Previously FlowProof. The existing repository, demo URL and storage identifiers are retained for compatibility.

Turn website requirements into approved browser checks and evidence-backed delivery reports. **An open model proposes, the developer approves, and the browser records what happened.**

[Live demo](https://flowproof-demo.onrender.com) · [Browser acceptance workflow](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Evidence and limitations](docs/DEPLOYMENT.md)

The landing page introduces the workflow with original conceptual artwork and a labelled interactive sample. Choose **Open demo** to enter the real workspace. For a short review path, see [the judge guide](docs/JUDGE_GUIDE.md) and [entry evidence](docs/HACKATHON_ENTRY.md). The owner-authorized live-site preset is a release candidate; its hosted network proof is pending. See the [requirement-by-requirement PRD status](docs/PRD_STATUS.md) for completed capabilities and remaining gaps.

Briefstamp includes a local working product and an isolated public-demo mode. It includes a React delivery cockpit, safe typed acceptance checks, a real Playwright runner, screenshot and redacted text evidence, standalone HTML reports, PostgreSQL persistence, failure retrieval, and a GitHub Actions workflow. Integration readiness and measured model results are shown honestly in the app. Audits capture the original brief, target and generator at run time. Incomplete exports retain every planned requirement and disclose missing evidence.

**Verified hosted release:** `2a8eae95` is live on the existing Free Render service after **423 application tests, 19 Python tests and a production build** passed in [CI](https://github.com/himanshu748/flowproof-web/actions/runs/38727532102). One protected Tinker request used **260 input / 249 output tokens** and produced six unapproved checks. Execution was rejected until verifier approval; real Chromium observed **5 passed / 1 unverified → 2 passed / 3 failed / 1 unverified → 5 passed / 1 unverified**. All three audits were saved to Tiger and read back with matching JSON; scoped lexical search recovered the failed mobile assertion. [Hosted Tinker proof](docs/HOSTED_TINKER.md) · [Tiger proof](docs/TIGER_VERIFICATION.md).

Earlier hosted receipts independently verify Gemma through two Mastra steps, a matching three-span Sentry dashboard trace, and protected Backboard write/retrieval. The latest Tinker run does not repeat those provider calls. [Gemma scope](docs/PUBLIC_GEMMA.md) · [Sentry trace](docs/SENTRY_HOSTED.md) · [Backboard limits](docs/BACKBOARD_VERIFICATION.md). Synthetic verifier approval is not human/customer validation.

Real Tinker baseline and LoRA runs used confirmed promotional credits. On the same 24-example holdout, LoRA used **69.55% fewer input tokens**, implying **55.52% lower inference-only cost** at recorded uncached rates. Reference matches fell from **23/24 to 22/24**, browser correctness from **19/20 to 18/20**, and latency increased. Training plus one-day storage would amortize after 87 comparable requests; that projection was not executed and no net saving was demonstrated at 24 requests. The 96-example synthetic pilot has **zero human-validated examples**. [Exact calculations and raw results](docs/MODEL_RESULTS.md).

Tiger now stores scoped synthetic audit JSON through a restricted role on a dedicated **credit-covered metered trial** with strict system-CA/hostname TLS. It is not permanent Free storage; its application gate/login expires October 20. Screenshot references are stored, not screenshot bytes; hosted vector retrieval is not claimed. Cross-visitor reads/searches were denied. A read-only postcheck confirmed FieldIssue remained live, with no Briefstamp role/schema or FieldIssue changes. The original Shared Free CA issue remains unresolved. [Evidence and storage boundaries](docs/TIGER_VERIFICATION.md).

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

- **PostgreSQL:** set `DATABASE_URL`. TLS certificate verification is enabled; only trusted local PostgreSQL should set `DATABASE_SSL=false`. The app creates dedicated `flowproof_*` tables. It is a single-process MVP: run one replica. Audit evidence is persisted as database byte arrays after a completed run, so downloaded reports can survive an ephemeral host restart. The separate Shared Free Tiger service fails strict certificate verification; its direct adapter remains blocked. The earlier successful no-card trial probe was isolated and temporary. The new restricted public-demo store is separately described above; it retains screenshot references, unlike this private-operator byte-array store. Do not disable verification or upgrade to bypass the Shared Free limitation.
- **Local open model:** run Ollama with a supported completion model, set `FLOWPROOF_AI_ENABLED=true`, `FLOWPROOF_OLLAMA_MODEL=gemma3:4b` (or your installed Qwen model). Every plan records its actual provider. Invalid responses fall back to an explicitly labeled conservative rule parser. There is no default remote AI billing path. A real three-requirement Gemma workflow produced a failed heading and then recovery, with nine screenshots and grounded commentary; two full-brief attempts timed out. See [Gemma evidence](docs/GEMMA_WORKFLOW.md) and reproduce with `node --import tsx scripts/verify-gemma-workflow.ts --run-local-model --supported-brief`.
- **Failure vectors:** with PostgreSQL and local `all-minilm:22m`, set `FLOWPROOF_EMBEDDINGS=true`. Failure descriptions are embedded locally and searched using actual cosine similarity plus lexical ranking in PostgreSQL. The portable array implementation uses a full scan appropriate to a small demo. It does not claim pgvector acceleration.
- **Tinker:** see [measured results](docs/MODEL_RESULTS.md) and [reproduction instructions](docs/MODEL_EVALUATION.md). Recorded baseline, training and paired-browser receipts are bundled. New provider work requires independently confirmed free credits and shared token/cost budgets. A [real one-heading operator workflow](docs/TINKER_WORKFLOW.md) passed the approval boundary and healthy/broken/restored browser checks through a fresh Tinker sampler. It uses a verified no-thinking Qwen template at the raw endpoint; the earlier rejected chat-mode attempts remain recorded. This is separate from the quality benchmark. The existing October 15 application-smoke sampler, newer than the frozen October 14 benchmark checkpoint, was renewed to October 19 at 23:59:30 UTC without training or new checkpoints. Conservative retention estimate $0.00221 is within the approved $0.01 promotional-credit cap, not a billed result. Protected Render configuration reserves two requests / 50,000 tokens with confirmation expiring October 16 at 10:49 UTC; the actual hosted proof consumed one request and left one unused. It measured 260 input / 249 output tokens; 8,912 reserved tokens are a budget bound. Anonymous visitors have no Tinker access. [Hosted evidence](docs/HOSTED_TINKER.md).

- **Native Gemma sample proposals:** the hosted, consented action uses `gemma-4-26b-a4b-it` only for the fixed synthetic brief. It checks current free-only pricing, applies quotas and preserves unapproved checks. Edited visitor/client text is rejected. Free-use confirmation expires October 20, 2026; the pricing result is cached for at most one hour. [Configuration boundary and actual hosted evidence](docs/PUBLIC_GEMMA.md).
- **Mastra and Sentry:** the verified hosted Gemma proposal uses two real isolated Mastra steps, measured at 175.07 MiB maximum RSS. The matching root/generate/validate trace was independently verified in Sentry under a sponsored entitlement with paid overage disabled. This proves one proposal trace, not browser-audit/error ingestion or autonomous agents. [Exact trace and privacy boundary](docs/SENTRY_HOSTED.md).
- **Temporal:** actual local and hosted GitHub Actions recovery proofs passed retry and full server/worker restart checks, retaining one browser execution. [Setup and receipts](docs/TEMPORAL.md). The CI demonstration is not an always-on Render worker or Temporal Cloud; no artifact storage is used.
- **Backboard:** one protected hosted write/search retrieved all six synthetic audit statuses unchanged. The immediate observed deduction was $0.01 from free credits, paid balance unchanged; the earlier local proof spent a separate observed $0.01. Operator token and visitor ownership are mandatory. The hosted two-operation allowance is exhausted and its account proof expires within 24 hours. [Receipt and existing-credit boundary](docs/BACKBOARD_VERIFICATION.md).
- **Other providers:** [SerpApi’s real Free-plan search](docs/evidence/serpapi/2026-10-15T07-38-38-984Z/receipt.json) and [Entire’s scoped local import/readback](docs/ENTIRE.md) have receipts. ElevenLabs synthetic narration remains unverified. See the [current integration ledger](docs/INTEGRATIONS.md).

## Hosting and operating boundaries

`render.yaml` and `Dockerfile` define a **free** Render web service with Chromium and its Linux dependencies. No database, paid worker, persistent disk or model API is required. Deployment evidence is tracked in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Public demo:** `FLOWPROOF_PUBLIC=true` and `FLOWPROOF_DEMO=true` enable isolated visitor sessions. Only the synthetic sample can be audited. Initial drafts use a labelled deterministic parser; the opt-in Gemma route is verified above. Opening `#demo` shows Review and the Gemma action without automatically calling a model. Model lab displays frozen Tinker experiments; the separate live Tinker action is operator-protected and never called automatically. Visitor access expires after 30 minutes and its session state disappears on restart; completed audit JSON is stored in Tiger, but screenshot bytes and reports remain temporary. Download reports before leaving. The demo allows 20 simultaneous sessions, four audits per visitor, one running audit at a time and 24 audits per hour. Do not enter private client information. The verified release saves completed audits to Tiger and supports visitor-scoped lexical retrieval, subject to the trial and image-storage limits above. No local Ollama runtime is loaded in this mode. Protected Backboard actions require the operator token and session ownership; anonymous visitors cannot spend its credits. Free-host allowance files are ephemeral and do not establish a cross-deployment durable budget.

**Private operator mode:** Public hosting without `FLOWPROOF_DEMO=true` requires an operator token of at least 32 characters. Enter it in app Settings. This mode has no multi-user account system. A configured database is required to retain projects and completed evidence across ephemeral-host restarts. Local Ollama is not reachable from a cloud service.

Free Render services sleep after inactivity and have shared monthly limits. Auto-deploy is disabled in the supplied blueprint so deployments can follow verified CI. Never upgrade the plan or attach paid resources to work around free-tier limits.

## Safety and limitations

External audits require explicit owner/authorized-auditor attestation, HTTPS public destinations and reviewed checks. The runner pins validated IPs, validates every redirect, denies private networks and non-GET requests, restricts requests to the original origin, blocks JavaScript, service workers and WebSockets, and bounds resource usage. It never submits forms or runs model-written browser code. These constraints intentionally make some JavaScript-heavy websites untestable; results must be blocked or unverified rather than fabricated passes.

Client input, URLs, captured text, logs and screenshots require careful handling. The runner redacts common credential and personal-information patterns and masks form controls. Automated redaction cannot establish that every private detail is removed; review evidence before sharing. HTML reports escape captured text. No client telemetry is sent to sponsors.

Planned sponsor integrations are not counted as functioning integrations. The public evidence is in [deployment evidence](docs/DEPLOYMENT.md), plus the app's connection and evaluation screens. Private local build receipts are retained separately. See [integration status](docs/INTEGRATIONS.md).
