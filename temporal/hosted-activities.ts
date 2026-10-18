import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  EvidenceAgentFindingsSchema,
  EvidenceToolSelectionSchema,
  EVIDENCE_AGENT_TASK,
  normalizeFailureHistory,
  normalizeSearchVisibility,
  validatedAudit,
  validateCitations,
  type EvidenceAgentDependencies,
  type EvidenceAgentReceipt,
} from "../server/evidence-agent.js";
import { generateGemmaEvidenceTurn } from "../server/providers/gemma-evidence-agent.js";
import type { Audit } from "../shared/types.js";
import type {
  HostedTemporalActivities,
  HostedTemporalInput,
} from "./hosted-contracts.js";
export const hostedHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function createRecord(filename: string, value: unknown) {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
}
/** Stable phase cache. A lost completion can reuse a saved response. A started
 * phase without a response is ambiguous and cannot dispatch again. */
export function createHostedPhaseCache(root: string) {
  return async <T>(
    phase: string,
    binding: unknown,
    operation: () => Promise<T>,
  ): Promise<T> => {
    if (!/^(select|tiger|search|summary)$/.test(phase))
      throw new Error("Invalid hosted phase");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const identity = hostedHash(binding),
      filename = path.join(root, `${phase}.completed.json`);
    try {
      const saved = JSON.parse(await readFile(filename, "utf8"));
      if (
        saved.binding !== identity ||
        saved.sha256 !== hostedHash(saved.value)
      )
        throw new Error("Invalid hosted cache");
      return saved.value as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await createRecord(path.join(root, `${phase}.started.json`), {
        binding: identity,
        at: new Date().toISOString(),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw ApplicationFailure.nonRetryable(
          "An earlier provider dispatch has uncertain completion; no duplicate is authorized.",
          "HostedEvidenceAmbiguousCompletion",
        );
      throw error;
    }
    const value = await operation();
    await createRecord(filename, {
      binding: identity,
      sha256: hostedHash(value),
      value,
    });
    return value;
  };
}
export function createHostedEvidenceActivities(options: {
  input: HostedTemporalInput;
  audit: Audit;
  deps: EvidenceAgentDependencies;
  receipt: EvidenceAgentReceipt;
  journalRoot: string;
  sourceAuditSha256: string;
  runSignal: AbortSignal;
}): HostedTemporalActivities {
  const { audit, deps, receipt } = options;
  const cache = createHostedPhaseCache(options.journalRoot);
  const guard = (input: HostedTemporalInput) => {
    if (
      hostedHash(input) !== hostedHash(options.input) ||
      hostedHash(audit) !== options.sourceAuditSha256
    )
      throw ApplicationFailure.nonRetryable(
        "The reserved source changed.",
        "HostedEvidenceSafetyError",
      );
    options.runSignal.throwIfAborted();
    deps.beforeModel?.();
  };
  const execute = async <T>(
    phase: string,
    input: HostedTemporalInput,
    binding: unknown,
    operation: () => Promise<T>,
  ) => {
    guard(input);
    try {
      return await cache(
        phase,
        { input, binding, source: options.sourceAuditSha256 },
        operation,
      );
    } catch (error) {
      if (error instanceof ApplicationFailure) throw error;
      throw ApplicationFailure.nonRetryable(
        "The reserved live evidence activity failed. No extra provider call is authorized.",
        "HostedEvidenceProviderFailure",
      );
    }
  };
  const turn = async (
    request: Parameters<typeof generateGemmaEvidenceTurn>[0],
  ) => {
    const record: EvidenceAgentReceipt["modelTurns"][number] = {
      phase: request.phase,
    };
    receipt.modelTurns.push(record);
    if (receipt.modelTurns.length > 2) throw new Error("Model call limit");
    const result = deps.generate
      ? await deps.generate(request)
      : await generateGemmaEvidenceTurn(request, {
          env: deps.env,
          now: deps.now,
          maxAttempts: 1,
          signal: AbortSignal.any([
            options.runSignal,
            AbortSignal.timeout(20_000),
          ]),
          beforeRequest: deps.beforeModel,
        });
    if (
      result.attempts.length !== 1 ||
      result.attempts[0].status !== 200 ||
      result.attempts[0].phase !== request.phase
    )
      throw new Error("A single native model response is required");
    record.result = result;
    return result;
  };
  const observation = async (
    name: "failure_history" | "search_visibility",
    id: "tool-1" | "tool-2",
    args:
      | { queryId: "mobile_paraphrase" | "images" | "contact" }
      | Record<string, never>,
    operation: () => Promise<
      Awaited<ReturnType<HostedTemporalActivities["searchEvidenceVisibility"]>>
    >,
  ) => {
    const started = Date.now(),
      value = await operation();
    receipt.toolCalls.push({
      observationId: id,
      name,
      arguments: args,
      status: value.status,
      durationMs: Date.now() - started,
    });
    receipt.observations.push(value);
    return value;
  };
  return {
    async selectEvidenceTools(input) {
      guard(input);
      if (input.controlledRecovery && Context.current().info.attempt === 1)
        throw ApplicationFailure.create({
          message:
            "Controlled transient failure before provider dispatch; zero provider calls on this attempt.",
          type: "HostedEvidenceControlledPreDispatchFailure",
        });
      return execute("select", input, {}, async () => {
        const result = await turn({
          phase: "select_tools",
          task: EVIDENCE_AGENT_TASK,
          audit: validatedAudit(audit),
        });
        const selection = EvidenceToolSelectionSchema.parse(result.output);
        receipt.selection = selection;
        receipt.toolSelectionAbstained = selection.tools.length === 0;
        return { selection, turn: result };
      });
    },
    async retrieveTigerEvidence(input, queryId, id) {
      return execute("tiger", input, { queryId, id }, () =>
        observation("failure_history", id, { queryId }, async () =>
          normalizeFailureHistory(
            await deps.failureHistory(
              queryId,
              AbortSignal.any([options.runSignal, AbortSignal.timeout(10_000)]),
            ),
            audit.projectId,
            queryId,
            id,
          ),
        ),
      );
    },
    async searchEvidenceVisibility(input, id) {
      return execute("search", input, { id }, () =>
        observation("search_visibility", id, {}, async () =>
          normalizeSearchVisibility(
            await deps.searchVisibility(
              AbortSignal.any([
                options.runSignal,
                AbortSignal.timeout(deps.searchTimeoutMs ?? 10_000),
              ]),
            ),
            id,
          ),
        ),
      );
    },
    async summarizeEvidence(input, selection, observations) {
      return execute(
        "summary",
        input,
        { selection, observations },
        async () => {
          const validated = validatedAudit(audit);
          const result = await turn({
            phase: "summarize",
            task: EVIDENCE_AGENT_TASK,
            audit: validated,
            selection,
            observations,
          });
          const findings = EvidenceAgentFindingsSchema.parse(result.output);
          validateCitations(findings, validated, observations);
          receipt.modelOutput = findings;
          return { findings, turn: result };
        },
      );
    },
  };
}
