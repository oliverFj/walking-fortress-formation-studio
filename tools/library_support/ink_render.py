"""Use a saved WF ink setup in an isolated Sprite Studio render scene.

The add-on is loaded from this workspace, not from Blender preferences. Materials
and shader graphs are read-only. Only copied Grease Pencil data are retargeted.
"""
from pathlib import Path
import importlib
import math
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def saved_ink_setup(scene, meshes=()):
    if bpy.app.version < (5, 2, 0):
        raise ValueError("Stregstil kræver Blender 5.2 eller nyere.")
    if not hasattr(bpy.types.Scene, "wf_ink"):
        addon_root = Path(__file__).resolve().parent
        if not (addon_root / "wf_ink_sprite" / "__init__.py").is_file():
            raise ValueError("Det lokale Stregstil-add-on blev ikke fundet.")
        sys.path.insert(0, str(addon_root))
        importlib.import_module("wf_ink_sprite").register()
    settings = scene.wf_ink
    source = settings.source_collection
    lines = settings.line_object
    camera = settings.camera
    if not source or not lines or lines.type != "GREASEPENCIL" or not camera:
        raise ValueError("Modellen mangler et gemt Stregstil-setup. Opret setup'et og gem i Blender først.")
    if camera.type != "CAMERA" or camera.data.type != "ORTHO":
        raise ValueError("Stregstil-setup'et mangler et ortografisk kamera.")
    if any(obj not in source.objects[:] for obj in meshes):
        raise ValueError("Alle valgte kropsmeshes skal indgå i modellens gemte Stregstil-setup.")
    if not settings.fill_material or not settings.fill_material.use_nodes:
        raise ValueError("Stregstil-setup'et mangler sit gemte fyldmateriale.")
    if not settings.ink_material or not settings.ink_material.is_grease_pencil:
        raise ValueError("Stregstil-setup'et mangler sit stregmateriale.")
    lineart = [modifier for modifier in lines.modifiers if modifier.type == "LINEART"]
    if not lineart or not any(modifier.show_render for modifier in lineart):
        raise ValueError("Stregstil-setup'et mangler aktive Line Art-konturer.")
    if not math.isfinite(settings.ortho_scale) or settings.ortho_scale <= 0 or settings.resolution <= 0:
        raise ValueError("Stregstil-setup'ets kameramål er ugyldige.")
    return settings


def configure_ink_render(scene, original, pixels):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = pixels
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
    scene.render.film_transparent = True
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.use_freestyle = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 30
    for name in ("view_transform", "look", "exposure", "gamma"):
        setattr(scene.view_settings, name, getattr(original.view_settings, name))
    # Material shadows are analytical. Preserve the original render quality.
    if hasattr(scene, "eevee"):
        for name in ("taa_render_samples",):
            if hasattr(scene.eevee, name) and hasattr(original.eevee, name):
                setattr(scene.eevee, name, getattr(original.eevee, name))


def _srgb_hex(color):
    def channel(value):
        value = min(1.0, max(0.0, float(value)))
        srgb = 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
        return round(srgb * 255)
    return "#" + "".join(f"{channel(value):02x}" for value in color[:3])


def style_pike(attachment, settings):
    """Match saved colours while keeping a narrow shaft visibly filled."""
    result = dict(attachment)
    result.update({
        "ink": _srgb_hex(settings.ink_color), "paper": _srgb_hex(settings.base_color),
        "stroke_width": result["width"] / 4,
        "head_length": result["width"] * 7,
        "head_width": result["width"] * 3.5,
        "head_stroke_width": result["width"] / 4,
    })
    return result


