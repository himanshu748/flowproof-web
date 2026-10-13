# FlowProof local API contract

All JSON endpoints use /api. Errors return {error:string}. No authentication is required for the loopback-only local development server. Public mode must require an operator token for every API request.

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
