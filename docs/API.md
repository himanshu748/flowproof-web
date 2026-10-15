# Briefstamp local API contract

All JSON endpoints use /api. Errors return {error:string}. No authentication is required for the loopback-only local development server. Public operator mode requires an access token. The separate public synthetic demo uses isolated visitor sessions and terminates before every private provider route.

- GET /api/bootstrap returns Bootstrap from shared/types.ts.
- POST /api/projects accepts {name, target:'sample'|'website', url?, sampleVariant?:'healthy'|'broken', authorized:boolean, brief}. Returns Project with generated unapproved checks.
- GET /api/projects/:id returns Project.
- PUT /api/projects/:id/checks accepts {checks:Check[]}. Validates and saves the entire reviewed plan.
- POST /api/projects/:id/generate accepts {brief:string}. Replaces checks with unapproved checks, returns Project.
- POST /api/projects/:id/audits accepts {}. Requires every executable check approved and authorized project. Returns Audit (202). Poll GET /api/audits/:id for results as each check completes.
- GET /api/audits/:id returns Audit.
- GET /api/audits/:id/report returns downloadable standalone HTML report with images embedded.
- GET /api/failures?q=... returns {results:[{auditId,projectName,requirement,observed,status,createdAt}], mode:string}.
- POST /api/projects/:id/variant accepts {sampleVariant:'healthy'|'broken'}, resets approvals and returns Project.
- GET /api/projects/:id/plan returns downloadable versioned JSON plan for GitHub Actions.

Synthetic target uses browser route fulfillment and never requires a local network exemption. Fresh installs are seeded with a sample project and six unapproved checks, zero audit results. Generator must disclose deterministic fallback and no AI credentials means no AI claim.

## Integration operations (private operator only)

- POST /api/audits/:id/memory writes anonymous assertion facts through Backboard.
- POST /api/projects/:id/memory/search accepts {kind:CheckKind} and returns only matching project-scoped records.
- POST /api/projects/:id/search-visibility requests one SerpApi observation for an authorized, operator-allowlisted hostname.
- POST /api/audits/:id/speech returns an MP3 for a completed noncommercial synthetic audit only.

These actions are disabled by default and require fresh account-bound free-resource proof and durable request reservations. They return a safe provider error rather than silently retrying. No public visitor can call them. See [provider contracts and account gates](OPTIONAL_PROVIDERS.md).

Private operator proposal and ordinary audit routes use real Mastra SDK workflows. The public sample uses the deterministic parser and direct bounded Playwright runner to fit the free hosting memory limit. Optional Sentry traces pass a final privacy allowlist; hosted sending stays disabled without fresh free-account confirmation.

With local Temporal explicitly enabled, an audit stores its deterministic workflow identity before dispatch. An empty workflow runId means scheduling is not yet confirmed. Polling reconciles accepted runs and validates the original approved snapshot. A stopped service returns the saved pending audit with a diagnostic, and never converts unavailable or unexecuted work into a pass. Completion is published only after evidence/state persistence succeeds. See [Temporal setup and proof](TEMPORAL.md).
