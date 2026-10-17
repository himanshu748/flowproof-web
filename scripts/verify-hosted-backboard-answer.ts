import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";
import { databaseConfig } from "../server/database.js";
import { backboardAnswerConfiguration } from "../server/backboard-answer-gate.js";
import {
  BACKBOARD_MEMORY_RECORDED_SCOPE,
  validateBackboardMemoryAnswer,
} from "../server/providers/backboard-memory-answer.js";
import type { Audit, Bootstrap, Project } from "../shared/types.js";

if (process.argv.slice(2).join(" ") !== "--run")
  console.log(
    "Not run. --run requires a fresh dedicated grant and exact green hosted deployment. No default credential reads or external calls.",
  );
else await verify();
async function verify() {
  const root = path.resolve("work/backboard-answer-hosted-20261017");
  const expected = process.env.BRIEFSTAMP_EXPECTED_COMMIT;
  assert(/^[a-f0-9]{40}$/.test(expected ?? ""));
  const env = JSON.parse(
    await readFile(path.join(root, "active-render.private.json"), "utf8"),
  );
  const config = backboardAnswerConfiguration(env);
  assert(config);
  const dep = JSON.parse(
    await readFile(path.join(root, "deployment.json"), "utf8"),
  );
  assert(
    dep.status === "live" &&
      dep.sourceCommit === expected &&
      Date.now() - Date.parse(dep.verifiedAt) < 300000,
  );
  const stamp = new Date().toISOString(),
    directory = path.join(root, "runs", stamp.replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const state = {
    startedAt: stamp,
    trancheId: config.proof.trancheId,
    sourceCommit: expected,
    maxUnits: 2,
    maximumMemorySearches: 1,
    maximumModelCalls: 1,
    reservedExistingCreditUsd: 0.1,
    neverRefund: true,
    routeAttempted: false,
  };
  const reservation = path.join(root, "run-reservation.json");
  await writeFile(reservation, JSON.stringify(state, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const secrets = Object.entries(env)
    .filter(
      ([k, v]) =>
        /KEY|TOKEN|DATABASE_URL|DSN/.test(k) &&
        typeof v === "string" &&
        v.length > 8,
    )
    .map(([, v]) => v as string);
  const artifact = async (name: string, value: unknown) => {
    const text = JSON.stringify(value, null, 2) + "\n";
    for (const secret of secrets) assert(!text.includes(secret));
    await writeFile(path.join(directory, name), text, {
      flag: "wx",
      mode: 0o600,
    });
  };
  const sha = (v: Buffer | string) =>
    createHash("sha256").update(v).digest("hex");
  const old = JSON.parse(
    await readFile(path.join(root, "prior-reservation-hashes.json"), "utf8"),
  );
  for (const f of old) assert.equal(sha(await readFile(f.path)), f.sha256);
  const receipt: any = {
    startedAt: stamp,
    status: "running",
    sourceCommit: expected,
    scope:
      "Real protected hosted Backboard search followed by one Gemma answer from returned historical synthetic facts. Not new browser acceptance or a public judge run.",
    provider: "Backboard",
    modelProvider: "openrouter",
    model: config.proof.model,
    maxReservedUnits: 2,
    reservedExistingCreditUsd: 0.1,
    funding: "Existing mixed credit; not a free-only debit claim",
    automaticRetries: 0,
    publicJudgeSlotsConsumed: 0,
    approvalActor: "Owner-instructed synthetic verifier",
    calls: [],
  };
  const pool = new pg.Pool({
    ...databaseConfig(env.BRIEFSTAMP_TIGER_DATABASE_URL, {}),
    max: 1,
    idleTimeoutMillis: 1,
    statement_timeout: 5000,
  });
  const judgeCount = async () =>
    (
      await pool.query(
        "SELECT count(*)::integer AS spent FROM briefstamp_demo_v1.judge_agent_reservations",
      )
    ).rows[0].spent;
  const origin = "https://flowproof-demo.onrender.com";
  let cookie = "";
  async function request<T = any>(
    route: string,
    options: {
      body?: unknown;
      auth?: boolean;
      expected?: number;
      method?: string;
    } = {},
  ) {
    const r = await fetch(origin + route, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      redirect: "error",
      signal: AbortSignal.timeout(
        route.endsWith("/memory-answer") ? 75000 : 30000,
      ),
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(options.auth ? { "X-FlowProof-Token": env.FLOWPROOF_TOKEN } : {}),
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    receipt.calls.push({
      route,
      status: r.status,
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    });
    const bytes = Buffer.from(await r.arrayBuffer());
    assert(bytes.length < 512 * 1024);
    const value = JSON.parse(bytes.toString("utf8"));
    if (r.status !== (options.expected ?? 200)) {
      await artifact("unexpected-response.json", {
        route,
        status: r.status,
        response: value,
      });
      throw Error(`Hosted route HTTP ${r.status}`);
    }
    return {
      value: value as T,
      storage: r.headers.get("X-Briefstamp-Storage"),
    };
  }
  try {
    receipt.judgeSpentBefore = await judgeCount();
    assert.equal((await request("/health")).value.status, "ok");
    const boot = (await request<Bootstrap>("/api/bootstrap")).value;
    const sample = boot.projects.find((p) => p.target === "sample");
    assert(sample);
    const selected = (
      await request<Project>(`/api/projects/${sample.id}/variant`, {
        body: { sampleVariant: "broken" },
      })
    ).value;
    await request(`/api/projects/${sample.id}/audits`, {
      body: {},
      expected: 409,
    });
    await request(`/api/projects/${sample.id}/checks`, {
      method: "PUT",
      body: {
        checks: selected.checks.map((c) => ({
          ...c,
          approved: c.kind !== "manual",
        })),
      },
    });
    let audit = (
      await request<Audit>(`/api/projects/${sample.id}/audits`, {
        body: {},
        expected: 202,
      })
    ).value;
    for (let i = 0; i < 100 && audit.status !== "completed"; i++) {
      await pause(500);
      audit = (await request<Audit>(`/api/audits/${audit.id}`)).value;
      assert.notEqual(audit.status, "error");
    }
    assert.equal(audit.status, "completed");
    receipt.reservationAuditCounts = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((s) => [
        s,
        audit.results.filter((r) => r.status === s).length,
      ]),
    );
    assert.deepEqual(receipt.reservationAuditCounts, {
      passed: 2,
      failed: 3,
      blocked: 0,
      unverified: 1,
    });
    for (let i = 0; i < 30; i++) {
      const p = (await request(`/api/audits/${audit.id}/persistence`)).value;
      if (p.status === "saved") break;
      await pause(250);
    }
    const saved = await request<Audit>(`/api/audits/${audit.id}`);
    assert.equal(saved.storage, "tiger");
    assert(isDeepStrictEqual(saved.value, audit));
    await artifact("reservation-audit.json", audit);
    const route = `/api/audits/${audit.id}/memory-answer`;
    await request(route, { body: { modelConsent: true }, expected: 404 });
    await request(route, {
      body: { modelConsent: false },
      auth: true,
      expected: 400,
    });
    state.routeAttempted = true;
    await writeFile(reservation, JSON.stringify(state, null, 2) + "\n");
    const answer = (
      await request(route, { body: { modelConsent: true }, auth: true })
    ).value;
    await artifact("memory-answer.json", answer);
    assert.equal(answer.status, "completed");
    // Independently run the same published strict checker over retained model assertions and actual retrieved facts.
    validateBackboardMemoryAnswer(answer.modelAssertions, answer.facts);
    assert.equal(answer.facts.length, 6);
    assert.deepEqual(answer.scope, BACKBOARD_MEMORY_RECORDED_SCOPE);
    assert.equal(answer.attempts.length, 2);
    assert(answer.attempts.every((a: any) => a.status === 200));
    assert.equal(answer.reservationAuditUnchanged, true);
    assert.equal(answer.reservationAuditRoundTrip, "Tiger");
    await artifact("retrieved-facts.json", answer.facts);
    await artifact("citation-check.json", {
      checkedAt: new Date().toISOString(),
      valid: true,
      validator: "validateBackboardMemoryAnswer",
      modelAssertions: answer.modelAssertions,
      allClaimsMatchRetrievedFacts: true,
      allSixSupportingIdsMatch: true,
      repairClaim: "not_proven_by_retrieved_facts",
      notNewBrowserEvidence: true,
    });
    await request(route, {
      body: { modelConsent: true },
      auth: true,
      expected: 409,
    });
    const after = (await request<Audit>(`/api/audits/${audit.id}`)).value;
    assert(isDeepStrictEqual(after, audit));
    receipt.reservationAuditUnchanged = true;
    receipt.judgeSpentAfter = await judgeCount();
    assert.equal(receipt.judgeSpentAfter, receipt.judgeSpentBefore);
    const reserved = await pool.query(
      "SELECT count(*)::integer AS count FROM briefstamp_demo_v1.agent_reservations WHERE tranche_id=$1",
      [config.proof.trancheId],
    );
    assert.equal(reserved.rows[0].count, 1);
    receipt.durableDedicatedReservationRows = 1;
    for (const f of old) assert.equal(sha(await readFile(f.path)), f.sha256);
    receipt.priorFilesUnchanged = old.length;
    receipt.status = "completed";
    receipt.memoryFacts = answer.facts.length;
    receipt.modelClaims = answer.modelAssertions.claims.length;
    receipt.usage = answer.usage;
    receipt.answer = answer.answer;
    receipt.trancheId = config.proof.trancheId;
  } catch (error) {
    receipt.status = "failed";
    receipt.errorClass = error instanceof Error ? error.name : "Unknown";
    throw error;
  } finally {
    receipt.completedAt = new Date().toISOString();
    await artifact("receipt.json", receipt);
    await pool.end();
    console.log(
      JSON.stringify({
        status: receipt.status,
        directory,
        usage: receipt.usage,
        judgeSpentBefore: receipt.judgeSpentBefore,
        judgeSpentAfter: receipt.judgeSpentAfter,
      }),
    );
  }
}
