import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  HOSTED_WEBSITE_BRIEF,
  HOSTED_WEBSITE_URL,
} from "../shared/hosted-target.js";
import type {
  Audit,
  Bootstrap,
  Project,
  ResultStatus,
} from "../shared/types.js";
import { sampleNarration } from "../server/providers/elevenlabs.js";
import { SAMPLE_URL } from "../server/sample.js";

const ORIGIN = "https://flowproof-demo.onrender.com";
const MAX_DURATION = 6 * 60_000;
const args = process.argv.slice(2);
const run = args.includes("--run");
const runBackboard = args.includes("--run-backboard");
const valid =
  args.length === new Set(args).size &&
  args.every((arg) => ["--run", "--run-backboard"].includes(arg));

class VerificationFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// The default path does not read credentials, inspect files, create state or call HTTP.
if (!run || !valid) {
  console.log(
    JSON.stringify({
      status: "not_run",
      httpRequests: 0,
      providerRequests: 0,
      instructions:
        "Use --run only after approval of this specific confirmed-free allowance tranche. This reserves an exclusive off-host state file before any HTTP request, performs one synthetic Chromium audit, and attempts one hosted SerpApi search and one ElevenLabs sample speech request. Add --run-backboard only with separate approved existing-credit memory access. No retries, renewals, balance reads, purchases or settings changes. Credentials come only from FLOWPROOF_TOKEN in BRIEFSTAMP_HOSTED_ACCESS_FILE; the proof state must never be deleted to bypass a consumed reservation.",
    }),
  );
  if (args.length) process.exitCode = 1;
} else await verify();

