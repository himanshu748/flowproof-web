# Funding and cumulative reservations — October 16

Read-only checks confirmed Google's selected Gemma endpoint had free input/output pricing and no paid tier, and SerpApi's existing account was **Active / Free Plan / monthly price 0 / extra credits 0**. Its account-wide remaining searches were **215 before and after** the final verification. Account counters are not exclusive attribution or an invoice. [Gemma check](gemma-before-search-repair.json) · [SerpApi before](serp-before-search-repair.json) · [SerpApi after](serp-after-search-repair.json).

| Distinct agent allowance | Reserved model requests / searches | Actual observation |
|---|---|---|
| Original | 2 / 1 | One HTTP 200, then invalid model JSON; no tools or search |
| Format repair | 2 / 1 | One HTTP 500 `INTERNAL`; token usage unknown; no tools or search |
| Resilient retry | 6 / 1 | Two HTTP 200 model turns; Tiger consumed; search tool timed out at 10 seconds, upstream completion unknown |
| Search deadline repair | 2 / 1 | Two HTTP 200 model turns; Tiger and HTTP 200 SerpApi output consumed and cited |
| **Total reserved** | **12 / 4** | **Six model HTTP attempts; no refunds of unused capacity** |

The previous standalone SerpApi search is separately spent. Every new proof binds the exact earlier spent proof bytes and corresponding failure/partial receipt. A deployment, fresh timestamp, remaining account quota or new session never restores an old allowance. All four UUIDs are durably reserved in Tiger; final configuration marks all four spent. [Final independent readback](../../hosted-evidence-agent/2026-10-16T12-14-14Z/spent-reservations.json).

The owner authorized further necessary calls, constrained by confirmed-free resources. The implementation retained finite physical request caps, a shared hourly limit, immutable reservations, one search per allowance, consent, operator authentication and strict TLS. Earlier 500 responses remain failures; missing usage is never counted as zero.

The existing Render service stayed Free; no credentials were transferred, services created, cards added, promotions redeemed or billing settings changed. Tiger remains the existing credit-covered metered trial, not a permanent Free database. The existing October 20 cutoffs remain. The active proof's maximum freshness window did not extend those cutoffs. [Provider boundaries](../../../PROVIDER_ALLOWANCES.md) · [Exact green source and CI counts](ci.json).

[Live spent-runtime check](spent-runtime.json) confirmed HTTP 200 for bootstrap/operator status and `evidenceAgentAvailable: false` after applying the spent configuration on the same green source. That check performed no model or search request.
