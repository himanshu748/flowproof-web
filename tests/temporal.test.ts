import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { createAuditActivities } from "../temporal/activities.js";
import { temporalConfiguration } from "../temporal/config.js";
import { validateApprovedAudit } from "../temporal/validation.js";
import { SAMPLE_BRIEF, SAMPLE_URL, sampleChecks } from "../server/sample.js";
import type { AuditWorkflowInput } from "../temporal/contracts.js";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});
function input(): AuditWorkflowInput {
  const createdAt = new Date().toISOString();
  const checks = sampleChecks(true);
  return {
    project: {
      id: "test",
      name: "Temporal safety fixture",
      target: "sample",
      url: SAMPLE_URL,
      sampleVariant: "healthy",
      authorized: true,
      brief: SAMPLE_BRIEF,
      checks,
      createdAt,
      updatedAt: createdAt,
      generator: { provider: "unit test", model: null },
    },
    audit: {
      id: "abc-123",
      projectId: "test",
      projectName: "Temporal safety fixture",
      status: "queued",
      createdAt,
      checks: structuredClone(checks),
      results: [],
    },
  };
}
async function activity(attempt = 1, inject = false) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-temporal-unit-"),
  );
  roots.push(root);
  const execute = vi.fn();
  const activities = createAuditActivities({
    evidenceRoot: path.join(root, "evidence"),
    receiptRoot: path.join(root, "receipts"),
    execute,
    transientFailureWorkflowId: inject ? "proof-workflow" : undefined,
    context: () => ({
      info: {
        attempt,
        workflowExecution: { workflowId: "proof-workflow", runId: "proof-run" },
      },
      heartbeat: () => {},
    }),
  });
  return { ...activities, execute };
}

describe("Temporal approval and local-only boundaries", () => {
  it("requires explicit opt-in and refuses cloud addresses and the public demo", () => {
    expect(() => temporalConfiguration({})).toThrow(/disabled/);
    expect(
      temporalConfiguration({ FLOWPROOF_TEMPORAL_ENABLED: "true" }),
    ).toEqual({ address: "127.0.0.1:7233", namespace: "default" });
    for (const address of [
      "cloud.tmprl.io:7233",
      "10.0.0.1:7233",
      "127.0.0.1:0",
      "localhost:65536",
      "https://localhost:7233",
    ])
      expect(() =>
        temporalConfiguration({
          FLOWPROOF_TEMPORAL_ENABLED: "true",
          FLOWPROOF_TEMPORAL_ADDRESS: address,
        }),
      ).toThrow(/loopback/);
    expect(() =>
      temporalConfiguration({
        FLOWPROOF_TEMPORAL_ENABLED: "true",
        FLOWPROOF_PUBLIC: "true",
        FLOWPROOF_DEMO: "true",
      }),
    ).toThrow(/public sample/);
  });
  it("rejects edited or unapproved snapshots before executing the browser", () => {
    const fixture = input();
    expect(validateApprovedAudit(fixture)).toMatch(/^[a-f0-9]{64}$/);
    fixture.audit.checks[0].expected = "Changed after approval";
    expect(() => validateApprovedAudit(fixture)).toThrow(/approved/);
    const unapproved = input();
    unapproved.project.checks[0].approved = false;
    unapproved.audit.checks[0].approved = false;
    expect(() => validateApprovedAudit(unapproved)).toThrow(/approved/);
    const unauthorized = input();
    unauthorized.project.authorized = false;
    expect(() => validateApprovedAudit(unauthorized)).toThrow(/authorized/);
  });
  it("marks approval and schema failures nonretryable without browser work", async () => {
    const runner = await activity();
    const fixture = input();
    fixture.audit.id = "../escape";
    const error = await runner
      .executeApprovedAudit(fixture)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      nonRetryable: true,
      type: "AuditSafetyError",
    });
    expect(runner.execute).not.toHaveBeenCalled();
    const duplicate = input();
    duplicate.audit.checks.push(structuredClone(duplicate.audit.checks[0]));
    duplicate.project.checks = structuredClone(duplicate.audit.checks);
    const schemaFailure = await runner
      .executeApprovedAudit(duplicate)
      .catch((cause: unknown) => cause);
    expect(schemaFailure).toMatchObject({
      nonRetryable: true,
      type: "AuditSafetyError",
    });
    expect(runner.execute).not.toHaveBeenCalled();
  });
  it("injects a retryable failure only on first attempt and before browser execution", async () => {
    const runner = await activity(1, true);
    const error = await runner
      .executeApprovedAudit(input())
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      type: "TransientAuditFailure",
      nonRetryable: false,
    });
    expect(runner.execute).not.toHaveBeenCalled();
    const website = input();
    website.project.target = "website";
    website.project.url = "https://example.com";
    const refused = await runner
      .executeApprovedAudit(website)
      .catch((cause: unknown) => cause);
    expect(refused).toMatchObject({
      nonRetryable: true,
      type: "AuditSafetyError",
    });
    expect(runner.execute).not.toHaveBeenCalled();
  });
  it("reuses a completed receipt and refuses a different approved snapshot", async () => {
    const runner = await activity(2, true);
    const fixture = input();
    fixture.project.checks = [
      fixture.project.checks.find((check) => check.kind === "manual")!,
    ];
    fixture.audit.checks = structuredClone(fixture.project.checks);
    const check = fixture.audit.checks[0];
    runner.execute.mockResolvedValue([
      {
        checkId: check.id,
        requirement: check.requirement,
        kind: check.kind,
        expected: check.expected,
        status: "unverified",
        durationMs: 0,
        evidence: {
          observed: "Manual review required.",
          url: SAMPLE_URL,
          viewport: { width: 1365, height: 900 },
        },
      },
    ]);
    const first = await runner.executeApprovedAudit(fixture);
    const second = await runner.executeApprovedAudit(fixture);
    expect(second).toEqual(first);
    expect(runner.execute).toHaveBeenCalledTimes(1);
    fixture.project.name = "A changed project snapshot";
    const refused = await runner
      .executeApprovedAudit(fixture)
      .catch((cause: unknown) => cause);
    expect(refused).toMatchObject({
      nonRetryable: true,
      type: "AuditSafetyError",
    });
    expect(runner.execute).toHaveBeenCalledTimes(1);
  });
});
