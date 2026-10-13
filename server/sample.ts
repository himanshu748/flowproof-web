import type { Check } from "../shared/types.js";

export const SAMPLE_URL = "https://sample.flowproof.test/";
export const SAMPLE_BRIEF = `The homepage must have the heading "Design that moves business forward."\nThe page must show "Independent by design."\nA "Start a project" link should lead to /contact.\nAll meaningful images need alternative text.\nThe website must not scroll horizontally on a mobile screen.\nThe design should feel trustworthy and professional.`;
export function sampleChecks(approved = false): Check[] {
  const defaults = { path: "/", viewport: "desktop" as const, approved };
  return [
    {
      ...defaults,
      id: "sample-heading",
      requirement: "The homepage must have the agreed headline.",
      kind: "heading",
      expected: "Design that moves business forward.",
    },
    {
      ...defaults,
      id: "sample-text",
      requirement: "Show the studio positioning on the homepage.",
      kind: "text_visible",
      expected: "Independent by design.",
    },
    {
      ...defaults,
      id: "sample-link",
      requirement: "The Start a project link should lead to /contact.",
      kind: "link",
      expected: "/contact",
    },
    {
      ...defaults,
      id: "sample-alt",
      requirement: "All meaningful images need alternative text.",
      kind: "image_alt",
      expected: "Descriptive alternative text on meaningful images",
    },
    {
      ...defaults,
      id: "sample-mobile",
      requirement:
        "The site must fit a mobile screen without horizontal scrolling.",
      kind: "no_horizontal_overflow",
      expected: "No horizontal scrolling at 390px",
      viewport: "mobile",
    },
    {
      ...defaults,
      id: "sample-manual",
      requirement: "The design should feel trustworthy and professional.",
      kind: "manual",
      expected: "Client review of visual tone",
    },
  ];
}

// An original, self-contained fictional studio. No external request is needed.
// Its project artwork is an SVG design-system diagram, not customer evidence.
const artwork = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560"><rect width="800" height="560" fill="#ccd0c0"/><path d="M0 420L800 140V560H0Z" fill="#b6bca9"/><rect x="167" y="66" width="466" height="429" rx="7" fill="#f9f7f0" transform="rotate(-7 400 280)"/><g transform="rotate(-7 400 280)"><text x="202" y="127" fill="#333f33" font-family="Georgia,serif" font-size="26">COMMON GROUND</text><path d="M225 344L349 201L457 323L539 233L581 374H225Z" fill="#485640"/><circle cx="535" cy="183" r="23" fill="#c5a36f"/><path d="M210 424H590" stroke="#9f9d94"/><text x="211" y="454" fill="#4a5044" font-family="sans-serif" font-size="14" letter-spacing="3">A NEW WAY TO GROW</text></g></svg>`)}`;

