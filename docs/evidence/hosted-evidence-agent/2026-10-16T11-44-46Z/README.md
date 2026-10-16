# Retained evidence-agent attempt: upstream failure

This is a failed hosted attempt, not a successful agent/tool integration. Source: `9d3f59f8dfce25e5f9b58a605e0be4fd6bee54e3`. The verifier ran October 16, 2026, **11:44:46.186 to 11:45:11.809 UTC** (**17:14:46.186 to 17:15:11.809 IST**). [Original verifier receipt](receipt.json) · [Application failure and exact attempt metadata](unexpected-response.json).

- One native `gemma-4-26b-a4b-it` request reached the first, tool-selection phase. Google returned **HTTP 500**, provider status **`INTERNAL`**, after **819 milliseconds**. The app returned HTTP 503.
- Token usage is **unknown**, recorded as `null`; the provider omitted usage. This is not zero usage. The 1,866-byte request and 109-byte response have retained SHA-256 hashes. Raw provider error text was not retained, and no internal cause is established.
- There were **zero agent tool calls and zero SerpApi searches**. No second model turn ran. No model-generated findings or successful fallback are claimed.
- The source synthetic audit completed with **2 passed, 3 failed, 0 blocked and 1 unverified**. [Actual audit](source-audit.json) · [Observed mobile screenshot](observed-mobile-failure.png). Approval rejection and session isolation controls remain in the verifier receipt. The source audit stayed unchanged.
- The separately approved tranche reserved **two model requests and one search**. The full reservation remains consumed without refund despite only one observed model request and no search. [Spent-configuration readback](spent-reservations.json) records the durable Tiger tranches, preserved prior configuration and zero billing changes. Deleting a local file or restarting a server is not permission to repeat this proof.

The [earlier HTTP 200 / invalid-model-JSON attempt](../2026-10-16T11-30-58Z/README.md) and [pre-provider failures](../pre-provider/README.md) remain separate history. None establishes that an agent consumed hybrid retrieval or search results. Any later run needs its own approved allowance and receipt; later retry support does not retroactively change this single-attempt outcome.

The copied files preserve their original bytes. The screenshot depicts the built-in synthetic sample, not customer data. Six known secret values from the specifically authorized private repair-access file were checked against the seven copied artifacts and this documentation; no matches were found. This narrow byte check is not a complete credential scan.
