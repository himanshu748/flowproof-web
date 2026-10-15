import type { Audit, Check, Project, ResultStatus } from "./types";
import { redact } from "./redact";

export type AuditChange =
  | "regressed"
  | "recovered"
  | "still_failing"
  | "unchanged"
  | "unknown"
  | "changed"
  | "added"
  | "removed";
export interface ComparisonRow {
  checkId: string;
  requirement: string;
  previousStatus: ResultStatus | "not_run" | null;
  currentStatus: ResultStatus | "not_run" | null;
  change: AuditChange;
}
export interface AuditComparisonResult {
  comparable: boolean;
  reason: string | null;
  rows: ComparisonRow[];
  counts: Record<AuditChange, number>;
}

export function snapshotSource(project: Project): NonNullable<Audit["source"]> {
  const { brief, generator, target, url, sampleVariant } = project;
  return structuredClone({ brief, generator, target, url, sampleVariant });
}

// Approval and generated identifiers do not change what the assertion means.
function assertionKey(check: Check): string {
  return JSON.stringify([
    check.requirement,
    check.kind,
    check.path,
    check.expected,
    check.selector ?? "",
    check.viewport,
  ]);
}

function observed(audit: Audit, check: Check): ResultStatus | "not_run" {
  const results = audit.results.filter((result) => result.checkId === check.id);
  if (results.length !== 1) return "not_run";
  const result = results[0];
  if (
    redact(result.requirement) !== redact(check.requirement) ||
    result.kind !== check.kind ||
    redact(result.expected) !== redact(check.expected) ||
    (check.kind !== "manual" && !check.approved)
  )
    return "not_run";
  return check.kind === "manual" ? "unverified" : result.status;
}

function transition(
  before: ComparisonRow["previousStatus"],
  after: ComparisonRow["currentStatus"],
): AuditChange {
  if (before === "passed" && after === "failed") return "regressed";
  if (before === "failed" && after === "passed") return "recovered";
  if (before === "failed" && after === "failed") return "still_failing";
  if (before === "passed" && after === "passed") return "unchanged";
  return "unknown";
}

export function compareAudits(
  current: Audit,
  baseline: Audit,
): AuditComparisonResult {
  const result: AuditComparisonResult = {
    comparable: false,
    reason: null,
    rows: [],
    counts: {
      regressed: 0,
      recovered: 0,
      still_failing: 0,
      unchanged: 0,
      unknown: 0,
      changed: 0,
      added: 0,
      removed: 0,
    },
  };
  const refuse = (reason: string) => ({ ...result, reason });
  if (current.id === baseline.id)
    return refuse("Choose a different earlier audit.");
  if (current.projectId !== baseline.projectId)
    return refuse("Audits must belong to the same project.");
  if (
    ![current, baseline].every(
      (audit) => audit.status === "completed" || audit.status === "error",
    )
  )
    return refuse("Wait for both audits to finish before comparing them.");
  if (
    ![current, baseline].every((audit) =>
      Number.isFinite(Date.parse(audit.createdAt)),
    ) ||
    Date.parse(baseline.createdAt) > Date.parse(current.createdAt)
  )
    return refuse(
      "The baseline must be an earlier audit with a recorded date.",
    );
  if (!current.source || !baseline.source)
    return refuse(
      "An older audit has no saved target context. Run a new audit to establish a trustworthy comparison.",
    );
  if (
    current.source.target !== baseline.source.target ||
    current.source.url !== baseline.source.url
  )
    return refuse(
      "These audits targeted different websites and cannot establish a regression or recovery.",
    );

  result.comparable = true;
  const oldKeys = baseline.checks.map(assertionKey);
  const newKeys = current.checks.map(assertionKey);
  const used = new Set<number>();
  for (const [index, check] of current.checks.entries()) {
    const key = newKeys[index];
    const exact = oldKeys.flatMap((value, i) => (value === key ? [i] : []));
    const sameId = baseline.checks.flatMap((item, i) =>
      item.id === check.id && !used.has(i) ? [i] : [],
    );
    const duplicate =
      newKeys.filter((value) => value === key).length > 1 ||
      exact.length > 1 ||
      current.checks.filter((item) => item.id === check.id).length > 1;
    let oldIndex = -1;
    let change: AuditChange;
    if (duplicate) {
      // Never pick one of several identical assertions and imply a proven fix.
      exact.forEach((i) => used.add(i));
      change = "unknown";
    } else if (sameId.length === 1 && oldKeys[sameId[0]] !== key) {
      oldIndex = sameId[0];
      change = "changed";
    } else if (exact.length === 1 && !used.has(exact[0])) {
      oldIndex = exact[0];
      const previous = baseline.checks[oldIndex];
      const uniqueId =
        baseline.checks.filter((item) => item.id === previous.id).length === 1;
      change = uniqueId
        ? transition(observed(baseline, previous), observed(current, check))
        : "unknown";
    } else {
      if (sameId.length === 1) {
        oldIndex = sameId[0];
        change = "changed";
      } else {
        change = sameId.length ? "unknown" : "added";
      }
    }
    if (oldIndex >= 0) used.add(oldIndex);
    result.rows.push({
      checkId: check.id,
      requirement: check.requirement,
      previousStatus:
        oldIndex >= 0 ? observed(baseline, baseline.checks[oldIndex]) : null,
      currentStatus: observed(current, check),
      change,
    });
  }
  baseline.checks.forEach((check, index) => {
    if (!used.has(index))
      result.rows.push({
        checkId: check.id,
        requirement: check.requirement,
        previousStatus: observed(baseline, check),
        currentStatus: null,
        change: "removed",
      });
  });
  for (const row of result.rows) result.counts[row.change]++;
  return result;
}
