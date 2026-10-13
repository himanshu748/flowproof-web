# Deployment evidence

Repository: https://github.com/himanshu748/flowproof-web (public).

The hosted release is being verified. A successful GitHub workflow and a live Render audit will be recorded here only after execution.

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
