import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostedPhaseCache } from "../temporal/hosted-activities.js";

describe("hosted Temporal provider call cache", () => {
  it("reuses a completed provider response after a lost activity completion", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "briefstamp-hosted-cache-"),
    );
    let calls = 0;
    const first = createHostedPhaseCache(root);
    expect(
      await first(
        "select",
        { reservationId: "one", source: "audit" },
        async () => ({ value: ++calls }),
      ),
    ).toEqual({ value: 1 });
    const afterWorkerRestart = createHostedPhaseCache(root);
    expect(
      await afterWorkerRestart(
        "select",
        { reservationId: "one", source: "audit" },
        async () => ({ value: ++calls }),
      ),
    ).toEqual({ value: 1 });
    expect(calls).toBe(1);
    expect(
      JSON.parse(
        await readFile(path.join(root, "select.completed.json"), "utf8"),
      ).sha256,
    ).toMatch(/^[a-f0-9]{64}$/);
  });
  it("refuses an ambiguous prior dispatch instead of repeating it", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "briefstamp-hosted-ambiguous-"),
    );
    let calls = 0;
    const cache = createHostedPhaseCache(root);
    await expect(
      cache("search", { reservation: "one" }, async () => {
        calls++;
        throw new Error("connection lost");
      }),
    ).rejects.toThrow("connection lost");
    await expect(
      createHostedPhaseCache(root)(
        "search",
        { reservation: "one" },
        async () => {
          calls++;
          return {};
        },
      ),
    ).rejects.toMatchObject({
      type: "HostedEvidenceAmbiguousCompletion",
      nonRetryable: true,
    });
    expect(calls).toBe(1);
  });
  it("rejects a completed response bound to a different reservation or input", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "briefstamp-hosted-binding-"),
    );
    const cache = createHostedPhaseCache(root);
    await cache(
      "tiger",
      { reservation: "one", queryId: "images" },
      async () => ({ rows: [] }),
    );
    await expect(
      cache("tiger", { reservation: "two", queryId: "images" }, async () => ({
        invented: true,
      })),
    ).rejects.toThrow("Invalid hosted cache");
  });
});
