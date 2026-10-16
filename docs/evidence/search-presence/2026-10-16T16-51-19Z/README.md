# Approved search-presence controls: October 16, 2026

Real SerpApi Google responses, requested from the local protected verifier. This is separate from Chromium acceptance and the public agent's fixed-homepage search. The existing Free Render app and judge grant were not reconfigured.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Exact owner profile; title includes `himanshu748` | `no_match`: nine organic results, zero exact-profile links | [Initial receipt](initial-two-checks/receipt.json), [response](initial-two-checks/check-1-response.json) |
| Briefstamp demo; title includes `Briefstamp` | `empty`: zero organic results | [Response](initial-two-checks/check-2-response.json), [observation](initial-two-checks/check-2-observation.json) |
| Exact owned repository selected from the initial response | `unavailable`: 30,003 ms transport timeout; upstream completion unknown | [Transport](indexed-timeout/check-1-transport.json), [receipt](indexed-timeout/receipt.json) |
| Same approved repository, separate final one-call allowance | `matched`: three organic results, one exact-page match at position 1, title includes `langchain-rag-tutorial-2026` | [Cited title/snippet/URL](indexed-final/check-1-observation.json), [response](indexed-final/check-1-response.json), [receipt](indexed-final/receipt.json) |

The indexed repository was selected from a real prior response, so this is a control demonstration, not an independent retrieval benchmark. No result page was visited. An empty result is not proof of de-indexing. All checks were proposed unapproved and separately approved by the owner-instructed automated verifier; no customer approval is claimed.

Four dedicated request reservations (2 + 1 + 1) remain spent, including the unknown timeout. There were no automatic retries or model calls. The final account snapshot was Active Free Plan, monthly price $0, zero extra credits and 211 searches remaining. Account-wide quota differences do not establish exact charges or cache billing. All 40 earlier files checked by the final verifier were byte-unchanged. Tiger judge reservations remained four before and after; none of the 96 remaining public slots was consumed.

[Typed check and exact-page matcher](../../../../server/search-presence.ts) · [One-shot verifier](../../../../scripts/verify-search-presence.ts) · [Green source CI](ci.json). API key fields and exact key occurrences are redacted in retained responses. `spent-allowance.json` omits the private credential fingerprint; other JSON receipts retain their original bytes. Old evidence was not deleted or rewritten.
