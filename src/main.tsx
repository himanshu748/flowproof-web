import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Beaker,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  Clock3,
  Code2,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Folder,
  Globe2,
  Image,
  Info,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import type {
  Audit,
  Bootstrap,
  Check as TestCheck,
  CheckKind,
  CheckResult,
  Project,
} from "../shared/types";
import "./styles.css";
import Landing from "./Landing";
import { AuditComparison } from "./AuditComparison";

type View =
  | "overview"
  | "projects"
  | "review"
  | "audit"
  | "reports"
  | "model"
  | "settings"
  | "history";
const kinds: { value: CheckKind; label: string }[] = [
  { value: "heading", label: "Heading exists" },
  { value: "text_visible", label: "Text is visible" },
  { value: "link", label: "Link exists" },
  { value: "image_alt", label: "Image alternative text" },
  { value: "no_horizontal_overflow", label: "No horizontal overflow" },
  { value: "manual", label: "Manual review" },
];
const titles: Record<View, string> = {
  overview: "Overview",
  projects: "Projects",
  review: "Review test plan",
  audit: "Audit monitor",
  reports: "Delivery reports",
  model: "Model lab",
  settings: "Connections",
  history: "Failure library",
};
const tokenKey = "flowproof.operator-token";
function headers() {
  const token = sessionStorage.getItem(tokenKey);
  return {
    "Content-Type": "application/json",
    ...(token ? { "X-FlowProof-Token": token } : {}),
  };
}
async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: headers(),
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `Request failed (${response.status}). Please try again.`,
    );
  }
  return response.json();
}
function date(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small-brand" : ""}`}>
      <span className="brand-icon">
        <FileCheck2 size={23} strokeWidth={2.2} />
      </span>
      {!small && (
        <>
          Briefstamp<span className="brand-dot">.</span>
        </>
      )}
    </span>
  );
}
function Status({ value }: { value: string }) {
  const Icon =
    value === "passed" || value === "completed" || value === "active"
      ? CheckCircle2
      : value === "failed" || value === "error"
        ? XCircle
        : value === "running"
          ? LoaderCircle
          : value === "blocked"
            ? TriangleAlert
            : CircleDashed;
  const label = value.replaceAll("_", " ");
  return (
    <span className={`status status-${value}`}>
      <Icon size={13} className={value === "running" ? "spin" : ""} />
      {label}
    </span>
  );
}
function Empty({
  icon: Icon = FileCheck2,
  title,
  children,
  action,
}: {
  icon?: typeof FileCheck2;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function EvidenceImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let objectUrl = "";
    let active = true;
    setUrl("");
    setError(false);
    fetch(path, { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error("Image unavailable");
        return r.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return error ? (
    <p className="image-error">
      Screenshot unavailable. See the observed evidence below.
    </p>
  ) : url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="screenshot-link"
      title="Open full screenshot"
    >
      <img src={url} alt={alt} />
    </a>
  ) : (
    <div className="screenshot-loading">
      <LoaderCircle className="spin" size={24} />
      Loading captured screenshot
    </div>
  );
}
function App({
  initialView = "overview",
  openModel = false,
  active = true,
}: {
  initialView?: View;
  openModel?: boolean;
  active?: boolean;
}) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>(initialView);
  useEffect(() => {
    if (openModel) setView("model");
  }, [openModel]);
  const [projectId, setProjectId] = useState("");
  const [auditId, setAuditId] = useState("");
  const [draft, setDraft] = useState<TestCheck[]>([]);
  const [dirty, setDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedCheck, setSelectedCheck] = useState("");
  const [introStep, setIntroStep] = useState(0);
  const [search, setSearch] = useState("");
  const [failures, setFailures] = useState<{
    results: {
      auditId: string;
      projectName: string;
      requirement: string;
      observed: string;
      status: string;
      createdAt: string;
    }[];
    mode: string;
  } | null>(null);
  const [operatorToken, setOperatorToken] = useState(
    sessionStorage.getItem(tokenKey) || "",
  );
  const reducedMotion = useReducedMotion();
  const demo = data?.demo;
  const project =
    data?.projects.find((p) => p.id === projectId) || data?.projects[0];
  const audit =
    data?.audits.find((a) => a.id === auditId) ||
    data?.audits.find((a) => a.projectId === project?.id) ||
    data?.audits[0];
  const allAudits = data?.audits || [];
  const completed = allAudits.filter((a) => a.status === "completed");
  const refresh = async () => {
    const next = await api<Bootstrap>("/bootstrap");
    setData(next);
    return next;
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (project) {
      setDraft(structuredClone(project.checks));
      setDirty(false);
    }
  }, [project?.id, project?.updatedAt]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const active =
      data?.audits.filter(
        (a) => a.status === "running" || a.status === "queued",
      ) || [];
    if (!active.length) return;
    const timer = setInterval(() => {
      Promise.all(active.map((a) => api<Audit>(`/audits/${a.id}`)))
        .then((updates) =>
          setData((current) =>
            current
              ? {
                  ...current,
                  audits: current.audits.map(
                    (a) => updates.find((u) => u.id === a.id) || a,
                  ),
                }
              : current,
          ),
        )
        .catch((e) => setError(e.message));
    }, 1200);
    return () => clearInterval(timer);
  }, [data?.audits]);
  const navigate = (next: View) => {
    setView(next);
    setMobileOpen(false);
    setFilter("all");
    setSelectedCheck("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const perform = async (label: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy("");
    }
  };
  const chooseProject = (p: Project, next: View = "review") => {
    setProjectId(p.id);
    setAuditId("");
    navigate(next);
  };
  const updateProject = (next: Project) => {
    setData((current) =>
      current
        ? {
            ...current,
            projects: current.projects.map((p) =>
              p.id === next.id ? next : p,
            ),
          }
        : current,
    );
    setDraft(structuredClone(next.checks));
    setDirty(false);
  };
  const savePlan = async () => {
    if (!project) return;
    const saved = await api<Project>(`/projects/${project.id}/checks`, "PUT", {
      checks: draft,
    });
    updateProject(saved);
    setNotice("Test plan saved. Your approvals are recorded.");
  };
  const runAudit = () =>
    perform("run", async () => {
      if (!project) return;
      if (dirty) await savePlan();
      const started = await api<Audit>(
        `/projects/${project.id}/audits`,
        "POST",
        {},
      );
      setData((current) =>
        current
          ? { ...current, audits: [started, ...current.audits] }
          : current,
      );
      setAuditId(started.id);
      navigate("audit");
    });
  const download = (path: string, filename: string) =>
    perform("download", async () => {
      const response = await fetch(`/api${path}`, { headers: headers() });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Download failed. Try again.");
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Your download is ready.");
    });
  const editCheck = (id: string, update: Partial<TestCheck>) => {
    setDraft((current) =>
      current.map((c) =>
        c.id === id
          ? {
              ...c,
              ...update,
              ...(Object.keys(update).some((key) => key !== "approved")
                ? { approved: false }
                : {}),
            }
          : c,
      ),
    );
    setDirty(true);
  };
  const totalChecks =
    data?.projects.reduce((sum, p) => sum + p.checks.length, 0) || 0;
  const activeAudit = audit?.status === "running" || audit?.status === "queued";
  const approved = draft.filter((c) => c.approved).length;
  const canRun =
    !!project &&
    draft.length > 0 &&
    draft.every((c) => c.approved || c.kind === "manual");
  const navItems: {
    view: View;
    label: string;
    icon: typeof LayoutDashboard;
  }[] = [
    { view: "overview", label: "Overview", icon: LayoutDashboard },
    { view: "projects", label: "Projects", icon: Folder },
    { view: "reports", label: "Delivery reports", icon: FileCheck2 },
    { view: "history", label: "Failure library", icon: BookOpen },
    { view: "model", label: "Model lab", icon: Beaker },
  ];
  const intro = [
    {
      title: "Start with what you promised.",
      text: "A client brief becomes a clear set of requirements. Give each promise a check you can review.",
      icon: FileText,
    },
    {
      title: "You approve. The browser checks.",
      text: "Review the plan, then let Playwright observe the website. Every check stays inside a safe, fixed test schema.",
      icon: ShieldCheck,
    },
    {
      title: "Hand over evidence, confidently.",
      text: "Turn real screenshots and observed results into a client-ready report, with every outcome tied to its requirement.",
      icon: FileCheck2,
    },
  ];
  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <a
          className="skip-link"
          href="#main"
          onClick={(event) => {
            event.preventDefault();
            const main = document.getElementById("main");
            main?.focus();
            main?.scrollIntoView({ behavior: "instant" });
          }}
        >
          Skip to content
        </a>
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              className="sidebar-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
          )}
        </AnimatePresence>
        <aside
          className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
          aria-label="Main navigation"
        >
          <div className="sidebar-brand">
            <a
              className="brand-home-link"
              href="#"
              aria-label="Briefstamp home"
            >
              <Logo />
            </a>
            <button
              className="icon-button mobile-only"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <button
            className="workspace-switch"
            onClick={() => navigate("settings")}
          >
            <span className="workspace-avatar">W</span>
            <span>
              My workspace
              <small>{demo?.enabled ? "Public demo" : "Local workspace"}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="nav-section-label">Workspace</div>
          <nav>
            {navItems.map((item) => (
              <button
                key={item.view}
                className={`nav-item ${view === item.view || (item.view === "projects" && ["review", "audit"].includes(view)) ? "active" : ""}`}
                onClick={() => navigate(item.view)}
              >
                <item.icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.view === "projects" && !!data?.projects.length && (
                  <span className="nav-count">{data.projects.length}</span>
                )}
                {item.view === "model" && (
                  <span className="beta-label">LAB</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="trust-card">
              <span className="trust-icon">
                <ShieldCheck size={19} />
              </span>
              <strong>Proof over promises.</strong>
              <p>Real checks. Traceable evidence. Honest handoffs.</p>
              <button
                className="text-button"
                onClick={() => {
                  setIntroStep(1);
                  navigate("overview");
                }}
              >
                How it works <ArrowUpRight size={14} />
              </button>
            </div>
            <button
              className={`nav-item ${view === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={18} />
              <span>Connections</span>
            </button>
            <div className="profile-row">
              <span className="profile-avatar">ME</span>
              <div>
                <strong>Your workspace</strong>
                <small>Built for independent makers</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-only"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={21} />
              </button>
              <span className="breadcrumb-workspace">Workspace</span>
              <ChevronRight size={14} />
              <strong>{titles[view]}</strong>
            </div>
            <div className="topbar-right">
              <span className="local-badge">
                <span />
                {demo?.enabled ? "Public demo" : "Local workspace"}
              </span>
              <button
                className="icon-button topbar-help"
                aria-label="Read how Briefstamp works"
                onClick={() => {
                  setIntroStep(0);
                  navigate("overview");
                }}
              >
                <Info size={18} />
              </button>
              <span className="topbar-avatar">ME</span>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                className="page"
                initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              >
                {demo?.enabled && (
                  <aside
                    className="demo-notice"
                    aria-label="Public demo information"
                  >
                    <Info size={18} />
                    <p>
                      <strong>Public demo.</strong>{" "}
                      {demo.notice ||
                        `Synthetic websites only. This temporary workspace resets after ${demo.expiresMinutes} minutes or when the free service restarts. Do not enter client information.`}
                    </p>
                  </aside>
                )}
                {error && (
                  <div className="alert error" role="alert">
                    <TriangleAlert size={18} />
                    <span>{error}</span>
                    <button
                      className="icon-button"
                      aria-label="Dismiss error"
                      onClick={() => setError("")}
                    >
                      <X size={17} />
                    </button>
                  </div>
                )}
                {!data && (
                  <>
                    {!error ? (
                      <div className="loading-state">
                        <LoaderCircle className="spin" size={26} />
                        <p>Opening your workspace…</p>
                      </div>
                    ) : (
                      <section className="panel connection-panel">
                        <h1>Connect your workspace</h1>
                        <p>
                          If this is a hosted workspace, enter its operator
                          token to continue.
                        </p>
                        <label>
                          Operator token
                          <input
                            type="password"
                            value={operatorToken}
                            onChange={(e) => setOperatorToken(e.target.value)}
                            autoComplete="off"
                          />
                        </label>
                        <button
                          className="button primary"
                          disabled={!!busy}
                          onClick={() =>
                            perform("connect", async () => {
                              sessionStorage.setItem(
                                tokenKey,
                                operatorToken.trim(),
                              );
                              await refresh();
                            })
                          }
                        >
                          Connect and retry
                        </button>
                      </section>
                    )}
                  </>
                )}
                {data && (view === "overview" || view === "projects") && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">
                          <span className="orange-dot" />
                          DELIVERY, VERIFIED
                        </div>
                        <h1>
                          {view === "overview"
                            ? "Your work. Verified."
                            : "Projects"}
                        </h1>
                        <p>
                          {view === "overview"
                            ? "Turn what you promised into proof you can hand over."
                            : "A clear path from client requirements to confident delivery."}
                        </p>
                      </div>
                      <button
                        className="button primary"
                        onClick={() => setCreateOpen(true)}
                      >
                        <Plus size={17} />
                        New project
                      </button>
                    </div>
                    {view === "overview" && (
                      <>
                        <section className="welcome-panel">
                          <div className="welcome-copy">
                            <span className="section-kicker">
                              <span className="tiny-square" />
                              FROM BRIEF TO PROOF
                            </span>
                            <AnimatePresence mode="wait">
                              <motion.div
                                key={introStep}
                                initial={{
                                  opacity: 0,
                                  y: reducedMotion ? 0 : 5,
                                }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                <h2>{intro[introStep].title}</h2>
                                <p>{intro[introStep].text}</p>
                              </motion.div>
                            </AnimatePresence>
                            <button
                              className="button dark"
                              onClick={() => project && chooseProject(project)}
                            >
                              {allAudits.length
                                ? "Open test plan"
                                : "Explore the sample project"}
                              <ArrowRight size={16} />
                            </button>
                            <div
                              className="intro-steps"
                              role="tablist"
                              aria-label="How Briefstamp works"
                            >
                              {["Define", "Verify", "Deliver"].map(
                                (name, i) => (
                                  <button
                                    key={name}
                                    role="tab"
                                    aria-selected={introStep === i}
                                    className={
                                      introStep === i ? "selected" : ""
                                    }
                                    onClick={() => setIntroStep(i)}
                                  >
                                    <span>0{i + 1}</span>
                                    {name}
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                          <div
                            className="proof-art"
                            aria-label="Every requirement connects to an approved check and observed evidence"
                          >
                            <div className="art-grid" />
                            <motion.div
                              className="proof-sheet"
                              animate={{
                                rotate: introStep === 2 ? 0 : -3,
                                y: introStep === 1 ? -4 : 0,
                              }}
                              transition={{ duration: 0.35 }}
                            >
                              <div className="proof-sheet-top">
                                <Logo small />
                                <span>DELIVERY REPORT</span>
                                <span className="sheet-dots">•••</span>
                              </div>
                              <div className="sheet-title">
                                Good work deserves
                                <br />
                                great evidence.
                              </div>
                              <div className="sheet-meta">
                                YOUR REQUIREMENTS. REAL RESULTS.
                              </div>
                              <div className="sheet-line">
                                <span
                                  className={
                                    introStep >= 0
                                      ? "sheet-check highlighted"
                                      : "sheet-check"
                                  }
                                >
                                  <FileText size={14} />
                                </span>
                                <div>
                                  <strong>Client requirements</strong>
                                  <small>The promises you made</small>
                                </div>
                                <span className="line-index">01</span>
                              </div>
                              <div className="sheet-connector" />
                              <div className="sheet-line">
                                <span
                                  className={
                                    introStep >= 1
                                      ? "sheet-check highlighted"
                                      : "sheet-check"
                                  }
                                >
                                  <ShieldCheck size={14} />
                                </span>
                                <div>
                                  <strong>Approved browser checks</strong>
                                  <small>
                                    Reviewed by you, run by Playwright
                                  </small>
                                </div>
                                <span className="line-index">02</span>
                              </div>
                              <div className="sheet-connector" />
                              <div className="sheet-line">
                                <span
                                  className={
                                    introStep >= 2
                                      ? "sheet-check highlighted"
                                      : "sheet-check"
                                  }
                                >
                                  <Image size={14} />
                                </span>
                                <div>
                                  <strong>Observed evidence</strong>
                                  <small>Screenshots with every result</small>
                                </div>
                                <span className="line-index">03</span>
                              </div>
                              <div className="sheet-bottom">
                                <span className="small-square" />A CLEARER WAY
                                TO HAND OVER
                              </div>
                            </motion.div>
                            <div className="proof-stamp">
                              <ShieldCheck size={18} />
                              <span>
                                Evidence you
                                <br />
                                <strong>can stand behind.</strong>
                              </span>
                            </div>
                          </div>
                        </section>
                        <section
                          className="stats-grid"
                          aria-label="Workspace totals"
                        >
                          <div className="stat-card">
                            <div>
                              <span>Projects in your workspace</span>
                              <strong>
                                {data.projects.length
                                  .toString()
                                  .padStart(2, "0")}
                              </strong>
                            </div>
                            <span className="stat-icon">
                              <Folder size={20} />
                            </span>
                            <small>
                              {
                                data.projects.filter(
                                  (p) => p.target === "sample",
                                ).length
                              }{" "}
                              synthetic sample
                              {data.projects.filter(
                                (p) => p.target === "sample",
                              ).length === 1
                                ? ""
                                : "s"}{" "}
                              included
                            </small>
                          </div>
                          <div className="stat-card">
                            <div>
                              <span>Requirements mapped</span>
                              <strong>
                                {totalChecks.toString().padStart(2, "0")}
                              </strong>
                            </div>
                            <span className="stat-icon">
                              <ListChecksIcon />
                            </span>
                            <small>
                              Every check starts with a client promise
                            </small>
                          </div>
                          <div className="stat-card">
                            <div>
                              <span>Completed audits</span>
                              <strong>
                                {completed.length.toString().padStart(2, "0")}
                              </strong>
                            </div>
                            <span className="stat-icon">
                              <FileCheck2 size={20} />
                            </span>
                            <small>
                              {completed.length
                                ? "Backed by captured browser evidence"
                                : "Your first proof is one audit away"}
                            </small>
                          </div>
                        </section>
                      </>
                    )}
                    <div
                      className={`workspace-grid ${view === "projects" ? "full-width" : ""}`}
                    >
                      <section className="panel projects-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>
                              Your projects{" "}
                              <span className="count-badge">
                                {data.projects.length}
                              </span>
                            </h2>
                            <p>Pick up where your next handoff starts.</p>
                          </div>
                          {view === "overview" && (
                            <button
                              className="text-button muted"
                              onClick={() => navigate("projects")}
                            >
                              View all <ArrowRight size={14} />
                            </button>
                          )}
                        </div>
                        <div className="project-table-head">
                          <span>PROJECT</span>
                          <span>TEST PLAN</span>
                          <span>LAST AUDIT</span>
                        </div>
                        {data.projects.map((p) => {
                          const last = allAudits.find(
                            (a) => a.projectId === p.id,
                          );
                          return (
                            <button
                              className="project-row"
                              key={p.id}
                              onClick={() => chooseProject(p)}
                            >
                              <span
                                className={`project-tile ${p.target === "sample" ? "sample-tile" : ""}`}
                              >
                                {p.target === "sample" ? (
                                  <LayersIcon />
                                ) : (
                                  <Globe2 size={22} />
                                )}
                              </span>
                              <span className="project-name">
                                <strong>{p.name}</strong>
                                <small>
                                  {p.target === "sample"
                                    ? "Synthetic website"
                                    : p.url}
                                  <span className="project-dot">·</span>
                                  {p.target === "sample" ? (
                                    <span className="sample-tag">SAMPLE</span>
                                  ) : (
                                    date(p.createdAt)
                                  )}
                                </small>
                              </span>
                              <span className="project-plan">
                                <strong>{p.checks.length} checks</strong>
                                <small>
                                  {p.checks.filter((c) => c.approved).length}{" "}
                                  approved
                                </small>
                              </span>
                              <span className="project-audit">
                                {last ? (
                                  <Status value={last.status} />
                                ) : (
                                  <span className="not-run">
                                    <CircleDashed size={13} />
                                    Not run yet
                                  </span>
                                )}
                              </span>
                              <ChevronRight size={17} className="row-arrow" />
                            </button>
                          );
                        })}
                        <button
                          className="add-project-row"
                          onClick={() => setCreateOpen(true)}
                        >
                          <Plus size={16} />
                          Start a new project
                        </button>
                      </section>
                      {view === "overview" && (
                        <aside className="next-panel">
                          <div className="next-title">
                            <span className="next-icon">
                              <ArrowUpRight size={18} />
                            </span>
                            <span>YOUR NEXT STEP</span>
                          </div>
                          <h3>
                            {completed.length
                              ? "A handoff worth sharing."
                              : "Make your first proof."}
                          </h3>
                          <p>
                            {completed.length
                              ? "Open a completed audit to inspect its evidence and export a delivery report."
                              : "Our sample website is ready. Review its checks, run an audit, and see what a real delivery report looks like."}
                          </p>
                          <div className="next-checklist">
                            <span>
                              <CheckCircle2 size={16} />
                              Sample project created
                            </span>
                            <span className={approved ? "" : "pending"}>
                              {approved ? (
                                <CheckCircle2 size={16} />
                              ) : (
                                <Circle size={16} />
                              )}
                              Review and approve checks
                            </span>
                            <span className={completed.length ? "" : "pending"}>
                              {completed.length ? (
                                <CheckCircle2 size={16} />
                              ) : (
                                <Circle size={16} />
                              )}
                              Run your first audit
                            </span>
                          </div>
                          <button
                            className="text-button"
                            onClick={() =>
                              completed.length
                                ? navigate("reports")
                                : project && chooseProject(project)
                            }
                          >
                            {completed.length
                              ? "See delivery reports"
                              : "Review sample checks"}
                            <ArrowRight size={15} />
                          </button>
                        </aside>
                      )}
                    </div>
                    <div className="workspace-footer">
                      <span>
                        <ShieldCheck size={14} />
                        Human approved. Browser verified.
                      </span>
                      <span>No result is a pass until it is observed.</span>
                    </div>
                  </>
                )}
                {data && view === "review" && project && (
                  <>
                    <div className="page-heading">
                      <div>
                        <button
                          className="back-button"
                          onClick={() => navigate("projects")}
                        >
                          <ArrowLeft size={14} />
                          Projects
                        </button>
                        <h1>{project.name}</h1>
                        <p>Make sure these checks match what you promised.</p>
                      </div>
                      <div className="button-group">
                        <button
                          className="button secondary"
                          disabled={!!busy || !dirty}
                          onClick={() => perform("save", savePlan)}
                        >
                          {busy === "save" ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            <Check size={16} />
                          )}
                          Save plan
                        </button>
                        <button
                          className="button primary"
                          disabled={!!busy || !canRun}
                          onClick={runAudit}
                        >
                          <Play size={15} />
                          Run audit
                        </button>
                      </div>
                    </div>
                    <div className="flow-strip">
                      <span className="done">
                        <Check size={14} />
                        Brief captured
                      </span>
                      <ChevronRight size={14} />
                      <span className="current">
                        <span className="step-circle">2</span>Review & approve
                      </span>
                      <ChevronRight size={14} />
                      <span>
                        <span className="step-circle">3</span>Run audit
                      </span>
                      <ChevronRight size={14} />
                      <span>
                        <span className="step-circle">4</span>Share proof
                      </span>
                    </div>
                    <div className="review-grid">
                      <div>
                        <section className="panel brief-panel">
                          <div className="panel-heading">
                            <h2>
                              <FileText size={18} />
                              Client brief
                            </h2>
                            <span className="tag">SOURCE OF TRUTH</span>
                          </div>
                          <p className="brief-text">{project.brief}</p>
                          <details className="brief-editor">
                            <summary>
                              Edit brief and regenerate checks{" "}
                              <ChevronDown size={14} />
                            </summary>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const form = new FormData(e.currentTarget);
                                perform("generate", async () => {
                                  updateProject(
                                    await api<Project>(
                                      `/projects/${project.id}/generate`,
                                      "POST",
                                      { brief: form.get("brief") },
                                    ),
                                  );
                                  setNotice(
                                    "New checks generated. Please review and approve them.",
                                  );
                                });
                              }}
                            >
                              <label>
                                Updated requirements
                                <textarea
                                  name="brief"
                                  defaultValue={project.brief}
                                  rows={5}
                                  required
                                />
                              </label>
                              <p className="field-help">
                                Regenerating replaces the current plan and
                                resets all approvals.
                              </p>
                              <button
                                className="button secondary"
                                disabled={!!busy}
                              >
                                <Sparkles size={15} />
                                {busy === "generate"
                                  ? "Generating…"
                                  : "Generate new plan"}
                              </button>
                            </form>
                          </details>
                        </section>
                        <section className="checks-section">
                          <div className="checks-header">
                            <h2>
                              Acceptance checks{" "}
                              <span className="count-badge">
                                {draft.length}
                              </span>
                            </h2>
                            <button
                              className="text-button"
                              disabled={approved === draft.length}
                              onClick={() => {
                                setDraft((current) =>
                                  current.map((c) => ({
                                    ...c,
                                    approved: true,
                                  })),
                                );
                                setDirty(true);
                              }}
                            >
                              <CheckCheck size={16} />
                              Approve all checks
                            </button>
                          </div>
                          <p className="checks-intro">
                            Review the expected result before approving. Editing
                            a check resets its approval.
                          </p>
                          {draft.map((c, index) => (
                            <article
                              className={`check-card ${c.approved ? "approved" : ""}`}
                              key={c.id}
                            >
                              <div className="check-card-top">
                                <label className="approval-control">
                                  <input
                                    type="checkbox"
                                    checked={c.approved}
                                    onChange={(e) =>
                                      editCheck(c.id, {
                                        approved: e.target.checked,
                                      })
                                    }
                                    aria-label={`Approve check ${index + 1}: ${c.requirement}`}
                                  />
                                  <span>
                                    {c.approved && <Check size={13} />}
                                  </span>
                                </label>
                                <div className="check-main">
                                  <div className="check-meta">
                                    <span className="mono">
                                      REQ-{String(index + 1).padStart(2, "0")}
                                    </span>
                                    <span className="check-kind">
                                      {
                                        kinds.find((k) => k.value === c.kind)
                                          ?.label
                                      }
                                    </span>
                                    <span className="viewport-label">
                                      {c.viewport}
                                    </span>
                                  </div>
                                  <h3>{c.requirement}</h3>
                                  <p>
                                    <span>Expected</span>
                                    {c.expected ||
                                      (c.kind === "no_horizontal_overflow"
                                        ? "Page fits the viewport"
                                        : "Requires a human review")}
                                  </p>
                                </div>
                                <span
                                  className={`approval-label ${c.approved ? "is-approved" : ""}`}
                                >
                                  {c.approved ? "Approved" : "To review"}
                                </span>
                              </div>
                              <details className="check-editor">
                                <summary>
                                  <SlidersHorizontal size={14} />
                                  Edit check
                                  <ChevronDown size={14} />
                                </summary>
                                <div className="check-fields">
                                  <label className="wide">
                                    Approved requirement wording
                                    <textarea
                                      value={c.requirement}
                                      onChange={(e) =>
                                        editCheck(c.id, {
                                          requirement: e.target.value,
                                        })
                                      }
                                      rows={2}
                                    />
                                  </label>
                                  <label>
                                    Check type
                                    <select
                                      value={c.kind}
                                      onChange={(e) =>
                                        editCheck(c.id, {
                                          kind: e.target.value as CheckKind,
                                        })
                                      }
                                    >
                                      {kinds.map((k) => (
                                        <option key={k.value} value={k.value}>
                                          {k.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    Viewport
                                    <select
                                      value={c.viewport}
                                      onChange={(e) =>
                                        editCheck(c.id, {
                                          viewport: e.target.value as
                                            | "desktop"
                                            | "mobile",
                                        })
                                      }
                                    >
                                      <option value="desktop">
                                        Desktop (1365 px)
                                      </option>
                                      <option value="mobile">
                                        Mobile (390 px)
                                      </option>
                                    </select>
                                  </label>
                                  <label>
                                    Page path
                                    <input
                                      value={c.path}
                                      onChange={(e) =>
                                        editCheck(c.id, {
                                          path: e.target.value,
                                        })
                                      }
                                      placeholder="/"
                                    />
                                  </label>
                                  <label>
                                    CSS selector (optional)
                                    <input
                                      value={c.selector || ""}
                                      onChange={(e) =>
                                        editCheck(c.id, {
                                          selector: e.target.value || undefined,
                                        })
                                      }
                                      placeholder="e.g. main h1"
                                    />
                                  </label>
                                  <label className="wide">
                                    Expected result
                                    <input
                                      value={c.expected}
                                      onChange={(e) =>
                                        editCheck(c.id, {
                                          expected: e.target.value,
                                        })
                                      }
                                      placeholder="Exact text, URL, or expected value"
                                    />
                                  </label>
                                </div>
                              </details>
                            </article>
                          ))}
                        </section>
                      </div>
                      <aside className="review-aside">
                        <section className="panel ready-panel">
                          <span className="section-kicker">PLAN READINESS</span>
                          <div className="readiness-value">
                            {approved}
                            <span> / {draft.length}</span>
                          </div>
                          <p>checks approved by you</p>
                          <div className="progress-track">
                            <span
                              style={{
                                transform: `scaleX(${draft.length ? approved / draft.length : 0})`,
                              }}
                            />
                          </div>
                          <div className="readiness-note">
                            <ShieldCheck size={17} />
                            <span>
                              {canRun
                                ? "Your plan is ready for a real browser audit."
                                : "Approve every executable check to unlock the audit."}
                            </span>
                          </div>
                          <button
                            className="button primary full"
                            disabled={!!busy || !canRun}
                            onClick={runAudit}
                          >
                            {busy === "run" ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <Play size={15} />
                            )}
                            Save & run audit
                          </button>
                          {dirty && (
                            <p className="unsaved">You have unsaved changes.</p>
                          )}
                        </section>
                        <section className="panel target-panel">
                          <h3>Audit target</h3>
                          <div className="target-url">
                            <Globe2 size={16} />
                            <span>
                              {project.target === "sample"
                                ? "Synthetic sample website"
                                : project.url}
                            </span>
                          </div>
                          {project.target === "sample" && (
                            <>
                              <label>
                                Sample condition
                                <select
                                  value={project.sampleVariant}
                                  disabled={!!busy}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    perform("variant", async () => {
                                      updateProject(
                                        await api<Project>(
                                          `/projects/${project.id}/variant`,
                                          "POST",
                                          { sampleVariant: value },
                                        ),
                                      );
                                      setNotice(
                                        "Sample updated. Review and approve the checks again.",
                                      );
                                    });
                                  }}
                                >
                                  <option value="healthy">
                                    Healthy website
                                  </option>
                                  <option value="broken">
                                    Intentionally broken website
                                  </option>
                                </select>
                              </label>
                              <p className="field-help">
                                Switch to the broken sample to see the same
                                requirements fail. Switching resets approvals.
                              </p>
                            </>
                          )}
                          <div className="safe-note">
                            <ShieldCheck size={14} />
                            Read-only browser checks
                          </div>
                        </section>
                        <section className="generator-note">
                          <Code2 size={17} />
                          <div>
                            <strong>
                              {project.generator.model ||
                                "Deterministic test templates"}
                            </strong>
                            <p>
                              {project.generator.reason ||
                                `Generated with ${project.generator.provider}.`}
                            </p>
                          </div>
                        </section>
                        <button
                          className="button secondary full"
                          onClick={() =>
                            download(
                              `/projects/${project.id}/plan`,
                              "briefstamp-plan.json",
                            )
                          }
                          disabled={!!busy}
                        >
                          <Download size={15} />
                          Export for GitHub Actions
                        </button>
                      </aside>
                    </div>
                  </>
                )}
                {data && (view === "audit" || view === "reports") && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">
                          <span className="orange-dot" />
                          {view === "audit"
                            ? "LIVE BROWSER EVIDENCE"
                            : "READY FOR HANDOFF"}
                        </div>
                        <h1>
                          {view === "audit"
                            ? "Every check tells a story."
                            : "Delivery reports"}
                        </h1>
                        <p>
                          {view === "audit"
                            ? "Follow each requirement from approved assertion to observed result."
                            : "A clear record of what works, what needs attention, and what comes next."}
                        </p>
                      </div>
                      {audit?.status === "completed" && (
                        <button
                          className="button primary"
                          disabled={!!busy}
                          onClick={() =>
                            download(
                              `/audits/${audit.id}/report`,
                              `briefstamp-${audit.projectName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.html`,
                            )
                          }
                        >
                          <ArrowDownToLine size={16} />
                          Export delivery report
                        </button>
                      )}
                    </div>
                    {!allAudits.length ? (
                      <section className="panel">
                        <Empty
                          title="Your first report starts with a real audit."
                          action={
                            <button
                              className="button primary"
                              onClick={() => project && chooseProject(project)}
                            >
                              Review sample checks
                              <ArrowRight size={16} />
                            </button>
                          }
                        >
                          Review the sample project, approve its checks, and run
                          the browser. Your evidence will appear here.
                        </Empty>
                      </section>
                    ) : (
                      <>
                        <div className="audit-picker-row">
                          <label>
                            Audit
                            <select
                              value={audit?.id || ""}
                              onChange={(e) => {
                                setAuditId(e.target.value);
                                setSelectedCheck("");
                              }}
                            >
                              {allAudits.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.projectName} · {date(a.createdAt)} ·{" "}
                                  {a.status} · {a.id.slice(-6)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {audit && <Status value={audit.status} />}
                        </div>
                        {audit && (
                          <>
                            <section className="audit-summary">
                              <div className="audit-title">
                                <span className="audit-symbol">
                                  <FileCheck2 size={23} />
                                </span>
                                <div>
                                  <h2>{audit.projectName}</h2>
                                  <p>
                                    {date(audit.createdAt)}
                                    <span>·</span>
                                    {audit.checks.length} planned checks
                                    <span>·</span>
                                    <span className="mono">
                                      {audit.id.slice(-8)}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <div className="audit-totals">
                                {(
                                  [
                                    "passed",
                                    "failed",
                                    "blocked",
                                    "unverified",
                                  ] as const
                                ).map((status) => (
                                  <button
                                    key={status}
                                    className={`audit-total ${status} ${filter === status ? "selected" : ""}`}
                                    onClick={() =>
                                      setFilter(
                                        filter === status ? "all" : status,
                                      )
                                    }
                                  >
                                    <strong>
                                      {
                                        audit.results.filter(
                                          (r) => r.status === status,
                                        ).length
                                      }
                                    </strong>
                                    <span>{status}</span>
                                  </button>
                                ))}
                              </div>
                            </section>
                            {activeAudit && (
                              <div className="live-progress" role="status">
                                <LoaderCircle className="spin" size={18} />
                                <div>
                                  <strong>Browser audit in progress</strong>
                                  <span>
                                    {audit.results.length} of{" "}
                                    {audit.checks.length} checks reported.
                                    Results update automatically.
                                  </span>
                                </div>
                                <div className="progress-track">
                                  <span
                                    style={{
                                      transform: `scaleX(${audit.results.length / Math.max(audit.checks.length, 1)})`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            {audit.error && (
                              <div className="alert error">
                                <TriangleAlert size={18} />
                                <span>{audit.error}</span>
                              </div>
                            )}
                            {audit.summary && (
                              <div className="audit-written-summary">
                                <Info size={17} />
                                <p>{audit.summary}</p>
                              </div>
                            )}
                            <AuditComparison audit={audit} audits={allAudits} />
                            <div className="result-toolbar">
                              <div
                                className="filter-tabs"
                                aria-label="Filter results"
                              >
                                {[
                                  "all",
                                  "passed",
                                  "failed",
                                  "blocked",
                                  "unverified",
                                ].map((f) => (
                                  <button
                                    key={f}
                                    className={filter === f ? "selected" : ""}
                                    onClick={() => {
                                      setFilter(f);
                                      setSelectedCheck("");
                                    }}
                                  >
                                    {f === "all" ? "All checks" : f}
                                  </button>
                                ))}
                              </div>
                              <span>
                                {audit.results.length} recorded results
                              </span>
                            </div>
                            <div className="evidence-grid">
                              <div className="result-list">
                                {audit.checks
                                  .filter((c) => {
                                    const result = audit.results.find(
                                      (r) => r.checkId === c.id,
                                    );
                                    return (
                                      filter === "all" ||
                                      result?.status === filter
                                    );
                                  })
                                  .map((c, index) => {
                                    const result = audit.results.find(
                                      (r) => r.checkId === c.id,
                                    );
                                    const shown =
                                      selectedCheck ||
                                      audit.results.find(
                                        (r) =>
                                          filter === "all" ||
                                          r.status === filter,
                                      )?.checkId ||
                                      audit.checks[0]?.id;
                                    return (
                                      <button
                                        key={c.id}
                                        className={`result-item ${shown === c.id ? "selected" : ""}`}
                                        onClick={() => setSelectedCheck(c.id)}
                                      >
                                        <span
                                          className={`result-icon ${result?.status || "pending"}`}
                                        >
                                          {result?.status === "passed" ? (
                                            <CheckCircle2 size={18} />
                                          ) : result?.status === "failed" ? (
                                            <XCircle size={18} />
                                          ) : result?.status === "blocked" ? (
                                            <TriangleAlert size={18} />
                                          ) : (
                                            <CircleDashed size={18} />
                                          )}
                                        </span>
                                        <span>
                                          <span className="result-item-meta">
                                            REQ-
                                            {String(
                                              audit.checks.findIndex(
                                                (check) => check.id === c.id,
                                              ) + 1,
                                            ).padStart(2, "0")}
                                            <span>{c.viewport}</span>
                                          </span>
                                          <strong>{c.requirement}</strong>
                                          <small>
                                            {result
                                              ? result.status
                                              : activeAudit
                                                ? "Waiting for browser"
                                                : "Not executed"}
                                          </small>
                                        </span>
                                        <ChevronRight size={15} />
                                      </button>
                                    );
                                  })}
                                {!audit.checks.some(
                                  (c) =>
                                    filter === "all" ||
                                    audit.results.find(
                                      (r) => r.checkId === c.id,
                                    )?.status === filter,
                                ) && (
                                  <div className="compact-empty">
                                    No {filter} checks in this audit.
                                  </div>
                                )}
                              </div>
                              <EvidencePanel
                                result={audit.results.find(
                                  (r) =>
                                    r.checkId ===
                                    (selectedCheck ||
                                      audit.results.find(
                                        (r) =>
                                          filter === "all" ||
                                          r.status === filter,
                                      )?.checkId),
                                )}
                                pending={activeAudit}
                              />
                            </div>
                            <div className="report-note">
                              <ShieldCheck size={16} />
                              <p>
                                Only observed outcomes are counted. Unavailable,
                                blocked, and manual checks are never marked as
                                passed.
                              </p>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                {data && view === "model" && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">
                          <span className="orange-dot" />
                          MEASURE BEFORE YOU CLAIM
                        </div>
                        <h1>Model lab</h1>
                        <p>
                          Honest comparisons. Reproducible experiments. No
                          invented improvements.
                        </p>
                      </div>
                      <span className="tag">EXPERIMENT WORKSPACE</span>
                    </div>
                    <section className="model-banner">
                      <div className="model-graphic">
                        <Beaker size={36} />
                      </div>
                      <div>
                        <h2>
                          {data.evaluation.dataset.benchmarkMode ===
                          "agent-reviewed-pilot"
                            ? "Agent-reviewed synthetic pilot"
                            : "The evidence comes first."}
                        </h2>
                        <p>
                          Compare zero-shot, few-shot, and fine-tuned models on
                          the same held-out requirements. Metrics appear only
                          after a real evaluation is recorded. Agent-reviewed
                          labels are not human validation.
                        </p>
                      </div>
                      <Status
                        value={
                          data.evaluation.configurations.some(
                            (c) => c.structuredOutputRate !== null,
                          )
                            ? "active"
                            : "not_evaluated"
                        }
                      />
                    </section>
                    <div className="stats-grid model-stats">
                      <div className="stat-card">
                        <div>
                          <span>Candidate examples</span>
                          <strong>{data.evaluation.dataset.candidates}</strong>
                        </div>
                        <small>Actual examples in the evaluation dataset</small>
                      </div>
                      <div className="stat-card">
                        <div>
                          <span>Human-validated examples</span>
                          <strong>{data.evaluation.dataset.validated}</strong>
                        </div>
                        <small>
                          Reviewed by a person, separately from agent review
                        </small>
                      </div>
                      <div className="stat-card">
                        <div>
                          <span>Agent-reviewed pilot</span>
                          <strong>
                            {data.evaluation.dataset.agentReviewed ?? 0}
                          </strong>
                        </div>
                        <small>
                          Synthetic examples; real-client accuracy unverified
                        </small>
                      </div>
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Evaluation results</h2>
                          <p>{data.evaluation.dataset.splitPolicy}</p>
                        </div>
                      </div>
                      <div
                        className="table-scroll"
                        role="region"
                        aria-label="Model experiment comparison"
                        tabIndex={0}
                      >
                        <table className="model-table">
                          <thead>
                            <tr>
                              <th>CONFIGURATION</th>
                              <th>VALID OUTPUT</th>
                              <th>REFERENCE AGREEMENT</th>
                              <th>BROWSER CORRECT</th>
                              <th>FALSE PASS</th>
                              <th>ABSTENTION</th>
                              <th>LATENCY</th>
                              <th>TOKENS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.evaluation.configurations.map((c) => (
                              <tr key={c.name}>
                                <td>
                                  <strong>{c.name}</strong>
                                  <span className="model-status">
                                    {c.status.replaceAll("_", " ")}
                                  </span>
                                </td>
                                <td>{metric(c.structuredOutputRate)}</td>
                                <td>{metric(c.interpretationAccuracy)}</td>
                                <td>{metric(c.executableCorrectness)}</td>
                                <td>
                                  {metric(c.falsePassRate)}
                                  {c.browserCounts && (
                                    <span className="model-status">
                                      {c.browserCounts.brokenFalsePasses} /{" "}
                                      {c.browserCounts.brokenExecuted} broken
                                      checks
                                    </span>
                                  )}
                                </td>
                                <td>{metric(c.abstentionRate)}</td>
                                <td>
                                  {c.latencyMs === null ? (
                                    <span className="not-evaluated">
                                      Not evaluated
                                    </span>
                                  ) : (
                                    `${Math.round(c.latencyMs).toLocaleString()} ms`
                                  )}
                                </td>
                                <td>
                                  {c.tokens === null ? (
                                    <span className="not-evaluated">
                                      Not evaluated
                                    </span>
                                  ) : (
                                    c.tokens.toLocaleString()
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <div className="model-method">
                      <h2>What a better model has to prove</h2>
                      <div className="method-grid">
                        {[
                          {
                            icon: Code2,
                            title: "A plan the runner can execute",
                            text: "Valid structured output and correct interpretation, measured separately from browser execution.",
                          },
                          {
                            icon: ShieldCheck,
                            title: "The right result on broken sites",
                            text: "Measure false passes against intentionally broken requirements. A plausible plan is not enough.",
                          },
                          {
                            icon: CircleDashed,
                            title: "Knowing when to abstain",
                            text: "Untestable requirements stay visible as manual review, instead of becoming invented successes.",
                          },
                        ].map((item) => (
                          <div key={item.title}>
                            <item.icon size={20} />
                            <h3>{item.title}</h3>
                            <p>{item.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    {data.evaluation.notes.length > 0 && (
                      <section className="evaluation-notes">
                        <Info size={18} />
                        <div>
                          {data.evaluation.notes.map((note) => (
                            <p key={note}>{note}</p>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}
                {data && view === "history" && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">
                          <span className="orange-dot" />
                          LESSONS FROM REAL RUNS
                        </div>
                        <h1>Failure library</h1>
                        <p>
                          Find past failures and the browser observations behind
                          them.
                        </p>
                      </div>
                    </div>
                    <section className="panel search-panel">
                      <form
                        className="failure-search"
                        onSubmit={(e) => {
                          e.preventDefault();
                          perform("search", async () =>
                            setFailures(
                              await api(
                                `/failures?q=${encodeURIComponent(search)}`,
                              ),
                            ),
                          );
                        }}
                      >
                        <Search size={19} />
                        <input
                          aria-label="Search historical failures"
                          placeholder="Search a requirement, page, or observed failure…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <button className="button primary" disabled={!!busy}>
                          {busy === "search" ? "Searching…" : "Search failures"}
                        </button>
                      </form>
                    </section>
                    {failures && (
                      <div className="search-summary">
                        {failures.results.length} matching results
                        <span>Retrieval: {failures.mode}</span>
                      </div>
                    )}
                    {!failures || !failures.results.length ? (
                      <section className="panel">
                        <Empty
                          icon={BookOpen}
                          title={
                            failures
                              ? "No matching failures."
                              : "Make past failures useful."
                          }
                        >
                          {failures
                            ? "Try a different phrase, or run the intentionally broken sample to capture searchable observations."
                            : "Search your saved audits by requirement or observation. Run the broken sample to create your first failure evidence."}
                        </Empty>
                      </section>
                    ) : (
                      <div className="failure-results">
                        {failures.results.map((result, i) => (
                          <article
                            className="panel failure-card"
                            key={`${result.auditId}-${i}`}
                          >
                            <div>
                              <Status value={result.status} />
                              <span>
                                {result.projectName} · {date(result.createdAt)}
                              </span>
                            </div>
                            <h3>{result.requirement}</h3>
                            <p>{result.observed}</p>
                            <button
                              className="text-button"
                              onClick={() => {
                                setAuditId(result.auditId);
                                navigate("reports");
                              }}
                            >
                              Inspect evidence <ArrowRight size={15} />
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {data && view === "settings" && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">
                          <span className="orange-dot" />
                          CONNECTED WITH PURPOSE
                        </div>
                        <h1>Connections</h1>
                        <p>
                          Real integration status, straight from your running
                          workspace.
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        disabled={!!busy}
                        onClick={() =>
                          perform("refresh", async () => {
                            await refresh();
                            setNotice("Connection status refreshed.");
                          })
                        }
                      >
                        <Activity size={16} />
                        Refresh status
                      </button>
                    </div>
                    <section className="storage-banner">
                      <span className="storage-icon">
                        <Terminal size={21} />
                      </span>
                      <div>
                        <h3>
                          {demo?.enabled
                            ? "Temporary demo storage"
                            : "Workspace persistence"}
                        </h3>
                        <p>
                          {demo?.enabled
                            ? `Your sample projects and reports expire after ${demo.expiresMinutes} minutes or when the free service restarts. Download a report to keep it.`
                            : data.storage}
                        </p>
                      </div>
                      <span className="tag">CURRENT RUNTIME</span>
                    </section>
                    <div className="integrations-grid">
                      {data.integrations.map((integration, i) => (
                        <article
                          className="panel integration-card"
                          key={integration.name}
                        >
                          <div className="integration-top">
                            <span
                              className={`integration-logo integration-${i % 4}`}
                            >
                              {integration.name.slice(0, 1)}
                            </span>
                            <Status value={integration.status} />
                          </div>
                          <h2>{integration.name}</h2>
                          <p>{integration.detail}</p>
                        </article>
                      ))}
                    </div>
                    {!demo?.enabled && (
                      <section className="panel token-panel">
                        <div>
                          <h2>Hosted workspace access</h2>
                          <p>
                            An operator token is required by hosted private
                            workspaces. It is kept only in this browser session
                            and sent with API requests.
                          </p>
                        </div>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            perform("token", async () => {
                              const previous = sessionStorage.getItem(tokenKey);
                              sessionStorage.setItem(
                                tokenKey,
                                operatorToken.trim(),
                              );
                              try {
                                await refresh();
                                setNotice(
                                  "Workspace access saved for this session.",
                                );
                              } catch (err) {
                                if (previous)
                                  sessionStorage.setItem(tokenKey, previous);
                                else sessionStorage.removeItem(tokenKey);
                                throw err;
                              }
                            });
                          }}
                        >
                          <label>
                            Operator token
                            <input
                              type="password"
                              value={operatorToken}
                              onChange={(e) => setOperatorToken(e.target.value)}
                              placeholder="Not needed for local development"
                              autoComplete="off"
                            />
                          </label>
                          <button
                            className="button secondary"
                            disabled={!!busy}
                          >
                            Save & verify
                          </button>
                        </form>
                      </section>
                    )}
                    <div className="report-note">
                      <Info size={16} />
                      <p>
                        Available and unconfigured integrations are not claimed
                        as functioning sponsor integrations.
                      </p>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <AnimatePresence>
          {notice && (
            <motion.div
              className="toast"
              role="status"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
            >
              <CheckCircle2 size={18} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {createOpen && (
          <CreateProject
            active={active}
            demo={!!demo?.enabled}
            onClose={() => setCreateOpen(false)}
            onCreate={async (values) => {
              const created = await api<Project>("/projects", "POST", values);
              setData((current) =>
                current
                  ? { ...current, projects: [created, ...current.projects] }
                  : current,
              );
              setCreateOpen(false);
              chooseProject(created);
              setNotice("Project created. Review your generated checks.");
            }}
          />
        )}
      </div>
    </MotionConfig>
  );
}
function metric(value: number | null) {
  return value === null ? (
    <span className="not-evaluated">Not evaluated</span>
  ) : (
    `${(value * 100).toFixed(1)}%`
  );
}
function ListChecksIcon() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 5 1.5 1.5L7 4M11 5h10M3 12l1.5 1.5L7 11M11 12h10M3 19l1.5 1.5L7 18M11 19h10" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="m14 4 10 6-10 6L4 10l10-6Z" />
      <path d="m4 14 10 6 10-6M4 18l10 6 10-6" />
    </svg>
  );
}
function EvidencePanel({
  result,
  pending,
}: {
  result?: CheckResult;
  pending?: boolean;
}) {
  if (!result)
    return (
      <section className="panel evidence-panel">
        <Empty
          icon={pending ? Activity : Image}
          title={
            pending ? "Waiting for the browser." : "Select an observed result."
          }
        >
          {pending
            ? "The screenshot and DOM evidence will appear as soon as this check finishes."
            : "Choose a check to inspect the real screenshot, expected result, and browser observation."}
        </Empty>
      </section>
    );
  return (
    <section className="panel evidence-panel">
      <div className="evidence-heading">
        <h3>
          <Image size={17} />
          Captured evidence
        </h3>
        <Status value={result.status} />
      </div>
      <div className="browser-chrome">
        <span className="browser-dots">
          <i />
          <i />
          <i />
        </span>
        <span>
          <Globe2 size={12} />
          {result.evidence.url || "Synthetic sample"}
        </span>
        <span>
          {result.evidence.viewport.width} × {result.evidence.viewport.height}
        </span>
      </div>
      <div className="screenshot-frame">
        {result.evidence.screenshot ? (
          <EvidenceImage
            path={result.evidence.screenshot}
            alt={`Browser screenshot for ${result.requirement}`}
          />
        ) : (
          <div className="no-screenshot">
            <Image size={27} />
            <strong>No screenshot captured</strong>
            <p>This result does not include browser image evidence.</p>
          </div>
        )}
      </div>
      <div className="evidence-details">
        <div>
          <span className="detail-label">EXPECTED RESULT</span>
          <p>{result.expected || "Manual review required"}</p>
        </div>
        <div>
          <span className="detail-label">OBSERVED IN THE BROWSER</span>
          <p>{result.evidence.observed}</p>
        </div>
        <div className="evidence-metadata">
          <span>
            <Clock3 size={13} />
            {result.durationMs} ms
          </span>
          <span>
            <Code2 size={13} />
            {result.kind.replaceAll("_", " ")}
          </span>
        </div>
        {result.evidence.dom && (
          <details className="dom-details">
            <summary>
              View captured DOM evidence
              <ChevronDown size={14} />
            </summary>
            <pre>{result.evidence.dom}</pre>
          </details>
        )}
      </div>
    </section>
  );
}
function CreateProject({
  demo = false,
  active = true,
  onClose,
  onCreate,
}: {
  demo?: boolean;
  active?: boolean;
  onClose: () => void;
  onCreate: (values: {
    name: string;
    target: "sample" | "website";
    url: string;
    brief: string;
    authorized: boolean;
    sampleVariant: "healthy" | "broken";
  }) => Promise<void>;
}) {
  const [target, setTarget] = useState<"sample" | "website">("sample");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loadingRef.current) onClose();
      if (event.key === "Tab") {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea,select,a[href]",
        );
        if (!focusable?.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handle);
      previousFocus.current?.focus();
    };
  }, [active]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <motion.div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        initial={{ opacity: 0, y: 15, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25 }}
      >
        <div className="modal-header">
          <span className="modal-icon">
            <Folder size={23} />
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close new project"
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="create-title">A great handoff starts here.</h2>
        <p>
          {demo
            ? "Try a synthetic website and the promises you want to prove."
            : "Add your website and the promises you want to prove."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setLoading(true);
            setError("");
            try {
              await onCreate({
                name: String(form.get("name")),
                target,
                url: String(form.get("url") || ""),
                brief: String(form.get("brief")),
                authorized:
                  target === "sample" || form.get("authorized") === "on",
                sampleVariant:
                  (form.get("sampleVariant") as "healthy" | "broken") ||
                  "healthy",
              });
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Project creation failed.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <label>
            Project name
            <input
              name="name"
              placeholder="e.g. Studio North website"
              maxLength={100}
              required
            />
          </label>
          <fieldset className="target-options">
            <legend>What would you like to test?</legend>
            <button
              type="button"
              className={target === "sample" ? "selected" : ""}
              onClick={() => setTarget("sample")}
            >
              <LayersIcon />
              <span>
                <strong>Synthetic sample</strong>
                <small>Try the complete workflow</small>
              </span>
              {target === "sample" && <CheckCircle2 size={17} />}
            </button>
            <button
              type="button"
              className={target === "website" ? "selected" : ""}
              onClick={() => setTarget("website")}
              disabled={demo}
              aria-describedby={demo ? "demo-target-note" : undefined}
            >
              <Globe2 size={22} />
              <span>
                <strong>Your website</strong>
                <small>
                  {demo
                    ? "Available in your own private workspace"
                    : "A site you are authorized to audit"}
                </small>
              </span>
              {target === "website" && <CheckCircle2 size={17} />}
            </button>
          </fieldset>
          {demo && (
            <div className="form-note" id="demo-target-note">
              <Info size={15} />
              <span>
                This public demo audits synthetic websites only. Use example
                requirements and do not enter client information.
              </span>
            </div>
          )}
          {target === "website" ? (
            <>
              <label>
                Website URL
                <input
                  type="url"
                  name="url"
                  placeholder="https://your-website.com"
                  required
                />
              </label>
              <label className="checkbox-label">
                <input name="authorized" type="checkbox" required />
                <span>I own this website or have permission to audit it.</span>
              </label>
            </>
          ) : (
            <label>
              Sample condition
              <select name="sampleVariant">
                <option value="healthy">Healthy website</option>
                <option value="broken">Intentionally broken website</option>
              </select>
            </label>
          )}
          <label>
            {demo ? "Example requirements" : "Client requirements"}
            <textarea
              name="brief"
              rows={5}
              required
              placeholder={
                'The homepage should show the heading "Thoughtful websites. Built to last."\nA contact link should point to /contact.\nThe page should fit a mobile screen without horizontal scrolling.'
              }
            />
          </label>
          <div className="form-note">
            <Info size={15} />
            <span>
              Test generation uses the configured model or clearly labeled
              deterministic templates. You review every check before it runs.
            </span>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={17} />
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              type="button"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button className="button primary" disabled={loading}>
              {loading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ArrowRight size={16} />
              )}
              {loading ? "Creating project…" : "Create & review checks"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function Application() {
  const [route, setRoute] = useState(
    window.location.hash === "#main" ? "#demo" : window.location.hash,
  );
  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);
  const workspace =
    route === "#demo" || route === "#model" || route === "#main";
  const [visitedWorkspace, setVisitedWorkspace] = useState(workspace);
  useEffect(() => {
    if (workspace) setVisitedWorkspace(true);
    if (workspace || !route) window.scrollTo({ top: 0, behavior: "instant" });
  }, [route, workspace]);
  return (
    <>
      {!workspace && (
        <MotionConfig reducedMotion="user">
          <Landing
            onOpenDemo={() => {
              window.location.hash = "demo";
            }}
            onOpenModel={() => {
              window.location.hash = "model";
            }}
          />
        </MotionConfig>
      )}
      {(visitedWorkspace || workspace) && (
        <div hidden={!workspace}>
          <App
            active={workspace}
            initialView={route === "#model" ? "model" : "overview"}
            openModel={route === "#model"}
          />
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Application />
  </React.StrictMode>,
);
