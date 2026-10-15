# Briefstamp: a short path through the evidence

**For freelance website handoffs:** turn an agreed requirement into a reviewed check, an observed result and a portable report. A passing check proves its specific assertion; it does not certify the entire website.

## Try it in three minutes

1. [Open Briefstamp](https://flowproof-demo.onrender.com/) and choose **Open demo**. The free Render service may take time to wake. Use the synthetic Forma Studio sample.
2. Review the Gemma card, consent to sending the fixed synthetic brief and request generation. Review and approve the executable checks, then run an audit. Inspect the heading and mobile evidence; the subjective requirement remains unverified.
3. Try the deliberately broken sample, inspect an actual failure, then download its HTML delivery report. Screenshots are embedded. Keep the download before the temporary visitor session expires.

Initial drafts are explicitly deterministic; opening the demo makes no model call. The opt-in Gemma action is verified on free Render release `25efaeef`: **open model proposes → developer approves → deterministic browser observes**. The model dashboard contains saved Tinker experiments, not live Tinker inference. [Actual hosted Gemma/Mastra proof and limits](PUBLIC_GEMMA.md).

## Follow the regression proof

[GitHub Actions workflow](../.github/workflows/audit.yml) · [Public runs](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Audit script](../scripts/audit-sample.ts)

The regression sequence executed **healthy → intentionally broken → restored healthy** with the same approved fixture plan. The downloaded `flowproof-evidence` artifact contains 15 PNG screenshots, three standalone HTML reports, per-run JSON, `comparison.json` and a readable summary. It recorded **four regressions followed by four recoveries**, with the subjective check still unknown. The fixture was restored by the test harness; this is not autonomous code repair.

**Verified remote evidence, October 15:** [Actions run 38716831942](https://github.com/himanshu748/flowproof-web/actions/runs/38716831942) passed source `25efaeefa582ebff29033e4d73e7fe53ece73119`: 320 application tests, 19 Python tests, build and actual browser checks; compiled Mastra workflow maximum RSS was 174.54 MiB. The [hosted receipt](evidence/hosted-open-model/2026-10-15T10-04-04Z/receipt.json) separately verifies native Gemma/Mastra generation, healthy/broken/restored Chromium and protected Backboard at that revision. [Deployment history](DEPLOYMENT.md) retains the earlier heap failure and four-regression fixture artifacts.

| Controlled website state | Passed | Failed | Unverified |
| ------------------------ | -----: | -----: | ---------: |
| Healthy                  |      5 |      0 |          1 |
| Intentionally broken     |      1 |      4 |          1 |
| Restored healthy         |      5 |      0 |          1 |

The saved fixture plan checks the contact destination. The public brief parser checks its visible label. Their broken results therefore differ: four failures in the fixture plan versus three in the public sample flow. Compare definitions as well as status counts.

## What the open models actually did

- **Gemma:** one actual hosted native `gemma-4-26b-a4b-it` request used 335 input / 300 output tokens in 7.893 seconds, coordinated by two real Mastra steps (149.18 MiB child maximum RSS). Unapproved execution returned 409. After agent approval, unchanged checks produced healthy five passes → broken three failures/two passes → five passes, one unverified judgment throughout; 15 PNGs and three reports were downloaded with hashes retained. This is synthetic verification, not human validation. [Proof, earlier failed attempts and limits](PUBLIC_GEMMA.md).
- **Tinker:** real Qwen3.5-4B LoRA used **69.55% fewer input tokens** than few-shot on the same 24-request synthetic cohort, implying **55.52% lower inference-only cost** at recorded uncached rates. This is an estimate, not billed savings: reference agreement fell from 23/24 to 22/24 and latency increased. Training plus one-day checkpoint storage would amortize after 87 comparable requests; that projection was not executed. Zero human-validated examples. [Raw receipts, exact cost calculation and tradeoffs](MODEL_RESULTS.md).
- **Backboard:** one protected hosted write/search recovered all six synthetic audit facts. The immediate free balance fell $4.99→$4.98; paid balance stayed unchanged. This is separate from the earlier local proof. Anonymous/cross-visitor access was denied and the two-call allowance is exhausted. [Operator scope, ephemeral ledger and receipt](BACKBOARD_VERIFICATION.md).
- **Tiger Data:** a separate strict-TLS no-card trial recovered two audits and ten screenshots in a fresh process and performed lexical/vector retrieval. Its temporary schema was removed. This is genuine bounded evidence, not the public demo's database. [Receipt and scope](TIGER_VERIFICATION.md).

## Category position and remaining gates

**Primary: Best Use of GitHub Copilot, through GitHub Actions.** The current official category expressly includes “automate your project with GitHub Actions.” This entry claims that route, not Copilot coding or review. Gemma is supported by the actual hosted proposal-to-browser workflow above, with bounded Mastra orchestration. Render is an established hosting route. Tiger's isolated demonstration and Tinker's quality/cost tradeoff remain bounded secondary evidence. [Official categories](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

The full PRD is unfinished: lasting hosted Tiger storage, human dataset validation and other live-provider gates remain open. A one-heading Tinker operator workflow, local Sentry envelopes, Temporal recovery, Entire provenance and a Free-plan SerpApi search have [separate receipts](INTEGRATIONS.md). Hosted Mastra proposal orchestration and protected Backboard memory are verified within the limits above. No completed founder feedback or independent customer validation has been recorded. [Full PRD assessment](PRD_STATUS.md).

The article remains a local draft, not a DEV submission. The author confirmed on October 15 that Briefstamp is their only Week 2 entry; the one-entry question is resolved. Before publishing: review the article, confirm eligibility, recheck the exact release if changed and preserve all limitations. Only the first entry counts. Deadline: **October 18, 11:59 PM PDT / October 19, 12:29 PM IST**. [Official rules](https://dev.to/page/hacktoberfest-week2-2026-10-12-contest-rules).
