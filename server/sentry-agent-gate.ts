import { createMastraBackboardGate } from "./mastra-backboard-gate.js";

/**
 * A fresh, separately approved four-unit run. Earlier Task 1 and Task 2 grants
 * must already be spent and remain exact-byte bound; neither is reactivated.
 * The separate hosted-Sentry export grant is not a provider-call allowance.
 */
const sentryAgentGate = createMastraBackboardGate({
  proofKey: "BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON",
  enabledKey: "BRIEFSTAMP_SENTRY_AGENT_ENABLED",
  filePrefix: "sentry-agent",
  previousProofKey: "BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON",
  requiredSpentProofKeys: ["BRIEFSTAMP_BACKBOARD_ANSWER_PROOF_JSON"],
});

export const priorSentryAgentProofHashes = sentryAgentGate.priorProofHashes;
export const sentryAgentConfiguration = sentryAgentGate.configuration;
export const authorizeSentryAgentOperator = sentryAgentGate.authorizeOperator;
export const reserveSentryAgentRun = sentryAgentGate.reserveRun;
export const reserveSentryAgentCall = sentryAgentGate.reserveCall;
export const sentryAgentSearchOptions = sentryAgentGate.searchOptions;
