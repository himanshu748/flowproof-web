# One fresh hosted LoRA proposal — passed

At **2026-10-18 16:35:31 UTC** (22:05:31 IST), the actual Render application returned **HTTP 200** for one fresh protected Tinker proposal using the evaluated Qwen/Qwen3.5-4B LoRA. Deployment `dep-dbaf9fjrjlhs73a22ilg`, source `544616a374f5ad45a266ed58b1916c150751c277`.

- Exactly one application generation request; provider code performs one completion request without retries. No second request was made to test exhaustion.
- **260 input + 249 output = 509 tokens**; **7,598.84 ms** hosted round trip (includes transport, routing, reservation, provider inference and validation; not isolated model latency).
- Six source-bound, unapproved checks: heading, link, image alt, mobile overflow, visible text and manual. No browser audit, agent request or database write was requested by this proof.
- **$0.000336045 token-rate estimate**, not an attributable finalized bill. The explicit new authorization was one request and **$0.01 maximum**, reserving all **8,912 tokens** before dispatch. The all-token-at-higher-rate bound was $0.00895656; the separate input/output bound was $0.00432336.
- Authenticated Tinker x MLH grant before dispatch: **$9.15 remaining**, auto-reload off, no payment methods. No billing settings changed.
- The old expired allowance remains unresolved. Its proof fingerprint and configured budget are retained in `configuration-before.json`; this separate user-approved tranche does not claim unused old calls. No old ledger file was rewritten. Render's ephemeral disk is not a durable cross-deploy accounting record.
- The one-call allowance is consumed and hosted generation was disabled in persistent Render configuration immediately afterward. Closure deployment and anonymous readback are recorded separately. This is a real hosted inference proof, not an always-on public inference entitlement.

## Receipts

[Actual hosted result](receipt.json), [actual generated plan](generation-response.json), [exclusive pre-dispatch reservation](dispatch.json), [authorization and fresh funding observation](authorization-and-funding.json), [unchanged prior proof fingerprint](configuration-before.json), [configuration readback](configuration-mutation-state.json), [activation deployment](activation-deploy-status.json), [closure configuration](disable-state.json), [closure deployment](closure-deploy-status.json), [anonymous closure readback](closure-verification.json), [post-request balance](account-after-request.json).

An unrelated judge-agent status read returned non-200 in an initial preflight and stopped **before any generation dispatch**. It was not repeated. The actual one-request proof uses only the fixed synthetic Tinker route; no agent status success or new agent run is claimed. See [preflight note](preflight-note.json).

The [24-case heldout evaluation](../../../../eval/results/week2-alt-v2/fine-tuned.json) and [20 paired browser successes](../../../../eval/browser/week2-alt-v2/browser-evaluation.json) remain separate local evidence, unchanged by this hosted proposal. Estimated evaluation inference per successful synthetic handoff is $0.000154551; with training $0.001209198; with conservative storage $0.001313394656071428571428571428. Actual billed cost per handoff remains unavailable.

Closure deployment `dep-dbafao6q1p3s73bf6sj0` became live at 16:36:28 UTC on the same source `544616a374f5ad45a266ed58b1916c150751c277`. Anonymous health and bootstrap both returned HTTP 200; Tinker availability is false. No further generation request was made. The post-request account balance still displays $9.15, which is rounded and not an attributable invoice.

The estimate uses the [official Qwen3.5-4B uncached rates](https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/): `(260 × $0.33 + 249 × $1.005) / 1,000,000`.
