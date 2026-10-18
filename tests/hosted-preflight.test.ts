import { describe, expect, it } from "vitest";
import {
  freshFunding,
  readOnlyClockFailure,
  storageFailureBeforeAgent,
} from "../scripts/hosted-preflight.js";

describe("hosted read-only funding preflight", () => {
  it("allows measured millisecond clock skew but rejects stale or distant-future funding", () => {
    const now = Date.parse("2026-10-18T14:50:32.326Z");
    expect(freshFunding("2026-10-18T14:50:32.378Z", now)).toBe(true);
    expect(freshFunding("2026-10-18T14:50:38Z", now)).toBe(false);
    expect(freshFunding("2026-10-18T14:45:32Z", now)).toBe(false);
    expect(freshFunding("invalid", now)).toBe(false);
  });
  it("never restarts a proposal or an already dispatched agent after source persistence failure", () => {
    const source = {
      status: "failed",
      mode: "temporal",
      error: "Tiger did not confirm saved source evidence",
      proposedModelRequests: 1,
      judgeRequests: 0,
      calls: [
        "/health",
        "/api/bootstrap",
        "/api/projects/x/generate-gemma",
        "/api/audits/x/persistence",
      ].map((route) => ({ route, status: 200, outcome: "response" })),
    };
    expect(storageFailureBeforeAgent(source)).toBe(true);
    expect(storageFailureBeforeAgent(source, "mastra")).toBe(false);
    expect(
      storageFailureBeforeAgent({ ...source, mode: "mastra" }, "mastra"),
    ).toBe(true);
    expect(
      storageFailureBeforeAgent(
        { ...source, mode: "mastra", judgeRequests: 1 },
        "mastra",
      ),
    ).toBe(false);
    for (const changes of [
      { judgeRequests: 1 },
      { proposedModelRequests: 2 },
      {
        calls: [
          ...source.calls,
          {
            route: "/api/audits/x/judge-review",
            status: 200,
            outcome: "response",
          },
        ],
      },
      { calls: source.calls.map((call) => ({ ...call, status: null })) },
      { calls: source.calls.map((call) => ({ ...call, outcome: "pending" })) },
    ])
      expect(storageFailureBeforeAgent({ ...source, ...changes })).toBe(false);
  });
  it("never continues a dispatched, uncertain or changed operation", () => {
    const original = {
      status: "failed",
      mode: "temporal",
      error: "Funding check is not fresh",
      proposedModelRequests: 0,
      judgeRequests: 0,
      calls: ["/health", "/api/bootstrap", "/api/judge-agent/status"].map(
        (route) => ({
          route,
          method: "GET",
          status: 200,
          outcome: "response",
          writeOutcome: "read_only",
        }),
      ),
    };
    expect(readOnlyClockFailure(original, "temporal")).toBe(true);
    for (const change of [
      { proposedModelRequests: 1 },
      { judgeRequests: 1 },
      { error: "Other failure" },
      { mode: "mastra" },
      { calls: [...original.calls, { method: "POST" }] },
      { calls: original.calls.map((c) => ({ ...c, status: null })) },
      { calls: original.calls.map((c) => ({ ...c, method: "PUT" })) },
    ])
      expect(readOnlyClockFailure({ ...original, ...change }, "temporal")).toBe(
        false,
      );
  });
});
