import express from "express";
import { snapshotSource } from "../shared/compare-audits";
import { redact } from "../shared/redact";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type {
  Audit,
  Bootstrap,
  Project,
  IntegrationStatus,
  CheckResult,
} from "../shared/types";
import { generateLocalChecks, validateModelProposal } from "./generator";
import { CheckSchema, validateChecks } from "./schema";
import { runAudit } from "./runner";
import { renderReport } from "./report";
import { SAMPLE_URL } from "./sample";
import { getEvaluation } from "./evaluation";
import { optionalIntegrations } from "./optional-integrations";
import {
  generateGoogleGemmaProposal,
  googleGemmaConfiguration,
} from "./providers/gemma-google";
import { verifyGemmaFreePricing } from "./providers/gemma-free-pricing";
import { runPublicGemmaWorkflow } from "./public-gemma-orchestration";
import {
  authorizeHostedBackboard,
  rememberHostedAudit,
  recallHostedMemory,
  hostBackboardEnabled,
} from "./hosted-backboard";

const COOKIE = "flowproof_demo";
const TTL = 30 * 60_000;
const DEMO_BRIEF =
  'The homepage heading must say "Design that moves business forward."\nA contact link must say "Start a project".\nEvery content image must have nonempty alternative text.\nThe homepage must fit a 390px mobile screen without horizontal scrolling.\nThe homepage must show "Independent by design."\nThe site should feel welcoming and trustworthy.';
const generator: Project["generator"] = {
  provider: "Deterministic parser",
  model: null,
  reason:
    "Public demo proposals use local rules. No AI service or fine-tuned model is used.",
};
const briefSchema = z
  .string()
  .trim()
  .min(10)
  .max(6000)
  .refine(
    (value) =>
      !/(?:sk-[A-Za-z0-9]{16,}|(?:api[_ -]?key|password|secret|bearer|token)\s*[:=]\s*\S{6,})/i.test(
        value,
      ),
    "Remove credentials from the brief before saving it.",
  );
const createSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    target: z.literal("sample"),
    url: z.literal(SAMPLE_URL).optional(),
    sampleVariant: z.enum(["healthy", "broken"]).default("healthy"),
    authorized: z.literal(true),
    brief: briefSchema,
  })
  .strict();

// Keep the public sample execution boundary independent of the operator SDK.
// Validate evidence before publishing it or marking an audit complete.
const resultSchema = z.object({
  checkId: z.string(),
  requirement: z.string(),
  kind: CheckSchema.innerType().shape.kind,
  status: z.enum(["passed", "failed", "blocked", "unverified"]),
  expected: z.string(),
  durationMs: z.number().finite().nonnegative(),
  evidence: z.object({
    screenshot: z.string().optional(),
    dom: z.string().optional(),
    observed: z.string(),
    url: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
  }),
});
function validateResult(value: unknown, checks: Audit["checks"]): CheckResult {
  const result = resultSchema.parse(value);
  const check = checks.find((item) => item.id === result.checkId);
  if (
    !check ||
    result.kind !== check.kind ||
    result.expected !== redact(check.expected) ||
    result.requirement !== redact(check.requirement) ||
    (check.kind === "manual" && result.status !== "unverified")
  )
    throw new Error("The runner returned mismatched assertion evidence.");
  return result;
}

interface Session {
  expires: number;
  projects: Map<string, Project>;
  audits: Map<string, Audit>;
  windowStart: number;
  requests: number;
  gemmaAttempts: number;
}
interface DemoOptions {
  /** Must be dedicated to public demo evidence, never the private evidence root. */
  evidenceRoot: string;
  secureCookie: boolean;
  now?: () => number;
  execute?: typeof runAudit;
  generateGemma?: (
    requirements: string[],
  ) => Promise<
    Awaited<ReturnType<typeof generateGoogleGemmaProposal>> & {
      orchestration?: Project["generator"]["orchestration"];
    }
  >;
  gemmaAvailable?: () => boolean;
  verifyGemmaFree?: () => Promise<unknown>;
}

