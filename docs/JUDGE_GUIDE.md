# Briefstamp: a three-minute judge visit

**Live-site preset status: implemented in the release candidate; hosted network verification is pending.** The last verified release is `2a8eae95`, whose [synthetic Tinker/Tiger proof](HOSTED_TINKER.md) remains separate. The steps below describe the candidate UI and must not be read as a completed live-site audit. If the live card is absent on the deployed site, use the verified Forma Studio path below.

## Audit the actual Briefstamp homepage

1. Open [the workspace](https://flowproof-demo.onrender.com/#demo). The Free Render service may need time to wake. In Review, Overview or Projects, choose **Audit this live site**. Its target is the owner-authorized `https://flowproof-demo.onrender.com/` homepage; visitors cannot substitute another URL.
2. Review the six proposed checks: heading, visible text, link label, image alternatives, mobile width and a subjective judgment. The initial draft is labelled deterministic. Optionally consent to the fixed public brief and choose **Generate with Gemma**. Opening the card makes no model call, and no private client text is sent. If generation is unavailable, the labelled draft remains usable.
3. Read the expected results, choose **Approve all checks**, then **Save & run audit**. Inspect actual observations and screenshots. The welcoming/trustworthy judgment must remain **unverified**, even when executable assertions pass.
4. Open the delivery report and download its HTML before the visitor session expires. It links requirements to observed results and embeds the captured screenshots. A pass proves that assertion on the captured page/viewport, not the entire website.

This preset uses real HTTPS fetches and Playwright against the published homepage. Page JavaScript is disabled; requests retain the runner’s certificate, public-network, same-origin, timeout and byte limits. The candidate build prerenders the real landing content and serves its fonts locally so those checks can inspect the page without running scripts. This does not test JavaScript interactions, checkout, forms or arbitrary customer sites. Tinker remains restricted to the synthetic sample; Gemma’s live-site route accepts only the fixed public brief.

## Make a controlled failure

After a successful live audit, open the heading’s **Edit check** and change **Expected result** to `This heading must not exist — judge control`. Editing clears its approval. Review and approve the edited check, then run again: the actual observed heading should disagree with that expectation. The result must fail or report a genuine execution block, never silently pass. The public server and page are not changed.

This is a deliberately wrong assertion, **not a website regression**: because the expectation changed, the comparison must not count it as a regression or recovery. Restore `Send the site. Show the proof.`, approve again and rerun if the session’s four-audit allowance permits. These live outcomes are a test procedure, not claimed results until a hosted receipt is retained.

## Or inspect the verified broken website fixture

Use Forma Studio to see a real website-state regression under unchanged checks. Approve its plan, audit the healthy sample, switch to the broken sample and audit, then restore healthy and audit again. The retained public-brief proof recorded **5 passed / 1 unverified → 2 passed / 3 failed / 1 unverified → 5 passed / 1 unverified**. The separate CI fixture plan checks a link destination and records four failures instead of three. Both use real Chromium, with different assertion definitions. [Exact receipts](DEPLOYMENT.md).

Choose this path instead of adding every audit above to one visitor session. The fixture is synthetic and labelled; it does not substitute for the pending actual-homepage proof.

## Evidence and limits

[Entry evidence](HACKATHON_ENTRY.md) · [Integration ledger](INTEGRATIONS.md) · [Model cost/quality results](MODEL_RESULTS.md) · [Tiger scope](TIGER_VERIFICATION.md) · [Temporal CI recovery](TEMPORAL.md).

Tiger currently stores audit JSON and screenshot references, not screenshot bytes or hosted vectors. The [exact-target SQL migration](hosted-tiger-live-target.sql) and [strict-TLS migration receipt](evidence/tiger-hosted/2026-10-15/live-target-migration.json) permit the owned homepage; that schema update alone does not prove the live audit works. The service is a credit-covered metered trial with an October 20 access boundary. Tinker and Backboard are operator-protected and have separate bounded allowances.

All integrations are not complete: SerpApi is not mounted publicly, ElevenLabs is unverified, Entire evidence is local and .tech is missing. No customer feedback, human dataset validation or winning outcome is claimed. The DEV article remains a draft.
