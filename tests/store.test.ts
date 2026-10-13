import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { Audit } from "../shared/types";
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
});
