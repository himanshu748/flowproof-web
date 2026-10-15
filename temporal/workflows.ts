import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";
import {
  PROGRESS_QUERY,
  RECOVERY_SIGNAL,
  type AuditWorkflowInput,
  type AuditWorkflowProgress,
  type AuditActivityResult,
} from "./contracts.js";

const { executeApprovedAudit } = proxyActivities<
  Pick<
    ReturnType<typeof activities.createAuditActivities>,
    "executeApprovedAudit"
  >
>({
  startToCloseTimeout: "3 minutes",
  scheduleToCloseTimeout: "8 minutes",
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "5 seconds",
    maximumAttempts: 3,
    nonRetryableErrorTypes: ["AuditSafetyError", "InvalidAuditPlan"],
  },
});
const resume = defineSignal(RECOVERY_SIGNAL);
const progress = defineQuery<AuditWorkflowProgress>(PROGRESS_QUERY);

/** Only deterministic orchestration belongs here. Browser and disk I/O are activities. */
export async function approvedAuditWorkflow(
  input: AuditWorkflowInput,
): Promise<AuditActivityResult> {
  let released = false;
  let phase: AuditWorkflowProgress["phase"] = "auditing";
  setHandler(resume, () => {
    released = true;
  });
  setHandler(progress, () => ({ phase, auditId: input.audit.id }));
  const result = await executeApprovedAudit(input);
  if (input.waitForRecoverySignal) {
    phase = "waiting-for-recovery";
    const signaled = await condition(() => released, "10 minutes");
    if (!signaled)
      throw ApplicationFailure.nonRetryable(
        "The local recovery demonstration did not receive its completion signal.",
        "RecoverySignalTimeout",
      );
  }
  phase = "completed";
  return result;
}
