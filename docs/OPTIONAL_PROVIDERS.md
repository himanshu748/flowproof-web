# Optional provider adapters and runtime evidence

These server modules provide concrete API integrations for project memory, search visibility and spoken sample reports. **October 16's [protected hosted proof](HOSTED_OPTIONAL.md) executed SerpApi search, ElevenLabs MP3 generation and Backboard write/retrieval on Free Render.** The MP3 independently decodes; audible wording/listening is unverified. These operator-only allowances are now consumed. Contract tests use injected transports and never substitute for the linked real receipts.

## Historical account checks, October 15, before the later hosted proofs

The user asked to inspect FieldIssue’s existing provider setup. Only its known Render service configuration was read; no FieldIssue data, settings or service was changed. Keys stay private and are never bundled into the public sample.

- SerpApi: active Free plan; one real adapter call completed with an empty search snapshot. The one-call ledger prevents repeating the proof against the same reservation.
- Backboard: official balance API returned mixed free/paid credits with auto-reload off and no card. It did not establish free-credit priority or active trial expiry, so no assistant or memory write was created.
- ElevenLabs: actual subscription reports Creator with overage disabled; configured voice lookup returned401. Zero-cost entitlement and usable TTS scope remain unconfirmed, so no audio was generated.

## Capabilities

| Adapter    | Function                                                        | Request and result                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backboard  | `rememberAudit(audit)` / `recallProjectMemory(projectId, kind)` | Store anonymous assertion kinds/statuses, then separately retrieve relevant project history. An accepted write is not reported as persistence/retrieval success.                                      |
| SerpApi    | `checkSearchVisibility(project)`                                | One Google `site:domain` search for an authorized website on the operator's exact allowlist. Returns up to five same-domain observations without visiting links; absence is not proof of de-indexing. |
| ElevenLabs | `createSpokenSampleReport(audit)`                               | Read only observed status counts from a completed synthetic audit into bounded MP3 audio. Includes attribution and a noncommercial limitation; no client-specific content or cloned voice creation.   |

All are disabled by default. The application integration layer must call them only behind authenticated operator actions, keep secrets off the frontend, and serve audio with `audio/mpeg`. They never mutate an audit's observed status. Neither successful contract tests nor installed code should produce an “active” cloud badge.

Backboard sends no names, requirements, expected strings, URLs, screenshots or DOM. Project/audit IDs become SHA-256 scope tokens. Retrieval parses only Briefstamp's finite record format and excludes records belonging to another project. Its dedicated assistant should not be shared with unrelated workloads; an empty result is not proof that no history exists.

## Confirmed-free gate

Public pricing is context, not proof about this account. Before enabling a provider, verify its actual remaining included allowance, expiry, relevant operation pricing and disabled paid overage. Use no paid plan, card addition or automatic top-up. The guard requires a fresh account-specific record checked within 24 hours and tied to the SHA-256 of that exact API key.

The private JSON at `BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE` must be an absolute path. It has this structure; placeholders below are deliberately invalid and must never be represented as account confirmation:

```json
{
  "version": 1,
  "providers": {
    "backboard": {
      "credentialSha256": "EXACT_API_KEY_SHA256",
      "checkedAt": "ACTUAL_CONFIRMATION_ISO_TIME",
      "expiresAt": "CONFIRMED_EXPIRY_ISO_TIME",
      "evidence": "Private account receipt or authenticated dashboard reference",
      "freeOnly": true,
      "paidOverageDisabled": true,
      "unit": "requests",
      "operations": ["memory-write", "memory-search"],
      "confirmedFreeUnits": 2,
      "maxUnits": 2,
      "usedUnits": 0,
      "maxCalls": 2,
      "usedCalls": 0
    }
  }
}
```

Use a distinct entry for each enabled provider. The shared guard also accepts Tinker with unit `tokens` and operation `generate-checks`, reserved before its separate fixed-endpoint inference invocation; derive that token ceiling conservatively from actual included credits and current token/overhead rates. SerpApi uses `requests` / `search-visibility`. ElevenLabs uses `characters` / `sample-speech`, conservatively reserving one credit per character for the fixed `eleven_multilingual_v2` model. A Backboard operation cap must be derived from the verified trial/credit allowance, not guessed from the word “Free.”

