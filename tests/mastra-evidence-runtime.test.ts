import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  EVIDENCE_AGENT_TASK,
  EvidenceAuditObservationSchema,
  type EvidenceAgentFindings,
  type EvidenceAgentPhaseRequest,
  type EvidenceAgentTurn,
  type EvidenceToolObservation,
  type EvidenceToolSelection,
} from "../server/providers/gemma-evidence-agent.js";
import { executeMastraEvidenceRuntime } from "../server/mastra-evidence-runtime.js";

// These are retained provider responses, replayed offline through the real SDK.
// A successful test is not a new live Gemma, Tiger, or SerpApi receipt.
interface RetainedFixture {
  auditObservation: z.infer<typeof EvidenceAuditObservationSchema>;
  selection: EvidenceToolSelection;
  observations: EvidenceToolObservation[];
  modelOutput: EvidenceAgentFindings;
  modelTurns: Array<{
    phase: EvidenceAgentPhaseRequest["phase"];
    result: EvidenceAgentTurn;
  }>;
}
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/agent-run.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as RetainedFixture;
type Ports = Parameters<typeof executeMastraEvidenceRuntime>[1];
type ToolId = "tool-1" | "tool-2";

function retainedTurn(
  phase: EvidenceAgentPhaseRequest["phase"],
  output?: unknown,
): EvidenceAgentTurn {
  const source = fixture.modelTurns.find((turn) => turn.phase === phase);
  if (!source) throw new Error("The retained phase is missing.");
  const result = structuredClone(source.result);
  if (output !== undefined) result.output = output;
  return result;
}
function setup(
  options: {
    selection?: unknown;
    summary?: unknown;
    tool?: Ports["tool"];
  } = {},
) {
  const audit = structuredClone(fixture.auditObservation);
  const events: string[] = [];
  const model = vi.fn<Ports["model"]>(async (request) => {
    events.push(request.phase);
    return retainedTurn(
      request.phase,
      request.phase === "select_tools" ? options.selection : options.summary,
    );
  });
  const tool = vi.fn<Ports["tool"]>(async (entry, id) => {
    events.push(`${id}:${entry.name}`);
    if (options.tool) return options.tool(entry, id);
    const observation = fixture.observations.find(
      (item) => item.type === entry.name,
    );
    if (!observation) throw new Error("The retained tool result is missing.");
    return { ...structuredClone(observation), id };
  });
  return {
    audit,
    events,
    model,
    tool,
    run: () =>
      executeMastraEvidenceRuntime(
        { audit, task: EVIDENCE_AGENT_TASK },
        { model, tool },
      ),
  };
}