class InkSceneLines:
    def __init__(self, scene, source_settings, meshes, camera, pixels, ortho_scale, first_frame):
        self.collection = self.object = self.data = None
        self.source = source_settings
        self.pixels = pixels
        self.ortho_scale = ortho_scale
        self.factor = 1.0  # Preserve physical stroke width when changing render resolution.
        try:
            self.collection = bpy.data.collections.new("__WF_INK_EXPORT_BODY__")
            scene.collection.children.link(self.collection)
            for mesh in meshes:
                self.collection.objects.link(mesh)
            self.object = source_settings.line_object.copy()
            self.data = source_settings.line_object.data.copy()
            self.object.data = self.data
            scene.collection.objects.link(self.object)
            self.object.hide_render = False
            for layer in self.data.layers:
                if not layer.frames or min(frame.frame_number for frame in layer.frames) > first_frame:
                    layer.frames.new(first_frame)
            for modifier in self.object.modifiers:
                if modifier.type != "LINEART":
                    continue
                modifier.source_type = "COLLECTION"
                modifier.source_collection = self.collection
                modifier.use_custom_camera = True
                modifier.source_camera = camera
                modifier.use_offset_towards_custom_camera = True
                modifier.radius *= self.factor
                modifier.stroke_depth_offset *= self.factor
                modifier.use_cache = False
            self.data.update_tag()
            self.object.update_tag()
        except Exception:
            self.close()
            raise

    def metadata(self):
        strokes = []
        for modifier in self.object.modifiers:
            if modifier.type == "LINEART":
                strokes.append({
                    "layer": modifier.target_layer, "radius_world": modifier.radius,
                    "width_pixels": modifier.radius * self.pixels / self.ortho_scale,
                    "source_width_pixels": modifier.radius * self.source.resolution / self.source.ortho_scale,
                    "depth_offset_world": modifier.stroke_depth_offset,
                })
        return {
            "source_resolution": self.source.resolution,
            "source_ortho_scale": self.source.ortho_scale,
            "lineart_scale_factor": self.factor,
            "line_width_policy": "saved_world_width; pixels_scale_with_export_resolution",
            "strokes": strokes,
            "shadow_mode": self.source.shadow_mode,
            "shadow_softness": self.source.shadow_softness,
            "shadow_strength": self.source.shadow_strength,
            "material_graphs": "saved_without_reapplying_settings",
            "lineart_source": "selected_body_meshes_only",
        }

    def close(self):
        if self.object:
            bpy.data.objects.remove(self.object, do_unlink=True)
            self.object = None
        if self.data:
            bpy.data.grease_pencils.remove(self.data)
            self.data = None
        if self.collection:
            bpy.data.collections.remove(self.collection)
            self.collection = None


def body_depth_bvh(meshes, depsgraph):
    """A world-space surface tree after armature and geometry modifiers."""
    vertices, polygons = [], []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            first = len(vertices)
            matrix = evaluated.matrix_world
            vertices.extend(matrix @ vertex.co for vertex in mesh.vertices)
            polygons.extend(tuple(first + index for index in polygon.vertices)
                            for polygon in mesh.polygons)
        finally:
            evaluated.to_mesh_clear()
    if not polygons:
        return None
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)


def pike_depth_mask(attachment, pike, depsgraph, pike_settings, meshes, outward, distance):
    """Erase weapon portions hidden by the animated body in this camera view.

    Samples are at most half an output pixel apart. The runtime clips these
    ordered erase operations to the original pike silhouette on its own layer.
    """
    tree = body_depth_bvh(meshes, depsgraph)
    if tree is None:
        return attachment
    matrix = pike.evaluated_get(depsgraph).matrix_world
    butt = matrix @ Vector(pike_settings["butt"])
    tip = matrix @ Vector(pike_settings["tip"])
    axis = tip - butt
    pixel_butt, pixel_tip = attachment["butt"], attachment["tip"]
    pixel_axis = [pixel_tip[index] - pixel_butt[index] for index in range(2)]
    length = math.hypot(*pixel_axis)
    steps = max(1, math.ceil(length / .5))
    head_length = min(attachment.get("head_length", attachment["width"] * 7), length * .95)
    head_start = 1 - head_length / length if length > 1e-9 else 0
    outward = Vector(outward).normalized()
    eps = 1e-5
    ray_distance = max(float(distance), axis.length + 1.0)
    regions = []
    for index in range(steps + 1):
        t = index / steps
        point = butt + axis * t
        hit, _, _, _ = tree.ray_cast(point + outward * ray_distance,
                                    -outward, ray_distance - eps)
        regions.append((hit is not None, t >= head_start))
    operations = []
    start = 0
    while start <= steps:
        state = regions[start]
        end = start
        while end < steps and regions[end + 1] == state:
            end += 1
        if state[0]:
            # Half-sample boundaries bridge adjacent samples. Round stroke caps
            # and a two-pixel coverage margin avoid seams against the body edge.
            first_t = max(0, (start - .5) / steps)
            last_t = min(1, (end + .5) / steps)
            width = attachment.get("head_width", attachment["width"] * 3.5) if state[1] else attachment["width"]
            points = [[pixel_butt[axis_index] + pixel_axis[axis_index] * t
                       for axis_index in range(2)] for t in (first_t, last_t)]
            operations.append({"tool": "erase", "color": "#000000",
                               "width": min(1000.0, max(.1, width + 2.0)), "points": points})
        start = end + 1
    if not operations:
        return attachment
    return {**attachment, "operations": list(attachment.get("operations", [])) + operations}
