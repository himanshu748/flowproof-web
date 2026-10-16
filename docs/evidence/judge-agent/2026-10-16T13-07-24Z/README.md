# Public judge flow: October 16, 2026

This bundle retains every outcome from verification of the tokenless `/#agent` flow. Each visitor explicitly approved the fixed synthetic checks and consented to model/search processing. No operator token was sent on the public review route. Browser acceptance results remain separate from model findings.

| Attempt | Client and source | Actual result | Evidence |
| --- | --- | --- | --- |
| 1, 13:07 UTC | In-app browser, `bf594b7a00a7300063acbccbd3d3bed167dc5c5a` | Gemma selected both tools; Tiger returned three rows; SerpApi HTTP 200, zero results, 74 ms. Final Gemma request returned HTTP 500 `INTERNAL`; token usage for that request is unknown. Slot 1 stays consumed. | [Receipt](attempt-1/agent-run.json), [Tiger verification](attempt-1/verification.json), [actual failure UI](attempt-1/browser-failure.jpg), [downloaded browser report](attempt-1/browser-report.html) |
| 2, 13:10 UTC | Independent tokenless HTTP visitor, same source | Both actual Gemma requests HTTP 200: 1,770 input / 791 output tokens. The model selected both tools and cited three stored failures plus the zero-result search. SerpApi HTTP 200, 31 ms. Tiger persisted the exact receipt. Slot 2 stays consumed. | [Receipt](attempt-2/agent-run.json), [HTTP execution](attempt-2/execution.json), [independent verification](attempt-2/verification.json), [browser report](attempt-2/browser-report.html) |
| 3, 13:20 UTC | In-app browser, `e6a53da1bd85b0711a2cc18e14843f47fcd97fb7` | Both Gemma requests HTTP 200, 1,723 input / 793 output tokens; Tiger returned three rows. Search aborted at 29,983 ms with no HTTP status; upstream completion is unknown. The model cited search unavailability. Slot 3 stays consumed. | [Receipt](attempt-3/agent-run.json), [verification](attempt-3/verification.json), [actual partial UI](attempt-3/browser-partial.jpg), [browser report](attempt-3/browser-report.html) |
| 4, 13:37 UTC | In-app browser, `c551f59ea45c0cae19ab0aea089a3e3573d1efe1` | First Gemma request returned HTTP 500 `INTERNAL` in 1,037 ms, usage unknown. No tool or second model request ran. Slot 4, including its unused request capacity, remains consumed. | [Receipt](attempt-4/agent-run.json), [verification](attempt-4/verification.json), [desktop](attempt-4/browser-failure.jpg), [390px recovery](attempt-4/mobile-failure.jpg), [downloaded report](attempt-4/browser-report.html) |

All four source audits recorded **2 passed / 3 failed / 0 blocked / 1 unverified**, unchanged by the agent. The history query returned actual stored observations with precomputed MiniLM cosine/full-text RRF. Its mobile paraphrase had no lexical match and ranked the overflow failure first at cosine `0.3781263417931506`. This is a three-query exact-text catalog using PostgreSQL arrays, not general hosted embedding inference or pgvector. A zero-result search does not establish de-indexing, ranking, or uncached freshness.

The first failure was not retried or relabelled success. It was recovered read-only in another in-app browser tab. The same provider, model, prompt format and request byte length completed in the later independent visitor; the retained 500 establishes an upstream `INTERNAL` response, not its undisclosed root cause. Authentication worked on the preceding request; the failure arrived in 804 ms, not at the timeout. No rate-limit response was reported.

## Quota and persistence proof

[Funding](funding-before.json) confirmed existing Free Render, SerpApi Active Free Plan / monthly price 0 / zero extra credits / 215 searches remaining, free-only Google Gemma pricing, and a no-card credit-covered Tiger trial. The trial is not a permanent free database. The signed-in Tiger billing view showed 20 trial days remaining and positive credits; account identifiers and balances are omitted.

The [prepared grant](grant-prepared.json) is a separate fixed UUID, capped at **12 total / six per hour / one per visitor session**, with **two physical model requests and one search maximum** per run. It expires **October 20 at 00:00 UTC**. The server verifies live free SerpApi funding before every reservation and current free Gemma pricing before inference. Failures and ambiguous commits are not refunded. A session limit is not a per-person identity guarantee.

[Deployment and migration](deployment.json) added three tables in Briefstamp's existing isolated schema, with SELECT/INSERT-only runtime privileges and verified TLS. All four old reservations and their raw spent proofs remained unchanged. Grant, slot and session constraints persist independently of Render's ephemeral filesystem. Each reservation commits before provider access; immutable results support scoped read-only recovery.

At the [13:11 UTC readback](attempt-2/verification.json), **two new judge slots were consumed and ten remained**. The older four tranches still held **12 model / four agent-search reservations**, with six actual model attempts and one earlier search completion unknown; the older standalone search reservation remains separate. The two new slots reserved four model / two search calls and made four actual model attempts and two actual HTTP 200 search requests. The account still displayed 215 free searches; an unchanged counter is not proof that nothing was consumed.

Live negative controls returned 403 for missing/untrusted Origin, 400 for absent consent, and 404 for cross-session source access and tokenless operator access. Repeating the completed public review returned 409. Another fresh visitor saw aggregate counts but no other visitor's result. These verification reads made no model or search requests.

## Verification boundaries

The successful second run is an HTTP client receipt. No complete successful agent screen was observed in the in-app browser: its first/fourth attempts failed upstream, and its third returned honest search unavailability. Their screens, downloads and strict-TLS readbacks are retained separately. The recorded 68-second product video still uses labelled template checks; it is not footage of this agent loop.

[Post-restart readback](after-restart.json) and [actual UI](after-restart.jpg) confirmed two slots still spent after the receipt-fix deployment. The third run subsequently left nine slots, with 214 Free Plan searches shown at 13:25 UTC. Its aborted search is not a confirmed zero-result response or a refunded reservation.

Source `c551f59` subsequently gives the single public search 60 seconds inside the unchanged 90-second agent deadline. It adds no request or retry and preserves the same grant. [CI](ci.json) passed 963 app tests, 19 Python tests, build and real Chromium checks. Deployment and a fourth browser run retain their own separate records.

## Final state

The [final readback](attempt-4/verification.json) confirms **four judge slots spent / eight remaining**, all four older operator reservations intact, unchanged historical environment values and Free Render hosting, and SerpApi Free Plan with **214 searches remaining**, price 0 and no extra credits. Refreshing/redeploying never reset these counters. Seven actual model HTTP attempts used eight reserved model slots; three search transports used four reserved search slots. One search completion and two model-usage values remain unknown. No new grant was created.

The final application is deployed and CI-green, but **live provider reliability remains unresolved**. Google's fourth `INTERNAL` response prevented testing the longer search wait end to end. There is no supported hosted free Gemma fallback in this repo; its Ollama alternative is local-only. No new adapter, credential, paid resource or bypass was introduced. [Aggregate receipt](receipt.json) · [Actual 390px failure recovery and 44px controls](ui-qa.json).
