# Briefstamp: proof at the website handoff

Concise summary of the [published entry](https://dev.to/himanshu_748/briefstamp-proof-at-the-website-handoff-1ac1).

Prepared for [Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

## What I Built

Turn a client brief into approved browser checks and a proof-of-delivery report. Freelancers can show what matches the agreement, what fails and what still needs judgment. ₹499 per handoff is a pricing hypothesis.

## Demo

[Live app](https://flowproof-demo.onrender.com/#demo) · [68-second video](https://youtu.be/xve020VJl0s) · [MP4 backup](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/demo/briefstamp-demo.mp4) · [Judge guide](JUDGE_GUIDE.md).

## Code

[Public MIT repository](https://github.com/himanshu748/flowproof-web).

## How I Built It

Gemma proposes typed checks through Mastra; the developer approves; Chromium observes; Tiger saves the evidence-linked audit. The [October 16 homepage run](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) recorded five passes and one unverified requirement. A wrong-heading expectation failed. Both audits matched Tiger readbacks; Sentry independently displayed three proposal spans.

[Hosted optional checks](HOSTED_OPTIONAL.md) verified Backboard recall, SerpApi search and ElevenLabs MP3 generation. Temporal recovery ran in CI. [Verification](evidence/provider-refresh/2026-10-16/ci.json) passed 571 application tests, 19 Python tests and build.

## Why Does Open Innovation Matter?

Open weights let me run Gemma locally and fine-tune Qwen while keeping the browser executor independent of the model host. Tinker LoRA used [69.55% fewer input tokens](MODEL_RESULTS.md), with lower reference agreement: 22/24 versus 23/24. This is a measured tradeoff, not equal-quality savings.

## My First User

My freelancer friend Priyanshu tried it and said “it's good.” [Workflow details and willingness to pay remain unknown](CUSTOMER_VALIDATION.md).

## Prize Categories

[Evidence and category scope](HACKATHON_ENTRY.md): Gemma, Render, Tinker, Mastra, Sentry, Backboard, GitHub Actions, Temporal and ElevenLabs. [Tiger Data and SerpApi have narrower integration evidence](DEV_POST.md).

## Limitations and Next

Fixed targets, expiring credits, operator-only optional calls, unvalidated training examples. Video uses templates; generated audio decodes but listening is unverified. Next: observed freelancer workflows and pricing validation.

AI assisted coding and drafting; retained approvals came from verifiers.

Related reading: [Human-in-the-loop QA, metataro](https://dev.to/metataro/human-in-the-loop-qa-let-an-ai-agent-run-your-test-sheet-on-android-iphone-web-and-desktop-and-2dp0) · [Playwright post-mortem, tamizuddin](https://dev.to/tamizuddin/post-mortem-surviving-ai-generated-playwright-tests-in-production-5bak).
