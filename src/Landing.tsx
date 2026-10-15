import { useState, type ReactNode } from "react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDashed,
  FileCheck2,
  Github,
  MoveUpRight,
  ShieldCheck,
  X,
} from "lucide-react";
import "./landing.css";

type LandingProps = {
  onOpenDemo: () => void;
  onOpenModel: () => void;
};

const proofRows = [
  {
    label: "The agreed homepage headline",
    detail: "Exact visible heading",
    fails: true,
  },
  {
    label: "A visible “Start a project” link",
    detail: "Link label only",
    fails: false,
  },
  {
    label: "Alternative text on content images",
    detail: "Presence, not description quality",
    fails: true,
  },
  {
    label: "A layout that fits a mobile screen",
    detail: "390px viewport",
    fails: true,
  },
  {
    label: "The words “Independent by design.”",
    detail: "Exact visible text",
    fails: false,
  },
  {
    label: "A welcoming, trustworthy feeling",
    detail: "A person needs to decide",
    manual: true,
  },
];

function Brand() {
  return (
    <a className="lp-brand" href="#top" aria-label="Briefstamp home">
      <span className="lp-brand-mark">
        <FileCheck2 size={23} strokeWidth={2} />
      </span>
      Briefstamp<span className="lp-brand-period">.</span>
    </a>
  );
}

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.35, delay, ease: [0.2, 0, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}

