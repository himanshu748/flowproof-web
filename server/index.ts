import express from "express";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import type { Project, Audit, IntegrationStatus } from "../shared/types";
import type { Operation, SafeTelemetryAttributes } from "./observability";
import { rememberAudit, recallProjectMemory } from "./providers/backboard";
import { checkSearchVisibility } from "./providers/serpapi";
import { createSpokenSampleReport } from "./providers/elevenlabs";
import { ProviderError } from "./providers/free-resource-policy";
import { getEvaluation } from "./evaluation";
import { validateChecks } from "./schema";
import { validateTarget, redact } from "./safety";
import {
  allProjects,
  allAudits,
  getProject,
  getAudit,
  saveProject,
  saveAudit,
  searchFailures,
  initStore,
  storageMode,
  dataRoot,
  readEvidence,
} from "./store";
import { renderReport } from "./report";
import { createDemoRouter } from "./demo";
import { snapshotSource } from "../shared/compare-audits";
import { optionalIntegrations } from "./optional-integrations";
import {
  dispatchDurableAudit,
  refreshDurableAudit as refreshSavedTemporalAudit,
} from "./temporal-audit";

const publicMode = process.env.FLOWPROOF_PUBLIC === "true";
const demoMode = publicMode && process.env.FLOWPROOF_DEMO === "true";
// Private SDK graphs must not consume the free public demo's browser budget.
const observability = demoMode ? undefined : await import("./observability");
const generateChecksWithOrchestration: typeof import("./orchestration").generateChecksWithOrchestration =
  async (...args) =>
    (await import("./orchestration")).generateChecksWithOrchestration(...args);
const runAuditWithOrchestration: typeof import("./orchestration").runAuditWithOrchestration =
  async (...args) =>
    (await import("./orchestration")).runAuditWithOrchestration(...args);
const startApprovedAudit: typeof import("../temporal/client").startApprovedAudit =
  async (...args) =>
    (await import("../temporal/client")).startApprovedAudit(...args);
const readTemporalAudit: typeof import("../temporal/client").readTemporalAudit =
  async (...args) =>
    (await import("../temporal/client")).readTemporalAudit(...args);
function traceOperation<T>(
  name: Operation,
  data: SafeTelemetryAttributes,
  task: () => Promise<T>,
): Promise<T> {
  return observability
    ? observability.traceOperation(name, data, task)
    : task();
}
const token = process.env.FLOWPROOF_TOKEN || "";
if (publicMode && !demoMode && token.length < 32)
  throw new Error(
    "Public mode requires FLOWPROOF_TOKEN with at least 32 characters.",
  );
