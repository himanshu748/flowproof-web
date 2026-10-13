import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Audit, Project } from "../shared/types.js";
import { runAudit } from "../server/runner.js";
import { SAMPLE_BRIEF, SAMPLE_URL, sampleChecks } from "../server/sample.js";

let evidenceRoot: string;
function fixture(
  variant: "healthy" | "broken",
  approved = true,
): { project: Project; audit: Audit } {
  const checks = sampleChecks(approved);
  const project: Project = {
    id: "test-project",
    name: "Forma Studio",
    url: SAMPLE_URL,
    target: "sample",
    sampleVariant: variant,
    authorized: true,
    brief: SAMPLE_BRIEF,
    checks,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generator: { provider: "test fixture", model: null },
  };
  const audit: Audit = {
    id: `test-${variant}`,
    projectId: project.id,
    projectName: project.name,
    status: "running",
    createdAt: new Date().toISOString(),
    checks: structuredClone(checks),
    results: [],
  };
  return { project, audit };
}
beforeAll(async () => {
  evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "flowproof-evidence-"));
});
afterAll(async () => {
  await rm(evidenceRoot, { recursive: true, force: true });
});

describe("real Chromium acceptance execution", () => {
  it("rejects unapproved execution before opening a browser", async () => {
    const { project, audit } = fixture("healthy", false);
    await expect(
      runAudit(project, audit, () => {}, { evidenceRoot }),
    ).rejects.toThrow(/approved/);
  });
  it("rejects an audit snapshot edited after approval", async () => {
    const { project, audit } = fixture("healthy");
    audit.checks[0].expected = "A different heading";
    await expect(
      runAudit(project, audit, () => {}, { evidenceRoot }),
    ).rejects.toThrow(/approved/);
  });
  it("prevents evidence path traversal", async () => {
    const { project, audit } = fixture("healthy");
    audit.id = "../outside";
    await expect(
      runAudit(project, audit, () => {}, { evidenceRoot }),
    ).rejects.toThrow(/identifier/);
  });
  it("executes a healthy page with real screenshots and an honest manual result", async () => {
    const { project, audit } = fixture("healthy");
    project.checks[5].approved = false;
    audit.checks[5].approved = false;
    const streamed: string[] = [];
    const results = await runAudit(
      project,
      audit,
      (result) => {
        streamed.push(result.checkId);
      },
      { evidenceRoot },
    );
    expect(results.map((result) => result.status)).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
      "unverified",
    ]);
    expect(streamed).toEqual(project.checks.map((check) => check.id));
    const screenshot = await readFile(
      path.join(evidenceRoot, audit.id, "01-sample-heading.png"),
    );
    expect(screenshot.subarray(1, 4).toString()).toBe("PNG");
    expect(results[0].evidence.dom).toContain(
      "Design that moves business forward.",
    );
    expect(results[4].evidence.viewport.width).toBe(390);
    expect(results[5].evidence.screenshot).toBeUndefined();
  }, 60_000);
  it("cannot turn non-heading or non-link text into a semantic assertion pass", async () => {
    const { project, audit } = fixture("healthy");
    project.checks = [
      {
        ...project.checks[0],
        selector: ".eyebrow",
        expected: "Independent by design.",
      },
      {
        ...project.checks[2],
        selector: ".eyebrow",
        expected: "Independent by design.",
      },
      { ...project.checks[3], selector: ".diagram" },
    ];
    audit.id = "test-semantics";
    audit.checks = structuredClone(project.checks);
    const results = await runAudit(project, audit, () => {}, { evidenceRoot });
    expect(results.map((result) => result.status)).toEqual([
      "failed",
      "failed",
      "unverified",
    ]);
  }, 60_000);
  it("reliably fails the broken headline, destination, alt text and mobile layout", async () => {
    const { project, audit } = fixture("broken");
    const results = await runAudit(project, audit, () => {}, { evidenceRoot });
    expect(results.map((result) => result.status)).toEqual([
      "failed",
      "passed",
      "failed",
      "failed",
      "failed",
      "unverified",
    ]);
    expect(results[0].evidence.dom).toContain("Something beautiful");
    expect(results[3].evidence.dom).toContain("alt attribute missing");
    expect(results[4].evidence.observed).toContain("viewport width is 390px");
  }, 60_000);
  it("matches the real accessible link name without an aria-hidden arrow", async () => {
    const { project, audit } = fixture("healthy");
    project.checks = [{ ...project.checks[2], expected: "Start a project" }];
    audit.id = "test-accessible-link";
    audit.checks = structuredClone(project.checks);
    const results = await runAudit(project, audit, () => {}, { evidenceRoot });
    expect(results[0].status).toBe("passed");
    expect(results[0].evidence.dom).toContain("/contact");
  }, 60_000);
});
