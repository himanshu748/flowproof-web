import { z } from "zod";
import type { Check } from "../shared/types.js";

// Selectors are a small CSS subset, never Playwright's script-like selector DSL.
const selectorPattern =
  /^(?:[a-zA-Z][\w-]*|\*)?(?:[.#][\w-]+)*(?:\[(?:id|class|data-testid|role|aria-label|alt|href)(?:="[\w /:.,@#-]{1,100}")?\])?$/;
export function isSafePath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\?#\x00-\x20]/.test(value)
  )
    return false;
  try {
    const decoded = decodeURIComponent(value);
    return (
      !/[\\?#%\x00-\x20]/.test(decoded) &&
      !decoded.startsWith("//") &&
      !decoded.split("/").some((part) => part === "." || part === "..")
    );
  } catch {
    return false;
  }
}

export const CheckSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9_-]+$/),
    requirement: z.string().trim().min(1).max(3000),
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
      .max(300)
      .refine(
        isSafePath,
        "Use a site-relative path without query parameters or traversal.",
      ),
    expected: z.string().trim().max(1000),
    selector: z
      .string()
      .max(160)
      .refine(
        (value) => Boolean(value) && selectorPattern.test(value),
        "Only a simple CSS selector is allowed.",
      )
      .optional(),
    viewport: z.enum(["desktop", "mobile"]),
    approved: z.boolean(),
  })
  .strict()
  .superRefine((check, ctx) => {
    if (
      ["text_visible", "heading", "link"].includes(check.kind) &&
      !check.expected.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected"],
        message: "This assertion requires an expected value.",
      });
    }
  });

export function validateCheck(input: unknown): Check {
  return CheckSchema.parse(input);
}
export function validateChecks(input: unknown): Check[] {
  const checks = z.array(CheckSchema).min(1).max(24).parse(input);
  if (new Set(checks.map((check) => check.id)).size !== checks.length)
    throw new Error("Each check needs a unique ID.");
  if (new Set(checks.map((check) => check.path)).size > 8)
    throw new Error("An audit may visit at most 8 different page paths.");
  return checks;
}
