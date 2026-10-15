import express from "express";
import { snapshotSource } from "../shared/compare-audits";
import { redact } from "../shared/redact";
import {
  HOSTED_WEBSITE_BRIEF,
  HOSTED_WEBSITE_PRESET,
  HOSTED_WEBSITE_URL,
} from "../shared/hosted-target";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { createHostedTigerStore, hostedTigerEnabled } from "./hosted-tiger";
import {
  authorizeHostedTinker,
  generateHostedTinkerProposal,
  hostTinkerEnabled,
} from "./hosted-tinker";

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
function validateResult(
  value: unknown,
  checks: Audit["checks"],
  source?: Pick<Project, "target" | "url">,
): CheckResult {
  const result = resultSchema.parse(value);
  const check = checks.find((item) => item.id === result.checkId);
  if (
    !check ||
    result.kind !== check.kind ||
    result.expected !== redact(check.expected) ||
    result.requirement !== redact(check.requirement) ||
    (check.kind === "manual" && result.status !== "unverified") ||
    (source?.target === "website" && result.evidence.url !== source.url)
  )
    throw new Error("The runner returned mismatched assertion evidence.");
  return result;
}

function ownedWebsite(
  project: Pick<Project, "target" | "url" | "authorized" | "brief">,
) {
  return (
    project.target === "website" &&
    project.url === HOSTED_WEBSITE_URL &&
    project.authorized === true &&
    project.brief === HOSTED_WEBSITE_BRIEF
  );
}

interface Session {
  hash: string;
  expires: number;
  projects: Map<string, Project>;
  audits: Map<string, Audit>;
  windowStart: number;
  requests: number;
  gemmaAttempts: number;
  persistence: Map<
    string,
    {
      status: "saving" | "saved" | "unverified";
      expiresAt?: string;
      detail?: string;
    }
  >;
}
interface DemoOptions {
  /** Must be dedicated to public demo evidence, never the private evidence root. */
  evidenceRoot: string;
  secureCookie: boolean;
  now?: () => number;
  execute?: typeof runAudit;
  generateGemma?: (requirements: string[]) => Promise<
    Awaited<ReturnType<typeof generateGoogleGemmaProposal>> & {
      orchestration?: Project["generator"]["orchestration"];
    }
  >;
  gemmaAvailable?: () => boolean;
  verifyGemmaFree?: () => Promise<unknown>;
  generateTinker?: typeof generateHostedTinkerProposal;
  tinkerAvailable?: () => boolean;
  tigerAvailable?: () => boolean;
  /** Trusted dependency injection only; never accepted from an HTTP request. */
  tigerStore?: ReturnType<typeof createHostedTigerStore>;
}

