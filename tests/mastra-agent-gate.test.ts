import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  mastraOperatorConfiguration,
  authorizeMastraOperator,
  priorMastraProofHashes,
  reserveMastraOperatorCall,
  mastraSearchOptions,
} from "../server/mastra-agent-gate.js";
const now = Date.parse("2026-10-17T03:30:00Z");
const dirs: string[] = [];
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function env() {
  const e: NodeJS.ProcessEnv = {
    BRIEFSTAMP_MASTRA_AGENT_ENABLED: "true",
    SERPAPI_API_KEY: ["test", "not", "credential"].join("-"),
    GOOGLE_GEMMA_API_KEY: ["test", "gemma", "not", "credential"].join("-"),
    FLOWPROOF_TOKEN: [
      "synthetic",
      "operator",
      "approval",
      "token",
      "notreal",
    ].join("-"),
    BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON: JSON.stringify({ usedRuns: 1 }),
    BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON: JSON.stringify({
      usedRuns: 4,
      maximum: 100,
    }),
  };
  e.BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON = JSON.stringify({
    trancheId: randomUUID(),
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    credentialSha256: hash(e.SERPAPI_API_KEY!),
    modelCredentialSha256: hash(e.GOOGLE_GEMMA_API_KEY!),
    confirmedFreeSearches: 200,
    freeOnly: true,
    paidOverageDisabled: true,
    maxModelCalls: 2,
    maxSearchCalls: 1,
    maxTigerCalls: 1,
    maxUnits: 4,
    maximumRuns: 1,
    usedRuns: 0,
    priorProofHashes: priorMastraProofHashes(e),
    evidence: "Synthetic offline funding proof, not an account observation",
  });
  return e;
}
const change = (e: NodeJS.ProcessEnv, k: string, v: unknown) => {
  const p = JSON.parse(e.BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON!);
  p[k] = v;
  e.BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON = JSON.stringify(p);
};
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
describe("Separate bounded Mastra operator allowance", () => {
  it("binds both keys and all unchanged spent proofs", () => {
    const e = env();
    expect(mastraOperatorConfiguration(e, now)?.proof.maxUnits).toBe(4);
    e.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON = "changed";
    expect(mastraOperatorConfiguration(e, now)).toBeNull();
  });
  it.each(["SERPAPI_API_KEY", "GOOGLE_GEMMA_API_KEY"])(
    "rejects changed %s",
    (key) => {
      const e = env();
      e[key] = "changed";
      expect(mastraOperatorConfiguration(e, now)).toBeNull();
    },
  );
  it.each([
    ["maxUnits", 5],
    ["maxModelCalls", 3],
    ["maxSearchCalls", 2],
    ["maxTigerCalls", 2],
    ["maximumRuns", 2],
    ["usedRuns", 1],
    ["confirmedFreeSearches", 96],
    ["freeOnly", false],
    ["paidOverageDisabled", false],
    ["extra", "not allowed"],
    ["checkedAt", new Date(now + 1).toISOString()],
    ["expiresAt", new Date(now - 1).toISOString()],
    ["expiresAt", "2026-10-20T00:00:01Z"],
  ])("rejects unsafe %s=%s", (key, value) => {
    const e = env();
    change(e, key as string, value);
    expect(mastraOperatorConfiguration(e, now)).toBeNull();
  });
  it("requires existing operator token before exposing the proof", () => {
    const e = env();
    expect(
      authorizeMastraOperator(
        { "x-flowproof-token": e.FLOWPROOF_TOKEN },
        e,
        now,
      ),
    ).toBe(true);
    expect(authorizeMastraOperator({}, e, now)).toBe(false);
    expect(
      authorizeMastraOperator({ "x-flowproof-token": "incorrect" }, e, now),
    ).toBe(false);
  });
  it("atomically consumes each operation once, never refunding", async () => {
    const e = env();
    const d = await mkdtemp(path.join(tmpdir(), "mastra-proof-"));
    dirs.push(d);
    e.FLOWPROOF_DATA_DIR = d;
    for (const op of [
      "select_tools",
      "failure_history",
      "search_visibility",
      "summarize",
    ] as const) {
      await reserveMastraOperatorCall(op, e, now);
      await expect(reserveMastraOperatorCall(op, e, now)).rejects.toThrow();
    }
  });
  it("never rewrites a spent search ledger", async () => {
    const e = env();
    const d = await mkdtemp(path.join(tmpdir(), "mastra-proof-"));
    dirs.push(d);
    e.FLOWPROOF_DATA_DIR = d;
    const headers = { "x-flowproof-token": e.FLOWPROOF_TOKEN };
    const a = await mastraSearchOptions(headers, { env: e, now: () => now });
    const f = a.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    const before = await readFile(f);
    await expect(
      mastraSearchOptions(headers, { env: e, now: () => now }),
    ).rejects.toThrow();
    expect(await readFile(f)).toEqual(before);
  });
});
