import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoRouter } from "../server/demo";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";

const hosted = vi.hoisted(() => ({
  authorize: vi.fn(),
  remember: vi.fn(),
  recall: vi.fn(),
  enabled: vi.fn(),
}));
vi.mock("../server/hosted-backboard", () => ({
  authorizeHostedBackboard: hosted.authorize,
  rememberHostedAudit: hosted.remember,
  recallHostedMemory: hosted.recall,
  hostBackboardEnabled: hosted.enabled,
}));
const OPERATOR_TOKEN = [
  "synthetic-operator",
  "token-with-at-least-32-characters",
].join("-");
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  hosted.authorize.mockImplementation(
    (headers) => headers["x-flowproof-token"] === OPERATOR_TOKEN,
  );
  hosted.enabled.mockReturnValue(true);
  hosted.remember.mockResolvedValue({
    provider: "Backboard",
    memoryId: "synthetic-memory",
  });
  hosted.recall.mockResolvedValue({
    provider: "Backboard",
    memories: [
      {
        text: "Historical synthetic heading failure; not a current audit result.",
      },
    ],
  });
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function harness(holdAudit = false) {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "briefstamp-demo-backboard-"),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (!holdAudit) release();
  const demo = createDemoRouter({
    evidenceRoot,
    secureCookie: false,
    gemmaAvailable: () => false,
    execute: async (_project, audit, onResult) => {
      await gate;
      const results: CheckResult[] = audit.checks.map((check) => ({
        checkId: check.id,
        requirement: check.requirement,
        kind: check.kind,
        expected: check.expected,
        status: check.kind === "manual" ? "unverified" : "failed",
        durationMs: 1,
        evidence: {
          observed: "Local injected test fixture; not real browser evidence.",
          url: "https://sample.flowproof.test/",
          viewport: { width: 1365, height: 900 },
        },
      }));
      for (const result of results) await onResult(result);
      return results;
    },
  });
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(demo.router);
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error instanceof z.ZodError ? 400 : 500)
        .json({ error: "Request rejected." });
    },
  );
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    release();
    await demo.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(evidenceRoot, { force: true, recursive: true });
  });
  const request = (
    route: string,
    cookie = "",
    body?: unknown,
    token?: string,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { "x-flowproof-token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const visitor = async () => {
    const response = await request("/api/bootstrap");
    expect(response.status).toBe(200);
    const bootstrap: Bootstrap = await response.json();
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      project: bootstrap.projects[0],
    };
  };
  const startAudit = async (visitor: { cookie: string; project: Project }) => {
    const approved = await request(
      `/api/projects/${visitor.project.id}/checks`,
      visitor.cookie,
      {
        checks: visitor.project.checks.map((check) => ({
          ...check,
          approved: true,
        })),
      },
      undefined,
      "PUT",
    );
    expect(approved.status).toBe(200);
    const started = await request(
      `/api/projects/${visitor.project.id}/audits`,
      visitor.cookie,
      {},
    );
    expect(started.status).toBe(202);
    return (await started.json()) as Audit;
  };
  const getAudit = async (id: string, cookie: string) =>
    (await (await request(`/api/audits/${id}`, cookie)).json()) as Audit;
  const completed = async (id: string, cookie: string) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const audit = await getAudit(id, cookie);
      if (audit.status === "completed") return audit;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("The injected audit did not complete.");
  };
  return { request, visitor, startAudit, getAudit, completed, release };
}

