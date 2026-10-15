import { readFile, writeFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "../src/Landing.js";

// Serve the real production component before JavaScript. This is not an audit
// fixture or a second test-only page. The client replaces it with the same UI.
const file = new URL("../dist/index.html", import.meta.url);
const source = await readFile(file, "utf8");
const marker = '<div id="root"></div>';
if (source.split(marker).length !== 2)
  throw new Error(
    "The built page must have exactly one empty application root.",
  );
const landing = renderToStaticMarkup(
  <Landing staticRender onOpenDemo={() => {}} onOpenModel={() => {}} />,
);
if (!landing.includes('id="lp-hero-title"') || /opacity:0(?:;|")/.test(landing))
  throw new Error("The script-free landing must include visible real content.");
const note =
  '<noscript><p style="padding:16px;text-align:center;background:#f7f8fb;color:#202c43">This is Briefstamp’s public landing page. Enable JavaScript to use the interactive audit workspace. The report describes only the approved checks that actually ran.</p></noscript>';
await writeFile(
  file,
  source.replace(marker, `<div id="root">${landing}</div>${note}`),
);
console.log(
  "Prerendered the production landing page with visible script-free content.",
);
