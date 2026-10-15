# Briefstamp: a short path through the evidence

**For freelance website handoffs:** turn an agreed requirement into a reviewed check, an observed result and a portable report. A passing check proves its specific assertion; it does not certify the entire website.

## Try it in three minutes

1. [Open Briefstamp](https://flowproof-demo.onrender.com/) and choose **Open demo**. The free Render service may take time to wake. Use the synthetic Forma Studio sample.
2. Review the proposed assertions and approve the executable checks. Run an audit; inspect the heading and mobile-layout evidence. The subjective requirement remains unverified.
3. Try the deliberately broken sample, inspect an actual failure, then download its HTML delivery report. Screenshots are embedded. Keep the download before the temporary visitor session expires.

The public draft generator is explicitly deterministic. The model dashboard contains saved experiments, not live Tinker inference. This boundary is part of the product's evidence policy.

## Follow the regression proof

[GitHub Actions workflow](../.github/workflows/audit.yml) · [Public runs](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) · [Audit script](../scripts/audit-sample.ts)

The current regression script executes **healthy → intentionally broken → restored healthy** with the same approved fixture plan. It writes per-run JSON, standalone HTML reports, screenshots, `comparison.json` and a readable summary into the `flowproof-evidence` artifact. Its expected outcome is four regressions followed by four recoveries, with one subjective check still unknown. The fixture is restored by the test harness; this is not autonomous code repair.

**Verification boundary, October 15:** the new three-stage sequence passed locally, alongside 140 application tests and 17 provenance tests. Its new remote success is not yet claimed here. The preceding [published run](https://github.com/himanshu748/flowproof-web/actions/runs/38685613384) passed 106 application tests, 17 provenance tests and real healthy/broken audits. Use a new run's actual status and artifacts before citing the three-stage result as passed.

The saved fixture plan checks the contact destination. The public brief parser checks its visible label. Their broken results therefore differ: four failures in the fixture plan versus three in the public sample flow. Compare definitions as well as status counts.

## What the open models actually did

- **Gemma:** a real local three-requirement flow produced unapproved proposals, rejected premature execution, then ran the unchanged assertions after test-harness approval. Chromium observed three passes → one failure/two passes → three passes, with nine screenshots and three reports. A real Gemma explanation preserved the observed statuses. The original six-requirement brief timed out twice; that coverage remains unproved. This is neither human approval nor an accuracy benchmark. [Complete successful receipt](evidence/gemma-workflow/2026-10-15T05-55-49-919Z/receipt.json) · [Reproduction, failures and limits](GEMMA_WORKFLOW.md).
- **Tinker:** real Qwen3.5-4B prompting and LoRA experiments on one frozen synthetic cohort. Few-shot matched 23/24 references; LoRA matched 22/24 and was slower. Zero human-validated examples. [Raw results, browser pairs and costs](MODEL_RESULTS.md).
- **Tiger Data:** a separate strict-TLS no-card trial recovered two audits and ten screenshots in a fresh process and performed lexical/vector retrieval. Its temporary schema was removed. This is genuine bounded evidence, not the public demo's database. [Receipt and scope](TIGER_VERIFICATION.md).

## Category position and remaining gates

**Primary: Best Use of GitHub Copilot, through GitHub Actions.** The current official category expressly includes “automate your project with GitHub Actions.” This entry claims that route, not Copilot coding or review. Gemma is supported by the bounded local workflow above; Render is a supplementary hosting route. Tiger's isolated demonstration and Tinker's quality/cost tradeoff remain bounded secondary evidence. [Official categories](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).

The full PRD is unfinished: live Tinker generation, lasting hosted Tiger storage, human dataset validation and P1 sponsor integrations remain open. The founder has volunteered to test; no completed founder feedback or independent customer validation has been recorded. [Full PRD assessment](PRD_STATUS.md) · [Integration ledger](INTEGRATIONS.md).

The article remains a local draft, not a DEV submission. Before publishing: verify the latest deployment/workflow, review the final article, check for an existing Week 2 entry, confirm eligibility, and preserve all limitations. Only the first entry counts. Deadline: **October 18, 11:59 PM PDT / October 19, 12:29 PM IST**. [Official rules](https://dev.to/page/hacktoberfest-week2-2026-10-12-contest-rules).
