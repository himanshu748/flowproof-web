import { describe, expect, it, vi } from "vitest";
import {
  dispatchDurableAudit,
  refreshDurableAudit,
} from "../server/temporal-audit.js";
import { SAMPLE_BRIEF, SAMPLE_URL, sampleChecks } from "../server/sample.js";
import { snapshotSource } from "../shared/compare-audits.js";
import type { Audit, Project } from "../shared/types.js";
import type { AuditActivityResult } from "../temporal/contracts.js";

function fixture() {
  const createdAt = "2026-10-15T00:00:00.000Z";
  const project: Project = {
    id: "project",
    name: "Lifecycle test fixture",
    target: "sample",
    url: SAMPLE_URL,
    sampleVariant: "healthy",
    authorized: true,
    brief: SAMPLE_BRIEF,
    checks: sampleChecks(true),
    createdAt,
    updatedAt: createdAt,
    generator: { provider: "unit test fixture", model: null },
  };
  const audit: Audit = {
    id: "audit-id",
    projectId: project.id,
    projectName: project.name,
    status: "running",
    createdAt,
    source: snapshotSource(project),
    checks: structuredClone(project.checks),
    results: [],
  };
  return { project, audit };
}
function pendingAudit(): Audit {
  return {
    ...fixture().audit,
    status: "queued",
    workflow: {
      provider: "Temporal",
      workflowId: "briefstamp-audit-audit-id",
      runId: "",
    },
  };
}
function completed(audit: Audit): AuditActivityResult {
  return {
    audit: {
      ...structuredClone(audit),
      status: "completed",
      completedAt: "2026-10-15T00:00:10.000Z",
      results: audit.checks.map((check) => ({
        checkId: check.id,
        requirement: check.requirement,
        expected: check.expected,
        kind: check.kind,
        status: check.kind === "manual" ? "unverified" : "passed",
        durationMs: 1,
        evidence: {
          observed: "Injected unit-test result; not browser proof.",
          url: SAMPLE_URL,
          viewport: { width: 1365, height: 900 },
        },
      })),
    },
    planSha256: "fixture-only",
    reportSha256: "fixture-only",
    screenshots: [],
  };
}

