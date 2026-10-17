import type { CheckKind, ResultStatus } from "./types";

/** Public, session-scoped JSON contract. Never include provider credentials. */
export interface JudgeAgentBudget {
  maximumRuns: number;
  usedRuns: number;
  remainingRuns: number;
  visitorUsed: boolean;
}
export type JudgeAgentTool = "failure_history" | "search_visibility";
export interface JudgeAgentHistoryRow {
  auditId: string;
  projectId?: string;
  checkId: string;
  kind: CheckKind;
  status: "failed" | "blocked";
  requirement?: string;
  observed?: string;
  queryId: string;
  retrieval: string;
  cosine: number;
  vectorRank: number;
  lexicalScore: number;
  lexicalRank: number | null;
  rrf: number;
}
export interface JudgeAgentSearchResult {
  provider: string;
  domain: string;
  query: string;
  observedAt: string;
  status: "observed";
  results: Array<{ title: string; url: string; position: number | null }>;
  limitation: string;
}
export type JudgeAgentFinding =
  | {
      type: "audit_result" | "historical_failure";
      observationId: string;
      auditId: string;
      checkId: string;
      status: ResultStatus;
    }
  | { type: "search_snapshot"; observationId: string; resultCount: number }
  | { type: "tool_unavailable"; observationId: string; tool: JudgeAgentTool };
export interface JudgeAgentAttempt {
  index: number;
  status: number | null;
  durationMs: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  retryDelayMs?: number;
}
export interface JudgeAgentResult {
  orchestration?: Record<string, unknown>;
  status:
    | "running"
    | "completed"
    | "completed_with_unavailable_tools"
    | "failed";
  transport: "native_google_gemma" | "injected_offline";
  model: string;
  startedAt: string;
  completedAt?: string;
  sourceAuditId: string;
  sourceAuditUnchanged: boolean;
  auditUnchanged?: boolean;
  selection?: {
    tools: Array<{ name: JudgeAgentTool; arguments: Record<string, unknown> }>;
  };
  toolSelectionAbstained?: boolean;
  modelTurns: Array<{
    phase: "select_tools" | "summarize";
    result?: { attempts: JudgeAgentAttempt[] };
    failedAttempts?: JudgeAgentAttempt[];
  }>;
  toolCalls: Array<{
    name: JudgeAgentTool;
    observationId: string;
    status: "observed" | "unavailable";
    durationMs: number;
  }>;
  observations: Array<
    | {
        id: string;
        type: "failure_history";
        status: "observed";
        queryId: string;
        rows: JudgeAgentHistoryRow[];
      }
    | {
        id: string;
        type: "search_visibility";
        status: "observed";
        domain: string;
        query: string;
        observedAt: string;
        resultCount: number;
      }
    | {
        id: string;
        type: JudgeAgentTool;
        status: "unavailable";
        failureCode: string;
      }
  >;
  modelOutput?: { findings: JudgeAgentFinding[]; abstention: string };
  toolReceipts?: Array<
    | { tool: "failure_history"; result: JudgeAgentHistoryRow[] }
    | { tool: "search_visibility"; result: JudgeAgentSearchResult }
  >;
  providerAttempts?: Array<{
    provider: string;
    operation: string;
    status: number | null;
    durationMs: number;
    outcome: string;
  }>;
  reservation?: {
    consumed: boolean;
    maxModelCalls: number;
    maxSearchCalls: number;
    durable?: string;
  };
  indexing?: {
    indexed: number;
    matched: number;
    skipped: number;
    model: string;
  };
  budget?: JudgeAgentBudget;
  failureCode?: string;
  scope?: string;
}
export interface JudgeAgentStatus {
  available: boolean;
  reason?: string;
  budget?: JudgeAgentBudget;
  result?: JudgeAgentResult | JudgeAgentFailure;
  expiresAt?: string;
  proofUrl?: string;
  funding?: { confirmedFree: boolean; checkedAt: string };
}
export interface JudgeAgentFailure {
  error: string;
  code?: string;
  receipt?: JudgeAgentResult;
  sourceAuditId?: string;
  reservation?: JudgeAgentResult["reservation"];
  toolReceipts?: JudgeAgentResult["toolReceipts"];
  providerAttempts?: JudgeAgentResult["providerAttempts"];
  allowanceConsumed?: boolean | string;
}
export type JudgeAgentRequest = <T>(
  path: string,
  method?: string,
  data?: unknown,
) => Promise<T>;
