import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import type { Audit, Bootstrap, Check, Project } from "../shared/types.js";
import {
  EVIDENCE_AGENT_SAMPLE_BRIEF,
  validateCitations,
  validatedAudit,
  type EvidenceAgentReceipt,
} from "../server/evidence-agent.js";
import { generateLocalChecks } from "../server/generator.js";
import {
  freshFunding,
  readOnlyClockFailure,
  storageFailureBeforeAgent,
} from "./hosted-preflight.js";
import {
  HOSTED_WEBSITE_PRESET,
  HOSTED_WEBSITE_URL,
} from "../shared/hosted-target.js";

// No default execution, credential-file reads, account operations, fallback,
// alternate origin, write retries, or allowance resets. The operator must have
// independently confirmed the existing free grants and deployed configuration.
const usage =
  "Not run. Explicit use: --run --mode mastra|temporal --output work/NEW_DIR [--expected-sha 40_HEX_SHA]. Temporal requires the existing BRIEFSTAMP_HOSTED_OPERATOR_TOKEN in the environment. No HTTP request was sent.";
const args = process.argv.slice(2);
if (!args.includes("--run")) {
  console.log(usage);
  if (args.length) process.exitCode = 1;
} else {
  try {
    const values = new Map<string, string>();
    assert.equal(args.filter((arg) => arg === "--run").length, 1);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--run") continue;
      assert(
        [
          "--mode",
          "--output",
          "--expected-sha",
          "--continue-read-only-preflight",
          "--continue-before-agent",
        ].includes(args[i]),
        "Unknown argument",
      );
      assert(
        !values.has(args[i]) && args[i + 1] && !args[i + 1].startsWith("--"),
        "Missing or repeated argument",
      );
      values.set(args[i], args[++i]);
    }
    const mode = values.get("--mode");
    assert(
      mode === "mastra" || mode === "temporal",
      "Choose --mode mastra or temporal",
    );
    const output = values.get("--output");
    assert(output, "A new --output directory under work/ is required");
    const expectedSha = values.get("--expected-sha");
    assert(
      !expectedSha || /^[a-f0-9]{40}$/.test(expectedSha),
      "Invalid expected SHA",
    );
    await verify(
      mode,
      output,
      expectedSha,
      values.get("--continue-read-only-preflight"),
      values.get("--continue-before-agent"),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Verifier preflight failed",
    );
    process.exitCode = 1;
  }
}