const cookieToken = createHash("sha256").update(token).digest("hex");
const equal = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
const app = express();
observability?.initObservability();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!publicMode) {
    const allowed = new Set([
      `127.0.0.1:${process.env.PORT || 4310}`,
      `localhost:${process.env.PORT || 4310}`,
      "127.0.0.1:5173",
      "localhost:5173",
    ]);
    if (!allowed.has(req.headers.host || ""))
      return res
        .status(403)
        .json({ error: "This local workspace only accepts loopback hosts." });
  }
  next();
});
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.path.startsWith("/api") || req.path.startsWith("/evidence"))
    res.setHeader("Cache-Control", "no-store");
  next();
});
// Browser writes must originate from this app, including the Vite development proxy.
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {}
    if (
      host !== req.headers.host &&
      !(!publicMode && ["127.0.0.1:5173", "localhost:5173"].includes(host))
    )
      return res
        .status(403)
        .json({ error: "This request came from another website." });
  }
  next();
});
if (demoMode) {
  // Public requests terminate in this isolated router, before operator APIs.
  app.use(
    createDemoRouter({
      evidenceRoot: path.join(dataRoot, "public-demo-evidence"),
      secureCookie:
        process.env.NODE_ENV === "production" || process.env.RENDER === "true",
    }).router,
  );
}
app.use(["/api", "/evidence"], (req, res, next) => {
  // Defense in depth: demo requests never enter private handlers, even if
  // a future router edit accidentally lets an API request fall through.
  if (demoMode)
    return res.status(404).json({ error: "Demo endpoint not found." });
  if (!token) return next();
  const header = req.headers["x-flowproof-token"];
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("flowproof_session="))
    ?.slice(18);
  if (typeof header === "string" && equal(header, token)) {
    res.cookie("flowproof_session", cookieToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: publicMode,
      maxAge: 8 * 60 * 60 * 1000,
    });
    return next();
  }
  if (cookie && equal(cookie, cookieToken)) return next();
  return res.status(401).json({
    error: "Enter the workspace access token in Settings to continue.",
  });
});
const windows = new Map<string, { start: number; count: number }>();
app.use("/api", (req, res, next) => {
  const key = req.ip || "local";
  const now = Date.now();
  if (windows.size > 1000) windows.clear();
  let w = windows.get(key);
  if (!w || now - w.start > 60000) {
    w = { start: now, count: 0 };
    windows.set(key, w);
  }
  if (++w.count > 180)
    return res
      .status(429)
      .json({ error: "Request limit reached. Try again in one minute." });
  next();
});
app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "flowproof" }),
);
const integrations = (): IntegrationStatus[] => [
  {
    name: "Playwright",
    status: "active",
    detail: "Real Chromium checks with screenshots and redacted text evidence.",
  },
  {
    name: "Tiger Data",
    status: process.env.DATABASE_URL ? "available" : "not_configured",
    detail: process.env.DATABASE_URL
      ? "PostgreSQL configured; verify this runtime's connection separately. An isolated no-card Tiger trial verified application persistence, screenshot recovery, and retrieval. The separate Shared Free service's CA remains unconfirmed."
      : "Using local JSON storage. An isolated no-card Tiger trial verified application persistence, screenshot recovery, and retrieval. The separate Shared Free service's CA remains unconfirmed.",
  },
  {
    name: "Tinker",
    status: "available",
    detail:
      "Recorded baseline/LoRA results remain separate from the operator checkpoint adapter. Live generation requires a current sampler checkpoint, credentials and a fresh confirmed-free allowance. The public sample makes no Tinker calls.",
  },
  {
    name: "Local open model",
    status:
      process.env.FLOWPROOF_AI_ENABLED === "true"
        ? "available"
        : "not_configured",
    detail:
      process.env.FLOWPROOF_AI_ENABLED === "true"
        ? "Ollama generation enabled. Each plan records the provider that actually produced it."
        : "Rule-based proposal fallback is active. Enable a local Ollama model for AI proposals.",
  },
  {
    name: "GitHub Actions",
    status: "available",
    detail:
      "Public repository browser audits have passed in GitHub Actions. Source commits and receipts are recorded in deployment evidence.",
  },
  {
    name: "Render",
    status: "not_configured",
    detail:
      "A separate public sample demo is verified on free Render. This private runtime's hosting is not established by that deployment.",
  },
  {
    name: "Gemma",
    status:
      process.env.FLOWPROOF_GEMMA_ENABLED === "true"
        ? "available"
        : "not_configured",
    detail:
      "Optional local repair suggestions grounded in observed results. Suggestions never change assertion outcomes.",
  },
  ...optionalIntegrations(false, observability?.observabilityStatus()),
];
async function refreshDurableAudit(audit: Audit): Promise<Audit> {
  if (process.env.FLOWPROOF_TEMPORAL_ENABLED !== "true") return audit;
  return refreshSavedTemporalAudit(audit, {
    save: saveAudit,
    read: readTemporalAudit,
  });
}
app.get("/api/bootstrap", async (_req, res) => {
  // A stopped worker/server must not hide the saved cockpit. Each bounded
  // refresh returns its stored audit plus a safe diagnostic on an outage.
  const audits = allAudits();
  const refreshed = await Promise.all(
    audits
      .filter((a) => a.workflow && ["running", "queued"].includes(a.status))
      .slice(0, 4)
      .map(refreshDurableAudit),
  );
  const byId = new Map(refreshed.map((a) => [a.id, a]));
  res.json({
    projects: allProjects(),
    audits: audits.map((a) => byId.get(a.id) ?? a),
    integrations: integrations(),
    evaluation: getEvaluation(),
    storage: storageMode,
  });
});
const CreateProject = z
  .object({
    name: z.string().trim().min(2).max(80),
    target: z.enum(["sample", "website"]),
    url: z.string().max(2048).optional(),
    sampleVariant: z.enum(["healthy", "broken"]).default("healthy"),
    authorized: z.boolean(),
    brief: z.string().trim().min(10).max(12000),
  })
  .strict();
const secretPattern =
  /(?:sk-[A-Za-z0-9]{16,}|(?:api[_ -]?key|password|secret|bearer|token)\s*[:=]\s*\S{6,})/i;
