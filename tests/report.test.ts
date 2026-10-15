import { describe, it, expect, vi } from "vitest";
import { renderReport } from "../server/report";
import type { Audit, Check, CheckResult, ResultStatus } from "../shared/types";

function check(id: string, overrides: Partial<Check> = {}): Check {
  return {
    id,
    requirement: `Requirement ${id}`,
    kind: "heading",
    path: "/",
    expected: `Heading ${id}`,
    viewport: "desktop",
    approved: true,
    ...overrides,
  };
}
function result(id: string, status: ResultStatus = "passed"): CheckResult {
  return {
    checkId: id,
    requirement: `Requirement ${id}`,
    kind: "heading",
    status,
    expected: `Heading ${id}`,
    durationMs: 20,
    evidence: {
      observed: "One matching heading was visible.",
      url: "https://example.com/",
      viewport: { width: 390, height: 844 },
    },
  };
}
function audit(overrides: Partial<Audit> = {}): Audit {
  return {
    id: "acbd1234",
    projectId: "project",
    projectName: "Delivery review",
    status: "completed",
    createdAt: "2026-10-13T02:00:00Z",
    checks: [],
    results: [],
    ...overrides,
  };
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZEYAAAAASUVORK5CYII=",
  "base64",
);
const screenshotPath = "/evidence/acbd1234/01-c1.png";
// Intentionally fake test bytes, assembled to avoid static credential incidents.
const FAKE_TEST_CREDENTIALS = {
  dom: ["very", "secret", "value"].join(""),
  interrupted: ["do", "not", "share"].join("-"),
  source: ["private", "value"].join("-"),
  database: ["secret", ["database", "password"].join("-")].join(" "),
};

function expectCount(html: string, status: ResultStatus, count: number) {
  expect(html).toContain(
    `<div data-status="${status}"><strong>${count}</strong>`,
  );
}

