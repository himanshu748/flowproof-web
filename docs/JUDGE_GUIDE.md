# Briefstamp: a three-minute judge visit

Approve a brief, watch the browser check it, and download the evidence.

[Open Briefstamp](https://flowproof-demo.onrender.com/#demo) · [Watch the 68-second video](https://youtu.be/xve020VJl0s) · [MP4 backup](https://raw.githubusercontent.com/himanshu748/flowproof-web/main/docs/demo/briefstamp-demo.mp4) · [Video provenance](demo/README.md)

## Audit the actual homepage

1. Choose **Audit this live site** in Review, Overview or Projects. Its owner-authorized target is Briefstamp's published homepage.
2. Read the six proposed checks and their expected results. The starter draft is labelled templates; **Generate with Gemma** is optional and requires consent to the fixed public brief.
3. Choose **Approve all checks**, then **Save & run audit**. Inspect the observed text and browser screenshots. The subjective welcoming/trustworthy requirement stays **unverified**.
4. Choose **Export delivery report** to keep the portable HTML, with its requirements, observations and embedded screenshots.

The [October 16 live-site receipt](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) records **5 passed / 0 failed / 1 unverified** on release `64a62729018fc2372611c7b21bfffecf3b779556`, using one real Gemma attempt (389 input / 296 output tokens) through Mastra and explicit verifier approval. Its exact [Sentry trace](evidence/hosted-website/2026-10-16T09-10-55Z/sentry-verification.json) was independently dashboard-verified: three proposal spans, root status `ok`. [Open the actual downloaded report](evidence/hosted-website/2026-10-16T09-10-55Z/live-report.html).

## Prove a failure

Open the heading's **Edit check** and set **Expected result** to `Briefstamp negative control: this heading is intentionally absent`. Editing clears approval. Review, approve and run again. The retained control recorded **4 passed / 1 failed / 1 unverified**, with actual page headings in its evidence.

This changes the assertion, not the website. The comparison must not count it as a website regression or recovery. Both retained audits round-tripped through Tiger with matching JSON; keyword retrieval recovered the failed heading, and another visitor was denied access. [Receipt](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json).

## Or compare broken and restored pages

Choose **Projects → Forma Studio**. Approve and run its healthy sample, change **Sample condition** to **Intentionally broken website**, then review, approve and run again. Switch back to healthy, reapprove and rerun to see recoveries under unchanged assertions.

The [captured hosted journey](demo/journey.json) observed **5/0/1 → 2/3/1 → 5/0/1** (passed/failed/unverified), with three recoveries. The separate CI fixture checks a contact destination and records four failures. [Exact CI evidence](evidence/ci-regression-2026-10-15.json). One warm-server visit reached its first HTML download in **64.089 seconds**; that observation includes capture/tool overhead and is not an SLA.

Choose one audit path per visitor session.

## Inspect the protected partner proof

These are operator-only integrations, so a judge can inspect receipts without credentials or spending an allowance. The [12:14 UTC hosted agent receipt](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/receipt.json) records a complete evidence-review loop on release `f990d9a14ae95dc322e4d81a411e9dd764ff9207`:

1. Native Google Gemma selected **failure history** and **search visibility**.
2. Tiger returned three saved failures, ranking mobile overflow first even though the paraphrase had no lexical match. SerpApi returned HTTP 200 and zero matching homepage search results.
3. A second Gemma response cited both actual observations. The original **2 passed / 3 failed / 1 unverified** audit was unchanged. Duplicate execution returned 409; tokenless and cross-visitor requests returned 404; missing consent returned 400.

This used two model requests without retries: **1,759 input / 773 output tokens**. [Actual tool and model results](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/agent-run.json). It is a native JSON tool loop; Mastra's separate receipt covers proposal generation. The history tool uses precomputed 384-dimensional MiniLM vectors in PostgreSQL arrays with three fixed queries and exact-text matches, not pgvector or general hosted embedding inference. Zero search results do not establish de-indexing or an uncached search.

The earlier [09:13 UTC optional proof](HOSTED_OPTIONAL.md) separately ran one search, one ElevenLabs counts-only narration and a Backboard write/search pair. All six Backboard facts matched the actual audit. The 92,386-byte MP3 decoded as 22.987755 seconds; audible wording/listening remains unverified.

The optional-operation and all four agent allowances are consumed, with [spent agent configuration verified](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/spent-reservations.json). Earlier failures and the partial search-timeout run remain retained. A restart or refreshed account timestamp does not replenish them. [Allowance boundaries](PROVIDER_ALLOWANCES.md) · [Release CI](https://github.com/himanshu748/flowproof-web/actions/runs/38898518897): **871 app tests, 19 Python tests, build and real Chromium audits**.

## Limitations

- Free Render may wake slowly before serving HTML. The app provides startup/retry states afterward. Sessions last up to 30 minutes, may reset on restart and allow four audits; download reports before leaving. Expiry recovery opens fresh, unapproved checks without replaying an action.
- Only the sample and owned homepage are public targets. Browser scripts are disabled; JavaScript flows, forms and purchases are outside scope. A pass covers its specific assertion and viewport. The video used templates with zero model calls; the newer live negative-control receipt used Gemma. Historical HTTP 500 and invalid-plan failures remain in the [diagnosis](GEMMA_LIVE_SITE.md).
- Tiger stores JSON, image references and the bounded precomputed history vectors; image bytes remain separate. The credit-covered metered trial has an October 20 at 00:00 UTC access boundary. [TLS and exact-target storage restrictions](TIGER_VERIFICATION.md). Tinker is synthetic-only and retains one unused call / 41,088 reserved tokens; no new Tinker inference ran during the October 16 refresh. Tinker/Sentry funding proofs expire October 17 at 08:23:47.620 UTC; Gemma/Tiger retain October 20 gates. Search, speech, Backboard and agent proofs remain operator-protected with consumed budgets.
- SerpApi and ElevenLabs are evidenced hosted operator routes, unavailable to anonymous visitors. ElevenLabs is a noncommercial synthetic demonstration; audible wording remains unverified. Entire proof is local and Temporal recovery is local/CI only, with no always-on Render worker. The author declined .tech and retains the Render domain. The author reports that freelancer friend Priyanshu tried Briefstamp and said “it's good”; [workflow details and willingness to pay remain unknown](CUSTOMER_VALIDATION.md). Human dataset validation and a winning outcome are not claimed. The author reviews and publishes the submission.

[Entry evidence](HACKATHON_ENTRY.md) · [Integration ledger](INTEGRATIONS.md) · [Tinker tradeoffs](MODEL_RESULTS.md) · [Temporal recovery](TEMPORAL.md) · [UI QA](evidence/judge-qa-2026-10-15/receipt.json)
