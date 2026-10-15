# Deployment evidence

Repository: https://github.com/himanshu748/flowproof-web (public).

## Verified public snapshot, 15 October 2026

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

The workflow runs both healthy and intentionally broken synthetic pages and retains screenshots and JSON as seven-day artifacts. Public CI artifacts must contain synthetic evidence only unless a client has expressly approved publication. Never commit a private client brief, `.env`, database content, screenshots, or credentials.
