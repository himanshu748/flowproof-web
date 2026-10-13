import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateMeasurements,
  fixturePages,
  parseApprovedSyntheticCheck,
  summarizeBrowserObservations,
  type DatasetRow,
} from "../scripts/model-browser-evaluate.js";
import { runAudit } from "../server/runner.js";
import type { Check, Project, Audit } from "../shared/types.js";

let output: string;
beforeAll(async () => {
  output = await mkdtemp(path.join(os.tmpdir(), "flowproof-model-browser-"));
});
afterAll(async () => {
  await rm(output, { recursive: true, force: true });
});

function row(kind: Check["kind"], id: string = kind): DatasetRow {
  return {
    id,
    split: "test",
    requirement: `Synthetic control requirement for ${kind}`,
    expected: {
      checks: [
        {
          requirement: `Synthetic control requirement for ${kind}`,
          kind,
          path: "/",
          expected: ["heading", "link", "text_visible"].includes(kind)
            ? "Studio alpha"
            : "Reference assertion",
          viewport: kind === "no_horizontal_overflow" ? "mobile" : "desktop",
        },
      ],
    },
  };
}

describe("model browser evaluation contract", () => {
  it("rejects model approval, selectors, changed requirements and executable text", () => {
    const reference = row("heading");
    const check = reference.expected.checks[0];
    for (const changed of [
      { ...check, approved: true },
      { ...check, selector: "h1" },
      { ...check, requirement: "Changed input" },
      { ...check, path: "/../private" },
    ]) {
      expect(() =>
        parseApprovedSyntheticCheck(
          JSON.stringify({ checks: [changed] }),
          reference.requirement,
          "control",
        ),
      ).toThrow();
    }
    expect(() =>
      parseApprovedSyntheticCheck(
        "```json\n{}\n```",
        reference.requirement,
        "control",
      ),
    ).toThrow();
    expect(
      parseApprovedSyntheticCheck(
        JSON.stringify(reference.expected),
        reference.requirement,
        "control",
      ).approved,
    ).toBe(true);
  });

  it("escapes literal reference content and refuses to invent a manual oracle", () => {
    const reference = row("heading").expected.checks[0];
    reference.expected = '<script>alert("hello")</script>';
    const fixture = fixturePages(reference, "healthy")["/"];
    expect(fixture).toContain("&lt;script&gt;");
    expect(fixture).not.toContain("<script>");
    expect(() =>
      fixturePages(row("manual").expected.checks[0], "healthy"),
    ).toThrow(/no known/);
  });

  it("cannot attach offline fixtures to a real website audit", async () => {
    const reference = row("heading");
    const check = parseApprovedSyntheticCheck(
      JSON.stringify(reference.expected),
      reference.requirement,
      "control",
    );
    const project: Project = {
      id: "isolation",
      name: "Isolation control",
      url: "https://example.com",
      target: "website",
      sampleVariant: "healthy",
      authorized: true,
      brief: reference.requirement,
      checks: [check],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generator: { provider: "fixture control", model: null },
    };
    const audit: Audit = {
      id: "isolation",
      projectId: project.id,
      projectName: project.name,
      status: "running",
      createdAt: project.createdAt,
      checks: structuredClone(project.checks),
      results: [],
    };
    await expect(
      runAudit(project, audit, () => {}, {
        evidenceRoot: output,
        syntheticPages: { "/": "<h1>Unsafe override</h1>" },
      }),
    ).rejects.toThrow(/restricted to synthetic/);
  });

  it("measures real healthy/broken execution while separating malformed, abstained, blocked and false-passing outputs", async () => {
    const kinds: Check["kind"][] = [
      "heading",
      "link",
      "text_visible",
      "image_alt",
      "no_horizontal_overflow",
      "manual",
    ];
    const rows = kinds.map((kind) => row(kind));
    const measurements = rows.map((item) => ({
      id: item.id,
      rawOutput: JSON.stringify(item.expected),
    }));
    const downgrade = row("heading", "downgrade");
    const wrongPath = row("heading", "wrong-path");
    const abstention = row("heading", "abstention");
    const malformed = row("heading", "malformed");
    const unverified = row("heading", "unverified");
    const unsafe = row("manual", "unexpected-automation");
    rows.push(downgrade, wrongPath, abstention, malformed, unverified, unsafe);
    const changed = (item: DatasetRow, fields: Record<string, unknown>) => ({
      id: item.id,
      rawOutput: JSON.stringify({
        checks: [{ ...item.expected.checks[0], ...fields }],
      }),
    });
    measurements.push(
      changed(downgrade, { kind: "text_visible" }),
      changed(wrongPath, { path: "/wrong" }),
      changed(abstention, { kind: "manual" }),
      { id: malformed.id, rawOutput: "{invalid" },
      changed(unverified, { kind: "image_alt" }),
      changed(unsafe, { kind: "text_visible" }),
    );
    const observations = await evaluateMeasurements(rows, measurements, output);
    for (const item of observations.slice(0, 5)) {
      expect(item.healthy?.status, item.healthy?.evidence.observed).toBe(
        "passed",
      );
      expect(item.broken?.status, item.broken?.evidence.observed).toBe(
        "failed",
      );
      const png = await readFile(
        path.join(output, item.healthy!.evidence.screenshot!.slice(1)),
      );
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(item.artifacts?.healthy.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(
      observations.find((item) => item.id === "downgrade")?.broken?.status,
    ).toBe("passed");
    expect(
      observations.find((item) => item.id === "wrong-path")?.classification,
    ).toBe("blocked_pair");
    expect(
      observations.find((item) => item.id === "unverified")?.classification,
    ).toBe("unverified_pair");
    expect(
      observations.find((item) => item.id === "unexpected-automation")?.healthy,
    ).toBeUndefined();
    expect(summarizeBrowserObservations(observations)).toMatchObject({
      measuredOutputs: 12,
      referenceAutomatable: 10,
      referenceManual: 2,
      malformed: 1,
      modelAbstentions: 2,
      appropriateAbstentions: 1,
      inappropriateAbstentions: 1,
      unexpectedAutomation: 1,
      attemptedPairs: 8,
      completedPairs: 6,
      blockedPairs: 1,
      unverifiedPairs: 1,
      pairedCorrect: 5,
      brokenExecuted: 6,
      brokenFalsePasses: 1,
      executableCorrectness: 0.5,
      completedPairCorrectness: 5 / 6,
      falsePassRate: 1 / 6,
      appropriateAbstentionRate: 0.5,
    });
  }, 90_000);
});
