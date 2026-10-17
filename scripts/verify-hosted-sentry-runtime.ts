import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { databaseConfig } from "../server/database.js";
import { sentryAgentConfiguration } from "../server/sentry-agent-gate.js";
import { runtimeTraceConfiguration } from "../server/runtime-trace-gate.js";
import {
  RuntimeTraceMeasurementSchema,
  RuntimeTraceReceiptSchema,
  runtimeTraceHash,
  type RuntimeTraceMeasurement,
} from "../server/runtime-trace.js";
import { validateCitations, validatedAudit } from "../server/evidence-agent.js";
import type { Audit, Bootstrap, Project } from "../shared/types.js";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
// Importing or invoking without --run reads no credentials and makes no request.
if (process.argv.slice(2).join(" ") !== "--run") {
  console.log(
    "Not run. --run requires a separately approved four-unit agent grant, two trace exports, and a fresh exact-green live deployment. No default credential reads or external calls.",
  );
} else await verify();

async function boundedBytes(response: Response, maximum: number) {
  assert(
    Number(response.headers.get("content-length") ?? 0) <= maximum,
    "Response exceeds evidence budget",
  );
  const reader = response.body?.getReader();
  assert(reader, "Response body unavailable");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      assert(size <= maximum, "Response exceeds evidence budget");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
function validateTrace(
  value: any,
  kind: "audit" | "agent",
): RuntimeTraceMeasurement {
  assert(
    value && value.sourceAuditUnchanged === true,
    "Trace source changed or export unavailable",
  );
  const receipt = RuntimeTraceReceiptSchema.parse(
    Object.fromEntries(
      Object.keys(RuntimeTraceReceiptSchema.shape).map((key) => [
        key,
        value[key],
      ]),
    ),
  );
  assert.equal(receipt.mode, "hosted_configured");
  assert.equal(receipt.flushed, true);
  assert.equal(receipt.ingestionVerified, false);
  const measurement = RuntimeTraceMeasurementSchema.parse(value.measurement);
  assert.equal(measurement.operation, `briefstamp.${kind}`);
  assert.equal(measurement.complete, true);
  assert.equal(measurement.status, "ok");
  assert.equal(runtimeTraceHash(measurement), receipt.measurementSha256);
  const expected =
    kind === "audit"
      ? ["briefstamp.audit.browser"]
      : [
          "briefstamp.agent.model.select_tools",
          "briefstamp.agent.tool.failure_history",
          "briefstamp.agent.tool.search_visibility",
          "briefstamp.agent.model.summarize",
        ];
  assert.deepEqual(
    measurement.spans.map((span) => span.operation).sort(),
    [...expected].sort(),
  );
  assert(
    measurement.spans.every(
      (span) => span.parentIndex === 0 && span.status === "ok",
    ),
  );
  assert.equal(value.observedSpanCount, expected.length + 1);
  return measurement;
}

async function verify() {
  const root = path.resolve("work/sentry-runtime-hosted-20261017");
  const expected = process.env.BRIEFSTAMP_EXPECTED_COMMIT;
  assert(
    /^[a-f0-9]{40}$/.test(expected ?? ""),
    "Exact expected commit required",
  );
  const env: NodeJS.ProcessEnv = JSON.parse(
    await readFile(path.join(root, "active-render.private.json"), "utf8"),
  );
  assert(
    typeof env.BRIEFSTAMP_TIGER_DATABASE_URL === "string",
    "Strict-TLS Tiger connection required",
  );
  const agentConfig = sentryAgentConfiguration(env);
  const traceConfig = runtimeTraceConfiguration(env);
  assert(
    agentConfig && agentConfig.proof.usedRuns === 0,
    "Fresh separately approved agent grant required",
  );
  assert(
    traceConfig && traceConfig.proof.usedExports === 0,
    "Fresh separately approved trace grant required",
  );
  const deployment = JSON.parse(
    await readFile(path.join(root, "deployment.json"), "utf8"),
  );
  const deploymentAge = Date.now() - Date.parse(deployment.verifiedAt);
  assert(
    deployment.status === "live" &&
      deployment.sourceCommit === expected &&
      deployment.plan === "free" &&
      deploymentAge >= 0 &&
      deploymentAge < 300_000,
    "Fresh exact live Free deployment required",
  );
  assert(
    deployment.ciConclusion === "success" &&
      deployment.ciHeadSha === expected &&
      /^https:\/\/github\.com\/himanshu748\/flowproof-web\/actions\/runs\/\d+$/.test(
        deployment.ciUrl,
      ),
    "Exact successful CI receipt required",
  );
  const previous: Array<{ path: string; sha256: string }> = JSON.parse(
    await readFile(path.join(root, "prior-reservation-hashes.json"), "utf8"),
  );
  assert.equal(
    previous.length,
    108,
    "All 108 historical allowance records must remain bound",
  );
  assert.equal(
    new Set(previous.map((file) => file.path)).size,
    previous.length,
  );
  const verifyPrior = async () => {
    for (const file of previous)
      assert.equal(
        hash(await readFile(file.path)),
        file.sha256,
        "Historical allowance bytes changed",
      );
    return previous.length;
  };
  await verifyPrior();
  const stamp = new Date().toISOString();
  const directory = path.join(root, "runs", stamp.replace(/[:.]/g, "-"));
  const reservationIds = [
    agentConfig.proof.trancheId,
    traceConfig.proof.auditReservationId,
    traceConfig.proof.agentReservationId,
  ];
  assert.equal(new Set(reservationIds).size, 3);
  const state: Record<string, unknown> = {
    startedAt: stamp,
    sourceCommit: expected,
    trancheId: agentConfig.proof.trancheId,
    traceGrantId: traceConfig.proof.grantId,
    reservationIds,
    maximumAgentUnits: 4,
    maximumModelCalls: 2,
    maximumSearchCalls: 1,
    maximumTigerToolCalls: 1,
    maximumTraceExports: 2,
    maximumEnvelopesPerExport: 2,
    reservedExistingCreditUsd: 0.2,
    mixedCreditApproved: true,
    routeAttempted: false,
    browserTraceAttempted: false,
    neverRefund: true,
  };
  const reservationFile = path.join(root, "run-reservation.json");
  const writeState = async (initial = false) => {
    const handle = await open(reservationFile, initial ? "wx" : "r+", 0o600);
    try {
      await handle.truncate(0);
      await handle.writeFile(JSON.stringify(state, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const directoryHandle = await open(root, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  };
  // The immutable existence of this file prevents a second verifier attempt,
  // including after timeout, unknown completion, malformed output or a crash.
  await writeState(true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        /KEY|TOKEN|DATABASE_URL|DSN/.test(key) &&
        typeof value === "string" &&
        value.length > 8,
    )
    .map(([, value]) => value!);
  const artifact = async (name: string, value: unknown) => {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    assert(
      Buffer.byteLength(bytes) <= 1_048_576,
      "Evidence artifact exceeds budget",
    );
    for (const secret of secrets)
      assert(
        !bytes.includes(secret),
        "Private credential cannot enter evidence",
      );
    await writeFile(path.join(directory, name), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  };
  const receipt: any = {
    startedAt: stamp,
    sourceCommit: expected,
    ciUrl: deployment.ciUrl,
    status: "running",
    scope:
      "Real hosted Chromium audit and real Mastra Agent over Backboard/OpenRouter Gemma; measured operation timestamps exported afterward through the actual Sentry SDK. Flush is not verified hosted ingestion.",
    approvalActor:
      "Owner-instructed synthetic verifier, not customer acceptance",
    maximumReservedAgentUnits: 4,
    maximumReservedTraceExports: 2,
    reservedExistingCreditUsd: 0.2,
    funding:
      "Owner-approved existing mixed credit, not a free-only debit claim",
    automaticRetries: 0,
    publicJudgeAllowanceConsumed: 0,
    calls: [],
    newDurableReservationIds: reservationIds,
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
  const readReservations = async () =>
    (
      await pool.query(
          'SELECT tranche_id AS "trancheId", count(*)::integer AS count FROM briefstamp_demo_v1.agent_reservations WHERE tranche_id = ANY($1::text[]) GROUP BY tranche_id ORDER BY tranche_id',
        [reservationIds],
      )
    ).rows;
  const origin = "https://flowproof-demo.onrender.com";
  let cookie = "";
  let unexpectedIndex = 0;
  const request = async <T = any>(
    route: string,
    options: {
      body?: unknown;
      auth?: boolean;
      expected?: number;
      method?: string;
    } = {},
  ) => {
    assert(
      /^\/(?:api|health)(?:\/|$)/.test(route) &&
        !route.includes("judge-review"),
      "Only fixed hosted proof routes permitted",
    );
    const method =
      options.method ?? (options.body === undefined ? "GET" : "POST");
    const response = await fetch(origin + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(
        route.endsWith("/agent-review") ? 120_000 : 30_000,
      ),
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(options.auth ? { "X-FlowProof-Token": env.FLOWPROOF_TOKEN! } : {}),
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const nextCookie = response.headers.get("set-cookie");
    if (nextCookie) cookie = nextCookie.split(";")[0];
    receipt.calls.push({ route, method, status: response.status });
    const bytes = await boundedBytes(response, 512 * 1024);
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      await artifact(`unexpected-body-${++unexpectedIndex}.json`, {
        route,
        status: response.status,
        bytes: bytes.length,
        sha256: hash(bytes),
        bodyStored: false,
      });
      throw new Error("Hosted response was not JSON");
    }
    if (response.status !== (options.expected ?? 200)) {
      await artifact(`unexpected-response-${++unexpectedIndex}.json`, {
        route,
        status: response.status,
        response: value,
      });
      throw new Error("Hosted route did not return expected status");
    }
    return {
      value: value as T,
      storage: response.headers.get("X-Briefstamp-Storage"),
    };
  };
  try {
    receipt.judgeSpentBefore = await judgeCount();
    assert.deepEqual(
      await readReservations(),
      [],
      "New tranches must not already be reserved",
    );
    assert.equal((await request("/health")).value.status, "ok");
    const bootstrap = (await request<Bootstrap>("/api/bootstrap")).value;
    const sample = bootstrap.projects.find(
      (project) => project.target === "sample",
    );
    assert(sample);
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
        checks: selected.checks.map((check) => ({
          ...check,
          approved: check.kind !== "manual",
        })),
      },
    });
    let audit = (
      await request<Audit>(`/api/projects/${sample.id}/audits`, {
        body: {},
        expected: 202,
      })
    ).value;
    for (let index = 0; index < 100 && audit.status !== "completed"; index++) {
      await pause(500);
      audit = (await request<Audit>(`/api/audits/${audit.id}`)).value;
      assert.notEqual(audit.status, "error");
    }
    assert.equal(audit.status, "completed");
    receipt.browserCounts = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((status) => [
        status,
        audit.results.filter((result) => result.status === status).length,
      ]),
    );
    assert.deepEqual(receipt.browserCounts, {
      passed: 2,
      failed: 3,
      blocked: 0,
      unverified: 1,
    });
    let persisted = false;
    for (let index = 0; index < 30; index++) {
      const persistence = (await request(`/api/audits/${audit.id}/persistence`))
        .value;
      if (persistence.status === "saved") {
        persisted = true;
        break;
      }
      await pause(250);
    }
    assert(persisted, "Tiger persistence must finish before export");
    const saved = await request<Audit>(`/api/audits/${audit.id}`);
    assert.equal(saved.storage, "tiger");
    assert(isDeepStrictEqual(saved.value, audit));
    await artifact("source-audit.json", audit);
    const browserRoute = `/api/audits/${audit.id}/runtime-trace`;
    await request(browserRoute, { body: {}, expected: 404 });
    state.browserTraceAttempted = true;
    await writeState();
    const browserTrace = (await request(browserRoute, { body: {}, auth: true }))
      .value;
    await artifact("browser-trace.json", browserTrace);
    const browserMeasurement = validateTrace(browserTrace, "audit");
    assert.deepEqual(browserMeasurement.attributes, {
      checkCount: 6,
      target: "sample",
      ...receipt.browserCounts,
      outcome: "completed",
    });
    receipt.browserTrace = {
      traceId: browserTrace.traceId,
      measurementSha256: browserTrace.measurementSha256,
      flushed: true,
      ingestionVerified: false,
      measuredSpans: 2,
    };
    const route = `/api/audits/${audit.id}/agent-review`;
    const body = { websiteProjectId: website.id, modelConsent: true };
    await request(route, { body, expected: 404 });
    await request(route, {
      body: { ...body, modelConsent: false },
      auth: true,
      expected: 400,
    });
    state.routeAttempted = true;
    await writeState();
    const agent = (await request(route, { body, auth: true })).value;
    await artifact("agent-run.json", agent);
    assert.equal(agent.status, "completed");
    assert.equal(agent.transport, "backboard_openrouter_gemma");
    assert.equal(agent.modelTurns.length, 0);
    assert.equal(agent.orchestration?.provider, "Mastra Agent");
    assert.equal(
      agent.orchestration.bridge,
      "backboard-gemma-json-to-ai-sdk-tool-calls",
    );
    assert.equal(agent.orchestration.modelCalls, 2);
    assert.equal(agent.orchestration.steps.length, 2);
    const turns = agent.backboardModelTurns;
    assert.equal(turns.length, 2);
    assert.deepEqual(
      turns.map((turn: any) => turn.phase),
      ["select_tools", "summarize"],
    );
    assert(
      turns.every(
        (turn: any) =>
          turn.result?.provider === "Backboard" &&
          turn.result.modelProvider === "openrouter" &&
          turn.result.model === "google/gemma-4-26b-a4b-it" &&
          turn.result.attempts?.length === 1 &&
          turn.result.attempts[0].status === 200,
      ),
    );
    assert.equal(agent.toolCalls.length, 2);
    assert.deepEqual(agent.toolCalls.map((tool: any) => tool.name).sort(), [
      "failure_history",
      "search_visibility",
    ]);
    assert(agent.toolCalls.every((tool: any) => tool.status === "observed"));
    const history = agent.toolReceipts.find(
      (tool: any) => tool.tool === "failure_history",
    )?.result;
    const search = agent.toolReceipts.find(
      (tool: any) => tool.tool === "search_visibility",
    )?.result;
    assert(history?.length > 0 && search?.status === "observed");
    validateCitations(
      agent.modelOutput,
      validatedAudit(audit),
      agent.observations,
    );
    assert(
      agent.modelOutput.findings.some(
        (finding: any) => finding.type === "historical_failure",
      ),
    );
    assert(
      agent.modelOutput.findings.some(
        (finding: any) => finding.type === "search_snapshot",
      ),
    );
    const agentMeasurement = validateTrace(agent.runtimeTrace, "agent");
    assert.notEqual(browserTrace.traceId, agent.runtimeTrace.traceId);
    for (const turn of turns) {
      const span = agentMeasurement.spans.find(
        (value) => value.operation === `briefstamp.agent.model.${turn.phase}`,
      )!;
      assert.equal(span.attributes.provider, "Backboard");
      assert.equal(span.attributes.model, turn.result.model);
      for (const key of [
        "inputTokens",
        "outputTokens",
        "totalTokens",
      ] as const) {
        const reported = turn.result.attempts[0].usage[key];
        if (reported === null || reported === undefined)
          assert.equal(span.attributes[key], undefined);
        else assert.equal(span.attributes[key], reported);
      }
      assert.equal(
        span.attributes.modelLatencyMs,
        turn.result.attempts[0].durationMs,
      );
    }
    receipt.agentTrace = {
      traceId: agent.runtimeTrace.traceId,
      measurementSha256: agent.runtimeTrace.measurementSha256,
      flushed: true,
      ingestionVerified: false,
      measuredSpans: 5,
    };
    receipt.modelRequests = turns.map((turn: any) => ({
      phase: turn.phase,
      provider: turn.result.provider,
      model: turn.result.model,
      usage: turn.result.usage,
      attempts: turn.result.attempts,
    }));
    receipt.toolsChosen = agent.selection.tools;
    receipt.citedFindings = agent.modelOutput.findings;
    receipt.sdk = agent.orchestration;
    await artifact("agent-trace.json", agent.runtimeTrace);
    const after = (await request<Audit>(`/api/audits/${audit.id}`)).value;
    assert(isDeepStrictEqual(after, audit));
    const independent = (
      await pool.query(
        "SELECT payload FROM briefstamp_demo_v1.audits WHERE audit_id=$1",
        [audit.id],
      )
    ).rows;
    assert.equal(independent.length, 1);
    assert(isDeepStrictEqual(independent[0].payload, audit));
    receipt.auditUnchanged = true;
    receipt.independentTigerRoundTrip = true;
    receipt.durableReservations = await readReservations();
    assert.equal(receipt.durableReservations.length, 3);
    assert(
      receipt.durableReservations.every(
        (row: any) => row.count === 1 && reservationIds.includes(row.trancheId),
      ),
    );
    receipt.judgeSpentAfter = await judgeCount();
    assert.equal(receipt.judgeSpentAfter, receipt.judgeSpentBefore);
    receipt.oldFilesUnchanged = await verifyPrior();
    // Retry only safe cached reads/denials; never replay the consumed agent.
    const cached = (await request(browserRoute, { body: {}, auth: true }))
      .value;
    assert(isDeepStrictEqual(cached, browserTrace));
    await request(route, { body, auth: true, expected: 409 });
    const mobile = audit.results.find(
      (result) => result.kind === "no_horizontal_overflow",
    )!;
    assert(
      mobile.evidence.screenshot?.startsWith("/evidence/") &&
        !mobile.evidence.screenshot.includes(".."),
    );
    const imageResponse = await fetch(origin + mobile.evidence.screenshot, {
      headers: { cookie },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(imageResponse.status, 200);
    const image = await boundedBytes(imageResponse, 2 * 1024 * 1024);
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    await writeFile(path.join(directory, "mobile-failure.png"), image, {
      flag: "wx",
      mode: 0o600,
    });
    receipt.screenshot = {
      file: "mobile-failure.png",
      bytes: image.length,
      sha256: hash(image),
    };
    receipt.status = "verified_export_ingestion_unverified";
  } catch (error) {
    receipt.status = "failed";
    receipt.errorClass = error instanceof Error ? error.name : "Unknown";
    receipt.failureScope =
      "Partial responses and consumed reservations are retained; no automatic retry, refund or ingestion claim.";
    throw new Error(
      "Hosted Sentry runtime verification failed; inspect the private run receipt.",
    );
  } finally {
    try {
      receipt.judgeSpentAfter = await judgeCount();
      receipt.judgeCountUnchanged =
        receipt.judgeSpentAfter === receipt.judgeSpentBefore;
      receipt.durableReservations = await readReservations();
    } catch {
      receipt.finalStorageReadback = "unavailable";
    }
    try {
      receipt.oldFilesUnchanged = await verifyPrior();
    } catch {
      receipt.oldFilesUnchanged = false;
      receipt.status = "failed";
    }
    receipt.completedAt = new Date().toISOString();
    state.status = "consumed_no_refund";
    state.receipt = path.join(directory, "receipt.json");
    try {
      await artifact("receipt.json", receipt);
      await writeState();
    } finally {
      await pool.end();
    }
    console.log(
      JSON.stringify({
        directory,
        status: receipt.status,
        browserCounts: receipt.browserCounts,
        browserTrace: receipt.browserTrace,
        agentTrace: receipt.agentTrace,
        oldFilesUnchanged: receipt.oldFilesUnchanged,
        judgeCountUnchanged: receipt.judgeCountUnchanged,
      }),
    );
  }
}
