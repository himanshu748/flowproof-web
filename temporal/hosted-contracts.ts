import type {
  EvidenceAgentFindings,
  EvidenceAgentPhaseRequest,
  EvidenceAgentTurn,
  EvidenceToolObservation,
} from "../server/evidence-agent.js";
import type { EvidenceToolSelection } from "../server/providers/gemma-evidence-agent.js";
export interface HostedTemporalInput {
  reservationId: string;
  auditId: string;
  controlledRecovery: boolean;
}
export interface HostedTemporalActivities {
  selectEvidenceTools(
    input: HostedTemporalInput,
  ): Promise<{ selection: EvidenceToolSelection; turn: EvidenceAgentTurn }>;
  retrieveTigerEvidence(
    input: HostedTemporalInput,
    queryId: "mobile_paraphrase" | "images" | "contact",
    observationId: "tool-1" | "tool-2",
  ): Promise<EvidenceToolObservation>;
  searchEvidenceVisibility(
    input: HostedTemporalInput,
    observationId: "tool-1" | "tool-2",
  ): Promise<EvidenceToolObservation>;
  summarizeEvidence(
    input: HostedTemporalInput,
    selection: EvidenceToolSelection,
    observations: EvidenceToolObservation[],
  ): Promise<{ findings: EvidenceAgentFindings; turn: EvidenceAgentTurn }>;
}
export interface HostedTemporalResult {
  selection: Awaited<
    ReturnType<HostedTemporalActivities["selectEvidenceTools"]>
  >;
  observations: EvidenceToolObservation[];
  summary: Awaited<
    ReturnType<HostedTemporalActivities["summarizeEvidence"]>
  > | null;
}
export const HOSTED_TEMPORAL_PROGRESS = "hostedEvidenceProgress";
export const HOSTED_TEMPORAL_CONTINUE = "continueHostedEvidence";
export interface HostedTemporalProgress {
  phase:
    | EvidenceAgentPhaseRequest["phase"]
    | "tiger"
    | "search"
    | "waiting-after-tiger"
    | "completed";
  auditId: string;
}
