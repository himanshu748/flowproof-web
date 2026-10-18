import { describe, expect, it, vi } from "vitest";
import type { Check, CheckResult } from "../shared/types.js";
import {
  APPROVAL_STEP_ID,
  createApprovalWorkflow,
  type ApprovalWorkflowOptions,
} from "../server/approval-workflow.js";

// Real Mastra runtime; only the proposer and browser boundary are offline doubles.
const proposal = (): Check[] => [
  {
    id: "heading",
    requirement: "The heading says Welcome",
    kind: "heading",
    path: "/",
    expected: "Welcome",
    viewport: "desktop",
    approved: false,
  },
  {
    id: "mobile",
    requirement: "The page fits a phone",
    kind: "no_horizontal_overflow",
    path: "/",
    expected: "No horizontal scrolling",
    viewport: "mobile",
    approved: false,
  },
  {
    id: "manual",
    requirement: "The page feels welcoming",
    kind: "manual",
    path: "/",
    expected: "A person must review",
    viewport: "desktop",
    approved: false,
  },
];
const observed = (checks: Check[]): CheckResult[] =>
  checks.map((check) => ({
    checkId: check.id,
    requirement: check.requirement,
    kind: check.kind,
    expected: check.expected,
    status: check.kind === "manual" ? "unverified" : "failed",
    durationMs: 1,
    evidence: {
      observed: "Synthetic unit-test observation, not browser proof",
      url: "https://sample.flowproof.test/",
      viewport: { width: 390, height: 844 },
    },
  }));
async function setup(value: unknown = proposal()) {
  const propose = vi.fn<ApprovalWorkflowOptions["propose"]>(async () => value);
  const execute = vi.fn<ApprovalWorkflowOptions["execute"]>(async (checks) =>
    observed(checks),
  );
  const created = await createApprovalWorkflow({ propose, execute });
  const run = await created.workflow.createRun();
  return {
    ...created,
    run,
    propose,
    execute,
    start: () =>
      run.start({ inputData: { brief: "A fixed synthetic website brief." } }),
  };
}
const failedOrRejected = async (operation: Promise<unknown>) => {
  try {
    return await operation;
  } catch {
    return { status: "failed" };
  }
};
const suspendedPlan = (outcome: unknown) => {
  const value = outcome as {
    status: string;
    steps: Record<
      string,
      {
        suspendPayload: {
          planDigest: string;
          checkIds: string[];
          checks: Check[];
        };
      }
    >;
  };
  expect(value.status).toBe("suspended");
  return value.steps[APPROVAL_STEP_ID].suspendPayload;
};

