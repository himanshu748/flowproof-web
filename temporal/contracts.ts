import type { Audit, Project } from "../shared/types.js";

export const AUDIT_TASK_QUEUE = "briefstamp-approved-audits";
export const AUDIT_WORKFLOW = "approvedAuditWorkflow";
export const RECOVERY_SIGNAL = "resumeAfterRecovery";
export const PROGRESS_QUERY = "auditProgress";
export interface AuditWorkflowInput {
  project: Project;
  audit: Audit;
  /** Only the local recovery demonstration waits for this signal. */
  waitForRecoverySignal?: boolean;
}
export interface AuditWorkflowProgress {
  phase: "auditing" | "waiting-for-recovery" | "completed";
  auditId: string;
}
export interface AuditActivityResult {
  audit: Audit;
  planSha256: string;
  reportSha256: string;
  screenshots: { filename: string; sha256: string }[];
}
export interface TemporalDispatch {
  workflowId: string;
  runId: string;
}
