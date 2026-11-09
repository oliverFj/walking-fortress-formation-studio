"""Focused regressions for multi-page animation packs."""
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
import library_packer


class PagesTest(unittest.TestCase):
    def test_many_frames_preserve_pairs_pikes_and_full_semantics(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source, output = folder / "source", folder / "runtime"
            source.mkdir()
            frames = []
            for index in range(10):
                Image.new("RGBA", (32, 32), (70 + index * 10, 30, 20, 255)).save(source / f"body{index}.png")
                Image.new("RGBA", (32, 32), (128, 0 if index < 5 else 255, 128, 255)).save(source / f"normal{index}.png")
                frames.append({"index": index % 5, "source_frame": index % 5,
                               "pivot_pixels": [16, 32], "albedo": f"body{index}.png", "normal": f"normal{index}.png",
                               "attachments": {"pike": {"enabled": True, "butt": [16, 32], "tip": [16, -24],
                                   "grip": [16, 15], "width": 2, "layer": "front", "ink": "#000000", "paper": "#dacdaa",
                                   "operations": [{"tool": "erase", "color": "#000000", "width": 4, "points": [[16, 10], [16, 15]]}]}}})
            manifest = {"normal_space": "actor-blender-world", "normal_encoding": "RGB8-linear-signed",
                        "ortho_scale": 2, "first_azimuth_degrees": 45, "azimuth_step_degrees": 360,
                        "elevation_degrees": 30.05, "clips": []}
            for clip, kind, selected in (("idle", "idle", frames[:5]), ("fire", "action", frames[5:])):
                manifest["clips"].append({"name": clip, "kind": kind, "action": clip.title(), "loop": kind == "idle",
                                          "source_start": 0, "source_end": 4, "duration_seconds": 1,
                                          "directions": [{"index": 0, "frames": selected}]})
            (source / "sprites.json").write_text(json.dumps(manifest), encoding="utf-8")
            report = library_packer.build(source, output, size=32, character_id="test", page_size=128)
            data = json.loads((output / "character.json").read_text(encoding="utf-8"))
            self.assertGreater(report["pageCount"], 1)
            self.assertEqual(report["checks"]["pairedFrameAlignment"], 10)
            self.assertEqual(report["checks"]["checkedPikeFrames"], 10)
            self.assertFalse(data["clips"]["fire"]["loop"])
            self.assertEqual(data["clips"]["fire"]["kind"], "action")
            self.assertEqual(data["bodyAtlas"], data["pages"][0]["bodyAtlas"])
            for clip in data["clips"].values():
                for frame in clip["directions"][0]:
                    page = data["pages"][frame["page"]]
                    self.assertEqual(page["bodyAtlasSize"], page["normalAtlasSize"])
                    self.assertTrue(all(side <= 128 for side in page["bodyAtlasSize"] + page["pikeAtlasSize"]))
                    x, y, w, h = frame["body"]["rect"]
                    with Image.open(output / page["bodyAtlas"]) as body, Image.open(output / page["normalAtlas"]) as normal:
                        expected_sign = 0 if clip["kind"] == "idle" else 255
                        self.assertEqual(normal.getpixel((x + w // 2, y + h // 2))[1], expected_sign)
                        self.assertEqual(body.getpixel((x + w // 2, y + h // 2))[3], 255)
            with self.assertRaisesRegex(ValueError, "revisionsmappe"):
                library_packer.build(source, output, size=32)


if __name__ == "__main__":
    unittest.main()