let outbound: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  outbound = vi.fn<typeof fetch>(async () => {
    throw new Error("Outbound requests are forbidden in the SDK replay.");
  });
  vi.stubGlobal("fetch", outbound);
});
afterEach(() => {
  expect(outbound).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("real Mastra evidence-agent loop with retained offline ports", () => {
  it("lets the SDK execute selected tools between two model turns and retains measured usage", async () => {
    const h = setup();
    const original = structuredClone(h.audit);
    const result = await h.run();

    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.tool).toHaveBeenCalledTimes(2);
    expect(h.events[0]).toBe("select_tools");
    expect(h.events.slice(1, 3)).toEqual([
      "tool-1:failure_history",
      "tool-2:search_visibility",
    ]);
    expect(h.events[3]).toBe("summarize");
    expect(h.tool).toHaveBeenNthCalledWith(
      1,
      fixture.selection.tools[0],
      "tool-1",
    );
    expect(h.tool).toHaveBeenNthCalledWith(
      2,
      fixture.selection.tools[1],
      "tool-2",
    );
    expect(h.model.mock.calls[1][0]).toEqual({
      phase: "summarize",
      task: EVIDENCE_AGENT_TASK,
      audit: fixture.auditObservation,
      selection: fixture.selection,
      observations: fixture.observations,
    });
    expect(result.selection).toEqual(fixture.selection);
    expect(result.observations).toEqual(fixture.observations);
    expect(result.modelOutput).toEqual(fixture.modelOutput);
    expect(result.sdk).toMatchObject({
      provider: "Mastra Agent",
      package: "@mastra/core",
      version: "1.77.0",
      bridge: "native-gemma-json-to-ai-sdk-tool-calls",
      maximumSteps: 2,
      modelRetries: 0,
      modelCalls: 2,
      finalOutputSource: "validated-model-summary",
      totalUsage: { inputTokens: 1770, outputTokens: 791, totalTokens: 2561 },
    });
    expect(result.sdk.steps).toHaveLength(2);
    expect(result.sdk.steps[0]).toMatchObject({
      finishReason: "tool-calls",
      usage: { inputTokens: 518, outputTokens: 38, totalTokens: 556 },
    });
    expect(result.sdk.steps[0].toolCalls).toHaveLength(2);
    expect(result.sdk.steps[0].toolResults).toHaveLength(2);
    const sdkCalls = fixture.selection.tools.map((entry, index) => ({
      toolCallId: `tool-${index + 1}`,
      toolName: entry.name,
      args: entry.arguments,
    }));
    expect(result.sdk.toolCalls).toEqual(sdkCalls);
    expect(result.sdk.steps[0].toolCalls).toEqual(sdkCalls);
    expect(result.sdk.steps[0].toolResults).toEqual(
      fixture.observations.map((observation) => ({
        toolCallId: observation.id,
        toolName: observation.type,
        result: observation,
      })),
    );
    expect(result.sdk.steps[1]).toMatchObject({
      finishReason: "stop",
      usage: { inputTokens: 1252, outputTokens: 753, totalTokens: 2005 },
      toolCalls: [],
      toolResults: [],
    });
    expect(h.audit).toEqual(original);
  });

  it.each([
    ["unknown tool", { tools: [{ name: "execute_script", arguments: {} }] }],
    [
      "duplicate tool",
      { tools: [fixture.selection.tools[0], fixture.selection.tools[0]] },
    ],
    [
      "unknown history query",
      {
        tools: [
          { name: "failure_history", arguments: { queryId: "arbitrary" } },
        ],
      },
    ],
    [
      "unexpected tool argument",
      {
        tools: [
          {
            name: "search_visibility",
            arguments: { url: "https://unapproved.example" },
          },
        ],
      },
    ],
    ["malformed selection", { tools: "failure_history" }],
    ["extra root field", { tools: [], script: "untrusted" }],
  ])("rejects %s before any tool runs", async (_label, selection) => {
    const h = setup({ selection });
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invented audit status",
      {
        ...fixture.modelOutput.findings[0],
        status: "passed",
      },
    ],
    [
      "invented history fact",
      {
        ...fixture.modelOutput.findings[3],
        checkId: "00000000-0000-4000-8000-000000000001",
      },
    ],
    [
      "invented search count",
      { type: "search_snapshot", observationId: "tool-2", resultCount: 1 },
    ],
    [
      "wrong observation type",
      { type: "search_snapshot", observationId: "tool-1", resultCount: 0 },
    ],
  ])("rejects %s after the real tool loop", async (_label, finding) => {
    const h = setup({ summary: { findings: [finding], abstention: "none" } });
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.tool).toHaveBeenCalledTimes(2);
  });

  it("records explicit tool unavailability without fabricating a successful result", async () => {
    const observation: EvidenceToolObservation = {
      id: "tool-1",
      type: "failure_history",
      status: "unavailable",
      failureCode: "tool_unavailable",
    };
    const summary = {
      findings: [
        {
          type: "tool_unavailable",
          observationId: "tool-1",
          tool: "failure_history",
        },
      ],
      abstention: "tools_unavailable",
    };
    const h = setup({
      selection: { tools: [fixture.selection.tools[0]] },
      summary,
      tool: async () => observation,
    });
    const result = await h.run();
    expect(result.observations).toEqual([observation]);
    expect(result.modelOutput).toEqual(summary);
    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.tool).toHaveBeenCalledOnce();
  });

  it("does not retry a failed selection model call", async () => {
    const h = setup();
    h.model.mockRejectedValueOnce(new Error("retained selection port failed"));
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).not.toHaveBeenCalled();
  });

  it("does not retry a failed summary model call or execute tools again", async () => {
    const h = setup();
    h.model
      .mockResolvedValueOnce(retainedTurn("select_tools"))
      .mockRejectedValueOnce(new Error("retained summary port failed"));
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.tool).toHaveBeenCalledTimes(2);
  });

  it("refuses a native receipt containing hidden model retries", async () => {
    const h = setup();
    const response = retainedTurn("select_tools");
    response.attempts.push(structuredClone(response.attempts[0]));
    h.model.mockResolvedValueOnce(response);
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).not.toHaveBeenCalled();
  });

  it("reports unavailable usage as null instead of assigning zero or invented token counts", async () => {
    const h = setup();
    h.model.mockImplementation(async (request) => {
      const response = retainedTurn(request.phase);
      response.attempts[0].usage = null;
      return response;
    });
    const result = await h.run();
    expect(result.sdk.totalUsage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    for (const step of result.sdk.steps) {
      expect(step.usage).toEqual({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      });
    }
    expect(h.model).toHaveBeenCalledTimes(2);
  });

  it("does not treat partially known usage as the total for the whole run", async () => {
    const h = setup();
    h.model.mockImplementation(async (request) => {
      const response = retainedTurn(request.phase);
      if (request.phase === "summarize") response.attempts[0].usage = null;
      return response;
    });
    const result = await h.run();
    expect(result.sdk.steps[0].usage).toEqual({
      inputTokens: 518,
      outputTokens: 38,
      totalTokens: 556,
    });
    expect(result.sdk.totalUsage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  it("stops if the source audit changes while the selection model is running", async () => {
    const h = setup();
    h.model.mockImplementationOnce(async () => {
      h.audit.results[0].status = "passed";
      return retainedTurn("select_tools");
    });
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).not.toHaveBeenCalled();
  });

  it("protects the audit, selection and observations sent to trusted model ports from mutation", async () => {
    const h = setup();
    h.model.mockImplementation(async (request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.audit)).toBe(true);
      expect(Object.isFrozen(request.audit.results[0])).toBe(true);
      if (request.phase === "summarize") {
        expect(Object.isFrozen(request.selection.tools[0].arguments)).toBe(
          true,
        );
        expect(Object.isFrozen(request.observations[0])).toBe(true);
      }
      return retainedTurn(request.phase);
    });
    const original = structuredClone(h.audit);
    await h.run();
    expect(h.audit).toEqual(original);
    expect(h.model).toHaveBeenCalledTimes(2);
  });

  it("stops before summary when a tool port throws and never retries that tool", async () => {
    const h = setup({
      selection: { tools: [fixture.selection.tools[0]] },
      tool: async () => {
        throw new Error("retained tool port failed");
      },
    });
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).toHaveBeenCalledOnce();
  });

  it("labels an empty selection as policy abstention without claiming a summary model turn", async () => {
    const h = setup({ selection: { tools: [] } });
    const result = await h.run();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).not.toHaveBeenCalled();
    expect(result.selection).toEqual({ tools: [] });
    expect(result.observations).toEqual([]);
    expect(result.modelOutput).toEqual({
      findings: [],
      abstention: "no_relevant_observations",
    });
    expect(result.sdk).toMatchObject({
      modelCalls: 1,
      finalOutputSource: "selection-abstention-policy",
      totalUsage: { inputTokens: 518, outputTokens: 38, totalTokens: 556 },
    });
    expect(result.sdk.steps).toHaveLength(1);
    expect(result.sdk.steps[0]).toMatchObject({
      finishReason: "stop",
      toolCalls: [],
      toolResults: [],
    });
  });

  it("keeps model-selected order and binds observations to the corresponding SDK call IDs", async () => {
    const selection = {
      tools: [...structuredClone(fixture.selection.tools)].reverse(),
    };
    const summary = structuredClone(fixture.modelOutput);
    for (const finding of summary.findings) {
      if (finding.observationId === "tool-1") finding.observationId = "tool-2";
      else if (finding.observationId === "tool-2")
        finding.observationId = "tool-1";
    }
    const h = setup({ selection, summary });
    const result = await h.run();
    expect(h.tool).toHaveBeenNthCalledWith(1, selection.tools[0], "tool-1");
    expect(h.tool).toHaveBeenNthCalledWith(2, selection.tools[1], "tool-2");
    expect(result.observations.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: "tool-1", type: "search_visibility" },
      { id: "tool-2", type: "failure_history" },
    ]);
    expect(result.modelOutput).toEqual(summary);
  });

  it.each([
    ["wrong observation ID", { id: "tool-2" }],
    ["audit observation ID", { id: "audit" }],
    ["wrong history query", { queryId: "images" }],
    ["unknown observation field", { secret: "must not reach the model" }],
  ])("rejects %s before summary", async (_label, override) => {
    const h = setup({
      selection: { tools: [fixture.selection.tools[0]] },
      tool: async () =>
        ({
          ...structuredClone(fixture.observations[0]),
          ...override,
        }) as EvidenceToolObservation,
    });
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).toHaveBeenCalledOnce();
  });

  it("rejects an observation for a different selected tool before summary", async () => {
    const h = setup({
      selection: { tools: [fixture.selection.tools[0]] },
      tool: async (_entry, id: ToolId) => ({
        ...structuredClone(fixture.observations[1]),
        id,
      }),
    });
    await expect(h.run()).rejects.toThrow();
    expect(h.model).toHaveBeenCalledOnce();
    expect(h.tool).toHaveBeenCalledOnce();
  });
});
