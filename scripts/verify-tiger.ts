import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Audit, Project } from "../shared/types";

// This is an integration probe, never a provider-provisioning or billing tool.
// The operator must independently verify the allowance before providing this file.
export interface FreeConfirmation {
  provider: "Tiger Data";
  serviceId: string;
  hostname: string;
  checkedAt: string;
  expiresAt: string;
  basis: "free-plan" | "trial-no-card" | "sponsor-credit-with-hard-cap";
  outOfPocketLimit: 0;
  automaticPaidConversion: false;
  confirmedBy: string;
  evidenceUrl: string;
}

class VerificationError extends Error {}
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new VerificationError(message);
}
export function validateConfirmation(
  input: unknown,
  connection: string | undefined,
  serviceId: string | undefined,
  now = Date.now(),
) {
  requireThat(
    connection,
    "TIGER_DATABASE_URL is required; local fallback is forbidden.",
  );
  requireThat(
    serviceId && /^[a-zA-Z0-9_-]{3,120}$/.test(serviceId),
    "An explicit TIGER_SERVICE_ID is required.",
  );
  let url: URL;
  try {
    url = new URL(connection);
  } catch {
    throw new VerificationError("TIGER_DATABASE_URL must be a PostgreSQL URL.");
  }
  requireThat(
    ["postgres:", "postgresql:"].includes(url.protocol),
    "Use a PostgreSQL connection URL.",
  );
  requireThat(
    url.username && url.password && url.pathname.length > 1,
    "The dedicated Tiger connection must identify a database and authenticated user.",
  );
  // A hostname alone does not establish sponsor ownership: it must also match
  // the exact service identity checked in the provider console below.
  requireThat(
    /^[a-z0-9.-]+\.(?:tsdb\.cloud\.timescale\.com|tigerdata\.com)$/i.test(
      url.hostname,
    ),
    "The connection must use a Tiger Data cloud service hostname.",
  );
  requireThat(!url.hash, "Connection URL fragments are not supported.");
  const value = input as Partial<FreeConfirmation> | null;
  requireThat(
    value && value.provider === "Tiger Data",
    "A Tiger Data free-resource confirmation is required.",
  );
  requireThat(
    value.serviceId === serviceId && value.hostname === url.hostname,
    "The confirmation must match this exact service ID and database hostname.",
  );
  requireThat(
    value.outOfPocketLimit === 0 && value.automaticPaidConversion === false,
    "Confirm a zero out-of-pocket limit and no automatic paid conversion.",
  );
  requireThat(
    ["free-plan", "trial-no-card", "sponsor-credit-with-hard-cap"].includes(
      value.basis || "",
    ),
    "Document the verified free-resource basis.",
  );
  const checked = Date.parse(value.checkedAt || ""),
    expires = Date.parse(value.expiresAt || "");
  requireThat(
    Number.isFinite(checked) &&
      checked <= now &&
      now - checked <= 24 * 60 * 60_000,
    "The free allowance must have been checked within the past 24 hours.",
  );
  requireThat(
    Number.isFinite(expires) && expires > now + 10 * 60_000,
    "The confirmed allowance must remain valid for at least ten minutes.",
  );
  requireThat(
    typeof value.confirmedBy === "string" &&
      value.confirmedBy.trim().length >= 2 &&
      value.confirmedBy.length <= 120,
    "Record who verified the free allowance.",
  );
  let evidence: URL;
  try {
    evidence = new URL(value.evidenceUrl || "");
  } catch {
    throw new VerificationError("Record the provider evidence URL.");
  }
  requireThat(
    evidence.protocol === "https:" &&
      !evidence.username &&
      !evidence.password &&
      !evidence.search &&
      !evidence.hash &&
      /(^|\.)(tigerdata\.com|timescale\.com)$/.test(evidence.hostname),
    "The allowance evidence must be an HTTPS Tiger Data/Timescale source without credentials, query parameters or fragments.",
  );
  // Do not let URL parameters weaken certificate verification or redirect the
  // search path. The controller supplies its own single-use schema instead.
  for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
  const confirmation: FreeConfirmation = {
    provider: "Tiger Data",
    serviceId,
    hostname: url.hostname,
    checkedAt: value.checkedAt!,
    expiresAt: value.expiresAt!,
    basis: value.basis!,
    outOfPocketLimit: 0,
    automaticPaidConversion: false,
    confirmedBy: value.confirmedBy!,
    evidenceUrl: evidence.toString(),
  };
  return { confirmation, connectionString: url.toString() };
}

