export type CheckKind =
  | "text_visible"
  | "heading"
  | "link"
  | "image_alt"
  | "no_horizontal_overflow"
  | "manual";
export type ResultStatus = "passed" | "failed" | "blocked" | "unverified";
export interface Check {
  id: string;
  requirement: string;
  kind: CheckKind;
  path: string;
  expected: string;
  selector?: string;
  viewport: "desktop" | "mobile";
  approved: boolean;
}
export interface Project {
  id: string;
  name: string;
  url: string;
  target: "sample" | "website";
  sampleVariant: "healthy" | "broken";
  authorized: boolean;
  brief: string;
  checks: Check[];
  createdAt: string;
  updatedAt: string;
  generator: {
    provider: string;
    model: string | null;
    reason?: string;
    orchestration?: {
      provider: "Mastra";
      workflowId: string;
      runId: string;
      steps: string[];
      maxRssMiB: number;
    };
  };
}
export interface Evidence {
  screenshot?: string;
  dom?: string;
  observed: string;
  url: string;
  viewport: { width: number; height: number };
}
export interface CheckResult {
  checkId: string;
  requirement: string;
  kind: CheckKind;
  status: ResultStatus;
  expected: string;
  evidence: Evidence;
  durationMs: number;
}
export interface Audit {
  id: string;
  projectId: string;
  projectName: string;
  status: "queued" | "running" | "completed" | "error";
  createdAt: string;
  completedAt?: string;
  results: CheckResult[];
  checks: Check[];
  /** Source context captured when this audit starts, absent on older records. */
  source?: Pick<
    Project,
    "brief" | "generator" | "target" | "url" | "sampleVariant"
  >;
  error?: string;
  summary?: string;
  workflow?: { provider: "Temporal"; workflowId: string; runId: string };
}
export interface IntegrationStatus {
  name: string;
  status: "active" | "available" | "not_configured" | "not_evaluated";
  detail: string;
}
export interface Evaluation {
  configurations: {
    name: string;
    status: string;
    structuredOutputRate: number | null;
    interpretationAccuracy: number | null;
    executableCorrectness: number | null;
    falsePassRate: number | null;
    abstentionRate: number | null;
    latencyMs: number | null;
    tokens: number | null;
    browserCounts?: {
      malformed: number;
      blockedPairs: number;
      unverifiedPairs: number;
      inappropriateAbstentions: number;
      brokenExecuted: number;
      brokenFalsePasses: number;
    };
  }[];
  dataset: {
    candidates: number;
    validated: number;
    agentReviewed?: number;
    pilotExamples?: number;
    benchmarkMode?: "human-reviewed" | "agent-reviewed-pilot" | null;
    splitPolicy: string;
  };
  notes: string[];
}
export interface Bootstrap {
  demo?: {
    enabled: boolean;
    expiresMinutes: number;
    notice: string;
    gemma?: {
      available: boolean;
      model: string;
      sampleBrief: string;
      description: string;
    };
  };
  projects: Project[];
  audits: Audit[];
  integrations: IntegrationStatus[];
  evaluation: Evaluation;
  storage: string;
}