export function sampleHtml(
  variant: "healthy" | "broken" = "healthy",
  pathname = "/",
): string {
  const broken = variant === "broken";
  const contact = pathname === "/contact";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Forma Studio | Independent by design</title><style>
  :root{color-scheme:light;--ink:#292b24;--paper:#f5f3eb;--line:#d8d8cc;--accent:#c34b29}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 'Helvetica Neue',Arial,sans-serif}a{color:inherit;text-decoration:none}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}a:hover{color:var(--accent)}.wrap{max-width:1260px;margin:auto;padding:0 6vw}header{border-bottom:1px solid var(--line)}nav{height:92px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{font-size:30px;font-weight:600;letter-spacing:-2px}.brand span{color:var(--accent)}.nav-links{display:flex;align-items:center;gap:35px;font-size:14px}.contact-link{border-bottom:1px solid;padding:10px 0}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;display:flex;align-items:center;gap:10px}.eyebrow:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent)}.hero{display:grid;grid-template-columns:1.2fr 1fr;gap:55px;align-items:end;padding:74px 0 64px}h1{font-family:Georgia,serif;font-size:clamp(46px,5.5vw,77px);font-weight:400;letter-spacing:-3px;line-height:1.03;margin:27px 0 24px;max-width:700px}h1 em{font-weight:400;color:var(--accent)}.intro{color:#606257;max-width:330px;font-size:15px}.arrow-link{display:inline-flex;align-items:center;gap:32px;padding:13px 0;margin-top:11px;border-bottom:1px solid var(--ink);font-size:14px;min-height:44px}.arrow-link span{transition:transform 150ms}.arrow-link:hover span{transform:translateX(4px)}.hero-aside{padding-bottom:6px}.index{color:#76796b;font:12px/1.6 monospace;letter-spacing:1px}.work-top{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding:23px 0 18px;font-size:12px}.work{display:grid;grid-template-columns:1.65fr 1fr;gap:24px}.work img{width:100%;height:330px;object-fit:cover;display:block}.project-caption{display:flex;justify-content:space-between;gap:10px;padding-top:12px;font-size:13px}.project-caption small{color:#707265}.statement{background:#313e35;color:#f2f2e8;padding:38px;display:flex;flex-direction:column;justify-content:space-between;min-height:330px}.statement h2{font:36px/1.14 Georgia,serif;font-weight:400;letter-spacing:-1px;margin:15px 0}.statement .index{color:#bfc8ba}.diagram{display:flex;gap:0;margin:20px 0 10px}.diagram div{border:1px solid #bfc8ba;border-radius:50%;height:73px;width:73px;margin-right:-17px}.bottom{margin-top:58px;padding:23px 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;color:#74766d;font-size:11px}.broken-overflow{width:1800px;height:8px;background:#c34b29;margin-top:20px}.contact-page{padding:85px 0;max-width:730px}.contact-page h1{max-width:700px}.fixture-label{background:#e9e6da;border-top:1px solid var(--line);font:11px/1.5 monospace;text-align:center;padding:10px;color:#696b61}@media(max-width:650px){.wrap{padding:0 24px}nav{height:75px}.nav-links{gap:20px}.nav-work{display:none}.hero{grid-template-columns:1fr;gap:18px;padding:49px 0 40px}h1{font-size:51px;letter-spacing:-2.1px}.hero-aside{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.intro{font-size:14px;max-width:290px}.work{grid-template-columns:1fr}.work img{height:auto;aspect-ratio:1.43}.statement{min-height:240px}.bottom{flex-wrap:wrap;margin-top:37px}.project-caption{flex-wrap:wrap}}@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
  </style></head><body><header><nav class="wrap" aria-label="Main navigation"><a class="brand" href="/" aria-label="Forma Studio home">forma<span>®</span></a><div class="nav-links"><a class="nav-work" href="/#work">Selected work</a><a class="contact-link" href="${broken ? "/unavailable" : "/contact"}">Start a project <span aria-hidden="true">↗</span></a></div></nav></header><main class="wrap">${contact ? `<section class="contact-page"><p class="eyebrow">Make something meaningful</p><h1>Good things start with a conversation.</h1><p>Tell us what you have in mind.</p><a class="arrow-link" href="mailto:hello@forma.studio">Email the studio <span aria-hidden="true">↗</span></a></section>` : `<section class="hero"><div><p class="eyebrow">Independent by design.</p><h1>${broken ? "Something beautiful is coming soon." : "Design that moves business forward."}</h1></div><div class="hero-aside"><p class="intro">We partner with ambitious people to build thoughtful brands and websites. Small studio. Close collaboration. Lasting impact.</p><a class="arrow-link" href="#work">Explore our work <span aria-hidden="true">↓</span></a></div></section><section id="work" aria-label="Selected work"><div class="work-top"><span>SELECTED WORK / 2026</span><span class="index">01 / 02</span></div><div class="work"><article><img src="${artwork}" ${broken ? "" : 'alt="Common Ground brand identity with a mountain symbol and warm paper typography"'} width="800" height="560"><div class="project-caption"><span>Common Ground</span><small>Brand strategy · Identity · Web</small></div></article><article><div class="statement"><div class="index">THOUGHTFUL BY NATURE</div><h2>A little studio.<br>A wider perspective.</h2><div class="diagram" aria-hidden="true"><div></div><div></div><div></div></div></div><div class="project-caption"><span>Built on collaboration</span><small>Our approach</small></div></article></div></section>${broken ? '<div class="broken-overflow" aria-label="Intentional layout defect"></div>' : ""}`}</main><footer class="wrap"><div class="bottom"><span>© 2026 Forma Studio. Independent by design.</span><span>Brand strategy / Identity / Digital experiences</span></div></footer><div class="fixture-label">Synthetic demonstration website · ${broken ? "Intentionally broken variant" : "Healthy variant"} · No client data</div></body></html>`;
}
