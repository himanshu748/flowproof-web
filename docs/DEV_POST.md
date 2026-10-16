# Briefstamp: proof at the website handoff

Prepared for [Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

## What I Built

Turn a client brief into approved browser checks and a proof-of-delivery report. Freelancers can show what matches the agreement, what fails and what still needs judgment. ₹499 per handoff is a pricing hypothesis.

## Demo

[Live app](https://flowproof-demo.onrender.com/#demo) · [68-second video](https://youtu.be/xve020VJl0s) · [MP4 backup](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/demo/briefstamp-demo.mp4) · [Judge guide](JUDGE_GUIDE.md).

![The deployed Briefstamp dashboard after one synthetic audit](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/evidence/dashboard/2026-10-16/hosted-overview.png)

## Code

[Public MIT repository](https://github.com/himanshu748/flowproof-web).

## How I Built It

Gemma proposes typed checks through Mastra; the developer approves; Chromium observes; Tiger saves the evidence-linked audit. The [October 16 homepage run](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) recorded five passes and one unverified requirement. A wrong-heading expectation failed. Both audits matched Tiger readbacks; Sentry independently displayed three proposal spans.

A separate [two-turn evidence agent](AGENT_RETRIEVAL.md) now uses native Gemma text JSON to select Tiger hybrid retrieval and a SerpApi search, then cite their actual returned facts. This is separate from the Mastra proposal workflow. The source audit stays unchanged. [Hosted optional checks](HOSTED_OPTIONAL.md) also verified Backboard recall and ElevenLabs MP3 generation; Temporal recovery ran in CI. The [exact deployed agent source](evidence/agent-allowance/2026-10-16/ci.json) passed **871 application tests, 19 Python tests, build and real browser audits**. Model/search calls have their own hosted receipts, not CI-generated results.

## Why Does Open Innovation Matter?

Open weights let me run Gemma locally and fine-tune Qwen while keeping the browser executor independent of the model host. Tinker LoRA used [69.55% fewer input tokens](MODEL_RESULTS.md), with lower reference agreement: 22/24 versus 23/24. This is a measured tradeoff, not equal-quality savings.

## My First User

My freelancer friend Priyanshu tried it and said “it's good.” [Workflow details and willingness to pay remain unknown](CUSTOMER_VALIDATION.md).

## Prize Categories

I am putting forward the eleven category entries below under the [official Week 2 requirements](https://dev.to/challenges/hacktoberfest-week2-2026-10-12). Each explains the technology's job and links actual proof within its stated scope. Eligibility and awards belong to the judges; several proposed entries do not imply several wins.

### Best Use of Gemma — proposing checks for a real website

Gemma supplies the requirement-to-check proposal in the public app's opt-in AI flow. On October 16, Google-hosted `gemma-4-26b-a4b-it` produced six unapproved checks for Briefstamp's actual homepage, using **389 input and 296 output tokens**. Execution was rejected before approval. After explicit verifier approval, real Chromium observed **five passes and one unverified requirement**. Deliberately changing the heading expectation produced one failure. This connects an open-weight model to the product's central workflow. [Proposal, browser results and negative control](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json).

### Best Use of Render — hosting the app a judge can use

The existing Free Render service hosts the React interface, application API and isolated Mastra proposal worker. A judge can review checks, approve an audit, inspect screenshots and download the report from the public URL. Gemma inference is served by Google; Render hosts the application that requests and validates it. [Exact deployed source, green CI and Free-plan readback](evidence/dashboard/2026-10-16/deployment.json) · [Actual hosted desktop/mobile workflow](evidence/dashboard/2026-10-16/hosted-ui.json).

### Best Use of Tinker — a measured cost/quality tradeoff

I used Tinker to LoRA fine-tune Qwen3.5-4B for the specific task of generating typed acceptance checks, and compared it with zero-shot and few-shot baselines on the same **24-request synthetic cohort**. Against few-shot, input tokens fell from **16,737 to 5,097: 69.55% fewer**. Recorded usage and uncached prices imply **55.52% lower inference-only cost**, an estimate rather than billed savings. Reference agreement fell from **23/24 to 22/24** and latency increased. The category permits a cost improvement; this is the tradeoff I can demonstrate. A separate, newer sampler also produced one real protected hosted proposal. [Raw runs, calculations and reproduction](MODEL_RESULTS.md) · [Separate hosted sampler receipt](HOSTED_TINKER.md).

### Best Use of GitHub Copilot — the GitHub Actions route

The official category includes project automation through GitHub Actions. Briefstamp's workflow installs Chromium, runs the tests and build, and audits healthy, intentionally broken and restored fixtures using the same approved plan. The saved outcomes are **5/0/1 → 1/4/1 → 5/0/1**: passed, failed, unverified. It uploads screenshots, audit JSON and portable reports for review. This category entry is based on Actions automation. [Workflow source](../.github/workflows/audit.yml) · [Actual successful run and counts](evidence/dashboard/2026-10-16/ci.json).

### Best Use of Mastra — generation followed by validation

Mastra coordinates two real steps around Gemma: generate a proposal, then validate it against the safe check contract. Its isolated worker exits before browser execution. The generated output is structured data for the runner; no model-generated browser script is executed. This makes orchestration part of the handoff workflow while keeping approval visible and enforceable. [Actual workflow run and output](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) · [Implementation and earlier proofs](PUBLIC_GEMMA.md).

### Best Use of Sentry Agent Tracing — making the proposal inspectable

The October 16 proposal trace was independently checked in Sentry's dashboard. It contained **three spans**: a **23.30-second** root with status `ok`, **7.59 seconds** for generation and **0.53 milliseconds** for validation. The gap shows why the provider timing alone does not describe the whole proposal wait. The debugging record also preserves an upstream HTTP 500 before parsing and a separate application-contract fix that normalized the mobile viewport; those were different failures. [Dashboard receipt and timings](evidence/hosted-website/2026-10-16T09-10-55Z/sentry-verification.json) · [Incident diagnosis](GEMMA_LIVE_SITE.md).

![Actual Sentry dashboard showing the proposal root and its generation and validation spans](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/evidence/hosted-website/2026-10-16T09-10-55Z/sentry-trace.png)

### Best Use of Backboard — project memory grounded in an audit

The protected hosted memory integration wrote facts from a completed broken-sample audit to a dedicated Backboard assistant, then searched them. It recovered **all six matching assertion facts**. Keeping the remembered facts tied to actual results lets a later project conversation refer to evidence instead of a model's invented history. This proof used one write and one search, with no inference call. [Hosted memory receipt and retrieved facts](HOSTED_OPTIONAL.md).

### Best Use of Temporal — durable audit execution

The Temporal SDK workflow wraps the approved browser-audit portion of the process. In a real GitHub Actions recovery run, both server and worker processes restarted while the same workflow/run identities and **one browser execution** were retained. The activity history recorded **two attempts**. This tests recovery without duplicating an already completed browser operation. [CI recovery run, history and hashes](TEMPORAL.md).

### Best Use of ElevenLabs — a spoken result summary

The protected hosted speech route turned actual synthetic-audit counts and fixed limitations into a **92,386-byte MP3**. An independent decoder verified **22.987755 seconds** of audio. The input is a bounded, counts-only report summary. **Voice generated with ElevenLabs; noncommercial synthetic demonstration only.** [Listen to the retained sample](evidence/hosted-optional/2026-10-16T09-13-12Z/elevenlabs-synthetic-report.mp3) · [Request and independent decoder proof](HOSTED_OPTIONAL.md).

### Best Use of Tiger Data: hybrid retrieval serving an evidence agent

Tiger first saves and returns the evidence-linked browser audit. In the new [hosted agent run](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/receipt.json), Gemma selected the bounded `failure_history` tool. Tiger combined PostgreSQL full-text and cosine ranks with reciprocal rank fusion, returning three actual saved failures. For “sideways panning on smartphones,” the lexical score was zero, while mobile overflow ranked first with **cosine 0.3781263417931506**. A separate calculation matched that score; the positive `horizontal` keyword control returned one match. The second Gemma turn cited the returned audit/check IDs and failed statuses. Retrieval supplies saved browser evidence to the agent.

The vectors are **384-dimensional MiniLM embeddings in PostgreSQL arrays, not pgvector**. Only three precomputed queries and exact source texts are supported. These limits keep a real integration reproducible on the existing trial; they do not establish arbitrary hosted embeddings or retrieval-quality gains. [Actual selections, cited findings, controls and scope](AGENT_RETRIEVAL.md) · [Independent cosine calculation](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/independent-cosine.json).

### Best Use of SerpApi: a model-selected search observation

The same first Gemma turn selected `search_visibility`; the server ran the exact owner-authorized `site:flowproof-demo.onrender.com` query. SerpApi returned **HTTP 200 in 379 milliseconds**, with **zero matching results**. The second model turn consumed that actual observation and cited `resultCount: 0`, alongside the Tiger facts. Both model turns and the provider response are retained in the receipt. [Transport and response](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/serpapi-transport.json) · [Complete two-turn receipt](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/agent-run.json).

Both native Gemma requests returned HTTP 200: **517 input / 38 output tokens**, then **1,242 / 735**. The loop uses validated text JSON, not provider-native function calling or a Mastra Agent. Search adds a bounded visibility observation. An empty result does not prove de-indexing, ranking, uncached freshness or a passing browser assertion. The existing **2 passed / 3 failed / 1 unverified** audit remained unchanged. Earlier failed and partial attempts remain in [the proof history](AGENT_RETRIEVAL.md).

## Limitations and Next

- The public demo accepts the owned homepage and synthetic sample; it is not a general client-URL auditor. Live-page scripts are disabled. Verifier approval is not customer acceptance.
- The video records labelled templates. The real Gemma run is separate, dated evidence, not an uptime guarantee. The provider's internal cause for the earlier HTTP 500 remains unknown. The evidence-agent history also retains invalid JSON, an HTTP 500 and a 10-second search timeout before the successful run; earlier unknown search completion is not retroactively treated as zero.
- Tinker's training examples have no human validation. Lower token use came with lower reference agreement and higher latency. The inference estimate excludes training and retention; including those made total cost higher at this 24-request scale.
- Tiger stores audit JSON and screenshot references. Its new operator-protected agent path demonstrates hybrid retrieval over three precomputed MiniLM queries and exact failure texts, using PostgreSQL arrays, not pgvector. It is not arbitrary hosted embedding inference or a retrieval-quality benchmark. The credit-covered trial retains strict TLS and an October 20 access cutoff; earlier isolated probes remain separate.
- Sentry proof covers proposal generation, not browser-audit tracing or error-event ingestion. Mastra demonstrates bounded workflow orchestration, not an autonomous Agent. Temporal wraps the approved browser-audit activity and its recovery is hosted CI development-server evidence, not an always-on Render worker or Temporal Cloud.
- The evidence agent, search, speech and memory proofs are operator-protected. Their demonstration reservations are consumed without refund; trial credits and access expire. Tokenless/cross-visitor agent calls returned 404, missing consent 400 and a repeated tranche 409. A restart or fresh timestamp cannot replenish a spent grant. [Funding boundaries and scheduled read-only rechecks](PROVIDER_ALLOWANCES.md).
- Backboard demonstrates assistant memory, not a generated answer grounded in that memory. The audio file decodes, but its audible wording has not been independently listened to.
- I am not entering Entire or .tech: Entire evidence is local only, and I chose to keep the existing Render domain. Arduino, TabPFN, DigitalOcean and MongoDB Atlas are not used.

Next: observe complete freelancer handoffs, validate the training examples and test the ₹499 pricing hypothesis. Priyanshu's short feedback is a starting point; payment intent and completed workflow details remain unknown.

AI assisted coding and drafting; retained approvals came from verifiers.

Related reading: [Human-in-the-loop QA, metataro](https://dev.to/metataro/human-in-the-loop-qa-let-an-ai-agent-run-your-test-sheet-on-android-iphone-web-and-desktop-and-2dp0) · [Playwright post-mortem, tamizuddin](https://dev.to/tamizuddin/post-mortem-surviving-ai-generated-playwright-tests-in-production-5bak).
