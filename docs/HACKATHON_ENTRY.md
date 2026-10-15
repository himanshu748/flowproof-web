# Briefstamp: a short path through the evidence

**For freelance website handoffs:** turn an agreed requirement into a reviewed check, an observed result and a portable report. A passing check proves its specific assertion; it does not certify the entire website.

## Try it in three minutes

1. [Open Briefstamp](https://flowproof-demo.onrender.com/) and choose **Open demo**. The free Render service may take time to wake. Use the synthetic Forma Studio sample.
2. Review the Gemma card, consent to sending the fixed synthetic brief and request generation. Review and approve the executable checks, then run an audit. Inspect the heading and mobile evidence; the subjective requirement remains unverified.
3. Try the deliberately broken sample, inspect an actual failure, then download its HTML delivery report. Screenshots are embedded. Keep the download before the temporary visitor session expires.

Initial drafts are explicitly deterministic; opening the demo makes no model call. The opt-in Gemma action is verified on free Render release `e43dbe74`: **open model proposes → developer approves → deterministic browser observes**. The model dashboard contains saved Tinker experiments, not live Tinker inference. [Actual hosted Gemma/Mastra proof and limits](PUBLIC_GEMMA.md).

## Follow the regression proof

[GitHub Actions workflow](../.github/workflows/audit.yml) · [Public runs](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Audit script](../scripts/audit-sample.ts)

The regression sequence executed **healthy → intentionally broken → restored healthy** with the same approved fixture plan. The downloaded `flowproof-evidence` artifact contains 15 PNG screenshots, three standalone HTML reports, per-run JSON, `comparison.json` and a readable summary. It recorded **four regressions followed by four recoveries**, with the subjective check still unknown. The fixture was restored by the test harness; this is not autonomous code repair.

**Verified remote evidence, October 15:** [Actions run 38722793847](https://github.com/himanshu748/flowproof-web/actions/runs/38722793847) passed source `e43dbe7430368292ff9b225f4bf5e3236c2d03c0`, deployed to the existing Free Render service at 10:53 UTC. Its [hosted receipt](evidence/hosted-open-model/2026-10-15T10-55-27Z/receipt.json) verifies native Gemma/Mastra generation and healthy/broken/restored Chromium; [Sentry’s dashboard](SENTRY_HOSTED.md) independently verifies the matching proposal trace. The earlier protected Backboard proof is separate. [Deployment history](DEPLOYMENT.md) retains the earlier heap failure, test counts and four-regression CI fixture artifacts.

| Controlled website state | Passed | Failed | Unverified |
| ------------------------ | -----: | -----: | ---------: |
| Healthy                  |      5 |      0 |          1 |
| Intentionally broken     |      1 |      4 |          1 |
| Restored healthy         |      5 |      0 |          1 |

The saved fixture plan checks the contact destination. The public brief parser checks its visible label. Their broken results therefore differ: four failures in the fixture plan versus three in the public sample flow. Compare definitions as well as status counts.

## What the open models actually did

- **Gemma:** one actual hosted native `gemma-4-26b-a4b-it` request used 335 input / 300 output tokens. Its provider/validation call took 7.502 seconds; the Sentry proposal root took 22.09 seconds including startup. Two real Mastra steps ran in an isolated worker (175.07 MiB maximum RSS). Unapproved execution returned 409. After verifier approval, unchanged checks produced five passes → three failures/two passes → five passes, one unverified judgment throughout; 15 PNGs and three reports were downloaded with hashes retained. This is synthetic verification, not human validation. [Proof, earlier failed attempts and limits](PUBLIC_GEMMA.md).
- **Tinker:** real Qwen3.5-4B LoRA used **69.55% fewer input tokens** than few-shot on the same 24-request synthetic cohort, implying **55.52% lower inference-only cost** at recorded uncached rates. This is an estimate, not billed savings: reference agreement fell from 23/24 to 22/24 and latency increased. Training plus one-day checkpoint storage would amortize after 87 comparable requests; that projection was not executed. Zero human-validated examples. [Raw receipts, exact cost calculation and tradeoffs](MODEL_RESULTS.md). A newer October 15 application-smoke sampler was separately renewed under a bounded promotional-credit allowance. Its protected Render route awaits hosted verification; it does not inherit the frozen benchmark’s accuracy result.
- **Backboard:** one protected hosted write/search recovered all six synthetic audit facts. The immediate free balance fell $4.99→$4.98; paid balance stayed unchanged. This is separate from the earlier local proof. Anonymous/cross-visitor access was denied and the two-call allowance is exhausted. [Operator scope, ephemeral ledger and receipt](BACKBOARD_VERIFICATION.md).
- **Sentry:** the exact hosted proposal root and two child spans were independently observed in the authenticated dashboard. The privacy allowlist excludes briefs, model output and credentials. This establishes one proposal trace, not browser-audit or error ingestion. [Trace and screenshot](SENTRY_HOSTED.md).
- **Tiger Data:** the [earlier temporary trial](TIGER_VERIFICATION.md) retains its two-audit, ten-screenshot lexical/vector proof. A newly approved dedicated credit-covered metered trial now passes strict system-CA/hostname TLS: independent writer/reader processes recovered three audits, lexical retrieval found the failed overflow check, and cross-session access was denied. This new store saves screenshot references only. Render configuration is applied, but its actual hosted path remains pending; access expires October 20. [Current scope](DEPLOYMENT.md).

## Category position and remaining gates

**Primary: Best Use of GitHub Copilot, through GitHub Actions.** The current official category expressly includes “automate your project with GitHub Actions.” This entry claims that route, not Copilot coding or review. Gemma is supported by the actual hosted proposal-to-browser workflow above, with bounded Mastra orchestration. Render is an established hosting route. Tiger's isolated demonstration and Tinker's quality/cost tradeoff remain bounded secondary evidence. [Official categories](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

The full PRD is unfinished: the next-release Tiger and protected Tinker paths, human dataset validation and other provider gates remain open. A one-heading local Tinker operator workflow, local Temporal recovery, Entire provenance and a Free-plan SerpApi search have [separate receipts](INTEGRATIONS.md). The manual Temporal CI workflow is implemented but unexecuted. Hosted Mastra proposal orchestration, Sentry proposal ingestion and protected Backboard memory are verified within the limits above. No completed founder feedback or independent customer validation has been recorded. [Full PRD assessment](PRD_STATUS.md).

The article remains a local draft, not a DEV submission. The author confirmed on October 15 that Briefstamp is their only Week 2 entry; the one-entry question is resolved. Before publishing: review the article, confirm eligibility, recheck the exact release if changed and preserve all limitations. Only the first entry counts. Deadline: **October 18, 11:59 PM PDT / October 19, 12:29 PM IST**. [Official rules](https://dev.to/page/hacktoberfest-week2-2026-10-12-contest-rules).
