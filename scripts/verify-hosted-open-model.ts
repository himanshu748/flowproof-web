import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type {
  Audit,
  CheckKind,
  Project,
  ResultStatus,
} from "../shared/types.js";

class VerificationFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const ORIGIN = "https://flowproof-demo.onrender.com";
const GEMMA_MODEL = "gemma-4-26b-a4b-it";
const TINKER_MODEL = "Qwen/Qwen3.5-4B";
const STEPS = ["generate-google-gemma", "validate-indexed-proposal"];
const MAX_DURATION_MS = 8 * 60_000;
const KINDS: CheckKind[] = [
  "heading",
  "link",
  "image_alt",
  "no_horizontal_overflow",
  "text_visible",
  "manual",
];
const args = process.argv.slice(2);
const runGemma = args.includes("--run-public-gemma");
const runTinker = args.includes("--run-tinker");
const runBackboard = args.includes("--run-backboard");
const verifyTiger = args.includes("--verify-tiger");
const MODEL = runTinker ? TINKER_MODEL : GEMMA_MODEL;
const GENERATOR = runTinker
  ? "Tinker (live trained checkpoint)"
  : "Google Gemma (live API)";
const validArgs =
  args.length === new Set(args).size &&
  args.every((arg) =>
    [
      "--run-public-gemma",
      "--run-tinker",
      "--run-backboard",
      "--verify-tiger",
    ].includes(arg),
  );

if (runGemma === runTinker || !validArgs) {
  console.log(
    JSON.stringify({
      status: "not_run",
      modelRequests: 0,
      memoryOperations: 0,
      instructions:
        "Choose exactly one of --run-public-gemma or --run-tinker for one real hosted model request and three synthetic browser audits. Tinker requires BRIEFSTAMP_HOSTED_OPERATOR_TOKEN. Optionally add --verify-tiger for saved-audit reads and scoped lexical retrieval, or --run-backboard only with explicitly approved existing-credit access, BRIEFSTAMP_HOSTED_OPERATOR_TOKEN and BACKBOARD_API_KEY. No model retries, funding or account changes are performed.",
    }),
  );
  if (args.length) process.exitCode = 1;
} else {
  await verify();
}

