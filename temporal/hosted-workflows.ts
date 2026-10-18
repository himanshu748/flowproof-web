import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import {
  HOSTED_TEMPORAL_CONTINUE,
  HOSTED_TEMPORAL_PROGRESS,
} from "./hosted-contracts.js";
import type {
  HostedTemporalActivities,
  HostedTemporalInput,
  HostedTemporalProgress,
  HostedTemporalResult,
} from "./hosted-contracts.js";
const activities = proxyActivities<HostedTemporalActivities>({
  startToCloseTimeout: "75 seconds",
  scheduleToCloseTimeout: "90 seconds",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "1 second",
    maximumAttempts: 2,
    nonRetryableErrorTypes: [
      "HostedEvidenceSafetyError",
      "HostedEvidenceProviderFailure",
      "HostedEvidenceAmbiguousCompletion",
    ],
  },
});
export async function hostedEvidenceAgentWorkflow(
  input: HostedTemporalInput,
): Promise<HostedTemporalResult> {
  let phase: HostedTemporalProgress["phase"] = "select_tools";
  let released = false;
  setHandler(
    defineQuery<HostedTemporalProgress>(HOSTED_TEMPORAL_PROGRESS),
    () => ({ phase, auditId: input.auditId }),
  );
  setHandler(defineSignal(HOSTED_TEMPORAL_CONTINUE), () => {
    released = true;
  });
  const selection = await activities.selectEvidenceTools(input);
  const observations: HostedTemporalResult["observations"] = [];
  if (!selection.selection.tools.length) {
    phase = "completed";
    return { selection, observations, summary: null };
  }
  for (const [index, tool] of selection.selection.tools.entries()) {
    const id = `tool-${index + 1}` as "tool-1" | "tool-2";
    if (tool.name === "failure_history") {
      phase = "tiger";
      observations.push(
        await activities.retrieveTigerEvidence(
          input,
          tool.arguments.queryId,
          id,
        ),
      );
      if (input.controlledRecovery) {
        phase = "waiting-after-tiger";
        if (!(await condition(() => released, "45 seconds")))
          throw ApplicationFailure.nonRetryable(
            "Controlled worker recovery was not released.",
            "HostedEvidenceSafetyError",
          );
      }
    } else {
      phase = "search";
      observations.push(await activities.searchEvidenceVisibility(input, id));
    }
  }
  phase = "summarize";
  const summary = await activities.summarizeEvidence(
    input,
    selection.selection,
    observations,
  );
  phase = "completed";
  return { selection, observations, summary };
}