describe("portable evidence report", () => {
  it("escapes client text, preserves uncertainty, and discloses rejected remote image sources", async () => {
    const r = result("c1", "unverified");
    r.requirement = "<img src=x onerror=alert(1)>";
    r.kind = "manual";
    r.expected = "Client should trust it";
    r.evidence.observed = "Manual review required";
    r.evidence.screenshot = "https://attacker.invalid/tracker.png";
    r.evidence.dom = `email client@example.com password=${FAKE_TEST_CREDENTIALS.dom}`;
    const readImage = vi.fn();
    const html = await renderReport(
      audit({ projectName: "<script>alert(1)</script>", results: [r] }),
      readImage,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("attacker.invalid");
    expect(html).not.toContain("client@example.com");
    expect(html).not.toContain(FAKE_TEST_CREDENTIALS.dom);
    expectCount(html, "unverified", 1);
    expect(html).toContain("390 × 844");
    expect(html).toContain("No external image was requested");
    expect(html).toContain(
      "Evidence incomplete: 1 referenced screenshot is unavailable",
    );
    expect(readImage).not.toHaveBeenCalled();
  });

  it("keeps every planned check in an interrupted audit and suppresses a stale success summary", async () => {
    const html = await renderReport(
      audit({
        status: "error",
        checks: [check("c1"), check("c2"), check("c3", { kind: "manual" })],
        results: [result("c1")],
        error: `Runner stopped. password=${FAKE_TEST_CREDENTIALS.interrupted}`,
        summary: "Every requirement passed perfectly.",
      }),
    );
    expectCount(html, "passed", 1);
    expectCount(html, "failed", 0);
    expectCount(html, "unverified", 2);
    for (const id of ["c1", "c2", "c3"])
      expect(html).toContain(`data-check-id="${id}"`);
    expect(html).toContain(
      "1 of 3 planned checks have a matching recorded result",
    );
    expect(html).toContain("Not executed or not recorded");
    expect(html).toContain("Audit incomplete");
    expect(html).toContain("Runner stopped");
    expect(html).not.toContain(FAKE_TEST_CREDENTIALS.interrupted);
    expect(html).not.toContain("Every requirement passed perfectly");
    expect(html).not.toContain("Audit completed");
  });

  it("treats missing coverage as incomplete even when the stored audit says completed", async () => {
    const html = await renderReport(
      audit({
        checks: [check("c1"), check("c2")],
        results: [result("c1")],
        summary: "All checks passed.",
      }),
    );
    expect(html).toContain("Audit incomplete");
    expect(html).not.toContain("All checks passed.");
    expectCount(html, "unverified", 1);
  });

  it.each([
    ["missing", async (): Promise<Buffer | null> => null, "could not be found"],
    [
      "unreadable",
      async (): Promise<Buffer | null> => {
        throw new Error(FAKE_TEST_CREDENTIALS.database);
      },
      "could not be read",
    ],
    [
      "empty",
      async (): Promise<Buffer | null> => Buffer.alloc(0),
      "empty, invalid or incomplete",
    ],
    [
      "wrong format",
      async (): Promise<Buffer | null> =>
        Buffer.from("<svg onload=alert(1)></svg>"),
      "empty, invalid or incomplete",
    ],
    [
      "truncated",
      async (): Promise<Buffer | null> => png.subarray(0, png.length - 3),
      "empty, invalid or incomplete",
    ],
  ] as const)(
    "discloses %s referenced screenshot without changing the browser result",
    async (_label, reader, reason) => {
      const r = result("c1");
      r.evidence.screenshot = screenshotPath;
      const readImage = vi.fn(reader);
      const html = await renderReport(
        audit({ checks: [check("c1")], results: [r] }),
        readImage,
      );
      expect(readImage).toHaveBeenCalledWith(screenshotPath);
      expectCount(html, "passed", 1);
      expectCount(html, "failed", 0);
      expectCount(html, "blocked", 0);
      expect(html).toContain("Audit completed");
      expect(html).toContain(
        "Evidence incomplete: 1 referenced screenshot is unavailable",
      );
      expect(html).toContain(reason);
      expect(html).not.toContain("data:image/");
      expect(html).not.toContain(FAKE_TEST_CREDENTIALS.database);
    },
  );

  it("embeds valid local PNG evidence while retaining a recorded failed outcome", async () => {
    const r = result("c1", "failed");
    r.evidence.screenshot = screenshotPath;
    const html = await renderReport(
      audit({ checks: [check("c1")], results: [r] }),
      async () => png,
    );
    expectCount(html, "failed", 1);
    expect(html).toContain(
      `src="data:image/png;base64,${png.toString("base64")}"`,
    );
    expect(html).not.toContain("Screenshot unavailable");
    expect(html).not.toContain("Evidence incomplete:");
  });

  it("keeps legacy results-only audits readable without inventing a saved plan", async () => {
    const html = await renderReport(
      audit({ results: [result("old1"), result("old2", "blocked")] }),
    );
    expectCount(html, "passed", 1);
    expectCount(html, "blocked", 1);
    expect(html).toContain("2 recorded results");
    expect(html).toContain("planned coverage cannot be verified");
    expect(html).toContain("No screenshot was recorded for this check");
    expect(html).not.toContain("Evidence incomplete:");
    expect(html).not.toContain("Brief and test origin");
  });

  it("does not inflate acceptance counts with duplicate or unlinked result records", async () => {
    const html = await renderReport(
      audit({
        checks: [check("c1"), check("c2")],
        results: [result("c1"), result("c1", "failed"), result("outside")],
      }),
    );
    expectCount(html, "passed", 0);
    expectCount(html, "unverified", 2);
    expect(html).toContain("Conflicting records");
    expect(html).toContain("Results outside the saved plan");
    expect(html).toContain("excluded from the acceptance counts above");
    expect(html).toContain("Requirement outside");
  });

  it("does not claim completion when there are no checks or results", async () => {
    const html = await renderReport(audit());
    expect(html).toContain("Audit incomplete");
    expect(html).toContain("Approve a test plan and run an audit");
    expect(html).not.toContain("Audit completed");
  });

  it.each(["requirement", "kind", "expected"] as const)(
    "does not attach an old pass to a different planned %s with the same ID",
    async (field) => {
      const r = result("c1");
      if (field === "kind") r.kind = "text_visible";
      else r[field] = "Different assertion";
      const html = await renderReport(
        audit({ checks: [check("c1")], results: [r] }),
      );
      expectCount(html, "passed", 0);
      expectCount(html, "unverified", 1);
      expect(html).toContain("Result mismatch");
      expect(html).toContain("Audit incomplete");
      expect(html).not.toContain("One matching heading was visible");
    },
  );

  it("does not count a single pass twice when a saved plan repeats a check ID", async () => {
    const html = await renderReport(
      audit({
        checks: [check("c1"), check("c1")],
        results: [result("c1")],
      }),
    );
    expectCount(html, "passed", 0);
    expectCount(html, "unverified", 2);
    expect(html).toContain("Conflicting records");
  });

  it("matches saved plan text to results already redacted by the runner", async () => {
    const r = result("c1");
    r.requirement = "Contact [redacted email]";
    const html = await renderReport(
      audit({
        checks: [check("c1", { requirement: "Contact client@example.com" })],
        results: [r],
      }),
    );
    expectCount(html, "passed", 1);
    expect(html).not.toContain("Result mismatch");
    expect(html).not.toContain("client@example.com");
  });

  it("includes a redacted source snapshot when present", async () => {
    const html = await renderReport(
      audit({
        checks: [check("c1")],
        results: [result("c1")],
        source: {
          brief: `<b>Original brief</b> client@example.com password=${FAKE_TEST_CREDENTIALS.source}`,
          generator: {
            provider: "<rules>",
            model: null,
            reason: "Conservative parser",
          },
          target: "sample",
          url: "https://example.com/",
          sampleVariant: "broken",
        },
      }),
    );
    expect(html).toContain("Original client brief");
    expect(html).toContain("&lt;b&gt;Original brief&lt;/b&gt;");
    expect(html).toContain("&lt;rules&gt;");
    expect(html).toContain("Synthetic sample (broken)");
    expect(html).not.toContain("client@example.com");
    expect(html).not.toContain(FAKE_TEST_CREDENTIALS.source);
  });
});