describe("durable audit API lifecycle", () => {
  it("saves deterministic pending metadata before the remote start", async () => {
    const { project, audit } = fixture();
    let stored: Audit | undefined;
    const save = vi.fn(async (value: Audit) => {
      stored = structuredClone(value);
    });
    const start = vi.fn(async (_project: Project, input: Audit) => {
      expect(stored).toMatchObject({
        status: "queued",
        workflow: {
          provider: "Temporal",
          workflowId: "briefstamp-audit-audit-id",
          runId: "",
        },
      });
      expect(input).toEqual(stored);
      return { workflowId: "briefstamp-audit-audit-id", runId: "run-1" };
    });
    const read = vi.fn();
    const result = await dispatchDurableAudit(project, audit, {
      save,
      start,
      read,
    });
    expect(result).toMatchObject({
      status: "queued",
      workflow: { runId: "run-1" },
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
    expect(audit.workflow).toBeUndefined();
  });

  it("does not start a workflow if the initial durable metadata save fails", async () => {
    const { project, audit } = fixture();
    const start = vi.fn(),
      read = vi.fn();
    await expect(
      dispatchDurableAudit(project, audit, {
        save: vi.fn().mockRejectedValue(new Error("disk unavailable")),
        start,
        read,
      }),
    ).rejects.toThrow("disk unavailable");
    expect(start).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("can recover an accepted start after every subsequent save fails", async () => {
    const { project, audit } = fixture();
    let persisted: Audit | undefined;
    const save = vi.fn(async (value: Audit) => {
      if (persisted)
        throw new Error(
          "simulated process/storage failure after accepted start",
        );
      persisted = structuredClone(value);
    });
    const start = vi.fn().mockResolvedValue({
      workflowId: "briefstamp-audit-audit-id",
      runId: "accepted-run",
    });
    const read = vi
      .fn()
      .mockResolvedValue({ status: "running", runId: "accepted-run" });
    const uncertain = await dispatchDurableAudit(project, audit, {
      save,
      start,
      read,
    });
    expect(uncertain).toMatchObject({
      status: "queued",
      workflow: { runId: "" },
    });
    expect(uncertain.completedAt).toBeUndefined();
    expect(persisted).toMatchObject({
      status: "queued",
      workflow: { workflowId: "briefstamp-audit-audit-id", runId: "" },
    });
    const recoveredSave = vi.fn(async (value: Audit) => {
      persisted = structuredClone(value);
    });
    const recovered = await refreshDurableAudit(persisted!, {
      save: recoveredSave,
      read,
    });
    expect(recovered).toMatchObject({
      status: "running",
      workflow: { runId: "accepted-run" },
    });
    expect(recovered.error).toBeUndefined();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("reconciles an accepted workflow when its start reply is lost", async () => {
    const { project, audit } = fixture();
    const start = vi
      .fn()
      .mockRejectedValue(
        new Error("lost reply with private-token=do-not-copy"),
      );
    const read = vi
      .fn()
      .mockResolvedValue({ status: "running", runId: "accepted-run" });
    const save = vi.fn().mockResolvedValue(undefined);
    const result = await dispatchDurableAudit(project, audit, {
      save,
      start,
      read,
    });
    expect(result).toMatchObject({
      status: "running",
      workflow: { runId: "accepted-run" },
    });
    expect(read).toHaveBeenCalledWith("briefstamp-audit-audit-id");
    expect(JSON.stringify(result)).not.toContain("do-not-copy");
  });

  it("keeps an ambiguous start pending when reconciliation is also unavailable", async () => {
    const { project, audit } = fixture();
    const result = await dispatchDurableAudit(project, audit, {
      save: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockRejectedValue(new Error("lost reply")),
      read: vi.fn().mockRejectedValue(new Error("server stopped secret")),
    });
    expect(result).toMatchObject({
      status: "queued",
      workflow: { runId: "" },
      results: [],
    });
    expect(result.completedAt).toBeUndefined();
    expect(result.error).toContain("pending");
    expect(result.error).not.toContain("secret");
  });

  it("preserves stored observations and identity during a service outage", async () => {
    const audit = pendingAudit();
    audit.status = "running";
    audit.workflow!.runId = "known-run";
    audit.results = completed(audit).audit.results.slice(0, 1);
    const original = structuredClone(audit);
    const save = vi.fn();
    const result = await refreshDurableAudit(audit, {
      save,
      read: vi.fn().mockRejectedValue(new Error("service stopped")),
    });
    expect(audit).toEqual(original);
    expect(result).toMatchObject({
      status: original.status,
      workflow: original.workflow,
      results: original.results,
    });
    expect(result.completedAt).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("adopts a discovered run only after a complete matching snapshot is verified", async () => {
    const audit = pendingAudit(),
      save = vi.fn().mockResolvedValue(undefined);
    const result = await refreshDurableAudit(audit, {
      save,
      read: vi.fn().mockResolvedValue({
        status: "completed",
        runId: "discovered-run",
        result: completed(audit),
      }),
    });
    expect(result).toMatchObject({
      status: "completed",
      workflow: { runId: "discovered-run" },
    });
    expect(save).toHaveBeenCalledWith(result);
    expect(audit.status).toBe("queued");
  });

  it.each([
    "source",
    "checks",
    "createdAt",
    "projectName",
    "resultIdentity",
    "missingResults",
    "manualPass",
  ] as const)(
    "refuses a completed response with a changed %s",
    async (change) => {
      const audit = pendingAudit(),
        response = completed(audit),
        save = vi.fn();
      if (change === "source")
        response.audit.source!.url = "https://different.example";
      if (change === "checks") response.audit.checks[0].expected = "changed";
      if (change === "createdAt")
        response.audit.createdAt = "2026-10-14T00:00:00.000Z";
      if (change === "projectName")
        response.audit.projectName = "Different project";
      if (change === "resultIdentity")
        response.audit.results[0].checkId = "unknown";
      if (change === "missingResults") response.audit.results.pop();
      if (change === "manualPass")
        response.audit.results.find((row) => row.kind === "manual")!.status =
          "passed";
      const result = await refreshDurableAudit(audit, {
        save,
        read: vi.fn().mockResolvedValue({
          status: "completed",
          runId: "discovered-run",
          result: response,
        }),
      });
      expect(result).toMatchObject({
        status: "queued",
        workflow: { runId: "" },
        results: [],
      });
      expect(result.error).toContain("does not match");
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("never adopts a different run for an already-known workflow", async () => {
    const audit = pendingAudit();
    audit.workflow!.runId = "original-run";
    const save = vi.fn();
    const result = await refreshDurableAudit(audit, {
      save,
      read: vi.fn().mockResolvedValue({
        status: "completed",
        runId: "different-run",
        result: completed(audit),
      }),
    });
    expect(result).toMatchObject({
      status: "queued",
      workflow: { runId: "original-run" },
    });
    expect(save).not.toHaveBeenCalled();
  });
});
