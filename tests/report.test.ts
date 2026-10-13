import { describe, it, expect } from "vitest";
import { renderReport } from "../server/report";
import type { Audit } from "../shared/types";
describe("portable evidence report", () => {
  it("escapes client text, preserves uncertainty, and omits remote image sources", async () => {
    const a: Audit = {
      id: "acbd1234",
      projectId: "project",
      projectName: "<script>alert(1)</script>",
      status: "completed",
      createdAt: "2026-10-13T02:00:00Z",
      checks: [],
      results: [
        {
          checkId: "c1",
          requirement: "<img src=x onerror=alert(1)>",
          kind: "manual",
          status: "unverified",
          expected: "Client should trust it",
          durationMs: 0,
          evidence: {
            observed: "Manual review required",
            url: "https://example.com/",
            viewport: { width: 390, height: 844 },
            screenshot: "https://attacker.invalid/tracker.png",
            dom: "email client@example.com password=verysecretvalue",
          },
        },
      ],
    };
    const html = await renderReport(a);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("attacker.invalid");
    expect(html).not.toContain("client@example.com");
    expect(html).not.toContain("verysecretvalue");
    expect(html).toContain("unverified");
    expect(html).toContain("390 × 844");
  });
});
