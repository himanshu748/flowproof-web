# Briefstamp: proof at the website handoff

Summary of the [published entry](https://dev.to/himanshu_748/briefstamp-proof-at-the-website-handoff-1ac1) for [Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

## What I Built

Turn a client brief into approved browser checks and a proof-of-delivery report for freelancer handoffs. ₹499 per handoff is a pricing hypothesis.

## Demo and Code

[Live app](https://flowproof-demo.onrender.com/#demo) · [68-second video](https://youtu.be/xve020VJl0s) · [MP4 backup](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/demo/briefstamp-demo.mp4) · [Judge guide](JUDGE_GUIDE.md) · [MIT repository](https://github.com/himanshu748/flowproof-web).

## How It Works

Gemma proposes checks through Mastra; developers approve; Chromium observes; Tiger saves the audit. The [homepage proof](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) recorded five passes, one unverified requirement and a deliberate wrong-heading failure. Sentry displayed three proposal spans.

The current [Mastra Agent](evidence/mastra/2026-10-17T03-42-59Z/) registers Tiger and SerpApi tools. Its hosted attempt failed on Google's first HTTP 500; both tools and the second turn are proven only by retained-response SDK replay. The earlier [native loop](AGENT_RETRIEVAL.md) completed. [CI](evidence/mastra/2026-10-17T03-42-59Z/ci.json): **1,119 app tests, 19 Python tests, build and Chromium checks**.

## Open Innovation

Open weights enable local Gemma and Qwen fine-tuning. Tinker LoRA used [69.55% fewer input tokens](MODEL_RESULTS.md), with lower reference agreement: 22/24 versus 23/24.

## First User

Author-reported: freelancer friend Priyanshu tried Briefstamp and said he “can pay” for it. No price was named; no transcript or recording exists. This is not independently observed customer acceptance, and he is not a paying customer. [Corrected account](CUSTOMER_VALIDATION.md).

## Proposed Categories

[Scoped evidence](DEV_POST.md): Gemma, Render, Tinker, GitHub Actions, Mastra, Sentry, Backboard, Temporal, ElevenLabs, Tiger Data and SerpApi. Eligibility belongs to the judges.

## Limitations and Next

Fixed targets, expiring grants, incomplete hosted Mastra completion and unvalidated training examples. Retrieval uses three precomputed MiniLM queries over a pgvector column fused with full-text ranks (exact ranking, no index-use claim). Empty search does not establish de-indexing. Video uses templates; audio listening remains unverified. Next: observed handoffs and pricing validation.

AI assisted coding and drafting; verifier approvals are not customer acceptance.
