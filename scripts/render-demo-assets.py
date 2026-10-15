#!/usr/bin/env python3
"""Reproduce Briefstamp's captioned walkthrough from unmodified hosted captures.

Requires Pillow, ffmpeg, ffprobe and browser-video-recording's bundled renderer.
No browser, network, provider, Swift, or screen-capture calls are made.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/demo"
WORK = ROOT / "work/demo-render"
SOURCE = DOCS / "source"
DISCLOSURE = "Edited walkthrough · actual hosted UI captures · template plan · no model call"
STAGES = [
    (0, 6, "01-landing", "Client handoffs need evidence.", "Briefstamp turns requirements into approved checks and a report clients can read."),
    (6, 12, "02-review", "Start with six requirements.", "This hosted walkthrough uses a synthetic website and clearly labelled template checks."),
    (12, 17, "03-approved", "Approval comes before execution.", "Review the plan, approve the checks, then run the browser audit."),
    (17, 23, "05-healthy", "A real browser. Observed outcomes.", "5 passed · 0 failed · 1 unverified. A subjective requirement still needs human judgment."),
    (23, 29, "06-broken-plan", "Change the sample. Keep the assertions.", "Selecting the broken condition resets approvals. Review and approve again before running."),
    (29, 37, "07-broken", "The broken website fails three checks.", "2 passed · 3 failed · 1 unverified. Missing evidence never becomes a pass."),
    (37, 44, "08-failure-evidence", "See what the browser actually found.", "The failed heading stays linked to its requirement and captured screenshot."),
    (44, 50, "09-restored-plan", "Restore the sample. Approve again.", "Same assertions. The operator restores the synthetic condition; this is not automatic repair."),
    (50, 56, "10-restored", "Three recoveries, checked by Chromium.", "5 passed · 0 failed · 1 unverified. The subjective requirement remains unresolved."),
    (56, 62, "11-comparison", "Compare the same checks across runs.", "3 recovered · 2 still passing · 1 unknown. Changed or manual checks cannot prove a fix."),
    (62, 68, "12-downloaded", "Send the site. Show the proof.", "Download a portable delivery report with observed results and screenshot evidence."),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--renderer", type=Path, default=Path.home() / ".codex/skills/browser-video-recording/scripts/render_browser_demo.py")
    parser.add_argument("--captures", type=Path, default=ROOT / "work/demo-capture")
    parser.add_argument("--font", type=Path, default=Path("/System/Library/Fonts/Supplemental/Arial.ttf"))
    parser.add_argument("--bold-font", type=Path, default=Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"))
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--reuse-motion", action="store_true")
    args = parser.parse_args()
    for directory in (DOCS, WORK, SOURCE):
        directory.mkdir(parents=True, exist_ok=True)
    for src in sorted(args.captures.glob("[0-9][0-9]-*.png")):
        destination = SOURCE / src.name
        if src.resolve() != destination.resolve():
            shutil.copyfile(src, destination)
        if Image.open(destination).size != (1920, 1205):
            raise ValueError(f"Unexpected screenshot dimensions: {src}")
    journey_source = args.captures / "journey.json"
    if not journey_source.exists():
        journey_source = DOCS / "journey.json"
    if journey_source.resolve() != (DOCS / "journey.json").resolve():
        shutil.copyfile(journey_source, DOCS / "journey.json")
    journey = json.loads((DOCS / "journey.json").read_text())

    # Original, authored arrow: no compositor capture or system cursor extraction.
    pointer = Image.new("RGBA", (36, 48), (0, 0, 0, 0))
    draw = ImageDraw.Draw(pointer)
    shape = [(5, 4), (5, 36), (13, 29), (20, 43), (26, 40), (19, 26), (30, 26)]
    draw.polygon(shape, fill="#162036", outline="#ffffff", width=2)
    pointer.save(DOCS / "briefstamp-pointer.png")

    config = {
        "duration": 68, "fps": 60, "output_size": [1920, 1206], "source_size": [1920, 1205],
        "cursor_asset": str(DOCS / "briefstamp-pointer.png"), "cursor_hotspot": [5, 4],
        "cursor_scale": 1.25, "click_strength": 9, "rotation_strength_degrees": 2,
        "preset": "veryfast", "crf": 20,
        "shots": {s[2]: str(SOURCE / f"{s[2]}.png") for s in STAGES},
        "scene_starts": [[s[0], s[2], "fade"] for s in STAGES],
        "cursor_keys": [
            [0, 800, 730], [2.6, 441, 655], [5.8, 441, 655],
            [6.3, 650, 719], [10, 1555, 722], [12, 1555, 722],
            [14.7, 1650, 877], [16.9, 1650, 877],
            [19, 1522, 435], [22.9, 1522, 435],
            [24.5, 1661, 1090], [27.5, 1661, 1090],
            [30.2, 1593, 435], [35.7, 1593, 435],
            [38.5, 632, 718], [41.2, 1175, 794], [43.8, 1175, 794],
            [45.5, 1650, 509], [47, 1650, 509], [48.3, 1652, 297], [49.9, 1652, 297],
            [52, 864, 819], [55.9, 864, 819],
            [57.5, 565, 1004], [60.9, 565, 1004],
            [63.4, 1695, 252], [68, 1695, 252],
        ],
        "camera_keys": [
            [0, 960, 602.5, 1], [5.8, 1000, 590, 1.035],
            [6.3, 1010, 630, 1.015], [11.8, 1050, 655, 1.05],
            [16.8, 1080, 620, 1.055], [17.3, 1050, 560, 1.02],
            [22.8, 1070, 570, 1.06], [23.3, 1040, 650, 1.015],
            [28.8, 1080, 650, 1.05], [29.3, 1040, 620, 1.015],
            [36.8, 1080, 630, 1.06], [37.4, 1060, 650, 1.015],
            [43.8, 1110, 720, 1.075], [44.3, 1035, 610, 1.015],
            [49.8, 1080, 610, 1.055], [50.3, 1040, 620, 1.015],
            [55.8, 1070, 650, 1.055], [56.3, 1040, 650, 1.015],
            [61.8, 1090, 690, 1.06], [62.3, 1010, 580, 1.015],
            [68, 1030, 580, 1.035],
        ],
        "click_times": [5.8, 16.8, 49.8, 64.7],
    }
    write_json(WORK / "motion-config.json", config)
    # Portable version resolves from the repository root for manual reproduction.
    portable = json.loads(json.dumps(config))
    portable["cursor_asset"] = "docs/demo/briefstamp-pointer.png"
    portable["shots"] = {name: f"docs/demo/source/{name}.png" for name in config["shots"]}
    write_json(DOCS / "motion-config.json", portable)
    write_json(DOCS / "captions.json", [{"start": start, "end": end, "shot": shot, "title": title, "caption": subtitle} for start, end, shot, title, subtitle in STAGES])
    subtitle_lines = ["WEBVTT", ""]
    for start, end, _, title, subtitle in STAGES:
        stamp = lambda seconds: f"00:{seconds // 60:02}:{seconds % 60:02}.000"
        subtitle_lines.extend([f"{stamp(start)} --> {stamp(end)}", title, subtitle, ""])
    (DOCS / "briefstamp-demo.vtt").write_text("\n".join(subtitle_lines))

    # Pillow caption strips also work with FFmpeg builds lacking drawtext.
    fonts = {
        "brand": ImageFont.truetype(str(args.bold_font), 30),
        "disclosure": ImageFont.truetype(str(args.font), 23),
        "title": ImageFont.truetype(str(args.bold_font), 36),
        "caption": ImageFont.truetype(str(args.font), 26),
    }
    concat_lines = []
    for i, (start, end, _, title, subtitle) in enumerate(STAGES):
        strip = Image.new("RGB", (1920, 234), "#10192e")
        paint = ImageDraw.Draw(strip)
        paint.rectangle((0, 0, 1920, 71), fill="#f0f3fa")
        paint.text((48, 20), "Briefstamp", font=fonts["brand"], fill="#202b42", anchor="lt")
        paint.text((340, 24), DISCLOSURE, font=fonts["disclosure"], fill="#303e57", anchor="lt")
        paint.text((48, 97), f"{i + 1:02}", font=fonts["brand"], fill="#a8b3fd", anchor="lt")
        paint.text((128, 92), title, font=fonts["title"], fill="white", anchor="lt")
        paint.text((128, 145), subtitle, font=fonts["caption"], fill="#d0d8ea", anchor="lt")
        strip_path = WORK / f"caption-strip-{i:02}.png"
        strip.save(strip_path)
        concat_lines.extend([f"file 'caption-strip-{i:02}.png'", f"duration {end - start}"])
    concat_lines.append(f"file 'caption-strip-{len(STAGES) - 1:02}.png'")
    (WORK / "caption-strips.txt").write_text("\n".join(concat_lines) + "\n")
    if args.prepare_only:
        print(WORK / "motion-config.json")
        return
    raw = WORK / "briefstamp-motion.mp4"
    if not args.reuse_motion:
        subprocess.run(["python3", str(args.renderer), "--config", str(WORK / "motion-config.json"), "--output", str(raw)], check=True)
    caption_video = WORK / "briefstamp-caption-strips.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(WORK / "caption-strips.txt"),
        "-vf", "fps=60", "-t", "68", "-an", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "18", "-pix_fmt", "yuv420p", str(caption_video),
    ], check=True)
    output = DOCS / "briefstamp-demo.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-i", str(raw), "-i", str(caption_video), "-filter_complex",
        "[0:v]pad=1920:1440:0:72:color=0x10192e[canvas];[1:v]split[top][bottom];"
        "[top]crop=1920:72:0:0[header];[bottom]crop=1920:162:0:72[footer];"
        "[canvas][header]overlay=0:0[headed];[headed][footer]overlay=0:1278:shortest=1[video]",
        "-map", "[video]", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(output),
    ], check=True)
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size",
        "-of", "json", str(output),
    ]))
    write_json(DOCS / "ffprobe.json", probe)
    video = next(s for s in probe["streams"] if s.get("codec_name") == "h264")
    assert (video["width"], video["height"], video["r_frame_rate"]) == (1920, 1440, "60/1")
    assert 67.9 <= float(probe["format"]["duration"]) <= 68.1
    assert int(probe["format"]["size"]) < 100_000_000
    subprocess.run(["ffmpeg", "-y", "-ss", "39", "-i", str(output), "-frames:v", "1", "-update", "1", str(DOCS / "briefstamp-demo-poster.png")], check=True)
    source_records = []
    for file in sorted(SOURCE.glob("*.png")):
        source_records.append({"path": f"source/{file.name}", "sha256": sha256(file), "bytes": file.stat().st_size, "dimensions": list(Image.open(file).size), "used_in_video": file.stem in config["shots"]})
    manifest = {
        "product": "Briefstamp", "format": "Edited screenshot walkthrough, not continuous screen recording",
        "capture_ui": "Codex in-app browser through CUA", "captured_service": "https://flowproof-demo.onrender.com/",
        "capture_source_commit": journey["source"], "audit_target": "Synthetic sample website rendered in real Chromium",
        "disclosure": DISCLOSURE, "model_calls": 0,
        "outcomes": {k: journey[k] for k in ("healthy", "broken", "restored")},
        "restoration": journey["restoration"],
        "editing": "Original screenshots copied byte for byte. Editorial timing, fades, modest camera zoom and authored cursor choreography. No UI values were altered. Screenshots resampled to 1920x1206 then padded with a 72px header and 162px caption footer.",
        "renderer": {"name": "browser-video-recording/scripts/render_browser_demo.py", "sha256": sha256(args.renderer)},
        "sources": source_records,
        "assets": [{"path": name, "sha256": sha256(DOCS / name), "bytes": (DOCS / name).stat().st_size} for name in ("briefstamp-demo.mp4", "briefstamp-demo-poster.png", "briefstamp-pointer.png", "briefstamp-demo.vtt", "journey.json", "captions.json", "motion-config.json")],
        "video": probe,
        "claims_excluded": ["Continuous wall-clock proof", "A latency SLA", "An AI generation call in this walkthrough", "Automatic repair", "All requirements verified", "An audit of an arbitrary client website"],
    }
    write_json(DOCS / "manifest.json", manifest)
    print(json.dumps({"video": str(output), "duration": probe["format"]["duration"], "bytes": probe["format"]["size"]}))


if __name__ == "__main__":
    main()
