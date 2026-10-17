import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDashed,
  Database,
  Download,
  FileCheck2,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { Audit, Project } from "../shared/types";
import type {
  JudgeAgentFailure,
  JudgeAgentFinding,
  JudgeAgentHistoryRow,
  JudgeAgentRequest,
  JudgeAgentResult,
  JudgeAgentStatus,
} from "../shared/judge-agent-types";
import {
  HOSTED_WEBSITE_PRESET,
  HOSTED_WEBSITE_URL,
} from "../shared/hosted-target";
import { SessionChangedError } from "./session-recovery";
import "./judge-agent.css";

const RECORDED_PROOF =
  "https://github.com/himanshu748/flowproof-web/blob/main/docs/HOSTED_OPTIONAL.md#native-gemma-evidence-agent-loop-verified-at-1215-utc";
const toolNames = {
  failure_history: "Tiger failure history",
  search_visibility: "SerpApi search visibility",
};
const checkNames = {
  heading: "Homepage heading",
  link: "Contact link",
  image_alt: "Image alternative text",
  no_horizontal_overflow: "Mobile layout",
  text_visible: "Visible copy",
  manual: "Human review",
};
type Busy = "" | "status" | "prepare" | "approve" | "audit" | "agent";
type Persistence = "saving" | "saved" | "unverified" | "not_configured";

function unwrap(value: JudgeAgentStatus["result"]) {
  if (!value) return { receipt: undefined, failure: undefined };
  if ("error" in value)
    return {
      receipt: value.receipt
        ? {
            ...value.receipt,
            toolReceipts: value.toolReceipts || value.receipt.toolReceipts,
            providerAttempts:
              value.providerAttempts || value.receipt.providerAttempts,
          }
        : undefined,
      failure: value,
    };
  return { receipt: value, failure: undefined };
}
function downloadReceipt(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "briefstamp-evidence-agent-receipt.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function timestamp(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function JudgeAgentInvite({ onOpen }: { onOpen: () => void }) {
  return (
    <section
      className="judge-agent-invite"
      aria-labelledby="judge-agent-invite-title"
    >
      <div className="judge-agent-invite-mark" aria-hidden="true">
        <Sparkles size={24} />
      </div>
      <div>
        <span className="section-kicker">OPTIONAL, AFTER THE SAMPLE DEMO</span>
        <h2 id="judge-agent-invite-title">Optional: public evidence agent</h2>
        <p>
          The main sample demo works without this step. Of four retained public
          attempts, one completed, two returned Google HTTP 500, and one had a
          search timeout. Shared allowance: 100 runs total, six/hour and
          one/session, ending October 20, 2026 at 00:00 UTC.
        </p>
      </div>
      <button type="button" className="button" onClick={onOpen}>
        Open the optional agent <ArrowRight size={17} />
      </button>
    </section>
  );
}