type AgentEnvelope = EvidenceAgentReceipt & {
  reservation: {
    consumed: boolean;
    maxModelCalls: number;
    maxSearchCalls: number;
  };
  auditUnchanged: boolean;
  sourceAuditSha256: string;
  toolReceipts: Array<{ tool: string; result: unknown }>;
  providerAttempts: Array<{ provider: string; status: number | null }>;
};
function sha(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
function semantics(checks: Check[]) {
  return checks.map(({ id: _id, approved: _approved, ...check }) => check);
}

async function verify(
  mode: "mastra" | "temporal",
  output: string,
  expectedSha?: string,
  previousPreflight?: string,
  beforeAgentFailure?: string,
) {
  assert(!(previousPreflight && beforeAgentFailure));
  const rulesSource = !!beforeAgentFailure;
  const token = process.env.BRIEFSTAMP_HOSTED_OPERATOR_TOKEN;
  if (mode === "temporal")
    assert(
      token && token.length >= 32,
      "Temporal controlled recovery requires the existing operator token in BRIEFSTAMP_HOSTED_OPERATOR_TOKEN; never put it in command arguments",
    );
  const origin = "https://flowproof-demo.onrender.com";
  const work = path.resolve("work");
  await mkdir(work, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(work), work, "work/ must not be a symlink");
  const directory = path.resolve(output);
  assert(
    directory.startsWith(work + path.sep),
    "Output must be a new directory under work/",
  );
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  assert(
    (await realpath(path.dirname(directory))).startsWith(work + path.sep) ||
      (await realpath(path.dirname(directory))) === work,
    "Output parent escapes work/",
  );
  await mkdir(directory, { mode: 0o700 }); // EEXIST refuses overwriting evidence.
  const startedAt = new Date().toISOString();
  // A separate immutable file prevents accidentally rerunning a mode with a new
  // output path. A failed or uncertain run is not permission to remove this file.
  const reservationPath = path.join(
    work,
    `week2-hosted-${mode}.reservation.json`,
  );
  let continuation: Record<string, unknown> | undefined;
  if (previousPreflight) {
    const previousDirectory = await realpath(path.resolve(previousPreflight));
    assert(previousDirectory.startsWith(work + path.sep));
    const previousBytes = await readFile(
      path.join(previousDirectory, "receipt.json"),
    );
    const previous = JSON.parse(previousBytes.toString());
    const reserved = JSON.parse(await readFile(reservationPath, "utf8"));
    assert(
      readOnlyClockFailure(previous, mode),
      "Only the fully observed read-only clock failure can continue",
    );
    assert.equal(
      reserved.directory,
      path.relative(process.cwd(), previousDirectory),
    );
    assert.equal(reserved.startedAt, previous.startedAt);
    assert.equal(previous.expectedSha, expectedSha);
    continuation = {
      originalReceipt:
        path.relative(process.cwd(), previousDirectory) + "/receipt.json",
      originalReceiptSha256: sha(previousBytes),
      originalReservationUnchanged: true,
      priorModelCalls: 0,
      priorJudgeCalls: 0,
      priorWrites: 0,
    };
    await writeFile(
      reservationPath + ".read-only-continuation.json",
      JSON.stringify(
        {
          ...continuation,
          startedAt,
          directory: path.relative(process.cwd(), directory),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    ); // One continuation; never erase the original.
  } else if (beforeAgentFailure) {
    const previousDirectory = await realpath(path.resolve(beforeAgentFailure));
    assert(previousDirectory.startsWith(work + path.sep));
    const bytes = await readFile(path.join(previousDirectory, "receipt.json"));
    const previous = JSON.parse(bytes.toString());
    assert(
      storageFailureBeforeAgent(previous, mode),
      "A dispatched or uncertain agent cannot continue",
    );
    const priorContinuation = JSON.parse(
      await readFile(
        mode === "temporal"
          ? reservationPath + ".read-only-continuation.json"
          : reservationPath,
        "utf8",
      ),
    );
    assert.equal(
      priorContinuation.directory,
      path.relative(process.cwd(), previousDirectory),
    );
    if (mode === "mastra")
      assert.equal(priorContinuation.startedAt, previous.startedAt);
    const audit = JSON.parse(
      await readFile(
        path.join(previousDirectory, "browser-audit.json"),
        "utf8",
      ),
    );
    const proposal = JSON.parse(
      await readFile(
        path.join(previousDirectory, "gemma-proposal.json"),
        "utf8",
      ),
    );
    assert.equal(audit.status, "completed");
    assert.equal(audit.approvalWorkflow?.status, "success");
    assert.equal(
      proposal.approvalWorkflow?.runId,
      audit.approvalWorkflow.runId,
    );
    assert(proposal.generator.usage?.promptTokens > 0);
    continuation = {
      originalReceipt:
        path.relative(process.cwd(), previousDirectory) + "/receipt.json",
      originalReceiptSha256: sha(bytes),
      originalReservationUnchanged: true,
      priorModelCalls: 1,
      priorJudgeCalls: 0,
      noProposalReplay: true,
      source:
        "New real Chromium source from deterministic fixed checks; prior successful Gemma/approval evidence retained separately",
    };
    await writeFile(
      reservationPath + ".before-agent-continuation.json",
      JSON.stringify(
        {
          ...continuation,
          startedAt,
          directory: path.relative(process.cwd(), directory),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } else
    await writeFile(
      reservationPath,
      JSON.stringify(
        {
          startedAt,
          mode,
          directory: path.relative(process.cwd(), directory),
          status: "reserved_no_retry",
          maximumProposalRouteCalls: 1,
          maximumJudgeRouteCalls: 1,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  await mkdir(path.join(directory, "calls"), { mode: 0o700 });
  const receipt: Record<string, any> = {
    startedAt,
    status: "running",
    origin,
    mode,
    expectedSha: expectedSha ?? null,
    observedDeploymentSha: null,
    expectedShaVerified: false,
    source: {
      verifierSha256: sha(await readFile(new URL(import.meta.url))),
      sourceFiles: {},
    },
    approval: {
      actor: "automated controlled owner test",
      humanApproval: false,
      simulatedNativeEvidence: false,
    },
    maximumProposalRouteCalls: 1,
    proposalSource: rulesSource
      ? "deterministic fixed sample; no model proposal dispatched"
      : "live Gemma",
    maximumJudgeRouteCalls: 1,
    proposedModelRequests: 0,
    judgeRequests: 0,
    billingChanges: 0,
    ...(continuation ? { readOnlyPreflightContinuation: continuation } : {}),
    calls: [],
    artifacts: [],
    limitations: [
      "Controlled automated owner approval is not a visitor or customer approval.",
      "One proposal route may use the server's existing bounded provider attempts; the verifier never retries it.",
      "Worker recovery does not prove recovery after Render ephemeral-disk loss.",
      "No credential, account, billing, grant, quota or deployment configuration is changed by this verifier.",
    ],
  };
  const deadline = Date.now() + 8 * 60_000;
  let cookie = "";
  const safe = (value: string) =>
    token ? value.split(token).join("[REDACTED_OPERATOR_TOKEN]") : value;
  const save = async (filename: string, value: unknown, raw = false) => {
    assert(/^(?:calls\/)?[a-z0-9.-]+$/.test(filename));
    const bytes = safe(
      raw ? String(value) : JSON.stringify(value, null, 2) + "\n",
    );
    await writeFile(path.join(directory, filename), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    receipt.artifacts.push({
      file: filename,
      bytes: Buffer.byteLength(bytes),
      sha256: sha(bytes),
      operatorTokenRedacted: raw && bytes !== value,
    });
  };
  async function request<T>(
    route: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
      expected?: number;
      auth?: boolean;
      label: string;
    },
  ) {
    assert(Date.now() < deadline, "Verification deadline expired; no retry");
    assert(
      /^\/(?:health|api\/(?:bootstrap|judge-agent\/status|temporal-agent\/current|projects\/preset|projects\/[a-f0-9-]{36}(?:\/(?:variant|generate-gemma|checks|audits))?|audits\/[a-f0-9-]{36}(?:\/(?:persistence|judge-review))?))$/.test(
        route,
      ),
      "Unexpected route",
    );
    const method = options.method ?? "GET";
    if (route.endsWith("/generate-gemma"))
      assert.equal(
        ++receipt.proposedModelRequests,
        1,
        "Proposal cannot be repeated",
      );
    if (route.endsWith("/judge-review"))
      assert.equal(
        ++receipt.judgeRequests,
        1,
        "Judge request cannot be repeated",
      );
    const number = receipt.calls.length + 1;
    const name = `calls/${String(number).padStart(3, "0")}-${options.label}`;
    const call: Record<string, unknown> = {
      route,
      method,
      startedAt: new Date().toISOString(),
      status: null,
      outcome: "pending",
      writeOutcome: method === "GET" ? "read_only" : "uncertain_until_response",
    };
    receipt.calls.push(call);
    // Persist intent before dispatch; never include Cookie or operator headers.
    await save(`${name}.request.json`, {
      route,
      method,
      body: options.body ?? null,
      operatorAuthentication: !!options.auth,
    });
    const requestStarted = performance.now();
    let body = "";
    try {
      const response = await fetch(origin + route, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(
          Math.min(
            route.endsWith("/judge-review") ? 190_000 : 100_000,
            deadline - Date.now(),
          ),
        ),
        headers: {
          ...(cookie ? { cookie } : {}),
          origin,
          ...(options.auth ? { "X-FlowProof-Token": token! } : {}),
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      call.status = response.status;
      const received = response.headers.get("set-cookie");
      if (received) {
        assert(
          /;\s*Secure(?:;|$)/i.test(received) &&
            /;\s*HttpOnly(?:;|$)/i.test(received),
          "Unexpected insecure session cookie",
        );
        cookie = received.split(";")[0];
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      if (reader)
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            total += chunk.value.byteLength;
            assert(
              total <= 4 * 1024 * 1024,
              "Response exceeds evidence budget",
            );
            body += decoder.decode(chunk.value, { stream: true });
          }
          body += decoder.decode();
        } finally {
          await reader.cancel().catch(() => {});
        }
      let value: T;
      try {
        value = JSON.parse(body);
      } catch {
        await save(`${name}.response.txt`, body, true);
        throw new Error(
          `${route} did not return JSON; HTTP ${response.status}; stop without retry`,
        );
      }
      await save(`${name}.response.json`, body, true);
      call.outcome = "response";
      call.writeOutcome = method === "GET" ? "read_only" : "response_received";
      call.storage = response.headers.get("x-briefstamp-storage");
      assert.equal(
        response.status,
        options.expected ?? 200,
        `${route} HTTP ${response.status}; denied or failed operation is not retried`,
      );
      return { value, storage: response.headers.get("x-briefstamp-storage") };
    } catch (error) {
      call.outcome =
        call.status === null
          ? "transport_failed_or_uncertain"
          : "response_failed";
      call.error = safe(
        error instanceof Error ? error.message : "Unknown request failure",
      );
      if (
        body &&
        !receipt.artifacts.some(
          (item: { file: string }) =>
            item.file === `${name}.response.json` ||
            item.file === `${name}.response.txt`,
        )
      )
        await save(`${name}.partial-response.txt`, body, true);
      throw error;
    } finally {
      call.completedAt = new Date().toISOString();
      call.durationMs = Math.round(performance.now() - requestStarted);
      await save(`${name}.metadata.json`, call);
    }
  }
  try {
    for (const filename of [
      "server/demo.ts",
      "server/approval-workflow.ts",
      "server/hosted-approval.ts",
      "server/mastra-evidence-agent.ts",
      "server/hosted-temporal.ts",
      "shared/hosted-target.ts",
    ])
      receipt.source.sourceFiles[filename] = sha(await readFile(filename));
    const health = (
      await request<Record<string, unknown>>("/health", { label: "health" })
    ).value;
    assert.equal(health.status, "ok");
    const observedSha =
      health.sourceCommit ?? health.commit ?? health.sha ?? health.gitCommit;
    receipt.observedDeploymentSha =
      typeof observedSha === "string" ? observedSha : null;
    if (expectedSha) {
      assert.equal(
        observedSha,
        expectedSha,
        "Health does not confirm the expected deployed SHA; supply separate deployment evidence rather than claiming verification",
      );
      receipt.expectedShaVerified = true;
    }
    const boot = (
      await request<Bootstrap>("/api/bootstrap", { label: "bootstrap" })
    ).value;
    assert(boot.demo?.gemma?.available, "Public Gemma proposal is unavailable");
    assert.equal(
      boot.demo.judgeAgent?.sampleBrief,
      EVIDENCE_AGENT_SAMPLE_BRIEF,
    );
    const status = (
      await request<{
        available: boolean;
        engine: string;
        funding?: { confirmedFree: boolean; checkedAt: string };
        budget?: { visitorUsed: boolean; remainingRuns: number };
        expiresAt?: string;
      }>("/api/judge-agent/status", { label: "funding-preflight" })
    ).value;
    await save("funding-preflight.json", status);
    assert(
      status.available &&
        status.funding?.confirmedFree &&
        !status.budget?.visitorUsed &&
        (status.budget?.remainingRuns ?? 0) > 0,
      "A fresh unspent confirmed-free public allowance is required",
    );
    assert(
      freshFunding(status.funding.checkedAt),
      "Funding check is not fresh",
    );
    assert(
      Date.parse(status.expiresAt ?? "") > Date.now(),
      "Allowance expired",
    );
    assert.equal(
      status.engine,
      mode === "temporal" ? "temporal" : "mastra_agent",
      "Hosted engine does not match requested mode",
    );
    const sample = boot.projects.find(
      (project) =>
        project.target === "sample" &&
        project.brief === EVIDENCE_AGENT_SAMPLE_BRIEF,
    );
    assert(sample && sample.authorized, "Fixed authorized sample is missing");
    const broken = (
      await request<Project>(`/api/projects/${sample.id}/variant`, {
        method: "POST",
        body: { sampleVariant: "broken" },
        label: "broken-variant",
      })
    ).value;
    const proposed = rulesSource
      ? broken
      : (
          await request<Project>(`/api/projects/${sample.id}/generate-gemma`, {
            method: "POST",
            body: { modelConsent: true },
            label: "one-gemma-proposal",
          })
        ).value;
    await save(
      rulesSource ? "rules-plan.json" : "gemma-proposal.json",
      proposed,
    );
    if (!rulesSource) {
      assert.equal(proposed.generator.provider, "Google Gemma (live API)");
      assert.equal(proposed.generator.model, "gemma-4-26b-a4b-it");
      assert(
        proposed.generator.usage &&
          proposed.generator.usage.promptTokens > 0 &&
          proposed.generator.usage.completionTokens > 0,
        "Genuine proposal token usage missing",
      );
      assert(proposed.checks.every((check) => !check.approved));
      assert(
        isDeepStrictEqual(
          semantics(proposed.checks),
          semantics(generateLocalChecks(EVIDENCE_AGENT_SAMPLE_BRIEF)),
        ),
        "Model proposal does not match the exact approved source semantics required by the bounded agent; no replacement or second proposal is allowed",
      );
    }
    const suspended = proposed.approvalWorkflow;
    if (!rulesSource) {
      assert(
        suspended &&
          suspended.provider === "Mastra" &&
          suspended.status === "suspended" &&
          suspended.scope === "process-local" &&
          suspended.durable === false &&
          suspended.suspension,
        "Actual SDK approval suspension receipt missing",
      );
      assert.equal(suspended.package, "@mastra/core");
      assert.equal(suspended.version, "1.77.0");
      assert(isDeepStrictEqual(suspended.suspension.checks, proposed.checks));
      assert(
        isDeepStrictEqual(
          suspended.suspension.checkIds,
          proposed.checks.map((check) => check.id),
        ),
      );
      assert(/^[a-f0-9]{64}$/.test(suspended.suspension.planDigest));
    }
    const approved = (
      await request<Project>(`/api/projects/${sample.id}/checks`, {
        method: "PUT",
        body: {
          checks: proposed.checks.map((check) => ({
            ...check,
            approved: true,
          })),
        },
        label: "controlled-owner-approval",
      })
    ).value;
    assert(
      isDeepStrictEqual(
        approved.checks,
        proposed.checks.map((check) => ({ ...check, approved: true })),
      ),
      "Approval changed the bound assertions",
    );
    await save("controlled-approval.json", {
      actor: receipt.approval,
      project: approved,
    });
    let audit = (
      await request<Audit>(`/api/projects/${sample.id}/audits`, {
        method: "POST",
        body: {},
        expected: 202,
        label: "one-resume-browser-audit",
      })
    ).value;
    for (
      let i = 0;
      i < 90 && ["queued", "running"].includes(audit.status);
      i++
    ) {
      await pause(1000);
      audit = (
        await request<Audit>(`/api/audits/${audit.id}`, { label: "poll-audit" })
      ).value;
    }
    await save("browser-audit.json", audit);
    assert.equal(
      audit.status,
      "completed",
      "Browser run failed or remains pending; no audit restart",
    );
    receipt.browserCounts = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((value) => [
        value,
        audit.results.filter((row) => row.status === value).length,
      ]),
    );
    assert.deepEqual(receipt.browserCounts, {
      passed: 2,
      failed: 3,
      blocked: 0,
      unverified: 1,
    });
    if (!rulesSource) {
      assert.equal(audit.approvalWorkflow?.status, "success");
      assert.equal(audit.approvalWorkflow!.runId, suspended!.runId);
      assert.equal(
        audit.approvalWorkflow!.result?.planDigest,
        suspended!.suspension!.planDigest,
      );
      assert(
        isDeepStrictEqual(
          audit.approvalWorkflow!.result?.results,
          audit.results,
        ),
      );
    }
    assert(isDeepStrictEqual(audit.checks, approved.checks));
    assert.equal(audit.source?.brief, EVIDENCE_AGENT_SAMPLE_BRIEF);
    assert.equal(audit.source.sampleVariant, "broken");
    // Capture real artifact bytes before later database/agent gates can fail.
    const images = [
      ...new Set(
        audit.results.flatMap((row) =>
          row.evidence.screenshot ? [row.evidence.screenshot] : [],
        ),
      ),
    ];
    assert.equal(images.length, 5);
    for (const [index, route] of images.entries()) {
      assert(
        new RegExp(`^/evidence/${audit.id}/[A-Za-z0-9_-]+\\.png$`).test(route),
      );
      const response = await fetch(origin + route, {
        redirect: "error",
        headers: { cookie },
        signal: AbortSignal.timeout(20_000),
      });
      assert.equal(
        response.status,
        200,
        "Actual browser screenshot unavailable",
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(bytes.length > 100 && bytes.length < 5 * 1024 * 1024);
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const filename = `browser-${index + 1}.png`;
      await writeFile(path.join(directory, filename), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      receipt.artifacts.push({
        file: filename,
        bytes: bytes.length,
        sha256: sha(bytes),
        route,
        observedHostedScreenshot: true,
      });
    }
    const reportResponse = await fetch(
      origin + `/api/audits/${audit.id}/report`,
      {
        redirect: "error",
        headers: { cookie },
        signal: AbortSignal.timeout(20_000),
      },
    );
    assert.equal(reportResponse.status, 200);
    const report = await reportResponse.text();
    assert(report.length > 100 && Buffer.byteLength(report) < 10 * 1024 * 1024);
    await save("browser-report.html", report, true);
    let persisted = false;
    for (let i = 0; i < 30; i++) {
      const persistence = (
        await request<{ status: string }>(
          `/api/audits/${audit.id}/persistence`,
          { label: "poll-tiger" },
        )
      ).value;
      if (persistence.status === "saved") {
        persisted = true;
        break;
      }
      assert.equal(
        persistence.status,
        "saving",
        "Tiger did not confirm saved source evidence",
      );
      await pause(1000);
    }
    assert(persisted, "Tiger persistence remains pending; agent not called");
    const before = await request<Audit>(`/api/audits/${audit.id}`, {
      label: "tiger-source-readback",
    });
    assert.equal(before.storage, "tiger");
    assert(
      isDeepStrictEqual(before.value, audit),
      "Tiger source does not match actual browser results",
    );
    const sourceHash = sha(JSON.stringify(audit));
    await save("source-audit.json", {
      audit,
      sha256: sourceHash,
      storage: before.storage,
    });
    const website = (
      await request<Project>("/api/projects/preset", {
        method: "POST",
        body: { preset: HOSTED_WEBSITE_PRESET.id },
        expected: 201,
        label: "owned-homepage-preset",
      })
    ).value;
    assert.equal(website.url, HOSTED_WEBSITE_URL);
    assert.equal(website.brief, HOSTED_WEBSITE_PRESET.brief);
    assert.equal(website.authorized, true);
    const agent = (
      await request<AgentEnvelope>(`/api/audits/${audit.id}/judge-review`, {
        method: "POST",
        body: { websiteProjectId: website.id, modelConsent: true },
        auth: mode === "temporal",
        label: "one-judge-review",
      })
    ).value;
    await save("agent-run.json", agent);
    assert.equal(agent.status, "completed");
    assert.equal(agent.transport, "native_google_gemma");
    assert.equal(agent.reservation.consumed, true);
    assert.equal(agent.reservation.maxModelCalls, 2);
    assert.equal(agent.reservation.maxSearchCalls, 1);
    assert.equal(agent.sourceAuditId, audit.id);
    assert.equal(agent.sourceAuditSha256, sourceHash);
    assert(agent.auditUnchanged && agent.sourceAuditUnchanged);
    assert.equal(agent.modelTurns.length, 2);
    const usage = agent.modelTurns.map((turn) => {
      assert(
        turn.result &&
          turn.result.attempts.length === 1 &&
          turn.result.attempts[0].status === 200,
        "Exactly one genuine physical model attempt is required per agent phase",
      );
      const usage = turn.result.attempts[0].usage;
      assert(
        usage && usage.promptTokens > 0 && usage.completionTokens > 0,
        "Actual agent token usage missing",
      );
      return { phase: turn.phase, ...usage };
    });
    assert(
      agent.selection?.tools.some((tool) => tool.name === "failure_history") &&
        agent.selection.tools.some((tool) => tool.name === "search_visibility"),
      "The model did not select both required actual tools",
    );
    assert(
      agent.observations.some(
        (observation) =>
          observation.type === "failure_history" &&
          observation.status === "observed",
      ) &&
        agent.observations.some(
          (observation) =>
            observation.type === "search_visibility" &&
            observation.status === "observed",
        ),
      "Both actual tool observations are required",
    );
    assert(agent.modelOutput);
    validateCitations(
      agent.modelOutput,
      validatedAudit(audit),
      agent.observations,
    );
    assert(
      agent.modelOutput.findings.some(
        (finding) => finding.type === "historical_failure",
      ) &&
        agent.modelOutput.findings.some(
          (finding) => finding.type === "search_snapshot",
        ),
      "Actual summary must cite returned history and search observations",
    );
    const sdk = agent.orchestration;
    assert.equal(
      sdk?.provider,
      mode === "temporal" ? "Temporal" : "Mastra Agent",
    );
    if (mode === "mastra") {
      assert.equal(sdk?.package, "@mastra/core");
      assert.equal(sdk?.bridge, "native-gemma-json-to-ai-sdk-tool-calls");
      assert(Array.isArray(sdk?.steps) && sdk.steps.length === 2);
      assert(Array.isArray(sdk?.toolCalls) && sdk.toolCalls.length === 2);
      assert(sdk?.totalUsage && typeof sdk.totalUsage === "object");
    } else {
      assert.equal(
        sdk?.workerRestarted,
        true,
        "Operator-controlled worker recovery was not observed",
      );
      assert.equal(
        sdk?.completedActivityEventsPreserved,
        true,
        "Completed activity event preservation was not observed",
      );
      assert.equal(sdk?.hostDiskRecoveryTested, false);
      assert.equal(sdk?.status, "completed");
      const activities = sdk?.activities as Record<
        string,
        { completed: number; attempts: number; retries: number }
      >;
      assert(activities && Object.keys(activities).length >= 4);
      assert(
        Object.values(activities).some((activity) => activity.retries >= 1),
        "No bounded transient retry observed",
      );
      assert(
        Object.values(activities).every((activity) => activity.completed === 1),
        "Expected each actual activity to complete once",
      );
      await save(
        "temporal-progress.json",
        (
          await request("/api/temporal-agent/current", {
            label: "final-temporal-readback",
          })
        ).value,
      );
    }
    await save("usage-and-citations.json", {
      proposal: proposed.generator.usage,
      agent: usage,
      totalAgentTokens: usage.reduce((sum, row) => sum + row.totalTokens, 0),
      selectedTools: agent.selection,
      citations: agent.modelOutput,
      citationsValidated: true,
      sdk,
    });
    const after = await request<Audit>(`/api/audits/${audit.id}`, {
      label: "source-unchanged-readback",
    });
    assert.equal(after.storage, "tiger");
    assert(isDeepStrictEqual(after.value, audit));
    receipt.sourceAuditUnchanged = true;
    receipt.sourceAuditSha256 = sourceHash;
    receipt.status = "verified";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = safe(
      error instanceof Error ? error.message : "Unknown verification failure",
    );
    receipt.retry =
      "Forbidden: retain the reservation and inspect existing server receipts; no automatic write/provider retry";
    process.exitCode = 1;
  } finally {
    receipt.completedAt = new Date().toISOString();
    await writeFile(
      path.join(directory, "receipt.json"),
      safe(JSON.stringify(receipt, null, 2) + "\n"),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: receipt.status,
        receipt: path.relative(
          process.cwd(),
          path.join(directory, "receipt.json"),
        ),
        error: receipt.error ?? null,
      }),
    );
  }
}