describe("hosted Backboard operator routes remain session isolated", () => {
  it("rejects anonymous requests before provider access and unauthorized requests before body validation or lookup", async () => {
    const h = await harness();
    for (const route of [
      "/api/audits/unknown/memory",
      "/api/projects/unknown/memory/search",
    ]) {
      expect(
        (await h.request(route, "", { unsafe: true }, OPERATOR_TOKEN)).status,
      ).toBe(401);
    }
    const visitor = await h.visitor();
    // Bootstrap may inspect pure configuration for its integration badge.
    hosted.enabled.mockClear();
    for (const route of [
      "/api/audits/unknown/memory",
      `/api/projects/${visitor.project.id}/memory/search`,
      "/api/projects/unknown/memory/search",
    ]) {
      expect(
        (await h.request(route, visitor.cookie, { unsafe: true })).status,
      ).toBe(404);
    }
    expect(
      (await h.request("/api/operator/status", visitor.cookie)).status,
    ).toBe(404);
    expect(hosted.enabled).not.toHaveBeenCalled();
    expect(hosted.remember).not.toHaveBeenCalled();
    expect(hosted.recall).not.toHaveBeenCalled();
  });

  it("stores only an authorized operator's completed audit from the current visitor session", async () => {
    const h = await harness();
    const visitor = await h.visitor();
    const started = await h.startAudit(visitor);
    const audit = await h.completed(started.id, visitor.cookie);
    const saved = await h.request(
      `/api/audits/${audit.id}/memory`,
      visitor.cookie,
      {},
      OPERATOR_TOKEN,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      provider: "Backboard",
      memoryId: "synthetic-memory",
    });
    expect(hosted.remember).toHaveBeenCalledExactlyOnceWith(audit);
    expect(await h.getAudit(audit.id, visitor.cookie)).toEqual(audit);
  });

  it("keeps other visitors' completed audits and projects hidden even with operator authentication", async () => {
    const h = await harness();
    const owner = await h.visitor();
    const other = await h.visitor();
    const started = await h.startAudit(owner);
    await h.completed(started.id, owner.cookie);
    expect(
      (
        await h.request(
          `/api/audits/${started.id}/memory`,
          other.cookie,
          {},
          OPERATOR_TOKEN,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          `/api/projects/${owner.project.id}/memory/search`,
          other.cookie,
          { kind: "heading" },
          OPERATOR_TOKEN,
        )
      ).status,
    ).toBe(404);
    expect(hosted.remember).not.toHaveBeenCalled();
    expect(hosted.recall).not.toHaveBeenCalled();
  });

  it("does not store unfinished audits", async () => {
    const h = await harness(true);
    const visitor = await h.visitor();
    const audit = await h.startAudit(visitor);
    expect(
      (
        await h.request(
          `/api/audits/${audit.id}/memory`,
          visitor.cookie,
          {},
          OPERATOR_TOKEN,
        )
      ).status,
    ).toBe(409);
    expect(hosted.remember).not.toHaveBeenCalled();
    h.release();
  });

  it("rejects unknown write/search fields before invoking either provider operation", async () => {
    const h = await harness();
    const visitor = await h.visitor();
    const started = await h.startAudit(visitor);
    await h.completed(started.id, visitor.cookie);
    expect(
      (
        await h.request(
          `/api/audits/${started.id}/memory`,
          visitor.cookie,
          { approved: true },
          OPERATOR_TOKEN,
        )
      ).status,
    ).toBe(400);
    for (const body of [
      { kind: "heading", projectId: "another-project" },
      { kind: "script" },
      { kind: "heading", query: "arbitrary private client data" },
    ]) {
      expect(
        (
          await h.request(
            `/api/projects/${visitor.project.id}/memory/search`,
            visitor.cookie,
            body,
            OPERATOR_TOKEN,
          )
        ).status,
      ).toBe(400);
    }
    expect(hosted.remember).not.toHaveBeenCalled();
    expect(hosted.recall).not.toHaveBeenCalled();
  });

  it("recalls only the current session's project and requested finite check kind", async () => {
    const h = await harness();
    const visitor = await h.visitor();
    const response = await h.request(
      `/api/projects/${visitor.project.id}/memory/search`,
      visitor.cookie,
      { kind: "heading" },
      OPERATOR_TOKEN,
    );
    expect(response.status).toBe(200);
    expect(hosted.recall).toHaveBeenCalledExactlyOnceWith(
      visitor.project.id,
      "heading",
    );
    expect(await response.json()).toEqual({
      provider: "Backboard",
      memories: [
        {
          text: "Historical synthetic heading failure; not a current audit result.",
        },
      ],
    });
    expect(hosted.remember).not.toHaveBeenCalled();
  });

  it("reports provider outages safely while preserving completed audit observations", async () => {
    const h = await harness();
    const visitor = await h.visitor();
    const started = await h.startAudit(visitor);
    const audit = await h.completed(started.id, visitor.cookie);
    hosted.remember.mockRejectedValue(
      new Error("private-key provider internals"),
    );
    hosted.recall.mockRejectedValue(
      new Error("private-key provider internals"),
    );
    for (const [route, body] of [
      [`/api/audits/${audit.id}/memory`, {}],
      [
        `/api/projects/${visitor.project.id}/memory/search`,
        { kind: "heading" },
      ],
    ] as const) {
      const response = await h.request(
        route,
        visitor.cookie,
        body,
        OPERATOR_TOKEN,
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private-key");
    }
    expect(await h.getAudit(audit.id, visitor.cookie)).toEqual(audit);
  });

  it("exposes operator availability only after authorization", async () => {
    const h = await harness();
    const visitor = await h.visitor();
    hosted.enabled.mockClear();
    const response = await h.request(
      "/api/operator/status",
      visitor.cookie,
      undefined,
      OPERATOR_TOKEN,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ backboard: true });
    expect(hosted.enabled).toHaveBeenCalledOnce();
    expect(hosted.remember).not.toHaveBeenCalled();
    expect(hosted.recall).not.toHaveBeenCalled();
  });
});