Before every request, an exclusive file lock protects an atomic reservation of the full call/unit budget. Failures/timeouts consume that reservation; no retries or refunds occur. Missing, expired, stale, mismatched or exhausted proof fails before the network request. A locked ledger fails closed; do not delete a lock while another process might be using it. Keep this file private and durable across restarts. Do not reset its counters to reuse an allowance. Provider-enforced no-overage settings remain necessary: a local record cannot prevent charges caused by unrelated clients on the same account.

Server variables:

```text
BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE=/absolute/private/allowance.json
BRIEFSTAMP_BACKBOARD_ENABLED=true
BACKBOARD_API_KEY=server-managed-secret
BACKBOARD_ASSISTANT_ID=dedicated-existing-assistant-uuid
BRIEFSTAMP_SERPAPI_ENABLED=true
SERPAPI_API_KEY=server-managed-secret
BRIEFSTAMP_SEARCH_DOMAINS=flowproof-demo.onrender.com
BRIEFSTAMP_ELEVENLABS_ENABLED=true
ELEVENLABS_API_KEY=server-managed-secret
ELEVENLABS_VOICE_ID=confirmed-available-stock-voice-id
BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO=true
```

Only enable a provider after its proof exists. These examples do not establish configuration, balance, license rights or permission to disclose client content.

## Official contracts and free-resource limits

Checked October 15, 2026:

- Backboard documents `X-API-Key`, the fixed `app.backboard.io/api` host, memory writes and search. Search returns a `memories` array with content and optional score. Its pricing advertises a no-card Free tier, starter memory credit and memory/RAG free during the trial; ongoing allowance must be verified in the actual account. [Add memory](https://docs.backboard.io/api-reference/memories/add) · [Search memories](https://docs.backboard.io/api-reference/memories/search) · [Pricing](https://backboard.io/pricing).
- SerpApi documents Google search at its fixed host and successful/error/processing statuses. The public Free plan lists 250 searches monthly, and the actual existing account was checked as active Free with218 searches remaining before the one-request proof. One request is reserved even if its response is cached. [Search API](https://serpapi.com/search-api) · [Pricing](https://serpapi.com/pricing).
- ElevenLabs documents the text-to-speech endpoint, `xi-api-key` and MP3 output. Free pricing lists 10,000 credits; the commercial license starts with a paid tier. This adapter therefore supports a noncommercial synthetic demo only and cannot fulfill a paid client narration offer under that free license. It does not request enterprise-only zero retention. [API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) · [Pricing and credit units](https://elevenlabs.io/pricing).

Every endpoint is hardcoded/allowlisted. Redirects are rejected, TLS verification is left enabled, requests time out after 30 seconds, JSON is limited to 64 KiB and audio to 2 MiB. Raw provider error bodies, key-bearing search URLs and arbitrary client text are not logged or returned. No result URL is fetched. Provider outputs are data, never executable instructions.

## Reproduce

```sh
npx vitest run tests/optional-providers.test.ts
node --import tsx scripts/verify-optional-providers.ts
```

The second command reports `not_run` and performs zero provider calls. Only after fresh confirmation and explicit authorization, run one selected synthetic smoke:

```sh
node --env-file-if-exists=.env --import tsx scripts/verify-optional-providers.ts --run-provider backboard
```

Substitute `serpapi` or `elevenlabs` for the selected provider. The smoke uses the retained synthetic Gemma audit (or the public Briefstamp demo hostname for search), saves a local receipt, and never creates paid infrastructure. Backboard performs one write and one search with no polling; if indexing has not completed, it records `accepted_not_retrieved`. That stored synthetic memory remains until the operator removes it. Speech saves audio but explicitly does not claim listening verification. Do not publish private allowance files, keys or account evidence.
