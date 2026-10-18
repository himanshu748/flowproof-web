import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the same entrypoint and heap ceiling as the free public deployment.
// No .env file, provider credentials, mock runner, or external target is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const startedAt = new Date().toISOString();
const output = path.join(
  root,
  "work/public-runtime",
  startedAt.replaceAll(":", "-"),
);
const temporary = await mkdtemp(
  path.join(tmpdir(), "briefstamp-public-runtime-"),
);
const deadline = new AbortController();
const totalTimer = setTimeout(
  () => deadline.abort(new Error("Public runtime exceeded 210 seconds")),
  210_000,
);
const receipt = {
  startedAt,
  status: "running",
  scope:
    "Real public demo HTTP API and Chromium, synthetic samples, 96 MB V8 heap",
  approvalActor:
    "Automated synthetic verification harness; not human or customer approval",
  externalProvidersEnabled: false,
  privateSdkImportsRejected: ["@mastra/", "@sentry/", "@temporalio/"],
  audits: [],
};
let child;
let exited;
let spawnError;
let stdout = "";
let stderr = "";
let cookie = "";
let base;
const appendBounded = (previous, chunk) =>
  (previous + chunk.toString("utf8")).slice(-65_536);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertAlive() {
  if (spawnError) throw spawnError;
  if (exited)
    throw new Error(`Public server exited early: ${JSON.stringify(exited)}`);
  deadline.signal.throwIfAborted();
}

async function unusedPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function request(
  route,
  { method = "GET", body, expected = 200, binary = false, text = false } = {},
) {
  assertAlive();
  assert(
    route.startsWith("/") && !route.startsWith("//"),
    "Only local relative requests are allowed",
  );
  const response = await fetch(base + route, {
    method,
    redirect: "error",
    signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(10_000)]),
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", origin: base }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${route} returned unexpected HTTP ${response.status}`,
  );
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    assert(
      !/;\s*Secure(?:;|$)/i.test(setCookie),
      "The isolated local test needs a non-Secure cookie",
    );
    cookie = setCookie.split(";")[0];
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert(bytes <= 4 * 1024 * 1024, "Response exceeded the 4 MiB proof limit");
    chunks.push(chunk);
  }
  assertAlive();
  const buffer = Buffer.concat(chunks);
  return binary
    ? buffer
    : text
      ? buffer.toString("utf8")
      : JSON.parse(buffer.toString("utf8"));
}

async function runVariant(project, variant) {
  const selected = await request(`/api/projects/${project.id}/variant`, {
    method: "POST",
    body: { sampleVariant: variant },
  });
  assert(
    selected.checks.every((check) => !check.approved),
    "Changing the sample must revoke approval",
  );
  const rejected = await request(`/api/projects/${project.id}/audits`, {
    method: "POST",
    body: {},
    expected: 409,
  });
  assert.match(
    rejected.error,
    /approve/i,
    "The rejection must be the approval guard",
  );
  const approvedChecks = selected.checks.map((check) => ({
    ...check,
    approved: check.kind !== "manual",
  }));
  const approved = await request(`/api/projects/${project.id}/checks`, {
    method: "PUT",
    body: { checks: approvedChecks },
  });
  assert.deepEqual(
    approved.checks,
    approvedChecks,
    "Approval must not change assertion semantics",
  );
  let audit = await request(`/api/projects/${project.id}/audits`, {
    method: "POST",
    body: {},
    expected: 202,
  });
  const auditDeadline = Date.now() + 70_000;
  while (
    ["queued", "running"].includes(audit.status) &&
    Date.now() < auditDeadline
  ) {
    await pause(500);
    audit = await request(`/api/audits/${audit.id}`);
  }
  assert.equal(
    audit.status,
    "completed",
    audit.error || `${variant} audit did not complete in 70 seconds`,
  );
  assert.equal(audit.results.length, 6);
  assert.equal(audit.source.sampleVariant, variant);
  assert.deepEqual(audit.checks, approvedChecks);
  const counts = Object.fromEntries(
    ["passed", "failed", "blocked", "unverified"].map((status) => [
      status,
      audit.results.filter((row) => row.status === status).length,
    ]),
  );
  assert.deepEqual(
    counts,
    variant === "healthy"
      ? { passed: 5, failed: 0, blocked: 0, unverified: 1 }
      : { passed: 2, failed: 3, blocked: 0, unverified: 1 },
  );
  const evidence = [];
  for (const row of audit.results) {
    assert.equal(
      row.requirement,
      approvedChecks.find((check) => check.id === row.checkId)?.requirement,
    );
    if (row.kind === "manual") {
      assert.equal(
        row.status,
        "unverified",
        "A subjective requirement must stay unverified",
      );
      continue;
    }
    assert.match(
      row.evidence.screenshot,
      /^\/evidence\/[a-f0-9-]{36}\/[a-zA-Z0-9_-]+\.png$/,
    );
    assert(row.evidence.observed.length > 0);
    const png = await request(row.evidence.screenshot, { binary: true });
    assert(png.length > 1000);
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "Evidence must be a real PNG",
    );
    const filename = `${variant}-${evidence.length + 1}.png`;
    await writeFile(path.join(output, filename), png);
    evidence.push({ file: filename, bytes: png.length, sha256: hash(png) });
  }
  assert.equal(evidence.length, 5);
  const report = await request(`/api/audits/${audit.id}/report`, {
    text: true,
  });
  assert.equal(
    (report.match(/data:image\/png;base64,/g) || []).length,
    5,
    "Portable report must embed every executed screenshot",
  );
  await writeFile(path.join(output, `${variant}-report.html`), report);
  await writeFile(
    path.join(output, `${variant}-audit.json`),
    JSON.stringify(audit, null, 2),
  );
  receipt.audits.push({
    variant,
    approvalGateHttp: 409,
    counts,
    evidence,
    reportSha256: hash(report),
  });
  console.log(
    `${variant}: ${JSON.stringify(counts)}, five real screenshots and portable report`,
  );
}

