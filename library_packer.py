"""Pack any number of rendered animation pairs into bounded, matched atlas pages.

Each frame selects one page for its body, normal and optional pike. The former
single-atlas fields remain aliases of page zero for older tools.
"""
from __future__ import annotations
import argparse
import copy
import json
import math
import subprocess
from pathlib import Path

# Load image extensions from the selected Python before legacy vendor paths.
import numpy as np
from PIL import Image
import build_assets as assets


class Shelf:
    def __init__(self, side):
        self.side = side
        self.x = self.y = self.row = 0

    def adding(self, image):
        if image is None:
            return self.x, self.y, self.row
        width, height = image.size
        width += 2 * assets.GUTTER
        height += 2 * assets.GUTTER
        x, y, row = self.x, self.y, self.row
        if width > self.side or height > self.side:
            raise ValueError("Et enkelt spritefelt er større end en billedside; vælg en mindre billedstørrelse.")
        if x + width > self.side:
            x, y, row = 0, y + row, 0
        if y + height > self.side:
            return None
        return x + width, y, max(row, height)


def page_groups(entries, side=4096):
    """Partition once, keeping corresponding body/normal/pike on the same page."""
    groups, group = [], []
    body, pike = Shelf(side), Shelf(side)
    for entry in entries:
        proposed_body, proposed_pike = body.adding(entry["body"]), pike.adding(entry.get("pike"))
        if proposed_body is None or proposed_pike is None:
            if not group:
                raise ValueError("Et spritefelt passer ikke i billedsiden.")
            groups.append(group)
            group = []
            body, pike = Shelf(side), Shelf(side)
            proposed_body, proposed_pike = body.adding(entry["body"]), pike.adding(entry.get("pike"))
        body.x, body.y, body.row = proposed_body
        pike.x, pike.y, pike.row = proposed_pike
        group.append(entry)
    if group:
        groups.append(group)
    return groups


def validate_page(group, body, normal, pike):
    if body.size != normal.size:
        raise ValueError("Krops- og normalkortets billedsider har forskellige mål.")
    counts = {"pairedFrameAlignment": 0, "checkedPikeFrames": 0, "preservedInkOnlyPixels": 0}
    for entry in group:
        frame = entry["output"]
        x, y, w, h = frame["body"]["rect"]
        bounds = x, y, x + w, y + h
        if body.crop(bounds).tobytes() != entry["body"].tobytes() or normal.crop(bounds).tobytes() != entry["normal"].tobytes():
            raise ValueError("Et spritepar mistede sin fælles placering i billedsiden.")
        if not (0 <= x < x + w <= body.width and 0 <= y < y + h <= body.height):
            raise ValueError("Et kropsfelt ligger uden for billedsiden.")
        pixels = np.asarray(entry["normal"])
        coverage = pixels[:, :, 3] > 2
        lengths = np.linalg.norm(pixels[:, :, :3].astype(np.float32) / 127.5 - 1, axis=2)
        if np.any(np.abs(lengths[coverage] - 1) >= .008):
            raise ValueError("Normalkortet indeholder ikke normaliserede normaler.")
        counts["pairedFrameAlignment"] += 1
        counts["preservedInkOnlyPixels"] += int(np.sum((np.asarray(entry["body"])[:, :, 3] > 127) & (pixels[:, :, 3] == 0)))
        if "pike" in frame:
            x, y, w, h = frame["pike"]["rect"]
            if pike is None or not (0 <= x < x + w <= pike.width and 0 <= y < y + h <= pike.height):
                raise ValueError("Et pikefelt ligger uden for sin billedside.")
            if pike.crop((x, y, x + w, y + h)).tobytes() != entry["pike"].tobytes():
                raise ValueError("Et pikefelt blev ændret under pakning.")
            corners = frame["pike"]["corners"]
            if not math.isclose(math.dist(corners[0], corners[1]), w, rel_tol=1e-7) or not math.isclose(math.dist(corners[0], corners[3]), h, rel_tol=1e-7):
                raise ValueError("Pikens hjørner matcher ikke dens billedfelt.")
            counts["checkedPikeFrames"] += 1
    return counts