export function schemaName(id: string) {
  const compact = id.replaceAll("-", "");
  requireThat(
    /^[a-f0-9]{32}$/.test(compact),
    "Invalid verification schema identifier.",
  );
  return `flowproof_verify_${compact}`;
}
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const script = fileURLToPath(import.meta.url);
const connect = (connectionString: string) =>
  new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    application_name: "flowproof-tiger-verification",
  });
async function writeJson(filename: string, value: unknown) {
  await fs.writeFile(filename, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
}
type Manifest = {
  projects: Project[];
  audits: Audit[];
  screenshots: { path: string; sha256: string; bytes: number }[];
};
type WorkerContext = { connectionString: string; root: string; schema: string };

function cleanEnvironment() {
  const env = { ...process.env };
  // libpq/pg environment settings must not override the verified connection.
  for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];
  return env;
}
async function worker(phase: "write" | "read", context: WorkerContext) {
  const scoped = new URL(context.connectionString);
  scoped.searchParams.set("options", `-c search_path=${context.schema}`);
  const childEnv = {
    ...cleanEnvironment(),
    DATABASE_URL: scoped.toString(),
    DATABASE_SSL: "true",
    FLOWPROOF_DATA_DIR: path.join(context.root, phase),
    FLOWPROOF_EMBEDDINGS: "true",
    FLOWPROOF_EMBEDDING_MODEL: "all-minilm:22m",
    FLOWPROOF_AI_ENABLED: "false",
    FLOWPROOF_GEMMA_ENABLED: "false",
    FLOWPROOF_TIGER_WORKER_CONTEXT: JSON.stringify({
      root: context.root,
      schema: context.schema,
    }),
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", script, "--worker", phase],
      {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // Child outputs are intentionally not forwarded: connection errors can
    // contain service details. A small, sanitized diagnostic is written below.
    child.stdout.resume();
    child.stderr.resume();
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new VerificationError(
          `${phase} phase exceeded its five-minute budget.`,
        ),
      );
    }, 300_000);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(
        new VerificationError(
          `Could not start the ${phase} verification process.`,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(
            new VerificationError(
              `${phase} phase failed; inspect its sanitized error receipt.`,
            ),
          );
    });
  });
}

