# Briefstamp: a short path through the evidence

**For freelance website handoffs:** turn an agreed requirement into a reviewed check, an observed result and a portable report. A passing check proves its specific assertion; it does not certify the entire website.

## Try it in three minutes

1. [Open Briefstamp](https://flowproof-demo.onrender.com/) and choose **Open demo**. The free Render service may take time to wake. Use the synthetic Forma Studio sample.
2. Review the proposed assertions and approve the executable checks. Run an audit; inspect the heading and mobile-layout evidence. The subjective requirement remains unverified.
3. Try the deliberately broken sample, inspect an actual failure, then download its HTML delivery report. Screenshots are embedded. Keep the download before the temporary visitor session expires.

Initial drafts are explicitly deterministic. A candidate opt-in Gemma 4 action has a real provider-to-browser proof through the public router locally; its new Render deployment is not yet verified. The intended flow is **open model proposes → developer approves → deterministic browser observes**. The model dashboard contains saved Tinker experiments, not live Tinker inference. [Native Gemma evidence and remaining hosted gates](PUBLIC_GEMMA.md).

## Follow the regression proof

[GitHub Actions workflow](../.github/workflows/audit.yml) · [Public runs](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Audit script](../scripts/audit-sample.ts)

The regression sequence executed **healthy → intentionally broken → restored healthy** with the same approved fixture plan. The downloaded `flowproof-evidence` artifact contains 15 PNG screenshots, three standalone HTML reports, per-run JSON, `comparison.json` and a readable summary. It recorded **four regressions followed by four recoveries**, with the subjective check still unknown. The fixture was restored by the test harness; this is not autonomous code repair.

**Verified remote evidence, October 15:** [Actions run 38707381753](https://github.com/himanshu748/flowproof-web/actions/runs/38707381753) passed at commit `94727b283fdb19e78eba0964a8002d0a6199b8ca`: 209 application tests across 17 files, 17 provenance tests, the production build, a fresh-process 256 MB public-runtime test and three real Chromium audits. Independently downloaded artifacts contain 25 PNGs and five portable reports, including the ordinary comparison below and a separate public-API memory check. Its [release receipt](evidence/release-2026-10-15.json) also records actual healthy/broken/restored checks on the free Render deployment at that source revision. [Deployment records](DEPLOYMENT.md) retain the earlier memory failure and its correction.

| Controlled website state | Passed | Failed | Unverified |
| ------------------------ | -----: | -----: | ---------: |
| Healthy                  |      5 |      0 |          1 |
| Intentionally broken     |      1 |      4 |          1 |
| Restored healthy         |      5 |      0 |          1 |

The saved fixture plan checks the contact destination. The public brief parser checks its visible label. Their broken results therefore differ: four failures in the fixture plan versus three in the public sample flow. Compare definitions as well as status counts.

## What the open models actually did

- **Gemma:** a real native `gemma-4-26b-a4b-it` request through the public router locally used 335 input / 300 output tokens in 7.937 seconds. After harness approval, unchanged checks produced healthy five passes, broken three failures/two passes, then five passes again; the subjective check remained unverified. Fifteen screenshots and three reports were retained. Four earlier native attempts failed and remain recorded. This is not human validation or hosted Render proof. [Native workflow and deployment gates](PUBLIC_GEMMA.md). The separate [local Gemma 3 workflow](GEMMA_WORKFLOW.md) retains its narrower success and two full-brief timeouts.
- **Tinker:** real Qwen3.5-4B LoRA used **69.55% fewer input tokens** than few-shot on the same 24-request synthetic cohort, implying **55.52% lower inference-only cost** at recorded uncached rates. This is an estimate, not billed savings: reference agreement fell from 23/24 to 22/24 and latency increased. Training plus one-day checkpoint storage would amortize after 87 comparable requests; that projection was not executed. Zero human-validated examples. [Raw receipts, exact cost calculation and tradeoffs](MODEL_RESULTS.md).
- **Backboard:** a real operator run stored and retrieved the synthetic audit, preserving all six statuses. The immediate balance difference was $0.01 from free credits; paid credits were unchanged. Protected hosted routes are implemented but their Render execution is pending. [Cloud receipt and funding boundary](BACKBOARD_VERIFICATION.md).
- **Tiger Data:** a separate strict-TLS no-card trial recovered two audits and ten screenshots in a fresh process and performed lexical/vector retrieval. Its temporary schema was removed. This is genuine bounded evidence, not the public demo's database. [Receipt and scope](TIGER_VERIFICATION.md).

## Category position and remaining gates

**Primary: Best Use of GitHub Copilot, through GitHub Actions.** The current official category expressly includes “automate your project with GitHub Actions.” This entry claims that route, not Copilot coding or review. Gemma is supported by the bounded local/native workflows above; the new public generation path still needs a hosted receipt. Render is an established hosting route. Tiger's isolated demonstration and Tinker's quality/cost tradeoff remain bounded secondary evidence. [Official categories](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

The full PRD is unfinished: lasting hosted Tiger storage, human dataset validation and the remaining live-provider gates remain open. A one-heading Tinker operator workflow, local Mastra/Sentry, Temporal recovery, Entire provenance, real Backboard retrieval and a free SerpApi search have [separate receipts](INTEGRATIONS.md). The candidate isolated Mastra worker has a local SDK fixture proof; hosted/live-provider orchestration is pending. The founder has volunteered to test; no completed founder feedback or independent customer validation has been recorded. [Full PRD assessment](PRD_STATUS.md) · [Integration ledger](INTEGRATIONS.md).

The article remains a local draft, not a DEV submission. The author confirmed on October 15 that Briefstamp is their only Week 2 entry; the one-entry question is resolved. Before publishing: verify the final deployment/workflow, review the article, confirm eligibility and preserve all limitations. Only the first entry counts. Deadline: **October 18, 11:59 PM PDT / October 19, 12:29 PM IST**. [Official rules](https://dev.to/page/hacktoberfest-week2-2026-10-12-contest-rules).