async function verify() {
  const startedAt = new Date().toISOString();
  const directory = path.resolve(
    "work/hosted-optional",
    startedAt.replace(/[:.]/g, "-"),
  );
  const accessFile = path.resolve(
    process.env.BRIEFSTAMP_HOSTED_ACCESS_FILE ||
      "work/briefstamp-hosted-access.secrets.json",
  );
  const stateFile = path.resolve(
    process.env.BRIEFSTAMP_OPTIONAL_PROOF_STATE_FILE ||
      "work/hosted-optional-20261016-state.json",
  );
  const deadline = Date.now() + MAX_DURATION;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_DURATION);
  const secrets: string[] = [];
  const artifacts: Array<{ path: string; bytes: number; sha256: string }> = [];
  const calls: Array<Record<string, unknown>> = [];
  const outcomes: Record<string, Record<string, unknown>> = {};
  const receipt: Record<string, unknown> = {
    version: 1,
    startedAt,
    origin: ORIGIN,
    sourceCommit: process.env.BRIEFSTAMP_VERIFICATION_SOURCE_SHA ?? null,
    status: "not_completed",
    scope:
      "Agent verification of the fixed hosted homepage and synthetic sample; not a friend trial, human feedback, model quality result, commercial audio license or a website certification.",
    approval: {
      actorType: "agent",
      humanApproval: false,
      purpose:
        "Explicit verifier approval of a bounded synthetic audit plan only",
    },
    settingsOrPaymentChanges: 0,
    modelCalls: 0,
    providerRetries: 0,
    providerBalanceReads: 0,
    backboardRequested: runBackboard,
    artifacts,
    calls,
    providers: outcomes,
    duplicateProviderProbe:
      "Not performed: consumed allowances are covered by automated tests; this live verifier never intentionally repeats a provider action.",
  };
  const state = {
    version: 1,
    startedAt,
    receipt: path.relative(process.cwd(), path.join(directory, "receipt.json")),
    reservedOperations: [
      "serpapi-search",
      "elevenlabs-speech",
      ...(runBackboard ? ["backboard-write", "backboard-search"] : []),
    ],
    attemptedOperations: [] as string[],
    status: "reserved_no_automatic_rerun",
  };
  receipt.attemptedProviderOperations = state.attemptedOperations;
  let stateCreated = false;
  const sha = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const scopeHash = (value: string) => sha(`briefstamp:${value}`);
  function require(condition: unknown, code: string): asserts condition {
    if (!condition) throw new VerificationFailure(code);
  }
  function safe(value: unknown): unknown {
    if (typeof value === "string") {
      let result = value;
      for (const secret of secrets)
        if (secret) result = result.split(secret).join("[REDACTED_SECRET]");
      return result;
    }
    if (Array.isArray(value)) return value.map(safe);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([name]) =>
              !/^(?:cookie|set-cookie|authorization|x-api-key|xi-api-key|x-flowproof-token|api_?key|operatorToken|FLOWPROOF_TOKEN)$/i.test(
                name,
              ),
          )
          .map(([name, item]) => [name, safe(item)]),
      );
    return value;
  }
  const jsonFile = (filename: string, value: unknown, exclusive = false) =>
    writeFile(filename, `${JSON.stringify(safe(value), null, 2)}\n`, {
      mode: 0o600,
      flag: exclusive ? "wx" : "w",
    });
  const persist = () => jsonFile(path.join(directory, "receipt.json"), receipt);
  async function artifact(name: string, value: unknown) {
    require(/^[a-z0-9-]+\.(json|png|html|mp3|txt)$/.test(
      name,
    ), "invalid_artifact_name");
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(
          typeof value === "string"
            ? String(safe(value))
            : `${JSON.stringify(safe(value), null, 2)}\n`,
        );
    await writeFile(path.join(directory, name), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    artifacts.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
    await persist();
  }
  async function boundedBody(response: Response, maximum: number) {
    const declared = response.headers.get("content-length");
    if (declared && Number(declared) > maximum) {
      await response.body?.cancel();
      throw new VerificationFailure("response_too_large");
    }
    require(response.body, "response_body_missing");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        require(total <= maximum, "response_too_large");
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
      operator?: boolean;
      expected?: number;
      maximum?: number;
      label: string;
    },
  ) {
    const validPath =
      /^\/api\/(?:bootstrap|operator\/status|projects(?:\/preset|\/[a-f0-9-]{36}\/(?:checks|audits|search-visibility|memory\/search))?|audits\/[a-f0-9-]{36}(?:\/(?:persistence|report|spoken-report|memory))?)$/.test(
        route,
      ) || /^\/evidence\/[a-f0-9-]{36}\/[A-Za-z0-9_-]+\.png$/.test(route);
    require(validPath &&
      !route.includes("?") &&
      !route.includes("#"), "unexpected_fixed_host_route");
    require(Date.now() < deadline, "verification_deadline");
    const method =
      options.method ?? (options.body === undefined ? "GET" : "POST");
    require(["GET", "POST", "PUT"].includes(method), "unexpected_method");
    const call: Record<string, unknown> = {
      operation: options.label,
      route,
      method,
      startedAt: new Date().toISOString(),
    };
    calls.push(call);
    await persist();
    let response: Response;
    try {
      response = await fetch(ORIGIN + route, {
        method,
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(
            Math.min(55_000, Math.max(1, deadline - Date.now())),
          ),
        ]),
        headers: {
          Accept: "application/json, audio/mpeg, text/html, image/png",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.operator ? { "X-FlowProof-Token": secrets[0] } : {}),
          ...(method === "GET"
            ? {}
            : { Origin: ORIGIN, "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      call.status = "transport_failed_without_retry";
      await persist();
      throw new VerificationFailure("hosted_transport_failed");
    }
    call.httpStatus = response.status;
    const bytes = await boundedBody(
      response,
      options.maximum ?? 4 * 1024 * 1024,
    );
    call.responseBytes = bytes.length;
    call.responseSha256 = sha(bytes);
    const storage = response.headers.get("X-Briefstamp-Storage");
    if (["tiger", "memory"].includes(storage ?? "")) call.storage = storage;
    await persist();
    require(response.status ===
      (options.expected ?? 200), `unexpected_http_${response.status}`);
    return {
      response,
      bytes,
      json: () => JSON.parse(bytes.toString("utf8")) as unknown,
    };
  }
  async function bootstrap(label: string) {
    const result = await request("/api/bootstrap", { label });
    const header = result.response.headers.get("set-cookie");
    require(header &&
      /;\s*Secure(?:;|$)/i.test(header) &&
      /;\s*HttpOnly(?:;|$)/i.test(header), "secure_visitor_cookie_missing");
    const cookie = header.split(";")[0];
    require(/^flowproof_demo=[a-f0-9]{64}$/.test(
      cookie,
    ), "invalid_visitor_cookie");
    secrets.push(cookie, cookie.split("=")[1]);
    const data = result.json() as Bootstrap;
    require(data.projects?.length === 1 &&
      z.string().uuid().safeParse(data.projects[0].id).success &&
      data.projects[0].target === "sample" &&
      data.projects[0].url === SAMPLE_URL, "unexpected_bootstrap_sample");
    return { cookie, project: data.projects[0], data };
  }
  async function attempt(name: string, action: () => Promise<void>) {
    require(stateCreated &&
      state.reservedOperations.includes(name) &&
      !state.attemptedOperations.includes(
        name,
      ), "unreserved_or_duplicate_provider_action");
    state.attemptedOperations.push(name);
    await jsonFile(stateFile, state);
    await persist();
    try {
      await action();
    } catch (error) {
      outcomes[name] = {
        status: "failed_or_blocked",
        failureCode:
          error instanceof VerificationFailure
            ? error.code
            : "invalid_or_unexpected_response",
        reservation: "consumed_or_unknown_no_retry",
        scope: "No raw provider error body retained; no pass inferred.",
      };
      await persist();
    }
  }
  try {
    // Only this explicitly requested mode reads a private file. No API provider key is needed.
    const access = JSON.parse(await readFile(accessFile, "utf8")) as {
      FLOWPROOF_TOKEN?: unknown;
    };
    const token = z
      .string()
      .min(32)
      .max(512)
      .regex(/^[^\s\x00-\x1f]+$/)
      .safeParse(access.FLOWPROOF_TOKEN);
    require(token.success, "private_operator_token_missing");
    secrets.push(token.data);
    require(z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .safeParse(receipt.sourceCommit).success, "verified_source_sha_required");
    require(stateFile !== accessFile &&
      !stateFile.startsWith(
        directory + path.sep,
      ), "invalid_off_host_state_path");
    await mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    try {
      await jsonFile(stateFile, state, true);
      stateCreated = true;
    } catch {
      throw new VerificationFailure("prior_proof_reservation_exists_no_rerun");
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await persist();
    const owner = await bootstrap("create-owner-visitor");
    const other = await bootstrap("create-second-isolated-visitor");
    require(owner.cookie !== other.cookie, "visitor_sessions_not_distinct");
    const availability = (
      await request("/api/operator/status", {
        cookie: owner.cookie,
        operator: true,
        label: "read-protected-configuration-availability",
      })
    ).json() as {
      serpapi?: boolean;
      elevenlabs?: boolean;
      backboard?: boolean;
    };
    receipt.configuredAvailability = availability;
    require(availability.serpapi === true &&
      availability.elevenlabs ===
        true, "optional_provider_proofs_not_available");
    if (runBackboard)
      require(availability.backboard ===
        true, "approved_backboard_proof_not_available");
    const live = (
      await request("/api/projects/preset", {
        cookie: owner.cookie,
        body: { preset: "briefstamp-live" },
        expected: 201,
        label: "create-owner-authorized-live-homepage-preset",
      })
    ).json() as Project;
    require(z.string().uuid().safeParse(live.id).success &&
      live.target === "website" &&
      live.url === HOSTED_WEBSITE_URL &&
      live.authorized === true &&
      live.brief === HOSTED_WEBSITE_BRIEF, "fixed_live_preset_mismatch");
    const sample = (
      await request("/api/projects", {
        cookie: owner.cookie,
        body: {
          name: "Hosted synthetic provider proof",
          target: "sample",
          sampleVariant: "broken",
          authorized: true,
          brief: owner.project.brief,
        },
        expected: 201,
        label: "create-built-in-broken-sample",
      })
    ).json() as Project;
    require(z.string().uuid().safeParse(sample.id).success &&
      sample.target === "sample" &&
      sample.url === SAMPLE_URL &&
      sample.sampleVariant === "broken" &&
      sample.generator.provider === "Deterministic parser" &&
      sample.generator.model === null &&
      sample.brief === owner.project.brief &&
      sample.checks.length === 6 &&
      sample.checks.every(
        (check) => !check.approved,
      ), "synthetic_sample_source_mismatch");
    await artifact("live-project.json", live);
    await artifact("synthetic-project.json", sample);
    const searchRoute = `/api/projects/${live.id}/search-visibility`;
    for (const options of [
      {},
      { operator: true },
      { cookie: other.cookie, operator: true },
    ])
      await request(searchRoute, {
        ...options,
        body: {},
        expected: 404,
        label: "search-anonymous-or-cross-visitor-denied",
      });
    await request(searchRoute, {
      cookie: owner.cookie,
      operator: true,
      body: { query: "substituted-query" },
      expected: 400,
      label: "search-arbitrary-input-denied-before-provider",
    });
    await request(`/api/projects/${sample.id}/search-visibility`, {
      cookie: owner.cookie,
      operator: true,
      body: {},
      expected: 400,
      label: "search-non-homepage-target-denied",
    });
    await request(`/api/projects/${sample.id}/audits`, {
      cookie: owner.cookie,
      body: {},
      expected: 409,
      label: "unapproved-synthetic-plan-rejected",
    });
    const checks = sample.checks.map((check) => ({
      ...check,
      approved: check.kind !== "manual",
    }));
    const approved = (
      await request(`/api/projects/${sample.id}/checks`, {
        cookie: owner.cookie,
        method: "PUT",
        body: { checks },
        label: "explicit-agent-approval-of-synthetic-checks",
      })
    ).json() as Project;
    require(isDeepStrictEqual(
      approved.checks,
      checks,
    ), "approved_check_snapshot_mismatch");
    await artifact("approved-synthetic-project.json", approved);
    let audit = (
      await request(`/api/projects/${sample.id}/audits`, {
        cookie: owner.cookie,
        body: {},
        expected: 202,
        label: "start-one-real-synthetic-chromium-audit",
      })
    ).json() as Audit;
    require(z.string().uuid().safeParse(audit.id).success &&
      audit.projectId === sample.id, "audit_identity_mismatch");
    const auditId = audit.id;
    const pollDeadline = Math.min(deadline, Date.now() + 90_000);
    while (
      ["queued", "running"].includes(audit.status) &&
      Date.now() < pollDeadline
    ) {
      await pause(1000, undefined, { signal: controller.signal });
      audit = (
        await request(`/api/audits/${auditId}`, {
          cookie: owner.cookie,
          label: "poll-real-synthetic-browser-audit",
        })
      ).json() as Audit;
    }
    await artifact("synthetic-audit.json", audit);
    require(audit.status === "completed" &&
      audit.id === auditId &&
      audit.projectId === sample.id &&
      audit.source?.target === "sample" &&
      audit.source.url === SAMPLE_URL &&
      audit.source.sampleVariant === "broken" &&
      audit.source.brief === sample.brief &&
      audit.source.generator.provider === "Deterministic parser" &&
      audit.source.generator.model === null &&
      isDeepStrictEqual(
        audit.checks,
        checks,
      ), "completed_audit_source_mismatch");
    require(audit.results.length === checks.length &&
      audit.results.every(
        (result) =>
          checks.some(
            (check) =>
              check.id === result.checkId &&
              check.kind === result.kind &&
              check.requirement === result.requirement &&
              check.expected === result.expected,
          ) && result.evidence.url === SAMPLE_URL,
      ), "observed_result_plan_binding_mismatch");
    const counts = Object.fromEntries(
      (["passed", "failed", "blocked", "unverified"] as ResultStatus[]).map(
        (status) => [
          status,
          audit.results.filter((result) => result.status === status).length,
        ],
      ),
    );
    receipt.audit = {
      id: audit.id,
      projectId: sample.id,
      counts,
      expectedBuiltInFixtureCounts: {
        passed: 2,
        failed: 3,
        blocked: 0,
        unverified: 1,
      },
      sourceTarget: audit.source.target,
      sampleVariant: audit.source.sampleVariant,
      generator: audit.source.generator,
      unapprovedPlanRejected: true,
      approvalActorType: "agent",
      humanApproval: false,
    };
    require(isDeepStrictEqual(counts, {
      passed: 2,
      failed: 3,
      blocked: 0,
      unverified: 1,
    }) &&
      audit.results.every(
        (result) => result.kind !== "manual" || result.status === "unverified",
      ), "unexpected_observed_sample_counts");
    let persistence = (
      await request(`/api/audits/${audit.id}/persistence`, {
        cookie: owner.cookie,
        label: "read-tiger-persistence-state",
      })
    ).json() as { status?: string; expiresAt?: string };
    if (persistence.status === "not_configured")
      receipt.tiger = {
        status: "not_configured",
        scope: "No persistence claim made.",
      };
    else {
      for (let poll = 0; persistence.status === "saving" && poll < 12; poll++) {
        await pause(1000, undefined, { signal: controller.signal });
        persistence = (
          await request(`/api/audits/${audit.id}/persistence`, {
            cookie: owner.cookie,
            label: "poll-tiger-persistence",
          })
        ).json() as typeof persistence;
      }
      await artifact("tiger-persistence.json", persistence);
      require(persistence.status === "saved" &&
        typeof persistence.expiresAt === "string" &&
        Date.parse(persistence.expiresAt) >
          Date.now(), "tiger_write_not_confirmed");
      const stored = await request(`/api/audits/${audit.id}`, {
        cookie: owner.cookie,
        label: "read-exact-audit-back-from-tiger",
      });
      const storedAudit = stored.json();
      await artifact("tiger-read.json", {
        storage: stored.response.headers.get("X-Briefstamp-Storage"),
        audit: storedAudit,
      });
      require(stored.response.headers.get("X-Briefstamp-Storage") === "tiger" &&
        isDeepStrictEqual(
          storedAudit,
          audit,
        ), "tiger_exact_round_trip_not_verified");
      receipt.tiger = {
        status: "verified_saved_and_exact_read",
        expiresAt: persistence.expiresAt,
        jsonRoundTripEqual: true,
        screenshotScope:
          "References only; downloaded PNG bytes are separate HTTP evidence.",
      };
    }
    for (const [index, result] of audit.results.entries()) {
      if (result.kind === "manual") continue;
      require(typeof result.evidence.screenshot === "string" &&
        result.evidence.screenshot.startsWith(
          `/evidence/${audit.id}/`,
        ), "screenshot_reference_missing");
      const screenshot = await request(result.evidence.screenshot, {
        cookie: owner.cookie,
        label: "download-real-browser-screenshot",
      });
      require(screenshot.bytes.subarray(0, 8).toString("hex") ===
        "89504e470d0a1a0a", "screenshot_not_png");
      await artifact(`synthetic-${index + 1}-screenshot.png`, screenshot.bytes);
    }
    const report = await request(`/api/audits/${audit.id}/report`, {
      cookie: owner.cookie,
      maximum: 8 * 1024 * 1024,
      label: "download-real-browser-html-report",
    });
    require(report.bytes.toString("utf8").includes("data:image/png;base64,") &&
      report.bytes
        .toString("utf8")
        .includes("Briefstamp"), "self_contained_report_missing");
    await artifact("synthetic-report.html", report.bytes);
    await request(`/api/audits/${audit.id}/report`, {
      cookie: other.cookie,
      expected: 404,
      label: "cross-visitor-report-denied",
    });
    const speechRoute = `/api/audits/${audit.id}/spoken-report`;
    for (const options of [
      {},
      { operator: true },
      { cookie: other.cookie, operator: true },
    ])
      await request(speechRoute, {
        ...options,
        body: {},
        expected: 404,
        label: "speech-anonymous-or-cross-visitor-denied",
      });
    await request(speechRoute, {
      cookie: owner.cookie,
      operator: true,
      body: { text: "substituted-text", voice: "substituted-voice" },
      expected: 400,
      label: "speech-arbitrary-input-denied-before-provider",
    });
    if (runBackboard) {
      for (const route of [
        `/api/audits/${audit.id}/memory`,
        `/api/projects/${sample.id}/memory/search`,
      ]) {
        await request(route, {
          cookie: owner.cookie,
          body: route.endsWith("/search") ? { kind: "heading" } : {},
          expected: 404,
          label: "backboard-tokenless-denied",
        });
        await request(route, {
          cookie: other.cookie,
          operator: true,
          body: route.endsWith("/search") ? { kind: "heading" } : {},
          expected: 404,
          label: "backboard-cross-visitor-denied",
        });
      }
    }
    receipt.securityControls = {
      anonymousProviderRoutes: 404,
      crossVisitorProviderRoutes: 404,
      substitutedInput: 400,
      providerCallsDuringControls: 0,
      scope:
        "HTTP observations plus reviewed server guard ordering; no separate provider-side request counter is inferred.",
    };
    await persist();
    await attempt("serpapi-search", async () => {
      const search = (
        await request(searchRoute, {
          cookie: owner.cookie,
          operator: true,
          body: {},
          label: "one-real-hosted-serpapi-search",
        })
      ).json() as {
        provider?: string;
        domain?: string;
        query?: string;
        status?: string;
        results?: Array<{
          title: string;
          url: string;
          position: number | null;
        }>;
        limitation?: string;
      };
      require(search.provider === "SerpApi" &&
        search.status === "observed" &&
        search.domain === "flowproof-demo.onrender.com" &&
        search.query === "site:flowproof-demo.onrender.com" &&
        Array.isArray(search.results) &&
        search.results.length <= 5, "serpapi_observation_schema_mismatch");
      require(search.results.every((result) => {
        const url = new URL(result.url);
        return (
          url.protocol === "https:" &&
          url.hostname === "flowproof-demo.onrender.com" &&
          !url.username &&
          !url.password &&
          typeof result.title === "string"
        );
      }), "serpapi_result_scope_mismatch");
      await artifact("serpapi-search.json", search);
      outcomes["serpapi-search"] = {
        status: "observed",
        provider: "SerpApi",
        query: search.query,
        resultCount: search.results.length,
        auditOutcomeChanged: false,
        scope:
          "One bounded search observation, not an audit pass or indexing guarantee.",
      };
    });
    await attempt("elevenlabs-speech", async () => {
      const audio = await request(speechRoute, {
        cookie: owner.cookie,
        operator: true,
        body: {},
        maximum: 2 * 1024 * 1024,
        label: "one-real-hosted-elevenlabs-sample-speech",
      });
      const attribution = audio.response.headers.get(
          "X-Briefstamp-Attribution",
        ),
        scope = audio.response.headers.get("X-Briefstamp-Scope"),
        reserved = audio.response.headers.get(
          "X-Briefstamp-Reserved-Characters",
        ),
        reported = audio.response.headers.get(
          "X-Briefstamp-Reported-Characters",
        );
      const narration = sampleNarration(audit);
      require((audio.response.headers.get("content-type") ?? "").startsWith(
        "audio/mpeg",
      ) &&
        audio.bytes.length > 0 &&
        attribution ===
          "Voice generated with ElevenLabs. Noncommercial synthetic demonstration only." &&
        scope === "noncommercial-synthetic-demonstration" &&
        reserved === String(narration.length) &&
        narration.length <= 1000 &&
        (reported === "unreported" ||
          /^\d+$/.test(
            reported ?? "",
          )), "elevenlabs_audio_headers_or_character_binding_mismatch");
      await artifact("elevenlabs-synthetic-report.mp3", audio.bytes);
      await artifact("elevenlabs-narration.txt", narration);
      const metadata = {
        status: "mp3_received",
        provider: "ElevenLabs",
        model: "eleven_multilingual_v2",
        voiceId: "JBFqnCBsd6RMkjVDRZzb",
        modelAndVoiceEvidence:
          "Fixed adapter request configuration in sourceCommit; the hosted response does not independently report a model or voice identifier.",
        mimeType: "audio/mpeg",
        bytes: audio.bytes.length,
        sha256: sha(audio.bytes),
        attribution,
        scope,
        reservedCharacters: narration.length,
        reportedCharacters: reported === "unreported" ? null : Number(reported),
        statusCountsReadFrom: "synthetic-audit.json",
        narration: "elevenlabs-narration.txt",
        decodingVerified: false,
        listeningVerified: false,
        limitation:
          "Received bounded MP3 bytes and counts-bound narration. Audio decoding, audible wording and playback require independent verification; no commercial license or additional audit verification is claimed.",
      };
      await artifact("elevenlabs-audio-receipt.json", metadata);
      outcomes["elevenlabs-speech"] = metadata;
    });
    if (runBackboard) {
      await attempt("backboard-write", async () => {
        const write = (
          await request(`/api/audits/${audit.id}/memory`, {
            cookie: owner.cookie,
            operator: true,
            body: {},
            label: "one-real-hosted-backboard-memory-write",
          })
        ).json() as {
          provider?: string;
          status?: string;
          projectScope?: string;
          auditScope?: string;
          persistedAndRetrieved?: boolean;
        };
        await artifact("backboard-write.json", write);
        require(write.provider === "Backboard" &&
          write.status === "accepted" &&
          write.projectScope === scopeHash(sample.id) &&
          write.auditScope === scopeHash(audit.id) &&
          write.persistedAndRetrieved ===
            false, "backboard_write_scope_mismatch");
        outcomes["backboard-write"] = {
          status: "accepted",
          projectScope: write.projectScope,
          auditScope: write.auditScope,
          scope: "Acceptance alone is not retrieval verification.",
        };
      });
      if (outcomes["backboard-write"]?.status === "accepted") {
        // One indexing delay before one search. This is not a failed-request retry.
        await pause(3000, undefined, { signal: controller.signal });
        await attempt("backboard-search", async () => {
          const recall = (
            await request(`/api/projects/${sample.id}/memory/search`, {
              cookie: owner.cookie,
              operator: true,
              body: { kind: "heading" },
              label: "one-real-hosted-backboard-memory-search",
            })
          ).json() as {
            provider?: string;
            memories?: Array<{
              project: string;
              audit: string;
              observedAt: string;
              facts: Array<{ kind: string; status: string }>;
            }>;
          };
          await artifact("backboard-search.json", recall);
          const match = recall.memories?.find(
            (memory) =>
              memory.project === scopeHash(sample.id) &&
              memory.audit === scopeHash(audit.id),
          );
          const facts = (items: Array<{ kind: string; status: string }>) =>
            items.map(({ kind, status }) => `${kind}:${status}`).sort();
          require(recall.provider === "Backboard" &&
            match &&
            match.observedAt === audit.completedAt &&
            match.facts.length === audit.results.length &&
            isDeepStrictEqual(
              facts(match.facts),
              facts(audit.results),
            ), "backboard_exact_saved_facts_not_retrieved");
          outcomes["backboard-search"] = {
            status: "stored_and_retrieved",
            matchingProjectHash: scopeHash(sample.id),
            matchingAuditHash: scopeHash(audit.id),
            matchingFacts: match.facts,
            scope:
              "Saved historical observations; no inference call or new browser evidence. Account balance is checked separately by the operator.",
          };
        });
      } else
        outcomes["backboard-search"] = {
          status: "not_attempted",
          reason: "The single write was not confirmed; no search budget spent.",
        };
    }
    const untouched = (
      await request(`/api/audits/${audit.id}`, {
        cookie: owner.cookie,
        label: "confirm-providers-did-not-alter-audit",
      })
    ).json();
    require(isDeepStrictEqual(
      untouched,
      audit,
    ), "providers_changed_browser_audit");
    receipt.browserAuditUnchangedAfterProviders = true;
    receipt.status = Object.values(outcomes).some(
      (value) =>
        value.status === "failed_or_blocked" ||
        value.status === "not_attempted",
    )
      ? "partially_verified_provider_failure"
      : "verified";
    if (receipt.status !== "verified") process.exitCode = 1;
  } catch (error) {
    receipt.status = "failed_or_blocked";
    receipt.failureCode =
      error instanceof VerificationFailure
        ? error.code
        : "unexpected_local_or_schema_failure";
    receipt.failureScope =
      "No retry performed. Existing artifacts remain; incomplete operations are not marked passed.";
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    receipt.completedAt = new Date().toISOString();
    if (stateCreated) {
      state.status = String(receipt.status);
      await jsonFile(stateFile, state);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await persist();
      await jsonFile(path.join(directory, "manifest.json"), {
        version: 1,
        sourceCommit: receipt.sourceCommit,
        generatedAt: receipt.completedAt,
        artifacts,
      });
    }
    console.log(
      JSON.stringify({
        status: receipt.status,
        receipt: stateCreated
          ? path.relative(process.cwd(), path.join(directory, "receipt.json"))
          : null,
        failureCode: receipt.failureCode,
        attemptedProviderOperations: state.attemptedOperations,
        settingsOrPaymentChanges: 0,
      }),
    );
  }
}