async function runWorker(phase: string) {
  requireThat(
    phase === "write" || phase === "read",
    "Unknown verification phase.",
  );
  requireThat(
    process.env.TIGER_FREE_CONFIRMATION_FILE,
    "Run the controller with a free-resource confirmation.",
  );
  const gate = validateConfirmation(
    JSON.parse(
      await fs.readFile(process.env.TIGER_FREE_CONFIRMATION_FILE, "utf8"),
    ),
    process.env.TIGER_DATABASE_URL,
    process.env.TIGER_SERVICE_ID,
  );
  const context = JSON.parse(
    process.env.FLOWPROOF_TIGER_WORKER_CONTEXT || "{}",
  ) as { root: string; schema: string };
  requireThat(
    typeof context.root === "string" &&
      /^flowproof_verify_[a-f0-9]{32}$/.test(context.schema),
    "Run the controller; do not invoke workers directly.",
  );
  const expectedConnection = new URL(gate.connectionString);
  expectedConnection.searchParams.set(
    "options",
    `-c search_path=${context.schema}`,
  );
  requireThat(
    process.env.DATABASE_URL === expectedConnection.toString() &&
      process.env.DATABASE_SSL === "true",
    "The worker connection must preserve the verified database and isolated schema.",
  );
  const store = await import("../server/store");
  const manifestPath = path.join(context.root, "manifest.json");
  let db: pg.Pool | undefined;
  try {
    await store.initStore();
    if (phase === "write") {
      const { runAudit } = await import("../server/runner");
      const { SAMPLE_URL, SAMPLE_BRIEF, sampleChecks } = await import(
        "../server/sample"
      );
      const { embed } = await import("../server/embeddings");
      requireThat(
        await embed("FlowProof local embedding readiness"),
        "Local all-minilm:22m embedding inference is unavailable. No vector success is claimed.",
      );
      const manifest: Manifest = { projects: [], audits: [], screenshots: [] };
      for (const variant of ["healthy", "broken"] as const) {
        const createdAt = new Date().toISOString(),
          checks = sampleChecks(true);
        const project: Project = {
          id: randomUUID(),
          name: `Tiger verification — ${variant} synthetic sample`,
          url: SAMPLE_URL,
          target: "sample",
          sampleVariant: variant,
          authorized: true,
          brief: SAMPLE_BRIEF,
          checks,
          createdAt,
          updatedAt: createdAt,
          generator: {
            provider: "Approved synthetic fixture; no AI generation",
            model: null,
          },
        };
        await store.saveProject(project);
        const audit: Audit = {
          id: randomUUID(),
          projectId: project.id,
          projectName: project.name,
          status: "running",
          createdAt,
          checks,
          results: [],
        };
        await store.saveAudit(audit);
        audit.results = await runAudit(project, audit, () => {}, {
          evidenceRoot: path.join(store.dataRoot, "evidence"),
        });
        const expected =
          variant === "healthy"
            ? ["passed", "passed", "passed", "passed", "passed", "unverified"]
            : ["failed", "passed", "failed", "failed", "failed", "unverified"];
        assert.deepEqual(
          audit.results.map((r) => r.status),
          expected,
          "Real browser outcomes must match the healthy/broken fixture.",
        );
        audit.status = "completed";
        audit.completedAt = new Date().toISOString();
        await store.saveAudit(audit);
        manifest.projects.push(project);
        manifest.audits.push(audit);
        for (const result of audit.results)
          if (result.evidence.screenshot) {
            const image = await store.readEvidence(result.evidence.screenshot);
            requireThat(
              image && image.length > 1000,
              "Every executed fixture check must have screenshot bytes.",
            );
            manifest.screenshots.push({
              path: result.evidence.screenshot,
              sha256: sha256(image),
              bytes: image.length,
            });
          }
      }
      await writeJson(manifestPath, manifest);
      await writeJson(path.join(context.root, "write.json"), {
        status: "passed",
        processId: process.pid,
        database: store.storageMode,
        audits: manifest.audits.map((a) => ({
          id: a.id,
          results: a.results.map((r) => ({
            checkId: r.checkId,
            status: r.status,
          })),
        })),
        screenshots: manifest.screenshots,
      });
    } else {
      const manifest = JSON.parse(
        await fs.readFile(manifestPath, "utf8"),
      ) as Manifest;
      // initStore never creates an evidence directory. A different data root
      // and a fresh process force all screenshot reads through PostgreSQL.
      await assert.rejects(fs.access(path.join(store.dataRoot, "evidence")));
      for (const project of manifest.projects)
        assert.deepEqual(store.getProject(project.id), project);
      for (const audit of manifest.audits)
        assert.deepEqual(store.getAudit(audit.id), audit);
      for (const expected of manifest.screenshots) {
        const image = await store.readEvidence(expected.path);
        requireThat(
          image &&
            sha256(image) === expected.sha256 &&
            image.length === expected.bytes,
          "Database-restored screenshot bytes differ from the browser capture.",
        );
      }
      db = connect(process.env.DATABASE_URL!);
      const sql = await db.query(
        "SELECT count(*)::int AS failures, count(embedding)::int AS vectors FROM flowproof_failures",
      );
      assert.deepEqual(sql.rows[0], { failures: 4, vectors: 4 });
      const mobile = manifest.audits
        .flatMap((a) => a.results)
        .find(
          (r) => r.status === "failed" && r.kind === "no_horizontal_overflow",
        )!;
      process.env.FLOWPROOF_EMBEDDINGS = "false";
      const lexicalQuery = "horizontal";
      const lexical = await store.searchFailures(lexicalQuery);
      requireThat(
        lexical.mode === "PostgreSQL full-text retrieval" &&
          lexical.results.some((r) => r.requirement === mobile.requirement),
        "Lexical retrieval did not recover the known layout failure.",
      );
      const semanticQuery = "sideways panning on smartphones";
      const lexicalMatches = await db.query(
        "SELECT count(*)::int AS count FROM flowproof_failures WHERE search @@ websearch_to_tsquery('english',$1)",
        [semanticQuery],
      );
      requireThat(
        lexicalMatches.rows[0].count === 0,
        "The semantic probe unexpectedly matches lexically; choose a new fixed paraphrase before another run.",
      );
      process.env.FLOWPROOF_EMBEDDINGS = "true";
      const semantic = await store.searchFailures(semanticQuery);
      requireThat(
        semantic.mode === "PostgreSQL lexical + MiniLM vector retrieval",
        "Vector inference fell back; do not claim vector verification.",
      );
      const { embed } = await import("../server/embeddings");
      const queryVector = await embed(semanticQuery);
      requireThat(
        queryVector,
        "Could not independently recompute the query embedding.",
      );
      const saved = await db.query(
        "SELECT requirement, embedding FROM flowproof_failures",
      );
      const recomputed = saved.rows
        .map((r: { requirement: string; embedding: number[] }) => {
          requireThat(
            r.embedding.length === 384 && r.embedding.every(Number.isFinite),
            "Invalid stored embedding dimensions or values.",
          );
          const norm = Math.sqrt(
            r.embedding.reduce((sum, x) => sum + x * x, 0),
          );
          requireThat(
            Math.abs(norm - 1) < 0.000001,
            "Stored vector is not normalized.",
          );
          return {
            requirement: r.requirement,
            similarity: r.embedding.reduce(
              (sum, x, i) => sum + x * queryVector[i],
              0,
            ),
          };
        })
        .sort((a, b) => b.similarity - a.similarity);
      const ranked = semantic.results as {
        requirement: string;
        similarity: number;
      }[];
      assert.deepEqual(
        ranked.map((r) => r.requirement),
        recomputed.map((r) => r.requirement),
      );
      for (let i = 0; i < ranked.length; i++)
        requireThat(
          Math.abs(ranked[i].similarity - recomputed[i].similarity) < 0.000001,
          "SQL similarity differs from independently computed cosine similarity.",
        );
      requireThat(
        new Set(ranked.map((r) => r.similarity.toFixed(6))).size > 1,
        "The vector ranking is degenerate.",
      );
      const relevantRank =
        ranked.findIndex((r) => r.requirement === mobile.requirement) + 1;
      await writeJson(path.join(context.root, "read.json"), {
        status: "passed",
        processId: process.pid,
        freshProcess: true,
        emptyLocalEvidenceDirectory: true,
        recoveredProjects: manifest.projects.length,
        recoveredAudits: manifest.audits.length,
        recoveredScreenshots: manifest.screenshots.length,
        screenshotHashesMatch: true,
        storedFailures: 4,
        storedVectors: 4,
        lexical: {
          query: lexicalQuery,
          mode: lexical.mode,
          results: lexical.results,
        },
        vector: {
          query: semanticQuery,
          lexicalMatches: 0,
          mode: semantic.mode,
          model: "all-minilm:22m",
          dimensions: 384,
          independentCosineCheck: true,
          relevantRequirement: mobile.requirement,
          relevantRank,
          relevantAtRankOne: relevantRank === 1,
          results: ranked,
        },
        limitation:
          "Two synthetic audits establish integration execution, not retrieval-quality benchmarks or model improvement.",
      });
    }
  } catch (error) {
    await writeJson(
      path.join(context.root, `${phase}-error.json`),
      sanitizedFailure(error),
    );
    throw error;
  } finally {
    await db?.end();
    await store.closeStore();
  }
}

