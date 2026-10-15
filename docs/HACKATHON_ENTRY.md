# Briefstamp: a short path through the evidence

**For freelance website handoffs:** turn an agreed requirement into a reviewed check, an observed result and a portable report. A passing check proves its specific assertion; it does not certify the entire website.

## Try it in three minutes

Follow the [judge guide](JUDGE_GUIDE.md): open `#demo`, choose **Audit this live site**, review and approve the labelled checks, audit the actual owned homepage and download its report. Five assertions passed and one judgment stayed unverified. Changing only the heading expectation produced one real failure; both audits were saved and read through Tiger.

The [newest live-site proof](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json) used a real Google-hosted Gemma proposal through Mastra, then explicit verifier approval and Chromium observations. It reported **389 input / 296 output tokens**. The wrong-heading control failed and both audits round-tripped through Tiger. [Historical failures and contract fix](GEMMA_LIVE_SITE.md) remain visible. The optional model route never supplies browser scripts or bypasses approval.

## Follow the regression proof

[GitHub Actions workflow](../.github/workflows/audit.yml) · [Public runs](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Audit script](../scripts/audit-sample.ts)

The regression sequence executed **healthy → intentionally broken → restored healthy** with the same approved fixture plan. The downloaded `flowproof-evidence` artifact contains 15 PNG screenshots, three standalone HTML reports, per-run JSON, `comparison.json` and a readable summary. It recorded **four regressions followed by four recoveries**, with the subjective check still unknown. The fixture was restored by the test harness; this is not autonomous code repair.

**Verified remote evidence, October 15:** [Actions run 38760611627](https://github.com/himanshu748/flowproof-web/actions/runs/38760611627) passed source `2e3c3397`: 476 application tests, 19 Python tests and build. The existing Free Render service deployed it at 15:32 UTC. [Actual live-homepage receipt](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json) and [downloaded report](evidence/hosted-website/2026-10-15T15-37-09Z/live-report.html) verify Gemma proposals, deterministic network execution, negative control and Tiger storage. The CI fixture results below and earlier provider proofs are separate. [Deployment history](DEPLOYMENT.md).

| Controlled website state | Passed | Failed | Unverified |
| ------------------------ | -----: | -----: | ---------: |
| Healthy                  |      5 |      0 |          1 |
| Intentionally broken     |      1 |      4 |          1 |
| Restored healthy         |      5 |      0 |          1 |

The saved fixture plan checks the contact destination. The public brief parser checks its visible label. Their broken results therefore differ: four failures in the fixture plan versus three in the public sample flow. Compare definitions as well as status counts.

## What the open models actually did

- **Gemma:** the earlier 10:55 UTC hosted native `gemma-4-26b-a4b-it` request used 335 input / 300 output tokens. Its provider/validation call took 7.502 seconds; the Sentry proposal root took 22.09 seconds including startup. Two real Mastra steps ran in an isolated worker (175.07 MiB maximum RSS). Unapproved execution returned 409. After verifier approval, unchanged checks produced five passes → three failures/two passes → five passes, one unverified judgment throughout; 15 PNGs and three reports were downloaded with hashes retained. This is synthetic verification, not human validation. [Proof, earlier failed attempts and limits](PUBLIC_GEMMA.md).
- **Tinker:** real Qwen3.5-4B LoRA used **69.55% fewer input tokens** than few-shot on the same 24-request synthetic cohort, implying **55.52% lower inference-only cost** at recorded uncached rates. This is an estimate, not billed savings: reference agreement fell from 23/24 to 22/24 and latency increased. Training plus one-day checkpoint storage would amortize after 87 comparable requests; that projection was not executed. Zero human-validated examples. [Raw receipts, exact cost calculation and tradeoffs](MODEL_RESULTS.md). A newer October 15 application-smoke sampler was separately renewed under a bounded promotional-credit allowance. Its protected Render route now has [one actual hosted request](HOSTED_TINKER.md): 260 input / 249 output tokens, unapproved execution rejected, then verifier-approved healthy/broken/restored browser outcomes. It does not inherit the frozen benchmark’s accuracy result; 8,912 reserved tokens are a budget bound, not actual usage.
- **Backboard:** one protected hosted write/search recovered all six synthetic audit facts. The immediate free balance fell $4.99→$4.98; paid balance stayed unchanged. This is separate from the earlier local proof. Anonymous/cross-visitor access was denied and the two-call allowance is exhausted. [Operator scope, ephemeral ledger and receipt](BACKBOARD_VERIFICATION.md).
- **Sentry:** the earlier 10:55 hosted proposal root and two child spans were independently observed in the authenticated dashboard. The privacy allowlist excludes briefs, model output and credentials. This establishes one proposal trace, not browser-audit or error ingestion. [Trace and screenshot](SENTRY_HOSTED.md).
- **Tiger Data:** [actual hosted proof](TIGER_VERIFICATION.md) saved and read three synthetic audits and two later actual-homepage audits with matching JSON, retrieved the failed mobile assertion by lexical search and denied cross-visitor access. The dedicated role uses strict system-CA/hostname TLS and has only read/insert permissions on its application tables. This credit-covered metered trial stores screenshot references, not image bytes or hosted vectors; access expires October 20. Earlier isolated vector/screenshot proofs remain separate. FieldIssue’s read-only postcheck confirmed it was live and unchanged.
- **Temporal:** [real hosted CI recovery](TEMPORAL.md) restarted the worker and server while preserving the workflow/run and one browser execution. Nine evidence-file hashes are retained, with no artifact upload. This is a development-server proof on a public runner, not an always-on Render worker or Temporal Cloud.

## Category position and remaining gates

**Primary: Best Use of GitHub Copilot, through GitHub Actions.** The current official category expressly includes “automate your project with GitHub Actions.” This entry claims that route, not Copilot coding or review. Gemma is supported by the actual hosted proposal-to-browser workflow above, with bounded Mastra orchestration. Render is an established hosting route. Tiger's hosted persistence, Sentry's observed trace and Temporal's CI recovery add concrete supporting evidence; Tinker's quality/cost tradeoff stays explicit. [Official categories](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

The full PRD is unfinished: human dataset validation, an authorized external client-site run, customer feedback and other provider gates remain open. Local Entire provenance and a Free-plan SerpApi search have [separate receipts](INTEGRATIONS.md); SerpApi is not mounted publicly, ElevenLabs is unverified and .tech is missing. Hosted Tinker, Tiger, Gemma/Mastra, Sentry and protected Backboard are evidenced within the limits above; Temporal is hosted CI only. No completed founder feedback or independent customer validation has been recorded. [Full PRD assessment](PRD_STATUS.md).

The article remains a local draft, not a DEV submission. The author confirmed on October 15 that Briefstamp is their only Week 2 entry; the one-entry question is resolved. Before publishing: review the article, confirm eligibility, recheck the exact release if changed and preserve all limitations. Only the first entry counts. Deadline: **October 18, 11:59 PM PDT / October 19, 12:29 PM IST**. [Official rules](https://dev.to/page/hacktoberfest-week2-2026-10-12-contest-rules).
