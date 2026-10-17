# Briefstamp: proof at the website handoff

[Published entry](https://dev.to/himanshu_748/briefstamp-proof-at-the-website-handoff-1ac1) for [Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

## What I Built

Turn briefs into approved browser checks and proof-of-delivery reports for freelancers. ₹499 per handoff is a pricing hypothesis.

## Demo and Code

[Live app](https://flowproof-demo.onrender.com/#demo) · [68-second video](https://youtu.be/xve020VJl0s) · [MP4 backup](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/demo/briefstamp-demo.mp4) · [Judge guide](JUDGE_GUIDE.md) · [MIT repository](https://github.com/himanshu748/flowproof-web).

## How It Works

Gemma proposes checks through Mastra; developers approve; Chromium observes; Tiger saves the audit. [Homepage proof](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) recorded five passes, one unverified requirement and a deliberate wrong-heading failure. [Sentry](evidence/sentry/2026-10-17T05-14-26Z/) also verified two browser and five agent spans.

A [hosted Mastra Agent](evidence/mastra/2026-10-17T04-08-48Z/) used Backboard/OpenRouter Gemma with Tiger and SerpApi, returning seven validated citations without changing the audit. Public routing retains Google. Separately, [Backboard memory](BACKBOARD_MEMORY_ANSWER.md) supplied six facts for three validated Gemma claims; repair remained unproven. Prose renders validated JSON. [CI](evidence/sentry/2026-10-17T05-14-26Z/ci.json): **1,451 app tests, 19 Python tests, build and Chromium checks**.

## Open Innovation

Open weights support Gemma and Qwen fine-tuning. Tinker LoRA used [69.55% fewer input tokens](MODEL_RESULTS.md), with lower reference agreement: 22/24 versus 23/24.

## First User

Author-reported: freelancer friend Priyanshu tried Briefstamp and said he “can pay” for it. No price was named; no transcript or recording exists. This is not independently observed customer acceptance, and he is not a paying customer. [Corrected account](CUSTOMER_VALIDATION.md).

## Proposed Categories

[Scoped evidence](DEV_POST.md): Gemma, Render, Tinker, GitHub Actions, Mastra, Sentry, Backboard, Temporal, ElevenLabs, Tiger Data and SerpApi. Judges determine eligibility.

## Limitations and Next

Fixed targets, expiring grants, mixed-credit Backboard proof and unvalidated training examples. Sentry exports afterward; token attributes were absent in its dashboard. Retrieval uses three precomputed queries with pgvector/full-text ranks; no index-use claim. Empty search does not establish de-indexing. Video uses templates; audio listening remains unverified. Next: handoffs and pricing validation.

AI assisted coding and drafting; verifier approvals are not customer acceptance.