try {
  await mkdir(output, { recursive: true });
  const guardFile = path.join(temporary, "private-sdk-guard.mjs");
  const preloadFile = path.join(temporary, "register-guard.mjs");
  const markerFile = path.join(temporary, "blocked-imports.jsonl");
  const readyFile = path.join(temporary, "guard-ready");
  await writeFile(
    guardFile,
    `
import { appendFileSync, writeFileSync } from "node:fs";
let marker;
export function initialize(data) { marker = data.markerFile; writeFileSync(data.readyFile, "ready"); }
export async function resolve(specifier, context, nextResolve) {
  if (/^(?:@mastra|@sentry|@temporalio)\\//.test(specifier) || /[\\\\/]node_modules[\\\\/](?:@mastra|@sentry|@temporalio)[\\\\/]/.test(specifier)) {
    appendFileSync(marker, JSON.stringify({ specifier }) + "\\n");
    throw new Error("PUBLIC_RUNTIME_PRIVATE_SDK_IMPORT: " + specifier);
  }
  return nextResolve(specifier, context);
}
`,
  );
  await writeFile(
    preloadFile,
    `import { register } from "node:module"; register(${JSON.stringify(new URL(`file://${guardFile}`).href)}, { parentURL: import.meta.url, data: ${JSON.stringify({ markerFile, readyFile })} });\n`,
  );
  const port = await unusedPort();
  base = `http://127.0.0.1:${port}`;
  // Preserve only OS/browser-cache locations. Never spread process.env, load .env,
  // or inherit NODE_OPTIONS, database URLs, DSNs, tokens or provider allowances.
  const env = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USERPROFILE",
      "SYSTEMROOT",
      "TMPDIR",
      "TMP",
      "TEMP",
      "PLAYWRIGHT_BROWSERS_PATH",
      "XDG_CACHE_HOME",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    NODE_ENV: "test",
    CI: "true",
    PORT: String(port),
    RENDER: "false",
    FLOWPROOF_PUBLIC: "true",
    FLOWPROOF_DEMO: "true",
    FLOWPROOF_DATA_DIR: path.join(temporary, "data"),
    FLOWPROOF_AI_ENABLED: "false",
    FLOWPROOF_GEMMA_ENABLED: "false",
    FLOWPROOF_EMBEDDINGS: "false",
    FLOWPROOF_SENTRY_ENABLED: "false",
    FLOWPROOF_TEMPORAL_ENABLED: "false",
    MASTRA_TELEMETRY_DISABLED: "1",
    BRIEFSTAMP_TINKER_ENABLED: "false",
    BRIEFSTAMP_BACKBOARD_ENABLED: "false",
    BRIEFSTAMP_SERPAPI_ENABLED: "false",
    BRIEFSTAMP_ELEVENLABS_ENABLED: "false",
  });
  const args = [
    "--max-old-space-size=96",
    "--import",
    preloadFile,
    "dist-server/index.js",
  ];
  child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });
  receipt.nodeVersion = process.version;
  receipt.heapLimitMiB = 96;
  const startupDeadline = Date.now() + 40_000;
  while (
    !stdout.includes(`:${port} (isolated public demo)`) &&
    Date.now() < startupDeadline
  ) {
    assertAlive();
    await pause(200);
  }
  assert(
    stdout.includes(`:${port} (isolated public demo)`),
    "Own public server did not start within 40 seconds",
  );
  assert.equal(
    await readFile(readyFile, "utf8"),
    "ready",
    "SDK import guard must be installed",
  );
  const landingHtml = await request("/", { text: true });
  assert.match(
    landingHtml,
    /id="lp-hero-title"/,
    "The actual landing content must exist before scripts run",
  );
  assert.match(landingHtml, /Send the site\./);
  assert.match(landingHtml, /Show the proof\./);
  assert.doesNotMatch(
    landingHtml,
    /(?:href|src)="https:\/\/(?:fonts\.googleapis|fonts\.gstatic)/,
    "The protected same-origin audit must not need third-party font requests",
  );
  assert.doesNotMatch(
    landingHtml,
    /opacity:0(?:;|")/,
    "Prerendered content must remain visible with scripts disabled",
  );
  receipt.scriptFreeLandingVerified = true;
  const bootstrap = await request("/api/bootstrap");
  assert(cookie.startsWith("flowproof_demo="));
  assert.equal(bootstrap.demo.enabled, true);
  assert.equal(bootstrap.storage, "Ephemeral visitor session");
  assert.equal(
    bootstrap.audits.length,
    0,
    "The test must use fresh isolated state",
  );
  const mastra = bootstrap.integrations.find((item) => item.name === "Mastra");
  assert.equal(mastra?.status, "available");
  assert.match(mastra.detail, /local/i);
  assert.match(mastra.detail, /model orchestration is disabled/i);
  for (const name of [
    "Local open model",
    "Gemma",
    "Tiger Data",
    "Sentry",
    "Temporal",
    "Backboard",
    "SerpApi",
    "ElevenLabs",
  ]) {
    assert.equal(
      bootstrap.integrations.find((item) => item.name === name)?.status,
      "not_configured",
      `${name} must be disabled for public visitors`,
    );
  }
  const project = bootstrap.projects.find((item) => item.target === "sample");
  assert(project);
  assert.equal(project.checks.length, 6);
  assert(project.checks.every((check) => !check.approved));
  // Also exercise the two proposal endpoints that previously loaded orchestration.
  const created = await request("/api/projects", {
    method: "POST",
    expected: 201,
    body: {
      name: "Runtime proposal control",
      target: "sample",
      authorized: true,
      brief: project.brief,
    },
  });
  assert.equal(created.generator.model, null);
  const regenerated = await request(`/api/projects/${project.id}/generate`, {
    method: "POST",
    body: { brief: project.brief },
  });
  assert.equal(regenerated.generator.model, null);
  assert(regenerated.checks.every((check) => !check.approved));
  await runVariant(regenerated, "healthy");
  await runVariant(regenerated, "broken");
  assertAlive();
  const blocked = await readFile(markerFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  assert.equal(blocked, "", "Public routes attempted to load a private SDK");
  assert(
    !/heap out of memory|allocation failed|PUBLIC_RUNTIME_PRIVATE_SDK_IMPORT/i.test(
      stderr,
    ),
  );
  receipt.privateSdkImportAttempts = 0;
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = error instanceof Error ? error.message : String(error);
  console.error(`Public runtime verification failed: ${receipt.error}`);
  process.exitCode = 1;
} finally {
  clearTimeout(totalTimer);
  receipt.completedAt = new Date().toISOString();
  receipt.childExitedBeforeCleanup = exited ?? null;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("close", resolve)),
      pause(3000),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => child.once("close", resolve)),
        pause(2000),
      ]);
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "server.stdout.log"), stdout);
  await writeFile(path.join(output, "server.stderr.log"), stderr);
  await writeFile(
    path.join(output, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  await rm(temporary, { recursive: true, force: true });
  const summary = `Public runtime (96 MiB heap): **${receipt.status}**. ${receipt.audits.map((audit) => `${audit.variant}: ${audit.counts.passed} passed, ${audit.counts.failed} failed, ${audit.counts.unverified} unverified`).join("; ")}. Synthetic test-harness approval only.\n`;
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(
    `Receipt: ${path.relative(root, path.join(output, "receipt.json"))}`,
  );
  if (receipt.status === "failed" && stderr) console.error(stderr.slice(-8000));
}