export function sanitizedFailure(error: unknown) {
  return {
    status: "not_verified",
    error:
      error instanceof VerificationError
        ? error.message
        : "The operation failed. Raw database/browser diagnostics are omitted to avoid exposing connection details.",
    code:
      error &&
      typeof error === "object" &&
      "code" in error &&
      /^[A-Z0-9_]{1,40}$/.test(String(error.code))
        ? String(error.code)
        : null,
  };
}

async function main() {
  const confirmationFile = process.env.TIGER_FREE_CONFIRMATION_FILE;
  requireThat(
    confirmationFile,
    "TIGER_FREE_CONFIRMATION_FILE must identify a recent, independently verified allowance receipt.",
  );
  const config = validateConfirmation(
    JSON.parse(await fs.readFile(confirmationFile, "utf8")),
    process.env.TIGER_DATABASE_URL,
    process.env.TIGER_SERVICE_ID,
  );
  const id = randomUUID(),
    schema = schemaName(id);
  const root = path.resolve(
    process.env.FLOWPROOF_TIGER_OUTPUT ||
      path.join("work", "tiger-verification", id),
  );
  // Refuse an existing directory so old receipts cannot be mistaken for this run.
  await fs.mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
  await fs.mkdir(root, { mode: 0o700 });
  const db = connect(config.connectionString);
  let created = false,
    stage = "tls_preflight",
    failure: unknown;
  const receipt: Record<string, unknown> = {
    status: "not_verified",
    startedAt: new Date().toISOString(),
    provider: "Tiger Data",
    scope:
      "Dedicated temporary schema, synthetic browser audits, local MiniLM embeddings; public visitor storage unchanged",
    serviceId: config.confirmation.serviceId,
    databaseHostname: config.confirmation.hostname,
    schema,
    freeAllowance: config.confirmation,
    strictCertificateVerification: true,
    providerProvisioningPerformed: false,
    paidInferencePerformed: false,
    publicDemoDatabaseEnabled: false,
  };
  try {
    try {
      receipt.commit = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      receipt.worktreeDirty = Boolean(
        execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      );
    } catch {
      receipt.commit = null;
      receipt.worktreeDirty = null;
    }
    receipt.sourceSha256 = Object.fromEntries(
      await Promise.all(
        [
          "scripts/verify-tiger.ts",
          "server/store.ts",
          "server/embeddings.ts",
          "server/runner.ts",
          "server/sample.ts",
        ].map(async (file) => [file, sha256(await fs.readFile(file))]),
      ),
    );
    const tls = await db.query(
      "SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
    );
    requireThat(
      tls.rows.length === 1 && tls.rows[0].ssl === true,
      "The database connection did not establish TLS.",
    );
    receipt.tls = tls.rows[0];
    stage = "create_isolated_schema";
    await db.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    stage = "write";
    await worker("write", {
      connectionString: config.connectionString,
      root,
      schema,
    });
    stage = "fresh_process_read";
    await worker("read", {
      connectionString: config.connectionString,
      root,
      schema,
    });
    receipt.write = JSON.parse(
      await fs.readFile(path.join(root, "write.json"), "utf8"),
    );
    receipt.read = JSON.parse(
      await fs.readFile(path.join(root, "read.json"), "utf8"),
    );
    receipt.status = "verified";
  } catch (error) {
    failure = error;
    receipt.failedStage = stage;
    receipt.failure = sanitizedFailure(error);
  } finally {
    if (created) {
      try {
        // The only destructive operation is restricted to this generated schema.
        await db.query(`DROP SCHEMA "${schema}" CASCADE`);
        receipt.temporarySchemaRemoved = true;
      } catch (error) {
        receipt.temporarySchemaRemoved = false;
        receipt.cleanupFailure = sanitizedFailure(error);
        failure ||= error;
      }
    } else receipt.temporarySchemaRemoved = null;
    await db.end();
    receipt.finishedAt = new Date().toISOString();
    await writeJson(path.join(root, "receipt.json"), receipt);
  }
  console.log(`Tiger verification receipt: ${path.join(root, "receipt.json")}`);
  if (failure) throw failure;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const task =
    process.argv[2] === "--worker" ? runWorker(process.argv[3]) : main();
  task.catch((error) => {
    console.error(JSON.stringify(sanitizedFailure(error)));
    process.exitCode = 1;
  });
}
