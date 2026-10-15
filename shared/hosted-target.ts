/** Public metadata only. The site owner authorized read-only checks of this exact homepage. */
export const HOSTED_WEBSITE_URL = "https://flowproof-demo.onrender.com/";
export const HOSTED_WEBSITE_BRIEF = [
  'The homepage heading must say "Send the site. Show the proof."',
  'The homepage must show "Website delivery, with receipts".',
  'A link must say "See the proof".',
  "Every content image must have nonempty alternative text.",
  "The homepage must fit a 390px mobile screen without horizontal scrolling.",
  "The site should feel welcoming and trustworthy.",
].join("\n");
export const HOSTED_WEBSITE_PRESET = Object.freeze({
  id: "briefstamp-live" as const,
  name: "Briefstamp live website",
  target: "website" as const,
  url: HOSTED_WEBSITE_URL,
  brief: HOSTED_WEBSITE_BRIEF,
  authorization:
    "The Briefstamp site owner authorizes read-only acceptance checks of this exact public homepage. Visitors cannot substitute another website or page.",
});