function integrations(gemmaAvailable: boolean): IntegrationStatus[] {
  return [
    {
      name: "Playwright",
      status: "active",
      detail:
        "Real Chromium execution on the built-in synthetic sample. Every audit records observed outcomes.",
    },
    {
      name: "Local open model",
      status: "not_configured",
      detail:
        "Initial drafts use deterministic rules. A separate opt-in Google-hosted Gemma action is available when configured; no local model runs on Render.",
    },
    {
      name: "Tiger Data",
      status: "not_configured",
      detail:
        "An isolated no-card Tiger trial verified application persistence, screenshot recovery, and lexical/vector retrieval. Demo sessions use temporary memory. The separate Shared Free service remains blocked by certificate verification.",
    },
    {
      name: "Tinker",
      status: "available",
      detail:
        "Real baseline and LoRA results are recorded in Model lab. LoRA used fewer tokens and had a lower inference-price estimate, with lower reference agreement and higher latency than few-shot prompting. Tinker experiments are separate from live Gemma generation.",
    },
    {
      name: "GitHub Actions",
      status: "available",
      detail:
        "A real browser audit workflow is included in the repository. Verify its current run in GitHub Actions.",
    },
    {
      name: "Render",
      status: process.env.RENDER === "true" ? "active" : "not_configured",
      detail:
        process.env.RENDER === "true"
          ? "Running on Render. This public demo uses ephemeral visitor sessions."
          : "Render hosting is not detected in this runtime.",
    },
    {
      name: "Gemma",
      status: gemmaAvailable ? "available" : "not_configured",
      detail: gemmaAvailable
        ? "Opt-in Gemma 4 generates unapproved checks for the fixed synthetic sample through Google's free-only API. Current pricing is rechecked before calls. Browser execution still requires approval. No private visitor brief is sent."
        : "Public Gemma generation is disabled or its free-use confirmation expired. Deterministic drafts remain labelled as rules.",
    },
    ...optionalIntegrations(true),
  ];
}
function project(
  name: string,
  brief: string,
  variant: "healthy" | "broken",
  now: number,
): Project {
  return {
    id: randomUUID(),
    name,
    brief,
    target: "sample",
    url: SAMPLE_URL,
    sampleVariant: variant,
    authorized: true,
    checks: validateChecks(generateLocalChecks(brief)),
    generator,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

/** Terminal router: tokenless public requests can never reach private APIs or files. */
export function createDemoRouter(options: DemoOptions) {
  const router = express.Router();
  // Immutable bundled receipts are safe to display without loading a provider.
  const evaluation = getEvaluation();
  evaluation.notes.unshift(
    "These Tinker metrics are recorded offline experiments, separate from the opt-in live Gemma sample-generation route. Initial public drafts use deterministic rules.",
  );
  const sessions = new Map<string, Session>();
  const now = options.now ?? Date.now;
  const execute = options.execute ?? runAudit;
  const gemmaAvailable =
    options.gemmaAvailable ?? (() => googleGemmaConfiguration().enabled);
  const generateGemma = options.generateGemma ?? runPublicGemmaWorkflow;
  const verifyGemmaFree = options.verifyGemmaFree ?? verifyGemmaFreePricing;
  const gemmaStarts: number[] = [];
  let gemmaBusy = false;
  const auditStarts: number[] = [];
  let active: { session: Session; task: Promise<void> } | undefined;

  async function cleanup() {
    for (const [key, session] of sessions) {
      if (session.expires > now() || active?.session === session) continue;
      sessions.delete(key);
      await Promise.all(
        [...session.audits.keys()].map((id) =>
          fs.rm(path.join(options.evidenceRoot, id), {
            recursive: true,
            force: true,
          }),
        ),
      );
    }
  }
  const timer = setInterval(() => {
    void cleanup().catch(() => {});
  }, 60_000);
  timer.unref();

  router.use(async (req, res, next) => {
    // The root mount preserves the original path. Do not consume frontend assets.
    if (!/^\/(?:api|evidence)(?:\/|$)/i.test(req.path)) return next("router");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    const origin = req.headers.origin;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && origin) {
      let host: string;
      try {
        host = new URL(origin).host;
      } catch {
        host = "";
      }
      if (host !== req.headers.host)
        return res
          .status(403)
          .json({ error: "This request came from another website." });
    }
    await cleanup();
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    let session =
      cookie && /^[a-f0-9]{64}$/.test(cookie)
        ? sessions.get(cookie)
        : undefined;
    if (session && session.expires <= now()) session = undefined;
    if (!session) {
      // Only bootstrap creates sessions; guessing URLs never consumes visitor slots.
      if (req.method !== "GET" || req.path !== "/api/bootstrap")
        return res.status(401).json({
          error:
            "Your demo session expired. Reload Briefstamp to start a new session.",
        });
      if (sessions.size >= 20)
        return res.status(429).json({
          error:
            "The free demo is at capacity. Please try again in a few minutes.",
        });
      const key = randomBytes(32).toString("hex");
      const sample = project("Forma Studio", DEMO_BRIEF, "healthy", now());
      session = {
        expires: now() + TTL,
        projects: new Map([[sample.id, sample]]),
        audits: new Map(),
        windowStart: now(),
        requests: 0,
        gemmaAttempts: 0,
      };
      sessions.set(key, session);
      res.cookie(COOKIE, key, {
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookie,
        maxAge: TTL,
        path: "/",
      });
    }
    if (now() - session.windowStart >= 60_000) {
      session.windowStart = now();
      session.requests = 0;
    }
    if (++session.requests > 180)
      return res
        .status(429)
        .json({ error: "Request limit reached. Please wait one minute." });
    res.locals.demoSession = session;
    next();
  });
  const session = (res: express.Response): Session => res.locals.demoSession;
  const notFound = (res: express.Response) =>
    res.status(404).json({ error: "Not found in this demo session." });

  router.get("/api/bootstrap", (_req, res) => {
    const s = session(res);
    const body: Bootstrap = {
      projects: [...s.projects.values()],
      audits: [...s.audits.values()].reverse(),
      integrations: integrations(gemmaAvailable()),
      storage: "Ephemeral visitor session",
      demo: {
        enabled: true,
        expiresMinutes: 30,
        notice:
          "Synthetic sample only. Your isolated demo session expires after 30 minutes and may reset when the free service restarts. Download reports before leaving. Do not enter private client information.",
        gemma: {
          available: gemmaAvailable(),
          model: "gemma-4-26b-a4b-it",
          sampleBrief: DEMO_BRIEF,
          description:
            "Generate checks for the fixed synthetic sample with Google-hosted Gemma. Free-tier inputs may be used to improve Google's products. No client information is sent.",
        },
      },
      evaluation,
    };
    res.json(body);
  });
  router.post("/api/projects", (req, res) => {
    const input = createSchema.parse(req.body);
    const s = session(res);
    if (s.projects.size >= 4)
      return res.status(409).json({
        error: "This demo session allows up to four sample projects.",
      });
    const p = project(input.name, input.brief, input.sampleVariant, now());
    s.projects.set(p.id, p);
    res.status(201).json(p);
  });
  router.get("/api/projects/:id", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    return p ? res.json(p) : notFound(res);
  });
  router.put("/api/projects/:id/checks", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    if (!p) return notFound(res);
    const input = z.object({ checks: z.unknown() }).strict().parse(req.body);
    p.checks = validateChecks(input.checks);
    p.updatedAt = new Date(now()).toISOString();
    res.json(p);
  });
  router.post("/api/projects/:id/generate", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    if (!p) return notFound(res);
    const { brief } = z.object({ brief: briefSchema }).strict().parse(req.body);
    Object.assign(p, {
      brief,
      checks: validateChecks(generateLocalChecks(brief)),
      generator,
      updatedAt: new Date(now()).toISOString(),
    });
    res.json(p);
  });
  router.post("/api/projects/:id/generate-gemma", async (req, res) => {
    const s = session(res);
    const p = s.projects.get(req.params.id);
    if (!p) return notFound(res);
    z.object({ modelConsent: z.literal(true) })
      .strict()
      .parse(req.body);
    if (!gemmaAvailable())
      return res.status(503).json({
        error: "Live Gemma is unavailable. The current plan has not changed.",
      });
    if (p.target !== "sample" || p.brief !== DEMO_BRIEF)
      return res.status(400).json({
        error:
          "Live Gemma accepts only the original synthetic sample brief. Visitor or client text is not sent.",
      });
    while (gemmaStarts.length && gemmaStarts[0] <= now() - 60 * 60_000)
      gemmaStarts.shift();
    if (s.gemmaAttempts >= 2 || gemmaStarts.length >= 12 || gemmaBusy || active)
      return res.status(429).json({
        error:
          "The shared free model limit is reached. Keep your current plan and try later.",
      });
    s.gemmaAttempts++;
    gemmaStarts.push(now());
    gemmaBusy = true;
    const snapshot = structuredClone(p);
    try {
      await verifyGemmaFree();
      const proposed = await generateGemma(DEMO_BRIEF.split("\n"));
      if (s.expires <= now())
        return res.status(401).json({
          error: "The demo session expired. No generated plan was saved.",
        });
      if (!isDeepStrictEqual(p, snapshot))
        return res.status(409).json({
          error:
            "This project changed during generation. The newer plan was kept; review it before trying again.",
        });
      const checks = validateModelProposal(DEMO_BRIEF, {
        checks: proposed.checks,
      });
      Object.assign(p, {
        checks,
        generator: {
          provider: "Google Gemma (live API)",
          model: proposed.model,
          ...(proposed.orchestration
            ? { orchestration: proposed.orchestration }
            : {}),
          reason: `Fresh Gemma proposal for the fixed synthetic brief, validated by the server. ${proposed.latencyMs} ms. ${proposed.usage ? `${proposed.usage.promptTokens} input / ${proposed.usage.completionTokens} output tokens.` : "Provider token usage was not reported."} ${proposed.orchestration ? "Generated and validated in a real isolated Mastra workflow. " : ""}${proposed.transportNormalization?.wholeJsonFenceRemoved ? "A whole JSON code fence was removed before strict schema validation. " : ""}Review and approve every executable check.`,
        },
        updatedAt: new Date(now()).toISOString(),
      });
      return res.json(p);
    } catch {
      return res.status(503).json({
        error:
          "Gemma or its free-pricing check was unavailable, or the proposal failed validation. The current plan is unchanged. No AI success is claimed.",
      });
    } finally {
      gemmaBusy = false;
    }
  });
  router.post("/api/projects/:id/variant", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    if (!p) return notFound(res);
    const { sampleVariant } = z
      .object({ sampleVariant: z.enum(["healthy", "broken"]) })
      .strict()
      .parse(req.body);
    p.sampleVariant = sampleVariant;
    p.checks = p.checks.map((check) => ({ ...check, approved: false }));
    p.updatedAt = new Date(now()).toISOString();
    res.json(p);
  });
  router.post("/api/projects/:id/audits", (req, res) => {
    const s = session(res);
    const p = s.projects.get(req.params.id);
    if (!p) return notFound(res);
    const checks = validateChecks(p.checks);
    if (checks.some((check) => check.kind !== "manual" && !check.approved))
      return res.status(409).json({
        error:
          "Review and approve every executable check before running the audit.",
      });
    if (active || gemmaBusy)
      return res.status(409).json({
        error: "Another visitor's audit is running. Please try again shortly.",
      });
    if (s.audits.size >= 4)
      return res
        .status(429)
        .json({ error: "This free demo session allows four audits." });
    while (auditStarts.length && auditStarts[0] <= now() - 60 * 60_000)
      auditStarts.shift();
    if (auditStarts.length >= 24)
      return res.status(429).json({
        error:
          "The free demo's hourly audit budget has been reached. Please try again later.",
      });
    const a: Audit = {
      id: randomUUID(),
      projectId: p.id,
      projectName: p.name,
      status: "running",
      createdAt: new Date(now()).toISOString(),
      checks: structuredClone(checks),
      source: snapshotSource(p),
      results: [],
    };
    // Snapshot before asynchronous execution so edits cannot change an approved run.
    const snapshot = structuredClone(p);
    s.audits.set(a.id, a);
    auditStarts.push(now());
    const task = Promise.resolve().then(async () => {
      try {
        const results = await execute(
          snapshot,
          a,
          (result) => {
            const checked = validateResult(result, checks);
            if (a.results.some((item) => item.checkId === checked.checkId))
              throw new Error(
                "The runner returned duplicate assertion evidence.",
              );
            a.results.push(checked);
          },
          { evidenceRoot: options.evidenceRoot },
        );
        const validated = z
          .array(resultSchema)
          .max(24)
          .parse(results)
          .map((result) => validateResult(result, checks));
        if (
          validated.length !== checks.length ||
          new Set(validated.map((result) => result.checkId)).size !==
            checks.length ||
          JSON.stringify(validated) !== JSON.stringify(a.results)
        )
          throw new Error("The runner returned incomplete assertion evidence.");
        a.status = "completed";
        const count = (status: string) =>
          a.results.filter((result) => result.status === status).length;
        a.summary = `${count("passed")} passed, ${count("failed")} failed, ${count("blocked")} blocked, ${count("unverified")} unverified. Real Chromium observations of the synthetic sample; ${snapshot.generator.model ? `checks proposed by ${snapshot.generator.provider} (${snapshot.generator.model}) and reviewed by the visitor. Models do not assign test outcomes.` : "deterministic draft checks reviewed by the visitor. No AI model was used."}`;
      } catch {
        a.status = "error";
        a.error =
          "The demo could not complete this audit. Unexecuted checks are not counted as passed.";
      } finally {
        a.completedAt = new Date(now()).toISOString();
        active = undefined;
        await cleanup().catch(() => {});
      }
    });
    active = { session: s, task };
    res.status(202).json(a);
  });
  router.get("/api/audits/:id", (req, res) => {
    const a = session(res).audits.get(req.params.id);
    return a ? res.json(a) : notFound(res);
  });
  router.get("/api/operator/status", (req, res) => {
    if (!authorizeHostedBackboard(req.headers)) return notFound(res);
    return res.json({
      backboard: hostBackboardEnabled(),
      scope: "Bounded hosted operator memory. Visitor access remains isolated.",
    });
  });
  router.post("/api/audits/:id/memory", async (req, res) => {
    if (!authorizeHostedBackboard(req.headers)) return notFound(res);
    z.object({}).strict().parse(req.body);
    const audit = session(res).audits.get(req.params.id);
    if (!audit) return notFound(res);
    if (audit.status !== "completed")
      return res
        .status(409)
        .json({
          error: "Only a completed audit can be saved to project memory.",
        });
    try {
      return res.json(await rememberHostedAudit(audit));
    } catch {
      return res
        .status(503)
        .json({
          error:
            "Backboard memory is unavailable or its approved credit limit is reached. Audit evidence is unchanged.",
        });
    }
  });
  router.post("/api/projects/:id/memory/search", async (req, res) => {
    if (!authorizeHostedBackboard(req.headers)) return notFound(res);
    const project = session(res).projects.get(req.params.id);
    if (!project) return notFound(res);
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
    try {
      return res.json(await recallHostedMemory(project.id, kind));
    } catch {
      return res
        .status(503)
        .json({
          error:
            "Backboard retrieval is unavailable or its approved credit limit is reached. Saved memory is not a new audit result.",
        });
    }
  });
  async function readImage(s: Session, value: string): Promise<Buffer | null> {
    const match = /^\/evidence\/([a-f0-9-]{36})\/([a-zA-Z0-9_-]+\.png)$/.exec(
      value,
    );
    if (!match) return null;
    const a = s.audits.get(match[1]);
    if (!a || !a.results.some((result) => result.evidence.screenshot === value))
      return null;
    try {
      return await fs.readFile(
        path.join(options.evidenceRoot, match[1], match[2]),
      );
    } catch {
      return null;
    }
  }
  router.get("/api/audits/:id/report", async (req, res) => {
    const s = session(res);
    const a = s.audits.get(req.params.id);
    if (!a) return notFound(res);
    if (["running", "queued"].includes(a.status))
      return res
        .status(409)
        .json({ error: "Wait for the audit to finish before exporting." });
    res
      .type("html")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="briefstamp-report-${a.id.slice(0, 8)}.html"`,
      );
    res.send(await renderReport(a, (value) => readImage(s, value)));
  });
  router.get("/api/projects/:id/plan", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    return p
      ? res.attachment("briefstamp-plan.json").json({ version: 1, project: p })
      : notFound(res);
  });
  router.get("/api/failures", (req, res) => {
    const terms = String(req.query.q || "")
      .slice(0, 200)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const results = [...session(res).audits.values()]
      .flatMap((a) =>
        a.results
          .filter((r) => ["failed", "blocked"].includes(r.status))
          .map((r) => ({
            auditId: a.id,
            projectName: a.projectName,
            requirement: r.requirement,
            observed: r.evidence.observed,
            status: r.status,
            createdAt: a.createdAt,
          })),
      )
      .filter((r) =>
        terms.every((term) =>
          `${r.requirement} ${r.observed}`.toLowerCase().includes(term),
        ),
      )
      .slice(0, 30);
    res.json({
      results,
      mode: "Demo session lexical filter (no database or vectors)",
    });
  });
  router.get("/evidence/:audit/:file", async (req, res) => {
    const image = await readImage(session(res), req.path);
    return image ? res.type("png").send(image) : notFound(res);
  });
  // Every API/evidence request terminates here, including future private endpoints.
  router.use((_req, res) => notFound(res));
  router.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({
        error:
          err instanceof z.ZodError
            ? "Invalid demo input. Use a sample project, a brief up to 6,000 characters and at most 24 safe checks."
            : "The demo request could not be accepted. Check your input and try again.",
      });
    },
  );
  return {
    router,
    async dispose() {
      clearInterval(timer);
      await active?.task;
    },
  };
}
