import type { Audit } from "../shared/types.js";
import type {
  EvidenceAgentFindings,
  EvidenceAgentQueryId,
  EvidenceAgentTurn,
  EvidenceToolObservation,
} from "../server/evidence-agent.js";
import type { EvidenceToolSelection } from "../server/providers/gemma-evidence-agent.js";

export interface TemporalAgentInput {
  audit: Audit;
  task: string;
  pauseAfterTiger?: boolean;
}
export interface TemporalAgentProvenance {
  kind: "retained-native-receipt-fixture";
  receiptSha256: string;
  source: string;
}
export interface TemporalAgentReservation {
  runId: string;
  logicalAllowanceReserved: true;
  maximumModelAttempts: 6;
  maximumSearchAttempts: 3;
  scope: "dedicated-temporal-fixture";
  provenance: TemporalAgentProvenance;
  sourceAuditSha256: string;
}
export interface TemporalAgentSelection {
  selection: EvidenceToolSelection;
  turn: EvidenceAgentTurn;
  provenance: TemporalAgentProvenance;
  sourceAuditSha256: string;
}
export interface TemporalAgentTigerInput {
  input: TemporalAgentInput;
  queryId: EvidenceAgentQueryId;
  observationId: "tool-1" | "tool-2";
}
export interface TemporalAgentSearchInput {
  input: TemporalAgentInput;
  observationId: "tool-1" | "tool-2";
}
export interface TemporalAgentSummaryInput {
  input: TemporalAgentInput;
  selection: EvidenceToolSelection;
  observations: EvidenceToolObservation[];
}
export interface TemporalAgentSummary {
  findings: EvidenceAgentFindings;
  turn: EvidenceAgentTurn;
  sourceAuditUnchanged: true;
  sourceAuditSha256: string;
  provenance: TemporalAgentProvenance;
}
export interface TemporalAgentActivities {
  reserveEvidenceAllowance(
    input: TemporalAgentInput,
  ): Promise<TemporalAgentReservation>;
  selectEvidenceTools(
    input: TemporalAgentInput,
  ): Promise<TemporalAgentSelection>;
  retrieveTigerEvidence(
    input: TemporalAgentTigerInput,
  ): Promise<EvidenceToolObservation>;
  searchEvidenceVisibility(
    input: TemporalAgentSearchInput,
  ): Promise<EvidenceToolObservation>;
  summarizeEvidence(
    input: TemporalAgentSummaryInput,
  ): Promise<TemporalAgentSummary>;
}
export interface TemporalAgentResult {
  reservation: TemporalAgentReservation;
  selection: TemporalAgentSelection;
  observations: EvidenceToolObservation[];
  summary: TemporalAgentSummary;
}
export const TEMPORAL_AGENT_NON_RETRYABLE = [
  "EvidenceSafetyError",
  "EvidenceValidationError",
  "EvidenceLedgerError",
  "EvidencePermanentProviderError",
  "EvidenceAmbiguousCompletion",
] as const;
