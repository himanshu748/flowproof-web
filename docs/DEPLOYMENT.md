# Deployment evidence

Repository: https://github.com/himanshu748/flowproof-web (public).

## Delivery workspace release, October 16, 10:08 UTC

Source **`4d8f7fd2440d68f795cdc3da42d0fa362bf8552d`** passed [CI 38884672613](https://github.com/himanshu748/flowproof-web/actions/runs/38884672613): **571 application tests, 19 Python tests**, build and real sample/browser audits. The existing **Free Render** service deployed `dep-db8ve6eq1p3s739hka50`, live at **10:08:06.044605 UTC**. The environment matched the previously verified spent-allowance configuration before and after deployment. No credential, provider budget, hosting plan or billing setting changed. [Deployment readback](evidence/dashboard/2026-10-16/deployment.json).

The [redesigned workspace](DASHBOARD_DESIGN.md) leads with projects, approval progress and actual latest results. [Local UI verification](evidence/dashboard/2026-10-16/local-ui.json) completed across seven screens and four widths. The [actual hosted in-app check](evidence/dashboard/2026-10-16/hosted-ui.json) explicitly approved the labelled template sample, observed **5/0/0/1**, saw Tiger save confirmation and downloaded the real [portable report](evidence/dashboard/2026-10-16/hosted-report.html). Desktop and 390-pixel mobile screenshots, full-notice disclosure and drawer keyboard checks are retained. A transient “Failed to fetch” warning during audit polling cleared on the next successful request; its cause is unconfirmed. This UI run made no model call and does not replace the separate Gemma proof below.

## Provider refresh release, October 16, 09:10 UTC

Source **`64a62729018fc2372611c7b21bfffecf3b779556`** passed [CI 38878045224](https://github.com/himanshu748/flowproof-web/actions/runs/38878045224): **571 application tests, 19 Python tests**, build and actual sample/browser audits. The same existing **Free Render** service deployed it as `dep-db8uiujrjlhs73djq85g`, live at **09:10:00.602321 UTC**. Its URL, hosting plan and manual-deploy setting remain unchanged. Only the approved scoped provider credentials/proofs were updated; no purchase, card or billing change. [CI](evidence/provider-refresh/2026-10-16/ci.json) · [Deployment](evidence/provider-refresh/2026-10-16/deployment.json) · [Configuration readback](evidence/provider-refresh/2026-10-16/configuration.json).

The [fresh real Gemma/homepage flow](evidence/hosted-website/2026-10-16T09-10-55Z/receipt.json) used one successful native attempt, **389 input / 296 output tokens**, explicit verifier approval, **5/0/0/1** original outcomes and **4/1/0/1** with a deliberately wrong heading expectation. Both audits matched their Tiger readbacks; lexical retrieval and cross-visitor denial passed. The exact proposal trace has [independent Sentry dashboard proof](evidence/hosted-website/2026-10-16T09-10-55Z/sentry-verification.json).

The separate [protected optional-provider flow](HOSTED_OPTIONAL.md) verified one real SerpApi search (zero results), ElevenLabs MP3 generation and a Backboard write/search retrieving all six actual audit facts. Its synthetic sample recorded **2/3/0/1** and also round-tripped through Tiger. The MP3 decodes; listening/audible wording remains unverified. These operator-only proof allowances are consumed and their [spent counters were carried into Render configuration](evidence/provider-refresh/2026-10-16/spent-reservations.json) without a second deployment. A refreshed timestamp or ephemeral replacement disk is never permission to regain them. Tinker's existing unused remainder was preserved without inference or retraining. [Funding and scheduled read-only rechecks](PROVIDER_ALLOWANCES.md).

Counts above are ordered passed / failed / blocked / unverified. These are agent verification runs, not customer acceptance, a production SLA or completion of the full PRD. The template-based YouTube video and older receipts below remain unchanged history.

## Gemma live-homepage release, October 15, 15:32 UTC

Source **`2e3c3397ea5a594ecb329f7b52ef373fe1049161`** passed [CI 38760611627](https://github.com/himanshu748/flowproof-web/actions/runs/38760611627): **476 application tests, 19 Python tests**, build and actual browser audits. [Exact CI receipt](evidence/gemma-rerun-preflight-2026-10-15/contract-ci.json).

The same existing **Free Render** service deployed it as `dep-db8f3bdg1s2s73a2jgog`, live at **15:32:37.055204 UTC**. Hosting, billing, TLS, authentication and service configuration were not changed. [Deployment](evidence/gemma-rerun-preflight-2026-10-15/contract-deployment.json) · [Free-plan/model preflight](evidence/gemma-rerun-preflight-2026-10-15/contract-preflight.json).

The [new live-site receipt](evidence/hosted-website/2026-10-15T15-37-09Z/receipt.json) records real Google-hosted Gemma generation (**389 input / 296 output tokens**), unapproved execution rejected, verifier approval, **5/0/1** original results, a **4/1/1** wrong-heading control and exact Tiger read/search verification. The [separate in-app flow](evidence/hosted-website/2026-10-15T15-37-09Z/in-app-receipt.json) also generated, approved, executed and downloaded the actual HTML report. The exact Sentry proposal trace `70ef2a9b80da4b60bd4bc104ed1ec823` was independently verified in the authenticated dashboard at 16:32 UTC: a 21.39-second root with status `ok`, a 7.49-second generation span and a 1.62-millisecond validation span. The [later verification sidecar](evidence/hosted-website/2026-10-15T15-37-09Z/sentry-verification.json) and [screenshot](evidence/hosted-website/2026-10-15T15-37-09Z/sentry-trace.jpg) establish ingestion without modifying the original worker receipt. This covers proposal tracing only, not browser-audit or error-event ingestion. [Diagnosis and earlier failures](GEMMA_LIVE_SITE.md).

## Earlier presentation release, October 15, 14:18 UTC

Source **`5d707e3686ad9439a2af2eb9bf332a21e1e6d088`** passed [CI 38748213339](https://github.com/himanshu748/flowproof-web/actions/runs/38748213339): **452 application tests, 19 Python tests**, build and actual browser audits. The CI fixture again observed healthy **5/0/1**, broken **1/4/1**, restored **5/0/1**. [Extracted CI receipt](evidence/presentation-release-2026-10-15/ci.json).

The same existing **Free** Render service deployed it as `dep-db8e0bks728c7393jt60`, live at **14:18:07.919636 UTC**. No service configuration, credential, plan or billing settings changed. [Deployment and fresh Free-plan check](evidence/presentation-release-2026-10-15/deployment.json).

[Post-deploy live-homepage verification](evidence/hosted-website/2026-10-15T14-20-50Z/receipt.json) made zero model calls: **5 passed / 0 failed / 1 unverified**, then an intentionally wrong heading expectation produced **4 passed / 1 failed / 1 unverified**. Both audits round-tripped through Tiger with matching JSON, lexical search recovered the failed heading, and a distinct visitor received 404 for protected history/report reads. [14:20 portable report](evidence/hosted-website/2026-10-15T14-20-50Z/live-report.html).

Browser QA confirmed the deployed new-project form creates an unapproved synthetic project. [UI receipt](evidence/presentation-release-2026-10-15/hosted-ui.json). Startup/retry, isolated-clock expiry recovery, mobile layout and keyboard checks are recorded in [local UI QA](evidence/judge-qa-2026-10-15/receipt.json). The [68-second video](demo/README.md) retains its own earlier deployed source and actual capture provenance. Historical integration runs below retain their original commits and outcomes.

## Earlier real-homepage release, October 15, 12:09 UTC

Source **`816d869ed7851b471b0ff83b103903ef2f069eae`** passed [Actions run 38731823339](https://github.com/himanshu748/flowproof-web/actions/runs/38731823339): **436 application tests, 19 Python tests**, production build and actual browser checks. Existing **Free** Render deployment `dep-db8c3mk9v7es738bnb80` became live at **12:09:30.404076 UTC**.

The **Audit this live site** preset visits only the owner-authorized `https://flowproof-demo.onrender.com/` homepage, through real HTTPS fetches and Playwright with page scripts disabled. Actual landing content is prerendered and fonts are served locally. The [12:19 HTTP verification](evidence/hosted-website/2026-10-15T12-19-58Z/receipt.json) made **zero model calls** and used explicitly labelled deterministic checks:

| Actual homepage condition | Passed | Failed | Blocked | Unverified |
|---|---:|---:|---:|---:|
| Approved published requirements | 5 | 0 | 0 | 1 |
| Deliberately wrong heading expectation | 4 | 1 | 0 | 1 |

Both audits round-tripped through Tiger with deeply matching JSON. Scoped lexical retrieval returned the failed heading; cross-visitor project/audit/history requests were denied. The negative control changed only the approved expectation, not the website, so it is not a website regression or an unchanged-check recovery claim. An earlier verifier attempt stopped because it expected 404 for an unauthenticated request that correctly returned 401; the corrected run used a distinct visitor cookie and preserved the failed attempt separately.

A separate [actual UI receipt](evidence/hosted-website/2026-10-15T12-15Z/ui-receipt.json) records five passes, one manual judgment, Tiger save confirmation and a real HTML download. The [published report](evidence/hosted-website/2026-10-15T12-15Z/ui-live-report.html) contains five embedded screenshots; the [UI capture](evidence/hosted-website/2026-10-15T12-15Z/ui-live-audit.jpg) shows its result. These are agent checks of the owned site, not customer acceptance.

### Gemma incident during this release

Hosted generation attempts returned [HTTP 503](evidence/hosted-website/2026-10-15-gemma-incident/hosted-attempt-503.json). A single bounded native diagnostic at 12:15 UTC confirmed [Google HTTP 500 before parsing](evidence/hosted-website/2026-10-15-gemma-incident/native-http-500.json). No accepted AI proposal or live-site AI success is claimed; the UI retained its labelled deterministic draft. Earlier 10:55 Gemma/Mastra/Sentry success below remains historical evidence, separate from this incident. No billed service, hidden model fallback or success retry was substituted.

The [Tiger target migration](hosted-tiger-live-target.sql) and [final 11:59 strict-TLS check](evidence/tiger-hosted/2026-10-15/live-target-constraint-final.json) accept the exact sample/owned-site targets and reject missing or unrelated URLs, with grants and billing unchanged. [Judge guide](JUDGE_GUIDE.md). Arbitrary visitor client URLs and JavaScript interaction testing remain unsupported. The video is not yet published; the submission remains a draft.

## Earlier verified hosted Tinker and Tiger release, 15 October 2026

Source **`2a8eae95c95cf91adb0cd2bed155e6dbb81249ef`** passed [Actions run 38727532102](https://github.com/himanshu748/flowproof-web/actions/runs/38727532102): **423 application tests, 19 Python tests**, production build and real browser verification. Existing **Free** Render deployment `dep-db8bj7avcj2c738tlgv0` became live at **11:33:30.566169 UTC**. The [11:34 hosted receipt](evidence/hosted-open-model/2026-10-15T11-34-19Z/receipt.json) completed successfully at 11:35:31 UTC.

- **Protected Tinker:** one actual request used **260 input / 249 output tokens**; the **8,912-token reservation** was a budget bound, not actual usage. Six checks began unapproved; execution returned 409 until synthetic-harness approval. Real Chromium then observed healthy **5 passed / 1 unverified** → broken **2 passed / 3 failed / 1 unverified** → restored **5 passed / 1 unverified**. This October 15 sampler is newer than the frozen benchmark checkpoint and does not inherit its quality scores. [Receipt and credit limits](HOSTED_TINKER.md).
- **Hosted Tiger:** all three completed audit GETs returned the Tiger storage header and deeply matching JSON. Lexical `horizontal` search recovered the failed mobile assertion; another visitor cookie received 404 for search/persistence. Strict system-CA/hostname TLS remains enabled. This dedicated credit-covered metered trial stores audit JSON and screenshot references, not image bytes or hosted vectors. The role/application gate expires October 20. [Provisioning, independent read and FieldIssue isolation](TIGER_VERIFICATION.md).
- **Hosted Temporal CI:** [manual run 38727552047](https://github.com/himanshu748/flowproof-web/actions/runs/38727552047) passed on the same source. Both worker/server processes restarted with the same workflow/run IDs; two activity attempts and one browser execution remained unchanged. Nine evidence-file hashes are retained, with no artifact uploads. This is CI development-server recovery, not an always-on Render worker or Temporal Cloud. [Proof](TEMPORAL.md).

Earlier Gemma/Mastra/Sentry and Backboard receipts below remain revision-specific evidence; this Tinker run made no Gemma or Backboard request. The Tinker allowance has one of two requests unused and expires October 16 at 10:49 UTC. Same-disk reservations are not a durable cross-deployment budget. The original Shared Free Tiger CA remains unresolved; no FieldIssue data/settings changed. SerpApi is not mounted publicly, ElevenLabs remains unverified, Entire is local, and .tech is missing. The DEV article remains a draft.

## Earlier verified hosted proposal tracing, 15 October 2026

Source **`e43dbe7430368292ff9b225f4bf5e3236c2d03c0`** passed [Actions run 38722793847](https://github.com/himanshu748/flowproof-web/actions/runs/38722793847). The existing **Free** Render service deployed `dep-db8b0ebncjis73f93b3g` at **10:53:13.436562 UTC**. The [10:55 hosted receipt](evidence/hosted-open-model/2026-10-15T10-55-27Z/receipt.json) verifies one native Gemma request through two Mastra steps, unapproved-execution rejection, then healthy **5 passed / 1 unverified** → broken **2 passed / 3 failed / 1 unverified** → restored **5 passed / 1 unverified**. Approval was by the synthetic verifier, not a person.

The request used **335 input / 300 output tokens**. Its **7.502-second provider/validation call is not the whole workflow duration**: Sentry observed a **22.09-second root**, including startup, a 7.59-second generation child and 0.43-millisecond validation child. Worker maximum RSS was **175.07 MiB**. The exact three-span trace was independently verified in the authenticated dashboard. [Sentry receipt and screenshot](SENTRY_HOSTED.md). The earlier Backboard proof below remains separate; this newer run made no memory calls.

### Historical preparation before 2a8eae95

- **Tiger:** after the earlier FieldIssue isolation preflight stopped, the user approved a separate dedicated service. System-CA/hostname TLS was verified at 11:10 UTC; a restricted role/schema was provisioned at 11:12. Independent writer and reader processes recovered three saved synthetic audits; lexical search found the horizontal-overflow failure and cross-session access was denied. Screenshot references, not image bytes, were stored. Render configuration was applied at 11:15; the hosted request path was still unverified at that preparation stage. This is a **credit-covered metered trial**, not permanent Free storage; the gate/login expires October 20. No FieldIssue rows/settings changed. The original Shared Free service’s CA remains unresolved; no TLS checks were weakened.
- **Tinker:** the existing October 15 application-smoke sampler, newer than the frozen October 14 benchmark checkpoint, was renewed and read back with expiry **October 19, 23:59:30 UTC**. Estimated retention $0.00221 is within the approved $0.01 promotional-credit cap; it is not billed usage. No training, new checkpoint or inference occurred in the renewal. Protected Render configuration reserves at most two proposal requests / 50,000 tokens under fresh confirmation expiring **October 16, 10:49 UTC**. The route and UI existed; hosted inference was pending the next release. No anonymous access.
- **Temporal:** the manual public-runner workflow was implemented but had not yet run. It emits bounded receipt/manifest logs without artifact storage; see [scope](TEMPORAL.md). This is not an always-on worker or Temporal Cloud.

At this preparation stage, 423 local application tests and the production build had passed; remote CI/deployment and hosted Tiger/Tinker verification were pending. The later 2a8eae95 proof above resolves those gates within its stated scope. Private provider configuration and operator receipts remain private. The DEV article remains a draft.

## Verified hosted open-model release, 15 October 2026

Source **`25efaeefa582ebff29033e4d73e7fe53ece73119`** passed [Actions run 38716831942](https://github.com/himanshu748/flowproof-web/actions/runs/38716831942): **320 application tests, 19 Python tests**, production build, the bounded public-runtime browser check and real fixture audits. The compiled Mastra workflow CI check recorded **174.54 MiB** maximum resident memory.

The existing Render service was confirmed **Free**, without plan or resource changes. Deploy `dep-db8a8jss728c738ocqdg` became live at **2026-10-15T10:03:31.662801Z** with that source revision. The [actual hosted receipt](evidence/hosted-open-model/2026-10-15T10-04-04Z/receipt.json) records execution from 10:04:04 to 10:05:30 UTC; the public evidence includes the proposal, three audits and anonymous Backboard memory records.

| Hosted capability | Actual observed result | Scope and remaining limit |
|---|---|---|
| Native Gemma and Mastra | One real `gemma-4-26b-a4b-it` request, 335 input / 300 output tokens, 7.893 s; two real Mastra workflow steps, child maximum RSS 149.18 MiB. | Consent and fixed synthetic brief only; no general quality benchmark or human approval. [Details](PUBLIC_GEMMA.md). |
| Approval and browser evidence | Unapproved audit returned 409. After verifier approval: healthy 5 passed / 1 unverified → broken 2 passed / 3 failed / 1 unverified → restored 5 passed / 1 unverified. | Three controlled regressions/recoveries; 15 PNGs and three embedded reports downloaded, privately retained with public hashes. Project/audit/report isolation returned 404 across visitors. |
| Protected Backboard memory | One actual hosted write and one search recovered all six audit statuses. Immediate free balance 4.99→4.98 USD; paid balance unchanged. | Operator token and session ownership required; anonymous access denied. This proof exhausted its two-operation allowance. [Credit and expiry details](BACKBOARD_VERIFICATION.md). |

Opening `#demo` shows Review and the Gemma action without automatically calling a model. Initial drafts remain labelled rules. The model route checks free-only pricing at least hourly and rejects private/edited briefs; current confirmation expires October 20. Backboard used explicitly approved existing credits with no card, auto-reload, top-up or setting change. Its exclusive-created ledger preserves spent counters on the same disk, but free-host disk replacement is not a durable cross-deployment budget or permission to regain an exhausted allowance.

This historical 25efaeef receipt did not establish Sentry ingestion; the newer e43dbe74 evidence above does. It does not establish hosted Tiger, Tinker, Temporal, SerpApi, ElevenLabs, Entire or .tech operation. See [remaining gates](ALL_INTEGRATION_GATES.md).

### Historical preparation after 25efaeef

At 10:17 UTC on October 15, the user-approved isolated Tiger trial-hosting attempt stopped **before DDL** when the privilege preflight found inherited PUBLIC metadata grants. No role, schema or Render database credential was created; no FieldIssue data/configuration or billing setting changed. Subsequent strict-TLS checks inspected metadata only and still recorded zero created roles/schemas. This is a failed provisioning preflight, not hosted persistence. Authenticated connection inspection of the separate dedicated service did not establish CA trust; certificate and hostname verification were not weakened.

A separate Briefstamp Sentry project was created and configured after confirming a Sponsored Team entitlement with paid overage disabled. The optional child-only SDK implementation has actual local-capture privacy/trace tests. At that point it still needed release and dashboard verification; the later e43dbe74 proof above resolves that gate for one exact proposal trace. Configuration or `flushed: true` alone remains insufficient. Private operator receipts are retained separately; account identifiers, credentials, connection hostnames and billing balances are omitted here.

The records below are historical snapshots. Later source edits, including an image-check description correction, must not be inferred to be deployed from this receipt.

## Verified integration repair, 15 October 2026

Source commit `94727b283fdb19e78eba0964a8002d0a6199b8ca` passed [Actions run 38707381753](https://github.com/himanshu748/flowproof-web/actions/runs/38707381753): **209 application tests, 17 provenance tests**, production build, the fresh-process 256 MB public-runtime check and three ordinary browser audits. Downloaded artifacts were independently checked: 25 PNGs, five portable reports, zero private SDK imports and four fixture regressions/recoveries.

The existing Render service was confirmed **Free**, with no plan or resource changes. Deploy `dep-db894hjncjis73f3gi40` became live at **08:45:47 UTC** with that exact source commit. Subsequent hosted verification observed healthy **5 passed / 1 unverified**, broken **2 passed / 3 failed / 1 unverified**, then restored **5 passed / 1 unverified**. The same manual assertion stayed unverified; unchanged checks recorded three regressions and three recoveries. All three reports contained five actual screenshots. Approval rejection, cross-origin rejection, external-target rejection, visitor/evidence/report isolation and inaccessible private provider routes were checked. The live landing and integration disclosures rendered correctly. Recent logs contained no memory abort after the repair.

[Release receipt and artifact hashes](evidence/release-2026-10-15.json). The article is still a draft. Lasting Tiger storage, hosted provider entitlements and human/customer validation remain open; this release does not complete the full PRD.

## Failed hosted integration attempt, 15 October 2026

Commit `2a85515d80a1f4af9ad39c3c25a61809fefde8a2` passed [Actions run 38705005005](https://github.com/himanshu748/flowproof-web/actions/runs/38705005005): 203 application tests, 17 provenance tests, production build and real healthy/broken/restored browser audits. Render marked deploy `dep-db88rcgn74is73e87dsg` live at 08:27:19 UTC, but the first hosted audit exhausted the JavaScript heap at approximately 256 MB and returned HTTP 502. The service restarted. This deployment is a failed runtime verification, not successful hosted Mastra evidence. The correction keeps real SDK workflows in private operator mode and runs public sample checks directly without loading Mastra.

The [public-runtime regression verifier](../scripts/verify-public-runtime.mjs) starts the actual HTTP server in a fresh process with a 256 MB heap and rejects imports from Mastra, Sentry and Temporal. It verifies proposal creation/regeneration, approval rejection, real healthy/broken Chromium audits, ten PNGs and two portable reports. The local run passed on October 15 at 08:39 UTC with zero private SDK import attempts. CI runs this check and retains its receipts alongside the ordinary browser audit artifacts. This controlled heap check does not substitute for verification on Render.

## Verified source update, 15 October 2026

[Actions run 38690709135](https://github.com/himanshu748/flowproof-web/actions/runs/38690709135) verified source commit `e7be707cd5b947784bc02971742994dfcfc33993`: 140 application tests, 17 provenance tests, a production build and real healthy → broken → restored browser runs. Four regressions and four recoveries were observed. Three portable reports, fifteen screenshots and comparison JSON were downloaded and checked. [Retained receipt and artifact hashes](evidence/ci-regression-2026-10-15.json).

This is source/CI evidence; it does not by itself certify which revision is currently serving the public URL. Render remains an existing free service with manual deployments. The records below are explicitly historical runtime snapshots.

## Historical public snapshot, 15 October 2026

The public repository's main branch, passing CI and live Render deployment were rechecked at 03:50 UTC on October 15, 2026. All three match commit `5d5586109d59286aba7627aa30bc455bd45dbf71`. [Actions run 38580708979](https://github.com/himanshu748/flowproof-web/actions/runs/38580708979) passed 106 application tests, 17 provenance tests, the production build, real healthy/broken browser audits and artifact upload.

The existing Render Docker service remains on `plan: free`, is not suspended, and has auto-deploy disabled. Deployment `dep-db7p4ajncjis73f3ieo0` became live at 14:32:14 UTC on October 14. The fresh check returned HTTP 200 from health and bootstrap, confirmed the title `Briefstamp · Delivery, verified`, and found zero error-level logs since October 15 at 00:00 UTC. This read-only check inspected existing CI evidence; it did not rerun browser audits or model training.

The October 14 Tiger application-store probe verified a separate, no-card trial using an isolated temporary schema. Its evidence and cleanup are in [Tiger verification](TIGER_VERIFICATION.md). That operator-side experiment does not connect this public demo to Tiger. Current integration disclosures distinguish trial evidence, the Shared Free CA blocker and ephemeral visitor storage. Recorded Tinker results remain separate from live model inference.

The rebrand deployment at commit `e028105dc2838f9f1f2460206af2601eba29344a` (`dep-db7nahmq1p3s73d3kil0`, live October 14 at 12:30 UTC) and [Actions run 38564166138](https://github.com/himanshu748/flowproof-web/actions/runs/38564166138) at documentation commit `f1eee9baee58e951bc8eeaa959761cd58447346c` are earlier snapshots. The original release below is also a historical receipt. Model and Tiger experiments retain their own source commits, evidence and limitations.

## Verified release — 13 October 2026

- **Live demo:** [https://flowproof-demo.onrender.com](https://flowproof-demo.onrender.com)
- **Audited application commit:** `8786b263c0bb4a65cb80e8b9d1eeaee2a882bcab`
- **GitHub Actions:** [run 38345840955](https://github.com/himanshu748/flowproof-web/actions/runs/38345840955), success. All **85 tests**, production build, healthy/broken Chromium audit, and artifact upload passed.
- **Historical CI evidence:** `flowproof-evidence`, artifact ID `11787869924`, from [run 38345840955](https://github.com/himanshu748/flowproof-web/actions/runs/38345840955). Its direct download returned 404 during the later link check. The recorded artifact was 795,977 bytes with an advertised expiry of 20 October 2026 and SHA-256 `75ff3032cc1797ff1e0ac87d8e5a15febf03fc8e98e1610f73e814330a58da8b`; these are historical metadata, not a claim that the download remains available.
- **Render:** free Docker web service `srv-db6r2egm7kps73b19hag`, Singapore. Deployment `dep-db6r2f8m7kps73b19kb0` became live at 04:21:20 UTC. The deployed commit matches the audited application commit.
- **Hosted behavior:** two real Chromium audits completed. Healthy: **5 passed, 0 failed, 1 unverified**. Broken: **2 passed, 3 failed, 1 unverified**. Both portable reports include real screenshot evidence.
- **Hosted access checks:** secure visitor cookies; cross-visitor projects, audits, screenshots and reports denied; mixed-case private-route bypass denied; unapproved runs, external targets and cross-origin writes rejected.

The CI fixture checks a contact destination and detects four broken assertions. The public UI brief checks the visible contact label and detects three. This is a difference in approved assertions, not inconsistent counting. The subjective trustworthiness requirement stays unverified in both.

[Machine-readable release receipt](evidence/hosted-release.json) retains counts and provenance after the short-lived CI artifacts expire. Local exported HTML reports and audit JSON are also retained in the build outputs. These are synthetic sample results, not validation of a real client website.

A source-only documentation update may follow this audited application commit. The Render deployment is intentionally pinned through manual deploys; the deployed revision is recorded here rather than inferred from the latest repository head.

## Historical free-resource preflight

- Render Hobby workspace, no card on file, checked 13 October 2026.
- The web service uses `plan: free`; no paid database, persistent worker or disk is authorized. The current release's native Gemma and protected existing-credit Backboard paths have separate evidence and limits above.
- Free allowance at preflight: 70.3/750 instance hours, 23/500 pipeline minutes, 348 MB/5 GB bandwidth, 23/25 services. Allowances are shared with other projects and change with usage.
- Standard public GitHub Actions runner; no larger runner or paid add-on.
- These allowances were observed on October 13, historical, not current balances. Public demo state and screenshots are temporary. The historical release did not establish hosted Tiger, Tinker, Gemma inference, Mastra, Sentry or Temporal; the newer hosted Gemma/Mastra/Backboard receipts are recorded above.

## Reproduce

```sh
npm ci --legacy-peer-deps
npx playwright install --with-deps chromium
npm run verify
```

The workflow runs healthy, intentionally broken and restored synthetic pages and retains portable reports, comparisons, screenshots and JSON as seven-day artifacts. Public CI artifacts must contain synthetic evidence only unless a client has expressly approved publication. Never commit a private client brief, `.env`, database content, screenshots, or credentials.
