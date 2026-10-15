import { isDeepStrictEqual } from "node:util";
import { snapshotSource } from "../shared/compare-audits.js";
import { redact } from "../shared/redact.js";
import type { Audit, Project } from "../shared/types.js";
import type {
  readTemporalAudit,
  startApprovedAudit,
} from "../temporal/client.js";
import { validateApprovedAudit } from "../temporal/validation.js";

export interface DurableAuditReader {
  save(audit: Audit): Promise<unknown>;
  read: typeof readTemporalAudit;
}
export interface DurableAuditDispatcher extends DurableAuditReader {
  start: typeof startApprovedAudit;
}

const unavailable =
  "Temporal is temporarily unavailable. The saved audit remains pending; no new outcome is claimed.";
const unconfirmed =
  "Scheduling confirmation is pending. The saved workflow identity will be checked again; no completed audit is claimed.";
const unsaved =
  "The latest workflow state could not be saved. The previously saved audit remains available for reconciliation.";
const mismatch =
  "The workflow response does not match this saved audit. Existing audit data has been preserved.";
const pending = (audit: Audit) =>
  audit.status === "queued" || audit.status === "running";
const workflowIdFor = (audit: Audit) => `briefstamp-audit-${audit.id}`;
const diagnostic = (audit: Audit, message: string): Audit => ({
  ...structuredClone(audit),
  error: message,
});
const validRunId = (value: string) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

function matchesCompletedAudit(
  stored: Audit,
  complete: Audit | undefined,
): boolean {
  if (
    !stored.source ||
    !complete ||
    complete.status !== "completed" ||
    complete.id !== stored.id ||
    complete.projectId !== stored.projectId ||
    complete.projectName !== stored.projectName ||
    complete.createdAt !== stored.createdAt ||
    !isDeepStrictEqual(complete.checks, stored.checks) ||
    !isDeepStrictEqual(complete.source, stored.source) ||
    !complete.completedAt ||
    !Number.isFinite(Date.parse(complete.completedAt)) ||
    Date.parse(complete.completedAt) < Date.parse(stored.createdAt) ||
    !Array.isArray(complete.results) ||
    complete.results.length !== stored.checks.length
  )
    return false;
  return stored.checks.every((check) => {
    const rows = complete.results.filter((row) => row?.checkId === check.id);
    if (rows.length !== 1) return false;
    const row = rows[0];
    return (
      row.kind === check.kind &&
      typeof row.requirement === "string" &&
      redact(row.requirement) === redact(check.requirement) &&
      typeof row.expected === "string" &&
      redact(row.expected) === redact(check.expected) &&
      ["passed", "failed", "blocked", "unverified"].includes(row.status) &&
      (check.kind === "manual"
        ? row.status === "unverified"
        : check.approved) &&
      Number.isFinite(row.durationMs) &&
      row.durationMs >= 0 &&
      typeof row.evidence?.observed === "string" &&
      typeof row.evidence?.url === "string"
    );
  });
}

/** Preserve the last saved state when either the service or persistence is unavailable. */
export async function refreshDurableAudit(
  audit: Audit,
  dependencies: DurableAuditReader,
): Promise<Audit> {
  const stored = structuredClone(audit);
  if (!stored.workflow || !pending(stored)) return stored;
  if (
    stored.workflow.provider !== "Temporal" ||
    stored.workflow.workflowId !== workflowIdFor(stored)
  )
    return diagnostic(stored, mismatch);
  let state: Awaited<ReturnType<typeof readTemporalAudit>>;
  try {
    state = await dependencies.read(stored.workflow.workflowId);
  } catch {
    return diagnostic(stored, unavailable);
  }
  if (
    !state ||
    !validRunId(state.runId) ||
    (stored.workflow.runId && state.runId !== stored.workflow.runId)
  )
    return diagnostic(stored, mismatch);
  const workflow = { ...stored.workflow, runId: state.runId };
  let next: Audit;
  if (state.status === "completed") {
    if (!state.result || !matchesCompletedAudit(stored, state.result.audit))
      return diagnostic(stored, mismatch);
    next = { ...structuredClone(state.result.audit), workflow };
    delete next.error;
  } else if (state.status === "running") {
    next = { ...stored, status: "running", workflow };
    delete next.error;
  } else if (
    ["failed", "canceled", "terminated", "timed_out"].includes(state.status)
  ) {
    next = {
      ...stored,
      workflow,
      status: "error",
      completedAt: new Date().toISOString(),
      error:
        "The workflow ended without completing the audit. Unexecuted requirements remain unverified.",
    };
  } else return diagnostic(stored, unconfirmed);
  try {
    await dependencies.save(structuredClone(next));
    return next;
  } catch {
    return diagnostic(stored, unsaved);
  }
}

/** The deterministic identity is durable before a start can be accepted remotely. */
export async function dispatchDurableAudit(
  project: Project,
  audit: Audit,
  dependencies: DurableAuditDispatcher,
): Promise<Audit> {
  const snapshot = structuredClone(project);
  const queued = structuredClone(audit);
  if (!pending(queued))
    throw new Error("Only a pending audit can be dispatched.");
  validateApprovedAudit({ project: snapshot, audit: queued });
  const source = snapshotSource(snapshot);
  if (queued.source && !isDeepStrictEqual(queued.source, source))
    throw new Error(
      "The audit source differs from its approved project snapshot.",
    );
  if (
    queued.projectName !== snapshot.name ||
    !Number.isFinite(Date.parse(queued.createdAt))
  )
    throw new Error(
      "The audit identity differs from its approved project snapshot.",
    );
  if (
    queued.workflow &&
    (queued.workflow.provider !== "Temporal" ||
      queued.workflow.workflowId !== workflowIdFor(queued))
  )
    throw new Error("The saved workflow identity does not match this audit.");
  if (queued.workflow?.runId) return refreshDurableAudit(queued, dependencies);
  queued.source = source;
  queued.status = "queued";
  queued.workflow = {
    provider: "Temporal",
    workflowId: workflowIdFor(queued),
    runId: "",
  };
  delete queued.error;
  delete queued.completedAt;
  // A failure here is definitive: start has not been called and must not be called.
  await dependencies.save(structuredClone(queued));
  try {
    const dispatched = await dependencies.start(
      snapshot,
      structuredClone(queued),
    );
    if (
      dispatched.workflowId !== queued.workflow.workflowId ||
      !validRunId(dispatched.runId)
    )
      return refreshDurableAudit(diagnostic(queued, mismatch), dependencies);
    const accepted: Audit = {
      ...queued,
      workflow: { ...queued.workflow, runId: dispatched.runId },
    };
    await dependencies.save(structuredClone(accepted));
    return accepted;
  } catch {
    // A lost start reply or post-start save failure cannot prove that start failed.
    return refreshDurableAudit(diagnostic(queued, unconfirmed), dependencies);
  }
}
