import { useId, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, GitCompareArrows, Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  compareAudits,
  type AuditChange,
  type ComparisonRow,
} from "../shared/compare-audits";
import type { Audit } from "../shared/types";
import "./audit-comparison.css";

interface AuditComparisonProps {
  audit: Audit;
  audits: Audit[];
}

const changeLabels: Record<AuditChange, string> = {
  regressed: "Regressed",
  recovered: "Recovered",
  still_failing: "Still failing",
  unchanged: "Still passing",
  unknown: "Unknown",
  changed: "Check changed",
  added: "New check",
  removed: "Removed check",
};

const changeReasons: Record<AuditChange, string> = {
  regressed: "The same approved check passed earlier and failed in this audit.",
  recovered: "The same approved check failed earlier and passed in this audit.",
  still_failing: "The same approved check failed in both audits.",
  unchanged: "The same approved check passed in both audits.",
  unknown:
    "A blocked, manual, unrecorded or ambiguous result prevents a verified comparison.",
  changed:
    "This check's definition changed. These outcomes do not establish a regression or recovery.",
  added: "This check was not in the earlier plan. Its result has no baseline.",
  removed:
    "This check was removed from the newer plan. Removal does not prove that its requirement was met.",
};

const primaryChanges: AuditChange[] = [
  "regressed",
  "recovered",
  "still_failing",
];
const otherChanges: AuditChange[] = [
  "unchanged",
  "unknown",
  "changed",
  "added",
  "removed",
];

