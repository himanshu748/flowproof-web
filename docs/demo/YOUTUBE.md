# Briefstamp YouTube package

Status: uploaded as **unlisted** on the Himanshu Jha channel on October 15, 2026. Processing and copyright checks completed with “No issues found.” English subtitles are published. [Upload receipt](youtube-upload.json).

[YouTube video](https://youtu.be/xve020VJl0s) · [MP4 backup](briefstamp-demo.mp4)

The video keeps its original 68-second template-workflow disclosure. The editable SVG remains a source asset; the PNG is the uploaded YouTube thumbnail.

[Unlisted video details](youtube-details.jpg) · [Completed processing/checks](youtube-upload-confirmation.jpg) · [Published English captions](youtube-captions-published.jpg). Actual playback and English caption selection were verified in the in-app browser. Studio still requires a separate one-time channel verification for clickable external description links; no account verification was initiated.

## Title

Briefstamp: From Client Brief to Verified Website Evidence

## Description

Give clients evidence they can understand. Briefstamp connects each agreed requirement to an approved check, a real Chromium result and a downloadable delivery report.

Watch the same six-check plan move from a healthy sample to three detected failures, then three verified recoveries after restoration and reapproval. Each result stays linked to the original requirement and captured evidence. One subjective requirement remains clearly unverified.

Try the public demo: https://flowproof-demo.onrender.com/
Explore the code: https://github.com/himanshu748/flowproof-web
Capture provenance and source images: https://github.com/himanshu748/flowproof-web/tree/main/docs/demo

00:00 Client requirements and the delivery problem
00:12 Approve the plan and run Chromium
00:23 Broken sample and observed failures
00:44 Manual restoration and fresh approval
00:56 Compare results and download the report

### Limitations

This 68-second video is an edited walkthrough of actual hosted UI captures from commit `816d869ed7851b471b0ff83b103903ef2f069eae`, not continuous elapsed-time proof. It uses a deterministic template plan and a synthetic website. No model was called in this footage. The operator manually restores the sample and reapproves the unchanged assertions; there is no automatic repair. The unverified subjective requirement never becomes a pass. Separate repository receipts document provider-specific integrations.

## Tags

Briefstamp, website testing, acceptance testing, Playwright, browser automation, client handoff, freelance developer, web agency, website delivery, requirements, quality assurance, evidence, open source, developer tools

## Upload files

| Field | Asset |
|---|---|
| Video | `briefstamp-demo.mp4`, existing 68-second captioned H.264 edit |
| Thumbnail | `thumbnail.png`, 1280 × 720 |
| Editable thumbnail | `thumbnail.svg`, embedded original source images and editable text |
| English subtitles | `briefstamp-demo.srt`, all 11 cues match the existing VTT exactly |
| README preview | `briefstamp-preview.gif`, edited 10-second approval, failure and restoration sequence |
| Provenance | `upload-assets-manifest.json`, hashes, source crops and measured file metadata |

The thumbnail uses the actual hosted broken/restored counts: **2 passed, 3 failed, 1 unverified → 5 passed, 0 failed, 1 unverified**, with zero blocked in both. It does not use the separate CI plan's results. The GIF also shows actual approved-plan and result excerpts, with an always-visible template/no-model disclosure.

Reproduce the package without browser or provider calls:

```sh
python3 scripts/render-youtube-assets.py
```

The helper needs Pillow with WOFF2 support and FFprobe. It uses the repository's licensed Space Grotesk and DM Sans fonts. The static PNG is suitable as a reduced-motion alternative to the GIF.