async function verify() {
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const directory = path.resolve("work/hosted-open-model", stamp);
  const statePath = path.resolve("work/hosted-memory-proof-state.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + MAX_DURATION_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_DURATION_MS);
  const secrets: string[] = [];
  const operatorToken = process.env.BRIEFSTAMP_HOSTED_OPERATOR_TOKEN;
  const backboardKey = process.env.BACKBOARD_API_KEY;
  if (operatorToken) secrets.push(operatorToken);
  if (backboardKey) secrets.push(backboardKey);
  const calls: Array<Record<string, unknown>> = [];
  const artifacts: Array<{ path: string; bytes: number; sha256: string }> = [];
  const tigerStorage = {
    requested: verifyTiger,
    status: verifyTiger ? "not_verified" : "not_requested",
    auditReads: [] as Array<Record<string, unknown>>,
    lexicalRetrieval: null as Record<string, unknown> | null,
    scope:
      "Tiger stores synthetic audit JSON and screenshot references. Downloaded screenshot bytes are separate HTTP evidence, not proof of binary image storage in the database.",
  };
  const receipt: Record<string, unknown> = {
    version: 1,
    startedAt,
    origin: ORIGIN,
    status: "not_completed",
    scope:
      "Real hosted synthetic application smoke; not a model quality evaluation or human approval.",
    approval: {
      actorType: "agent",
      purpose:
        "Explicit verifier approval of the fixed synthetic test harness only",
      humanApproval: false,
    },
    modelRequests: 0,
    modelProvider: runTinker ? "Tinker" : "Google Gemma",
    modelRequestScope:
      "Reserved application generation attempts; backend inference is only verified after a validated live-provider result.",
    memoryOperations: 0,
    settingsOrPaymentChanges: 0,
    backboardRequested: runBackboard,
    tigerStorage,
    calls,
    artifacts,
  };
  const sha = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const scopeHash = (value: string) => sha(`briefstamp:${value}`);
  function require(condition: unknown, code: string): asserts condition {
    if (!condition) throw new VerificationFailure(code);
  }
  function safe(value: unknown): unknown {
    if (typeof value === "string") {
      let text = value;
      for (const secret of secrets)
        if (secret) text = text.split(secret).join("[REDACTED_SECRET]");
      return text;
    }
    if (Array.isArray(value)) return value.map(safe);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) =>
              !/^(?:cookie|set-cookie|authorization|x-api-key|x-flowproof-token|api_?key|operatorToken)$/i.test(
                key,
              ),
          )
          .map(([key, item]) => [key, safe(item)]),
      );
    return value;
  }
  async function privateJson(
    filename: string,
    value: unknown,
    exclusive = false,
  ) {
    await writeFile(filename, `${JSON.stringify(safe(value), null, 2)}\n`, {
      mode: 0o600,
      flag: exclusive ? "wx" : "w",
    });
  }
  const persist = () =>
    privateJson(path.join(directory, "receipt.json"), receipt);
  async function save(name: string, data: unknown, binary = false) {
    const bytes = binary
      ? (data as Buffer)
      : Buffer.from(
          typeof data === "string"
            ? String(safe(data))
            : `${JSON.stringify(safe(data), null, 2)}\n`,
        );
    await writeFile(path.join(directory, name), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    artifacts.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
    await persist();
  }
  async function boundedBody(response: Response, maximum: number) {
    const advertised = response.headers.get("content-length");
    if (advertised && Number(advertised) > maximum) {
      await response.body?.cancel();
      throw new VerificationFailure("response_too_large");
    }
    require(response.body, "response_body_missing");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        require(size <= maximum, "response_too_large");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
  }
  async function request(
    route: string,
    options: {
      cookie?: string;
      body?: unknown;
      method?: string;
      token?: string;
      expected?: number;
      maximum?: number;
      label?: string;
    } = {},
  ) {
    require(/^\/(?:api|evidence)\//.test(route), "unexpected_hosted_route");
    const url = new URL(route, ORIGIN);
    const method =
      options.method ?? (options.body === undefined ? "GET" : "POST");
    const queryKeys = [...url.searchParams.keys()];
    const scopedFailureQuery =
      method === "GET" &&
      url.pathname === "/api/failures" &&
      queryKeys.length === 2 &&
      new Set(queryKeys).size === 2 &&
      queryKeys.every((key) => key === "q" || key === "projectId") &&
      url.searchParams.get("q") === "horizontal" &&
      z.string().uuid().safeParse(url.searchParams.get("projectId")).success;
    require(url.origin === ORIGIN &&
      (!url.search || scopedFailureQuery) &&
      !url.hash, "unexpected_hosted_origin");
    require(["GET", "POST", "PUT"].includes(method), "unexpected_method");
    require(Date.now() < deadline, "process_deadline");
    const call: Record<string, unknown> = {
      operation: options.label ?? route,
      method,
      startedAt: new Date().toISOString(),
    };
    calls.push(call);
    await persist();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(
            Math.min(60_000, Math.max(1, deadline - Date.now())),
          ),
        ]),
        headers: {
          Accept: "application/json, text/html, image/png",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.token ? { "X-FlowProof-Token": options.token } : {}),
          ...(method === "GET"
            ? {}
            : { Origin: ORIGIN, "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      call.outcome = "transport_failed_without_retry";
      await persist();
      throw new VerificationFailure("hosted_transport_failed");
    }
    call.httpStatus = response.status;
    const storageHeader = response.headers.get("X-Briefstamp-Storage");
    if (storageHeader === "tiger" || storageHeader === "memory")
      call.storage = storageHeader;
    const bytes = await boundedBody(
      response,
      options.maximum ?? 2 * 1024 * 1024,
    );
    call.responseBytes = bytes.length;
    call.responseSha256 = sha(bytes);
    await persist();
    require(response.status ===
      (options.expected ?? 200), `unexpected_http_${response.status}`);
    return {
      response,
      bytes,
      json: () => JSON.parse(bytes.toString("utf8")) as unknown,
    };
  }
  async function bootstrap() {
    const loaded = await request("/api/bootstrap", {
      label: "bootstrap-visitor",
    });
    const cookie = loaded.response.headers.get("set-cookie")?.split(";")[0];
    require(cookie &&
      /^[A-Za-z0-9_-]+=[a-f0-9]{64}$/.test(cookie), "session_cookie_missing");
    secrets.push(cookie, cookie.split("=")[1]);
    const data = loaded.json() as { projects?: Project[] };
    require(Array.isArray(data.projects) &&
      data.projects.length === 1, "unexpected_initial_projects");
    const project = data.projects[0];
    require(z.string().uuid().safeParse(project.id).success &&
      project.target === "sample" &&
      project.sampleVariant === "healthy", "unexpected_initial_project");
    return { cookie, project };
  }
  const validGenerator = (project: Pick<Project, "generator">) => {
    const generator = project.generator;
    require(generator?.provider === GENERATOR &&
      generator.model === MODEL, runTinker
      ? "live_tinker_provenance_missing"
      : "live_gemma_provenance_missing");
    if (runTinker) {
      const usage = generator.reason?.match(
        /\b(\d+) input \/ (\d+) output tokens\./,
      );
      require(usage &&
        Number.isSafeInteger(Number(usage[1])) &&
        Number.isSafeInteger(Number(usage[2])) &&
        Number(usage[1]) + Number(usage[2]) > 0, "actual_tinker_usage_missing");
      require(!JSON.stringify(generator).includes(
        "tinker://",
      ), "private_tinker_checkpoint_exposed");
      return;
    }
    const run = generator.orchestration;
    require(run?.provider === "Mastra" &&
      run.workflowId === "briefstamp-public-gemma" &&
      z.string().uuid().safeParse(run.runId).success &&
      JSON.stringify(run.steps) === JSON.stringify(STEPS) &&
      Number.isFinite(run.maxRssMiB) &&
      run.maxRssMiB > 0, "actual_mastra_workflow_missing");
  };
  let memoryState:
    | {
        startedAt: string;
        receipt: string;
        reservedOperations: string[];
        attemptedOperations: string[];
        status: string;
      }
    | undefined;
  let before: Awaited<ReturnType<typeof balance>> | undefined;
  async function balance() {
    require(backboardKey &&
      !/[\s\x00-\x1f]/.test(backboardKey), "backboard_credential_missing");
    const call: Record<string, unknown> = {
      operation: "backboard-read-balance",
      method: "GET",
      startedAt: new Date().toISOString(),
    };
    calls.push(call);
    await persist();
    let response: Response;
    try {
      response = await fetch("https://app.backboard.io/api/billing/balance", {
        headers: { "X-API-Key": backboardKey, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20_000),
        ]),
      });
    } catch {
      throw new VerificationFailure("backboard_balance_transport_failed");
    }
    call.httpStatus = response.status;
    require(response.status === 200, "backboard_balance_unavailable");
    const data = z
      .object({
        balance_usd: z.number().finite().nonnegative(),
        free_credit_usd: z.number().finite().nonnegative(),
        paid_credit_usd: z.number().finite().nonnegative(),
        subscription_credits_usd: z.number().finite().nonnegative(),
        auto_reload_enabled: z.literal(false),
        stripe_payment_method_id: z.null(),
      })
      .safeParse(
        JSON.parse((await boundedBody(response, 64 * 1024)).toString("utf8")),
      );
    require(data.success, "backboard_payment_boundary_unverified");
    return {
      checkedAt: new Date().toISOString(),
      totalUsd: data.data.balance_usd,
      freeUsd: data.data.free_credit_usd,
      paidUsd: data.data.paid_credit_usd,
      subscriptionUsd: data.data.subscription_credits_usd,
      autoReloadEnabled: false,
      paymentMethodConfigured: false,
    };
  }
  try {
    await persist();
    if (runTinker)
      require(operatorToken &&
        operatorToken.length >= 32 &&
        !/[\s\x00-\x1f]/.test(operatorToken), "hosted_operator_token_missing");
    if (runBackboard) {
      require(operatorToken &&
        operatorToken.length >= 32 &&
        !/[\s\x00-\x1f]/.test(operatorToken), "hosted_operator_token_missing");
      before = await balance();
      receipt.backboardBalanceBefore = before;
      require(before.totalUsd >
        0.03, "backboard_existing_balance_insufficient");
      memoryState = {
        startedAt,
        receipt: path.relative(
          process.cwd(),
          path.join(directory, "receipt.json"),
        ),
        reservedOperations: ["memory-write", "memory-search"],
        attemptedOperations: [],
        status: "reserved_no_automatic_retry",
      };
      try {
        await privateJson(statePath, memoryState, true);
      } catch {
        memoryState = undefined;
        throw new VerificationFailure("prior_hosted_memory_reservation_exists");
      }
      receipt.backboardResourceScope =
        "Explicitly approved existing credits, including paid credit. No new out-of-pocket spend, top-up or settings changes; not claimed to be free credit only.";
      await persist();
    }
    const visitor = await bootstrap();
    await save("initial-project.json", visitor.project);
    receipt.modelRequests = 1;
    await persist();
    const generated = await request(
      `/api/projects/${visitor.project.id}/${runTinker ? "generate-tinker" : "generate-gemma"}`,
      {
        cookie: visitor.cookie,
        ...(runTinker ? { token: operatorToken } : {}),
        body: { modelConsent: true },
        label: runTinker
          ? "one-live-tinker-generation"
          : "one-live-gemma-generation",
      },
    );
    let project = generated.json() as Project;
    await save("generated-project.json", project);
    require(project.id === visitor.project.id &&
      project.target === "sample", "generated_project_identity_mismatch");
    validGenerator(project);
    require(project.checks.length === 6 &&
      project.checks.every((check) => check.approved === false) &&
      new Set(project.checks.map((check) => check.kind)).size === 6 &&
      KINDS.every((kind) =>
        project.checks.some((check) => check.kind === kind),
      ), "unexpected_generated_plan");
    receipt.generator = project.generator;
    await request(`/api/projects/${project.id}/audits`, {
      cookie: visitor.cookie,
      body: {},
      expected: 409,
      label: "reject-unapproved-ai-plan",
    });
    receipt.unapprovedAuditRejected = true;
    const completedAudits: Record<string, Audit> = {};
    for (const label of ["healthy", "broken", "restored"] as const) {
      const variant = label === "broken" ? "broken" : "healthy";
      if (label !== "healthy") {
        project = (
          await request(`/api/projects/${project.id}/variant`, {
            cookie: visitor.cookie,
            body: { sampleVariant: variant },
            label: `select-${label}-variant`,
          })
        ).json() as Project;
        validGenerator(project);
        require(project.checks.every(
          (check) => check.approved === false,
        ), "variant_failed_to_clear_approval");
      }
      project = (
        await request(`/api/projects/${project.id}/checks`, {
          cookie: visitor.cookie,
          method: "PUT",
          body: {
            checks: project.checks.map((check) => ({
              ...check,
              approved: check.kind !== "manual",
            })),
          },
          label: `synthetic-harness-approval-${label}`,
        })
      ).json() as Project;
      const started = (
        await request(`/api/projects/${project.id}/audits`, {
          cookie: visitor.cookie,
          body: {},
          expected: 202,
          label: `start-${label}-audit`,
        })
      ).json() as Audit;
      require(z.string().uuid().safeParse(started.id).success &&
        started.projectId === project.id, "started_audit_identity_mismatch");
      let audit = started;
      const pollDeadline = Math.min(deadline, Date.now() + 90_000);
      while (
        ["queued", "running"].includes(audit.status) &&
        Date.now() < pollDeadline
      ) {
        await pause(1000, undefined, { signal: controller.signal });
        audit = (
          await request(`/api/audits/${started.id}`, {
            cookie: visitor.cookie,
            label: `poll-${label}-audit`,
          })
        ).json() as Audit;
      }
      await save(`${label}-audit.json`, audit);
      require(audit.id === started.id &&
        audit.projectId === project.id &&
        audit.status === "completed" &&
        audit.source?.target === "sample" &&
        audit.source.sampleVariant ===
          variant, "audit_not_completed_with_matching_source");
      validGenerator(audit.source);
      require(JSON.stringify(audit.checks) === JSON.stringify(project.checks) &&
        audit.results.length === 6, "audit_plan_snapshot_mismatch");
      if (verifyTiger) {
        let persistence: { status?: string; expiresAt?: string } = {};
        let polls = 0;
        for (; polls < 10; ) {
          polls++;
          persistence = (
            await request(`/api/audits/${audit.id}/persistence`, {
              cookie: visitor.cookie,
              label: `poll-${label}-tiger-persistence`,
            })
          ).json() as typeof persistence;
          if (persistence.status === "saved") break;
          if (polls < 10)
            await pause(1000, undefined, { signal: controller.signal });
        }
        await save(`${label}-tiger-persistence.json`, {
          polls,
          ...persistence,
        });
        require(persistence.status === "saved" &&
          typeof persistence.expiresAt === "string" &&
          Date.parse(persistence.expiresAt) >
            Date.now(), "tiger_persistence_not_confirmed");
        const stored = await request(`/api/audits/${audit.id}`, {
          cookie: visitor.cookie,
          label: `read-${label}-audit-from-tiger`,
        });
        const storedAudit = stored.json();
        const storage = stored.response.headers.get("X-Briefstamp-Storage");
        await save(`${label}-tiger-read.json`, { storage, audit: storedAudit });
        require(storage === "tiger" &&
          isDeepStrictEqual(
            storedAudit,
            audit,
          ), "tiger_audit_read_did_not_match_observed_audit");
        tigerStorage.auditReads.push({
          label,
          auditId: audit.id,
          persistence: "saved",
          storage: "tiger",
          semanticMatch: true,
          artifact: `${label}-tiger-read.json`,
        });
        await persist();
      }
      const expected: Record<CheckKind, ResultStatus> = {
        heading: variant === "broken" ? "failed" : "passed",
        link: "passed",
        image_alt: variant === "broken" ? "failed" : "passed",
        no_horizontal_overflow: variant === "broken" ? "failed" : "passed",
        text_visible: "passed",
        manual: "unverified",
      };
      for (const check of audit.checks) {
        const matching = audit.results.filter(
          (result) => result.checkId === check.id,
        );
        require(matching.length === 1 &&
          matching[0].kind === check.kind &&
          matching[0].requirement === check.requirement &&
          matching[0].expected === check.expected &&
          matching[0].status ===
            expected[check.kind], "unexpected_observed_check_outcome");
        if (check.kind === "manual") continue;
        const screenshot = matching[0].evidence.screenshot;
        require(screenshot &&
          new RegExp(`^/evidence/${audit.id}/[a-zA-Z0-9_-]+\\.png$`).test(
            screenshot,
          ), "screenshot_evidence_missing");
        const image = await request(screenshot, {
          cookie: visitor.cookie,
          maximum: 8 * 1024 * 1024,
          label: `screenshot-${label}-${check.kind}`,
        });
        require(image.bytes
          .subarray(0, 8)
          .equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          ), "invalid_screenshot_bytes");
        await save(`${label}-${check.kind}.png`, image.bytes, true);
      }
      const report = await request(`/api/audits/${audit.id}/report`, {
        cookie: visitor.cookie,
        maximum: 16 * 1024 * 1024,
        label: `report-${label}`,
      });
      const html = report.bytes.toString("utf8");
      await save(`${label}-report.html`, html);
      require(html.includes(GENERATOR) &&
        html.includes(MODEL) &&
        (runTinker || html.includes("Mastra")) &&
        !html.includes(
          "No AI model was used.",
        ), "report_generator_provenance_missing");
      require((html.match(/src="data:image\/png;base64,/g) ?? []).length ===
        5, "report_missing_embedded_evidence");
      completedAudits[label] = audit;
      receipt.auditOutcomes = Object.fromEntries(
        Object.entries(completedAudits).map(([name, item]) => [
          name,
          {
            id: item.id,
            status: item.status,
            counts: Object.fromEntries(
              ["passed", "failed", "blocked", "unverified"].map((status) => [
                status,
                item.results.filter((result) => result.status === status)
                  .length,
              ]),
            ),
          },
        ]),
      );
      await persist();
    }
    const other = await bootstrap();
    const broken = completedAudits.broken;
    for (const route of [
      `/api/projects/${project.id}`,
      `/api/audits/${broken.id}`,
      `/api/audits/${broken.id}/report`,
    ])
      await request(route, {
        cookie: other.cookie,
        expected: 404,
        label: "cross-visitor-evidence-denied",
      });
    receipt.crossVisitorIsolation =
      "Project, audit and report each returned HTTP 404 to a different visitor.";
    if (verifyTiger) {
      const queryRoute = `/api/failures?q=horizontal&projectId=${project.id}`;
      const retrieved = (
        await request(queryRoute, {
          cookie: visitor.cookie,
          label: "tiger-scoped-horizontal-failure-search",
        })
      ).json() as { mode?: string; results?: Array<Record<string, unknown>> };
      await save("tiger-failure-search.json", retrieved);
      const mobile = broken.results.find(
        (result) => result.kind === "no_horizontal_overflow",
      );
      const mobileCheck = broken.checks.find(
        (check) => check.kind === "no_horizontal_overflow",
      );
      require(mobile?.status === "failed" &&
        mobileCheck?.viewport === "mobile" &&
        retrieved.mode === "tiger-lexical" &&
        Array.isArray(retrieved.results) &&
        retrieved.results.length <= 20 &&
        retrieved.results.some(
          (row) =>
            row.auditId === broken.id &&
            row.projectId === project.id &&
            row.kind === "no_horizontal_overflow" &&
            row.status === "failed" &&
            row.requirement === mobile.requirement &&
            row.observed === mobile.evidence.observed &&
            row.retrieval === "lexical",
        ), "tiger_saved_mobile_failure_not_retrieved");
      await request(queryRoute, {
        cookie: other.cookie,
        expected: 404,
        label: "cross-visitor-tiger-search-denied",
      });
      await request(`/api/audits/${broken.id}/persistence`, {
        cookie: other.cookie,
        expected: 404,
        label: "cross-visitor-tiger-persistence-denied",
      });
      tigerStorage.lexicalRetrieval = {
        mode: "tiger-lexical",
        matchingAuditId: broken.id,
        matchingProjectId: project.id,
        kind: "no_horizontal_overflow",
        status: "failed",
        crossVisitorSearch: 404,
        crossVisitorPersistence: 404,
        artifact: "tiger-failure-search.json",
      };
      tigerStorage.status = "verified_saved_reads_and_lexical_retrieval";
      await persist();
    }
    if (runBackboard) {
      require(memoryState &&
        before &&
        operatorToken, "memory_reservation_missing");
      await request(`/api/audits/${broken.id}/memory`, {
        cookie: visitor.cookie,
        body: {},
        expected: 404,
        label: "anonymous-memory-denied",
      });
      await request(`/api/audits/${broken.id}/memory`, {
        cookie: other.cookie,
        token: operatorToken,
        body: {},
        expected: 404,
        label: "cross-visitor-operator-memory-denied",
      });
      await request(`/api/projects/${project.id}/memory/search`, {
        cookie: other.cookie,
        token: operatorToken,
        body: { kind: "heading" },
        expected: 404,
        label: "cross-visitor-operator-search-denied",
      });
      const reserveAttempt = async (operation: string) => {
        require(memoryState &&
          !memoryState.attemptedOperations.includes(
            operation,
          ), "duplicate_memory_operation");
        memoryState.attemptedOperations.push(operation);
        receipt.memoryOperations = memoryState.attemptedOperations.length;
        await privateJson(statePath, memoryState);
        await persist();
      };
      await reserveAttempt("memory-write");
      const accepted = (
        await request(`/api/audits/${broken.id}/memory`, {
          cookie: visitor.cookie,
          token: operatorToken,
          body: {},
          label: "one-backboard-memory-write",
        })
      ).json() as {
        status: string;
        provider: string;
        projectScope: string;
        auditScope: string;
        persistedAndRetrieved: boolean;
      };
      await save("backboard-write.json", accepted);
      require(accepted.status === "accepted" &&
        accepted.provider === "Backboard" &&
        accepted.projectScope === scopeHash(project.id) &&
        accepted.auditScope === scopeHash(broken.id) &&
        accepted.persistedAndRetrieved ===
          false, "memory_write_scope_mismatch");
      // One bounded indexing wait before our single search; no provider retry.
      await pause(3000, undefined, { signal: controller.signal });
      await reserveAttempt("memory-search");
      const recalled = (
        await request(`/api/projects/${project.id}/memory/search`, {
          cookie: visitor.cookie,
          token: operatorToken,
          body: { kind: "heading" },
          label: "one-backboard-memory-search",
        })
      ).json() as {
        provider: string;
        memories: Array<{
          project: string;
          audit: string;
          observedAt: string;
          facts: Array<{ kind: string; status: string }>;
        }>;
      };
      await save("backboard-search.json", recalled);
      const match = recalled.memories?.find(
        (memory) =>
          memory.project === scopeHash(project.id) &&
          memory.audit === scopeHash(broken.id),
      );
      const facts = (items: Array<{ kind: string; status: string }>) =>
        items.map(({ kind, status }) => `${kind}:${status}`).sort();
      require(recalled.provider === "Backboard" &&
        match &&
        match.observedAt === broken.completedAt &&
        match.facts.length === 6 &&
        JSON.stringify(facts(match.facts)) ===
          JSON.stringify(
            facts(broken.results),
          ), "all_six_saved_memory_facts_not_retrieved");
      receipt.backboard = {
        status: "stored_and_retrieved",
        matchingProjectHash: scopeHash(project.id),
        matchingAuditHash: scopeHash(broken.id),
        matchingFacts: match.facts,
        inferenceCalls: 0,
        scope: "Historical saved observations, not new browser evidence.",
      };
      memoryState.status = "completed_two_operations";
      await privateJson(statePath, memoryState);
    }
    receipt.status = "verified";
  } catch (error) {
    receipt.status = "failed_or_blocked";
    receipt.failureCode =
      error instanceof VerificationFailure
        ? error.code
        : "unexpected_local_or_schema_failure";
    receipt.failureScope =
      "No retry was attempted. Any earlier observed artifacts are retained; incomplete operations are not marked passed.";
    process.exitCode = 1;
  } finally {
    if (before && memoryState?.attemptedOperations.length) {
      try {
        const after = await balance();
        receipt.backboardBalanceAfter = after;
        receipt.backboardBalanceChange = {
          totalUsd: before.totalUsd - after.totalUsd,
          freeUsd: before.freeUsd - after.freeUsd,
          paidUsd: before.paidUsd - after.paidUsd,
          subscriptionUsd: before.subscriptionUsd - after.subscriptionUsd,
        };
        receipt.backboardBalanceScope =
          "Immediate account-wide observed difference; not final billing or exclusive attribution. No free-first spending rule is inferred.";
      } catch {
        receipt.backboardBalanceAfterStatus = "unverified";
        receipt.status = "failed_or_blocked";
        receipt.failureCode ??= "backboard_post_balance_unverified";
        process.exitCode = 1;
      }
    }
    clearTimeout(timer);
    receipt.completedAt = new Date().toISOString();
    await persist();
    console.log(
      JSON.stringify({
        status: receipt.status,
        receipt: path.relative(
          process.cwd(),
          path.join(directory, "receipt.json"),
        ),
        modelRequests: receipt.modelRequests,
        memoryOperations: receipt.memoryOperations,
        failureCode: receipt.failureCode,
      }),
    );
  }
}
