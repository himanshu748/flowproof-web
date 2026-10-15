# Deployment evidence

Repository: https://github.com/himanshu748/flowproof-web (public).

## Integration revision evidence, October15

The [current Actions workflow](https://github.com/himanshu748/flowproof-web/actions/workflows/audit.yml) is the source for revision-specific CI state. New local SDK and provider receipts are linked in [the integration ledger](INTEGRATIONS.md): Mastra approval/browser coordination, Sentry local transport, Temporal retry/restart recovery, scoped Entire import and a real SerpApi search. These receipts do not imply hosted Sentry, a hosted Temporal worker or permanent Tiger storage. Public visitors never invoke optional paid-capable provider APIs. Mastra remains a verified local/private operator integration; public audits use the direct bounded runner to fit the free instance memory limit.

The deployment records below are historical snapshots, not an assertion that their hashes equal the latest repository revision. The existing service remains manually deployed; verify its exact commit separately before claiming a new release live.

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
- **CI evidence:** [flowproof-evidence](https://github.com/himanshu748/flowproof-web/actions/runs/38345840955/artifacts/11787869924), 795,977 bytes, expires 20 October 2026. SHA-256 `75ff3032cc1797ff1e0ac87d8e5a15febf03fc8e98e1610f73e814330a58da8b`.
- **Render:** free Docker web service `srv-db6r2egm7kps73b19hag`, Singapore. Deployment `dep-db6r2f8m7kps73b19kb0` became live at 04:21:20 UTC. The deployed commit matches the audited application commit.
- **Hosted behavior:** two real Chromium audits completed. Healthy: **5 passed, 0 failed, 1 unverified**. Broken: **2 passed, 3 failed, 1 unverified**. Both portable reports include real screenshot evidence.
- **Hosted access checks:** secure visitor cookies; cross-visitor projects, audits, screenshots and reports denied; mixed-case private-route bypass denied; unapproved runs, external targets and cross-origin writes rejected.

The CI fixture checks a contact destination and detects four broken assertions. The public UI brief checks the visible contact label and detects three. This is a difference in approved assertions, not inconsistent counting. The subjective trustworthiness requirement stays unverified in both.

[Machine-readable release receipt](evidence/hosted-release.json) retains counts and provenance after the short-lived CI artifacts expire. Local exported HTML reports and audit JSON are also retained in the build outputs. These are synthetic sample results, not validation of a real client website.

A source-only documentation update may follow this audited application commit. The Render deployment is intentionally pinned through manual deploys; the deployed revision is recorded here rather than inferred from the latest repository head.

## Free resources

- Render Hobby workspace, no card on file, checked 13 October 2026.
- New web service must use `plan: free`; no database, worker, disk, or model provider.
- Free allowance at preflight: 70.3/750 instance hours, 23/500 pipeline minutes, 348 MB/5 GB bandwidth, 23/25 services. Allowances are shared with other projects and change with usage.
- Standard public GitHub Actions runner; no larger runner or paid add-on.
- Public demo state and screenshots are temporary. No Tiger Data, Tinker, Gemma inference, Mastra, Sentry or Temporal connection is claimed by this deployment.

## Reproduce

```sh
npm ci --legacy-peer-deps
npx playwright install --with-deps chromium
npm run verify
```

The workflow runs healthy, intentionally broken and restored synthetic pages and retains portable reports, comparisons, screenshots and JSON as seven-day artifacts. Public CI artifacts must contain synthetic evidence only unless a client has expressly approved publication. Never commit a private client brief, `.env`, database content, screenshots, or credentials.
