import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Audit } from "../shared/types.js";
import {
  authorizeHostedBackboard,
  hostBackboardEnabled,
  hostedBackboardOptions,
  recallHostedMemory,
  rememberHostedAudit,
} from "../server/hosted-backboard.js";
import { optionalIntegrations } from "../server/optional-integrations.js";

const now = Date.parse("2026-10-15T10:00:00Z");
const key = "hosted-test-key-not-real";
const token = ["hosted-operator-test", "token-not-real-12345"].join("-");
const directories: string[] = [];
const audit: Audit = {
  id: "synthetic-audit",
  projectId: "synthetic-project",
  projectName: "Private excluded title",
  status: "completed",
  createdAt: "2026-10-15T09:00:00Z",
  completedAt: "2026-10-15T09:01:00Z",
  checks: [],
  source: {
    target: "sample",
    url: "https://example.invalid/",
    sampleVariant: "broken",
    brief: "Excluded brief",
    generator: { provider: "test", model: null },
  },
  results: [
    {
      checkId: "heading",
      requirement: "Excluded requirement",
      kind: "heading",
      status: "failed",
      expected: "Excluded heading",
      durationMs: 1,
      evidence: {
        observed: "Excluded DOM",
        url: "https://example.invalid/",
        viewport: { width: 100, height: 100 },
      },
    },
  ],
};

async function environment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-hosted-backboard-"),
  );
  directories.push(directory);
  const proof = {
    credentialSha256: createHash("sha256").update(key).digest("hex"),
    checkedAt: "2026-10-15T09:00:00Z",
    expiresAt: "2026-10-16T09:00:00Z",
    evidence: "Synthetic test proof, no live account or credit used",
    freeOnly: false,
    existingCreditOnly: true,
    existingCreditsApproved: true,
    autoReloadEnabled: false,
    paymentMethodConfigured: false,
    confirmedExistingCreditsUsd: 5,
    maxCreditSpendUsd: 0.03,
    usedCreditSpendUsd: 0,
    unit: "requests",
    operations: ["memory-write", "memory-search"],
    usedOperations: [],
    maxUnits: 2,
    usedUnits: 0,
    maxCalls: 2,
    usedCalls: 0,
  };
  return {
    FLOWPROOF_DATA_DIR: directory,
    FLOWPROOF_TOKEN: token,
    BACKBOARD_API_KEY: key,
    BACKBOARD_ASSISTANT_ID: "123e4567-e89b-42d3-a456-426614174000",
    BRIEFSTAMP_BACKBOARD_ENABLED: "true",
    BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED: "true",
    BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON: JSON.stringify(proof),
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("hosted Backboard operator boundary", () => {
  it("requires a configured proof and exact operator token without creating files", async () => {
    const env = await environment();
    expect(hostBackboardEnabled(env, now)).toBe(true);
    expect(authorizeHostedBackboard({}, env, now)).toBe(false);
    expect(
      authorizeHostedBackboard(
        { "x-flowproof-token": `${token}wrong` },
        env,
        now,
      ),
    ).toBe(false);
    expect(
      authorizeHostedBackboard(
        { "x-flowproof-token": [token, token] },
        env,
        now,
      ),
    ).toBe(false);
    expect(
      authorizeHostedBackboard({ "x-flowproof-token": token }, env, now),
    ).toBe(true);
    expect(
      authorizeHostedBackboard(
        new Headers({ "X-FlowProof-Token": token }),
        env,
        now,
      ),
    ).toBe(true);
    expect(
      authorizeHostedBackboard(
        { "x-flowproof-token": token },
        { ...env, FLOWPROOF_TOKEN: "short" },
        now,
      ),
    ).toBe(false);
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it.each([
    { autoReloadEnabled: true },
    { paymentMethodConfigured: true },
    { credentialSha256: "0".repeat(64) },
    { checkedAt: "2026-10-13T09:00:00Z" },
    { expiresAt: "2026-10-15T09:59:59Z" },
    { expiresAt: "2026-10-17T09:00:00Z" },
    { usedCalls: 1 },
    { usedCreditSpendUsd: 0.01 },
    { maxCreditSpendUsd: 0.04 },
  ])("rejects stale, reused or unsafe bootstrap proof %j", async (change) => {
    const env = await environment();
    env.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON = JSON.stringify({
      ...JSON.parse(env.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON!),
      ...change,
    });
    const fetcher = vi.fn();
    expect(hostBackboardEnabled(env, now)).toBe(false);
    await expect(
      rememberHostedAudit(audit, { env, now: () => now, fetcher }),
    ).rejects.toMatchObject({ code: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it("preserves reservations across helper reinitialization and never resets exhausted counters", async () => {
    const env = await environment();
    let stored = "";
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/search"))
        return Response.json({
          memories: [{ content: stored, score: 0.9 }],
          total_count: 1,
        });
      stored = JSON.parse(String(init?.body)).content;
      expect(stored).not.toMatch(/Private|Excluded|example.invalid/);
      return new Response(null, { status: 201 });
    });
    const firstOptions = await hostedBackboardOptions({
      env,
      now: () => now,
      fetcher,
    });
    await rememberHostedAudit(audit, { env, now: () => now, fetcher });
    const reserved = await readFile(
      firstOptions.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!,
      "utf8",
    );
    // Reordered environment JSON is the same proof, not a new spending allowance.
    env.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON = JSON.stringify(
      Object.fromEntries(
        Object.entries(
          JSON.parse(env.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON!),
        ).reverse(),
      ),
    );
    const restarted = await hostedBackboardOptions({
      env,
      now: () => now,
      fetcher,
    });
    expect(restarted.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE).toBe(
      firstOptions.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE,
    );
    expect(
      await readFile(
        restarted.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!,
        "utf8",
      ),
    ).toBe(reserved);
    const result = await recallHostedMemory(audit.projectId, "heading", {
      env,
      now: () => now,
      fetcher,
    });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].facts).toEqual([
      { kind: "heading", status: "failed" },
    ]);
    await expect(
      rememberHostedAudit(audit, { env, now: () => now, fetcher }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    const finalProof = JSON.parse(
      await readFile(
        restarted.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!,
        "utf8",
      ),
    ).providers.backboard;
    expect(finalProof).toMatchObject({
      freeOnly: false,
      usedCalls: 2,
      usedUnits: 2,
      usedCreditSpendUsd: 0.02,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not repair or overwrite an existing invalid ledger", async () => {
    const env = await environment(),
      fetcher = vi.fn();
    const options = await hostedBackboardOptions({
      env,
      now: () => now,
      fetcher,
    });
    await writeFile(
      options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!,
      "invalid-ledger",
    );
    await expect(
      rememberHostedAudit(audit, { env, now: () => now, fetcher }),
    ).rejects.toMatchObject({ code: "free_confirmation_required" });
    expect(
      await readFile(options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!, "utf8"),
    ).toBe("invalid-ledger");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("describes hosted availability without exposing operator configuration", async () => {
    const env = await environment();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const status = optionalIntegrations(true).find(
      (item) => item.name === "Backboard",
    );
    expect(status).toMatchObject({
      status: "available",
      detail: expect.stringContaining("Public visitors cannot call"),
    });
    expect(JSON.stringify(status)).not.toContain(key);
    expect(JSON.stringify(status)).not.toContain(token);
    vi.stubEnv("BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED", "false");
    expect(
      optionalIntegrations(true).find((item) => item.name === "Backboard")
        ?.status,
    ).toBe("not_configured");
  });
});
