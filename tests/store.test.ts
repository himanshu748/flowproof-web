import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { Audit, Project } from "../shared/types";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  readFile: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      query = mocks.query;
      end = mocks.end;
    },
  },
}));
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    readFile: mocks.readFile,
    writeFile: vi.fn(),
    rename: vi.fn(),
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://unit-test.invalid/test");
  vi.stubEnv("FLOWPROOF_EMBEDDINGS", "false");
  mocks.query.mockReset().mockResolvedValue({ rows: [] });
  mocks.end.mockReset().mockResolvedValue(undefined);
  mocks.readFile.mockReset().mockResolvedValue(Buffer.from("png evidence"));
});
afterEach(() => vi.unstubAllEnvs());
const audit = (): Audit => ({
  id: "aaaaaaaa-1111",
  projectId: "p1",
  projectName: "Fixture",
  status: "completed",
  createdAt: "2026-10-13T00:00:00Z",
  checks: [],
  results: [
    {
      checkId: "c1",
      requirement: "Visible heading",
      kind: "heading",
      expected: "Hello",
      status: "passed",
      durationMs: 1,
      evidence: {
        url: "https://sample.flowproof.test/",
        observed: "Hello",
        viewport: { width: 390, height: 844 },
        screenshot: "/evidence/aaaaaaaa-1111/01.png",
      },
    },
  ],
});
const project = (id = "p1"): Project => ({
  id,
  name: "Confirmed project",
  url: "https://sample.flowproof.test/",
  target: "sample",
  sampleVariant: "healthy",
  authorized: true,
  brief: "Synthetic persistence test fixture.",
  checks: [],
  createdAt: "2026-10-13T00:00:00Z",
  updatedAt: "2026-10-13T00:00:00Z",
  generator: { provider: "unit test fixture", model: null },
});
type Snapshot = { projects: Project[]; audits: Audit[] };
describe("durable completion boundary", () => {
  it("closes the pool only after an outstanding state write settles", async () => {
    const store = await import("../server/store");
    await store.initStore();
    let finish!: (value: { rows: unknown[] }) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const write = store.saveAudit({ ...audit(), status: "running" });
    await Promise.resolve();
    const close = store.closeStore();
    await Promise.resolve();
    expect(mocks.end).not.toHaveBeenCalled();
    finish({ rows: [] });
    await write;
    await close;
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("saves every referenced screenshot before publishing completed state", async () => {
    const store = await import("../server/store");
    await store.initStore();
    mocks.query.mockClear();
    await store.saveAudit(audit());
    const calls = mocks.query.mock.calls;
    const evidence = calls.findIndex((c) =>
      String(c[0]).startsWith("INSERT INTO flowproof_evidence"),
    );
    const completed = calls.findIndex(
      (c) =>
        String(c[0]).startsWith("INSERT INTO flowproof_state") &&
        String(c[1]?.[0]).includes('"completed"'),
    );
    expect(evidence).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThan(evidence);
    expect(store.getAudit("aaaaaaaa-1111")?.status).toBe("completed");
  });
  it("keeps a run incomplete when referenced screenshots cannot be retained", async () => {
    const store = await import("../server/store");
    await store.initStore();
    const a = audit();
    await store.saveAudit({ ...a, status: "running" });
    mocks.readFile.mockRejectedValue(new Error("Missing screenshot"));
    mocks.query.mockClear();
    await expect(store.saveAudit(a)).rejects.toThrow("referenced screenshot");
    expect(store.getAudit(a.id)?.status).toBe("running");
    expect(
      mocks.query.mock.calls.some(
        (c) =>
          String(c[0]).startsWith("INSERT INTO flowproof_state") &&
          String(c[1]?.[0]).includes('"completed"'),
      ),
    ).toBe(false);
  });
  it("does not publish completion when the state INSERT fails after saving evidence", async () => {
    const store = await import("../server/store");
    await store.initStore();
    const complete = audit();
    await store.saveAudit({ ...complete, status: "queued", results: [] });
    mocks.query.mockClear().mockImplementation(async (sql: string) => {
      if (sql.startsWith("INSERT INTO flowproof_state"))
        throw new Error("state INSERT failed");
      return { rows: [] };
    });
    await expect(store.saveAudit(complete)).rejects.toThrow(
      "state INSERT failed",
    );
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        String(sql).startsWith("INSERT INTO flowproof_evidence"),
      ),
    ).toBe(true);
    expect(store.getAudit(complete.id)).toMatchObject({
      status: "queued",
      results: [],
    });
    await store.closeStore();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("bases concurrent project and audit writes on confirmed state after a failed completion", async () => {
    const store = await import("../server/store");
    await store.initStore();
    const complete = audit();
    await store.saveAudit({ ...complete, status: "running", results: [] });
    let rejectCompletion!: (cause: Error) => void;
    let signalAttempt!: () => void;
    const attempted = new Promise<void>((resolve) => {
      signalAttempt = resolve;
    });
    const successfulSnapshots: Snapshot[] = [];
    mocks.query.mockImplementation((sql: string, values?: unknown[]) => {
      if (!sql.startsWith("INSERT INTO flowproof_state"))
        return Promise.resolve({ rows: [] });
      const candidate = JSON.parse(String(values?.[0])) as Snapshot;
      if (
        candidate.audits.find((entry) => entry.id === complete.id)?.status ===
        "completed"
      ) {
        signalAttempt();
        return new Promise((_resolve, reject) => {
          rejectCompletion = reject;
        });
      }
      successfulSnapshots.push(candidate);
      return Promise.resolve({ rows: [] });
    });
    const completion = expect(store.saveAudit(complete)).rejects.toThrow(
      "completion persistence unavailable",
    );
    await attempted;
    expect(store.getAudit(complete.id)).toMatchObject({
      status: "running",
      results: [],
    });
    const unrelatedProject = project("p2");
    const unrelatedAudit: Audit = {
      ...audit(),
      id: "bbbbbbbb-2222",
      projectId: "p2",
      status: "queued",
      results: [],
    };
    const projectWrite = store.saveProject(unrelatedProject);
    const auditWrite = store.saveAudit(unrelatedAudit);
    // Each queued operation owns a call-time snapshot, independent of its caller.
    unrelatedProject.name = "Caller mutation after enqueue";
    unrelatedAudit.projectName = "Caller mutation after enqueue";
    expect(store.getProject("p2")).toBeUndefined();
    expect(store.getAudit(unrelatedAudit.id)).toBeUndefined();
    rejectCompletion(new Error("completion persistence unavailable"));
    await completion;
    await Promise.all([projectWrite, auditWrite]);
    expect(store.getAudit(complete.id)).toMatchObject({
      status: "running",
      results: [],
    });
    expect(store.getProject("p2")?.name).toBe("Confirmed project");
    expect(store.getAudit(unrelatedAudit.id)?.projectName).toBe("Fixture");
    expect(successfulSnapshots).toHaveLength(2);
    expect(
      successfulSnapshots.every(
        (candidate) =>
          candidate.audits.find((entry) => entry.id === complete.id)?.status ===
          "running",
      ),
    ).toBe(true);
    expect(successfulSnapshots[1].projects.map((entry) => entry.id)).toContain(
      "p2",
    );
    expect(successfulSnapshots[1].audits.map((entry) => entry.id)).toContain(
      unrelatedAudit.id,
    );
  });
  it("does not leak a rejected project edit into a later audit save", async () => {
    const store = await import("../server/store");
    await store.initStore();
    const original = project();
    await store.saveProject(original);
    mocks.query.mockImplementationOnce(async () => {
      throw new Error("project INSERT failed");
    });
    await expect(
      store.saveProject({ ...original, name: "Unconfirmed edit" }),
    ).rejects.toThrow("project INSERT failed");
    expect(store.getProject(original.id)).toEqual(original);
    mocks.query.mockClear();
    await store.saveAudit({ ...audit(), status: "queued", results: [] });
    const stateWrite = mocks.query.mock.calls.find(([sql]) =>
      String(sql).startsWith("INSERT INTO flowproof_state"),
    );
    const persisted = JSON.parse(String(stateWrite?.[1]?.[0])) as Snapshot;
    expect(persisted.projects).toEqual([original]);
    expect(persisted.audits).toHaveLength(1);
  });
});
