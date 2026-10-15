# Briefstamp: a short path through the evidence

**For freelance website handoffs:** turn an agreed requirement into a reviewed check, an observed result and a portable report. A passing check proves its specific assertion; it does not certify the entire website.

## Try it in three minutes

The [judge guide](JUDGE_GUIDE.md) describes the new **Audit this live site** candidate for the actual owner-authorized Briefstamp homepage, including a deliberately wrong expectation as a failure control. Its hosted network proof is pending. The following Forma Studio path retains completed synthetic evidence.

1. [Open Briefstamp](https://flowproof-demo.onrender.com/) and choose **Open demo**. The free Render service may take time to wake. Use the synthetic Forma Studio sample.
2. Review the Gemma card, consent to sending the fixed synthetic brief and request generation. Review and approve the executable checks, then run an audit. Inspect the heading and mobile evidence; the subjective requirement remains unverified.
3. Try the deliberately broken sample, inspect an actual failure, then download its HTML delivery report. Screenshots are embedded. Keep the download before the temporary visitor session expires.

Initial drafts are explicitly deterministic; opening the demo makes no model call. The opt-in Gemma action is verified on free Render release `e43dbe74`: **open model proposes → developer approves → deterministic browser observes**. The model dashboard contains frozen Tinker experiments; a separate operator-protected live Tinker action has its own proof and allowance. [Actual hosted Gemma/Mastra proof and limits](PUBLIC_GEMMA.md).

## Follow the regression proof

[GitHub Actions workflow](../.github/workflows/audit.yml) · [Public runs](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Audit script](../scripts/audit-sample.ts)

The regression sequence executed **healthy → intentionally broken → restored healthy** with the same approved fixture plan. The downloaded `flowproof-evidence` artifact contains 15 PNG screenshots, three standalone HTML reports, per-run JSON, `comparison.json` and a readable summary. It recorded **four regressions followed by four recoveries**, with the subjective check still unknown. The fixture was restored by the test harness; this is not autonomous code repair.

**Verified remote evidence, October 15:** [Actions run 38727532102](https://github.com/himanshu748/flowproof-web/actions/runs/38727532102) passed source `2a8eae95c95cf91adb0cd2bed155e6dbb81249ef`: 423 application tests, 19 Python tests and production build. The existing Free Render service deployed it at 11:33 UTC. Its [hosted receipt](evidence/hosted-open-model/2026-10-15T11-34-19Z/receipt.json) verifies protected Tinker generation, healthy/broken/restored Chromium and Tiger persistence/retrieval. [Temporal CI](TEMPORAL.md) also passed on this revision. Earlier hosted Gemma/Mastra/Sentry and Backboard proofs remain separate. [Deployment history](DEPLOYMENT.md) preserves failures and prior artifacts.

| Controlled website state | Passed | Failed | Unverified |
| ------------------------ | -----: | -----: | ---------: |
| Healthy                  |      5 |      0 |          1 |
| Intentionally broken     |      1 |      4 |          1 |
| Restored healthy         |      5 |      0 |          1 |

The saved fixture plan checks the contact destination. The public brief parser checks its visible label. Their broken results therefore differ: four failures in the fixture plan versus three in the public sample flow. Compare definitions as well as status counts.

## What the open models actually did

- **Gemma:** one actual hosted native `gemma-4-26b-a4b-it` request used 335 input / 300 output tokens. Its provider/validation call took 7.502 seconds; the Sentry proposal root took 22.09 seconds including startup. Two real Mastra steps ran in an isolated worker (175.07 MiB maximum RSS). Unapproved execution returned 409. After verifier approval, unchanged checks produced five passes → three failures/two passes → five passes, one unverified judgment throughout; 15 PNGs and three reports were downloaded with hashes retained. This is synthetic verification, not human validation. [Proof, earlier failed attempts and limits](PUBLIC_GEMMA.md).
- **Tinker:** real Qwen3.5-4B LoRA used **69.55% fewer input tokens** than few-shot on the same 24-request synthetic cohort, implying **55.52% lower inference-only cost** at recorded uncached rates. This is an estimate, not billed savings: reference agreement fell from 23/24 to 22/24 and latency increased. Training plus one-day checkpoint storage would amortize after 87 comparable requests; that projection was not executed. Zero human-validated examples. [Raw receipts, exact cost calculation and tradeoffs](MODEL_RESULTS.md). A newer October 15 application-smoke sampler was separately renewed under a bounded promotional-credit allowance. Its protected Render route now has [one actual hosted request](HOSTED_TINKER.md): 260 input / 249 output tokens, unapproved execution rejected, then verifier-approved healthy/broken/restored browser outcomes. It does not inherit the frozen benchmark’s accuracy result; 8,912 reserved tokens are a budget bound, not actual usage.
- **Backboard:** one protected hosted write/search recovered all six synthetic audit facts. The immediate free balance fell $4.99→$4.98; paid balance stayed unchanged. This is separate from the earlier local proof. Anonymous/cross-visitor access was denied and the two-call allowance is exhausted. [Operator scope, ephemeral ledger and receipt](BACKBOARD_VERIFICATION.md).
- **Sentry:** the exact hosted proposal root and two child spans were independently observed in the authenticated dashboard. The privacy allowlist excludes briefs, model output and credentials. This establishes one proposal trace, not browser-audit or error ingestion. [Trace and screenshot](SENTRY_HOSTED.md).
- **Tiger Data:** [actual hosted proof](TIGER_VERIFICATION.md) saved and read three audits with matching JSON, retrieved the failed mobile assertion by lexical search and denied cross-visitor access. The dedicated role uses strict system-CA/hostname TLS and has only read/insert permissions on its application tables. This credit-covered metered trial stores screenshot references, not image bytes or hosted vectors; access expires October 20. Earlier isolated vector/screenshot proofs remain separate. FieldIssue’s read-only postcheck confirmed it was live and unchanged.
- **Temporal:** [real hosted CI recovery](TEMPORAL.md) restarted the worker and server while preserving the workflow/run and one browser execution. Nine evidence-file hashes are retained, with no artifact upload. This is a development-server proof on a public runner, not an always-on Render worker or Temporal Cloud.

## Category position and remaining gates

**Primary: Best Use of GitHub Copilot, through GitHub Actions.** The current official category expressly includes “automate your project with GitHub Actions.” This entry claims that route, not Copilot coding or review. Gemma is supported by the actual hosted proposal-to-browser workflow above, with bounded Mastra orchestration. Render is an established hosting route. Tiger's hosted persistence, Sentry's observed trace and Temporal's CI recovery add concrete supporting evidence; Tinker's quality/cost tradeoff stays explicit. [Official categories](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

The full PRD is unfinished: human dataset validation, an authorized external client-site run, customer feedback and other provider gates remain open. Local Entire provenance and a Free-plan SerpApi search have [separate receipts](INTEGRATIONS.md); SerpApi is not mounted publicly, ElevenLabs is unverified and .tech is missing. Hosted Tinker, Tiger, Gemma/Mastra, Sentry and protected Backboard are evidenced within the limits above; Temporal is hosted CI only. No completed founder feedback or independent customer validation has been recorded. [Full PRD assessment](PRD_STATUS.md).

The article remains a local draft, not a DEV submission. The author confirmed on October 15 that Briefstamp is their only Week 2 entry; the one-entry question is resolved. Before publishing: review the article, confirm eligibility, recheck the exact release if changed and preserve all limitations. Only the first entry counts. Deadline: **October 18, 11:59 PM PDT / October 19, 12:29 PM IST**. [Official rules](https://dev.to/page/hacktoberfest-week2-2026-10-12-contest-rules).
