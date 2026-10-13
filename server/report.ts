import type { Audit } from "../shared/types";
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
export async function renderReport(
  audit: Audit,
  readImage: (evidencePath: string) => Promise<Buffer | null> = readEvidence,
) {
  const rows = await Promise.all(
    audit.results.map(async (r) => {
      let img = "";
      if (
        r.evidence.screenshot &&
        /^\/evidence\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+\.png$/.test(
          r.evidence.screenshot,
        )
      ) {
        const file = await readImage(r.evidence.screenshot);
        if (file)
          img = `<img alt="Observed page for ${escape(r.requirement)}" src="data:image/png;base64,${file.toString("base64")}">`;
      }
      return `<article><span class="badge ${r.status}">${escape(r.status)}</span><h2>${escape(r.requirement)}</h2><dl><dt>Expected</dt><dd>${escape(r.expected || r.kind)}</dd><dt>Observed</dt><dd>${escape(r.evidence.observed)}</dd><dt>Page and viewport</dt><dd>${escape(r.evidence.url)} · ${r.evidence.viewport.width} × ${r.evidence.viewport.height}</dd></dl>${img}${r.evidence.dom ? `<details><summary>Captured text evidence</summary><pre>${escape(r.evidence.dom)}</pre></details>` : ""}</article>`;
    }),
  );
  const counts = (["passed", "failed", "blocked", "unverified"] as const)
    .map(
      (s) =>
        `<div><strong>${audit.results.filter((r) => r.status === s).length}</strong><span>${s}</span></div>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(audit.projectName)} | FlowProof delivery report</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:#182132;font:16px/1.65 ui-sans-serif,system-ui,sans-serif}main{max-width:920px;margin:auto;padding:48px 24px}header{border-bottom:3px solid #315beb;padding-bottom:24px}.brand{color:#315beb;font-weight:750;letter-spacing:-.04em;font-size:24px}h1{font-size:clamp(30px,5vw,48px);line-height:1.1;letter-spacing:-.045em}p{color:#526078}.counts{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:32px 0}.counts div{background:white;border:1px solid #dde1e9;border-radius:10px;padding:16px}.counts strong{display:block;font-size:30px}.counts span{text-transform:capitalize}article{background:white;padding:24px;border:1px solid #dde1e9;border-radius:12px;margin:18px 0;break-inside:avoid}h2{font-size:21px;line-height:1.4}dt{font-size:12px;text-transform:uppercase;color:#63718a;font-weight:bold}dd{margin:0 0 12px;overflow-wrap:anywhere}.badge{display:inline-block;border-radius:5px;padding:3px 10px;text-transform:capitalize;background:#edf0f6}.passed{background:#edf5ec;color:#285b2d}.failed{background:#ffeded;color:#a32128}.blocked{background:#fff4dc;color:#805100}img{display:block;width:100%;height:auto;border:1px solid #ddd;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}summary{cursor:pointer;padding:12px 0}footer{font-size:13px;color:#63718a;margin-top:32px}button{background:#315beb;color:white;padding:12px 18px;border:0;border-radius:7px;cursor:pointer;font:inherit}button:focus-visible,summary:focus-visible{outline:3px solid #315beb;outline-offset:4px}@media(max-width:480px){main{padding:28px 16px}.counts{grid-template-columns:repeat(2,1fr)}article{padding:16px}}@media print{body{background:white}main{padding:0}button{display:none}article{border:1px solid #ccc}details{display:none}}</style></head><body><main><header><div class="brand">FlowProof / delivery evidence</div><h1>${escape(audit.projectName)}</h1><p>Website acceptance report · ${escape(new Date(audit.createdAt).toLocaleString("en-GB", { timeZone: "UTC" }))} UTC</p><p>${escape(audit.summary || "Results from approved checks executed in a real Chromium browser.")}</p><button onclick="window.print()">Print or save as PDF</button></header><div class="counts">${counts}</div>${audit.error ? `<article role="alert"><span class="badge failed">Audit incomplete</span><p>${escape(audit.error)}</p></article>` : ""}${rows.join("")}<footer>Audit ${escape(audit.id)} · ${escape(audit.status)}<br>Each result covers only the approved assertion and captured viewport. Unavailable or manual checks are never counted as passed. External sites run with scripts disabled in the safe runner. Review captured evidence for private client information before sharing this file.</footer></main></body></html>`;
}
