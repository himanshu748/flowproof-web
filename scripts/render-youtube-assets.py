#!/usr/bin/env python3
"""Build Briefstamp upload assets locally from its unmodified hosted captures.

Uses Pillow and FFprobe only. No browser, network or provider calls.
SVG text remains editable; the PNG shares its geometry and bundled brand fonts.
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/demo"
SOURCE = OUT / "source"
DISPLAY = ROOT / "public/assets/fonts/space-grotesk-latin.woff2"
BODY = ROOT / "public/assets/fonts/dm-sans-latin.woff2"
BG, INK, BLUE, MUTED = "#f5f6fb", "#252b3e", "#4452cc", "#5e667b"
THUMB_DISCLOSURE = "Actual hosted captures · template plan · no model call"
GIF_DISCLOSURE = "Edited template workflow · actual hosted UI · no model call"


def font(size: int, weight: int = 400, display: bool = False) -> ImageFont.FreeTypeFont:
    value = ImageFont.truetype(str(DISPLAY if display else BODY), size)
    value.set_variation_by_axes([weight])
    return value


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Canvas:
    """Shared geometry for editable SVG and Pillow composition of real crops."""

    def __init__(self, width: int, height: int):
        self.image = Image.new("RGB", (width, height), BG)
        self.draw = ImageDraw.Draw(self.image)
        self.width, self.height = width, height
        display_data = base64.b64encode(DISPLAY.read_bytes()).decode()
        body_data = base64.b64encode(BODY.read_bytes()).decode()
        self.parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
            '<title id="title">Briefstamp: the same brief, real proof</title>',
            '<desc id="desc">Actual hosted result excerpts. Broken sample: 2 passed, 3 failed, 0 blocked, 1 unverified. Manually restored and reapproved sample: 5 passed, 0 failed, 0 blocked, 1 unverified. Template plan; no model call.</desc>',
            '<!-- Embedded project fonts retain their existing OFL licenses under public/assets/fonts/. Text is editable. Screenshot pixels are original source excerpts. -->',
            f'<style>@font-face{{font-family:BriefstampDisplay;src:url(data:font/woff2;base64,{display_data}) format("woff2");font-weight:300 700}}@font-face{{font-family:BriefstampBody;src:url(data:font/woff2;base64,{body_data}) format("woff2");font-weight:100 1000}}</style>',
            f'<rect width="{width}" height="{height}" fill="{BG}"/>',
        ]

    def rect(self, x: int, y: int, width: int, height: int, fill: str, radius: int = 0, stroke: str | None = None):
        self.draw.rounded_rectangle((x, y, x + width, y + height), radius=radius, fill=fill, outline=stroke, width=1)
        self.parts.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{fill}"' + (f' stroke="{stroke}"' if stroke else '') + '/>')

    def text(self, x: int, y: int, value: str, size: int, weight: int = 400, color: str = INK, display: bool = False):
        chosen = font(size, weight, display)
        if x + chosen.getlength(value) > self.width - 20:
            raise ValueError(f"Text exceeds canvas: {value}")
        self.draw.text((x, y), value, font=chosen, fill=color, anchor="lt")
        family = "BriefstampDisplay" if display else "BriefstampBody"
        self.parts.append(f'<text x="{x}" y="{y}" dominant-baseline="text-before-edge" font-family="{family}, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{html.escape(value)}</text>')

    def line(self, points: list[tuple[int, int]], color: str, width: int):
        self.draw.line(points, fill=color, width=width, joint="curve")
        self.parts.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in points)}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>')

    def crop(self, filename: str, box: tuple[int, int, int, int], x: int, y: int, width: int, height: int):
        path = SOURCE / filename
        opened = Image.open(path)
        mime = Image.MIME[opened.format]
        original = opened.convert("RGB")
        self.image.paste(original.crop(box).resize((width, height), Image.Resampling.LANCZOS), (x, y))
        encoded = base64.b64encode(path.read_bytes()).decode()
        left, top, right, bottom = box
        self.parts.append(f'<svg x="{x}" y="{y}" width="{width}" height="{height}" viewBox="{left} {top} {right-left} {bottom-top}" preserveAspectRatio="none" overflow="hidden"><image x="0" y="0" width="1920" height="1205" xlink:href="data:{mime};base64,{encoded}"/></svg>')

    def svg(self) -> str:
        return "\n".join([*self.parts, "</svg>"]) + "\n"


def thumbnail() -> None:
    c = Canvas(1280, 720)
    c.rect(48, 40, 38, 42, BLUE, radius=6)
    c.line([(59, 53), (68, 53), (75, 60), (75, 72), (58, 72)], "#ffffff", 2)
    c.line([(59, 64), (63, 68), (69, 61)], "#ffffff", 2)
    c.text(102, 42, "Briefstamp.", 38, 700, display=True)
    c.text(1052, 52, "68s product demo", 20, 500, MUTED)
    c.text(48, 127, "Same brief. Real proof.", 70, 700, display=True)
    c.text(50, 222, "Break the sample. Restore it. Verify the change.", 29, 400, MUTED)
    for x, title, file, note in [
        (48, "Broken sample", "07-broken.png", "Three checks fail."),
        (684, "Restored sample", "10-restored.png", "Three checks recover."),
    ]:
        c.rect(x, 303, 548, 278, "#ffffff", radius=12, stroke="#d8dce8")
        c.text(x + 32, 332, title, 32, 600, display=True)
        c.crop(file, (1468, 404, 1768, 480), x + 34, 392, 480, 122)
        c.text(x + 32, 538, note, 24, 500, MUTED)
    c.line([(614, 445), (662, 445)], BLUE, 4)
    c.line([(648, 432), (662, 445), (648, 458)], BLUE, 4)
    c.text(48, 622, "Same checks. Manual restore. Explicit approval.", 27, 600, display=True)
    c.text(48, 676, THUMB_DISCLOSURE, 20, 400, MUTED)
    c.image.save(OUT / "thumbnail.png", optimize=True)
    (OUT / "thumbnail.svg").write_text(c.svg())


def gif_stage(index: int) -> Image.Image:
    c = Canvas(800, 450)
    c.text(28, 20, "Briefstamp.", 29, 700, display=True)
    c.text(696, 24, f"0{index + 1} / 03", 21, 500, MUTED)
    if index == 0:
        c.text(28, 82, "Approve the template plan.", 32, 700, display=True)
        c.text(28, 157, "Review first.", 30, 500, display=True)
        c.text(28, 201, "Then run the browser.", 30, 500, display=True)
        c.text(28, 289, "Synthetic sample website.", 21, 400, MUTED)
        c.text(28, 321, "Six checks, explicit approval.", 21, 400, MUTED)
        c.crop("03-approved.png", (1525, 647, 1781, 945), 516, 91, 256, 298)
    else:
        title = "Three failures. Real evidence." if index == 1 else "Restored, reviewed, rerun."
        subtitle = "Broken sample · same approved assertions" if index == 1 else "Three recoveries. One requirement still unverified."
        c.text(28, 82, title, 32, 700, display=True)
        c.text(28, 134, subtitle, 22, 400, MUTED)
        c.rect(64, 184, 672, 172, "#ffffff", radius=10, stroke="#d8dce8")
        filename = "07-broken.png" if index == 1 else "10-restored.png"
        c.crop(filename, (1468, 404, 1768, 480), 88, 194, 624, 158)
        note = "Observed browser results, with evidence." if index == 1 else "Manual sample restoration, not automatic repair."
        c.text(28, 373, note, 19, 500, MUTED)
    c.rect(0, 407, 800, 43, "#e8ebf6")
    c.text(28, 421, GIF_DISCLOSURE, 17, 500, "#3b4462")
    return c.image


def preview() -> None:
    stages = [gif_stage(i) for i in range(3)]
    palette_source = Image.new("RGB", (800, 1350))
    for i, frame in enumerate(stages):
        palette_source.paste(frame, (0, i * 450))
    palette = palette_source.quantize(colors=192, method=Image.Quantize.MEDIANCUT)
    frames, durations = [], []
    for i, hold in enumerate((2800, 2800, 3800)):
        frames.append(stages[i])
        durations.append(hold)
        if i < 2:
            for alpha in (0.25, 0.5, 0.75):
                frames.append(Image.blend(stages[i], stages[i + 1], alpha))
                durations.append(100)
    frames = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    frames[0].save(OUT / "briefstamp-preview.gif", save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=2)


def subtitles() -> None:
    captions = json.loads((OUT / "captions.json").read_text())
    lines = []
    for index, cue in enumerate(captions, 1):
        stamp = lambda sec: f"00:{sec // 60:02}:{sec % 60:02},000"
        lines.extend([str(index), f"{stamp(cue['start'])} --> {stamp(cue['end'])}", cue["title"], cue["caption"], ""])
    value = "\n".join(lines)
    (OUT / "briefstamp-demo.srt").write_text(value)
    vtt_lines = (OUT / "briefstamp-demo.vtt").read_text().splitlines()[2:]
    without_numbers = [line.replace(",000", ".000") if " --> " in line else line for line in value.splitlines() if not line.isdigit()]
    assert without_numbers == vtt_lines, "SRT must retain every VTT cue and timestamp."


def manifest() -> None:
    gif_path = OUT / "briefstamp-preview.gif"
    with Image.open(gif_path) as gif:
        duration = 0
        for index in range(gif.n_frames):
            gif.seek(index)
            duration += gif.info["duration"]
        gif_info = {"width": gif.width, "height": gif.height, "frames": gif.n_frames, "duration_ms": duration, "loop": gif.info.get("loop")}
    assert gif_info["duration_ms"] == 10000
    assert gif_path.stat().st_size < 5_000_000
    with Image.open(OUT / "thumbnail.png") as thumbnail_image:
        assert thumbnail_image.size == (1280, 720)
    def record(path: Path) -> dict:
        return {"path": str(path.relative_to(ROOT)), "sha256": digest(path), "bytes": path.stat().st_size}
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size", "-of", "json", str(gif_path)]))
    result = {
        "product": "Briefstamp", "status": "Prepared locally. No YouTube upload performed.",
        "youtube_url_placeholder": "{{YOUTUBE_URL}}", "capture_ui": "Codex in-app browser through CUA",
        "hosted_service": "https://flowproof-demo.onrender.com/", "capture_source_commit": "816d869ed7851b471b0ff83b103903ef2f069eae",
        "inputs": [record(OUT / "briefstamp-demo.mp4"), record(OUT / "captions.json"), record(OUT / "briefstamp-demo.vtt"), *[record(SOURCE / n) for n in ("03-approved.png", "07-broken.png", "10-restored.png")]],
        "assets": [record(OUT / name) for name in ("YOUTUBE.md", "briefstamp-demo.srt", "thumbnail.png", "thumbnail.svg", "briefstamp-preview.gif")],
        "thumbnail": {"width": 1280, "height": 720, "editable": "thumbnail.svg contains editable text, embedded brand fonts and the original embedded source screenshots, clipped to their result metrics. PNG uses the same geometry and fonts via Pillow.", "source_crop": [1468, 404, 1768, 480], "source_encoding": "The original capture filenames end in .png, but their byte encoding is JPEG. SVG uses the detected image/jpeg MIME without re-encoding their bytes."},
        "gif": gif_info, "gif_ffprobe": probe,
        "captions": {"cue_count": 11, "last_end_seconds": 68, "verification": "Every SRT cue text and timing equals the existing VTT after numbering and punctuation-format conversion."},
        "observed_results": {"broken": {"passed": 2, "failed": 3, "blocked": 0, "unverified": 1}, "restored": {"passed": 5, "failed": 0, "blocked": 0, "unverified": 1}},
        "provenance": "Real hosted screenshots; synthetic sample; unchanged template assertions; manual restoration and fresh approval; no model call. Preview timing and fades are editorial, not latency evidence.",
        "fonts": [record(DISPLAY), record(BODY)], "reproduction_script": record(Path(__file__).resolve()),
    }
    (OUT / "upload-assets-manifest.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"gif": gif_info, "gif_bytes": gif_path.stat().st_size, "thumbnail_bytes": (OUT / "thumbnail.png").stat().st_size, "svg_bytes": (OUT / "thumbnail.svg").stat().st_size}))


if __name__ == "__main__":
    thumbnail()
    preview()
    subtitles()
    manifest()
