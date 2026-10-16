import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Audit } from "../shared/types.js";
import {
  EVIDENCE_AGENT_TASK,
  type EvidenceAgentPhaseRequest,
  type EvidenceAgentTurn,
  type FailureHistoryRow,
  type SearchVisibilityResult,
} from "../server/evidence-agent.js";
import {
  createEvidenceAgentActivities,
  TemporalEvidenceHttpError,
  type EvidenceAgentActivityOptions,
  type TemporalAgentActivityContext,
  type TemporalAgentFault,
} from "../temporal/agent-activities.js";
import { createEvidenceActivityLedger } from "../temporal/agent-ledger.js";
import type { TemporalAgentInput } from "../temporal/agent-contracts.js";

const fixtureRoot = path.resolve(
  "docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2",
);
const rawReceipt = await readFile(
  path.join(fixtureRoot, "agent-run.json"),
  "utf8",
);
const receipt = JSON.parse(rawReceipt) as {
  modelTurns: {
    phase: EvidenceAgentPhaseRequest["phase"];
    result: EvidenceAgentTurn;
  }[];
  modelOutput: unknown;
  toolReceipts: { tool: string; result: unknown }[];
};
const sourceAudit = JSON.parse(
  await readFile(path.join(fixtureRoot, "source-audit.json"), "utf8"),
) as Audit;
const directories: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const provenance = {
  kind: "retained-native-receipt-fixture" as const,
  receiptSha256: sha(rawReceipt),
  source:
    "docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/agent-run.json",
};
async function fixture(fault?: TemporalAgentFault) {
  const journalRoot = await mkdtemp(
    path.join(tmpdir(), "briefstamp-temporal-unit-"),
  );
  directories.push(journalRoot);
  const ctx: TemporalAgentActivityContext = {
    workflowId: "fixture-workflow",
    runId: randomUUID(),
    activityId: "reserve",
    attempt: 1,
  };
  const input: TemporalAgentInput = {
    audit: structuredClone(sourceAudit),
    task: EVIDENCE_AGENT_TASK,
  };
  const generate = vi.fn(async (request: EvidenceAgentPhaseRequest) =>
    structuredClone(
      receipt.modelTurns.find((turn) => turn.phase === request.phase)!.result,
    ),
  );
  const failureHistory = vi.fn(
    async () =>
      structuredClone(
        receipt.toolReceipts.find((value) => value.tool === "failure_history")!
          .result,
      ) as FailureHistoryRow[],
  );
  const searchVisibility = vi.fn(
    async () =>
      structuredClone(
        receipt.toolReceipts.find(
          (value) => value.tool === "search_visibility",
        )!.result,
      ) as SearchVisibilityResult,
  );
  const options: EvidenceAgentActivityOptions = {
    journalRoot,
    provenance,
    generate,
    failureHistory,
    searchVisibility,
    context: () => ctx,
    faults: fault ? { [ctx.workflowId]: fault } : {},
    now: () => Date.parse("2026-10-16T16:00:00Z"),
  };
  let activities = createEvidenceAgentActivities(options);
  const restart = () => {
    activities = createEvidenceAgentActivities(options);
    return activities;
  };
  const at = (activityId: string, attempt = 1) => {
    Object.assign(ctx, { activityId, attempt });
    return activities;
  };
  const ledger = createEvidenceActivityLedger({ root: journalRoot });
  const filename = (name: string) =>
    path.join(journalRoot, sha(ctx.runId), name);
  const prepare = async () => {
    await at("reserve").reserveEvidenceAllowance(input);
    const selected = await at("select").selectEvidenceTools(input);
    const tiger = await at("tiger").retrieveTigerEvidence({
      input,
      queryId: "mobile_paraphrase",
      observationId: "tool-1",
    });
    const search = await at("search").searchEvidenceVisibility({
      input,
      observationId: "tool-2",
    });
    return {
      input,
      selection: selected.selection,
      observations: [tiger, search],
    };
  };
  return {
    ctx,
    input,
    options,
    at,
    restart,
    ledger,
    filename,
    prepare,
    generate,
    failureHistory,
    searchVisibility,
  };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("dedicated Temporal evidence activities with retained native receipts", () => {
  it("durably caches all four phases before returning and reuses them after worker reconstruction", async () => {
    const f = await fixture();
    const original = JSON.stringify(f.input.audit);
    const summaryInput = await f.prepare();
    const result = await f.at("summary").summarizeEvidence(summaryInput);
    expect(result).toMatchObject({
      findings: receipt.modelOutput,
      sourceAuditUnchanged: true,
      provenance,
    });
    expect(JSON.stringify(f.input.audit)).toBe(original);
    expect(
      JSON.parse(await readFile(f.filename("summary.completed.json"), "utf8"))
        .response,
    ).toEqual(result);
    f.restart();
    expect(
      await f.at("reserve", 2).reserveEvidenceAllowance(f.input),
    ).toMatchObject({
      logicalAllowanceReserved: true,
      maximumModelAttempts: 6,
      maximumSearchAttempts: 3,
      scope: "dedicated-temporal-fixture",
    });
    const replay = await f.prepare();
    expect(await f.at("summary", 2).summarizeEvidence(replay)).toEqual(result);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.failureHistory).toHaveBeenCalledTimes(1);
    expect(f.searchVisibility).toHaveBeenCalledTimes(1);
    expect(await f.ledger.inspect(f.ctx.runId)).toMatchObject({
      counters: { select: 1, tiger: 1, search: 1, summary: 1 },
      modelAttempts: 2,
      searchAttempts: 1,
      tigerAttempts: 1,
    });
  });

  it("recovers known pre-dispatch failures across restart without replaying completed Tiger", async () => {
    const f = await fixture("transient-recovery");
    await f.at("reserve").reserveEvidenceAllowance(f.input);
    await expect(
      f.at("select").selectEvidenceTools(f.input),
    ).rejects.toMatchObject({
      type: "EvidenceTransientProviderError",
      nonRetryable: false,
    });
    expect(f.generate).not.toHaveBeenCalled();
    f.restart();
    const selected = await f.at("select", 2).selectEvidenceTools(f.input);
    const tigerInput = {
      input: f.input,
      queryId: "mobile_paraphrase" as const,
      observationId: "tool-1" as const,
    };
    const tiger = await f.at("tiger").retrieveTigerEvidence(tigerInput);
    f.restart();
    expect(await f.at("tiger", 2).retrieveTigerEvidence(tigerInput)).toEqual(
      tiger,
    );
    await expect(
      f
        .at("search")
        .searchEvidenceVisibility({ input: f.input, observationId: "tool-2" }),
    ).rejects.toMatchObject({
      type: "EvidencePreDispatchTimeout",
      nonRetryable: false,
    });
    expect(f.searchVisibility).not.toHaveBeenCalled();
    const search = await f
      .at("search", 2)
      .searchEvidenceVisibility({ input: f.input, observationId: "tool-2" });
    await f
      .at("summary")
      .summarizeEvidence({
        input: f.input,
        selection: selected.selection,
        observations: [tiger, search],
      });
    expect(await f.ledger.inspect(f.ctx.runId)).toMatchObject({
      counters: { select: 2, tiger: 1, search: 2, summary: 1 },
      modelAttempts: 3,
      searchAttempts: 2,
    });
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.failureHistory).toHaveBeenCalledTimes(1);
    expect(f.searchVisibility).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 408, 429, 499])(
    "never retries known HTTP %i",
    async (status) => {
      const f = await fixture();
      f.generate.mockRejectedValue(new TemporalEvidenceHttpError(status));
      await f.at("reserve").reserveEvidenceAllowance(f.input);
      await expect(
        f.at("select").selectEvidenceTools(f.input),
      ).rejects.toMatchObject({
        type: "EvidencePermanentProviderError",
        nonRetryable: true,
      });
      await expect(
        f.at("select", 2).selectEvidenceTools(f.input),
      ).rejects.toMatchObject({
        type: "EvidenceLedgerError",
        nonRetryable: true,
      });
      expect(f.generate).toHaveBeenCalledTimes(1);
    },
  );

  it("stops injected permanent errors before dispatch and exhausted 500 errors at three attempts", async () => {
    const permanent = await fixture("permanent-400");
    await permanent.at("reserve").reserveEvidenceAllowance(permanent.input);
    await expect(
      permanent.at("select").selectEvidenceTools(permanent.input),
    ).rejects.toMatchObject({
      nonRetryable: true,
      type: "EvidencePermanentProviderError",
    });
    expect(permanent.generate).not.toHaveBeenCalled();
    const f = await fixture("exhausted-500");
    await f.at("reserve").reserveEvidenceAllowance(f.input);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect(
        f.at("select", attempt).selectEvidenceTools(f.input),
      ).rejects.toMatchObject({ nonRetryable: attempt === 3 });
    }
    await expect(
      f.at("select", 3).selectEvidenceTools(f.input),
    ).rejects.toMatchObject({
      nonRetryable: true,
      type: "EvidenceLedgerError",
    });
    expect(f.generate).not.toHaveBeenCalled();
    expect(await f.ledger.inspect(f.ctx.runId)).toMatchObject({
      counters: { select: 3 },
      modelAttempts: 3,
    });
  });

  it("retries a confirmed callback HTTP 503 but not an ambiguous transport error", async () => {
    const f = await fixture();
    f.generate.mockRejectedValueOnce(new TemporalEvidenceHttpError(503));
    await f.at("reserve").reserveEvidenceAllowance(f.input);
    await expect(
      f.at("select").selectEvidenceTools(f.input),
    ).rejects.toMatchObject({ nonRetryable: false });
    await f.at("select", 2).selectEvidenceTools(f.input);
    expect(f.generate).toHaveBeenCalledTimes(2);
    const ambiguous = await fixture();
    ambiguous.generate.mockRejectedValue(
      new Error("Potentially dispatched, completion unknown"),
    );
    await ambiguous.at("reserve").reserveEvidenceAllowance(ambiguous.input);
    await expect(
      ambiguous.at("select").selectEvidenceTools(ambiguous.input),
    ).rejects.toMatchObject({ nonRetryable: true });
    await expect(
      ambiguous.at("select", 2).selectEvidenceTools(ambiguous.input),
    ).rejects.toMatchObject({ nonRetryable: true });
    expect(ambiguous.generate).toHaveBeenCalledTimes(1);
  });

  it("rejects invented summary citations without changing the retained response or browser audit", async () => {
    const f = await fixture("summary-invalid-citation");
    const before = JSON.stringify(f.input.audit);
    const value = await f.prepare();
    await expect(
      f.at("summary").summarizeEvidence(value),
    ).rejects.toMatchObject({
      nonRetryable: true,
      type: "EvidenceValidationError",
    });
    await expect(
      f.at("summary", 2).summarizeEvidence(value),
    ).rejects.toMatchObject({ nonRetryable: true });
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.input.audit)).toBe(before);
    expect(
      await f.ledger.readCompleted(f.ctx.runId, "summary"),
    ).toBeUndefined();
  });

  it("rejects a changed tool observation before dispatching summary generation", async () => {
    const f = await fixture();
    const value = await f.prepare();
    const search = value.observations.find(
      (observation) => observation.type === "search_visibility",
    );
    if (
      !search ||
      search.status !== "observed" ||
      search.type !== "search_visibility"
    )
      throw new Error("Missing fixture search");
    search.resultCount = 1;
    await expect(
      f.at("summary").summarizeEvidence(value),
    ).rejects.toMatchObject({ nonRetryable: true });
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("binds source audit, activity identity and retained receipt provenance across restarts", async () => {
    const f = await fixture();
    await f.at("reserve").reserveEvidenceAllowance(f.input);
    await f.at("select").selectEvidenceTools(f.input);
    await expect(
      f.at("different-select-id", 2).selectEvidenceTools(f.input),
    ).rejects.toMatchObject({ nonRetryable: true });
    const changed = structuredClone(f.input);
    changed.audit.projectName = "Changed browser snapshot";
    await expect(
      f.at("select", 2).selectEvidenceTools(changed),
    ).rejects.toMatchObject({ nonRetryable: true });
    const foreign = createEvidenceAgentActivities({
      ...f.options,
      provenance: { ...provenance, receiptSha256: "a".repeat(64) },
    });
    await expect(foreign.selectEvidenceTools(f.input)).rejects.toMatchObject({
      nonRetryable: true,
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("fails closed for corrupted completed cache or an incomplete dispatched attempt", async () => {
    const corrupt = await fixture();
    await corrupt.at("reserve").reserveEvidenceAllowance(corrupt.input);
    await corrupt.at("select").selectEvidenceTools(corrupt.input);
    const cached = JSON.parse(
      await readFile(corrupt.filename("select.completed.json"), "utf8"),
    );
    cached.response.selection.tools = [];
    await writeFile(
      corrupt.filename("select.completed.json"),
      JSON.stringify(cached),
    );
    corrupt.restart();
    await expect(
      corrupt.at("select", 2).selectEvidenceTools(corrupt.input),
    ).rejects.toMatchObject({
      nonRetryable: true,
      type: "EvidenceLedgerError",
    });
    expect(corrupt.generate).toHaveBeenCalledTimes(1);
    const partial = await fixture();
    partial.generate.mockRejectedValueOnce(new TemporalEvidenceHttpError(500));
    await partial.at("reserve").reserveEvidenceAllowance(partial.input);
    await expect(
      partial.at("select").selectEvidenceTools(partial.input),
    ).rejects.toMatchObject({ nonRetryable: false });
    await unlink(partial.filename("select.attempt-1.json"));
    partial.restart();
    await expect(
      partial.at("select", 2).selectEvidenceTools(partial.input),
    ).rejects.toMatchObject({
      nonRetryable: true,
      type: "EvidenceLedgerError",
    });
    expect(partial.generate).toHaveBeenCalledTimes(1);
  });

  it("does not call any dependency without a reserved allowance or a valid approved fixed sample", async () => {
    const f = await fixture();
    await expect(
      f.at("select").selectEvidenceTools(f.input),
    ).rejects.toMatchObject({ nonRetryable: true });
    f.input.audit.checks[0].approved = false;
    await expect(
      f.at("reserve").reserveEvidenceAllowance(f.input),
    ).rejects.toMatchObject({ nonRetryable: true });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.failureHistory).not.toHaveBeenCalled();
    expect(f.searchVisibility).not.toHaveBeenCalled();
  });

  it("rejects multiple SDK attempts and audit mutation even when the callback returns HTTP 200", async () => {
    const f = await fixture();
    const turn = structuredClone(receipt.modelTurns[0].result);
    turn.attempts.push({ ...turn.attempts[0], index: 2 });
    f.generate.mockResolvedValue(turn);
    await f.at("reserve").reserveEvidenceAllowance(f.input);
    await expect(
      f.at("select").selectEvidenceTools(f.input),
    ).rejects.toMatchObject({ nonRetryable: true });
    const mutated = await fixture();
    mutated.generate.mockImplementation(async () => {
      mutated.input.audit.projectName = "mutated during operation";
      return structuredClone(receipt.modelTurns[0].result);
    });
    await mutated.at("reserve").reserveEvidenceAllowance(mutated.input);
    await expect(
      mutated.at("select").selectEvidenceTools(mutated.input),
    ).rejects.toMatchObject({ nonRetryable: true });
    expect(
      await mutated.ledger.readCompleted(mutated.ctx.runId, "select"),
    ).toBeUndefined();
  });
});
