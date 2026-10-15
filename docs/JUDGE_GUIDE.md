# Briefstamp: a three-minute judge visit

Approve a brief, watch the browser check it, and download the evidence.

[Open Briefstamp](https://flowproof-demo.onrender.com/#demo) · [Watch the 68-second video](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/demo/briefstamp-demo.mp4) · [Video provenance](demo/README.md)

## Audit the actual homepage

1. Choose **Audit this live site** in Review, Overview or Projects. Its owner-authorized target is Briefstamp's published homepage.
2. Read the six proposed checks and their expected results. The starter draft is labelled templates; **Generate with Gemma** is optional and requires consent to the fixed public brief.
3. Choose **Approve all checks**, then **Save & run audit**. Inspect the observed text and browser screenshots. The subjective welcoming/trustworthy requirement stays **unverified**.
4. Choose **Export delivery report** to keep the portable HTML, with its requirements, observations and embedded screenshots.

The [retained live-site receipt](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json) records **5 passed / 0 failed / 1 unverified** on release `2e3c3397`, using a real Gemma proposal through Mastra and explicit verifier approval. [Open the actual downloaded report](evidence/hosted-website/2026-10-15T15-37-09Z/live-report.html).

## Prove a failure

Open the heading's **Edit check** and set **Expected result** to `Briefstamp negative control: this heading is intentionally absent`. Editing clears approval. Review, approve and run again. The retained control recorded **4 passed / 1 failed / 1 unverified**, with actual page headings in its evidence.

This changes the assertion, not the website. The comparison must not count it as a website regression or recovery. Both retained audits round-tripped through Tiger with matching JSON; keyword retrieval recovered the failed heading, and another visitor was denied access. [Receipt](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json).

## Or compare broken and restored pages

Choose **Projects → Forma Studio**. Approve and run its healthy sample, change **Sample condition** to **Intentionally broken website**, then review, approve and run again. Switch back to healthy, reapprove and rerun to see recoveries under unchanged assertions.

The [captured hosted journey](demo/journey.json) observed **5/0/1 → 2/3/1 → 5/0/1** (passed/failed/unverified), with three recoveries. The separate CI fixture checks a contact destination and records four failures. [Exact CI evidence](evidence/ci-regression-2026-10-15.json). One warm-server visit reached its first HTML download in **64.089 seconds**; that observation includes capture/tool overhead and is not an SLA.

Choose one audit path per visitor session.

## Limitations

- Free Render may wake slowly before serving HTML. The app provides startup/retry states afterward. Sessions last up to 30 minutes, may reset on restart and allow four audits; download reports before leaving. Expiry recovery opens fresh, unapproved checks without replaying an action.
- Only the sample and owned homepage are public targets. Browser scripts are disabled; JavaScript flows, forms and purchases are outside scope. A pass covers its specific assertion and viewport. The video used templates with zero model calls; the newer live negative-control receipt used Gemma. Historical HTTP 500 and invalid-plan failures remain in the [diagnosis](GEMMA_LIVE_SITE.md).
- Tiger stores JSON and image references, not image bytes or hosted vectors. The credit-covered metered trial has an October 20 access boundary. [TLS and exact-target storage restrictions](TIGER_VERIFICATION.md). Tinker is synthetic-only; Tinker and Backboard require bounded operator allowances.
- SerpApi is not public, ElevenLabs is unverified, Entire proof is local and .tech is missing. No customer feedback, human dataset validation or winning outcome is claimed. The author reviews and publishes the submission.

[Entry evidence](HACKATHON_ENTRY.md) · [Integration ledger](INTEGRATIONS.md) · [Tinker tradeoffs](MODEL_RESULTS.md) · [Temporal recovery](TEMPORAL.md) · [UI QA](evidence/judge-qa-2026-10-15/receipt.json)
