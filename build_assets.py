"""Bake paired ink albedo and actor-space normals for Formation Studio.

Development helper only: the generated textures and JSON are standalone.
Pillow, NumPy and the canonical Sprite Studio pike helper are used at build time.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "sprite-studio" / "vendor"))
from PIL import Image, ImageChops, ImageDraw
import numpy as np

DEFAULT_NODE = Path("C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe")
SS = 4
GUTTER = 2


def geometry(records, node):
    helper = ROOT / "tools/blender/pikeman_preview_geometry.mjs"
    result = subprocess.run([str(node), str(helper)], input=json.dumps(records),
                            text=True, capture_output=True, check=True)
    return {entry["key"]: entry["polygons"] for entry in json.loads(result.stdout)}


def resized_normal(image, size):
    """Filter vector-times-coverage, then renormalize; never filter encoded RGB.

    Transparent pixels have arbitrary RGB. Filtering them directly tilts normals
    and creates a dark fringe. Mesh coverage is kept independently of ink alpha.
    """
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255
    alpha = rgba[:, :, 3]
    vector = rgba[:, :, :3] * 2 - 1
    lengths = np.linalg.norm(vector, axis=2, keepdims=True)
    vector /= np.maximum(lengths, 1e-8)
    weighted = vector * alpha[:, :, None]
    def sample(channel):
        return np.asarray(Image.fromarray(channel.astype(np.float32)).resize(size, Image.Resampling.LANCZOS), dtype=np.float32)
    coverage = np.clip(sample(alpha), 0, 1)
    filtered = np.stack([sample(weighted[:, :, i]) for i in range(3)], axis=2)
    lengths = np.linalg.norm(filtered, axis=2, keepdims=True)
    valid = (coverage > 0.5 / 255) & (lengths[:, :, 0] > 1e-7)
    vectors = filtered / np.maximum(lengths, 1e-8)
    vectors[~valid] = (0, 0, 1)
    coverage[~valid] = 0
    # GPU bilinear filtering still samples RGB where alpha is zero. Extend the
    # neighbouring vector into four transparent texels without adding coverage.
    # This is normal-data padding, not a larger opaque sprite silhouette.
    reached = valid.copy()
    for _ in range(4):
        vector_sum = np.zeros_like(vectors)
        count = np.zeros_like(coverage)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted_mask = np.roll(reached, (dy, dx), axis=(0, 1))
            shifted = np.roll(vectors, (dy, dx), axis=(0, 1))
            if dy < 0:
                shifted_mask[-1] = False
            elif dy > 0:
                shifted_mask[0] = False
            elif dx < 0:
                shifted_mask[:, -1] = False
            else:
                shifted_mask[:, 0] = False
            vector_sum += shifted * shifted_mask[:, :, None]
            count += shifted_mask
        extend = (~reached) & (count > 0)
        lengths = np.linalg.norm(vector_sum, axis=2, keepdims=True)
        vectors[extend] = (vector_sum / np.maximum(lengths, 1e-8))[extend]
        reached |= extend
    result = np.empty((*coverage.shape, 4), dtype=np.uint8)
    result[:, :, :3] = np.rint(np.clip((vectors + 1) * 127.5, 0, 255)).astype(np.uint8)
    result[:, :, 3] = np.rint(coverage * 255).astype(np.uint8)
    return Image.fromarray(result)


def scale_pike(pike, scale):
    if pike is None:
        return None
    pike = copy.deepcopy(pike)
    for key in ("width", "stroke_width", "head_length", "head_width", "head_stroke_width"):
        if key in pike:
            pike[key] *= scale
    for key in ("tip", "butt", "grip"):
        if key in pike:
            pike[key] = [value * scale for value in pike[key]]
    for operation in pike.get("operations", []):
        operation["width"] *= scale
        operation["points"] = [[value * scale for value in point] for point in operation.get("points", [])]
    return pike


def weapon_strip(pike, polygons):
    """Paint into a shaft-aligned strip, preserving ordered silhouette masks."""
    if not polygons:
        return None, None
    tip, butt = pike["tip"], pike["butt"]
    length = math.hypot(butt[0] - tip[0], butt[1] - tip[1])
    v = [(butt[0] - tip[0]) / length, (butt[1] - tip[1]) / length]
    u = [v[1], -v[0]]
    def project(point):
        return [sum(point[i] * u[i] for i in range(2)), sum(point[i] * v[i] for i in range(2))]
    points = [project(p) for polygon in polygons for p in polygon["points"]]
    left = min(p[0] for p in points) - 2
    top = min(p[1] for p in points) - 2
    width = math.ceil(max(p[0] for p in points) + 2 - left)
    height = math.ceil(max(p[1] for p in points) + 2 - top)
    layer = Image.new("RGBA", (width * SS, height * SS))
    silhouette = Image.new("L", layer.size)
    draw, maskdraw = ImageDraw.Draw(layer), ImageDraw.Draw(silhouette)
    def xy(point):
        x, y = project(point)
        return ((x - left) * SS, (y - top) * SS)
    for polygon in polygons:
        poly = [xy(p) for p in polygon["points"]]
        draw.polygon(poly, fill=polygon["color"])
        maskdraw.polygon(poly, fill=255)
    for operation in pike.get("operations", []):
        if not operation.get("points"):
            continue
        stroke = Image.new("L", layer.size)
        strokes = ImageDraw.Draw(stroke)
        pts = [xy(p) for p in operation["points"]]
        stroke_width = max(1, round(operation["width"] * SS))
        if len(pts) > 1:
            strokes.line(pts, fill=255, width=stroke_width, joint="curve")
        radius = stroke_width / 2
        for x, y in pts:
            strokes.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
        clipped = ImageChops.multiply(stroke, silhouette)
        if operation["tool"] == "erase":
            layer.putalpha(ImageChops.multiply(layer.getchannel("A"), ImageChops.invert(clipped)))
        else:
            paint = Image.new("RGBA", layer.size, operation["color"])
            paint.putalpha(clipped)
            layer = Image.alpha_composite(layer, paint)
    layer = layer.resize((width, height), Image.Resampling.LANCZOS)
    def inverse(x, y):
        return [(left + x) * u[i] + (top + y) * v[i] for i in range(2)]
    return layer, [inverse(0, 0), inverse(width, 0), inverse(width, height), inverse(0, height)]


def pack(images, width=1024):
    """Deterministic shelf atlas; the same placements are reused for normals."""
    x = y = rowheight = 0
    placements = []
    for image in images:
        w, h = image.size
        if w + 2 * GUTTER > width:
            raise ValueError("Texture item is too wide")
        if x + w + 2 * GUTTER > width:
            x = 0
            y += rowheight
            rowheight = 0
        placements.append([x + GUTTER, y + GUTTER, w, h])
        x += w + 2 * GUTTER
        rowheight = max(rowheight, h + 2 * GUTTER)
    usedheight = y + rowheight
    height = 2 ** math.ceil(math.log2(max(1, usedheight)))
    if height > 4096:
        return pack(images, width * 2)
    canvas = Image.new("RGBA", (width, height))
    for image, rect in zip(images, placements):
        canvas.paste(image, (rect[0], rect[1]))
    return canvas, placements


def aligned_atlas(images, placements, size):
    canvas = Image.new("RGBA", size)
    for image, (x, y, w, h) in zip(images, placements):
        if image.size != (w, h):
            raise ValueError("Normal and albedo crop dimensions differ")
        canvas.paste(image, (x, y))
    return canvas


def inverse_strip(image, corners, bounds):
    c0, c1, _, c3 = corners
    ux = (c1[0] - c0[0]) / image.width
    uy = (c1[1] - c0[1]) / image.width
    vx = (c3[0] - c0[0]) / image.height
    vy = (c3[1] - c0[1]) / image.height
    c = (bounds[0] - c0[0]) * ux + (bounds[1] - c0[1]) * uy
    f = (bounds[0] - c0[0]) * vx + (bounds[1] - c0[1]) * vy
    return image.transform((bounds[2] - bounds[0], bounds[3] - bounds[1]), Image.Transform.AFFINE,
                           (ux, uy, c, vx, vy, f), Image.Resampling.BICUBIC)


def shade_body(body, normal, light, lighting):
    """CPU visual evidence uses the same hard ink-shadow rule as the renderer."""
    rgba = np.asarray(body, dtype=np.float32) / 255
    nr = np.asarray(normal, dtype=np.float32) / 255
    vectors = nr[:, :, :3] * 2 - 1
    vectors /= np.maximum(np.linalg.norm(vectors, axis=2, keepdims=True), 1e-8)
    dot = np.sum(vectors * np.asarray(light, dtype=np.float32), axis=2)
    # Normal coverage is allowed to differ from opaque GP contour coverage.
    brightness = np.clip(0.5 + 0.5 * dot, 0, 1)
    strength = (brightness < lighting["threshold"]).astype(np.float32) * lighting["strength"] * nr[:, :, 3]
    ink = np.asarray([int(lighting["inkColor"][i:i+2], 16)/255 for i in (1, 3, 5)])
    rgba[:, :, :3] = rgba[:, :, :3] * (1 - strength[:, :, None]) + ink * strength[:, :, None]
    return Image.fromarray(np.rint(np.clip(rgba, 0, 1) * 255).astype(np.uint8))


def preview(entries, out, lighting):
    wanted = [next(e for e in entries if e["clip"] == "walk" and e["direction"] == i and e["index"] == 0) for i in (0, 4, 8, 12)]
    bounds = [-72, -210, 72, 20]
    cw, ch = bounds[2] - bounds[0], bounds[3] - bounds[1]
    def sheet(kind, light=None):
        canvas = Image.new("RGBA", ((cw + 12) * len(wanted) + 12, ch + 38), "#e6dfcd")
        draw = ImageDraw.Draw(canvas)
        for n, entry in enumerate(wanted):
            frame = entry["output"]
            pivot = frame["body"]["pivot"]
            body = entry[kind]
            if light is not None:
                body = shade_body(entry["body"], entry["normal"], light, lighting)
            cell = Image.new("RGBA", (cw, ch))
            cell.alpha_composite(body, (round(-pivot[0] - bounds[0]), round(-pivot[1] - bounds[1])))
            if kind == "body" and entry["pike"]:
                corners = [[p[0] - pivot[0], p[1] - pivot[1]] for p in frame["pike"]["corners"]]
                cell = Image.alpha_composite(cell, inverse_strip(entry["pike"], corners, bounds))
            x = 12 + n * (cw + 12)
            canvas.alpha_composite(cell, (x, 10))
            draw.text((x + 30, ch + 16), f'Retning {n * 4 + 1}', fill="#322a22")
        return canvas
    sheet("body").convert("RGB").resize((1272, 536), Image.Resampling.NEAREST).save(out / "preview.png")
    sheet("normal").convert("RGB").resize((1272, 536), Image.Resampling.NEAREST).save(out / "normal_preview.png")
    elevation = math.radians(lighting["elevation"])
    lights = [(math.cos(elevation), 0, math.sin(elevation)), (-math.cos(elevation), 0, math.sin(elevation))]
    rows = [sheet("body", light).convert("RGB") for light in lights]
    proof = Image.new("RGB", (rows[0].width, rows[0].height * 2 + 24), "#e6dfcd")
    for i, row in enumerate(rows):
        proof.paste(row, (0, i * (row.height + 24)))
    ImageDraw.Draw(proof).text((12, rows[0].height + 6), "Samme billeder, lys fra modsatte sider", fill="#322a22")
    proof.resize((proof.width * 2, proof.height * 2), Image.Resampling.NEAREST).save(out / "lighting_preview.png")


def read_source(source, size):
    manifest = source / "sprites.json"
    metadata = json.loads(manifest.read_text(encoding="utf-8"))
    if metadata.get("normal_space") != "actor-blender-world" or metadata.get("normal_encoding") != "RGB8-linear-signed":
        raise ValueError("Expected linear encoded actor-Blender-world normals")
    records = []
    entries = []
    durations = {}
    source_hashes = {"sprites.json": hashlib.sha256(manifest.read_bytes()).hexdigest()}
    for clip in metadata["clips"]:
        clipname = clip["name"]
        durations[clipname] = clip["duration_seconds"]
        for direction in sorted(clip["directions"], key=lambda d: d["index"]):
            for frame in direction["frames"]:
                with Image.open(source / frame["albedo"]) as image:
                    body = image.convert("RGBA")
                with Image.open(source / frame["normal"]) as image:
                    normal = image.convert("RGBA")
                if body.size != normal.size or body.width != body.height:
                    raise ValueError("Paired source tiles must have matching square dimensions")
                scale = size / body.width
                source_frame = copy.deepcopy(frame)
                pike = scale_pike(frame.get("attachments", {}).get("pike"), scale)
                source_frame.setdefault("attachments", {})["pike"] = pike
                source_frame["pivot_pixels"] = [p * scale for p in frame["pivot_pixels"]]
                body = body.resize((size, size), Image.Resampling.LANCZOS)
                normal = resized_normal(normal, (size, size))
                bbox = body.getchannel("A").getbbox()
                if bbox is None:
                    raise ValueError("An exported albedo body is empty")
                crop = [max(0, bbox[0] - 2), max(0, bbox[1] - 2), min(size, bbox[2] + 2), min(size, bbox[3] + 2)]
                pivot = [source_frame["pivot_pixels"][0] - crop[0], source_frame["pivot_pixels"][1] - crop[1]]
                key = f'{clipname}/{direction["index"]}/{frame["index"]}'
                output = {"body": {"pivot": pivot}}
                entries.append({"key": key, "clip": clipname, "direction": direction["index"], "index": frame["index"],
                                "source": source_frame, "body": body.crop(crop), "normal": normal.crop(crop), "crop": crop, "output": output})
                records.append({"key": key, "pike": pike})
    return metadata, entries, records, durations, source_hashes


def backup_existing(out):
    """Retain the complete previous character before replacing runtime assets."""
    character = out / "character.json"
    if not character.exists():
        return None
    previous = json.loads(character.read_text(encoding="utf-8"))
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = out / "versions" / ("ink-baked-v1_" + stamp if previous["schema"].endswith("v1") else "relightable-v2_" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    for name in ("character.json", "body.png", "normals.png", "pikes.png", "preview.png", "normal_preview.png", "lighting_preview.png", "build_report.json", "README.md"):
        if (out / name).is_file():
            shutil.copy2(out / name, backup / name)
    return backup


def validate(document, bodyatlas, normalatlas, pikeatlas, entries):
    assert bodyatlas.size == normalatlas.size
    assert all(v <= 4096 for image in (bodyatlas, normalatlas, pikeatlas) for v in image.size)
    checked = 0
    ink_only = 0
    for name, clip in document["clips"].items():
        assert len(clip["directions"]) == 16
        assert all(len(direction) == (12 if name == "walk" else 15) for direction in clip["directions"])
        for direction in clip["directions"]:
            for frame in direction:
                for kind, atlas in (("body", bodyatlas), ("pike", pikeatlas)):
                    x, y, w, h = frame[kind]["rect"]
                    assert 0 <= x < x + w <= atlas.width and 0 <= y < y + h <= atlas.height
                    assert atlas.crop((x, y, x + w, y + h)).getchannel("A").getbbox()
                corners = frame["pike"]["corners"]
                w, h = frame["pike"]["rect"][2:]
                assert math.isclose(math.dist(corners[0], corners[1]), w, rel_tol=1e-7)
                assert math.isclose(math.dist(corners[0], corners[3]), h, rel_tol=1e-7)
                u = [corners[1][i] - corners[0][i] for i in range(2)]
                v = [corners[3][i] - corners[0][i] for i in range(2)]
                assert abs(sum(u[i] * v[i] for i in range(2))) < 1e-5
                checked += 1
    for entry in entries:
        x, y, w, h = entry["output"]["body"]["rect"]
        assert bodyatlas.crop((x, y, x + w, y + h)).tobytes() == entry["body"].tobytes()
        assert normalatlas.crop((x, y, x + w, y + h)).tobytes() == entry["normal"].tobytes()
        rgba = np.asarray(entry["normal"])
        covered = rgba[:, :, 3] > 2
        lengths = np.linalg.norm(rgba[:, :, :3].astype(np.float32) / 127.5 - 1, axis=2)
        assert np.all(np.abs(lengths[covered] - 1) < 0.008)
        ink_only += int(np.sum((np.asarray(entry["body"])[:, :, 3] > 127) & (rgba[:, :, 3] == 0)))
    return {"pairedFrameAlignment": checked, "unitNormalErrorMax": 0.008, "preservedInkOnlyPixels": ink_only}


def self_test():
    # A transparent black neighbourhood must not tilt a covered +X normal.
    rgba = np.zeros((32, 32, 4), dtype=np.uint8)
    rgba[8:24, 8:24] = [255, 128, 128, 255]
    result = np.asarray(resized_normal(Image.fromarray(rgba), (11, 11)))
    covered = result[:, :, 3] > 2
    vectors = result[:, :, :3].astype(np.float32) / 127.5 - 1
    assert np.all(vectors[:, :, 0][covered] > 0.999)
    assert np.all(np.abs(vectors[:, :, 1:][covered]) < 0.005)
    assert np.any((result[:, :, 3] == 0) & (vectors[:, :, 0] > 0.999))
    # Crops are selected from albedo, including contour pixels absent in normals.
    a = Image.new("RGBA", (20, 20))
    ImageDraw.Draw(a).rectangle((2, 3, 17, 16), fill="#000000")
    n = Image.new("RGBA", (20, 20))
    ImageDraw.Draw(n).rectangle((5, 6, 14, 13), fill=(128, 128, 255, 255))
    crops = [a.crop((1, 2, 19, 18)), n.crop((1, 2, 19, 18))]
    atlas, placement = pack([crops[0]])
    normals = aligned_atlas([crops[1]], placement, atlas.size)
    x, y, w, h = placement[0]
    assert normals.crop((x, y, x + w, y + h)).tobytes() == crops[1].tobytes()
    assert atlas.crop((x, y, x + w, y + h)).tobytes() == crops[0].tobytes()
    # Ordered pike operations and physical dimensions are scaled exactly once.
    pike = {"tip": [10, -100], "butt": [12, 90], "grip": [11, 45], "width": 4, "operations": [{"width": 3, "points": [[11, 45]]}]}
    scaled = scale_pike(pike, 100 / 256)
    assert scaled["width"] == 1.5625 and scaled["operations"][0]["width"] == 1.171875
    assert pike["width"] == 4
    print("3 asset checks passed: coverage-aware normals, shared atlas alignment, pike scaling")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Folder containing the paired sprites.json")
    parser.add_argument("--node", type=Path, default=DEFAULT_NODE)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "assets")
    parser.add_argument("--size", type=int, default=100)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.source is None:
        sources = sorted((ROOT / "assets/musketeer/sprite_exports").glob("Pikener_normals_*/sprites.json"))
        if not sources:
            parser.error("No paired normal export found; specify --source")
        args.source = sources[-1].parent
    metadata, entries, records, durations, source_hashes = read_source(args.source, args.size)
    polygons = geometry(records, args.node)
    for entry in entries:
        pike = entry["source"].get("attachments", {}).get("pike")
        strip, corners = weapon_strip(pike, polygons[entry["key"]])
        entry["pike"] = strip
        if strip:
            entry["output"]["pike"] = {"corners": [[p[0] - entry["crop"][0], p[1] - entry["crop"][1]] for p in corners], "layer": pike.get("layer", "front")}
    bodyatlas, bodyrects = pack([e["body"] for e in entries])
    normalatlas = aligned_atlas([e["normal"] for e in entries], bodyrects, bodyatlas.size)
    pikentries = [e for e in entries if e["pike"]]
    pikeatlas, pikerects = pack([e["pike"] for e in pikentries])
    for entry, rect in zip(entries, bodyrects):
        entry["output"]["body"]["rect"] = rect
    for entry, rect in zip(pikentries, pikerects):
        entry["output"]["pike"]["rect"] = rect
    ink = metadata.get("ink_style", {})
    lighting = {"inkColor": ink.get("ink_srgb", "#000000"), "strength": ink.get("shadow_strength", 1), "threshold": ink.get("shadow_threshold", 0.5), "softness": 0,
                "azimuth": ink.get("shadow_azimuth_degrees", -45) % 360, "elevation": ink.get("shadow_elevation_degrees", 55)}
    document = {"schema": "walking-fortress-formation-character-v2", "pixelsPerUnit": args.size / metadata["ortho_scale"],
                "firstAzimuth": metadata["first_azimuth_degrees"], "azimuthStep": metadata["azimuth_step_degrees"], "elevation": metadata["elevation_degrees"],
                "bodyAtlas": "body.png", "normalAtlas": "normals.png", "pikeAtlas": "pikes.png", "bodyAtlasSize": list(bodyatlas.size),
                "normalAtlasSize": list(normalatlas.size), "pikeAtlasSize": list(pikeatlas.size), "normalSpace": "actor-blender-world", "normalEncoding": "RGB8-linear-signed",
                "lighting": lighting, "clips": {name: {"duration": duration, "directions": [[] for _ in range(16)]} for name, duration in durations.items()}}
    for entry in entries:
        document["clips"][entry["clip"]]["directions"][entry["direction"]].append(entry["output"])
    checks = validate(document, bodyatlas, normalatlas, pikeatlas, entries)
    args.out.mkdir(parents=True, exist_ok=True)
    backup = backup_existing(args.out)
    bodyatlas.save(args.out / "body.png", optimize=True)
    normalatlas.save(args.out / "normals.png", optimize=True)
    pikeatlas.save(args.out / "pikes.png", optimize=True)
    (args.out / "character.json").write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    report = {"frames": len(entries), "sourceFolder": str(args.source), "sourceSHA256": metadata.get("source_sha256"), "sourceManifestsSHA256": source_hashes,
              "bodyAtlasSize": list(bodyatlas.size), "normalAtlasSize": list(normalatlas.size), "pikeAtlasSize": list(pikeatlas.size),
              "normalSpace": document["normalSpace"], "normalEncoding": document["normalEncoding"], "normalResampling": "coverage-weighted linear vectors, renormalized after filter, 4px transparent RGB dilation",
              "bodyTexelArea": sum(e["body"].width * e["body"].height for e in entries), "pikeTexelArea": sum(e["pike"].width * e["pike"].height for e in pikentries),
              "orderedOwnerMaskOperations": sum(len(e["source"].get("attachments", {}).get("pike", {}).get("operations", [])) for e in entries),
              "geometrySource": "sprite-studio/web/pike.mjs:pikeGeometry", "previousAssetsBackup": str(backup) if backup else None, "checks": checks}
    preview(entries, args.out, lighting)
    (args.out / "build_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