function integrations(
  gemmaAvailable: boolean,
  tigerAvailable = false,
  tinkerAvailable = false,
): IntegrationStatus[] {
  return [
    {
      name: "Playwright",
      status: "active",
      detail:
        "Real Chromium execution on the built-in synthetic sample or the owner's fixed live homepage. Live websites use the HTTPS and SSRF checks without fixture interception. Every audit records observed outcomes.",
    },
    {
      name: "Local open model",
      status: "not_configured",
      detail:
        "Initial drafts use deterministic rules. A separate opt-in Google-hosted Gemma action is available when configured; no local model runs on Render.",
    },
    {
      name: "Tiger Data",
      status: tigerAvailable ? "available" : "not_configured",
      detail: tigerAvailable
        ? "Configured for session-scoped approved preset briefs, plans and audit results with a 30-minute logical lifetime. Screenshot references only; image bytes remain temporary. Each save/read is verified separately. Hosted retrieval is lexical only."
        : "An isolated no-card Tiger trial verified application persistence, screenshot recovery, and lexical/vector retrieval. Demo sessions use temporary memory. The separate Shared Free service remains blocked by certificate verification.",
    },
    {
      name: "Tinker",
      status: tinkerAvailable ? "available" : "not_configured",
      detail: tinkerAvailable
        ? "Protected live generation uses a trained Tinker checkpoint for the fixed synthetic sample, with a fresh free-only proof and at most two reserved calls. Operator authentication and check approval are required. Recorded Model lab experiments remain separate."
        : "Hosted Tinker generation is disabled or its free-use proof expired. Real baseline and LoRA comparisons remain available in Model lab; those recorded experiments do not imply a live provider connection.",
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
        ? "Opt-in Gemma 4 generates unapproved checks for a server-selected sample or owner-authorized live homepage brief through Google's free-only API. Current pricing is rechecked before calls. Browser execution still requires approval. No private visitor brief is sent."
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
  const tinkerAvailable =
    options.tinkerAvailable ?? (() => hostTinkerEnabled(process.env, now()));
  const generateTinker = options.generateTinker ?? generateHostedTinkerProposal;
  const tigerAvailable =
    options.tigerAvailable ?? (() => hostedTigerEnabled(process.env, now()));
  let tigerStore = options.tigerStore;
  let ownsTigerStore = false;
  const tiger = () => {
    if (!tigerStore) {
      tigerStore = createHostedTigerStore({ now });
      ownsTigerStore = true;
    }
    return tigerStore;
  };
  const pendingPersistence = new Set<Promise<void>>();
  function persistCompletedAudit(s: Session, audit: Audit) {
    if (audit.status !== "completed" || s.expires <= now() || !tigerAvailable())
      return;
    s.persistence.set(audit.id, { status: "saving" });
    const task = Promise.resolve().then(async () => {
      try {
        const saved = await tiger().persistAudit(
          s.hash,
          structuredClone(audit),
        );
        if (!saved.inserted)
          throw new Error("The audit insert was not confirmed.");
        s.persistence.set(audit.id, {
          status: "saved",
          expiresAt: saved.expiresAt,
        });
      } catch {
        s.persistence.set(audit.id, {
          status: "unverified",
          detail:
            "Database persistence was not confirmed. Observed browser results are unchanged.",
        });
      }
    });
    pendingPersistence.add(task);
    void task.finally(() => pendingPersistence.delete(task));
  }
  const gemmaStarts: number[] = [];
  // Both hosted model paths share this lock with Chromium on the free host.
  let modelBusy = false;
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
    // A tokenless caller cannot use session or project existence as an oracle.
    if (
      req.method === "POST" &&
      /^\/api\/projects\/[^/]+\/generate-tinker\/?$/i.test(req.path) &&
      !authorizeHostedTinker(req.headers, process.env, now())
    )
      return res.status(404).json({ error: "Not found in this demo session." });
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
          code: "SESSION_EXPIRED",
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
        hash: createHash("sha256").update(key).digest("hex"),
        expires: now() + TTL,
        projects: new Map([[sample.id, sample]]),
        audits: new Map(),
        windowStart: now(),
        requests: 0,
        gemmaAttempts: 0,
        persistence: new Map(),
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
      integrations: integrations(
        gemmaAvailable(),
        tigerAvailable(),
        tinkerAvailable(),
      ),
      storage: tigerAvailable()
        ? "Ephemeral visitor session; Tiger configured for approved preset audit briefs, plans and results for up to 30 minutes. Screenshot references only."
        : "Ephemeral visitor session",
      demo: {
        enabled: true,
        expiresMinutes: 30,
        notice:
          "Choose the synthetic sample or the owner's fixed live homepage. Your isolated session expires after 30 minutes and may reset when the free service restarts. Download reports before leaving. Do not enter private client information.",
        gemma: {
          available: gemmaAvailable(),
          model: "gemma-4-26b-a4b-it",
          sampleBrief: DEMO_BRIEF,
          description:
            "Generate checks for the server-selected sample or live homepage brief with Google-hosted Gemma. Free-tier inputs may be used to improve Google's products. No client information is sent.",
        },
        tinker: {
          available: tinkerAvailable(),
          model: "Qwen/Qwen3.5-4B",
          sampleBrief: DEMO_BRIEF,
          description:
            "Protected trained sampler generation for the fixed synthetic sample. An operator token and fresh free-only allowance are required. Proposals remain unapproved; recorded benchmark metrics are separate.",
        },
      },
      evaluation,
    };
    res.json(body);
  });
  router.get("/api/target-presets", (_req, res) => {
    res.json({ presets: [HOSTED_WEBSITE_PRESET] });
  });
  router.post("/api/projects/preset", (req, res) => {
    z.object({ preset: z.literal("briefstamp-live") })
      .strict()
      .parse(req.body);
    const s = session(res);
    if (s.projects.size >= 4)
      return res.status(409).json({
        error: "This demo session allows up to four projects.",
      });
    // Authorization belongs to this preconfigured site owner, not a visitor-supplied flag.
    const p: Project = {
      ...project(
        HOSTED_WEBSITE_PRESET.name,
        HOSTED_WEBSITE_BRIEF,
        "healthy",
        now(),
      ),
      target: "website",
      url: HOSTED_WEBSITE_URL,
      authorized: true,
    };
    s.projects.set(p.id, p);
    res.status(201).json(p);
  });
  router.post("/api/projects", (req, res) => {
    const input = createSchema.parse(req.body);
    const s = session(res);
    if (s.projects.size >= 4)
      return res.status(409).json({
        error: "This demo session allows up to four projects.",
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
    const checks = validateChecks(input.checks);
    if (
      p.target === "website" &&
      (!ownedWebsite(p) || checks.some((check) => check.path !== "/"))
    )
      return res.status(400).json({
        error:
          "The live preset allows checks of its fixed public homepage only.",
      });
    p.checks = checks;
    p.updatedAt = new Date(now()).toISOString();
    res.json(p);
  });
  router.post("/api/projects/:id/generate", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    if (!p) return notFound(res);
    const { brief } = z.object({ brief: briefSchema }).strict().parse(req.body);
    if (
      p.target === "website" &&
      (!ownedWebsite(p) || brief !== HOSTED_WEBSITE_BRIEF)
    )
      return res.status(400).json({
        error: "The live preset uses only its owner-approved fixed brief.",
      });
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
    const selectedBrief = ownedWebsite(p)
      ? HOSTED_WEBSITE_BRIEF
      : p.target === "sample" &&
          p.url === SAMPLE_URL &&
          p.authorized &&
          p.brief === DEMO_BRIEF
        ? DEMO_BRIEF
        : null;
    if (!selectedBrief)
      return res.status(400).json({
        error:
          "Live Gemma accepts only a server-selected sample or live homepage brief. Visitor or client text is not sent.",
      });
    while (gemmaStarts.length && gemmaStarts[0] <= now() - 60 * 60_000)
      gemmaStarts.shift();
    if (s.gemmaAttempts >= 2 || gemmaStarts.length >= 12 || modelBusy || active)
      return res.status(429).json({
        error:
          "The shared free model limit is reached. Keep your current plan and try later.",
      });
    s.gemmaAttempts++;
    gemmaStarts.push(now());
    modelBusy = true;
    const snapshot = structuredClone(p);
    try {
      await verifyGemmaFree();
      const proposed = await generateGemma(selectedBrief.split("\n"));
      if (s.expires <= now())
        return res.status(401).json({
          code: "SESSION_EXPIRED",
          error: "The demo session expired. No generated plan was saved.",
        });
      if (!isDeepStrictEqual(p, snapshot))
        return res.status(409).json({
          error:
            "This project changed during generation. The newer plan was kept; review it before trying again.",
        });
      const checks = validateModelProposal(selectedBrief, {
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
          reason: `Fresh Gemma proposal for the ${snapshot.target === "website" ? "owner-authorized live homepage" : "fixed synthetic"} brief, validated by the server. ${proposed.latencyMs} ms. ${proposed.usage ? `${proposed.usage.promptTokens} input / ${proposed.usage.completionTokens} output tokens.` : "Provider token usage was not reported."} ${proposed.orchestration ? "Generated and validated in a real isolated Mastra workflow. " : ""}${proposed.transportNormalization?.wholeJsonFenceRemoved ? "A whole JSON code fence was removed before strict schema validation. " : ""}Fixed templates describe the image and viewport predicates; quoted text stays exact. Review and approve every executable check.`,
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
      modelBusy = false;
    }
  });
  router.post("/api/projects/:id/generate-tinker", async (req, res) => {
    if (!authorizeHostedTinker(req.headers, process.env, now()))
      return notFound(res);
    const s = session(res);
    const p = s.projects.get(req.params.id);
    if (!p) return notFound(res);
    z.object({ modelConsent: z.literal(true) })
      .strict()
      .parse(req.body);
    if (!tinkerAvailable())
      return res.status(503).json({
        error:
          "Hosted Tinker is unavailable. The current plan has not changed.",
      });
    if (p.target !== "sample" || !p.authorized || p.brief !== DEMO_BRIEF)
      return res.status(400).json({
        error:
          "Hosted Tinker accepts only the original synthetic sample brief. Visitor or client text is not sent.",
      });
    if (modelBusy || active)
      return res.status(429).json({
        error:
          "Another model generation or browser audit is running. The current plan has not changed.",
      });
    modelBusy = true;
    const snapshot = structuredClone(p);
    try {
      // The native helper reserves the exact proof's allowance before its one request.
      const proposed = await generateTinker(DEMO_BRIEF.split("\n"));
      if (s.expires <= now())
        return res.status(401).json({
          code: "SESSION_EXPIRED",
          error: "The demo session expired. No generated plan was saved.",
        });
      if (!isDeepStrictEqual(p, snapshot))
        return res.status(409).json({
          error:
            "This project changed during generation. The newer plan was kept; review it before trying again.",
        });
      const returned = validateChecks(proposed.checks);
      const requirements = DEMO_BRIEF.split("\n");
      if (
        returned.length !== requirements.length ||
        returned.some(
          (check, index) =>
            check.requirement !== requirements[index] ||
            check.approved ||
            check.selector !== undefined,
        )
      )
        throw new Error(
          "The returned Tinker plan is not an unapproved source-bound proposal.",
        );
      const checks = validateModelProposal(DEMO_BRIEF, {
        checks: returned.map(
          ({ kind, path, expected, viewport }, requirementIndex) => ({
            kind,
            path,
            expected,
            viewport,
            requirementIndex,
          }),
        ),
      });
      Object.assign(p, {
        checks,
        generator: {
          provider: "Tinker (live trained checkpoint)",
          model: "Qwen/Qwen3.5-4B",
          reason: `Fresh trained Tinker sampler proposal for the fixed synthetic brief, validated by the server. ${proposed.usage ? `${proposed.usage.prompt_tokens} input / ${proposed.usage.completion_tokens} output tokens.` : "Provider token usage was not reported."} ${proposed.reservedTokens} tokens conservatively reserved before the request; this is a budget bound, not actual usage. Review and approve every executable check. This live action does not change the recorded benchmark.`,
        },
        updatedAt: new Date(now()).toISOString(),
      });
      return res.json(p);
    } catch {
      if (s.expires <= now())
        return res.status(401).json({
          code: "SESSION_EXPIRED",
          error: "The demo session expired. No generated plan was saved.",
        });
      return res.status(503).json({
        error:
          "Tinker, its confirmed-free allowance or proposal validation was unavailable. The current plan is unchanged. No AI success is claimed.",
      });
    } finally {
      modelBusy = false;
    }
  });
  router.post("/api/projects/:id/variant", (req, res) => {
    const p = session(res).projects.get(req.params.id);
    if (!p) return notFound(res);
    if (p.target !== "sample")
      return res.status(400).json({
        error: "The live website has no synthetic healthy or broken variants.",
      });
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
    if (
      (p.target === "website" &&
        (!ownedWebsite(p) || checks.some((check) => check.path !== "/"))) ||
      (p.target === "sample" && p.url !== SAMPLE_URL)
    )
      return res.status(400).json({
        error: "Only the exact server-approved target and page may be audited.",
      });
    if (checks.some((check) => check.kind !== "manual" && !check.approved))
      return res.status(409).json({
        error:
          "Review and approve every executable check before running the audit.",
      });
    if (active || modelBusy)
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
            const checked = validateResult(result, checks, snapshot);
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
          .map((result) => validateResult(result, checks, snapshot));
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
        const scope =
          snapshot.target === "website"
            ? "owner-authorized live website"
            : "synthetic sample";
        const observation = checks.every((check) => check.kind === "manual")
          ? "No automated browser assertion was executed; this plan requires human review."
          : count("passed") + count("failed") === 0
            ? `No automated browser assertion produced an observed pass or fail for the ${scope}.`
            : `Real Chromium observations of the ${scope}.`;
        a.summary = `${count("passed")} passed, ${count("failed")} failed, ${count("blocked")} blocked, ${count("unverified")} unverified. ${observation} ${snapshot.generator.model ? `Checks proposed by ${snapshot.generator.provider} (${snapshot.generator.model}) and reviewed by the visitor. Models do not assign test outcomes.` : "Deterministic draft checks reviewed by the visitor. No AI model was used."}`;
      } catch {
        a.status = "error";
        a.error =
          "The demo could not complete this audit. Unexecuted checks are not counted as passed.";
      } finally {
        a.completedAt = new Date(now()).toISOString();
        active = undefined;
        persistCompletedAudit(s, a);
        await cleanup().catch(() => {});
      }
    });
    active = { session: s, task };
    res.status(202).json(a);
  });
  router.get("/api/audits/:id/persistence", (req, res) => {
    const s = session(res);
    if (!s.audits.has(req.params.id)) return notFound(res);
    return res.json(
      tigerAvailable()
        ? (s.persistence.get(req.params.id) ?? {
            status: "unverified",
            detail: "No completed audit save has been confirmed.",
          })
        : {
            status: "not_configured",
            detail:
              "Hosted Tiger persistence is disabled or its confirmed trial window expired.",
          },
    );
  });
  router.get("/api/audits/:id", async (req, res) => {
    const s = session(res);
    const a = s.audits.get(req.params.id);
    if (!a) return notFound(res);
    if (
      a.status === "completed" &&
      tigerAvailable() &&
      s.persistence.get(a.id)?.status === "saved"
    ) {
      try {
        const stored = await tiger().getAudit(s.hash, a.id);
        if (s.expires <= now())
          return res.status(401).json({
            code: "SESSION_EXPIRED",
            error:
              "Your demo session expired. Reload Briefstamp to start a new session.",
          });
        if (
          !stored ||
          stored.id !== a.id ||
          stored.projectId !== a.projectId ||
          stored.status !== "completed" ||
          !stored.source ||
          !a.source ||
          stored.source.target !== a.source.target ||
          stored.source.url !== a.source.url ||
          stored.source.brief !== redact(a.source.brief) ||
          stored.source.sampleVariant !== a.source.sampleVariant ||
          stored.results.length !== a.results.length ||
          !stored.results.every((result) =>
            a.results.some(
              (original) =>
                original.checkId === result.checkId &&
                original.kind === result.kind &&
                original.status === result.status &&
                original.evidence.url === result.evidence.url &&
                redact(original.expected) === result.expected &&
                redact(original.requirement) === result.requirement,
            ),
          )
        )
          throw new Error("The saved audit could not be verified.");
        return res.set("X-Briefstamp-Storage", "tiger").json(stored);
      } catch {
        s.persistence.set(a.id, {
          status: "unverified",
          detail:
            "The saved audit could not be read and verified. The visitor's observed browser results remain available.",
        });
      }
    }
    if (s.expires <= now())
      return res.status(401).json({
        code: "SESSION_EXPIRED",
        error:
          "Your demo session expired. Reload Briefstamp to start a new session.",
      });
    return res.set("X-Briefstamp-Storage", "memory").json(a);
  });
  router.get("/api/operator/status", (req, res) => {
    if (
      !authorizeHostedBackboard(req.headers) &&
      !authorizeHostedTinker(req.headers, process.env, now())
    )
      return notFound(res);
    return res.json({
      backboard: hostBackboardEnabled(),
      tinker: tinkerAvailable(),
      scope:
        "Bounded hosted operator integrations. Visitor access remains isolated.",
    });
  });
  router.post("/api/audits/:id/memory", async (req, res) => {
    if (!authorizeHostedBackboard(req.headers)) return notFound(res);
    z.object({}).strict().parse(req.body);
    const audit = session(res).audits.get(req.params.id);
    if (!audit) return notFound(res);
    if (audit.status !== "completed")
      return res.status(409).json({
        error: "Only a completed audit can be saved to project memory.",
      });
    try {
      return res.json(await rememberHostedAudit(audit));
    } catch {
      return res.status(503).json({
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
      return res.status(503).json({
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
  router.get("/api/failures", async (req, res) => {
    // The existing unscoped UI search remains the visitor's memory-only filter.
    // An explicit owned project selects the separately verified Tiger query.
    if (req.query.projectId !== undefined) {
      const s = session(res);
      const projectId = z.string().uuid().parse(req.query.projectId);
      const p = s.projects.get(projectId);
      if (!p) return notFound(res);
      const query = z.string().trim().min(1).max(200).parse(req.query.q);
      if (!tigerAvailable())
        return res.status(503).json({
          error: "Hosted Tiger lexical retrieval is not configured.",
          mode: "unavailable",
        });
      try {
        const rows = await tiger().searchFailures(s.hash, { projectId, query });
        if (s.expires <= now())
          return res.status(401).json({
            code: "SESSION_EXPIRED",
            error:
              "Your demo session expired. Reload Briefstamp to start a new session.",
          });
        if (rows.length > 20 || rows.some((row) => row.projectId !== p.id))
          throw new Error("The retrieved project scope is invalid.");
        return res.json({
          results: rows.map((row) => ({ ...row, projectName: p.name })),
          mode: "tiger-lexical",
        });
      } catch {
        if (s.expires <= now())
          return res.status(401).json({
            code: "SESSION_EXPIRED",
            error:
              "Your demo session expired. Reload Briefstamp to start a new session.",
          });
        return res.status(503).json({
          error:
            "Tiger retrieval could not be verified. This is not an empty successful search.",
          mode: "unavailable",
        });
      }
    }
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
            ? "Invalid demo input. Use an approved target preset and at most 24 safe checks. Custom sample briefs allow up to 6,000 characters."
            : "The demo request could not be accepted. Check your input and try again.",
      });
    },
  );
  return {
    router,
    async dispose() {
      clearInterval(timer);
      await active?.task;
      await Promise.allSettled([...pendingPersistence]);
      if (ownsTigerStore) {
        ownsTigerStore = false;
        await tigerStore?.close();
      }
    },
  };
}
