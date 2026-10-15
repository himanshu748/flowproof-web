# Briefstamp PRD status

**Reviewed October 15, 2026. Verdict: a working, demonstrated MVP; the full PRD and hackathon definition of done are not complete. All planned integrations are not done.**

This assessment uses the user-supplied [PRD](PRD.md), checked-in code and retained execution evidence. The independently checked public snapshot is commit `5d5586109d59286aba7627aa30bc455bd45dbf71`: [public demo](https://flowproof-demo.onrender.com/), [repository](https://github.com/himanshu748/flowproof-web), [passing Actions run](https://github.com/himanshu748/flowproof-web/actions/runs/38580708979). The new landing page passed a production build and local browser checks; its publication is tracked separately from that earlier release snapshot.

“Implemented” means the capability exists in the indicated mode. “Demonstrated” means an actual run has evidence, within its stated scope. Neither label implies production readiness or real customer validation.

## Functional requirements

| ID | Assessment | What works and what remains |
|---|---|---|
| F01 — projects/sample | Implemented; sample demonstrated | Named projects and an isolated synthetic sample work. The public demo only accepts the sample; authorized external targets are an operator-mode capability, not publicly available. |
| F02 — brief parsing | Implemented; narrow scope | Conservative parsing produces finite assertions and abstains on unsupported requirements. It does not establish correct interpretation of arbitrary client briefs. |
| F03 — AI test generation | **Partial P0** | Local Ollama/Gemma has an actual API smoke test plus a three-requirement proposal → test-harness approval → healthy/broken/restored Chromium workflow with raw model receipts. Two full-six-requirement attempts timed out; see [Gemma evidence](GEMMA_WORKFLOW.md). Tinker baseline/LoRA proposals were evaluated separately; the application has no live Tinker generation adapter. Public visitors receive clearly labelled deterministic drafts. |
| F04 — editing/approval | Implemented; demonstrated | Changes reset approval; the server rejects executable assertions that are unapproved or do not match the current approved plan. Manual checks remain unverified. |
| F05 — Playwright execution | Implemented; synthetic targets demonstrated | Real Chromium runs both healthy and intentionally broken websites. An actual authorized external client-site acceptance run remains missing. |
| F06 — screenshot/DOM evidence | Implemented; demonstrated | Results retain screenshots and observed DOM text linked to their assertions. New audits snapshot the source brief, generator and target; comparisons only call unchanged assertions regressions or recoveries. They are evidence for the captured page and viewport, not proof of every website behavior. |
| F07 — delivery reports | Implemented; demonstrated | Downloadable HTML reports embed screenshots and support print-to-PDF, mobile layouts and keyboard use. Partial reports retain unexecuted planned checks, flag conflicting results and disclose missing screenshots. Public demo state and report endpoints expire; the downloaded report is portable. |
| F08 — Tiger persistence | **Partial P0** | A strict-TLS, no-card trial probe persisted two projects/audits and ten screenshots, recovered them in a fresh process, exercised retrieval and removed its temporary schema. The public demo has no Tiger persistence. A lasting confirmed-free connection is unresolved; the separate Shared Free service remains blocked by an unauthenticated CA. |
| F09 — Actions audit | Implemented; remotely demonstrated | The linked run passed 106 application tests, 17 provenance tests, the build, real healthy/broken browser audits and evidence upload. Saved approved plans are supported. This does not prove installation in a customer's repository. |
| F10 — Tinker evaluation | **Partial P0** | Real zero-shot, six-shot and LoRA runs plus paired browser evaluation are reproducible from saved artifacts. There are 360 unreviewed candidates and a separate 96-example agent-reviewed pilot; **zero human-validated examples**. Fine-tuning did not outperform the strongest baseline. Human validation and broader client-representative evaluation remain open. |
| F11 — historical retrieval | Implemented; bounded demonstration | Actual lexical/vector retrieval was verified locally, in the Shared Free console and through the application store on the isolated trial. Four synthetic failure vectors are a connectivity demonstration, not a retrieval-quality benchmark. No hosted visitor retrieval or accelerated vector-index claim. |
| F12 — Mastra | Not implemented | Ordinary TypeScript service functions do not constitute Mastra orchestration. |
| F13 — Sentry | Not implemented | Local logs do not constitute Sentry tracing. |
| F14 — Temporal | Not implemented | In-process handling does not provide durable Temporal retries or recovery. |
| F15 — additional sponsors | Mostly absent; optional | Local Gemma has bounded development evidence. Entire, Backboard, SerpApi, ElevenLabs and a .tech domain have no functioning project-specific integration evidence. |

Sources: [release readiness](RELEASE_READINESS.md), [integration ledger](INTEGRATIONS.md), [generation adapter](../server/generator.ts), [approval/runner](../server/runner.ts), [store](../server/store.ts), [report](../server/report.ts), [Actions workflow](../.github/workflows/audit.yml).

## Integration claims that are supportable

- **Live public demo:** Render free service and real Playwright execution. GitHub Actions has an actual passing remote run.
- **Demonstrated outside the public runtime:** local Gemma/Ollama; Tiger strict-TLS persistence/retrieval in an isolated no-card trial; real Tinker training and evaluation on previously confirmed promotional credits.
- **Not active in the public runtime:** model inference, Tiger persistence, Mastra, Sentry and Temporal. The public integration indicators disclose these boundaries.
- **Not demonstrated:** Copilot coding tools, Entire, Backboard, SerpApi, ElevenLabs and .tech. The official Week 2 GitHub Copilot category explicitly permits GitHub Actions automation, so the evidenced workflow supports that category route without a Copilot coding claim. See [entry evidence](HACKATHON_ENTRY.md).

The Tiger trial demonstration is not a permanent free database, and its authorization was for one temporary schema that was removed. Do not silently repurpose FieldIssue's service. The Shared Free certificate issue must be resolved with authenticated provider trust material; certificate or hostname checks must remain enabled.

The strongest Tinker baseline achieved **23/24 reference matches and 19/20 correct healthy/broken pairs**. LoRA achieved **22/24 and 18/20**. Reference agreement is not human-scored accuracy. Zero-shot's absent executions do not establish a zero false-pass rate. See [measured results](MODEL_RESULTS.md) and [Tiger verification](TIGER_VERIFICATION.md).

## Definition of done

| PRD gate | Status |
|---|---|
| Real website tested with approved AI assertions | **Partial:** local AI proposal → approval → actual Chromium execution is demonstrated on a synthetic site. A real authorized client website remains untested. |
| Intentionally broken requirement reliably fails | **Demonstrated:** the hosted UI brief produced three failures; the separate fixture plan detects four. These plans assert different things and their counts must not be conflated. |
| Report traces results to requirements/evidence | **Demonstrated:** downloadable reports preserve requirement, assertion, observed result and screenshots. |
| Actions runs a real audit | **Demonstrated** by the linked successful remote workflow. |
| Genuine Tiger retrieval over saved failures | **Demonstrated within isolated trial/console scope;** ongoing public-app persistence remains missing. |
| Reproducible, honestly measured Tinker comparison or category removal | **Pilot comparison demonstrated.** Do not claim model improvement, human validation or live Tinker generation. |
| Accessible public demo/video and public repository | **Demonstrated:** public demo and repository exist. A video is optional under this gate. |
| At least one real potential-customer invitation | **Missing:** a local invitation draft exists; no invitation or feedback outcome is claimed. |
| No paid infrastructure required | **Current default demo uses free resources.** The temporary Tiger trial does not establish lasting free storage. Fresh provider allowance confirmation is required before further model/provider usage. |
| Evidence-backed DEV article and submission | **Missing:** local article/demo drafts exist; no published submission receipt. Check the one-entry rule and existing submissions before publishing. |

Fresh hosted workflow evidence on October 15 reran two real Chromium audits and checked session isolation, approval rejection, external-target rejection, cross-origin rejection, screenshot access and embedded reports. The healthy result was **5 passed / 0 failed / 0 blocked / 1 unverified**; the broken result was **2 passed / 3 failed / 0 blocked / 1 unverified**. This is current behavior on synthetic pages, not customer acceptance.

## Experience and safety

Project/brief intake, assertion review, audit monitoring, evidence/report viewing and the model dashboard exist. The separate landing page now includes original conceptual artwork, an interactive synthetic example and honest integration disclosures. Local browser checks at 360, 390, 768, 1024 and 1440 pixels found no page overflow, loaded imagery and touch targets of at least 40 pixels. The FAQ keyboard toggle, workspace entry, unsaved approval retention and intake-state recovery were checked. Reduced-motion handling is implemented and source-reviewed; this browser did not expose a media-preference override for a separate runtime check.

The runner uses a finite schema, approval enforcement, authorization acknowledgement, public-network validation, redirect/request/byte/time limits, a maximum of 24 checks over eight paths, and no form submission or arbitrary generated scripts. External-site scripts are disabled and same-origin resources are restricted, so some real sites will be blocked or untestable. Redaction is defensive rather than a guarantee that arbitrary private content can safely be shared; inspect captured evidence before handoff. See [schema](../server/schema.ts), [network policy](../server/safety.ts) and [database TLS policy](../server/database.ts).

The public demo is an isolated, 30-minute, in-memory visitor session. Restart clears state. This is a useful demonstration, not a multi-user production service with accounts or durable workflow recovery.

## Success criteria and shortest honest completion path

- **Product success is unverified:** no freelancer/customer has yet indicated willingness to pay.
- **Technical success is partial:** deterministic execution and traceable evidence work; the measured fine-tuned model did not improve on the strongest baseline.
- **Hackathon readiness is incomplete:** substantial evidence exists, but customer invitation, final article/submission and the remaining P0 boundaries must be addressed or explicitly scoped out.

Next: obtain founder test feedback and independent freelancer input; run an authorized real website/brief through approval and reporting; obtain actual human review of the dataset; choose a lasting confirmed-free Tiger connection with authenticated TLS; verify a bounded live Tinker adapter only after fresh free-credit confirmation; send a real customer invitation with recipient authorization; publish only evidenced integrations in the final article. P1 sponsor additions should follow those gaps and be tested individually.
