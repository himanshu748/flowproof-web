import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  type ActivityOptions,
} from "@temporalio/workflow";
import { TEMPORAL_AGENT_NON_RETRYABLE } from "./agent-contracts.js";
import type {
  TemporalAgentActivities,
  TemporalAgentInput,
  TemporalAgentResult,
} from "./agent-contracts.js";
import type { EvidenceToolObservation } from "../server/evidence-agent.js";

export const AGENT_PROGRESS_QUERY = "evidenceAgentProgress";
export const AGENT_RECOVERY_SIGNAL = "continueAfterTiger";
export interface TemporalAgentProgress {
  phase:
    | "reserving"
    | "selecting"
    | "tiger"
    | "waiting-after-tiger"
    | "searching"
    | "summarizing"
    | "completed"
    | "failed";
  auditId: string;
}
const options: ActivityOptions = {
  startToCloseTimeout: "90 seconds",
  scheduleToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "4 seconds",
    maximumAttempts: 3,
    nonRetryableErrorTypes: [...TEMPORAL_AGENT_NON_RETRYABLE],
  },
};
const reservation = proxyActivities<
  Pick<TemporalAgentActivities, "reserveEvidenceAllowance">
>({ ...options, activityId: "reserve-evidence-run" });
const select = proxyActivities<
  Pick<TemporalAgentActivities, "selectEvidenceTools">
>({ ...options, activityId: "gemma-select-tools" });
const history = proxyActivities<
  Pick<TemporalAgentActivities, "retrieveTigerEvidence">
>({ ...options, activityId: "tiger-failure-history" });
const search = proxyActivities<
  Pick<TemporalAgentActivities, "searchEvidenceVisibility">
>({ ...options, activityId: "serpapi-search-visibility" });
const summarize = proxyActivities<
  Pick<TemporalAgentActivities, "summarizeEvidence">
>({ ...options, activityId: "gemma-summarize" });
const progress = defineQuery<TemporalAgentProgress>(AGENT_PROGRESS_QUERY);
const continueAfterTiger = defineSignal(AGENT_RECOVERY_SIGNAL);

/** The full four-stage evidence agent. Every external operation is an activity.
 * Browser acceptance input is immutable; only separate cited findings are returned.
 * CI/local recorded-provider adapters are separate from the public judge grant.
 */
export async function evidenceAgentWorkflow(
  input: TemporalAgentInput,
): Promise<TemporalAgentResult> {
  let phase: TemporalAgentProgress["phase"] = "reserving";
  let released = false;
  setHandler(progress, () => ({ phase, auditId: input.audit.id }));
  setHandler(continueAfterTiger, () => {
    released = true;
  });
  try {
    const reserved = await reservation.reserveEvidenceAllowance(input);
    phase = "selecting";
    const selection = await select.selectEvidenceTools(input);
    const observations: EvidenceToolObservation[] = [];
    for (const [index, tool] of selection.selection.tools.entries()) {
      const observationId = `tool-${index + 1}` as "tool-1" | "tool-2";
      if (tool.name === "failure_history") {
        phase = "tiger";
        observations.push(
          await history.retrieveTigerEvidence({
            input,
            queryId: tool.arguments.queryId,
            observationId,
          }),
        );
        if (input.pauseAfterTiger) {
          phase = "waiting-after-tiger";
          if (!(await condition(() => released, "2 minutes")))
            throw ApplicationFailure.nonRetryable(
              "The local worker-recovery check was not released.",
              "RecoveryGateExpired",
            );
        }
      } else {
        phase = "searching";
        observations.push(
          await search.searchEvidenceVisibility({ input, observationId }),
        );
      }
    }
    phase = "summarizing";
    const summary = await summarize.summarizeEvidence({
      input,
      selection: selection.selection,
      observations,
    });
    phase = "completed";
    return { reservation: reserved, selection, observations, summary };
  } catch (error) {
    phase = "failed";
    throw error;
  }
}
