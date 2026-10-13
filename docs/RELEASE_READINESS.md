# Release readiness

The local MVP and isolated public demo are implemented and tested. The hackathon definition of done is not yet complete.

| Requirement | Current evidence |
|---|---|
| F01/F02 | Real project creation, synthetic sample, conservative brief parsing |
| F03 | One actual local Gemma proposal passed through API, approval and Chromium execution. This is not the specified fine-tuned Qwen model. Larger invalid model responses fall back explicitly. |
| F04 | Editing resets approval. Unapproved executable checks are rejected server-side. Manual checks remain unverified. |
| F05/F06 | Real Chromium screenshots and captured text, healthy/broken fixtures, bounded request policy |
| F07 | Standalone mobile-readable HTML with embedded screenshots, browser print-to-PDF |
| F08 | Local PostgreSQL writes/reads and durable screenshot storage verified. Tiger Data cloud unverified. |
| F09 | [Remote Actions run](https://github.com/himanshu748/flowproof-web/actions/runs/38345840955) passed 85 tests, build, healthy/broken browser audits and evidence upload. |
| F10 | 360 candidate examples, zero human validated, guarded scripts and null metric dashboard. No Tinker experiments or improvement. |
| F11 | Real local MiniLM embeddings stored and searched by cosine + lexical ranking in PostgreSQL |
| F12/F13/F14 | Mastra, Sentry and Temporal not implemented |

## Verified local scope

- 85 tests pass, including real browser regression tests, network guard tests, source-scope abstention tests, report escaping and completion-after-evidence-storage tests.
- Production frontend build passes.
- The saved fixture plan detects four broken assertions. The UI brief checks the visible contact label rather than destination and correctly detects three broken assertions. Both healthy plans produce five passes and one unverified human judgment.
- A local Gemma proposal starts unapproved, is explicitly approved in the synthetic test, and passes actual Chromium execution. It is a smoke test, not a model-quality evaluation.
- Screenshots and vectors are present in the local database. Search returns actual historical failure rows.
- API checks confirm approval denial, private-network denial and cross-origin write denial. A separate auth smoke verifies private API/evidence access, secure session-cookie properties and local Host restrictions.
- UI interaction and responsive checks cover widths 360, 390, 768 and 1440 pixels. Screenshots and a local walkthrough are in the build outputs.

## Remaining release evidence

1. An authorized real client website and representative customer requirements. All executed website targets here were synthetic.
2. Tiger Data connection and verified hosted retrieval, using confirmed free allowance.
3. Human review of the dataset, verified free Tinker allowance, actual experiments and reproducible checkpoint-linked results, or removing the Tinker category.
4. Public repository, remote Actions and Render sample demo are now verified; see [deployment evidence](DEPLOYMENT.md). A published demo video remains optional.
5. A real potential-customer invitation and truthful feedback outcome. No messages were sent.
6. Any desired P1 integrations with actual evidence.
7. The final DEV article and submission receipt. No submission was made.

The free Render public demo uses isolated in-memory visitor sessions and temporary screenshots; sessions expire after 30 minutes and restart clears state. The private operator mode can store completed screenshots in PostgreSQL before declaring an audit complete. Run one API replica; this MVP does not provide user accounts or durable workflow execution. External targets run without JavaScript and with same-origin resources only, so some sites will be blocked or untestable by design.
