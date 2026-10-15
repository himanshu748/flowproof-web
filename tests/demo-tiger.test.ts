import express from "express";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoRouter } from "../server/demo";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";
import type { runAudit } from "../server/runner";

const adapter = vi.hoisted(() => ({ create: vi.fn(), enabled: vi.fn() }));
vi.mock("../server/hosted-tiger", () => ({
  createHostedTigerStore: adapter.create,
  hostedTigerEnabled: adapter.enabled,
}));
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  adapter.enabled.mockReturnValue(false);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const execute: typeof runAudit = async (_project, audit, onResult) => {
  const results: CheckResult[] = audit.checks.map((check) => ({
    checkId: check.id,
    requirement: check.requirement,
    kind: check.kind,
    expected: check.expected,
    status: check.kind === "manual" ? "unverified" : "failed",
    durationMs: 1,
    evidence: {
      observed:
        "Synthetic test fixture heading failure, not real browser proof.",
      url: "https://sample.flowproof.test/",
      viewport: { width: 1365, height: 900 },
    },
  }));
  for (const result of results) await onResult(result);
  return results;
};
async function harness(
  options: {
    available?: boolean;
    owned?: boolean;
    now?: () => number;
    execute?: typeof runAudit;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "briefstamp-demo-tiger-"));
  const saved = new Map<string, Audit>();
  const store = {
    persistAudit: vi.fn(async (scope: string, audit: Audit) => {
      saved.set(`${scope}:${audit.id}`, structuredClone(audit));
      return {
        inserted: true,
        expiresAt: new Date(
          Date.parse(audit.createdAt) + 30 * 60_000,
        ).toISOString(),
      };
    }),
    getAudit: vi.fn(
      async (scope: string, id: string) => saved.get(`${scope}:${id}`) ?? null,
    ),
    searchFailures: vi.fn(
      async (_scope: string, _input: { projectId: string; query: string }) =>
        [] as Array<{
          auditId: string;
          projectId: string;
          createdAt: string;
          kind: CheckResult["kind"];
          status: "failed" | "blocked";
          requirement: string;
          observed: string;
          retrieval: "lexical";
        }>,
    ),
    close: vi.fn(async () => {}),
  };
  adapter.create.mockReturnValue(store);
  const demo = createDemoRouter({
    evidenceRoot: root,
    secureCookie: false,
    now: options.now,
    execute: options.execute ?? execute,
    gemmaAvailable: () => false,
    tigerAvailable: () => options.available ?? true,
    ...(options.owned ? {} : { tigerStore: store }),
  });
  const app = express();
  app.use(express.json());
  app.use(demo.router);
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
  const request = (
    route: string,
    cookie = "",
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const visitor = async () => {
    const response = await request("/api/bootstrap");
    const bootstrap: Bootstrap = await response.json();
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      project: bootstrap.projects[0],
      bootstrap,
    };
  };
  const start = async (visitor: { cookie: string; project: Project }) => {
    expect(
      (
        await request(
          `/api/projects/${visitor.project.id}/checks`,
          visitor.cookie,
          {
            checks: visitor.project.checks.map((check) => ({
              ...check,
              approved: true,
            })),
          },
          "PUT",
        )
      ).status,
    ).toBe(200);
    const response = await request(
      `/api/projects/${visitor.project.id}/audits`,
      visitor.cookie,
      {},
    );
    expect(response.status).toBe(202);
    return (await response.json()) as Audit;
  };
  const completed = async (id: string, cookie: string) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await request(`/api/audits/${id}`, cookie);
      const audit = (await response.json()) as Audit;
      if (["completed", "error"].includes(audit.status))
        return { response, audit };
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("The fixture audit did not finish.");
  };
  return {
    request,
    visitor,
    start,
    completed,
    store,
    saved,
    dispose: demo.dispose,
  };
}