describe("actual Mastra explicit approval workflow", () => {
  it("actually suspends without browser execution, then executes only approved IDs once", async () => {
    const h = await setup();
    const suspended = await h.start();
    const plan = suspendedPlan(suspended);
    expect(h.scope).toBe("process-local");
    expect(suspended.status).toBe("suspended");
    expect(plan).toMatchObject({
      checkIds: ["heading", "mobile", "manual"],
      checks: proposal(),
    });
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.propose).toHaveBeenCalledOnce();
    const result = await h.run.resume({
      step: h.approvalStepId,
      resumeData: {
        planDigest: plan.planDigest,
        approvedCheckIds: ["manual", "heading"],
      },
    });
    expect(result.status).toBe("success");
    if (result.status !== "success")
      throw new Error("Expected actual SDK success");
    expect(result.result).toMatchObject({
      approvedCheckIds: ["heading", "manual"],
      planDigest: plan.planDigest,
      results: [
        { checkId: "heading", status: "failed" },
        { checkId: "manual", status: "unverified" },
      ],
    });
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.execute.mock.calls[0][0]).toEqual(
      proposal()
        .filter((check) => check.id !== "mobile")
        .map((check) => ({ ...check, approved: true })),
    );
    expect(h.execute.mock.calls[0][1]).toMatchObject({
      runId: h.run.runId,
      planDigest: plan.planDigest,
      brief: "A fixed synthetic website brief.",
    });
    expect(h.propose).toHaveBeenCalledOnce();
    expect(plan.checks.every((check) => !check.approved)).toBe(true);
  });

  it.each(["empty", "unknown", "duplicate", "stale", "extra-field"])(
    "rejects %s approval before browser handoff",
    async (variant) => {
      const h = await setup();
      const plan = suspendedPlan(await h.start());
      const resumeData: Record<string, unknown> = {
        planDigest: plan.planDigest,
        approvedCheckIds: ["heading"],
      };
      if (variant === "empty") resumeData.approvedCheckIds = [];
      if (variant === "unknown") resumeData.approvedCheckIds = ["not-proposed"];
      if (variant === "duplicate")
        resumeData.approvedCheckIds = ["heading", "heading"];
      if (variant === "stale") resumeData.planDigest = "f".repeat(64);
      if (variant === "extra-field")
        resumeData.checks = proposal().map((check) => ({
          ...check,
          approved: true,
        }));
      const outcome = await failedOrRejected(
        h.run.resume({ step: h.approvalStepId, resumeData }),
      );
      expect(outcome).toMatchObject({ status: "failed" });
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.propose).toHaveBeenCalledOnce();
    },
  );

  it.each(["approved", "duplicate", "unsafe", "empty"])(
    "refuses a %s proposal without granting approval",
    async (variant) => {
      const checks = proposal();
      if (variant === "approved") checks[0].approved = true;
      if (variant === "duplicate") checks[1].id = checks[0].id;
      if (variant === "unsafe") checks[0].path = "//private.invalid";
      const h = await setup(variant === "empty" ? [] : checks);
      expect(await failedOrRejected(h.start())).toMatchObject({
        status: "failed",
      });
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.propose).toHaveBeenCalledOnce();
    },
  );

  it("binds approval to a single run even when another run has the same proposal and brief", async () => {
    const first = await setup(),
      second = await setup();
    const plan = suspendedPlan(await first.start());
    const other = suspendedPlan(await second.start());
    expect(plan.planDigest).not.toBe(other.planDigest);
    expect(
      await failedOrRejected(
        second.run.resume({
          step: APPROVAL_STEP_ID,
          resumeData: {
            planDigest: plan.planDigest,
            approvedCheckIds: ["heading"],
          },
        }),
      ),
    ).toMatchObject({ status: "failed" });
    expect(second.execute).not.toHaveBeenCalled();
  });

  it("does not trust edited review payload or later mutation of the proposer array", async () => {
    const raw = proposal();
    const h = await setup(raw);
    const outcome = await h.start();
    const plan = suspendedPlan(outcome);
    const digest = plan.planDigest;
    raw[0].expected = "Mutated source after proposal";
    plan.checks[0].expected = "Injected approval payload";
    const result = await failedOrRejected(
      h.run.resume({
        step: APPROVAL_STEP_ID,
        resumeData: { planDigest: digest, approvedCheckIds: ["heading"] },
      }),
    );
    // The engine may detect a changed captured state and refuse it; it may also
    // use the independent immutable plan. Neither path may execute edited text.
    if ((result as { status: string }).status === "success") {
      expect(h.execute).toHaveBeenCalledOnce();
      expect(h.execute.mock.calls[0][0][0]).toMatchObject({
        expected: "Welcome",
        approved: true,
      });
    } else expect(h.execute).not.toHaveBeenCalled();
    expect(h.propose).toHaveBeenCalledOnce();
  });

  it("keeps a sequential second resume from repeating browser execution", async () => {
    const h = await setup();
    const plan = suspendedPlan(await h.start());
    const args = {
      step: APPROVAL_STEP_ID,
      resumeData: {
        planDigest: plan.planDigest,
        approvedCheckIds: ["heading"],
      },
    };
    expect((await h.run.resume(args)).status).toBe("success");
    await failedOrRejected(h.run.resume(args));
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.propose).toHaveBeenCalledOnce();
  });

  it("claims a concurrent resume before awaiting the browser callback", async () => {
    const h = await setup();
    const plan = suspendedPlan(await h.start());
    let release!: () => void;
    let entered!: () => void;
    const browserStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const browserWaiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.execute.mockImplementation(async (checks) => {
      entered();
      await browserWaiting;
      return observed(checks);
    });
    const args = {
      step: APPROVAL_STEP_ID,
      resumeData: {
        planDigest: plan.planDigest,
        approvedCheckIds: ["heading"],
      },
    };
    const first = failedOrRejected(h.run.resume(args));
    await browserStarted;
    const second = failedOrRejected(h.run.resume(args));
    release();
    await Promise.all([first, second]);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.propose).toHaveBeenCalledOnce();
  });

  it.each([
    "missing",
    "duplicate",
    "unselected",
    "wrong-kind",
    "wrong-expected",
    "wrong-requirement",
    "manual-pass",
  ])(
    "refuses %s browser evidence without retrying the runner",
    async (variant) => {
      const h = await setup();
      const plan = suspendedPlan(await h.start());
      h.execute.mockImplementation(async (checks) => {
        const results = observed(checks);
        if (variant === "missing") results.pop();
        if (variant === "duplicate") results[1] = results[0];
        if (variant === "unselected") results[0].checkId = "mobile";
        if (variant === "wrong-kind") results[0].kind = "link";
        if (variant === "wrong-expected")
          results[0].expected = "Unapproved expectation";
        if (variant === "wrong-requirement")
          results[0].requirement = "Unapproved requirement";
        if (variant === "manual-pass") results[1].status = "passed";
        return results;
      });
      const args = {
        step: APPROVAL_STEP_ID,
        resumeData: {
          planDigest: plan.planDigest,
          approvedCheckIds: ["heading", "manual"],
        },
      };
      expect(await failedOrRejected(h.run.resume(args))).toMatchObject({
        status: "failed",
      });
      await failedOrRejected(h.run.resume(args));
      expect(h.execute).toHaveBeenCalledOnce();
      expect(h.propose).toHaveBeenCalledOnce();
    },
  );

  it("never retries an ambiguous browser failure or a proposer failure", async () => {
    const h = await setup();
    const plan = suspendedPlan(await h.start());
    h.execute.mockRejectedValue(new Error("Private failure details"));
    const args = {
      step: APPROVAL_STEP_ID,
      resumeData: {
        planDigest: plan.planDigest,
        approvedCheckIds: ["heading"],
      },
    };
    expect(await failedOrRejected(h.run.resume(args))).toMatchObject({
      status: "failed",
    });
    await failedOrRejected(h.run.resume(args));
    expect(h.execute).toHaveBeenCalledOnce();
    const failed = await setup();
    failed.propose.mockRejectedValue(new Error("Provider private details"));
    expect(await failedOrRejected(failed.start())).toMatchObject({
      status: "failed",
    });
    await failedOrRejected(failed.start());
    expect(failed.propose).toHaveBeenCalledOnce();
    expect(failed.execute).not.toHaveBeenCalled();
  });
});

