# Delivery workspace redesign

The dashboard puts the project library, approval state and latest observed results ahead of introductory material. Its counts come from saved projects and audits. A completed audit remains distinct from a passed check; blocked and unverified results stay visible.

The visual direction takes inspiration from the restrained navigation and spacing in [Manu Arora's Aceternity sidebar](https://ui.aceternity.com/components/sidebar). This uses Briefstamp's own components, existing fonts and Motion dependency; no Aceternity Pro code, assets or integration is claimed. The landing page is unchanged.

The workspace now uses an ink sidebar, compact white toolbar, quieter surfaces, tabular counts and a consistent blue action accent. The public-demo notice expands to reveal its full limitations. On mobile, navigation opens as a drawer with background isolation, focus containment, Escape handling and focus return. Existing model consent, check approval, authentication, TLS and provider budgets remain in place.

## Verification

- [Exact source CI](evidence/dashboard/2026-10-16/ci.json): 571 application tests, 19 Python tests, build and actual browser audits.
- [Completed local UI check](evidence/dashboard/2026-10-16/local-ui.json): review, approval, real sample audit, portable HTML download, model/failure views, project modal and widths 1440/768/390/360. No model request was made.
- [Deployment and hosted UI proof](evidence/dashboard/2026-10-16/README.md).

These are agent verification runs. They do not establish customer acceptance, exhaustive accessibility compliance or a new model result. The separately recorded [real Gemma run](GEMMA_LIVE_SITE.md) and [hosted optional-provider checks](HOSTED_OPTIONAL.md) retain their own source revisions and limitations.
