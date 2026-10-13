import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  Audit,
  Bootstrap,
  Project,
  IntegrationStatus,
} from "../shared/types";
import { generateLocalChecks } from "./generator";
import { validateChecks } from "./schema";
import { runAudit } from "./runner";
import { renderReport } from "./report";
import { SAMPLE_URL } from "./sample";
import { getEvaluation } from "./evaluation";

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

interface Session {
  expires: number;
  projects: Map<string, Project>;
  audits: Map<string, Audit>;
  windowStart: number;
  requests: number;
}
interface DemoOptions {
  /** Must be dedicated to public demo evidence, never the private evidence root. */
  evidenceRoot: string;
  secureCookie: boolean;
  now?: () => number;
  execute?: typeof runAudit;
}

function integrations(): IntegrationStatus[] {
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
        "The free public demo uses deterministic draft generation. No AI inference is performed.",
    },
    {
      name: "Tiger Data",
      status: "not_configured",
      detail:
        "Keyword and vector retrieval over four saved failures were verified in Tiger's free SQL console. The direct application connection remains blocked by certificate verification. Demo sessions use temporary memory.",
    },
    {
      name: "Tinker",
      status: "available",
      detail: "Real baseline and LoRA results are recorded in Model lab. This small agent-reviewed pilot did not beat few-shot prompting. No live model calls run in the demo.",
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
    ...["Gemma", "Mastra", "Sentry", "Temporal", "Entire", "Backboard"].map(
      (name) => ({
        name,
        status: "not_configured" as const,
        detail: "Not active in the public demo. No integration claim.",
      }),
    ),
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
    "These are recorded offline experiments. Public demo drafts use a deterministic parser; no model inference runs for visitors.",
  );
  const sessions = new Map<string, Session>();
  const now = options.now ?? Date.now;
  const execute = options.execute ?? runAudit;
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
            "Your demo session expired. Reload FlowProof to start a new session.",
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
      integrations: integrations(),
      storage: "Ephemeral visitor session",
      demo: {
        enabled: true,
        expiresMinutes: 30,
        notice:
          "Synthetic sample only. Your isolated demo session expires after 30 minutes and may reset when the free service restarts. Download reports before leaving. Do not enter private client information.",
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
    const checks = validateChecks(generateLocalChecks(brief));
    Object.assign(p, {
      brief,
      checks,
      generator,
      updatedAt: new Date(now()).toISOString(),
    });
    res.json(p);
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
    if (active)
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
      results: [],
    };
    // Snapshot before asynchronous execution so edits cannot change an approved run.
    const snapshot = structuredClone(p);
    s.audits.set(a.id, a);
    auditStarts.push(now());
    const task = Promise.resolve().then(async () => {
      try {
        await execute(
          snapshot,
          a,
          (result) => {
            a.results.push(result);
          },
          { evidenceRoot: options.evidenceRoot },
        );
        a.status = "completed";
        const count = (status: string) =>
          a.results.filter((result) => result.status === status).length;
        a.summary = `${count("passed")} passed, ${count("failed")} failed, ${count("blocked")} blocked, ${count("unverified")} unverified. Real Chromium observations of the synthetic sample; deterministic draft checks reviewed by the visitor. No AI model was used.`;
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
        `attachment; filename="flowproof-report-${a.id.slice(0, 8)}.html"`,
      );
    res.send(await renderReport(a, (value) => readImage(s, value)));
  });
  router.get("/api/projects/:id/plan", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    return p
      ? res.attachment("flowproof-plan.json").json({ version: 1, project: p })
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
