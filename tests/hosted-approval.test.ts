import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createHostedApprovalRun,
  type HostedApprovalOptions,
} from "../server/hosted-approval.js";
import type { Check } from "../shared/types.js";
const checks: Check[] = [
  {
    id: "heading",
    kind: "heading",
    requirement: "Synthetic heading",
    expected: "Welcome",
    path: "/",
    viewport: "desktop",
    approved: false,
  },
];
function setup() {
  const propose = vi.fn<HostedApprovalOptions["propose"]>(async () =>
    structuredClone(checks),
  );
  const execute = vi.fn<HostedApprovalOptions["execute"]>(async (selected) =>
    selected.map((check) => ({
      checkId: check.id,
      requirement: check.requirement,
      kind: check.kind,
      expected: check.expected,
      status: "failed",
      durationMs: 1,
      evidence: {
        observed: "Synthetic test callback; not Chromium evidence",
        url: "https://sample.flowproof.test/",
        viewport: { width: 1280, height: 900 },
      },
    })),
  );
  return {
    propose,
    execute,
    create: () =>
      createHostedApprovalRun({
        brief: "Fixed synthetic test brief.",
        propose,
        execute,
      }),
  };
}
describe("bounded isolated real Mastra approval worker", () => {
  beforeAll(async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    await promisify(execFile)(
      process.execPath,
      [
        path.join(root, "node_modules/vite/bin/vite.js"),
        "build",
        "--ssr",
        "server/hosted-approval-child.ts",
        "--outDir",
        "dist-approval-worker",
      ],
      { cwd: root, timeout: 30_000, maxBuffer: 128 * 1024 },
    );
  }, 30_000);
  it("retains an actual suspended SDK run between calls and resumes exactly one approved browser callback", async () => {
    const h = setup(),
      run = h.create();
    try {
      const paused = await run.start();
      expect(paused.status).toBe("suspended");
      expect(
        paused.steps.find((s) => s.id === "await-developer-approval")?.status,
      ).toBe("suspended");
      expect(paused.suspension?.checks).toEqual(checks);
      expect(paused.durable).toBe(false);
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.propose).toHaveBeenCalledOnce();
      const approval = {
        planDigest: paused.suspension!.planDigest,
        approvedCheckIds: ["heading"],
      };
      const completed = await run.resume(approval);
      expect(completed.status).toBe("success");
      expect(completed.runId).toBe(paused.runId);
      expect(
        completed.lifecycle?.map((s) => [s.phase, s.status, s.workerExited]),
      ).toEqual([
        ["approval", "suspended", true],
        ["browser", "suspended", true],
        ["complete", "success", true],
      ]);
      expect(h.execute).toHaveBeenCalledOnce();
      expect(h.execute.mock.calls[0][0][0].approved).toBe(true);
      expect(completed.result?.results[0].status).toBe("failed");
      await expect(run.resume(approval)).rejects.toMatchObject({
        code: "approval_disposed",
      });
      console.log(
        JSON.stringify({
          scope: "local-real-SDK-with-synthetic-ports",
          suspendedRssMiB: paused.maxRssMiB,
          resumedRssMiB: completed.maxRssMiB,
        }),
      );
    } finally {
      await run.dispose();
    }
  }, 15000);
  it("rejects stale approval without consuming the correct approval or running Chromium", async () => {
    const h = setup(),
      run = h.create();
    try {
      const paused = await run.start();
      await expect(
        run.resume({
          planDigest: "f".repeat(64),
          approvedCheckIds: ["heading"],
        }),
      ).rejects.toMatchObject({ code: "approval_plan_changed" });
      await expect(
        run.resume({
          planDigest: paused.suspension!.planDigest,
          approvedCheckIds: ["unknown"],
        }),
      ).rejects.toMatchObject({ code: "approval_plan_changed" });
      expect(h.execute).not.toHaveBeenCalled();
      expect(
        (
          await run.resume({
            planDigest: paused.suspension!.planDigest,
            approvedCheckIds: ["heading"],
          })
        ).status,
      ).toBe("success");
    } finally {
      await run.dispose();
    }
  }, 15000);
  it("bounds global worker concurrency and releases the slot only after process close", async () => {
    const h = setup(),
      first = h.create();
    expect(() => h.create()).toThrowError(
      "The bounded approval workflow could not complete.",
    );
    await first.dispose();
    const next = h.create();
    await next.dispose();
  });
  it("consumes an ambiguous failed browser callback once, then frees the worker", async () => {
    const h = setup();
    h.execute.mockRejectedValue(
      new Error("private failure must not cross boundary"),
    );
    const run = h.create();
    try {
      const paused = await run.start();
      const approval = {
        planDigest: paused.suspension!.planDigest,
        approvedCheckIds: ["heading"],
      };
      await expect(run.resume(approval)).rejects.toMatchObject({
        code: "approval_port_or_receipt_failed",
      });
      await expect(run.resume(approval)).rejects.toBeDefined();
      expect(h.execute).toHaveBeenCalledOnce();
    } finally {
      await run.dispose();
    }
    const next = h.create();
    await next.dispose();
  }, 15000);
});
