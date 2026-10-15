import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isSafePath, validateChecks } from "./schema.js";
import type { Check, CheckKind, Project } from "../shared/types.js";
import { generateTinkerProposal } from "./providers/tinker.js";

// The model proposes this finite data language. It never returns browser code.
const proposalSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            requirementIndex: z.number().int().min(0).max(23),
            kind: z.enum([
              "text_visible",
              "heading",
              "link",
              "image_alt",
              "no_horizontal_overflow",
              "manual",
            ]),
            path: z
              .string()
              .max(500)
              .regex(/^\/(?!\/)[^?#\\]*$/),
            expected: z.string().max(500),
            viewport: z.enum(["desktop", "mobile"]),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict();

export const GENERATION_PROMPT = `Convert client website requirements into a JSON object with a checks array. Each check has exactly requirement (copy the complete original requirement), kind, path, expected, viewport. Allowed kind: text_visible, heading, link, image_alt, no_horizontal_overflow, manual. path is a relative path starting /, never a URL. viewport must be exactly the string "desktop" or "mobile"; mobile means 390px. The text kinds assert exact visible text; expected must be the literal text specified by the client. link checks the visible label of a link, not destination behavior. image_alt checks presence and nonempty alternative text on content images; subjective quality needs manual. no_horizontal_overflow checks scroll width. Use manual for payments, forms, destructive actions, subjective claims, forbidden/negative assertions, missing expected text, unsupported viewport sizes, timing, counts, color, layout or any requirement not fully captured by these predicates. No selectors, scripts, tools, JavaScript or approval flags. Never omit a requirement. Return JSON only.`;

function requirementsFrom(brief: string): string[] {
  const parts = brief
    .split(/\n+/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ""))
    .filter(Boolean);
  if (!parts.length) throw new Error("Add at least one client requirement.");
  if (
    brief.length > 12000 ||
    parts.length > 24 ||
    parts.some((line) => line.length > 2000)
  ) {
    throw new Error(
      "Use at most 24 requirements, one per line, within 12,000 characters.",
    );
  }
  return parts;
}

function requirementScope(requirement: string): {
  path: string;
  viewport: "desktop" | "mobile";
  unsupported: boolean;
} {
  const context = requirement.replace(/["“]([^"”]+)["”]/g, '"literal text"');
  const paths = [
    ...new Set(
      [...context.matchAll(/(?:^|[\s(])(\/[^\s"”')<>]*)/g)].map((match) =>
        match[1].replace(/[.,;:]$/, ""),
      ),
    ),
  ];
  const viewport = /mobile|390\s*(?:px|pixel)/i.test(context)
    ? ("mobile" as const)
    : ("desktop" as const);
  const unsupportedWidth = [
    ...context.matchAll(/\b(\d+)\s*(?:px|pixels?)\b/gi),
  ].some((match) => Number(match[1]) !== 390);
  const region =
    /\b(?:footer|header|navigation|navbar|nav|sidebar|form|modal|dialog|carousel|card|banner|hero|section|menu)\b/i.test(
      context,
    );
  return {
    path: paths.length === 1 && isSafePath(paths[0]) ? paths[0] : "/",
    viewport,
    unsupported:
      paths.length > 1 ||
      paths.some((candidate) => !isSafePath(candidate)) ||
      unsupportedWidth ||
      region,
  };
}

function requiresManualReview(requirement: string): boolean {
  const context = requirement.replace(
    /[\"“]([^\"”]+)[\"”]/g,
    '\"literal text\"',
  );
  return /\b(?:submit|purchase|buy|delete|remove|send|log\s?in|sign\s?in|password|payment|checkout|redirect|navigate|destination|not|never|no longer|exactly\s+\d|at least\s+\d|within\s+\d|seconds?|milliseconds?|feel|trustworthy|beautiful|welcoming|descriptive|meaningful|accurate|appropriate|relevant|intuitive|quality|colors?|colours?|font|bold|centered|centred|above|below|only|buttons?|automatically|exactly)\b|n['’]t\b|https?:\/\/|\b(?:all|every|each) pages?\b|\band\b/i.test(
    context,
  );
}

function localCheck(requirement: string): Check {
  let kind: CheckKind = "manual";
  let expected =
    "A person must review this requirement; no supported deterministic assertion covers it.";
  const quoted = [...requirement.matchAll(/["“]([^"”]+)["”]/g)].map(
    (match) => match[1],
  );
  const text = requirement.toLowerCase();
  const {
    path,
    viewport,
    unsupported: unsupportedScope,
  } = requirementScope(requirement);
  const unsupported = requiresManualReview(requirement);
  if (!unsupported && !unsupportedScope) {
    if (
      /horizontal\s+(?:scroll|overflow)/i.test(requirement) &&
      /(?:no\s+horizontal|without\s+horizontal|fit|prevent)/i.test(requirement)
    ) {
      kind = "no_horizontal_overflow";
      expected = "No horizontal scrolling";
    } else if (
      /\b(?:images?|photos?)\b/i.test(requirement) &&
      /\b(?:alt(?:ernative)?\s*(?:text)?|alternative text)\b/i.test(requirement)
    ) {
      kind = "image_alt";
      expected =
        "Nonempty alternative text on every content image; description quality is outside this check";
    } else if (
      quoted.length === 1 &&
      /\b(?:heading|headline|h1|title)\b/.test(text) &&
      /\b(?:say|read|show|be|include|contain|display|text)\b/.test(text)
    ) {
      kind = "heading";
      expected = quoted[0];
    } else if (
      quoted.length === 1 &&
      /\blink\b/.test(text) &&
      /\b(?:say|read|show|label|labeled|labelled|text|include|contain|display|named)\b/.test(
        text,
      )
    ) {
      kind = "link";
      expected = quoted[0];
    } else if (
      quoted.length === 1 &&
      /\b(?:show|display|include|contain|visible|read|say)\b/.test(text)
    ) {
      kind = "text_visible";
      expected = quoted[0];
    }
  }
  return {
    id: randomUUID(),
    requirement,
    kind,
    path,
    expected,
    viewport,
    approved: false,
  };
}

export function generateLocalChecks(brief: string): Check[] {
  return requirementsFrom(brief).map(localCheck);
}

async function localModelChecks(
  brief: string,
  originals: string[],
): Promise<{ checks: Check[]; model: string }> {
  // Operator configuration only; never accept a provider URL from a project or brief.
  const endpoint = new URL(
    process.env.FLOWPROOF_OLLAMA_URL ?? "http://127.0.0.1:11434",
  );
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  ) {
    throw new Error("Only a configured loopback Ollama service is supported.");
  }
  const model = process.env.FLOWPROOF_OLLAMA_MODEL ?? "qwen3.5:4b";
  const response = await fetch(new URL("/api/chat", endpoint), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: {
        type: "object",
        properties: {
          checks: {
            type: "array",
            minItems: originals.length,
            maxItems: originals.length,
            items: {
              type: "object",
              properties: {
                requirementIndex: { type: "integer", minimum: 0, maximum: 23 },
                kind: {
                  enum: [
                    "text_visible",
                    "heading",
                    "link",
                    "image_alt",
                    "no_horizontal_overflow",
                    "manual",
                  ],
                },
                path: {
                  enum: [
                    ...new Set(
                      originals.map(
                        (requirement) => localCheck(requirement).path,
                      ),
                    ),
                  ],
                },
                expected: { type: "string" },
                viewport: { enum: ["desktop", "mobile"] },
              },
              required: [
                "requirementIndex",
                "kind",
                "path",
                "expected",
                "viewport",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["checks"],
        additionalProperties: false,
      },
      think: false,
      options: { temperature: 0, num_predict: 2048, num_ctx: 8192 },
      messages: [
        {
          role: "system",
          content: GENERATION_PROMPT.replace(
            "requirement (copy the complete original requirement)",
            "requirementIndex (zero-based integer from the supplied requirements list)",
          ).replace(
            "Never omit a requirement.",
            "Return exactly one proposal per requirementIndex in original order; never omit a requirement.",
          ),
        },
        { role: "user", content: JSON.stringify({ requirements: originals }) },
      ],
    }),
  });
  if (!response.ok)
    throw new Error("The configured local model could not generate a plan.");
  if (Number(response.headers.get("content-length") ?? 0) > 100000)
    throw new Error("Model response exceeds budget.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The local model returned no response.");
  let body = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 100000) {
      await reader.cancel();
      throw new Error("Model response exceeds budget.");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  const envelope = z
    .object({ message: z.object({ content: z.string().max(80000) }) })
    .parse(JSON.parse(body));
  const proposed = proposalSchema.parse(
    JSON.parse(envelope.message.content),
  ).checks;
  if (
    proposed.length !== originals.length ||
    proposed.some((check, index) => check.requirementIndex !== index)
  ) {
    throw new Error(
      "The local model omitted, duplicated or reordered a requirement index.",
    );
  }
  return {
    model,
    checks: validateChecks(
      proposed.map(({ requirementIndex, ...check }) => {
        const requirement = originals[requirementIndex];
        const scope = requirementScope(requirement);
        if (requiresManualReview(requirement) || scope.unsupported)
          return { ...localCheck(requirement), kind: "manual" as const };
        return {
          ...check,
          path: scope.path,
          viewport: scope.viewport,
          requirement,
          id: randomUUID(),
          approved: false,
        };
      }),
    ),
  };
}

export async function generateChecks(
  brief: string,
): Promise<{ checks: Check[]; generator: Project["generator"] }> {
  const originals = requirementsFrom(brief);
  if (process.env.BRIEFSTAMP_TINKER_ENABLED === "true") {
    try {
      const proposed = await generateTinkerProposal(originals);
      const checks = validateChecks(proposed.checks.map((check, index) => {
        const requirement = originals[index];
        const scope = requirementScope(requirement);
        if (proposed.redacted[index] || requiresManualReview(requirement) || scope.unsupported)
          return { ...localCheck(requirement), kind: "manual" as const };
        return { ...check, requirement, path: scope.path, viewport: scope.viewport, id: randomUUID(), approved: false };
      }));
      return { checks, generator: { provider: "Tinker (operator checkpoint)", model: proposed.model, reason: "Tinker checkpoint proposals validated against the safe assertion schema. Review and approve every check. This is separate from the recorded model benchmark." } };
    } catch {
      return { checks: originals.map(localCheck), generator: { provider: "Deterministic parser", model: null, reason: "Tinker was unavailable, unconfigured, outside its confirmed-free budget or returned an invalid plan. These drafts were created by rules; no Tinker success is claimed." } };
    }
  }
  if (process.env.FLOWPROOF_AI_ENABLED === "true") {
    try {
      const { checks, model } = await localModelChecks(brief, originals);
      return {
        checks,
        generator: {
          provider: "Ollama (local)",
          model,
          reason:
            "AI proposals validated against a finite schema. Review and approve every assertion before running.",
        },
      };
    } catch {
      return {
        checks: originals.map(localCheck),
        generator: {
          provider: "Deterministic parser",
          model: null,
          reason:
            "Local AI was unavailable or returned an invalid plan. These are rule-based draft checks, not AI-generated checks.",
        },
      };
    }
  }
  return {
    checks: originals.map(localCheck),
    generator: {
      provider: "Deterministic parser",
      model: null,
      reason:
        "Local rules create draft checks at no API cost. AI generation is not configured.",
    },
  };
}
