# Tiger Data integration verification

**Latest: pgvector migration and real retrieval verified at 16:32 UTC, October 16.** [New receipt and scores](evidence/tiger-pgvector/2026-10-16T16-16-50Z/) prove a stored `vector(384)` column, pgvector 0.8.7, pgvectorscale 0.9.0 and a valid DiskANN index on the same trial. The one-statement exact cosine/full-text RRF query ranks mobile overflow first at **0.378126416634895**; independent float32 cosine is **0.3781263446933457**. Rank order is unchanged from the earlier array implementation. The fresh browser audit/persistence ran on Render; retrieval ran through the matching local adapter against hosted Tiger. No fresh Gemma/search calls, judge reservations or grant changes occurred. Arrays and earlier evidence remain intact; fixed queries and trial cutoff still apply. The earlier dated sections below describe their original storage and scope.


**Hosted hybrid retrieval serving a native Gemma evidence agent was verified on October 16 at 12:14 UTC.** Source `f990d9a14ae95dc322e4d81a411e9dd764ff9207` passed [CI 38898518897](https://github.com/himanshu748/flowproof-web/actions/runs/38898518897): 871 application tests, 19 Python tests, build and real browser audits. The existing Free Render service ran the [complete proof](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/receipt.json). This bounded native Google Gemma loop is separate from the Mastra proposal workflow.

## Hosted hybrid retrieval and agent consumption

A real Chromium audit recorded **2 passed / 3 failed / 0 blocked / 1 unverified**. Tiger saved its exact [source audit](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/source-audit.json); only the three genuine failed assertions were stored with embeddings, with vectors bound to the exact requirement and observed-text hashes. Gemma selected `failure_history(mobile_paraphrase)` and `search_visibility`, using **517 input / 38 output tokens**, HTTP 200. Tiger SQL combined full-text and normalized 384-dimensional cosine rankings with reciprocal-rank fusion. The query `sideways panning on smartphones` had [zero lexical matches](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/lexical-control.json), but the mobile-overflow failure ranked first at cosine **0.3781263417931506**. The independent calculation matched every SQL cosine; `horizontal` separately returned [one positive lexical match](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/lexical-positive-control.json). [Independent calculation](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/independent-cosine.json).

SerpApi then returned [HTTP 200 in 379 ms](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/serpapi-transport.json), with [zero results](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/serpapi-search.json) for the fixed owned domain. A second actual Gemma turn consumed both tool observations and cited all three returned failures plus the zero-result search snapshot: **1,242 input / 735 output tokens**, HTTP 200. The [model turns and tool results](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/agent-run.json) preserve that chain. Zero search results do not prove de-indexing or a website acceptance outcome. The verifier confirmed the audit was unchanged; duplicate execution returned 409, tokenless/cross-visitor requests 404, and missing consent 400. Approval came from an automated synthetic verifier, not a human customer.

The [additive migration](hosted-tiger-agent.sql) and [strict-TLS execution receipt](evidence/agent-allowance/2026-10-16/tiger-migration.json) add scoped `failure_embeddings` and globally unique `agent_reservations` tables to the dedicated service, with SELECT/INSERT-only grants. Reservation precedes external calls and is never refunded. Vectors are genuine **precomputed local `all-minilm:22m` embeddings**, stored as PostgreSQL arrays for three exact document texts and three fixed queries. This original migration demonstrated hosted hybrid SQL retrieval used by an agent with arrays; the later [pgvector migration](hosted-tiger-pgvector.sql) and [query proof](evidence/tiger-pgvector/2026-10-16T16-16-50Z/) supersede that storage. Neither claims **accelerated indexing, hosted embedding inference, arbitrary-query support or a retrieval-quality benchmark**. Strict certificate/hostname verification, visitor isolation and the October 20 trial cutoff remain in force.

All four agent tranches are [durably recorded and configured as spent](evidence/hosted-evidence-agent/2026-10-16T12-14-14Z/spent-reservations.json): **12 model requests and four searches reserved, six model HTTP attempts observed**. The earlier [invalid JSON](evidence/hosted-evidence-agent/2026-10-16T11-30-58Z/README.md), [HTTP 500 with unknown usage](evidence/hosted-evidence-agent/2026-10-16T11-44-46Z/README.md), and [Tiger success with a search timeout](evidence/hosted-evidence-agent/2026-10-16T11-59-52Z/README.md) remain failures/partial evidence. The timed-out search's upstream completion is unknown. Unused reservations were not refunded; the older standalone search allowance is separately spent. The [post-run live status](evidence/agent-allowance/2026-10-16/spent-runtime.json) confirms the agent is disabled by spent configuration; no unlimited or anonymous agent service is left enabled. [Funding and cumulative boundaries](evidence/agent-allowance/2026-10-16/README.md).

**Earlier October 16 homepage verification, 09:10 UTC:** source `64a62729` saved and read two actual-homepage audits from a real Gemma proposal, with exact JSON equality, scoped lexical retrieval of the wrong-heading control and cross-visitor denial. A separate protected optional-provider proof also saved/read its completed synthetic audit. [Homepage receipt](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) · [Sample receipt](evidence/hosted-optional/2026-10-16T09-13-12Z/receipt.json). The signed-in no-card trial remains active with credit; strict TLS, restricted grants and the October 20 application/role cutoff remain unchanged. Visitor-scoped stored audits expire with the demonstration window; committed reports are separate retained artifacts. That run did not exercise hosted vector retrieval. It did not store screenshot bytes, change FieldIssue or establish permanent-free storage.

The [14:20 post-deploy homepage proof](evidence/hosted-website/2026-10-15T14-20-50Z/receipt.json) reverified the current presentation release `5d707e36`: five passes, a deliberate heading-expectation failure, matching Tiger JSON reads, scoped lexical retrieval and cross-visitor denial. It used templates and zero model calls. [Deployment receipt](evidence/presentation-release-2026-10-15/deployment.json).


**Hosted persistence and lexical retrieval verified on October 15, 2026.** The public Render application saved three synthetic audits to a separately approved dedicated Tiger trial service and read every audit back through the actual database path. [Hosted receipt](evidence/hosted-open-model/2026-10-15T11-34-19Z/receipt.json) · [Deployment](DEPLOYMENT.md).

## Actual homepage persistence, 12:19 UTC

Release `816d869e` verified the owned homepage through real HTTPS/Playwright. The [HTTP receipt](evidence/hosted-website/2026-10-15T12-19-58Z/receipt.json) records five passing checks and one unverified judgment, then four passes/one failure/one unverified after deliberately changing only the heading expectation. Both completed audits were read from Tiger with deeply matching JSON; [lexical search](evidence/hosted-website/2026-10-15T12-19-58Z/tiger-lexical.json) found the failed heading, and distinct visitors were denied. This is deterministic execution with zero model calls, not a new Gemma success or a client acceptance test.

The [actual UI report](evidence/hosted-website/2026-10-15T12-15Z/ui-live-report.html) embeds five downloaded screenshots. Their bytes are in that portable file, not in the hosted database. The expiry, strict-TLS and limited-role boundaries below still apply.

## Dedicated hosted store

Source `2a8eae95c95cf91adb0cd2bed155e6dbb81249ef` passed [CI 38727532102](https://github.com/himanshu748/flowproof-web/actions/runs/38727532102) and deployed to the existing Free Render service at 11:33:30 UTC. The 11:34–11:35 hosted proof observed healthy **5 passed / 1 unverified**, broken **2 passed / 3 failed / 1 unverified**, then restored **5 passed / 1 unverified**. Each completed GET returned the Tiger storage header and audit JSON deeply equal to its completed result. Search for `horizontal` recovered the broken mobile-layout assertion. A different visitor cookie received 404 for scoped search and persistence reads.

The dedicated service uses system-CA and exact-hostname verification with a Google Trust Services chain. Within its application schema, the restricted role can read and insert, but cannot update, delete or create objects. The role has a two-connection limit and expires **October 20 at 00:00 UTC**, matching the application gate. This is an explicitly approved **metered trial covered by existing no-card credits**, not a permanent Free database. No paid conversion, card or billing change was made.

- [Sanitized provisioning receipt](evidence/tiger-hosted/2026-10-15/provision.json): strict TLS and the restricted permissions.
- [Reviewed operator setup SQL](hosted-tiger-schema.sql): the sample-only schema, expiry/size limits, lexical index and read/insert grants. This is for a new dedicated service after funding, strict-TLS and privilege checks; it is not an application migration or a command to rerun against the existing service. It contains no service hostname or credential; the new password comes from a private environment variable. Logical row expiry does not physically delete rows, and the dated login expiry does not stop the cloud service.
- [Separate writer/reader proof](evidence/tiger-hosted/2026-10-15/independent-read.json): three audits recovered across independent processes, lexical retrieval and cross-session denial. Its historical “hosted request pending” scope is resolved by the later hosted receipt, not overwritten.
- [FieldIssue isolation recheck](evidence/tiger-hosted/2026-10-15/fieldissue-isolation.json): at 11:29 UTC its existing service was live over verified TLS; Briefstamp's role/schema were absent and no FieldIssue rows or configuration changed.

**Storage boundary:** the hosted adapter persists audit JSON and screenshot references; the October 16 extension adds scoped failure embeddings and durable one-shot agent reservations. Screenshot bytes and portable reports were downloaded separately; those downloads do not prove binary-image persistence or survival after a Render restart. Visitor session access still expires after 30 minutes. The bounded hosted hybrid proof above is separate from the older four-vector isolated experiment below.

The original Shared Free service still lacks an authenticated CA trust path. The new dedicated service resolves TLS for its own connection only. Certificate and hostname verification remain enabled everywhere.

## Verified exact live-target migration and application path

The [reviewed follow-on SQL](hosted-tiger-live-target.sql) restricts persisted source targets to the synthetic origin or exactly `https://flowproof-demo.onrender.com/`. Its [October 15, 11:53 UTC receipt](evidence/tiger-hosted/2026-10-15/live-target-migration.json) records strict TLS, a validated constraint and unchanged runtime grants, credentials and billing. FieldIssue was not changed. The operator must use the catalog-confirmed old constraint name on this dedicated service; the placeholder file is not a command to run blindly.

The [final 11:59 strict-TLS receipt](evidence/tiger-hosted/2026-10-15/live-target-constraint-final.json) additionally verifies that missing source/URL and unrelated website values fail closed. Runtime grants remained unchanged. The subsequent actual-homepage write/read/search proof above establishes this target’s application path; the older three-audit receipt remains synthetic evidence.

## Historical October 14 experiments

An isolated no-card trial probe verified the original application store, screenshot recovery, lexical search and cosine retrieval over strict TLS. The separate Shared Free service verified four persisted failure rows through its authenticated HTTPS SQL console; its direct connection remained blocked by an unconfirmed CA. Those historical experiments did not enable public-demo persistence; the dedicated hosted proof above is separate.

| Boundary                 | Observed result                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free service             | `flowproof-evidence`, service ID `if4e2s7m6i`; creation wizard showed Shared Free with 1 GiB; a later resource page showed 750 MiB, $0/hour. No paid upgrade was made.                                                                                          |
| Cloud SQL identity       | A real query through the authenticated provider HTTPS SQL console returned PostgreSQL 18.6 for the new service. This establishes console access only.                                                                                                           |
| Shared Free adapter      | The strict-TLS attempt failed at `tls_preflight` with `SELF_SIGNED_CERT_IN_CHAIN`. No schema, audit, failure rows or retrieval query was executed by that attempt.                                                                                              |
| Hosted failure retrieval | **Verified through the authenticated HTTPS console.** The exact prepared write and independent read ran on the free service, returning four persisted failures and matching lexical/vector results. See [cloud output](evidence/tiger-console/cloud-read.json). |
| Local SQL/embeddings     | Four real synthetic browser failures and local MiniLM embeddings passed an independent local PostgreSQL write/read test. This is local evidence only.                                                                                                           |

The [sanitized TLS attempt](evidence/tiger-tls-attempt.json) preserves the failure code, timing, source-code hashes and the original receipt hash. The private original is `outputs/tiger-verification/receipt.json`; database hostname and project-scoped console URL are omitted from the public derivative. No credentials or personal account details are included.

Tiger Data's [strict-SSL documentation](https://www.tigerdata.com/docs/use-timescale/latest/security/strict-ssl/) states that free services do not supply signed SSL certificates. Its [service-creation documentation](https://www.tigerdata.com/docs/get-started/quickstart/create-service) describes Shared as the free option. The failed certificate check was retained: no `rejectUnauthorized: false`, insecure SSL mode, paid conversion or fabricated success was used. A future direct-connection verification of the separate Shared Free service requires a provider-authenticated trust path; accepting an unauthenticated certificate from the failed endpoint would not establish its identity.

## Verified application-store trial probe

The user approved a single temporary Briefstamp schema on an existing Tiger trial. Immediately before execution, the authenticated provider billing page showed remaining included credit, no registered payment method, and zero billed spend. No infrastructure, credentials, payment method or plan changed. This is a time-limited trial, not a permanent free deployment.

The run on October 14, 2026 used application commit `f1eee9baee58e951bc8eeaa959761cd58447346c`, with a clean working tree. It established TLS 1.3 using the default trusted certificate chain and exact-hostname verifier. The peer was authorized, with a Google Trust Services issuer; no custom CA or insecure SSL mode was used.

The application's store and real Playwright runner wrote two synthetic projects and audits, ten screenshots (904,075 bytes total), and four failures with locally generated 384-dimensional MiniLM vectors. Healthy: five passed and one unverified. Broken: four failed, one passed and one unverified. The human-judgment requirement was never counted as passed.

A separate process with an empty local evidence directory recovered both projects, both audits and all ten screenshots from PostgreSQL. Every screenshot hash matched. Lexical search for `horizontal` recovered the layout failure. The semantic query `sideways panning on smartphones` had zero lexical matches and ranked that failure first, with cosine `0.3381529157352527`; every score and ordering matched an independent calculation.

The controller removed only its generated temporary schema. A further read-only, certificate-verified connection independently confirmed the schema was absent and the existing database remained available. No FieldIssue application rows or schemas were read or changed by the probe. The successful run does not resolve the private CA on the separate Shared Free service or connect public visitor sessions to a database.

- [Sanitized execution and cleanup receipt](evidence/tiger-trial/receipt.json), including code hashes and the original private receipt hash.
- [Exact synthetic projects and audit manifest](evidence/tiger-trial/manifest.json).
- Ten original PNG screenshots are bundled at the paths in the receipt; their content hashes were verified again before publication.

Service identity, database hostname, certificate hostname and the project-scoped billing URL are omitted from the public derivative. The original private receipt SHA-256 is `eed7c14bb366a1e683cce6e6046e329cb3fd7bd7f1ba7f2f89ede43d6b2a0bb5`.

## Verified console-only experiment

The browser recovered after an earlier query-entry timeout. The write and independent read were then executed separately; the editor contents were compared exactly with these files before each run:

- [Write statements](evidence/tiger-console/write.sql): 44,317 bytes, SHA-256 `955fa45d1bf3b0dc94607fcaa557170ad833c160df237d3a18fba07cb5a292e8`.
- [Independent read statements](evidence/tiger-console/read.sql): 2,504 bytes, SHA-256 `aa5d43f7ff61b2e8044a28da6affb81a72b5ee4bae29f063732dadf0ecfad9f1`.
- [Historical preparation/provenance receipt](evidence/tiger-console/preparation.json) and [original synthetic browser audit](evidence/tiger-console/source-audit.json).
- [Observed cloud read](evidence/tiger-console/cloud-read.json) and [independent verification](evidence/tiger-console/cloud-verification.json).

The SQL is confined to the new schema `flowproof_console_5324093d89d24b5eb3407bf99c997a41`. It contains only the four failed requirements from the actual broken synthetic audit. Their 384-dimensional vectors were generated by the existing local `all-minilm:22m` model, not a paid embedding API. Screenshots are represented by their original local hashes; screenshot bytes and public visitor data are not uploaded by these statements.

The independent cloud read returned four persisted failures with matching content fingerprints, normalized 384-dimensional vectors, one lexical layout match, and zero full-text matches for the fixed semantic query `sideways panning on smartphones`. Cloud cosine retrieval ranked the mobile-layout failure first at `0.3381529157352527`. An offline verifier reparsed all four saved vectors and the query vector from the exact SQL, checked their original hashes, and recomputed every score: maximum difference from the captured cloud results was **zero**. This is a four-failure integration probe, not a retrieval-quality benchmark.

The earlier local PostgreSQL run remains separate evidence; its temporary local schema was removed. The cloud schema now contains the synthetic failure rows and query vector. Screenshot bytes, full project/audit state and visitor data were not written by this console experiment.

The bundled SQL and source-audit copies preserve their original bytes and hashes. The published preparation receipt replaces SQL/audit paths with repository paths and marks screenshot files as unbundled. Its `publication.originalPreparationSha256` records the original `work/tiger-console-preparation.json` digest (`1116e85ef2e33eca7a24b9f403028598453cf27d2afcd379a79015ba92850827`); it does not claim the adapted JSON has that same hash.

The preparation receipt intentionally retains `prepared_not_executed_in_cloud`, its historical status before the successful run; the later cloud-read and verification receipts establish the new result. The TLS-failure receipt likewise remains unchanged.

For reproduction, use a new isolated schema or inspect the existing synthetic schema; do not blindly repeat its `CREATE SCHEMA` write. The independent read can inspect its persisted rows. The successful console result does **not** clear the Shared Free adapter's TLS blocker, verify project/screenshot persistence through that adapter, or enable database persistence in the public demo. The separate no-card trial probe above provides application-store persistence evidence.

## Direct-adapter probe

The guarded probe is designed to use the application’s PostgreSQL store and Playwright runner. After strict TLS succeeds, it writes two synthetic audits to a unique temporary schema, restarts in a fresh process with an empty local evidence directory, recovers projects/audits/screenshots from the database, and exercises lexical and vector retrieval. It removes only the schema created for that run. No existing Briefstamp state is reset. The earlier Shared Free attempt stopped before these phases; the separate no-card trial run above completed them.

That temporary probe did not connect visitor sessions to Tiger or change deployment settings. The separate October 15 hosted store above now persists scoped audit JSON, with its stated session, image-storage and trial limits.

## Strict custom-CA configuration

The store and verification probe share `server/database.ts`. Remote PostgreSQL always verifies the certificate chain and exact hostname. URL SSL flags cannot override these settings; `NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected. Explicit plaintext PostgreSQL is permitted only on loopback.

Configure `DATABASE_CA_CERT_FILE` with one public PEM CA certificate, plus `DATABASE_CA_CERT_SHA256` with its provider-confirmed DER SHA-256 fingerprint. `DATABASE_CA_CERT` supports the same PEM inline for managed hosts. Missing or mismatching fingerprints, expired or non-CA certificates, and multiple certificates fail before connecting. The default hostname verifier remains enabled.

The free service currently presents a chain signed by `O=Timescale Inc, CN=ca.timescale.com`. Its observed root fingerprint is `06:5A:75:0D:0D:64:F6:2D:AC:DC:97:9E:3B:83:D2:11:95:40:71:EA:59:B8:F3:40:7C:4E:87:CA:68:34:64:57`. **This peer observation is not an authenticated trust anchor and has not been configured as trusted.** The provider console reveals the public CA file path but denies exporting its contents. No permissions were changed.

An approved support request asked for an authenticated CA copy or fingerprint. The initial reply confirms that publicly trusted certificates require a paid plan. On October 14, support recommended downloading the chain directly from the PostgreSQL endpoint and computing its fingerprint locally, but supplied neither an authenticated certificate nor an independently confirmed fingerprint. The replies passed Gmail's DKIM, SPF and DMARC checks. Authenticating a message about how to fetch a certificate does not authenticate the certificate returned by an untrusted endpoint.

The separate Shared Free application connection and its persistence/retrieval probe remain blocked. No peer certificate was added to the trust store and no paid conversion was made. Local TLS fixture tests verify client behavior only: correct-host TLS works with a confirmed fixture CA; wrong-host and untrusted-CA handshakes fail. The no-card trial probe independently verified real Tiger connectivity using the default trusted chain; it does not resolve this Shared Free CA blocker.

## Prerequisites

- An independently confirmed free Tiger Data service with no automatic paid conversion and zero out-of-pocket exposure. Confirm the exact service, allowance and expiry in the provider console. This script does not provision services, inspect billing, or establish that an allowance is free.
- The existing project dependencies and Playwright Chromium installed.
- A running local Ollama instance containing `all-minilm:22m`. The probe calls only a loopback Ollama embedding endpoint; it does not use paid embeddings, generation or training APIs. It fails if the model is unavailable rather than substituting a fake vector.
- A dedicated service connection using verified TLS. For a private provider CA, configure `DATABASE_CA_CERT_FILE` and the provider-confirmed `DATABASE_CA_CERT_SHA256`. Do not derive that confirmation solely from a failed endpoint handshake. Never disable certificate or hostname verification.

Save the private connection in an ignored, mode-600 file such as `work/tiger-connection.env`:

```dotenv
TIGER_DATABASE_URL=postgresql://USER:PASSWORD@SERVICE.REGION.tsdb.cloud.timescale.com:PORT/DATABASE
```

Do not print, commit or publish that file. The ordinary application `DATABASE_URL` is deliberately not accepted as a fallback.

Record the independently verified allowance in `work/tiger-free-confirmation.json`. Replace all illustrative values with actual observations; this example is not a confirmation:

```json
{
  "provider": "Tiger Data",
  "serviceId": "ACTUAL_SERVICE_ID",
  "hostname": "ACTUAL_SERVICE.REGION.tsdb.cloud.timescale.com",
  "checkedAt": "ACTUAL_RECENT_ISO_TIMESTAMP",
  "expiresAt": "ACTUAL_CONFIRMATION_VALID_UNTIL_ISO_TIMESTAMP",
  "basis": "free-plan",
  "outOfPocketLimit": 0,
  "automaticPaidConversion": false,
  "confirmedBy": "WHO_CHECKED_THE_PROVIDER_CONSOLE",
  "evidenceUrl": "https://console.cloud.timescale.com/services"
}
```

`basis` may be `free-plan`, `trial-no-card`, or `sponsor-credit-with-hard-cap`. Credits without an enforced zero-cost boundary are insufficient. `checkedAt` must be within 24 hours; the confirmed allowance must remain valid for at least ten minutes. For a plan without expiry, `expiresAt` records how long this verification of its current terms is considered valid. The evidence URL must be an official HTTPS source with no credentials, query parameters or fragment. The connection hostname and service ID must match the confirmation exactly.

## Run

From the repository root, using Node 22:

```sh
TIGER_SERVICE_ID=ACTUAL_SERVICE_ID \
TIGER_FREE_CONFIRMATION_FILE=work/tiger-free-confirmation.json \
node --env-file=work/tiger-connection.env --import tsx scripts/verify-tiger.ts
```

The default evidence directory is a newly generated `work/tiger-verification/<run UUID>/`. To choose a new directory, set `FLOWPROOF_TIGER_OUTPUT`; existing directories are rejected so stale evidence cannot masquerade as a fresh result. `OLLAMA_URL` optionally selects another permitted loopback address.

Each browser phase has a five-minute process budget. PostgreSQL statements have a 30-second controller timeout. The healthy fixture must yield five passes and one unverified result; the broken fixture must yield four failures, one pass and one unverified result. These are approved deterministic fixture checks, not AI-generated evaluation results.

## Interpret the receipt

The final `receipt.json` records the actual service identity, strict-TLS observation, source commit and file hashes, dirty-worktree state, audit results, restored screenshot hashes, stored vector count, retrieval observations and cleanup outcome. It contains synthetic test content, not database credentials. The schema and service identity are operational metadata; review them before publishing.

- `status: verified` means the database execution checks passed. The write and read phases use different processes and data directories, so recovery cannot rely on in-memory state or previously saved local screenshots.
- Lexical retrieval must recover the known layout failure.
- The fixed semantic paraphrase must have zero PostgreSQL full-text matches. The receipt records every vector ranking and the layout failure’s actual rank. SQL cosine values and ordering are independently recomputed from the saved normalized 384-dimensional vectors.
- `relevantAtRankOne` is an observation, not an assertion forced to pass. A low rank remains visible. Two synthetic audits are a connectivity and behavior probe, not a retrieval-quality benchmark.
- Vectors use PostgreSQL arrays and a full scan. **No pgvector or accelerated-index claim is made.**
- `temporarySchemaRemoved: true` confirms the probe left no remote test tables behind. If cleanup fails, the command fails and identifies the exact generated schema in the receipt; remove only that schema after reviewing the failure. Never drop unrelated databases or tables.
- Any incomplete phase remains `not_verified`; a failed process must not be presented as proof of the integration. Sanitized error receipts omit raw provider responses and connection details.

Publishing the historical probe receipt establishes only its observed operator-side run. October 15 hosted receipts establish scoped audit persistence and lexical retrieval; the October 16 native-agent proof additionally establishes bounded hosted hybrid retrieval and tool consumption. None establishes production availability, an ongoing free allowance, retrieval quality at scale or customer validation.
