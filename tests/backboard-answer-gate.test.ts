import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeBackboardAnswer,
  backboardAnswerConfiguration,
  priorBackboardAnswerProofHashes,
  reserveBackboardAnswerCall,
  reserveBackboardAnswerRun,
} from "../server/backboard-answer-gate";
import type { BackboardMemoryReservationRequest } from "../server/providers/backboard-memory-answer";
import { BACKBOARD_MEMORY_RECORDED_SCOPE } from "../server/providers/backboard-memory-answer";
const NOW = Date.parse("2026-10-17T05:00:00Z");
const PROOF = "BRIEFSTAMP_BACKBOARD_ANSWER_PROOF_JSON";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const dirs: string[] = [];
async function envFixture() {
  const env: NodeJS.ProcessEnv = {
    BRIEFSTAMP_BACKBOARD_ANSWER_ENABLED: "true",
    BACKBOARD_API_KEY: ["synthetic", "not", "real", "credential"].join("-"),
    BACKBOARD_ASSISTANT_ID: randomUUID(),
    FLOWPROOF_TOKEN: [
      "synthetic",
      "operator",
      "not",
      "real",
      "long",
      "enough",
    ].join("-"),
    BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON: JSON.stringify({
      trancheId: randomUUID(),
      usedRuns: 1,
    }),
    BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON: '{ "usedRuns":4,"maximumRuns":100 }',
    OPAQUE_PROOF_JSON: "opaque spent bytes remain preserved",
  };
  env.FLOWPROOF_DATA_DIR = await mkdtemp(
    path.join(tmpdir(), "backboard-answer-gate-"),
  );
  dirs.push(env.FLOWPROOF_DATA_DIR);
  env[PROOF] = JSON.stringify({
    trancheId: randomUUID(),
    checkedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 3600000).toISOString(),
    credentialSha256: sha(env.BACKBOARD_API_KEY!),
    assistantIdSha256: sha(env.BACKBOARD_ASSISTANT_ID!),
    ...BACKBOARD_MEMORY_RECORDED_SCOPE,
    confirmedFreeCreditsUsd: 4,
    confirmedTotalCreditsUsd: 8,
    existingCreditsApproved: true,
    freeOnly: false,
    autoReloadEnabled: false,
    paymentMethodConfigured: false,
    reservedExistingCreditUsd: 0.1,
    modelProvider: "openrouter",
    model: "google/gemma-4-26b-a4b-it",
    inputUsdPerMillion: 0.0765,
    outputUsdPerMillion: 0.255,
    contextWindowTokens: 262144,
    maximumOutputTokens: 235929,
    maximumRuns: 1,
    usedRuns: 0,
    maxMemorySearches: 1,
    maxModelCalls: 1,
    maxUnits: 2,
    priorProofHashes: priorBackboardAnswerProofHashes(env),
    evidence: "Offline test fixture, not account evidence",
  });
  return env;
}
function change(env: NodeJS.ProcessEnv, patch: Record<string, unknown>) {
  env[PROOF] = JSON.stringify({ ...JSON.parse(env[PROOF]!), ...patch });
}
function metadata(
  env: NodeJS.ProcessEnv,
  operation: "memory_search" | "answer" = "memory_search",
): BackboardMemoryReservationRequest {
  return {
    operation,
    provider: "Backboard",
    endpoint:
      operation === "answer"
        ? "https://app.backboard.io/api/threads/messages"
        : `https://app.backboard.io/api/assistants/${env.BACKBOARD_ASSISTANT_ID}/memories/search`,
    freshThread: operation === "answer",
    modelProvider: operation === "answer" ? "openrouter" : null,
    model: operation === "answer" ? "google/gemma-4-26b-a4b-it" : null,
    retrievedContentSha256: operation === "answer" ? "b".repeat(64) : null,
    factIds:
      operation === "answer"
        ? Array.from({ length: 6 }, (_, i) => `app-fact-${sha(`fact ${i}`)}`)
        : [],
    assistantId: env.BACKBOARD_ASSISTANT_ID!,
    credentialSha256: sha(env.BACKBOARD_API_KEY!),
    requestBytes: 300,
    requestSha256: sha(`synthetic ${operation}`),
    ...BACKBOARD_MEMORY_RECORDED_SCOPE,
  };
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("dedicated Backboard answer grant (offline)", () => {
  it("authenticates only the configured operator and preserves opaque old bytes", async () => {
    const env = await envFixture();
    expect(backboardAnswerConfiguration(env, NOW)).not.toBeNull();
    expect(
      authorizeBackboardAnswer(
        { "x-flowproof-token": env.FLOWPROOF_TOKEN },
        env,
        NOW,
      ),
    ).toBe(true);
    expect(authorizeBackboardAnswer({}, env, NOW)).toBe(false);
    expect(
      authorizeBackboardAnswer(
        new Headers({ "X-FlowProof-Token": "bad" }),
        env,
        NOW,
      ),
    ).toBe(false);
    env.OPAQUE_PROOF_JSON += " ";
    expect(backboardAnswerConfiguration(env, NOW)).toBeNull();
  });
  it.each([
    { usedRuns: 1 },
    { existingCreditsApproved: false },
    { freeOnly: true },
    { autoReloadEnabled: true },
    { paymentMethodConfigured: true },
    { maxUnits: 4 },
    { maxModelCalls: 2 },
    { reservedExistingCreditUsd: 0.2 },
    { modelProvider: "google" },
    { projectScope: "f".repeat(64) },
    { auditScope: "f".repeat(64) },
    { expectedFactsSha256: "f".repeat(64) },
    { credentialSha256: "f".repeat(64) },
    { assistantIdSha256: "f".repeat(64) },
    { checkedAt: new Date(NOW + 1).toISOString() },
    { expiresAt: new Date(NOW).toISOString() },
    { expiresAt: "2026-10-21T00:00:00Z" },
    { confirmedTotalCreditsUsd: 0.1 },
    { priorProofHashes: {} },
  ])("rejects unsafe proof %j", async (patch) => {
    const env = await envFixture();
    change(env, patch);
    expect(backboardAnswerConfiguration(env, NOW)).toBeNull();
  });
  it("refuses to reuse a preceding tranche, even with a fresh timestamp", async () => {
    const env = await envFixture();
    change(env, {
      trancheId: JSON.parse(env.BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON!)
        .trancheId,
    });
    expect(backboardAnswerConfiguration(env, NOW)).toBeNull();
  });
  it("requires confirmed durable reservation, then consumes each operation exactly once", async () => {
    const env = await envFixture(),
      before = env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON;
    await expect(
      reserveBackboardAnswerCall(metadata(env), env, NOW),
    ).rejects.toThrow();
    const durable = vi.fn(async () => ({ reserved: true }));
    expect(await reserveBackboardAnswerRun(durable, env, NOW)).toEqual({
      reserved: true,
    });
    expect(await reserveBackboardAnswerRun(durable, env, NOW)).toEqual({
      reserved: false,
    });
    expect(durable).toHaveBeenCalledTimes(1);
    await expect(
      reserveBackboardAnswerCall(metadata(env, "answer"), env, NOW),
    ).rejects.toThrow();
    await reserveBackboardAnswerCall(metadata(env), env, NOW);
    await expect(
      reserveBackboardAnswerCall(metadata(env), env, NOW),
    ).rejects.toThrow();
    await reserveBackboardAnswerCall(metadata(env, "answer"), env, NOW);
    await expect(
      reserveBackboardAnswerCall(metadata(env, "answer"), env, NOW),
    ).rejects.toThrow();
    expect(env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON).toBe(before);
    const files = await readdir(
      path.join(env.FLOWPROOF_DATA_DIR!, "provider-allowances"),
    );
    expect(files).toHaveLength(4);
    const recorded = JSON.parse(
      await readFile(
        path.join(
          env.FLOWPROOF_DATA_DIR!,
          "provider-allowances",
          files.find((f) => f.endsWith("answer.reservation.json"))!,
        ),
        "utf8",
      ),
    );
    expect(recorded.neverRefund).toBe(true);
    expect(recorded.units).toBe(1);
  });
  it.each([false, "throw"])(
    "never dispatches after ambiguous/declined durable reservation %s",
    async (mode) => {
      const env = await envFixture();
      const fn = async () => {
        if (mode === "throw") throw new Error("Unknown database completion");
        return { reserved: false };
      };
      if (mode === "throw")
        await expect(reserveBackboardAnswerRun(fn, env, NOW)).rejects.toThrow();
      else
        expect(await reserveBackboardAnswerRun(fn, env, NOW)).toEqual({
          reserved: false,
        });
      await expect(
        reserveBackboardAnswerCall(metadata(env), env, NOW),
      ).rejects.toThrow();
      expect(
        await reserveBackboardAnswerRun(
          async () => ({ reserved: true }),
          env,
          NOW,
        ),
      ).toEqual({ reserved: false });
    },
  );
  it("fails closed after a restart with a replaced disk if Tiger already holds the tranche", async () => {
    const env = await envFixture();
    await reserveBackboardAnswerRun(async () => ({ reserved: true }), env, NOW);
    const reset = {
      ...env,
      FLOWPROOF_DATA_DIR: await mkdtemp(
        path.join(tmpdir(), "backboard-answer-restart-"),
      ),
    };
    dirs.push(reset.FLOWPROOF_DATA_DIR!);
    expect(
      await reserveBackboardAnswerRun(
        async () => ({ reserved: false }),
        reset,
        NOW,
      ),
    ).toEqual({ reserved: false });
    await expect(
      reserveBackboardAnswerCall(metadata(reset), reset, NOW),
    ).rejects.toThrow();
  });
  it("rejects changed exact request bindings before transport", async () => {
    const env = await envFixture();
    await reserveBackboardAnswerRun(async () => ({ reserved: true }), env, NOW);
    await expect(
      reserveBackboardAnswerCall(
        { ...metadata(env), expectedFactsSha256: "f".repeat(64) },
        env,
        NOW,
      ),
    ).rejects.toThrow();
    await expect(
      reserveBackboardAnswerCall(
        { ...metadata(env), requestBytes: 100000 },
        env,
        NOW,
      ),
    ).rejects.toThrow();
    await reserveBackboardAnswerCall(metadata(env), env, NOW);
    env.OPAQUE_PROOF_JSON += "changed";
    await expect(
      reserveBackboardAnswerCall(metadata(env, "answer"), env, NOW),
    ).rejects.toThrow();
  });
});
