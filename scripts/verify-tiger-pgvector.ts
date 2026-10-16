import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createHostedTigerStore } from "../server/hosted-tiger.js";
import { databaseConfig } from "../server/database.js";
import { loadAgentRetrievalCatalog } from "../server/agent-retrieval-catalog.js";
import type { Audit, Bootstrap, Project } from "../shared/types.js";

if (process.argv.slice(2).join(" ") !== "--run") {
  console.log(
    "Not run. --run requires existing dedicated trial access and the exact green deployed source. No requests or credential reads.",
  );
} else await verify();
async function verify() {
  const accessFile = process.env.BRIEFSTAMP_HOSTED_ACCESS_FILE;
  const expected = process.env.BRIEFSTAMP_EXPECTED_COMMIT;
  assert(accessFile && /^[a-f0-9]{40}$/.test(expected ?? ""));
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    expected,
    "Verifier source must match deployed revision",
  );
  const sources = [
    "scripts/verify-tiger-pgvector.ts",
    "server/hosted-tiger.ts",
    "shared/agent-retrieval-vectors.json",
  ];
  assert.equal(
    execFileSync("git", ["status", "--porcelain", "--", ...sources], {
      encoding: "utf8",
    }).trim(),
    "",
    "Verification sources must be committed",
  );
  const env = JSON.parse(await readFile(accessFile, "utf8"));
  const startedAt = new Date().toISOString();
  const output = path.resolve(
    "work/tiger-pgvector",
    startedAt.replace(/[:.]/g, "-"),
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const save = (name: string, value: unknown) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  const receipt: any = {
    startedAt,
    status: "running",
    sourceCommit: expected,
    scope:
      "Fresh hosted synthetic Chromium audit and dedicated restricted-role pgvector/RRF retrieval; no model or search request",
    approvalActor: "Automated synthetic verification harness",
    providerCalls: 0,
    publicJudgeReservationsConsumed: 0,
  };
  const origin = "https://flowproof-demo.onrender.com";
  let cookie = "";
  const calls: any[] = [];
  const request = async (route: string, method = "GET", body?: unknown) => {
    assert(route.startsWith("/") && !route.startsWith("//"));
    const response = await fetch(origin + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    calls.push({ route, method, status: response.status });
    assert(response.ok, `Scoped hosted request failed: ${response.status}`);
    return response.json();
  };
  const pool = new pg.Pool({
    ...databaseConfig(env.BRIEFSTAMP_TIGER_DATABASE_URL, {}),
    max: 1,
    statement_timeout: 5000,
  });
  const store = createHostedTigerStore({ env });
  const originalQuery = pg.Pool.prototype.query;
  let captured: any;
  try {
    const deploymentFile = process.env.BRIEFSTAMP_DEPLOYMENT_PROOF_FILE;
    assert(deploymentFile, "A fresh Render readback is required");
    const deployment = JSON.parse(await readFile(deploymentFile, "utf8"));
    assert.equal(deployment.sourceCommit, expected);
    assert.equal(deployment.status, "live");
    assert.equal(deployment.plan, "free");
    assert(Date.now() - Date.parse(deployment.verifiedAt) < 300_000);
    receipt.deployment = deployment;
    const health = await request("/health");
    assert.equal(health.status, "ok");
    const before = (
      await pool.query(
        "SELECT count(*)::integer AS spent FROM briefstamp_demo_v1.judge_agent_reservations",
      )
    ).rows[0].spent;
    const boot: Bootstrap = await request("/api/bootstrap");
    const sample = boot.projects[0];
    assert(sample?.target === "sample");
    const project: Project = await request("/api/projects", "POST", {
      name: "pgvector retrieval verification",
      target: "sample",
      sampleVariant: "broken",
      authorized: true,
      brief: sample.brief,
    });
    const approved: Project = await request(
      `/api/projects/${project.id}/checks`,
      "PUT",
      { checks: project.checks.map((c) => ({ ...c, approved: true })) },
    );
    assert(approved.checks.every((c) => c.approved));
    const queued: Audit = await request(
      `/api/projects/${project.id}/audits`,
      "POST",
      {},
    );
    let audit: Audit = queued;
    const until = Date.now() + 100_000;
    while (Date.now() < until) {
      audit = await request(`/api/audits/${queued.id}`);
      if (audit.status === "completed" || audit.status === "error") break;
      await delay(1200);
    }
    assert.equal(audit.status, "completed");
    let persisted = false;
    while (Date.now() < until) {
      const state = await request(`/api/audits/${audit.id}/persistence`);
      if (state.status === "saved") {
        persisted = true;
        break;
      }
      assert.equal(state.status, "saving");
      await delay(1200);
    }
    assert(persisted, "Hosted persistence not confirmed");
    await save("source-audit.json", audit);
    const sessionKey = cookie.slice(cookie.indexOf("=") + 1);
    assert(/^[a-f0-9]{64}$/.test(sessionKey));
    const sessionHash = createHash("sha256").update(sessionKey).digest("hex");
    const indexed = await store.indexAuditFailures(sessionHash, audit.id);
    assert(indexed.matched > 0);
    receipt.indexing = indexed;
    (pg.Pool.prototype as any).query = async function (sql: any, values: any) {
      if (typeof sql === "string" && sql.startsWith("WITH candidates AS"))
        captured = {
          sql,
          queryText: values[2],
          queryVector: JSON.parse(values[3]),
          model: values[4],
          catalogSha256: values[6],
        };
      return (originalQuery as any).apply(this, arguments);
    };
    const rows = await store.searchFailuresHybrid(
      sessionHash,
      audit.projectId,
      "mobile_paraphrase",
    );
    assert.equal(
      rows.length,
      indexed.matched,
      "Retrieval must return every indexed check from the fresh one-audit project",
    );
    assert(
      rows.length > 0 &&
        rows.every(
          (row) =>
            row.auditId === audit.id && row.projectId === audit.projectId,
        ),
      "Retrieved evidence must match the source audit",
    );
    (pg.Pool.prototype as any).query = originalQuery;
    assert(
      captured &&
        captured.sql.includes("OPERATOR(public.<=>)") &&
        !captured.sql.includes("unnest(e.embedding"),
    );
    await save("hybrid-query.json", captured);
    await save("hybrid-results.json", rows);
    const stored = (
      await pool.query(
        'SELECT check_id AS "checkId",embedding_vector::text AS vector FROM briefstamp_demo_v1.failure_embeddings WHERE session_hash=$1 AND audit_id=$2 ORDER BY check_id',
        [sessionHash, audit.id],
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.checkId).sort(),
      stored.map((row) => row.checkId).sort(),
      "Retrieved check IDs must equal stored embedding IDs",
    );
    const catalog = await loadAgentRetrievalCatalog();
    const query = catalog.queries.find((q) => q.id === "mobile_paraphrase")!;
    const cosine = (a: number[], b: number[]) =>
      a.reduce((s, x, i) => s + x * b[i], 0) /
      Math.sqrt(
        a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0),
      );
    const independent = rows.map((row) => {
      const vector = JSON.parse(
        stored.find((v) => v.checkId === row.checkId).vector,
      );
      const calculated = cosine(vector, query.vector.map(Math.fround));
      const document = catalog.documents.find(
        (d) => d.textSha256 === row.textSha256,
      )!;
      const oldDot = document.vector.reduce(
        (s, x, i) => s + x * query.vector[i],
        0,
      );
      const error = Math.abs(row.cosine - calculated);
      assert(error < 0.000001);
      return {
        checkId: row.checkId,
        kind: row.kind,
        rank: row.vectorRank,
        sqlCosine: row.cosine,
        independentCosine: calculated,
        absoluteError: error,
        previousArrayDotProduct: oldDot,
        scoreDelta: row.cosine - oldDot,
        rrf: row.rrf,
        lexicalScore: row.lexicalScore,
      };
    });
    await save("independent-cosine.json", {
      method:
        "Independent JavaScript true cosine over stored pgvector values and float32 query; no SQL operator reuse",
      rows: independent,
    });
    assert.deepEqual(
      await store.searchFailuresHybrid(
        createHash("sha256").update(randomBytes(32)).digest("hex"),
        audit.projectId,
        "mobile_paraphrase",
      ),
      [],
    );
    const after = (
      await pool.query(
        "SELECT count(*)::integer AS spent FROM briefstamp_demo_v1.judge_agent_reservations",
      )
    ).rows[0].spent;
    assert.equal(after, before);
    receipt.status = "verified";
    receipt.completedAt = new Date().toISOString();
    receipt.results = independent;
    receipt.auditCounts = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((s) => [
        s,
        audit.results.filter((r) => r.status === s).length,
      ]),
    );
    receipt.publicJudgeSpentBefore = before;
    receipt.publicJudgeSpentAfter = after;
    receipt.crossSessionQueryEmpty = true;
    receipt.calls = calls;
  } catch (e) {
    receipt.status = "failed";
    receipt.failure = {
      name: e instanceof Error ? e.name : "unknown",
      message: e instanceof Error ? e.message : "unknown",
    };
    throw e;
  } finally {
    (pg.Pool.prototype as any).query = originalQuery;
    await store.close();
    await pool.end();
    await save("receipt.json", receipt);
    console.log(
      JSON.stringify({
        status: receipt.status,
        output,
        results: receipt.results,
      }),
    );
  }
}
