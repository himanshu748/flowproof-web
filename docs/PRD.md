# FlowProof product requirements, version 1.0

Source: the user-provided implementation brief, October 13, 2026. Status: proposed for implementation. Challenge: Hacktoberfest 2026 Week 2, Side Hustle. Deadline supplied in the brief: October 18, 2026, 11:59 PM PDT. Budget: ₹0 out of pocket.

## Vision and users

FlowProof turns client website requirements into verified acceptance tests and professional delivery reports. Freelancers and small agencies should be able to show clients how a delivered website meets agreed requirements without hours of manual screenshot and document work. The product combines open-weight AI, deterministic browser testing and traceable evidence. Proposed pricing of ₹499 per project handoff or ₹999 per month is a hypothesis requiring customer validation, not an existing offer.

## Required journey

1. Create a named project using an authorized website or a synthetic sample.
2. Paste the client brief and review the extracted interpretation.
3. Generate safe structured acceptance checks with a fine-tuned Tinker model.
4. Let the developer edit and approve the checks before execution.
5. Execute actual Playwright checks and capture observations.
6. Distinguish passed, failed, blocked and unverified requirements.
7. Generate a branded, understandable report with screenshots.
8. Rerun approved checks through GitHub Actions to catch regressions.

## Priorities

| ID | Requirement | Priority |
|---|---|---|
| F01 | Projects and sample project | P0 |
| F02 | Client brief parsing | P0 |
| F03 | AI-generated structured acceptance checks | P0 |
| F04 | Human editing and approval | P0 |
| F05 | Actual Playwright execution | P0 |
| F06 | Screenshot and DOM evidence | P0 |
| F07 | Shareable delivery report | P0 |
| F08 | Tiger Data persistence | P0 |
| F09 | GitHub Actions audit | P0 |
| F10 | Tinker baseline and fine-tuning evaluation | P0 |
| F11 | Historical failure retrieval | P1 |
| F12 | Mastra orchestration | P1 |
| F13 | Sentry tracing | P1 |
| F14 | Temporal recovery | P1 |
| F15 | Additional sponsor features | P2 |

The intended architecture is React on Render, Mastra coordination, Tinker fine-tuned Qwen3.5-4B for proposals, a bounded Playwright runner for execution, Tiger Data/PostgreSQL with vector retrieval, GitHub Actions, Sentry and Temporal. Only functioning integrations with actual evidence may be claimed. Optional sponsors include Gemma, Entire, Backboard, SerpApi, ElevenLabs and a .tech domain.

## Evaluation requirements

Prepare approximately 300 to 500 requirement/check candidates, manually validate useful examples and split by website and requirement family to reduce leakage. Compare base zero-shot, base few-shot and Tinker LoRA Qwen3.5-4B. Measure structured-output validity, interpretation, executable correctness, false passes against broken sites, abstention, latency and actual tokens. Any claimed improvement must come from real experiments against the strongest baseline.

## Safety and experience

Only authorized websites may be audited. Reject localhost, private networks, metadata endpoints and unsafe redirects. Do not execute unrestricted generated scripts, submit forms, purchase or perform destructive actions. Never count unavailable or unexecuted checks as passed. Redact credentials and private client information. Require approval, bounded pages, timeouts and API budgets.

The experience is a professional delivery cockpit. Required surfaces are an interactive introduction, project/brief intake, check review, live audit monitor, visual evidence/report viewer and model evaluation dashboard. Reports must work on mobile and with keyboards and be understandable by clients.

## Milestones and completion

October 13: repository, design, database, safe schema. October 14: browser execution, evidence, Actions. October 15: Mastra, Tinker training and evaluation. October 16: reporting, Tiger retrieval and hosted demo. October 17: observability, reliability, customer validation and sponsor evidence. October 18: final tests, demo and DEV submission.

The hackathon release needs a tested authorized website using approved AI assertions, reliably failing broken requirements, traceable reports, verified remote Actions, genuine Tiger retrieval, reproducible Tinker results or removal of that category, a public demo/video and repository, at least one real customer invitation, no paid infrastructure and an evidence-backed DEV article. Product success requires a freelancer who finds the tool worth considering paying for. Local engineering success does not establish customer validation or submission.