describe("native Mastra checkpoint round trip for the external browser", () => {
  it("restores two genuine SDK snapshots without repeating model selection and validates actual returned evidence", async () => {
    const propose = vi.fn(async () => proposal());
    const forbidden = vi.fn(async (): Promise<CheckResult[]> => {
      throw new Error("Browser must execute after SDK process exit");
    });
    const first = await createApprovalWorkflow({
      externalBrowser: true,
      propose,
      execute: forbidden,
    });
    const run = await first.workflow.createRun();
    const paused = await run.start({
      inputData: { brief: "A fixed controlled checkpoint brief." },
    });
    const plan = suspendedPlan(paused);
    const beforeApproval = await first.exportSnapshot(run.runId);
    const second = await createApprovalWorkflow({
      externalBrowser: true,
      propose,
      execute: forbidden,
    });
    await second.restoreSnapshot(beforeApproval);
    const restored = await second.workflow.createRun({ runId: run.runId });
    const dispatch = await restored.resume({
      step: APPROVAL_STEP_ID,
      resumeData: {
        planDigest: plan.planDigest,
        approvedCheckIds: ["heading", "manual"],
      },
    });
    expect(dispatch.status).toBe("suspended");
    expect(dispatch.steps["browser-handoff"].status).toBe("suspended");
    const afterApproval = await second.exportSnapshot(run.runId);
    const third = await createApprovalWorkflow({
      externalBrowser: true,
      propose,
      execute: forbidden,
    });
    await third.restoreSnapshot(afterApproval);
    const final = await third.workflow.createRun({ runId: run.runId });
    const result = await final.resume({
      step: "browser-handoff",
      resumeData: {
        planDigest: plan.planDigest,
        results: observed(proposal().filter((c) => c.id !== "mobile")),
      },
    });
    expect(result.status).toBe("success");
    expect(propose).toHaveBeenCalledOnce();
    expect(forbidden).not.toHaveBeenCalled();
  });
  it("refuses a changed native snapshot before restoring the SDK run", async () => {
    const h = await setup();
    await h.start();
    const snapshot = await h.exportSnapshot(h.run.runId);
    const value = snapshot.context["validate-proposal"];
    if (value.status !== "success")
      throw new Error("Expected native validated step output");
    value.output.checks[0].expected = "Altered assertion";
    const receiver = await createApprovalWorkflow({
      externalBrowser: true,
      propose: h.propose,
      execute: h.execute,
    });
    await expect(receiver.restoreSnapshot(snapshot)).rejects.toThrow(
      "immutable approval boundary",
    );
    expect(h.execute).not.toHaveBeenCalled();
  });
});
