# Retained pre-provider failures

Both attempts stopped before a Tiger tranche reservation or any Gemma/SerpApi request. The original allowance was never reset.

- [11:19 verifier receipt](2026-10-16T11-19-27-556Z/receipt.json): HTTP 401 because operator status was checked before bootstrapping a visitor session. Corrected the verifier order.
- [11:21 JSON guard receipt](2026-10-16T11-21-37-752Z/receipt.json): real Chromium observed 2 passed / 3 failed / 1 unverified; Tiger round-tripped the serialized audit. The agent guard falsely rejected optional `undefined` fields omitted by JSON. A regression test reproduced 409 before the fix. Comparing all JSON values fixes representation equality; altered observations, identities and statuses still fail closed.

An independent restricted-role TLS read confirmed zero durable reservations for this same original tranche before continuing. Continuation requires that fresh proof, the exact known guard response and an exclusive child record; it cannot refund, retry or renew a provider request. Original receipt bytes are retained, including local work paths as provenance. Their later continuation has a separate receipt.