def build(source, out, size=100, character_id=None, label=None, node=assets.DEFAULT_NODE, page_size=4096):
    source, out = Path(source).resolve(), Path(out).resolve()
    if (out / "character.json").exists():
        raise ValueError("Bibliotekspakken findes allerede. Brug en ny revisionsmappe.")
    metadata, entries, records, clips, source_hashes = assets.read_source(source, size)
    # Preserve full clip semantics in the library, including non-marching actions.
    for original in metadata["clips"]:
        for key in ("loop", "source_start", "source_end", "source_fps", "source_blend", "sourceAction"):
            if key in original:
                clips[original["name"]][key] = copy.deepcopy(original[key])
    weapons = [record for record in records if record.get("pike")]
    if weapons:
        helper = Path(__file__).resolve().parent / "tools/library_support/pike_geometry.mjs"
        result = subprocess.run([str(node), str(helper)], input=json.dumps(weapons), text=True, capture_output=True, check=True)
        polygons = {entry["key"]: entry["polygons"] for entry in json.loads(result.stdout)}
    else:
        polygons = {}
    for entry in entries:
        attachment = entry["source"].get("attachments", {}).get("pike")
        strip, corners = assets.weapon_strip(attachment, polygons.get(entry["key"], []))
        entry["pike"] = strip
        if strip is not None:
            entry["output"]["pike"] = {
                "corners": [[point[0] - entry["crop"][0], point[1] - entry["crop"][1]] for point in corners],
                "layer": attachment.get("layer", "front"),
            }
    out.mkdir(parents=True, exist_ok=True)
    pages, checks = [], {"pairedFrameAlignment": 0, "checkedPikeFrames": 0, "preservedInkOnlyPixels": 0}
    for index, group in enumerate(page_groups(entries, page_size)):
        body, placements = assets.pack([entry["body"] for entry in group], width=min(1024, page_size))
        normal = assets.aligned_atlas([entry["normal"] for entry in group], placements, body.size)
        pike_entries = [entry for entry in group if entry["pike"] is not None]
        pike, pike_placements = assets.pack([entry["pike"] for entry in pike_entries], width=min(1024, page_size)) if pike_entries else (None, [])
        for entry, rect in zip(group, placements):
            entry["output"]["page"] = index
            entry["output"]["body"]["rect"] = rect
        for entry, rect in zip(pike_entries, pike_placements):
            entry["output"]["pike"]["rect"] = rect
        page_check = validate_page(group, body, normal, pike)
        for key, value in page_check.items():
            checks[key] += value
        suffix = "" if index == 0 else f"-{index:03d}"
        descriptor = {"bodyAtlas": f"body{suffix}.png", "normalAtlas": f"normals{suffix}.png",
                      "pikeAtlas": f"pikes{suffix}.png" if pike else None,
                      "bodyAtlasSize": list(body.size), "normalAtlasSize": list(normal.size),
                      "pikeAtlasSize": list(pike.size) if pike else None}
        body.save(out / descriptor["bodyAtlas"], optimize=True)
        normal.save(out / descriptor["normalAtlas"], optimize=True)
        if pike:
            pike.save(out / descriptor["pikeAtlas"], optimize=True)
        pages.append(descriptor)
    ink = metadata.get("ink_style", {})
    lighting = {"inkColor": ink.get("ink_srgb", "#000000"), "strength": ink.get("shadow_strength", 1),
                "threshold": ink.get("shadow_threshold", .5), "softness": 0,
                "azimuth": ink.get("shadow_azimuth_degrees", -45) % 360,
                "elevation": ink.get("shadow_elevation_degrees", 55)}
    document = {"schema": "walking-fortress-formation-character-v2", "pixelsPerUnit": size / metadata["ortho_scale"],
                "firstAzimuth": metadata["first_azimuth_degrees"], "azimuthStep": metadata["azimuth_step_degrees"],
                "elevation": metadata["elevation_degrees"], "normalSpace": "actor-blender-world",
                "normalEncoding": "RGB8-linear-signed", "directionCount": len(next(iter(clips.values()))["directions"]),
                "lighting": lighting, "clips": clips, "pages": pages, **pages[0]}
    if character_id:
        document["id"] = character_id
    if label:
        document["label"] = label
    for entry in entries:
        clips[entry["clip"]]["directions"][entry["direction"]].append(entry["output"])
    assets.preview(entries, out, lighting, clips)
    report = {"frames": len(entries), "sourceFolder": str(source), "sourceSHA256": metadata.get("source_sha256"),
              "sourceManifestsSHA256": source_hashes, "pageCount": len(pages), "pages": pages,
              "clips": {name: {key: value for key, value in clip.items() if key != "directions"} for name, clip in clips.items()},
              "bodyTexelArea": sum(entry["body"].width * entry["body"].height for entry in entries),
              "pikeTexelArea": sum(entry["pike"].width * entry["pike"].height for entry in entries if entry["pike"] is not None),
              "normalSpace": document["normalSpace"], "normalEncoding": document["normalEncoding"],
              "checks": {**checks, "unitNormalErrorMax": .008}}
    (out / "build_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary = out / "character.json.tmp"
    temporary.write_text(json.dumps(document, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(out / "character.json")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, default=100)
    parser.add_argument("--id", "--character-id", dest="character_id")
    parser.add_argument("--label")
    parser.add_argument("--node", type=Path, default=assets.DEFAULT_NODE)
    parser.add_argument("--page-size", type=int, default=4096, choices=(64, 128, 256, 512, 1024, 2048, 4096))
    args = parser.parse_args()
    if not 32 <= args.size <= 1024:
        parser.error("--size skal være mellem 32 og 1024")
    print(json.dumps(build(args.source, args.out, args.size, args.character_id, args.label, args.node, args.page_size), ensure_ascii=False))


if __name__ == "__main__":
    main()
