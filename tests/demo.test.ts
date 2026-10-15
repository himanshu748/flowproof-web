import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Bootstrap, Project, Audit, CheckResult } from "../shared/types";
import { createDemoRouter } from "../server/demo";
import { runAudit } from "../server/runner";
import { getEvaluation } from "../server/evaluation";
import { compareAudits } from "../shared/compare-audits";

// These throw at import time, rather than replacing SDK behavior with a fake.
// Every route below must work when the operator orchestration is unavailable.
const operatorLoads = vi.hoisted(() => ({ attempts: [] as string[] }));
vi.mock("../server/orchestration", () => {
  operatorLoads.attempts.push("orchestration");
  throw new Error("Public demo must not load operator orchestration");
});
vi.mock("@mastra/core/mastra", () => {
  operatorLoads.attempts.push("mastra");
  throw new Error("Public demo must not load Mastra");
});
vi.mock("@mastra/core/workflows", () => {
  operatorLoads.attempts.push("workflows");
  throw new Error("Public demo must not load Mastra workflows");
});
vi.mock("@mastra/core/tools", () => {
  operatorLoads.attempts.push("tools");
  throw new Error("Public demo must not load Mastra tools");
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  expect(operatorLoads.attempts).toEqual([]);
});

async function harness(
  options: {
    execute?: typeof runAudit;
    now?: () => number;
    secureCookie?: boolean;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "flowproof-demo-"));
  const demo = createDemoRouter({
    evidenceRoot: root,
    secureCookie: false,
    ...options,
  });
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(demo.router);
  app.use((_req, res) =>
    res.status(418).json({ error: "Private route reached" }),
  );
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    await demo.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });
  function request(
    route: string,
    cookie = "",
    body?: unknown,
    method = body ? "POST" : "GET",
    origin?: string,
  ) {
    return fetch(`${base}${route}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...(origin ? { origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async function visitor() {
    const response = await request("/api/bootstrap");
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const bootstrap = (await response.json()) as Bootstrap;
    return { cookie, bootstrap, response, project: bootstrap.projects[0] };
  }
  async function approve(p: Project, cookie: string) {
    const response = await request(
      `/api/projects/${p.id}/checks`,
      cookie,
      { checks: p.checks.map((check) => ({ ...check, approved: true })) },
      "PUT",
    );
    expect(response.status).toBe(200);
  }
  async function completed(id: string, cookie: string) {
    for (let i = 0; i < 100; i++) {
      const audit = (await (
        await request(`/api/audits/${id}`, cookie)
      ).json()) as Audit;
      if (audit.status !== "running") return audit;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Demo audit did not finish within 15 seconds");
  }
  return { root, base, request, visitor, approve, completed };
}

describe("isolated tokenless public demo", () => {
  it("creates and regenerates unapproved deterministic drafts without operator SDKs", async () => {
    const h = await harness();
    const visitor = await h.visitor();
    const created = await h.request("/api/projects", visitor.cookie, {
      name: "Local sample",
      target: "sample",
      authorized: true,
      brief: 'The homepage heading must say "First draft".',
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as Project;
    expect(project.generator).toMatchObject({
      provider: "Deterministic parser",
      model: null,
    });
    expect(project.checks).toMatchObject([
      { expected: "First draft", approved: false },
    ]);
    await h.approve(project, visitor.cookie);
    const regenerated = await h.request(
      `/api/projects/${project.id}/generate`,
      visitor.cookie,
      {
        brief: 'The homepage heading must say "Revised draft".',
      },
    );
    expect(regenerated.status).toBe(200);
    const revised = (await regenerated.json()) as Project;
    expect(revised.generator).toEqual(project.generator);
    expect(revised.checks).toMatchObject([
      { expected: "Revised draft", approved: false },
    ]);
    expect(
      (
        await h.request(
          `/api/projects/${project.id}/audits`,
          visitor.cookie,
          {},
        )
      ).status,
    ).toBe(409);
    expect(operatorLoads.attempts).toEqual([]);
  });

  it("isolates visitor projects and terminates unknown API/evidence routes", async () => {
    const h = await harness({ secureCookie: true });
    const a = await h.visitor(),
      b = await h.visitor();
    expect(a.cookie).not.toBe(b.cookie);
    expect(a.project.id).not.toBe(b.project.id);
    expect(a.response.headers.get("set-cookie")).toMatch(
      /HttpOnly.*Secure.*SameSite=Strict/i,
    );
    expect(a.bootstrap.demo?.enabled).toBe(true);
    expect(
      a.bootstrap.integrations.find((item) => item.name === "Tiger Data")
        ?.status,
    ).toBe("not_configured");
    expect(a.bootstrap.evaluation.configurations).toEqual(
      getEvaluation().configurations,
    );
    expect(a.bootstrap.evaluation.notes.join(" ")).toContain(
      "recorded offline experiments, separate from the opt-in live Gemma",
    );
    expect(
      (await h.request(`/api/projects/${a.project.id}`, b.cookie)).status,
    ).toBe(404);
    expect(
      (await h.request("/api/private-future-route", a.cookie)).status,
    ).toBe(404);
    expect((await h.request("/evidence/private/a.png", a.cookie)).status).toBe(
      404,
    );
    expect((await h.request("/api/private-future-route")).status).toBe(401);
    expect(
      (await h.request("/API/PRIVATE-FUTURE-ROUTE", a.cookie)).status,
    ).toBe(404);
    expect((await h.request("/EvIdEnCe/private/a.png", a.cookie)).status).toBe(
      404,
    );
    expect(
      (await h.request(`/API/projects/${a.project.id}`, b.cookie)).status,
    ).toBe(404);
    expect(
      (await h.request(`/ApI/PrOjEcTs/${a.project.id}`, a.cookie)).status,
    ).toBe(200);
    expect((await h.request("/assets/frontend.js")).status).toBe(418);
  });

  it("requires approval and rejects external targets, unsafe checks and cross-origin writes", async () => {
    const h = await harness();
    const a = await h.visitor();
    expect(
      (await h.request(`/api/projects/${a.project.id}/audits`, a.cookie, {}))
        .status,
    ).toBe(409);
    expect(
      (
        await h.request("/api/projects", a.cookie, {
          name: "External",
          target: "website",
          url: "http://169.254.169.254",
          authorized: true,
          brief: a.project.brief,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(
          `/api/projects/${a.project.id}/checks`,
          a.cookie,
          {
            checks: [
              {
                ...a.project.checks[0],
                path: "//attacker.example/",
                approved: true,
              },
            ],
          },
          "PUT",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(
          `/api/projects/${a.project.id}/checks`,
          a.cookie,
          {
            checks: Array.from({ length: 25 }, (_, i) => ({
              ...a.project.checks[0],
              id: `check-${i}`,
            })),
          },
          "PUT",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(`/api/projects/${a.project.id}/generate`, a.cookie, {
          brief: "x".repeat(6001),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(
          `/api/projects/${a.project.id}/variant`,
          a.cookie,
          { sampleVariant: "broken" },
          "POST",
          "https://other.example",
        )
      ).status,
    ).toBe(403);
    await h.approve(a.project, a.cookie);
    const p = (await (
      await h.request(`/api/projects/${a.project.id}/variant`, a.cookie, {
        sampleVariant: "broken",
      })
    ).json()) as Project;
    expect(p.checks.every((check) => !check.approved)).toBe(true);
  });

  it("runs real healthy and broken samples with isolated screenshots and portable reports", async () => {
    const h = await harness();
    const a = await h.visitor(),
      b = await h.visitor();
    await h.approve(a.project, a.cookie);
    const start = await h.request(
      `/api/projects/${a.project.id}/audits`,
      a.cookie,
      {},
    );
    expect(start.status).toBe(202);
    const healthy = await h.completed((await start.json()).id, a.cookie);
    expect(healthy.status).toBe("completed");
    expect(healthy.results.filter((r) => r.status === "passed")).toHaveLength(
      5,
    );
    expect(
      healthy.results.filter((r) => r.status === "unverified"),
    ).toHaveLength(1);
    const screenshot = healthy.results.find((r) => r.evidence.screenshot)!
      .evidence.screenshot!;
    const image = await h.request(screenshot, a.cookie);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/png");
    expect((await h.request(screenshot, b.cookie)).status).toBe(404);
    expect(
      (await h.request(`/api/audits/${healthy.id}`, b.cookie)).status,
    ).toBe(404);
    expect(
      (await h.request(`/api/audits/${healthy.id}/report`, b.cookie)).status,
    ).toBe(404);
    const report = await (
      await h.request(`/api/audits/${healthy.id}/report`, a.cookie)
    ).text();
    expect(report).toContain("data:image/png;base64,");
    expect(report).toContain("No AI model was used");
    const brokenProject = (await (
      await h.request(`/api/projects/${a.project.id}/variant`, a.cookie, {
        sampleVariant: "broken",
      })
    ).json()) as Project;
    await h.approve(brokenProject, a.cookie);
    const brokenStart = await (
      await h.request(`/api/projects/${a.project.id}/audits`, a.cookie, {})
    ).json();
    const broken = await h.completed(brokenStart.id, a.cookie);
    expect(broken.results.filter((r) => r.status === "failed")).toHaveLength(3);
    expect(healthy.source).toMatchObject({
      brief: a.project.brief,
      sampleVariant: "healthy",
      generator: a.project.generator,
    });
    expect(broken.source?.sampleVariant).toBe("broken");
    expect(compareAudits(broken, healthy).counts).toMatchObject({
      regressed: 3,
      unchanged: 2,
      unknown: 1,
    });
    await h.request(`/api/projects/${a.project.id}/generate`, a.cookie, {
      brief: 'The page must show "A later client revision".',
    });
    const savedHealthy = await h.completed(healthy.id, a.cookie);
    expect(savedHealthy.source).toEqual(healthy.source);
    expect(savedHealthy.checks).toEqual(healthy.checks);
    const failures = await (await h.request("/api/failures", a.cookie)).json();
    expect(failures.results).toHaveLength(3);
    expect(
      (await (await h.request("/api/failures", b.cookie)).json()).results,
    ).toHaveLength(0);
  }, 35_000);

  it("expires sessions, removes only their audit evidence and enforces visitor capacity", async () => {
    let time = Date.now();
    const execute: typeof runAudit = async (_p, a) => {
      await mkdir(path.join(h.root, a.id));
      await writeFile(path.join(h.root, a.id, "proof.png"), "sample");
      return [];
    };
    const h = await harness({ now: () => time, execute });
    const a = await h.visitor();
    await writeFile(path.join(h.root, "keep-private-file.txt"), "untouched");
    await h.approve(a.project, a.cookie);
    const start = await (
      await h.request(`/api/projects/${a.project.id}/audits`, a.cookie, {})
    ).json();
    await h.completed(start.id, a.cookie);
    for (let i = 1; i < 20; i++)
      expect((await h.request("/api/bootstrap")).status).toBe(200);
    expect((await h.request("/api/bootstrap")).status).toBe(429);
    time += 31 * 60_000;
    const expired = await h.request(`/api/projects/${a.project.id}`, a.cookie);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(
      readFile(path.join(h.root, start.id, "proof.png")),
    ).rejects.toThrow();
    expect(
      await readFile(path.join(h.root, "keep-private-file.txt"), "utf8"),
    ).toBe("untouched");
    const restarted = await h.request("/api/bootstrap", a.cookie);
    expect(restarted.status).toBe(200);
    const fresh = (await restarted.json()) as Bootstrap;
    const freshCookie = restarted.headers.get("set-cookie")!.split(";")[0];
    expect(freshCookie).not.toBe(a.cookie);
    expect(fresh.audits).toHaveLength(0);
    expect(
      fresh.projects.every((p) => p.checks.every((c) => !c.approved)),
    ).toBe(true);
    expect(fresh.projects.some((p) => p.id === a.project.id)).toBe(false);
    expect(
      (await h.request(`/api/projects/${a.project.id}`, freshCookie)).status,
    ).toBe(404);
  });

  it.each([
    "missing",
    "duplicate",
    "mismatched",
    "manual-pass",
    "malformed",
  ] as const)(
    "does not complete an audit with %s runner evidence",
    async (failure) => {
      const execute: typeof runAudit = async (_project, audit, onResult) => {
        let results: CheckResult[] = audit.checks.map((check) => ({
          checkId: check.id,
          requirement: check.requirement,
          kind: check.kind,
          expected: check.expected,
          status: check.kind === "manual" ? "unverified" : "passed",
          durationMs: 1,
          evidence: {
            observed: "Injected validation fixture",
            url: "https://sample.flowproof.test/",
            viewport: { width: 1365, height: 900 },
          },
        }));
        if (failure === "missing") results = results.slice(0, 1);
        if (failure === "duplicate") results[1] = structuredClone(results[0]);
        if (failure === "mismatched")
          results[0].expected = "Different assertion";
        if (failure === "manual-pass")
          results.find((result) => result.kind === "manual")!.status = "passed";
        if (failure === "malformed") results[0].durationMs = -1;
        for (const result of results) await onResult(result);
        return results;
      };
      const h = await harness({ execute });
      const visitor = await h.visitor();
      await h.approve(visitor.project, visitor.cookie);
      const start = await h.request(
        `/api/projects/${visitor.project.id}/audits`,
        visitor.cookie,
        {},
      );
      expect(start.status).toBe(202);
      const audit = await h.completed((await start.json()).id, visitor.cookie);
      expect(audit.status).toBe("error");
      expect(audit.summary).toBeUndefined();
      expect(audit.results).toHaveLength(
        failure === "missing" || failure === "duplicate"
          ? 1
          : failure === "manual-pass"
            ? 5
            : 0,
      );
    },
  );

  it("caps concurrent work, four runs per visitor and the global hourly browser budget", async () => {
    let release!: () => void;
    let shouldWait = true;
    const execute: typeof runAudit = async () => {
      if (shouldWait)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return [];
    };
    const h = await harness({ execute });
    const a = await h.visitor(),
      b = await h.visitor();
    await h.approve(a.project, a.cookie);
    await h.approve(b.project, b.cookie);
    const first = await (
      await h.request(`/api/projects/${a.project.id}/audits`, a.cookie, {})
    ).json();
    expect(
      (await h.request(`/api/projects/${b.project.id}/audits`, b.cookie, {}))
        .status,
    ).toBe(409);
    shouldWait = false;
    release();
    await h.completed(first.id, a.cookie);
    for (let i = 0; i < 3; i++)
      expect(
        (await h.request(`/api/projects/${a.project.id}/audits`, a.cookie, {}))
          .status,
      ).toBe(202);
    expect(
      (await h.request(`/api/projects/${a.project.id}/audits`, a.cookie, {}))
        .status,
    ).toBe(429);
    for (let v = 0; v < 5; v++) {
      const visitor = v === 0 ? b : await h.visitor();
      await h.approve(visitor.project, visitor.cookie);
      for (let i = 0; i < 4; i++)
        expect(
          (
            await h.request(
              `/api/projects/${visitor.project.id}/audits`,
              visitor.cookie,
              {},
            )
          ).status,
        ).toBe(202);
    }
    const next = await h.visitor();
    await h.approve(next.project, next.cookie);
    expect(
      (
        await h.request(
          `/api/projects/${next.project.id}/audits`,
          next.cookie,
          {},
        )
      ).status,
    ).toBe(429);
  });
});