function safeBrief(brief: string) {
  if (secretPattern.test(brief))
    throw new Error("Remove credentials from the brief before saving it.");
  return brief;
}
app.post("/api/projects", async (req, res) => {
  const input = CreateProject.parse(req.body);
  safeBrief(input.brief);
  if (!input.authorized)
    return res.status(400).json({
      error: "Confirm you own or are authorized to audit this website.",
    });
  if (allProjects().length >= 50)
    return res
      .status(409)
      .json({ error: "This workspace has reached its 50 project limit." });
  const url =
    input.target === "sample"
      ? "https://sample.flowproof.test/"
      : await validateTarget(input.url || "");
  const generated = await generateChecksWithOrchestration(input.brief, {
    allowModel: true,
  });
  const now = new Date().toISOString();
  const project: Project = {
    ...input,
    url,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...generated,
  };
  await saveProject(project);
  res.status(201).json(project);
});
app.get("/api/projects/:id", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  res.json(p);
});
app.put("/api/projects/:id/checks", async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  p.checks = validateChecks(req.body.checks);
  p.updatedAt = new Date().toISOString();
  await saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/generate", async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  const { brief } = z
    .object({ brief: z.string().trim().min(10).max(12000) })
    .parse(req.body);
  safeBrief(brief);
  const generated = await generateChecksWithOrchestration(brief, {
    allowModel: true,
  });
  Object.assign(p, generated, { brief, updatedAt: new Date().toISOString() });
  await saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/variant", async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  if (p.target !== "sample")
    return res
      .status(400)
      .json({ error: "Only the synthetic sample supports this switch." });
  p.sampleVariant = z.enum(["healthy", "broken"]).parse(req.body.sampleVariant);
  p.checks = p.checks.map((c) => ({ ...c, approved: false }));
  p.updatedAt = new Date().toISOString();
  await saveProject(p);
  res.json(p);
});
let running = false;
app.post("/api/projects/:id/audits", async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  if (!p.authorized)
    return res
      .status(403)
      .json({ error: "Website authorization is required." });
  p.checks = validateChecks(p.checks);
  if (
    !p.checks.length ||
    p.checks.some((c) => c.kind !== "manual" && !c.approved)
  )
    return res.status(409).json({
      error:
        "Review and approve every executable check before running the audit.",
    });
  if (running)
    return res
      .status(409)
      .json({ error: "Another audit is running. Wait for it to finish." });
  if (p.target === "website") await validateTarget(p.url);
  if (running)
    return res
      .status(409)
      .json({ error: "Another audit is running. Wait for it to finish." });
  running = true;
  const snapshot = structuredClone(p);
  const a: Audit = {
    id: randomUUID(),
    projectId: p.id,
    projectName: p.name,
    status: "running",
    createdAt: new Date().toISOString(),
    results: [],
    checks: structuredClone(p.checks),
    source: snapshotSource(snapshot),
  };
  try {
    await saveAudit(a);
  } catch (e) {
    running = false;
    throw e;
  }
  if (process.env.FLOWPROOF_TEMPORAL_ENABLED === "true") {
    try {
      const scheduled = await dispatchDurableAudit(snapshot, a, {
        save: saveAudit,
        start: startApprovedAudit,
        read: readTemporalAudit,
      });
      return res.status(202).json(scheduled);
    } catch {
      a.status = "error";
      a.error =
        "The scheduling intent could not be retained before dispatch. No completed audit is claimed.";
      a.completedAt = new Date().toISOString();
      await saveAudit(a);
      return res.status(503).json({ error: a.error, audit: a });
    } finally {
      running = false;
    }
  }
  res.status(202).json(a);
  void (async () => {
    try {
      const outcome = await runAuditWithOrchestration(
        snapshot,
        a,
        async (result) => {
          a.results.push(result);
          await saveAudit(a);
        },
        {
          evidenceRoot: path.join(dataRoot, "evidence"),
          allowModelSummary: true,
        },
      );
      a.status = "completed";
      a.summary = outcome.summary;
    } catch (e) {
      a.status = "error";
      a.error = redact(
        e instanceof Error ? e.message : "The audit could not finish.",
      );
    } finally {
      a.completedAt = new Date().toISOString();
      try {
        await saveAudit(a);
      } catch {
        a.status = "error";
        a.error =
          "The browser finished, but saving the final results or evidence failed. Retention has not been verified. Run the audit again after checking the database.";
        await saveAudit(a).catch(() =>
          console.error("Could not persist final audit state."),
        );
      }
      running = false;
    }
  })();
});
app.get("/api/audits/:id", async (req, res) => {
  const a = getAudit(req.params.id);
  if (!a) return res.status(404).json({ error: "Audit not found." });
  res.json(await refreshDurableAudit(a));
});
app.get("/api/audits/:id/report", async (req, res) => {
  const a = getAudit(req.params.id);
  if (!a) return res.status(404).json({ error: "Audit not found." });
  if (a.status === "running" || a.status === "queued")
    return res
      .status(409)
      .json({ error: "Wait for the audit to finish before exporting." });
  res
    .type("html")
    .setHeader(
      "Content-Disposition",
      `attachment; filename="briefstamp-report-${a.id.slice(0, 8)}.html"`,
    );
  res.send(
    await traceOperation(
      "briefstamp.report",
      { checkCount: a.checks.length },
      () => renderReport(a),
    ),
  );
});
// Operator-only actions. Public visitor requests terminate in the isolated demo
// router before these routes, and no optional provider is invoked automatically.
app.post("/api/audits/:id/memory", async (req, res) => {
  const audit = getAudit(req.params.id);
  if (!audit) return res.status(404).json({ error: "Audit not found." });
  res.json(await rememberAudit(audit));
});
app.post("/api/projects/:id/memory/search", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found." });
  const { kind } = z
    .object({
      kind: z.enum([
        "heading",
        "link",
        "text_visible",
        "image_alt",
        "no_horizontal_overflow",
        "manual",
      ]),
    })
    .strict()
    .parse(req.body);
  res.json(await recallProjectMemory(project.id, kind));
});
app.post("/api/projects/:id/search-visibility", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found." });
  res.json(await checkSearchVisibility(project));
});
app.post("/api/audits/:id/speech", async (req, res) => {
  const audit = getAudit(req.params.id);
  if (!audit) return res.status(404).json({ error: "Audit not found." });
  const spoken = await createSpokenSampleReport(audit);
  res
    .type(spoken.mimeType)
    .setHeader(
      "Content-Disposition",
      'attachment; filename="briefstamp-synthetic-report.mp3"',
    );
  res.setHeader(
    "X-Briefstamp-Audio-Scope",
    "Noncommercial synthetic demonstration; ElevenLabs attribution required",
  );
  res.send(spoken.audio);
});
app.get("/api/projects/:id/plan", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  res.attachment("briefstamp-plan.json").json({ version: 1, project: p });
});
app.get("/api/failures", async (req, res) =>
  res.json(await searchFailures(String(req.query.q || "").slice(0, 200))),
);
app.use(
  "/evidence",
  express.static(path.join(dataRoot, "evidence"), {
    dotfiles: "deny",
    index: false,
  }),
);
app.get("/evidence/:audit/:file", async (req, res) => {
  const image = await readEvidence(req.path);
  if (!image)
    return res.status(404).json({ error: "Evidence image unavailable." });
  res.type("png").send(image);
});
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", async (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "Endpoint not found." });
  try {
    await fs.access("dist/index.html");
    res.sendFile(path.resolve("dist/index.html"));
  } catch {
    res.status(404).send("Start the frontend with npm run dev.");
  }
});
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ProviderError)
      return res.status(409).json({ error: err.message, code: err.code });
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    observability?.captureOperationalError("briefstamp.audit");
    const message = err instanceof Error ? err.message : "Request failed.";
    res.status(400).json({ error: redact(message).slice(0, 500) });
  },
);
if (!demoMode) await initStore();
if (!demoMode && !allProjects().length) {
  const now = new Date().toISOString();
  const brief =
    'The homepage heading must say "Design that moves business forward."\nA contact link must say "Start a project".\nEvery content image must have nonempty alternative text.\nThe homepage must fit a 390px mobile screen without horizontal scrolling.\nThe homepage must show "Independent by design."\nThe site should feel welcoming and trustworthy.';
  const generated = await generateChecksWithOrchestration(brief, {
    allowModel: true,
  });
  await saveProject({
    id: randomUUID(),
    name: "Forma Studio",
    url: "https://sample.flowproof.test/",
    target: "sample",
    sampleVariant: "healthy",
    authorized: true,
    brief,
    checks: generated.checks,
    generator: generated.generator,
    createdAt: now,
    updatedAt: now,
  });
}
const port = Number(process.env.PORT || 4310);
app.listen(port, publicMode ? "0.0.0.0" : "127.0.0.1", () =>
  console.log(
    `Briefstamp listening on http://${publicMode ? "0.0.0.0" : "127.0.0.1"}:${port} (${demoMode ? "isolated public demo" : storageMode})`,
  ),
);
