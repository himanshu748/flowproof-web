import { describe, expect, it } from "vitest";
import type { Audit, Check, Project, ResultStatus } from "../shared/types";
import { compareAudits, snapshotSource } from "../shared/compare-audits";
import { redact } from "../shared/redact";

const check: Check = {
  id: "heading",
  requirement: 'The heading must say "Hello".',
  kind: "heading",
  path: "/",
  expected: "Hello",
  viewport: "desktop",
  approved: true,
};
function audit(
  id: string,
  status: ResultStatus,
  overrides: Partial<Audit> = {},
): Audit {
  return {
    id,
    projectId: "project",
    projectName: "Sample",
    status: "completed",
    createdAt:
      id === "before" ? "2026-10-15T01:00:00Z" : "2026-10-15T02:00:00Z",
    checks: [structuredClone(check)],
    source: {
      brief: check.requirement,
      generator: { provider: "fixture", model: null },
      target: "sample",
      url: "https://sample.flowproof.test/",
      sampleVariant: "healthy",
    },
    results: [
      {
        checkId: check.id,
        requirement: check.requirement,
        kind: check.kind,
        expected: check.expected,
        status,
        durationMs: 2,
        evidence: {
          observed: status,
          url: "https://sample.flowproof.test/",
          viewport: { width: 1365, height: 900 },
        },
      },
    ],
    ...overrides,
  };
}

describe("evidence-based audit comparison", () => {
  it("compares redacted evidence while retaining distinct original assertions", () => {
    const before = audit("before", "failed");
    const after = audit("after", "passed");
    for (const item of [before, after]) {
      item.checks[0].requirement =
        'Display "hello@example.com" and phone +1 202 555 0104';
      item.checks[0].expected = "hello@example.com";
      item.results[0].requirement = redact(item.checks[0].requirement);
      item.results[0].expected = redact(item.checks[0].expected);
    }
    expect(compareAudits(after, before).counts.recovered).toBe(1);
    after.checks[0].expected = "someoneelse@example.com";
    after.results[0].expected = redact(after.checks[0].expected);
    expect(compareAudits(after, before).counts.recovered).toBe(0);
    expect(compareAudits(after, before).counts.changed).toBe(1);
  });
  it.each([
    ["passed", "failed", "regressed"],
    ["failed", "passed", "recovered"],
    ["failed", "failed", "still_failing"],
    ["passed", "passed", "unchanged"],
    ["blocked", "passed", "unknown"],
    ["unverified", "passed", "unknown"],
    ["failed", "blocked", "unknown"],
  ] as const)("classifies %s to %s as %s", (before, after, change) => {
    const comparison = compareAudits(
      audit("after", after),
      audit("before", before),
    );
    expect(comparison.comparable).toBe(true);
    expect(comparison.rows[0].change).toBe(change);
  });
  it("allows the same sample's changed condition while preserving its target", () => {
    const after = audit("after", "failed");
    after.source!.sampleVariant = "broken";
    expect(
      compareAudits(after, audit("before", "passed")).counts.regressed,
    ).toBe(1);
  });
  it("never calls an edited expectation a recovery", () => {
    const after = audit("after", "passed");
    after.checks[0].expected = after.results[0].expected = "Different";
    expect(compareAudits(after, audit("before", "failed")).rows[0].change).toBe(
      "changed",
    );
  });
  it("matches a unique unchanged assertion after its generated id changes", () => {
    const after = audit("after", "passed");
    after.checks[0].id = after.results[0].checkId = "new-id";
    expect(
      compareAudits(after, audit("before", "failed")).counts.recovered,
    ).toBe(1);
  });
  it("does not use ambiguous duplicate assertions to prove recovery", () => {
    const before = audit("before", "failed");
    before.checks.push({ ...check, id: "duplicate" });
    expect(
      compareAudits(audit("after", "passed"), before).counts.recovered,
    ).toBe(0);
    expect(compareAudits(audit("after", "passed"), before).counts.unknown).toBe(
      1,
    );
  });
  it("keeps missing execution and mismatched result provenance unknown", () => {
    const after = audit("after", "passed", { status: "error", results: [] });
    expect(
      compareAudits(after, audit("before", "failed")).rows[0],
    ).toMatchObject({ change: "unknown", currentStatus: "not_run" });
    after.results = audit("after", "passed").results;
    after.results[0].expected = "Unapproved assertion";
    expect(
      compareAudits(after, audit("before", "failed")).counts.recovered,
    ).toBe(0);
  });
  it("never promotes an unapproved or manual assertion to a recovery", () => {
    const after = audit("after", "passed");
    after.checks[0].approved = false;
    expect(
      compareAudits(after, audit("before", "failed")).counts.recovered,
    ).toBe(0);
    const before = audit("before", "failed");
    for (const item of [before, after]) {
      item.checks[0].kind = item.results[0].kind = "manual";
    }
    expect(compareAudits(after, before).counts.unknown).toBe(1);
  });
  it("refuses missing target context, different projects/targets and unfinished runs", () => {
    const before = audit("before", "failed");
    for (const after of [
      audit("after", "passed", { source: undefined }),
      audit("after", "passed", { projectId: "other" }),
      audit("after", "passed", {
        source: { ...before.source!, url: "https://other.example/" },
      }),
      audit("after", "passed", { status: "running" }),
      audit("after", "passed", { createdAt: "2026-10-14T00:00:00Z" }),
    ])
      expect(compareAudits(after, before)).toMatchObject({
        comparable: false,
        rows: [],
      });
  });
  it("reports added and removed assertions separately from changed outcomes", () => {
    const after = audit("after", "passed");
    after.checks[0] = {
      ...check,
      id: "different",
      requirement: "New brief",
      expected: "New text",
    };
    expect(
      compareAudits(after, audit("before", "failed")).counts,
    ).toMatchObject({ added: 1, removed: 1, recovered: 0 });
  });
  it("clones source context before later project edits", () => {
    const project = {
      ...audit("after", "passed").source!,
      id: "project",
    } as Project;
    const source = snapshotSource(project);
    project.brief = "Changed later";
    project.generator.provider = "Changed later";
    expect(source.brief).toBe(check.requirement);
    expect(source.generator.provider).toBe("fixture");
  });
});