function dateLabel(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

function targetLabel(audit: Audit): string {
  if (!audit.source) return "Target context not saved";
  return audit.source.target === "sample"
    ? `${audit.source.sampleVariant === "broken" ? "Broken" : "Healthy"} synthetic sample`
    : audit.source.url;
}

function outcomeLabel(
  status: ComparisonRow["currentStatus"],
  change: AuditChange,
): string {
  if (status === null)
    return change === "unknown" ? "No unique match" : "Not in plan";
  if (status === "not_run") return "Not verified";
  if (status === "unverified") return "Unverified";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function AuditComparison({ audit, audits }: AuditComparisonProps) {
  const titleId = useId();
  const noteId = useId();
  const reducedMotion = useReducedMotion();
  const [selection, setSelection] = useState<{
    currentId: string;
    baselineId: string;
  } | null>(null);

  const candidates = useMemo(
    () =>
      audits
        .filter(
          (item) =>
            item.id !== audit.id &&
            item.projectId === audit.projectId &&
            (item.status === "completed" || item.status === "error") &&
            Number.isFinite(Date.parse(item.createdAt)) &&
            Date.parse(item.createdAt) <= Date.parse(audit.createdAt),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((item) => ({
          audit: item,
          comparison: compareAudits(audit, item),
        })),
    [audit, audits],
  );
  const available = candidates.filter((item) => item.comparison.comparable);
  const selected =
    (selection?.currentId === audit.id &&
      available.find((item) => item.audit.id === selection.baselineId)) ||
    available[0];
  const comparison = selected?.comparison;
  const unavailableReason =
    audit.status === "queued" || audit.status === "running"
      ? "This audit is still running. Comparison becomes available when it finishes."
      : !audit.source
        ? "This audit has no saved target context. Run the approved plan again to start a trustworthy comparison history."
        : candidates[0]?.comparison.reason ||
          "Run this project's approved plan again after making a change. Its earlier results will appear here for comparison.";

  return (
    <section className="audit-comparison" aria-labelledby={titleId}>
      <div className="audit-comparison-heading">
        <div className="audit-comparison-title">
          <span className="audit-comparison-mark" aria-hidden="true">
            <GitCompareArrows size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h3 id={titleId}>What changed?</h3>
            <p className="audit-comparison-intro">
              Compare this audit with an earlier run of the same project.
            </p>
          </div>
        </div>
        <label className="audit-comparison-baseline">
          Earlier audit
          <select
            value={selected?.audit.id || ""}
            disabled={available.length === 0}
            aria-describedby={available.length === 0 ? noteId : undefined}
            onChange={(event) =>
              setSelection({
                currentId: audit.id,
                baselineId: event.target.value,
              })
            }
          >
            {!selected && <option value="">No comparable audit yet</option>}
            {candidates.map((item) => (
              <option
                key={item.audit.id}
                value={item.audit.id}
                disabled={!item.comparison.comparable}
              >
                {dateLabel(item.audit.createdAt)} · {targetLabel(item.audit)} ·{" "}
                {item.audit.id.slice(-6)}
                {!item.comparison.comparable
                  ? ` · ${item.comparison.reason}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {comparison && selected ? (
        <motion.div
          key={`${audit.id}-${selected.audit.id}`}
          initial={reducedMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        >
          <div className="audit-comparison-runs">
            <div className="audit-comparison-run">
              <span className="audit-comparison-run-label">Earlier run</span>
              <time
                className="audit-comparison-run-time"
                dateTime={selected.audit.createdAt}
              >
                {dateLabel(selected.audit.createdAt)}
              </time>
              <span className="audit-comparison-run-detail">
                {targetLabel(selected.audit)}
              </span>
            </div>
            <ArrowRight
              className="audit-comparison-direction"
              size={24}
              aria-hidden="true"
            />
            <div className="audit-comparison-run">
              <span className="audit-comparison-run-label">This run</span>
              <time
                className="audit-comparison-run-time"
                dateTime={audit.createdAt}
              >
                {dateLabel(audit.createdAt)}
              </time>
              <span className="audit-comparison-run-detail">
                {targetLabel(audit)}
              </span>
            </div>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true">
            <dl className="audit-comparison-counts">
              {primaryChanges.map((change) => (
                <div
                  key={change}
                  className={`audit-comparison-count audit-comparison-count-${change}`}
                >
                  <dt>{changeLabels[change]}</dt>
                  <dd>{comparison.counts[change]}</dd>
                </div>
              ))}
            </dl>
            <ul
              className="audit-comparison-other-counts"
              aria-label="Other comparison outcomes"
            >
              {otherChanges.map((change) => (
                <li key={change}>
                  <strong>{comparison.counts[change]}</strong>{" "}
                  {changeLabels[change].toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
          <p className="audit-comparison-explanation">
            Recovery requires the same check to fail, then pass. Changed checks,
            missing results and manual judgments cannot prove a fix.
          </p>
          {candidates.length > available.length && (
            <p className="audit-comparison-explanation">
              Some earlier runs are unavailable because their target context
              cannot be matched. The selector includes the reason for each.
            </p>
          )}
          <details className="audit-comparison-details">
            <summary>
              <span>
                Review {comparison.rows.length} requirement comparison
                {comparison.rows.length === 1 ? "" : "s"}
              </span>
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <ul className="audit-comparison-list">
              {comparison.rows.map((row, index) => (
                <li
                  key={`${row.checkId}-${index}`}
                  className="audit-comparison-row"
                >
                  <div className="audit-comparison-row-heading">
                    <h4>{row.requirement}</h4>
                    <span
                      className={`audit-comparison-change audit-comparison-change-${row.change}`}
                    >
                      {changeLabels[row.change]}
                    </span>
                  </div>
                  <div className="audit-comparison-outcomes">
                    <span>
                      Earlier:{" "}
                      <b>{outcomeLabel(row.previousStatus, row.change)}</b>
                    </span>
                    <ArrowRight size={14} aria-hidden="true" />
                    <span>
                      This run:{" "}
                      <b>{outcomeLabel(row.currentStatus, row.change)}</b>
                    </span>
                  </div>
                  <p className="audit-comparison-row-reason">
                    {changeReasons[row.change]}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        </motion.div>
      ) : (
        <p className="audit-comparison-note" id={noteId}>
          <Info size={16} aria-hidden="true" />
          <span>{unavailableReason}</span>
        </p>
      )}

      <details className="audit-comparison-source">
        <summary>
          <span>Brief and test-plan source for this audit</span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        {audit.source ? (
          <>
            <dl className="audit-comparison-provenance">
              <div>
                <dt>Plan origin</dt>
                <dd>
                  {audit.source.generator.provider}
                  {audit.source.generator.model && (
                    <small>{audit.source.generator.model}</small>
                  )}
                  {audit.source.generator.reason && (
                    <small>{audit.source.generator.reason}</small>
                  )}
                </dd>
              </div>
              <div>
                <dt>Website tested</dt>
                <dd>{targetLabel(audit)}</dd>
              </div>
            </dl>
            <p className="audit-comparison-brief-label">Saved client brief</p>
            <p className="audit-comparison-brief">
              {audit.source.brief.trim() ||
                "No brief was recorded for this audit."}
            </p>
            <p className="audit-comparison-explanation">
              Saved when this audit began. The approved checks and their
              observed evidence are shown below.
            </p>
          </>
        ) : (
          <p className="audit-comparison-explanation">
            This older audit did not save its brief, plan origin or target. Run
            a new approved audit to record this information.
          </p>
        )}
      </details>
    </section>
  );
}
