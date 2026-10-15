import type { Audit, Check, CheckResult, ResultStatus } from "../shared/types";
import { readEvidence } from "./store";
import { redact } from "./safety";

const escape = (s: string) =>
  redact(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const statuses: ResultStatus[] = ["passed", "failed", "blocked", "unverified"];
const imagePath = /^\/evidence\/[a-f0-9-]+\/[a-zA-Z0-9_-]+\.png$/;

// Reject empty, truncated and non-PNG evidence before embedding it. This checks
// the PNG container; the browser remains responsible for decoding the pixels.
function isPng(file: Buffer) {
  if (!file.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return false;
  let offset = 8;
  let hasHeader = false;
  let hasPixels = false;
  while (offset + 12 <= file.length) {
    const length = file.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > file.length) return false;
    const kind = file.toString("ascii", offset + 4, offset + 8);
    if (!hasHeader) {
      if (
        kind !== "IHDR" ||
        length !== 13 ||
        file.readUInt32BE(offset + 8) === 0 ||
        file.readUInt32BE(offset + 12) === 0
      )
        return false;
      hasHeader = true;
    } else if (kind === "IHDR") return false;
    if (kind === "IDAT" && length > 0) hasPixels = true;
    if (kind === "IEND")
      return length === 0 && hasPixels && end === file.length;
    offset = end;
  }
  return false;
}

interface ReportEntry {
  check?: Check;
  result?: CheckResult;
  issue?: "ambiguous" | "mismatch";
}

export async function renderReport(
  audit: Audit,
  readImage: (evidencePath: string) => Promise<Buffer | null> = readEvidence,
) {
  const hasPlan = audit.checks.length > 0;
  const plannedIds = new Set(audit.checks.map((check) => check.id));
  const entries: ReportEntry[] = hasPlan
    ? audit.checks.map((check) => {
        const matches = audit.results.filter((r) => r.checkId === check.id);
        const ambiguous =
          matches.length > 1 ||
          audit.checks.filter((item) => item.id === check.id).length > 1;
        const mismatch =
          matches.length === 1 &&
          (matches[0].kind !== check.kind ||
            redact(matches[0].requirement) !== redact(check.requirement) ||
            redact(matches[0].expected) !== redact(check.expected));
        return {
          check,
          result:
            matches.length === 1 && !ambiguous && !mismatch
              ? matches[0]
              : undefined,
          issue: ambiguous ? "ambiguous" : mismatch ? "mismatch" : undefined,
        };
      })
    : audit.results.map((result) => ({ result }));
  const unlinked = hasPlan
    ? audit.results.filter((r) => !plannedIds.has(r.checkId))
    : [];
  const missing = entries.filter((entry) => !entry.result).length;
  const incomplete =
    audit.status !== "completed" ||
    Boolean(audit.error) ||
    missing > 0 ||
    entries.length === 0 ||
    unlinked.length > 0;
  const statusOf = (entry: ReportEntry): ResultStatus =>
    entry.result && statuses.includes(entry.result.status)
      ? entry.result.status
      : "unverified";
  let unavailableImages = 0;

  async function renderEntry(entry: ReportEntry) {
    const { check, result, issue } = entry;
    const requirement = check?.requirement ?? result!.requirement;
    const expected = check?.expected ?? result!.expected;
    const id = check?.id ?? result!.checkId;
    const status = statusOf(entry);
    if (!result)
      return `<article data-check-id="${escape(id)}"><span class="badge unverified">Unverified</span><h3>${escape(requirement)}</h3><dl><dt>Check</dt><dd>${escape(id)}</dd><dt>Expected</dt><dd>${escape(expected || check!.kind)}</dd><dt>Execution</dt><dd>${issue === "ambiguous" ? "Conflicting records: a check ID appears more than once in the plan or results. A single outcome cannot be verified." : issue === "mismatch" ? "Result mismatch: the recorded requirement, assertion type or expected value differs from this planned check. Its outcome cannot verify this requirement." : "Not executed or not recorded. No execution result is available for this planned check."}</dd><dt>Planned page and viewport</dt><dd>${escape(check!.path)} · ${escape(check!.viewport)}</dd></dl><p class="evidence-note">No verified matching evidence is available for this check. It is not counted as passed.</p></article>`;

    let image = "";
    let imageNote = "No screenshot was recorded for this check.";
    if (result.evidence.screenshot) {
      imageNote =
        "Screenshot unavailable: the saved reference is not a supported local evidence path. No external image was requested.";
      if (imagePath.test(result.evidence.screenshot)) {
        try {
          const file = await readImage(result.evidence.screenshot);
          if (file && isPng(file)) {
            image = `<figure><img alt="Observed page for ${escape(requirement)}" src="data:image/png;base64,${file.toString("base64")}"><figcaption>Captured browser screenshot, embedded in this report.</figcaption></figure>`;
            imageNote = "";
          } else {
            imageNote = file
              ? "Screenshot unavailable: the saved image is empty, invalid or incomplete."
              : "Screenshot unavailable: the referenced image could not be found in the saved evidence.";
          }
        } catch {
          imageNote =
            "Screenshot unavailable: the saved evidence could not be read. The recorded browser result has not been changed.";
        }
      }
      if (!image) unavailableImages++;
    }
    return `<article data-check-id="${escape(id)}"><span class="badge ${status}">${status}</span><h3>${escape(requirement)}</h3><dl><dt>Check</dt><dd>${escape(id)}</dd><dt>Expected</dt><dd>${escape(expected || result.kind)}</dd><dt>Observed</dt><dd>${escape(result.evidence.observed)}</dd><dt>Page and viewport</dt><dd>${escape(result.evidence.url)} · ${escape(String(result.evidence.viewport.width))} × ${escape(String(result.evidence.viewport.height))}</dd></dl>${image}${imageNote ? `<p class="evidence-note">${imageNote}</p>` : ""}${result.evidence.dom ? `<details><summary>Captured text evidence</summary><pre>${escape(result.evidence.dom)}</pre></details>` : ""}</article>`;
  }

  const rows = await Promise.all(entries.map(renderEntry));
  const unlinkedRows = await Promise.all(
    unlinked.map((result) => renderEntry({ result })),
  );
  const counts = statuses
    .map(
      (status) =>
        `<div data-status="${status}"><strong>${entries.filter((entry) => statusOf(entry) === status).length}</strong><span>${status}</span></div>`,
    )
    .join("");
  const coverage = hasPlan
    ? `${entries.length - missing} of ${entries.length} planned checks have a matching recorded result. ${missing} checks have no verifiable result and are counted as unverified.`
    : `${entries.length} recorded results. The original test plan was not saved with this audit, so planned coverage cannot be verified.`;
  const summary = incomplete
    ? "This audit is incomplete. Review the recorded results and unresolved checks before accepting the website."
    : audit.summary ||
      "The audit finished. Review each recorded outcome and its observed evidence before accepting the website.";
  const source = audit.source;
  const sourceHtml = source
    ? `<section aria-labelledby="source-title"><h2 id="source-title">Brief and test origin</h2><dl><dt>Target at audit time</dt><dd>${escape(source.target === "sample" ? `Synthetic sample (${source.sampleVariant})` : source.url)}</dd><dt>Test generator</dt><dd>${escape(source.generator.provider)}${source.generator.model ? ` · ${escape(source.generator.model)}` : ""}</dd>${source.generator.reason ? `<dt>Generator note</dt><dd>${escape(source.generator.reason)}</dd>` : ""}</dl><details><summary>Original client brief</summary><pre>${escape(source.brief)}</pre></details><p class="caption">Saved when this audit began. Later project edits do not change this snapshot.</p></section>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(audit.projectName)} | Briefstamp delivery report</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:#182132;font:16px/1.65 ui-sans-serif,system-ui,sans-serif}main{max-width:920px;margin:auto;padding:48px 24px}header{border-bottom:3px solid #315beb;padding-bottom:24px}.brand{color:#315beb;font-weight:750;letter-spacing:-.04em;font-size:24px}h1{font-size:clamp(30px,5vw,48px);line-height:1.1;letter-spacing:-.045em}h1,h2,h3,p,pre{overflow-wrap:anywhere}p{color:#526078}.counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:32px 0 16px}.counts div{background:white;border:1px solid #dde1e9;border-radius:10px;padding:16px}.counts strong{display:block;font-size:30px;font-variant-numeric:tabular-nums}.counts span{text-transform:capitalize}article,section{background:white;padding:24px;border:1px solid #dde1e9;border-radius:12px;margin:18px 0;break-inside:avoid}section article{padding:24px 0;margin:0;border:0;border-radius:0;border-top:1px solid #dde1e9}h2{font-size:24px;line-height:1.3}h3{font-size:21px;line-height:1.4}dt{font-size:12px;text-transform:uppercase;color:#526078;font-weight:bold}dd{margin:0 0 12px;overflow-wrap:anywhere}.badge{display:inline-block;border-radius:5px;padding:3px 10px;text-transform:capitalize;background:#edf0f6}.passed{background:#edf5ec;color:#285b2d}.failed{background:#ffeded;color:#a32128}.blocked{background:#fff4dc;color:#805100}.unverified{background:#edf0f6;color:#526078}figure{margin:20px 0}img{display:block;width:100%;height:auto;border:1px solid #ddd;border-radius:8px}.caption,figcaption,.evidence-note{font-size:14px;color:#526078}figcaption{margin-top:8px}.evidence-note{background:#f4f5f8;padding:12px;border-radius:6px}pre{white-space:pre-wrap;font-size:14px}summary{cursor:pointer;min-height:44px;padding:12px 0}footer{font-size:14px;color:#526078;margin-top:32px}button{background:#315beb;color:white;min-height:44px;padding:12px 18px;border:0;border-radius:7px;cursor:pointer;font:inherit}button:hover{background:#2548bd}button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #315beb;outline-offset:4px}.skip-link{position:absolute;left:16px;top:-100px;background:white;padding:12px;color:#2548bd}.skip-link:focus{top:12px}@media(max-width:480px){main{padding:28px 16px}.counts{grid-template-columns:repeat(2,minmax(0,1fr))}article,section{padding:16px}}@media print{body{background:white}main{padding:0}button,.skip-link{display:none}article,section{border-color:#ccc}details{display:block}details>*{display:block!important}}</style></head><body><a class="skip-link" href="#acceptance">Skip to acceptance checks</a><main><header><div class="brand">Briefstamp / delivery evidence</div><h1>${escape(audit.projectName)}</h1><p>Website acceptance report · ${escape(new Date(audit.createdAt).toLocaleString("en-GB", { timeZone: "UTC" }))} UTC</p><span class="badge ${incomplete ? "blocked" : "unverified"}">${incomplete ? "Audit incomplete" : "Audit completed"}</span><p>${escape(summary)}</p><button onclick="window.print()">Print or save as PDF</button></header><div class="counts" aria-label="Acceptance result counts">${counts}</div><p>${escape(coverage)}</p>${audit.error ? `<article role="alert"><h2>Why the audit stopped</h2><p>${escape(audit.error)}</p></article>` : ""}${unavailableImages ? `<p class="evidence-note">Evidence incomplete: ${unavailableImages} referenced screenshot${unavailableImages === 1 ? " is" : "s are"} unavailable in this export. Recorded browser outcomes are unchanged; missing images are not evidence of success or failure.</p>` : ""}${sourceHtml}<section id="acceptance" aria-labelledby="acceptance-title" tabindex="-1"><h2 id="acceptance-title">Acceptance checks</h2>${rows.length ? rows.join("") : "<p>No checks or results were recorded. Approve a test plan and run an audit to create delivery evidence.</p>"}</section>${unlinkedRows.length ? `<section aria-labelledby="unlinked-title"><h2 id="unlinked-title">Results outside the saved plan</h2><p>These ${unlinkedRows.length} recorded results do not match a planned check. They are shown for review and excluded from the acceptance counts above.</p>${unlinkedRows.join("")}</section>` : ""}<footer>Audit ${escape(audit.id)} · ${escape(audit.status)}<br>Each result covers only its assertion and captured viewport. Unavailable, unexecuted and manual checks are never counted as passed. External sites run with scripts disabled in the safe runner. Review captured evidence for private client information before sharing this file.</footer></main></body></html>`;
}
