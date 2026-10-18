import express from "express";
import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDemoRouter } from "../server/demo";
import { generateLocalChecks } from "../server/generator";
import type {
  HostedApprovalOptions,
  HostedApprovalReceipt,
  HostedApprovalRun,
} from "../server/hosted-approval";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";

// This suite checks HTTP ownership and immutable approval integration. Its SDK
// controller and browser port are explicit fixtures, never hosted evidence.
describe("session-bound hosted approval integration", () => {
  it("suspends before browser dispatch, rejects edited assertions and foreign sessions, and resumes once", async () => {
    let executions = 0,
      starts = 0,
      resumes = 0,
      disposed = 0;
    const directory = await mkdtemp(
      path.join(tmpdir(), "briefstamp-approval-http-"),
    );
    const makeReceipt = (options: HostedApprovalOptions) => {
      let receipt: HostedApprovalReceipt;
      const runId = randomUUID();
      return {
        async start() {
          starts++;
          const checks = (await options.propose({
            brief: options.brief,
          })) as Project["checks"];
          receipt = {
            provider: "Mastra",
            package: "@mastra/core",
            version: "1.77.0",
            workflowId: "briefstamp-explicit-approval",
            runId,
            status: "suspended",
            scope: "process-local",
            durable: false,
            maxRssMiB: 1,
            steps: [{ id: "await-developer-approval", status: "suspended" }],
            suspension: {
              reason:
                "Explicit developer approval is required before browser execution.",
              scope: "process-local",
              checks,
              checkIds: checks.map((c) => c.id),
              planDigest: createHash("sha256").update(runId).digest("hex"),
            },
          };
          return structuredClone(receipt);
        },
        async resume(input: any) {
          resumes++;
          const results = await options.execute(
            receipt.suspension!.checks.map((c) => ({ ...c, approved: true })),
            { brief: options.brief, runId, planDigest: input.planDigest },
          );
          receipt = {
            ...receipt,
            status: "success",
            result: {
              results,
              approvedCheckIds: input.approvedCheckIds,
              planDigest: input.planDigest,
            },
          };
          return structuredClone(receipt);
        },
        get expiresAt() {
          return Date.now() + 60_000;
        },
        get receipt() {
          return structuredClone(receipt);
        },
        async dispose() {
          disposed++;
        },
      } satisfies HostedApprovalRun;
    };
    const demo = createDemoRouter({
      evidenceRoot: directory,
      secureCookie: false,
      approvalEnabled: true,
      createApprovalRun: makeReceipt,
      gemmaAvailable: () => true,
      verifyGemmaFree: async () => ({}),
      generateGemma: async (requirements) => ({
        model: "gemma-4-26b-a4b-it",
        latencyMs: 1,
        usage: null,
        checks: generateLocalChecks(requirements.join("\n")).map(
          (check, requirementIndex) => ({
            requirementIndex,
            kind: check.kind,
            path: check.path,
            expected: check.expected,
            viewport: check.viewport,
          }),
        ),
      }),
      execute: async (_project, audit, onResult) => {
        executions++;
        const results: CheckResult[] = audit.checks.map((check) => ({
          checkId: check.id,
          requirement: check.requirement,
          kind: check.kind,
          expected: check.expected,
          status: check.kind === "manual" ? "unverified" : "passed",
          durationMs: 1,
          evidence: {
            observed: "Explicit test fixture",
            url: "https://sample.flowproof.test/",
            viewport: { width: 1365, height: 900 },
          },
        }));
        for (const result of results) await onResult(result);
        return results;
      },
    });
    const app = express();
    app.use(express.json());
    app.use(demo.router);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let cookie = "";
    const request = async (
      route: string,
      method = "GET",
      body?: unknown,
      ownCookie = cookie,
    ) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          ...(ownCookie ? { cookie: ownCookie } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    };
    try {
      const bootstrap = await request("/api/bootstrap");
      cookie = bootstrap.cookie!;
      const project = (bootstrap.body as Bootstrap).projects[0];
      const generated = await request(
        `/api/projects/${project.id}/generate-gemma`,
        "POST",
        { modelConsent: true },
      );
      expect(generated.status).toBe(200);
      const proposal: Project = generated.body;
      expect(proposal.approvalWorkflow?.status).toBe("suspended");
      expect(executions).toBe(0);
      expect(starts).toBe(1);
      expect(
        (
          await request(`/api/projects/${project.id}/generate-gemma`, "POST", {
            modelConsent: true,
          })
        ).status,
      ).toBe(409);
      expect(starts).toBe(1);
      expect(
        (await request(`/api/projects/${project.id}/audits`, "POST", {}))
          .status,
      ).toBe(409);
      expect(executions).toBe(0);
      const changed = proposal.checks.map((c, i) =>
        i ? c : { ...c, expected: "tampered" },
      );
      expect(
        (
          await request(`/api/projects/${project.id}/checks`, "PUT", {
            checks: changed,
          })
        ).status,
      ).toBe(409);
      const other = await request("/api/bootstrap", "GET", undefined, "");
      expect(
        (
          await request(
            `/api/projects/${project.id}/audits`,
            "POST",
            {},
            other.cookie!,
          )
        ).status,
      ).toBe(404);
      const checks = proposal.checks.map((c) => ({ ...c, approved: true }));
      expect(
        (await request(`/api/projects/${project.id}/checks`, "PUT", { checks }))
          .status,
      ).toBe(200);
      const started = await request(
        `/api/projects/${project.id}/audits`,
        "POST",
        {},
      );
      expect(started.status).toBe(202);
      let result: Audit = started.body;
      for (let i = 0; i < 50 && result.status === "running"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        result = (await request(`/api/audits/${result.id}`)).body;
      }
      expect(result.status).toBe("completed");
      expect(result.approvalWorkflow?.status).toBe("success");
      expect(result.results).toHaveLength(checks.length);
      expect(executions).toBe(1);
      expect(resumes).toBe(1);
      expect(
        (await request(`/api/projects/${project.id}/audits`, "POST", {}))
          .status,
      ).toBe(409);
      expect(executions).toBe(1);
      expect(disposed).toBeGreaterThan(0);
      const variant = await request(
        `/api/projects/${project.id}/variant`,
        "POST",
        { sampleVariant: "broken" },
      );
      expect(variant.status).toBe(200);
      expect(variant.body.approvalWorkflow).toBeUndefined();
      const rules = await request(
        `/api/projects/${project.id}/generate`,
        "POST",
        { brief: project.brief },
      );
      expect(rules.status).toBe(200);
      expect(rules.body.approvalWorkflow).toBeUndefined();
      expect(
        (
          await request(`/api/projects/${project.id}/checks`, "PUT", {
            checks: rules.body.checks.map((c: any) => ({
              ...c,
              approved: true,
            })),
          })
        ).status,
      ).toBe(200);
      expect(
        (await request(`/api/projects/${project.id}/audits`, "POST", {}))
          .status,
      ).toBe(202);
      expect(result.approvalWorkflow?.status).toBe("success");
    } finally {
      await demo.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
