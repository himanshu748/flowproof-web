import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Audit, CheckResult, Project } from "../shared/types.js";
import { sampleChecks, SAMPLE_BRIEF, SAMPLE_URL } from "../server/sample.js";

vi.mock("../server/runner.js", () => ({ runAudit: vi.fn() }));
vi.mock("../server/generator.js", async (original) => ({
  ...(await original<typeof import("../server/generator.js")>()),
  generateChecks: vi.fn(),
}));
vi.mock("../server/gemma.js", () => ({ summarizeAudit: vi.fn() }));
import { generateChecks } from "../server/generator.js";
import { runAudit } from "../server/runner.js";
import { summarizeAudit } from "../server/gemma.js";
import { redact } from "../server/safety.js";
import {
  generateChecksWithOrchestration,
  runAuditWithOrchestration,
} from "../server/orchestration.js";

function fixture(approved = true) {
  const now = new Date().toISOString();
  const project: Project = {
    id: "synthetic",
    name: "Synthetic",
    url: SAMPLE_URL,
    target: "sample",
    sampleVariant: "healthy",
    authorized: true,
    brief: SAMPLE_BRIEF,
    checks: sampleChecks(approved),
    createdAt: now,
    updatedAt: now,
    generator: { provider: "Test fixture", model: null },
  };
  const audit: Audit = {
    id: "abcdef12",
    projectId: project.id,
    projectName: project.name,
    status: "running",
    createdAt: now,
    checks: structuredClone(project.checks),
    results: [],
  };
  return { project, audit };
}
function observed(audit: Audit): CheckResult[] {
  return audit.checks.map((check) => ({
    checkId: check.id,
    requirement: check.requirement,
    expected: check.expected,
    kind: check.kind,
    status: check.kind === "manual" ? "unverified" : "passed",
    durationMs: 1,
    evidence: {
      observed: "Synthetic unit test observation",
      url: SAMPLE_URL,
      viewport: { width: 390, height: 844 },
    },
  }));
}
beforeEach(() => vi.clearAllMocks());

describe("Mastra workflow coordination", () => {
  it("runs the real SDK proposal tool and strips model approval", async () => {
    vi.mocked(generateChecks).mockResolvedValue({
      checks: sampleChecks(true),
      generator: { provider: "Mock model for unit test", model: "test" },
    });
    const result = await generateChecksWithOrchestration(SAMPLE_BRIEF, {
      allowModel: true,
    });
    expect(result.checks.every((check) => !check.approved)).toBe(true);
    expect(result.generator.provider).toBe("Mock model for unit test");
    expect(result.orchestration.provider).toBe("Mastra");
    expect(
      result.orchestration.steps
        .filter((event) => event.status === "completed")
        .map((event) => event.step),
    ).toEqual(["briefstamp.proposal.generate", "briefstamp.proposal.validate"]);
    expect(runAudit).not.toHaveBeenCalled();
  });

  it("rejects unapproved and changed snapshots before any browser tool invocation", async () => {
    const { project, audit } = fixture(false);
    await expect(
      runAuditWithOrchestration(project, audit, () => {}),
    ).rejects.toThrow("approved plan");
    const approved = fixture();
    approved.audit.checks[0].expected = "Changed after approval";
    await expect(
      runAuditWithOrchestration(approved.project, approved.audit, () => {}),
    ).rejects.toThrow("approved plan");
    expect(runAudit).not.toHaveBeenCalled();
  });

  it("executes ordered steps and keeps unverified findings out of passing counts", async () => {
    const { project, audit } = fixture();
    vi.mocked(runAudit).mockResolvedValue(observed(audit));
    const result = await runAuditWithOrchestration(project, audit, () => {});
    expect(result.summary).toContain(
      "5 passed, 0 failed, 0 blocked, 1 unverified",
    );
    expect(
      result.orchestration.steps
        .filter((event) => event.status === "completed")
        .map((event) => event.step),
    ).toEqual([
      "briefstamp.audit.approval",
      "briefstamp.audit.browser",
      "briefstamp.audit.summary",
    ]);
    expect(summarizeAudit).not.toHaveBeenCalled();
    expect(audit.results).toEqual([]);
  });

  it("rejects incomplete result sets without a successful summary", async () => {
    const { project, audit } = fixture();
    vi.mocked(runAudit).mockResolvedValue(observed(audit).slice(0, 1));
    await expect(
      runAuditWithOrchestration(project, audit, () => {}),
    ).rejects.toThrow("did not complete");
  });

  it("matches safely redacted expected values and rejects changed observations", async () => {
    const { project, audit } = fixture();
    project.checks[0].expected = "Contact client@example.com";
    audit.checks = structuredClone(project.checks);
    const results = observed(audit);
    results[0].expected = redact(project.checks[0].expected);
    expect(results[0].expected).not.toContain("client@example.com");
    vi.mocked(runAudit).mockResolvedValue(results);
    await expect(
      runAuditWithOrchestration(project, audit, () => {}),
    ).resolves.toHaveProperty("orchestration.provider", "Mastra");
    results[0].expected = "Unrelated expectation";
    await expect(
      runAuditWithOrchestration(project, audit, () => {}),
    ).rejects.toThrow("did not complete");
  });

  it("isolates optional model commentary from the original result array", async () => {
    const { project, audit } = fixture();
    vi.mocked(runAudit).mockResolvedValue(observed(audit));
    vi.mocked(summarizeAudit).mockImplementation(async (copy) => {
      copy.results[5].status = "passed";
      return "Test-only commentary";
    });
    const result = await runAuditWithOrchestration(project, audit, () => {}, {
      allowModelSummary: true,
    });
    expect(result.results[5].status).toBe("unverified");
    expect(result.summary).toBe("Test-only commentary");
  });
});
