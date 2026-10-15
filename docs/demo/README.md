# Briefstamp — hosted demo walkthrough

[Watch the captioned demo](./briefstamp-demo.mp4) · [Poster](./briefstamp-demo-poster.png) · [WebVTT captions](./briefstamp-demo.vtt) · [Provenance manifest](./manifest.json)

This is a **68-second edited walkthrough of actual hosted UI captures**, with readable captions and an authored pointer. It is not continuous screen recording or wall-clock performance proof. The disclosure remains visible for the entire video:

> Edited walkthrough · actual hosted UI captures · template plan · no model call

## What it shows

The real hosted app runs an approved deterministic template plan against its synthetic website in Chromium. The same assertions are run against healthy, deliberately broken, and manually restored sample conditions:

| Sample condition | Passed | Failed | Blocked | Unverified |
|---|---:|---:|---:|---:|
| Healthy | 5 | 0 | 0 | 1 |
| Broken | 2 | 3 | 0 | 1 |
| Restored | 5 | 0 | 0 | 1 |

Changing the synthetic condition resets approvals. The operator restores the sample and approves the unchanged assertions before the next run. This is **not automatic repair**. The subjective requirement remains unverified in every run. The final comparison records three recoveries, two checks still passing and one unknown. No AI model was called during this captured journey; visible model-generation controls are not used.

## Capture provenance

- Service: <https://flowproof-demo.onrender.com/>.
- Capture UI: Codex in-app browser, operated through CUA.
- Deployed source commit: `816d869ed7851b471b0ff83b103903ef2f069eae`.
- Capture date: October 15, 2026.
- Original captures: twelve unmodified images with `.png` filenames (JPEG encoded), each 1920 × 1205, retained in [`source/`](./source/).
- Capture receipt: [`journey.json`](./journey.json). It records one observed **64.089-second first-report download on a warm server**, including screenshot and tool overhead. This is not an SLA, and it is not the duration of the later broken/restored sequence. The video's 68-second editorial timing is independent of that observation.
- Audit suffixes: healthy `a7a550dc`, broken `44307989`, restored `16ce0944`.

The filename `04-running.png` predates inspection: its pixels already show a completed result. It is retained as an original capture but excluded from the video to avoid implying an observed running state. The final download is supported by the capture receipt; the video does not simulate a file dialog.

## Editing and verification

Original source images are copied byte for byte. The edit adds fades, calm zooms and pointer choreography that points at actual controls. The pointer movement is authored, not a recorded mouse trace. UI text, values and screenshot evidence have not been replaced. The browser image is resampled to 1920 × 1206 for even-pixel H.264 encoding, then letterboxed into a 1920 × 1440 canvas with a 72-pixel disclosure header and a 162-pixel caption footer.

The MP4 uses H.264, 60 frames per second, no audio, and `faststart`. Exact duration, frame count and file size are recorded in [`ffprobe.json`](./ffprobe.json). The poster is extracted from the encoded video at 39 seconds. SHA-256 hashes for sources, video, poster, pointer, receipt and edit configuration are recorded in [`manifest.json`](./manifest.json).

## Reproduce the edit

Requires Python 3 with Pillow, FFmpeg/FFprobe and the installed `browser-video-recording` skill's bundled `scripts/render_browser_demo.py`. The helper never accesses a browser, a provider API, Swift or native screen capture. It supplies an original transparent pointer PNG directly to the bundled renderer.

From the repository root:

```sh
python3 scripts/render-demo-assets.py \
  --captures docs/demo/source \
  --renderer /path/to/browser-video-recording/scripts/render_browser_demo.py \
  --font /path/to/regular-font.ttf \
  --bold-font /path/to/bold-font.ttf
```

The helper uses the supplied `docs/demo/journey.json` when the capture directory does not contain its own receipt. The default local paths use the installed skill and macOS Arial fonts; fonts are not distributed. [`motion-config.json`](./motion-config.json) and [`captions.json`](./captions.json) preserve all editorial timing. Intermediates are written under `work/demo-render/`.

Separate integration receipts document provider-specific evidence. This video demonstrates the approved template-to-browser-to-report path.
