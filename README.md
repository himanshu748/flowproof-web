# Briefstamp

Turn a client brief into approved browser checks and a proof-of-delivery report.

Formerly FlowProof; existing repository and demo URLs are retained.

[![Browser audit](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml/badge.svg)](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![Edited hosted sample walkthrough: approve checks, observe failures, restore the sample](docs/demo/briefstamp-preview.gif)

*Recorded template workflow; actual browser results. [Comparison screenshot](docs/evidence/acceptance-comparison.jpg).*

[Try the live demo](https://flowproof-demo.onrender.com/#demo) · [68-second video](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/demo/briefstamp-demo.mp4) · [Three-minute judge guide](docs/JUDGE_GUIDE.md)

YouTube upload: `YOUTUBE_URL` (pending author upload; MP4 above is the backup).

## The problem

A site can look finished while a promised headline, contact link or mobile layout is wrong. Freelancers assemble screenshots and test notes while clients try to match the delivery to the brief. Briefstamp joins each requirement, approved check and browser observation in one portable report.

## How it works

```mermaid
flowchart LR
  A[Client brief] --> B[Model or labelled templates]
  B --> C[Developer reviews and approves]
  C --> D[Playwright observes the website]
  D --> E[Evidence and saved audit]
  E --> F[Delivery report]
```

## Measured results

| Evidence | Observed result | Receipt |
|---|---|---|
| CI fixture: healthy | **5 passed / 0 failed / 1 unverified** | [Browser execution](docs/evidence/ci-regression-2026-10-15.json) |
| CI fixture: broken | **1 passed / 4 failed / 1 unverified** | [Same approved plan](docs/evidence/ci-regression-2026-10-15.json) |
| CI fixture: restored | **5 passed / 0 failed / 1 unverified** | [Four recoveries](docs/evidence/ci-regression-2026-10-15.json) |
| Tinker LoRA vs few-shot | **69.55% fewer input tokens**; reference agreement **22/24 vs 23/24** | [Cost/quality comparison](docs/MODEL_RESULTS.md) |
| Verification | **476 application tests, 19 Python tests, build** | [CI receipt](docs/evidence/gemma-rerun-preflight-2026-10-15/contract-ci.json) · [Run](https://github.com/himanshu748/flowproof-web/actions/runs/38760611627) |

Google-hosted Gemma proposed the live-homepage plan: **5 passed / 0 failed / 1 unverified**; its wrong-heading control recorded **4 / 1 / 1**. Both audits round-tripped through Tiger. [Real model-to-browser receipt](docs/evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json).

## Integrations with receipts

- **Gemma:** a dated hosted run generated six unapproved checks. [Proof](docs/PUBLIC_GEMMA.md).
- **Mastra:** two actual workflow steps generated and validated that proposal. [Proof](docs/PUBLIC_GEMMA.md).
- **Tinker:** real baseline/LoRA evaluation and one protected hosted proposal. [Proof](docs/HOSTED_TINKER.md).
- **Tiger Data:** strict-TLS audit persistence, matching reads and scoped lexical retrieval. [Proof](docs/TIGER_VERIFICATION.md).
- **Sentry:** the new live Gemma proposal’s three spans were independently verified in its dashboard. [Proof](docs/SENTRY_HOSTED.md).
- **Backboard:** one protected hosted write/search recovered all six audit facts. [Proof](docs/BACKBOARD_VERIFICATION.md).
- **Temporal:** a hosted CI restart retained the same workflow/run and one browser execution. [Proof](docs/TEMPORAL.md).

## Run locally

```sh
npm ci --legacy-peer-deps
npx playwright install chromium
npm run dev
```

Open http://127.0.0.1:5173. The default sample needs no paid account. [Configuration and deployment](docs/DEPLOYMENT.md).

## Limitations

- Public targets are the owned homepage and sample; scripts are disabled. The public sample’s plan yields three failures, versus four in the CI fixture.
- The video uses labelled templates. Earlier provider and validation failures remain in the [Gemma diagnosis](docs/GEMMA_LIVE_SITE.md); a dated success is no uptime guarantee.
- Tinker used fewer tokens with lower reference agreement; the dataset has no human-validated examples.
- Credit-funded services expire. Tiger stores image references only; budgets and sessions are bounded. Sentry verification covers proposal generation, not browser-audit traces or error events.
- No customer acceptance or all-sponsor completion is claimed. [Full scope and remaining gates](docs/PRD_STATUS.md).

## AI disclosure

AI coding assistance helped build Briefstamp. Model proposals require approval; deterministic browser execution supplies the results. Retained test approvals came from a verification harness, not a customer. The submission remains a draft for the author to review and publish.
