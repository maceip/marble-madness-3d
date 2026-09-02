#!/usr/bin/env python3
"""Normalize the already-cropped arcade sheets into runtime-safe sprites."""

from pathlib import Path
import json

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "www" / "sprites"
FONT_OUT = SPRITES / "retro-font"
MARBLE_OUT = SPRITES / "retro-marble"


def extract_font() -> list[dict[str, object]]:
    FONT_OUT.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, object]] = []
    # The clean fixed-cell block in the source sheet is ASCII $ (36)
    # through _ (95), stored sequentially as glyph components 488..547.
    for codepoint in range(36, 96):
        component = 488 + codepoint - 36
        source = SPRITES / "font" / f"glyph_{component:03d}_8x8.png"
        if not source.exists():
            raise RuntimeError(f"missing bitmap-font component: {source}")
        image = Image.open(source).convert("RGBA")
        pixels = []
        for red, green, blue, _alpha in image.get_flattened_data():
            if blue > 180 and red < 80 and green < 80:
                pixels.append((240, 246, 255, 255))
            else:
                pixels.append((0, 0, 0, 0))
        image.putdata(pixels)
        target = FONT_OUT / f"char-{codepoint:03d}.png"
        image.save(target, optimize=True)
        entries.append({"character": chr(codepoint), "codepoint": codepoint, "file": target.relative_to(ROOT).as_posix()})
    return entries


def extract_marbles() -> list[dict[str, object]]:
    MARBLE_OUT.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, object]] = []
    matte = (49, 202, 49)
    for color in ("blue", "red"):
        sources = sorted(SPRITES.glob(f"marble_{color}_[0-9][0-9]_*.png"))
        if len(sources) != 56:
            raise RuntimeError(f"expected 56 {color} marble frames, found {len(sources)}")
        for source in sources:
            frame = int(source.name.split("_")[2])
            image = Image.open(source).convert("RGBA")
            pixels = []
            for red, green, blue, alpha in image.get_flattened_data():
                distance = abs(red - matte[0]) + abs(green - matte[1]) + abs(blue - matte[2])
                pixels.append((red, green, blue, 0 if distance <= 12 else alpha))
            image.putdata(pixels)
            target = MARBLE_OUT / f"{color}-{frame:02d}.png"
            image.save(target, optimize=True)
            entries.append({"color": color, "frame": frame, "file": target.relative_to(ROOT).as_posix()})
    return entries


def validate_objects() -> int:
    objects = sorted((SPRITES / "enemies").glob("enemy_*.png"))
    if len(objects) != 96:
        raise RuntimeError(f"expected 96 extracted object sprites, found {len(objects)}")
    for source in objects:
        image = Image.open(source).convert("RGBA")
        if not any(alpha == 0 for *_rgb, alpha in image.get_flattened_data()):
            raise RuntimeError(f"object sprite has no transparent pixels: {source}")
    return len(objects)


def main() -> None:
    font = extract_font()
    marbles = extract_marbles()
    object_count = validate_objects()
    manifest = {
        "source": "Master System Marble Madness sprite sheets",
        "font": font,
        "marbles": marbles,
        "objectSpritesValidated": object_count,
    }
    target = SPRITES / "retro-runtime-manifest.json"
    target.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"retro assets: {len(font)} glyphs, {len(marbles)} marble frames, {object_count} object sprites")


if __name__ == "__main__":
    main()