export function JudgeAgent({
  request,
  sampleBrief,
  projects,
  onWorkspaceChange,
  active,
}: {
  request: JudgeAgentRequest;
  sampleBrief: string;
  projects: Project[];
  onWorkspaceChange: () => Promise<unknown>;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const revision = useRef(0);
  const busyRef = useRef(false);
  const confirmedNoReservation = useRef(false);
  const [busy, setBusy] = useState<Busy>("");
  const [status, setStatus] = useState<JudgeAgentStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [error, setError] = useState("");
  const [sample, setSample] = useState<Project | null>(null);
  const [website, setWebsite] = useState<Project | null>(null);
  const [approved, setApproved] = useState(false);
  const [consent, setConsent] = useState(false);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [persistence, setPersistence] = useState<Persistence | null>(null);
  const [pendingMessage, setPendingMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [uncertainWrite, setUncertainWrite] = useState(false);
  const [result, setResult] = useState<JudgeAgentResult | null>(null);
  const [failure, setFailure] = useState<JudgeAgentFailure | null>(null);

  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  const assertCurrent = (version: number) => {
    if (version !== revision.current) throw new SessionChangedError();
  };
  const loadStatus = async (version = revision.current) => {
    const next = await request<JudgeAgentStatus>("/judge-agent/status");
    assertCurrent(version);
    setStatus(next);
    setStatusError("");
    if (next.result) {
      const { receipt, failure: savedFailure } = unwrap(next.result);
      if (receipt) setResult(receipt);
      setFailure(savedFailure ?? null);
      setSubmitted(true);
    } else if (
      confirmedNoReservation.current &&
      next.available &&
      next.budget?.visitorUsed === false
    ) {
      // A confirmed denial plus fresh unused status permits another click.
      // No request is replayed, and ambiguous transport failures stay locked.
      setSubmitted(false);
    }
    return next;
  };
  useEffect(() => {
    if (!active) return;
    const version = revision.current;
    void loadStatus(version).catch((caught) => {
      if (version !== revision.current || caught instanceof SessionChangedError)
        return;
      setStatusError(
        "Availability could not be checked. Refresh status before starting.",
      );
    });
  }, [active]);

  const operate = async (
    label: Busy,
    work: (version: number) => Promise<void>,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const version = revision.current;
    setBusy(label);
    setError("");
    try {
      await work(version);
    } catch (caught) {
      if (version !== revision.current || caught instanceof SessionChangedError)
        return;
      const ambiguous =
        caught instanceof Error &&
        (caught.name === "AbortError" || caught.name === "TypeError");
      if (ambiguous && label !== "status") setUncertainWrite(true);
      setError(
        ambiguous
          ? "The server did not confirm this operation. Refresh status to look for a saved result. No write or model call will be repeated automatically."
          : caught instanceof Error
            ? caught.message
            : "This step could not finish. Your existing browser results remain unchanged.",
      );
    } finally {
      if (version === revision.current) {
        busyRef.current = false;
        setBusy("");
        setPendingMessage("");
      }
    }
  };

  const prepare = () =>
    operate("prepare", async (version) => {
      const latest = await loadStatus(version);
      if (!latest.available || latest.budget?.visitorUsed)
        throw new Error(
          latest.reason ||
            "A live run is unavailable for this visitor session.",
        );
      let nextSample =
        sample ||
        projects.find(
          (item) =>
            item.name === "Evidence agent sample" &&
            item.target === "sample" &&
            item.sampleVariant === "broken" &&
            item.brief === sampleBrief &&
            item.authorized &&
            item.checks.length === 6,
        );
      if (!nextSample) {
        nextSample = await request<Project>("/projects", "POST", {
          name: "Evidence agent sample",
          target: "sample",
          sampleVariant: "broken",
          authorized: true,
          brief: sampleBrief,
        });
        assertCurrent(version);
      }
      setSample(nextSample);
      let nextWebsite =
        website ||
        projects.find(
          (item) =>
            item.target === "website" &&
            item.url === HOSTED_WEBSITE_URL &&
            item.brief === HOSTED_WEBSITE_PRESET.brief &&
            item.authorized,
        );
      if (!nextWebsite) {
        nextWebsite = await request<Project>("/projects/preset", "POST", {
          preset: HOSTED_WEBSITE_PRESET.id,
        });
        assertCurrent(version);
      }
      setWebsite(nextWebsite);
      await onWorkspaceChange();
    });
  const approve = () =>
    operate("approve", async (version) => {
      if (!sample) return;
      const updated = await request<Project>(
        `/projects/${sample.id}/checks`,
        "PUT",
        {
          checks: sample.checks.map((check) => ({ ...check, approved: true })),
        },
      );
      assertCurrent(version);
      setSample(updated);
      setApproved(
        updated.checks.every(
          (check) => check.kind === "manual" || check.approved,
        ),
      );
      await onWorkspaceChange();
    });
  const wait = async (version: number) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assertCurrent(version);
  };
  const observeAudit = async (id: string, version: number) => {
    const deadline = Date.now() + 100_000;
    let completed: Audit | undefined;
    while (Date.now() < deadline) {
      const current = await request<Audit>(`/audits/${id}`);
      assertCurrent(version);
      setAudit(current);
      if (current.status === "error")
        throw new Error(
          current.error ||
            "The browser audit could not complete. Unexecuted checks are not passes.",
        );
      if (current.status === "completed") {
        completed = current;
        break;
      }
      await wait(version);
    }
    if (!completed)
      throw new Error(
        "The audit is still pending. Use Check saved audit to read its state without starting another audit.",
      );
    setPendingMessage(
      "Browser observations are complete. Waiting for Tiger to confirm the saved audit.",
    );
    while (Date.now() < deadline) {
      const saved = await request<{ status: Persistence; detail?: string }>(
        `/audits/${id}/persistence`,
      );
      assertCurrent(version);
      setPersistence(saved.status);
      if (saved.status === "saved") {
        await onWorkspaceChange();
        return;
      }
      if (saved.status !== "saving")
        throw new Error(
          saved.detail ||
            "Tiger has not verified this audit. Agent review remains unavailable.",
        );
      await wait(version);
    }
    throw new Error(
      "Tiger persistence is still pending. Check the saved audit before continuing.",
    );
  };
  const runAudit = () =>
    operate("audit", async (version) => {
      if (!sample || !approved) return;
      setPendingMessage(
        "Chromium is checking the approved synthetic sample. This page will show only returned observations.",
      );
      const started = await request<Audit>(
        `/projects/${sample.id}/audits`,
        "POST",
        {},
      );
      assertCurrent(version);
      setAudit(started);
      await observeAudit(started.id, version);
    });
  const runAgent = () =>
    operate("agent", async (version) => {
      if (
        !audit ||
        !website ||
        !consent ||
        persistence !== "saved" ||
        submitted
      )
        return;
      const latest = await loadStatus(version);
      if (!latest.available || latest.budget?.visitorUsed)
        throw new Error(
          latest.reason ||
            "This visitor session cannot start another agent run.",
        );
      setSubmitted(true);
      confirmedNoReservation.current = false;
      setPendingMessage(
        "The server is checking free funding, reserving this session's allowance, and running Gemma with its selected tools. Waiting for the complete receipt; individual phases are not streamed.",
      );
      try {
        const receipt = await request<JudgeAgentResult>(
          `/audits/${audit.id}/judge-review`,
          "POST",
          { websiteProjectId: website.id, modelConsent: true },
        );
        assertCurrent(version);
        setResult(receipt);
        if (receipt.budget)
          setStatus((current) =>
            current ? { ...current, budget: receipt.budget } : current,
          );
      } catch (caught) {
        confirmedNoReservation.current =
          caught instanceof Error &&
          "allowanceConsumed" in caught &&
          caught.allowanceConsumed === false;
        throw caught;
      } finally {
        assertCurrent(version);
        await loadStatus(version).catch((caught) => {
          if (caught instanceof SessionChangedError) throw caught;
          setStatusError(
            "The final allowance status could not be refreshed. A model request will not be replayed.",
          );
        });
      }
    });

  const canStart =
    status?.available &&
    !status.budget?.visitorUsed &&
    !statusError &&
    !uncertainWrite &&
    !submitted;
  const locked = !!busy;
  const counts = audit?.results.reduce(
    (total, row) => ({ ...total, [row.status]: total[row.status] + 1 }),
    { passed: 0, failed: 0, blocked: 0, unverified: 0 },
  );
  const auditId =
    result?.sourceAuditId ||
    failure?.sourceAuditId ||
    (audit?.status === "completed" ? audit.id : undefined);
  return (
    <motion.section
      className="judge-agent"
      aria-labelledby="judge-agent-title"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
    >
      <div className="judge-agent-heading">
        <div>
          <span className="section-kicker">OPTIONAL, WITH YOUR APPROVAL</span>
          <h1 id="judge-agent-title">Optional: public evidence agent</h1>
          <p>
            The <a href="#demo">main sample demo</a> works without this step.
            Give Gemma a browser audit, then inspect Tiger history, SerpApi
            search and the cited observations. Of four retained public attempts,
            one completed, two returned Google HTTP 500, and one had a search
            timeout.
          </p>
          <p>
            Shared allowance: 100 runs total, six/hour and one/session, ending
            October 20, 2026 at 00:00 UTC. Failed reservations stay spent.
          </p>
        </div>
        <a
          className="judge-agent-recorded"
          href={RECORDED_PROOF}
          target="_blank"
          rel="noreferrer"
        >
          View recorded proof <ArrowUpRight size={16} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>

      <div className="judge-agent-availability" aria-live="polite">
        <span className="judge-agent-availability-icon" aria-hidden="true">
          <ShieldCheck size={21} />
        </span>
        <div>
          <strong>
            {statusError
              ? "Availability unknown"
              : !status
                ? "Checking the live allowance"
                : status.budget?.visitorUsed
                  ? "This visitor session has used its run"
                  : status.available
                    ? "A live run is available"
                    : "Live runs are unavailable"}
          </strong>
          <p>
            {statusError ||
              status?.reason ||
              (status?.available
                ? "One run per browser session, from a shared confirmed-free allowance. Availability is checked again before execution."
                : "No provider request can start until availability is confirmed.")}
          </p>
          {status?.budget && (
            <span className="judge-agent-budget">
              {status.budget.remainingRuns} of {status.budget.maximumRuns}{" "}
              shared runs remaining · {status.budget.usedRuns} reserved
            </span>
          )}
          {status?.expiresAt && (
            <span className="judge-agent-budget">
              Live allowance expires {timestamp(status.expiresAt)}
            </span>
          )}
        </div>
        <button
          className="button"
          type="button"
          disabled={locked}
          onClick={() =>
            operate("status", async (version) => {
              await loadStatus(version);
            })
          }
        >
          <RefreshCw size={15} />
          Refresh status
        </button>
      </div>

      {error && (
        <div className="judge-agent-alert" role="alert">
          <TriangleAlert size={18} />
          <p>{error}</p>
        </div>
      )}
      {busy && busy !== "status" && (
        <div className="judge-agent-pending" role="status">
          <LoaderCircle className="spin" size={18} />
          <p>
            {pendingMessage ||
              (busy === "prepare"
                ? "Preparing the fixed projects. No model or search request is being made."
                : busy === "approve"
                  ? "Saving your explicit approval. No model request is being made."
                  : busy === "audit"
                    ? "Reading the browser audit and its saved evidence. No model request is being made."
                    : "Checking the live allowance before requesting the agent run.")}
          </p>
        </div>
      )}

      {!result && !failure && !status?.budget?.visitorUsed && (
        <div className="judge-agent-workflow">
          <section className="judge-agent-step">
            <div className="judge-agent-step-heading">
              <span className="judge-agent-step-number">1</span>
              <div>
                <h2>Review what the browser will check</h2>
                <p>
                  Fixed synthetic brief. Deterministic draft checks. You approve
                  the plan; Gemma analyzes the evidence later.
                </p>
              </div>
            </div>
            {!sample ? (
              <div className="judge-agent-prepare">
                <p>
                  We deliberately break a sample homepage's heading, image
                  description and mobile layout. The only search target is our
                  own public Briefstamp homepage. No private client text is
                  accepted. Every walkthrough asks you to review and confirm the
                  checks.
                </p>
                <button
                  className="button primary"
                  type="button"
                  disabled={locked || !canStart || !sampleBrief}
                  onClick={prepare}
                >
                  Prepare the sample <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <>
                {!approved && sample.checks.some((check) => check.approved) && (
                  <p className="judge-agent-approval-note">
                    This saved plan was approved earlier. Review it again and
                    explicitly confirm before starting this walkthrough.
                  </p>
                )}
                <ol className="judge-agent-checks">
                  {sample.checks.map((check) => (
                    <li key={check.id}>
                      <span
                        className="judge-agent-check-icon"
                        aria-hidden="true"
                      >
                        {approved ? (
                          <Check size={16} />
                        ) : (
                          <CircleDashed size={16} />
                        )}
                      </span>
                      <div>
                        <strong>{check.requirement}</strong>
                        <p>
                          {check.kind === "manual"
                            ? "Stays unverified. A person must decide."
                            : `Expected: ${check.expected} · ${check.viewport === "mobile" ? "390px mobile viewport" : "Desktop viewport"}`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="judge-agent-step-action">
                  {!website ? (
                    <button
                      className="button"
                      type="button"
                      disabled={locked || !canStart}
                      onClick={prepare}
                    >
                      Finish preparing the search target
                    </button>
                  ) : (
                    <button
                      className={`button ${approved ? "" : "primary"}`}
                      type="button"
                      disabled={locked || approved || !canStart}
                      onClick={approve}
                    >
                      {approved ? (
                        <Check size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      {approved
                        ? "Checks approved"
                        : "I reviewed these checks. Approve all"}
                    </button>
                  )}
                  <small>
                    Approval allows only the listed read-only browser
                    assertions.
                  </small>
                </div>
              </>
            )}
          </section>
          <section className="judge-agent-step">
            <div className="judge-agent-step-heading">
              <span className="judge-agent-step-number">2</span>
              <div>
                <h2>Capture and save the browser evidence</h2>
                <p>
                  Run Chromium against the approved sample, then verify that
                  Tiger saved the results.
                </p>
              </div>
            </div>
            {counts && (
              <div
                className="judge-agent-counts"
                aria-label="Observed browser results"
              >
                {Object.entries(counts).map(([label, count]) => (
                  <span key={label} className={`judge-agent-count-${label}`}>
                    <strong>{count}</strong> {label}
                  </span>
                ))}
              </div>
            )}
            {audit?.status === "completed" && (
              <p className="judge-agent-storage">
                <Database size={15} />
                {persistence === "saved"
                  ? "Tiger confirmed this audit was saved."
                  : "Waiting for verified Tiger persistence."}
              </p>
            )}
            {!!audit?.results.length && (
              <details className="judge-agent-browser-details">
                <summary>
                  Inspect {audit.results.length} returned browser observations
                </summary>
                <ol>
                  {audit.results.map((row) => (
                    <li key={row.checkId}>
                      <div>
                        <strong>{row.requirement}</strong>
                        <span>{row.status}</span>
                      </div>
                      <p>{row.evidence.observed}</p>
                      {row.evidence.screenshot &&
                        /^\/evidence\/[a-f0-9-]{36}\/[a-zA-Z0-9_-]+\.png$/.test(
                          row.evidence.screenshot,
                        ) && (
                          <a
                            href={row.evidence.screenshot}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open captured screenshot <ArrowUpRight size={12} />
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        )}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            <div className="judge-agent-step-action">
              {audit ? (
                <button
                  className="button"
                  type="button"
                  disabled={locked || persistence === "saved"}
                  onClick={() =>
                    operate("audit", (version) =>
                      observeAudit(audit.id, version),
                    )
                  }
                >
                  <RefreshCw size={16} />
                  {persistence === "saved"
                    ? "Browser evidence ready"
                    : "Check saved audit"}
                </button>
              ) : (
                <button
                  className="button primary"
                  type="button"
                  disabled={locked || !approved || !website || !canStart}
                  onClick={runAudit}
                >
                  <Globe2 size={16} />
                  Run the approved browser audit
                </button>
              )}
              <small>
                {approved
                  ? "Screenshots and returned observations remain linked to each requirement."
                  : "Review and approve the checks above to unlock this step."}
              </small>
            </div>
          </section>
          <section className="judge-agent-step">
            <div className="judge-agent-step-heading">
              <span className="judge-agent-step-number">3</span>
              <div>
                <h2>Let the agent investigate</h2>
                <p>
                  Gemma can select saved failure history and a search snapshot,
                  then cite what the tools actually return.
                </p>
              </div>
            </div>
            <label className="judge-agent-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={locked || submitted}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                I agree to send the fixed synthetic audit observations and
                public search data to Google-hosted Gemma, and the owned
                homepage search query to SerpApi. Free-tier model inputs may be
                used to improve Google's products. No private brief is sent.
              </span>
            </label>
            <div className="judge-agent-step-action">
              <button
                className="button primary"
                type="button"
                disabled={
                  locked || !consent || persistence !== "saved" || !canStart
                }
                onClick={runAgent}
              >
                <Sparkles size={16} />
                {submitted
                  ? "Run requested; refresh status for its receipt"
                  : "Run the evidence agent"}
              </button>
              <small>
                At most two model requests and one search. A reserved run
                remains consumed if it fails.
              </small>
            </div>
          </section>
        </div>
      )}
      {(result || failure) && (
        <AgentResult receipt={result} failure={failure} audit={audit} />
      )}
      {status?.budget?.visitorUsed && !result && !failure && (
        <div className="judge-agent-empty">
          <FileCheck2 size={28} />
          <h2>This session's allowance is reserved.</h2>
          <p>
            A receipt may still be pending or unavailable. Refresh status to
            look for it. This action only reads status and cannot repeat the
            agent run.
          </p>
        </div>
      )}
      {auditId && (
        <div className="judge-agent-downloads">
          <a
            className="button"
            href={`/api/audits/${encodeURIComponent(auditId)}/report`}
            download
          >
            <Download size={16} />
            Download browser report
          </a>
          {(result || failure) && (
            <button
              className="button"
              type="button"
              onClick={() => downloadReceipt(failure || result)}
            >
              <Download size={16} />
              Download agent receipt
            </button>
          )}
          <p>
            The browser report contains acceptance observations. Agent findings
            provide separate context and never change those outcomes.
          </p>
        </div>
      )}
      <p className="judge-agent-scope">
        Fixed sample and owned homepage only. Tiger history uses precomputed
        MiniLM vectors and three fixed queries; this is not general embedding
        inference. Search is a dated snapshot, not proof of indexing or a
        passing website.{" "}
        <a href={RECORDED_PROOF} target="_blank" rel="noreferrer">
          Recorded proof and limitations <ArrowUpRight size={12} />
        </a>
      </p>
    </motion.section>
  );
}

function AgentResult({
  receipt,
  failure,
  audit,
}: {
  receipt: JudgeAgentResult | null;
  failure: JudgeAgentFailure | null;
  audit: Audit | null;
}) {
  const history =
    receipt?.toolReceipts?.find((item) => item.tool === "failure_history")
      ?.result ||
    receipt?.observations?.find(
      (item) => item.type === "failure_history" && item.status === "observed",
    )?.rows ||
    [];
  const search = receipt?.toolReceipts?.find(
    (item) => item.tool === "search_visibility",
  )?.result;
  const searchObservation = receipt?.observations?.find(
    (item) => item.type === "search_visibility",
  );
  const provider = receipt?.providerAttempts?.find(
    (item) => item.provider === "serpapi",
  );
  const findings = receipt?.modelOutput?.findings || [];
  const resultCount =
    search?.results.length ??
    (searchObservation?.status === "observed" &&
    searchObservation.type === "search_visibility"
      ? searchObservation.resultCount
      : undefined);
  const findingText = (finding: JudgeAgentFinding) => {
    if (finding.type === "search_snapshot")
      return `Search snapshot cited: ${finding.resultCount} matching results. This is not an indexing or acceptance verdict.`;
    if (finding.type === "tool_unavailable")
      return `${toolNames[finding.tool]} was unavailable. No successful observation is claimed.`;
    const row = history.find(
      (item: JudgeAgentHistoryRow) =>
        item.checkId === finding.checkId && item.auditId === finding.auditId,
    );
    const check = audit?.checks.find((item) => item.id === finding.checkId);
    return `${finding.type === "historical_failure" ? "Saved history" : "Browser result"} cited: ${row?.requirement || check?.requirement || `check ${finding.checkId.slice(0, 8)}`} (${finding.status}).`;
  };
  return (
    <section
      className="judge-agent-results"
      aria-labelledby="judge-agent-result-title"
    >
      <div className="judge-agent-result-heading">
        <span className="judge-agent-result-mark">
          <FileCheck2 size={26} />
        </span>
        <div>
          <span className="section-kicker">YOUR SESSION'S RECEIPT</span>
          <h2 id="judge-agent-result-title">
            {failure || receipt?.status === "failed"
              ? "The run could not complete."
              : receipt?.status === "completed_with_unavailable_tools"
                ? "Some evidence was unavailable."
                : receipt?.status === "running"
                  ? "The run is still pending."
                  : "Evidence returned. Sources attached."}
          </h2>
          <p>
            {failure?.error ||
              (receipt?.sourceAuditUnchanged
                ? "The agent left the source browser audit unchanged."
                : "Audit immutability was not confirmed by this receipt.")}
          </p>
        </div>
      </div>
      {receipt && (
        <>
          <div className="judge-agent-provenance">
            <span>
              {receipt.transport === "native_google_gemma"
                ? receipt.orchestration?.provider === "Mastra Agent"
                  ? "Mastra Agent · Google Gemma JSON bridge"
                  : "Native Google Gemma"
                : "Injected offline fixture"}
            </span>
            <span>{receipt.model}</span>
            <span>{timestamp(receipt.completedAt || receipt.startedAt)}</span>
          </div>
          <div className="judge-agent-selected">
            <strong>Tools the model selected</strong>
            {receipt.selection?.tools.length ? (
              receipt.selection.tools.map((tool) => (
                <span key={tool.name}>{toolNames[tool.name]}</span>
              ))
            ) : (
              <span>No tool selection was returned.</span>
            )}
          </div>
          <div className="judge-agent-result-grid">
            <section className="judge-agent-tool">
              <h3>
                <Database size={18} />
                Tiger failure history
              </h3>
              {history.length ? (
                <>
                  <p>
                    {history.length} saved rows returned. These are prior stored
                    observations, not new browser tests.
                  </p>
                  <ol className="judge-agent-history">
                    {history.map((row: JudgeAgentHistoryRow) => (
                      <li key={`${row.auditId}-${row.checkId}`}>
                        <strong>
                          {row.requirement || checkNames[row.kind]}
                        </strong>
                        {row.observed && <p>{row.observed}</p>}
                        <dl>
                          <div>
                            <dt>Vector rank</dt>
                            <dd>{row.vectorRank}</dd>
                          </div>
                          <div>
                            <dt>Cosine</dt>
                            <dd>
                              {Number.isFinite(row.cosine)
                                ? row.cosine.toFixed(4)
                                : "Unreported"}
                            </dd>
                          </div>
                          <div>
                            <dt>Lexical rank</dt>
                            <dd>{row.lexicalRank ?? "No match"}</dd>
                          </div>
                        </dl>
                        <small>
                          Query: {row.queryId} · {row.status}
                        </small>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p>
                  {receipt.toolCalls?.some(
                    (tool) =>
                      tool.name === "failure_history" &&
                      tool.status === "observed",
                  )
                    ? "The history tool returned no matching saved rows."
                    : "No successful history observation was returned."}
                </p>
              )}
            </section>
            <section className="judge-agent-tool">
              <h3>
                <Search size={18} />
                Search visibility
              </h3>
              {resultCount !== undefined ? (
                <>
                  <p className="judge-agent-search-count">
                    <strong>{resultCount}</strong> matching{" "}
                    {resultCount === 1 ? "result" : "results"}
                  </p>
                  <code>
                    {search?.query || "site:flowproof-demo.onrender.com"}
                  </code>
                  <p>
                    {provider
                      ? `Provider HTTP ${provider.status ?? "status unreported"} · ${provider.durationMs} ms`
                      : "Provider transport timing was not reported."}
                  </p>
                  {search?.results.map((row, index) => (
                    <p key={`${row.url}-${index}`}>
                      <a href={row.url} target="_blank" rel="noreferrer">
                        {row.title} <ArrowUpRight size={12} />
                      </a>
                    </p>
                  ))}
                  <p className="judge-agent-tool-note">
                    A successful empty search is a zero-result snapshot. It does
                    not prove de-indexing, ranking or client acceptance.
                  </p>
                </>
              ) : (
                <>
                  <TriangleAlert size={24} />
                  <p>
                    No successful search snapshot was returned. A timeout or
                    failed lookup is not zero results.
                  </p>
                </>
              )}
            </section>
          </div>
          <section className="judge-agent-citations">
            <h3>Facts cited by the model</h3>
            {findings.length ? (
              <ol>
                {findings.map((finding, index) => (
                  <li key={`${finding.observationId}-${index}`}>
                    <span>{findingText(finding)}</span>
                    <code>{finding.observationId}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                No validated findings were returned. No acceptance conclusion is
                inferred.
              </p>
            )}
          </section>
          <details className="judge-agent-model-details">
            <summary>Inspect actual model requests and token usage</summary>
            <div>
              {receipt.modelTurns?.map((turn, index) => (
                <section key={`${turn.phase}-${index}`}>
                  <h3>
                    {turn.phase === "select_tools"
                      ? "Select evidence tools"
                      : "Cite returned evidence"}
                  </h3>
                  {(turn.result?.attempts || turn.failedAttempts || []).map(
                    (attempt) => (
                      <p key={attempt.index}>
                        Attempt {attempt.index}: HTTP{" "}
                        {attempt.status ?? "unreported"}, {attempt.durationMs}{" "}
                        ms.{" "}
                        {attempt.usage
                          ? `${attempt.usage.promptTokens} input / ${attempt.usage.completionTokens} output / ${attempt.usage.totalTokens} total tokens.`
                          : "Provider token usage was not reported."}
                      </p>
                    ),
                  )}
                </section>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
