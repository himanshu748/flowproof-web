import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";
import { databaseConfig } from "../server/database.js";
import { mastraOperatorConfiguration } from "../server/mastra-agent-gate.js";
import { validateCitations, validatedAudit } from "../server/evidence-agent.js";
import type { Audit, Project, Bootstrap } from "../shared/types.js";
if (process.argv.slice(2).join(" ") !== "--run")
  console.log(
    "Not run. --run needs one prepared operator tranche and an exact green live deployment; no default credential reads, model requests or search.",
  );
else await verify();
async function verify() {
  const root = path.resolve("work/mastra-hosted-20261017");
  const expected = process.env.BRIEFSTAMP_EXPECTED_COMMIT;
  assert(/^[a-f0-9]{40}$/.test(expected ?? ""));
  const env = JSON.parse(
    await readFile(path.join(root, "active-render.private.json"), "utf8"),
  );
  const config = mastraOperatorConfiguration(env);
  assert(
    config && config.proof.usedRuns === 0,
    "Fresh new operator allowance required",
  );
  const deployment = JSON.parse(
    await readFile(path.join(root, "deployment.json"), "utf8"),
  );
  assert(
    deployment.status === "live" &&
      deployment.sourceCommit === expected &&
      Date.now() - Date.parse(deployment.verifiedAt) < 300000,
  );
  const stamp = new Date().toISOString();
  const directory = path.join(root, "runs", stamp.replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const state: any = {
    startedAt: stamp,
    trancheId: config.proof.trancheId,
    sourceCommit: expected,
    maximumUnits: 4,
    maximumModelCalls: 2,
    maximumSearchCalls: 1,
    maximumTigerToolCalls: 1,
    neverRefund: true,
    routeAttempted: false,
  };
  const reservationFile = path.join(root, "run-reservation.json");
  await writeFile(reservationFile, JSON.stringify(state, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const secrets = Object.entries(env)
    .filter(
      ([k, v]) =>
        /KEY|TOKEN|DATABASE_URL|DSN/.test(k) &&
        typeof v === "string" &&
        (v as string).length > 8,
    )
    .map(([, v]) => v as string);
  const artifact = async (name: string, value: unknown) => {
    let text = JSON.stringify(value, null, 2) + "\n";
    for (const secret of secrets)
      assert(
        !text.includes(secret),
        "A private credential cannot enter evidence",
      );
    await writeFile(path.join(directory, name), text, {
      flag: "wx",
      mode: 0o600,
    });
  };
  const hash = (x: Buffer | string) =>
    createHash("sha256").update(x).digest("hex");
  const previous = JSON.parse(
    await readFile(path.join(root, "prior-reservation-hashes.json"), "utf8"),
  );
  for (const f of previous)
    assert.equal(hash(await readFile(f.path)), f.sha256);
  const receipt: any = {
    startedAt: stamp,
    sourceCommit: expected,
    status: "running",
    scope:
      "Real hosted Mastra Agent over native Google Gemma text JSON; parent performs fixed Tiger pgvector RRF and SerpApi tools, not provider-native function calling",
    approvalActor:
      "Owner-instructed synthetic verifier, not customer acceptance",
    maximumReservedUnits: 4,
    publicJudgeAllowanceConsumed: 0,
    automaticRetries: 0,
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
    const response = await fetch(origin + route, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      redirect: "error",
      signal: AbortSignal.timeout(
        route.endsWith("/agent-review") ? 100000 : 30000,
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
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    receipt.calls.push({
      route,
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      status: response.status,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.length < 512 * 1024);
    const value = JSON.parse(bytes.toString("utf8"));
    if (response.status !== (options.expected ?? 200)) {
      await artifact("unexpected-response.json", {
        route,
        status: response.status,
        response: value,
      });
      throw Error(`Hosted route returned ${response.status}`);
    }
    return {
      value: value as T,
      storage: response.headers.get("X-Briefstamp-Storage"),
    };
  }
  try {
    receipt.judgeSpentBefore = await judgeCount();
    assert.equal((await request("/health")).value.status, "ok");
    const boot = (await request<Bootstrap>("/api/bootstrap")).value;
    const sample = boot.projects.find((p) => p.target === "sample");
    assert(sample);
    assert.equal(
      (await request("/api/operator/status", { auth: true })).value
        .evidenceAgent,
      true,
    );
    const website = (
      await request<Project>("/api/projects/preset", {
        body: { preset: "briefstamp-live" },
        expected: 201,
      })
    ).value;
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
    receipt.browserCounts = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((s) => [
        s,
        audit.results.filter((r) => r.status === s).length,
      ]),
    );
    assert.deepEqual(receipt.browserCounts, {
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
    const stored = await request<Audit>(`/api/audits/${audit.id}`);
    assert.equal(stored.storage, "tiger");
    assert(isDeepStrictEqual(stored.value, audit));
    await artifact("source-audit.json", audit);
    const body = { websiteProjectId: website.id, modelConsent: true };
    const route = `/api/audits/${audit.id}/agent-review`;
    await request(route, { body, expected: 404 });
    await request(route, {
      body: { ...body, modelConsent: false },
      auth: true,
      expected: 400,
    });
    state.routeAttempted = true;
    await writeFile(reservationFile, JSON.stringify(state, null, 2) + "\n");
    const agent = (await request(route, { body, auth: true })).value;
    await artifact("agent-run.json", agent);
    assert.equal(agent.status, "completed");
    assert.equal(agent.orchestration?.provider, "Mastra Agent");
    assert.equal(agent.orchestration.modelCalls, 2);
    assert.equal(agent.orchestration.steps.length, 2);
    assert.equal(agent.modelTurns.length, 2);
    assert.equal(agent.toolCalls.length, 2);
    assert(agent.toolCalls.every((t: any) => t.status === "observed"));
    assert(
      agent.modelTurns.every(
        (t: any) =>
          t.result?.attempts?.length === 1 &&
          t.result.attempts[0].status === 200,
      ),
    );
    const history = agent.toolReceipts.find(
      (x: any) => x.tool === "failure_history",
    )?.result;
    const search = agent.toolReceipts.find(
      (x: any) => x.tool === "search_visibility",
    )?.result;
    assert(history?.length > 0 && search);
    validateCitations(
      agent.modelOutput,
      validatedAudit(audit),
      agent.observations,
    );
    assert(
      agent.modelOutput.findings.some(
        (f: any) => f.type === "historical_failure",
      ),
    );
    assert(
      agent.modelOutput.findings.some((f: any) => f.type === "search_snapshot"),
    );
    const after = (await request<Audit>(`/api/audits/${audit.id}`)).value;
    assert(isDeepStrictEqual(after, audit));
    receipt.auditUnchanged = true;
    const saved = (
      await pool.query(
        "SELECT payload FROM briefstamp_demo_v1.audits WHERE audit_id=$1",
        [audit.id],
      )
    ).rows;
    assert.equal(saved.length, 1);
    assert(isDeepStrictEqual(saved[0].payload, audit));
    receipt.independentTigerRoundTrip = true;
    const reservations = (
      await pool.query(
        "SELECT count(*)::integer AS count FROM briefstamp_demo_v1.agent_reservations WHERE tranche_id=$1",
        [config.proof.trancheId],
      )
    ).rows[0].count;
    assert.equal(reservations, 1);
    receipt.operatorDurableReservations = reservations;
    receipt.judgeSpentAfter = await judgeCount();
    assert.equal(receipt.judgeSpentAfter, receipt.judgeSpentBefore);
    for (const f of previous)
      assert.equal(hash(await readFile(f.path)), f.sha256);
    receipt.oldFilesUnchanged = previous.length;
    await request(route, { body, auth: true, expected: 409 });
    const publicStatus = (await request("/api/judge-agent/status")).value;
    assert.equal(publicStatus.engine, "mastra_agent");
    receipt.publicRoute = {
      engine: publicStatus.engine,
      budget: publicStatus.budget,
      readOnlyStatus: true,
    };
    const mobile = audit.results.find(
      (r) => r.kind === "no_horizontal_overflow",
    )!;
    assert(mobile.evidence.screenshot?.startsWith("/evidence/"));
    const response = await fetch(origin + mobile.evidence.screenshot, {
      headers: { cookie },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, 200);
    const image = Buffer.from(await response.arrayBuffer());
    assert(
      image.length < 2 * 1024 * 1024 &&
        image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    );
    await writeFile(path.join(directory, "mobile-failure.png"), image, {
      flag: "wx",
      mode: 0o600,
    });
    receipt.modelRequests = agent.modelTurns.map((t: any) => ({
      phase: t.phase,
      attempts: t.result.attempts,
    }));
    receipt.toolsChosen = agent.selection.tools;
    receipt.citedFindings = agent.modelOutput.findings;
    receipt.sdk = agent.orchestration;
    receipt.screenshot = {
      file: "mobile-failure.png",
      bytes: image.length,
      sha256: hash(image),
    };
    const accountUrl = new URL("https://serpapi.com/account.json");
    accountUrl.searchParams.set("api_key", env.SERPAPI_API_KEY);
    const accountResponse = await fetch(accountUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    assert(accountResponse.ok);
    const account = await accountResponse.json();
    assert(
      account.plan_name === "Free Plan" &&
        account.account_status === "Active" &&
        account.plan_monthly_price === 0 &&
        account.extra_credits === 0,
    );
    receipt.postAccount = {
      checkedAt: new Date().toISOString(),
      plan: account.plan_name,
      monthlyPrice: account.plan_monthly_price,
      extraCredits: account.extra_credits,
      remainingSearches: account.total_searches_left,
    };
    receipt.status = "verified";
  } catch (error) {
    receipt.status = "failed";
    receipt.failure = {
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : "unknown",
    };
    throw error;
  } finally {
    await pool.end();
    receipt.completedAt = new Date().toISOString();
    await artifact("receipt.json", receipt);
    state.status = "consumed_no_refund";
    state.receipt = path.join(directory, "receipt.json");
    await writeFile(reservationFile, JSON.stringify(state, null, 2) + "\n");
    console.log(
      JSON.stringify({
        directory,
        status: receipt.status,
        counts: receipt.browserCounts,
        oldFilesUnchanged: receipt.oldFilesUnchanged,
        judgeSpentBefore: receipt.judgeSpentBefore,
        judgeSpentAfter: receipt.judgeSpentAfter,
      }),
    );
  }
}
