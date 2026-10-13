import { afterEach, describe, expect, it, vi } from "vitest";
import { generateChecks, generateLocalChecks } from "../server/generator";
import { getEvaluation } from "../server/evaluation";
import { summarizeAudit } from "../server/gemma";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const brief =
  'The homepage heading must say "Design that moves business forward."\nA contact link must say "Start a project".\nEvery content image must have nonempty alternative text.\nThe homepage must fit a 390px mobile screen without horizontal scrolling.\nThe homepage must show "Independent by design."\nThe site should feel welcoming and trustworthy.';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("proposal safety and honest provenance", () => {
  it("produces all six sample proposals without approving any check", async () => {
    vi.stubEnv("FLOWPROOF_AI_ENABLED", "false");
    const result = await generateChecks(brief);
    expect(result.checks.map((check) => check.kind)).toEqual([
      "heading",
      "link",
      "image_alt",
      "no_horizontal_overflow",
      "text_visible",
      "manual",
    ]);
    expect(result.checks.every((check) => !check.approved)).toBe(true);
    expect(result.generator.provider).toBe("Deterministic parser");
    expect(result.generator.model).toBeNull();
  });
  it("abstains on negative, destructive, payment, subjective and unsupported width requirements", () => {
    for (const requirement of [
      'The page must not show "Premium".',
      'Delete all rows labelled "Expired".',
      'Purchase the product called "Basic".',
      "The site should feel trustworthy.",
      "Every content image must have descriptive alternative text.",
      "At 500px the page must have no horizontal scrolling.",
    ]) {
      expect(generateLocalChecks(requirement)[0].kind).toBe("manual");
    }
  });
  it("preserves explicit page scope and abstains on ambiguous paths and unsupported regions", () => {
    expect(
      generateLocalChecks('The /pricing page must show "Our plans".')[0],
    ).toMatchObject({ kind: "text_visible", path: "/pricing" });
    for (const requirement of [
      'The footer must show "Terms".',
      'The /pricing and /contact pages must show "Our plans".',
      'The nav must show "Contact".',
      'The /pricing?debug=true page must show "Our plans".',
    ]) {
      expect(generateLocalChecks(requirement)[0].kind).toBe("manual");
    }
  });
  it("binds AI proposals to explicit source path and viewport, and abstains on unsupported regions", async () => {
    vi.stubEnv("FLOWPROOF_AI_ENABLED", "true");
    const requirements = [
      'The /pricing page must show "Our plans" on a 390px mobile screen.',
      'The footer must show "Terms".',
    ];
    const fake = {
      checks: requirements.map((_, i) => ({
        requirementIndex: i,
        kind: "text_visible",
        path: "/",
        expected: i ? "Terms" : "Our plans",
        viewport: "desktop",
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ message: { content: JSON.stringify(fake) } }),
          ),
        ),
    );
    const result = await generateChecks(requirements.join("\n"));
    expect(result.checks[0]).toMatchObject({
      path: "/pricing",
      viewport: "mobile",
    });
    expect(result.checks[1].kind).toBe("manual");
  });
  it("rejects a huge brief instead of silently dropping requirements", () => {
    expect(() =>
      generateLocalChecks(Array(25).fill('Show "Hello".').join("\n")),
    ).toThrow("24");
  });
  it("accepts finite local model data while forcing fresh unapproved IDs", async () => {
    vi.stubEnv("FLOWPROOF_AI_ENABLED", "true");
    vi.stubEnv("FLOWPROOF_OLLAMA_MODEL", "gemma3:4b");
    const requirement = 'The homepage must show "Hello".';
    const fake = {
      checks: [
        {
          requirementIndex: 0,
          kind: "text_visible",
          path: "/",
          expected: "Hello",
          viewport: "desktop",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ message: { content: JSON.stringify(fake) } }),
          ),
        ),
    );
    const result = await generateChecks(requirement);
    expect(result.generator).toMatchObject({
      provider: "Ollama (local)",
      model: "gemma3:4b",
    });
    expect(result.checks[0].approved).toBe(false);
  });
  it("rejects approval flags and scripts in model output", async () => {
    vi.stubEnv("FLOWPROOF_AI_ENABLED", "true");
    const requirement = 'The homepage must show "Hello".';
    const fake = {
      checks: [
        {
          requirementIndex: 0,
          kind: "text_visible",
          path: "/",
          expected: "Hello",
          viewport: "desktop",
          approved: true,
          script: 'fetch("https://elsewhere.test")',
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ message: { content: JSON.stringify(fake) } }),
          ),
        ),
    );
    const result = await generateChecks(requirement);
    expect(result.generator.provider).toBe("Deterministic parser");
    expect(result.checks[0].approved).toBe(false);
  });
  it("forces human review when AI proposes a presence check for qualitative alt text", async () => {
    vi.stubEnv("FLOWPROOF_AI_ENABLED", "true");
    const requirement =
      "Every content image must have descriptive alternative text.";
    const fake = {
      checks: [
        {
          requirementIndex: 0,
          kind: "image_alt",
          path: "/",
          expected: "Alt exists",
          viewport: "desktop",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ message: { content: JSON.stringify(fake) } }),
          ),
        ),
    );
    const result = await generateChecks(requirement);
    expect(result.checks[0].kind).toBe("manual");
    expect(result.checks[0].approved).toBe(false);
  });
  it("does not contact a non-local model endpoint", async () => {
    vi.stubEnv("FLOWPROOF_AI_ENABLED", "true");
    vi.stubEnv("FLOWPROOF_OLLAMA_URL", "https://provider.example");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await generateChecks('The homepage must show "Hello".');
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not invent model evaluation values from synthetic candidates", () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), "flowproof-candidates-only-"),
    );
    try {
      copyFileSync(
        "eval/candidates.jsonl",
        path.join(root, "candidates.jsonl"),
      );
      const evaluation = getEvaluation({ root });
      expect(evaluation.dataset.candidates).toBe(360);
      expect(evaluation.dataset.validated).toBe(0);
      expect(
        evaluation.configurations.every(
          (config) =>
            config.structuredOutputRate === null &&
            config.falsePassRate === null,
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("leaves optional AI commentary off by default", async () => {
    vi.stubEnv("FLOWPROOF_GEMMA_ENABLED", "false");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await summarizeAudit({
        id: "audit",
        projectId: "project",
        projectName: "Demo",
        status: "completed",
        createdAt: new Date().toISOString(),
        checks: [],
        results: [],
      }),
    ).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