function AcceptanceExample({ onOpenDemo }: Pick<LandingProps, "onOpenDemo">) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="lp-example">
      <div className="lp-example-top">
        <div className="lp-example-project">
          <span className="lp-project-letter" aria-hidden="true">
            f.
          </span>
          <span>
            Forma Studio<small>Synthetic sample website</small>
          </span>
        </div>
        <span className="lp-example-document">Acceptance preview</span>
      </div>
      <div
        className="lp-example-switch"
        role="group"
        aria-label="Choose an illustrative website condition"
      >
        <button
          type="button"
          aria-pressed={!broken}
          onClick={() => setBroken(false)}
        >
          Healthy site
        </button>
        <button
          type="button"
          aria-pressed={broken}
          onClick={() => setBroken(true)}
        >
          Broken site
        </button>
      </div>
      <div className="lp-example-tally" aria-live="polite" aria-atomic="true">
        <div>
          <strong>{broken ? "2" : "5"}</strong>
          <span>
            <Check size={13} /> Passed
          </span>
        </div>
        <div className={broken ? "lp-tally-failed" : ""}>
          <strong>{broken ? "3" : "0"}</strong>
          <span>
            <X size={13} /> Failed
          </span>
        </div>
        <div>
          <strong>1</strong>
          <span>
            <CircleDashed size={13} /> Manual review
          </span>
        </div>
      </div>
      <ul className="lp-example-results">
        {proofRows.map((row) => {
          const failed = broken && row.fails;
          const state = row.manual ? "manual" : failed ? "failed" : "passed";
          const Icon = row.manual ? CircleDashed : failed ? X : Check;
          return (
            <li key={row.label} className={`lp-result-${state}`}>
              <span className="lp-result-icon">
                <Icon size={14} />
              </span>
              <span>
                {row.label}
                <small>{row.detail}</small>
              </span>
              <span className="lp-result-label">
                {row.manual ? "Review" : failed ? "Failed" : "Passed"}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="lp-example-bottom">
        <p>
          This preview illustrates saved sample outcomes. Open the workspace to
          approve checks and run a real browser audit.
        </p>
        <button type="button" className="lp-text-link" onClick={onOpenDemo}>
          Run it yourself <ArrowUpRight size={17} />
        </button>
      </div>
    </div>
  );
}

export default function Landing({ onOpenDemo, onOpenModel }: LandingProps) {
  const reduced = useReducedMotion();
  const entrance = (delay: number) => ({
    initial: reduced ? (false as const) : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.5,
      delay: reduced ? 0 : delay,
      ease: [0.2, 0, 0, 1] as [number, number, number, number],
    },
  });

  return (
    <MotionConfig reducedMotion="user">
      <div className="fp-landing" id="top">
        <a className="lp-skip-link" href="#lp-main">
          Skip to content
        </a>
        <header className="lp-header">
          <div className="lp-nav-wrap">
            <Brand />
            <nav className="lp-nav" aria-label="Main navigation">
              <a href="#how-it-works">How it works</a>
              <a href="#the-proof">The proof</a>
              <a href="#questions">Questions</a>
            </nav>
            <button type="button" className="lp-nav-cta" onClick={onOpenDemo}>
              Open demo <ArrowUpRight size={16} />
            </button>
          </div>
        </header>

        <main id="lp-main">
          <section className="lp-hero" aria-labelledby="lp-hero-title">
            <div className="lp-hero-inner">
              <div className="lp-hero-copy">
                <motion.p className="lp-eyebrow" {...entrance(0)}>
                  <span className="lp-small-line" /> Website delivery, with
                  receipts
                </motion.p>
                <motion.h1 id="lp-hero-title" {...entrance(0.05)}>
                  Send the site.
                  <br />
                  <span>Show the proof.</span>
                </motion.h1>
                <motion.p className="lp-hero-description" {...entrance(0.18)}>
                  Turn a client brief into approved checks, real browser
                  evidence and a delivery report that speaks for your work.
                </motion.p>
                <motion.div className="lp-hero-actions" {...entrance(0.25)}>
                  <button
                    type="button"
                    className="lp-button lp-button-primary"
                    onClick={onOpenDemo}
                  >
                    Try the live demo <ArrowUpRight size={19} />
                  </button>
                  <a className="lp-button lp-button-quiet" href="#the-proof">
                    See the proof <ArrowDown size={17} />
                  </a>
                </motion.div>
                <motion.p className="lp-hero-note" {...entrance(0.32)}>
                  No sign-up. A real audit on a safe sample website.
                </motion.p>
              </div>

              <motion.figure className="lp-hero-art" {...entrance(0.12)}>
                <div className="lp-hero-image-wrap">
                  <img
                    src="/assets/briefstamp-hero.webp"
                    srcSet="/assets/briefstamp-hero-768.webp 768w, /assets/briefstamp-hero.webp 1536w"
                    sizes="(max-width: 760px) 95vw, 55vw"
                    width="1536"
                    height="1024"
                    fetchPriority="high"
                    alt=""
                  />
                </div>
                <figcaption>
                  <span className="lp-art-index">01 /</span> A handoff, made
                  tangible.
                  <span className="lp-art-caption-detail">
                    Concept illustration
                  </span>
                </figcaption>
                <div className="lp-evidence-stamp" aria-hidden="true">
                  <FileCheck2 size={19} />
                  <span>
                    Evidence
                    <br />
                    attached
                  </span>
                  <MoveUpRight size={21} />
                </div>
              </motion.figure>
            </div>
            <div className="lp-hero-ledger">
              <span>
                For the moment between <br />
                <strong>“It’s ready” and “Approved.”</strong>
              </span>
              <span>
                <ShieldCheck size={19} /> You approve every check
              </span>
              <span>
                <FileCheck2 size={19} /> Results stay linked to the brief
              </span>
              <a href="#how-it-works" aria-label="Explore how Briefstamp works">
                <ArrowDown size={21} />
              </a>
            </div>
          </section>

          <section
            className="lp-flow-section lp-section"
            id="how-it-works"
            aria-labelledby="lp-flow-title"
          >
            <div className="lp-section-container">
              <Reveal className="lp-section-heading">
                <p className="lp-eyebrow">
                  From the first brief to the final file
                </p>
                <h2 id="lp-flow-title">
                  Close the loop.
                  <br />
                  <span>Not another tab.</span>
                </h2>
                <p>
                  One clear thread connects what was requested, what was checked
                  and what actually happened.
                </p>
              </Reveal>

              <Reveal className="lp-proof-path" delay={0.08}>
                <div className="lp-path-line" aria-hidden="true">
                  <svg viewBox="0 0 1000 56" preserveAspectRatio="none">
                    <path d="M0 28H1000" />
                    <path d="m320 20 8 8-8 8m330-16 8 8-8 8" />
                  </svg>
                </div>
                <article className="lp-flow-step">
                  <span className="lp-step-number">01</span>
                  <h3>Make the brief testable.</h3>
                  <p>
                    Paste the requirements. Review and edit the proposed checks
                    before anything runs.
                  </p>
                  <div className="lp-requirement-note">
                    <span>Client requirement</span>
                    <p>
                      “The homepage must fit a mobile screen without horizontal
                      scrolling.”
                    </p>
                  </div>
                </article>
                <article className="lp-flow-step">
                  <span className="lp-step-number">02</span>
                  <h3>Let the browser verify it.</h3>
                  <p>
                    Approved assertions run in Playwright. Screenshots and
                    observed results record what the site did.
                  </p>
                  <div className="lp-check-note">
                    <span>
                      <Check size={14} /> Approved check
                    </span>
                    <p>
                      Mobile layout <span>390px</span>
                    </p>
                    <small>Compare page width with viewport width</small>
                  </div>
                </article>
                <article className="lp-flow-step">
                  <span className="lp-step-number">03</span>
                  <h3>Deliver the whole story.</h3>
                  <p>
                    Open a readable report with each result, its original
                    requirement and its evidence in one place.
                  </p>
                  <div className="lp-delivery-note">
                    <FileCheck2 size={29} />
                    <div>
                      <span>Website delivery report</span>
                      <small>Requirement · Observation · Evidence</small>
                    </div>
                    <ArrowUpRight size={18} />
                  </div>
                </article>
              </Reveal>
            </div>
          </section>

          <section
            className="lp-proof-section lp-section"
            id="the-proof"
            aria-labelledby="lp-proof-title"
          >
            <div className="lp-section-container lp-proof-layout">
              <Reveal className="lp-proof-copy">
                <p className="lp-eyebrow">A pass should mean something</p>
                <h2 id="lp-proof-title">
                  The difference
                  <br />
                  is in the <span>evidence.</span>
                </h2>
                <p>
                  A changed headline. Missing image text. A page wider than a
                  phone. See what happens when an intentionally broken sample
                  meets the same checks.
                </p>
                <div className="lp-proof-callout">
                  <CircleDashed size={22} />
                  <p>
                    Some things need a person.
                    <br />
                    <span>
                      “Feels trustworthy” stays unverified until a human reviews
                      it. It never becomes an automatic pass.
                    </span>
                  </p>
                </div>
                <a
                  className="lp-text-link"
                  href="https://github.com/himanshu748/flowproof-web/actions"
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect the real audit workflow <ArrowUpRight size={17} />
                </a>
              </Reveal>
              <Reveal className="lp-proof-demo" delay={0.08}>
                <AcceptanceExample onOpenDemo={onOpenDemo} />
              </Reveal>
            </div>
          </section>

          <section
            className="lp-accountability-section lp-section"
            aria-labelledby="lp-accountability-title"
          >
            <div className="lp-section-container">
              <Reveal className="lp-accountability-heading">
                <div>
                  <p className="lp-eyebrow">Built in the open</p>
                  <h2 id="lp-accountability-title">
                    Honest software.
                    <br />
                    <span>Including the small print.</span>
                  </h2>
                </div>
                <p>
                  Briefstamp is a working MVP. The browser audit is real.
                  Research results and infrastructure limits are visible, too.
                </p>
              </Reveal>
              <Reveal className="lp-capability-list">
                <article>
                  <div>
                    <span className="lp-capability-state lp-state-working">
                      <Check size={13} /> Working
                    </span>
                    <h3>Real checks. Real reports.</h3>
                  </div>
                  <p>
                    Playwright execution, screenshots, result reports and GitHub
                    Actions audits work today. Public demo sessions use
                    temporary storage.
                  </p>
                  <button
                    type="button"
                    className="lp-text-link"
                    onClick={onOpenDemo}
                  >
                    Open workspace <ArrowUpRight size={17} />
                  </button>
                </article>
                <article>
                  <div>
                    <span className="lp-capability-state lp-state-research">
                      Measured pilot
                    </span>
                    <h3>AI that shows its work.</h3>
                  </div>
                  <p>
                    Local Gemma proposed three checks that caught a real sample
                    failure and its recovery. The full brief timed out. Saved
                    Tinker results also show the limits: fine-tuning did not beat
                    few-shot prompting. This demo makes no live model calls.
                  </p>
                  <a
                    className="lp-text-link"
                    href="https://github.com/himanshu748/flowproof-web/blob/main/docs/GEMMA_WORKFLOW.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Inspect the Gemma run <ArrowUpRight size={17} />
                  </a>
                  <button
                    type="button"
                    className="lp-text-link"
                    onClick={onOpenModel}
                  >
                    Read model results <ArrowUpRight size={17} />
                  </button>
                </article>
                <article>
                  <div>
                    <span className="lp-capability-state lp-state-research">
                      Isolated trial verified
                    </span>
                    <h3>Persistence, tested honestly.</h3>
                  </div>
                  <p>
                    A temporary Tiger Data trial verified saving, recovery and
                    failure retrieval, then was cleaned up. Permanent hosted
                    storage is still pending.
                  </p>
                  <a
                    className="lp-text-link"
                    href="https://github.com/himanshu748/flowproof-web/blob/main/docs/TIGER_VERIFICATION.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the evidence <ArrowUpRight size={17} />
                  </a>
                </article>
              </Reveal>
            </div>
          </section>

          <section
            className="lp-faq-section lp-section"
            id="questions"
            aria-labelledby="lp-faq-title"
          >
            <div className="lp-section-container lp-faq-layout">
              <Reveal>
                <p className="lp-eyebrow">Before the handoff</p>
                <h2 id="lp-faq-title">
                  Good questions.
                  <br />
                  <span>Clear answers.</span>
                </h2>
                <p className="lp-faq-intro">
                  A little context before you open the workspace.
                </p>
              </Reveal>
              <div className="lp-faq-list">
                <details>
                  <summary>
                    Can I test my client’s website?
                    <ChevronDown size={19} />
                  </summary>
                  <p>
                    The public demo uses a synthetic website to keep visitors
                    and sites safe. Private setup supports authorized public
                    websites with network protections. Only audit a site you own
                    or have permission to test.
                  </p>
                </details>
                <details>
                  <summary>
                    Will it submit forms or change my site?
                    <ChevronDown size={19} />
                  </summary>
                  <p>
                    No. Approved checks inspect visible text, headings, links,
                    image alternative text and mobile overflow. Form
                    submissions, purchases and destructive browser actions are
                    outside the supported checks.
                  </p>
                </details>
                <details>
                  <summary>
                    Does a passed report guarantee everything works?
                    <ChevronDown size={19} />
                  </summary>
                  <p>
                    A pass means the specific approved assertion ran and matched
                    its expected result. It does not certify an entire website.
                    Unsupported, blocked and subjective requirements remain
                    clearly separate from passed checks.
                  </p>
                </details>
                <details>
                  <summary>
                    Can I keep the delivery report?
                    <ChevronDown size={19} />
                  </summary>
                  <p>
                    Yes. Download the report with screenshot evidence from the
                    workspace. Public demo sessions are temporary, so save your
                    report before leaving.
                  </p>
                </details>
                <details>
                  <summary>
                    What does it cost to try?
                    <ChevronDown size={19} />
                  </summary>
                  <p>
                    The public sample demo is free and requires no payment
                    details. Commercial pricing has not launched. The current
                    project uses confirmed free resources and a bounded research
                    pilot.
                  </p>
                </details>
              </div>
            </div>
          </section>

          <section
            className="lp-final-section"
            aria-labelledby="lp-final-title"
          >
            <div className="lp-section-container lp-final-inner">
              <Reveal>
                <p className="lp-eyebrow">Make the next handoff a clear one</p>
                <h2 id="lp-final-title">
                  Good work deserves
                  <br />
                  <span>a better handoff.</span>
                </h2>
                <button
                  type="button"
                  className="lp-button lp-button-white"
                  onClick={onOpenDemo}
                >
                  Try Briefstamp <ArrowUpRight size={19} />
                </button>
                <p className="lp-final-note">
                  A safe sample. A real browser. Your call on the results.
                </p>
              </Reveal>
              <div className="lp-final-mark" aria-hidden="true">
                <FileCheck2 strokeWidth={0.8} />
              </div>
            </div>
          </section>
        </main>

        <footer className="lp-footer">
          <div className="lp-section-container lp-footer-inner">
            <div>
              <Brand />
              <p>From client brief to delivery proof.</p>
            </div>
            <div className="lp-footer-links">
              <button type="button" onClick={onOpenModel}>
                Model lab <ArrowUpRight size={14} />
              </button>
              <a
                href="https://github.com/himanshu748/flowproof-web"
                target="_blank"
                rel="noreferrer"
              >
                <Github size={16} /> View source
              </a>
              <a href="#top">
                Back to top <ArrowRight size={14} className="lp-up-arrow" />
              </a>
            </div>
            <p className="lp-footer-small">
              An independent open-source project.
              <br />
              Built for thoughtful website delivery.
            </p>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
