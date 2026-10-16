# Failed agent selection — retained history

The real hosted synthetic audit completed with **2 passed / 3 failed / 1 unverified** and round-tripped through Tiger. The app persisted three exact-source MiniLM vectors and reserved the original agent tranche durably.

The first native Google-hosted Gemma turn returned **HTTP 200, 516 input / 38 output tokens**, then failed `invalid_model_json`. **No tools and no SerpApi request executed.** [Actual returned failure](unexpected-response.json) · [Verifier receipt](receipt.json) · [Unchanged source audit](source-audit.json).

The raw model text was not retained, only its response hash and usage, so the precise formatting cannot be established. A later compatibility fix accepts the exact whole JSON fence already supported by the existing proposal adapter, records any wrapper removal, and retains a bounded redacted diagnostic on future format failures. It never repairs generated fields.

The original two-model/one-search reservation remains consumed, including unused capacity. [Spent configuration and independent Tiger reservation readback](../../agent-allowance/2026-10-16/failed-tranche-spent.json) retained all earlier spent budgets. A separate [actual SQL hybrid read](../../agent-allowance/2026-10-16/hybrid-before-agent.json) returned three rows and ranked the mobile failure first; that read was not consumed by the model and is not an agent-loop success.

The owner approved a separate bounded repair grant. Any successful continuation has a distinct UUID and dated receipt; this historical failure is not overwritten or counted as passed.
