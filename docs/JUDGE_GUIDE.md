# Briefstamp: a three-minute judge visit

**The real homepage audit is verified on release `816d869e`.** The [hosted receipt](evidence/hosted-website/2026-10-15T12-19-58Z/receipt.json) records five passes and one unverified judgment, then a deliberate wrong-expectation failure. It used labelled deterministic checks and zero model calls. [Actual UI report with five screenshots](evidence/hosted-website/2026-10-15T12-15Z/ui-live-report.html).

## Audit the actual homepage

1. Open [the workspace](https://flowproof-demo.onrender.com/#demo). The Free Render service may need time to wake. In Review, Overview or Projects, choose **Audit this live site**. The target is the owner-authorized `https://flowproof-demo.onrender.com/` homepage.
2. Review six checks: heading, visible text, link label, image alternatives, mobile width and a subjective judgment. The initial draft is labelled deterministic. Optional **Generate with Gemma** requires consent to the fixed public brief. During the latest live-site verification, hosted generation failed and a native diagnostic returned HTTP 500; use the clearly labelled draft if generation is unavailable. [Dated AI evidence and incident](PUBLIC_GEMMA.md).
3. Read the expected results, choose **Approve all checks**, then **Save & run audit**. Inspect the observed text and screenshots. The welcoming/trustworthy judgment stays **unverified**.
4. Open the delivery report and download its HTML before the session expires. The report joins requirements, assertions, observations and embedded screenshots. A pass covers its specific assertion and captured viewport.

The runner visits the real HTTPS site with page JavaScript disabled and bounded same-origin resources. The landing content is prerendered and fonts are served locally. This does not test JavaScript flows, forms, purchases or arbitrary client URLs. Opening a project makes no model call, and no private client text is sent. Tinker remains synthetic-only.

## See a controlled failure

Open the heading’s **Edit check** and set **Expected result** to `Briefstamp negative control: this heading is intentionally absent`. Editing clears approval. Review and approve it, then run again. The retained proof observed **4 passed / 1 failed / 1 unverified**, with actual page headings in the evidence. The public site was not changed.

This is a deliberately wrong assertion, not a website regression. The comparison must not count a changed expectation as a regression or recovery. Restore `Send the site. Show the proof.`, approve and rerun if the four-audit visitor allowance permits; that restoration is an optional procedure, not a retained live-site result.

Both verified audits were read back from Tiger with matching JSON. Lexical retrieval found the failed heading; another visitor could not access the project’s audit/history. [Receipt](evidence/hosted-website/2026-10-15T12-19-58Z/receipt.json).

## Or inspect a website-state regression

Use Forma Studio instead to audit healthy, broken and restored synthetic pages under unchanged checks. The public-brief proof recorded **5 passed / 1 unverified → 2 passed / 3 failed / 1 unverified → 5 passed / 1 unverified**. The separate CI fixture checks the contact destination and records four failures. These are different plans, both executed by real Chromium. [Exact evidence](DEPLOYMENT.md).

Choose one path rather than adding every audit to the same visitor session.

## Evidence and limits

[Entry evidence](HACKATHON_ENTRY.md) · [Integration ledger](INTEGRATIONS.md) · [Tinker tradeoffs](MODEL_RESULTS.md) · [Tiger scope](TIGER_VERIFICATION.md) · [Temporal CI recovery](TEMPORAL.md).

Tiger stores audit JSON and screenshot references, not image bytes or hosted vectors. Its [exact-target SQL](hosted-tiger-live-target.sql) and [final strict-TLS constraint receipt](evidence/tiger-hosted/2026-10-15/live-target-constraint-final.json) restrict storage to the sample or owned homepage. The credit-covered metered trial has an October 20 access boundary. Tinker and Backboard remain operator-protected with bounded allowances.

SerpApi is not mounted publicly, ElevenLabs is unverified, Entire evidence is local and .tech is missing. No customer feedback, human dataset validation or winning outcome is claimed. The submission is a draft for the author to publish.