describe("guarded session-scoped Tiger routes", () => {
  it("keeps disabled bootstrap and existing failure search in memory without constructing a store", async () => {
    const h = await harness({ available: false, owned: true });
    const v = await h.visitor();
    expect(v.bootstrap.storage).toBe("Ephemeral visitor session");
    expect(
      v.bootstrap.integrations.find((item) => item.name === "Tiger Data")
        ?.status,
    ).toBe("not_configured");
    const started = await h.start(v);
    const { audit, response } = await h.completed(started.id, v.cookie);
    expect(response.headers.get("x-briefstamp-storage")).toBe("memory");
    expect(
      (
        await (
          await h.request(`/api/audits/${audit.id}/persistence`, v.cookie)
        ).json()
      ).status,
    ).toBe("not_configured");
    const memory = await (
      await h.request("/api/failures?q=heading", v.cookie)
    ).json();
    expect(memory.mode).toContain("no database");
    expect(memory.results.length).toBe(5);
    expect(
      (
        await h.request(
          `/api/failures?projectId=${v.project.id}&q=heading`,
          v.cookie,
        )
      ).status,
    ).toBe(503);
    expect(adapter.create).not.toHaveBeenCalled();
    expect(h.store.persistAudit).not.toHaveBeenCalled();
    expect(h.store.searchFailures).not.toHaveBeenCalled();
    await h.dispose();
    expect(h.store.close).not.toHaveBeenCalled();
  });

  it("saves only after completion, passes a SHA-256 scope instead of the cookie, and returns an actual saved read", async () => {
    const h = await harness();
    const v = await h.visitor();
    expect(
      v.bootstrap.integrations.find((item) => item.name === "Tiger Data")
        ?.status,
    ).toBe("available");
    expect(v.bootstrap.storage).toContain("Screenshot references only");
    const started = await h.start(v);
    const { audit } = await h.completed(started.id, v.cookie);
    expect(h.store.persistAudit).toHaveBeenCalledOnce();
    const [scope, stored] = h.store.persistAudit.mock.calls[0];
    const rawKey = v.cookie.split("=")[1];
    expect(scope).toBe(createHash("sha256").update(rawKey).digest("hex"));
    expect(scope).not.toBe(rawKey);
    expect(stored.status).toBe("completed");
    expect(stored.completedAt).toBeTruthy();
    expect(stored.source?.target).toBe("sample");
    h.store.getAudit.mockResolvedValueOnce({
      ...audit,
      projectName: "Read from mock database",
    });
    const read = await h.request(`/api/audits/${audit.id}`, v.cookie);
    expect(read.headers.get("x-briefstamp-storage")).toBe("tiger");
    expect((await read.json()).projectName).toBe("Read from mock database");
    expect(h.store.getAudit).toHaveBeenLastCalledWith(scope, audit.id);
    expect(
      (
        await (
          await h.request(`/api/audits/${audit.id}/persistence`, v.cookie)
        ).json()
      ).status,
    ).toBe("saved");
    await h.dispose();
    expect(h.store.close).not.toHaveBeenCalled();
  });

  it("exposes saving separately and a failed insert never changes browser outcomes", async () => {
    const h = await harness();
    const v = await h.visitor();
    const gate = deferred<{ inserted: boolean; expiresAt: string }>();
    h.store.persistAudit.mockReturnValueOnce(gate.promise);
    const started = await h.start(v);
    const { audit, response } = await h.completed(started.id, v.cookie);
    expect(audit.status).toBe("completed");
    expect(response.headers.get("x-briefstamp-storage")).toBe("memory");
    expect(
      (
        await (
          await h.request(`/api/audits/${audit.id}/persistence`, v.cookie)
        ).json()
      ).status,
    ).toBe("saving");
    gate.resolve({ inserted: false, expiresAt: new Date().toISOString() });
    const read = await h.request(`/api/audits/${audit.id}`, v.cookie);
    expect(await read.json()).toEqual(audit);
    expect(read.headers.get("x-briefstamp-storage")).toBe("memory");
    expect(
      (
        await (
          await h.request(`/api/audits/${audit.id}/persistence`, v.cookie)
        ).json()
      ).status,
    ).toBe("unverified");
    expect(h.store.getAudit).not.toHaveBeenCalled();
  });

  it("keeps saved browser evidence when a database read is unavailable or mismatches identity", async () => {
    for (const readFailure of ["throw", "wrong-audit"] as const) {
      const h = await harness();
      const v = await h.visitor();
      const started = await h.start(v);
      const { audit } = await h.completed(started.id, v.cookie);
      if (readFailure === "throw")
        h.store.getAudit.mockRejectedValueOnce(
          new Error("private database secret"),
        );
      else
        h.store.getAudit.mockResolvedValueOnce({ ...audit, id: v.project.id });
      const response = await h.request(`/api/audits/${audit.id}`, v.cookie);
      expect(response.headers.get("x-briefstamp-storage")).toBe("memory");
      expect(await response.json()).toEqual(audit);
      const state = await (
        await h.request(`/api/audits/${audit.id}/persistence`, v.cookie)
      ).json();
      expect(state.status).toBe("unverified");
      expect(JSON.stringify(state)).not.toContain("private database secret");
    }
  });

  it("keeps completed browser outcomes when the database insert throws", async () => {
    const h = await harness();
    const visitor = await h.visitor();
    h.store.persistAudit.mockRejectedValueOnce(
      new Error("private database credential"),
    );
    const started = await h.start(visitor);
    const { audit, response } = await h.completed(started.id, visitor.cookie);
    expect(audit.status).toBe("completed");
    expect(
      audit.results.filter((result) => result.status === "failed"),
    ).toHaveLength(5);
    expect(
      audit.results.filter((result) => result.status === "unverified"),
    ).toHaveLength(1);
    expect(response.headers.get("x-briefstamp-storage")).toBe("memory");
    const state = await (
      await h.request(`/api/audits/${audit.id}/persistence`, visitor.cookie)
    ).json();
    expect(state.status).toBe("unverified");
    expect(JSON.stringify(state)).not.toContain("private database credential");
    expect(h.store.getAudit).not.toHaveBeenCalled();
  });

  it("rejects cross-visitor and expired-session lookups before any database read", async () => {
    let now = Date.parse("2026-10-15T10:00:00Z");
    const h = await harness({ now: () => now });
    const owner = await h.visitor();
    const other = await h.visitor();
    const started = await h.start(owner);
    const { audit } = await h.completed(started.id, owner.cookie);
    h.store.getAudit.mockClear();
    for (const route of [
      `/api/audits/${audit.id}`,
      `/api/audits/${audit.id}/persistence`,
      `/api/failures?projectId=${owner.project.id}&q=heading`,
    ])
      expect((await h.request(route, other.cookie)).status).toBe(404);
    expect(h.store.getAudit).not.toHaveBeenCalled();
    expect(h.store.searchFailures).not.toHaveBeenCalled();
    now += 30 * 60_000;
    expect(
      (await h.request(`/api/audits/${audit.id}`, owner.cookie)).status,
    ).toBe(401);
    expect(
      (
        await h.request(
          `/api/failures?projectId=${owner.project.id}&q=heading`,
          owner.cookie,
        )
      ).status,
    ).toBe(401);
    expect(h.store.getAudit).not.toHaveBeenCalled();
    expect(h.store.searchFailures).not.toHaveBeenCalled();
  });

  it("checks session expiry again after a database read was already in flight", async () => {
    let now = Date.parse("2026-10-15T10:00:00Z");
    const h = await harness({ now: () => now });
    const v = await h.visitor();
    const started = await h.start(v);
    const { audit } = await h.completed(started.id, v.cookie);
    const entered = deferred<void>(),
      gate = deferred<Audit | null>();
    h.store.getAudit.mockImplementationOnce(async () => {
      entered.resolve();
      return gate.promise;
    });
    const response = h.request(`/api/audits/${audit.id}`, v.cookie);
    await entered.promise;
    now += 30 * 60_000;
    gate.resolve(audit);
    expect((await response).status).toBe(401);
  });

  it("uses explicit owned-project lexical retrieval and returns unavailability instead of fake empty success", async () => {
    const h = await harness();
    const v = await h.visitor();
    const started = await h.start(v);
    const { audit } = await h.completed(started.id, v.cookie);
    const row = {
      auditId: audit.id,
      projectId: v.project.id,
      createdAt: audit.createdAt,
      kind: "heading" as const,
      status: "failed" as const,
      requirement: "Heading",
      observed: "Missing heading",
      retrieval: "lexical" as const,
    };
    h.store.searchFailures.mockResolvedValueOnce([row]);
    const response = await h.request(
      `/api/failures?projectId=${v.project.id}&q=heading`,
      v.cookie,
    );
    expect(await response.json()).toEqual({
      results: [{ ...row, projectName: v.project.name }],
      mode: "tiger-lexical",
    });
    expect(h.store.searchFailures).toHaveBeenLastCalledWith(
      createHash("sha256").update(v.cookie.split("=")[1]).digest("hex"),
      { projectId: v.project.id, query: "heading" },
    );
    h.store.searchFailures.mockRejectedValueOnce(
      new Error("private provider error"),
    );
    const failed = await h.request(
      `/api/failures?projectId=${v.project.id}&q=heading`,
      v.cookie,
    );
    expect(failed.status).toBe(503);
    const body = await failed.json();
    expect(body.mode).toBe("unavailable");
    expect(body).not.toHaveProperty("results");
    expect(JSON.stringify(body)).not.toContain("private provider error");
    for (const query of ["", "x".repeat(201)])
      expect(
        (
          await h.request(
            `/api/failures?projectId=${v.project.id}&q=${query}`,
            v.cookie,
          )
        ).status,
      ).toBe(400);
    expect(h.store.searchFailures).toHaveBeenCalledTimes(2);
  });

  it("creates the owned store only when needed and closes it exactly once", async () => {
    const h = await harness({ owned: true });
    const v = await h.visitor();
    expect(adapter.create).not.toHaveBeenCalled();
    const started = await h.start(v);
    await h.completed(started.id, v.cookie);
    expect(adapter.create).toHaveBeenCalledOnce();
    await h.dispose();
    await h.dispose();
    expect(h.store.close).toHaveBeenCalledOnce();
  });

  it("does not persist an errored browser run", async () => {
    const h = await harness({
      execute: async () => {
        throw new Error("Synthetic browser failure");
      },
    });
    const v = await h.visitor();
    const started = await h.start(v);
    const { audit } = await h.completed(started.id, v.cookie);
    expect(audit.status).toBe("error");
    expect(h.store.persistAudit).not.toHaveBeenCalled();
    expect(h.store.getAudit).not.toHaveBeenCalled();
  });
});
