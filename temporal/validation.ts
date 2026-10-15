import { createHash } from "node:crypto";
import { validateChecks } from "../server/schema.js";
import { SAMPLE_URL } from "../server/sample.js";
import { SafetyError } from "../server/safety.js";
import type { AuditWorkflowInput } from "./contracts.js";

/** The worker independently checks approval; a queued snapshot is not permission. */
export function validateApprovedAudit(input: AuditWorkflowInput): string {
  const { project, audit } = input;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(audit.id) || audit.projectId !== project.id)
    throw new SafetyError("Invalid audit identity.");
  let checks: ReturnType<typeof validateChecks>;
  let approvedPlan: ReturnType<typeof validateChecks>;
  try {
    checks = validateChecks(audit.checks);
    approvedPlan = validateChecks(project.checks);
  } catch {
    throw new SafetyError(
      "The audit plan failed schema or execution-bound validation.",
    );
  }
  if (
    checks.some(
      (check) =>
        (check.kind !== "manual" && !check.approved) ||
        !approvedPlan.some(
          (current) => JSON.stringify(current) === JSON.stringify(check),
        ),
    )
  )
    throw new SafetyError(
      "Every executable check must match the approved project snapshot.",
    );
  if (!project.authorized)
    throw new SafetyError("The target website is not authorized for audit.");
  if (project.target === "sample" && project.url !== SAMPLE_URL)
    throw new SafetyError(
      "Synthetic projects must use the built-in sample website.",
    );
  if (!["sample", "website"].includes(project.target))
    throw new SafetyError("Unsupported audit target.");
  return createHash("sha256")
    .update(
      JSON.stringify({
        project,
        audit: {
          id: audit.id,
          projectId: audit.projectId,
          checks: audit.checks,
        },
      }),
    )
    .digest("hex");
}
