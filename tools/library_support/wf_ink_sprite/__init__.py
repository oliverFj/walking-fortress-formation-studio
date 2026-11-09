"""Walking Fortress: adjustable flat fill and bold camera-derived ink strokes.

Blender 5.2+. No handlers, external packages, paid services or automatic file saves.
"""
import bpy
import bmesh
from .shading import update_shadow_nodes
import json
import math
from mathutils import Vector
from bpy.props import (
    BoolProperty, CollectionProperty, EnumProperty, FloatProperty,
    FloatVectorProperty, IntProperty, PointerProperty, StringProperty,
)
from bpy.types import Operator, Panel, PropertyGroup

bl_info = {
    "name": "Walking Fortress – Stregstil",
    "author": "Walking Fortress",
    "version": (0, 3, 0),
    "blender": (5, 2, 0),
    "location": "3D View > Sidebar > WF Streg",
    "description": "Basisfarve, kraftige konturer og udvalgte foldstreger",
    "category": "Render",
}

ROLE = "wf_ink_role"
FINE_GROUP = "WF Ink Fine"


def _source_meshes(settings):
    if not settings.source_collection:
        return []
    return [obj for obj in settings.source_collection.objects if obj.type == "MESH"]


def _remember_scene(scene, settings):
    render_keys = (
        "engine", "resolution_x", "resolution_y", "resolution_percentage",
        "pixel_aspect_x", "pixel_aspect_y", "film_transparent",
        "use_compositing", "use_sequencer", "use_freestyle",
    )
    view_keys = ("view_transform", "look", "exposure", "gamma")
    settings.previous_camera = scene.camera
    settings.backup_json = json.dumps({
        "render": {key: getattr(scene.render, key) for key in render_keys},
        "image": {
            "file_format": scene.render.image_settings.file_format,
            "color_mode": scene.render.image_settings.color_mode,
            "color_depth": scene.render.image_settings.color_depth,
        },
        "view": {key: getattr(scene.view_settings, key) for key in view_keys},
    })


def _new_fill():
    material = bpy.data.materials.new("WF | Basisfarve")
    material[ROLE] = "fill"
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    links = material.node_tree.links
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (600, 0)
    emission = nodes.new("ShaderNodeEmission")
    emission.location = (380, 0)
    emission.inputs["Strength"].default_value = 1.0
    base = nodes.new("ShaderNodeRGB")
    base.name = "WF Base Color"
    base.label = "Basisfarve"
    base.location = (-300, 150)
    mix = nodes.new("ShaderNodeMixRGB")
    mix.name = "WF Texture Mix"
    mix.label = "Valgfri tekstur"
    mix.blend_type = "MULTIPLY"
    mix.location = (140, 0)
    coord = nodes.new("ShaderNodeTexCoord")
    coord.location = (-700, -180)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.name = "WF Grain"
    noise.location = (-470, -180)
    noise.inputs["Detail"].default_value = 2.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.name = "WF Grain Contrast"
    ramp.location = (-150, -180)
    ramp.color_ramp.elements[0].color = (0.35, 0.35, 0.35, 1.0)
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    image = nodes.new("ShaderNodeTexImage")
    image.name = "WF Image Texture"
    image.label = "Egen tekstur (UV)"
    image.location = (-470, -470)
    links.new(coord.outputs["Generated"], noise.inputs["Vector"])
    links.new(coord.outputs["UV"], image.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(base.outputs["Color"], mix.inputs[1])
    links.new(ramp.outputs["Color"], mix.inputs[2])
    links.new(mix.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs[0], output.inputs["Surface"])
    return material


def _new_ink():
    material = bpy.data.materials.new("WF | Stregfarve")
    material[ROLE] = "ink"
    bpy.data.materials.create_gpencil_data(material)
    material.grease_pencil.color = (0.0, 0.0, 0.0, 1.0)
    return material


def _new_lines(scene, settings):
    data = bpy.data.grease_pencils.new("WF | Stregdata")
    obj = bpy.data.objects.new("WF | Konturer og folder", data)
    obj[ROLE] = "lines"
    settings.studio_collection.objects.link(obj)
    data.materials.append(settings.ink_material)
    obj.show_in_front = False
    for name, contours in (("Konturer", True), ("Folder", False)):
        layer = data.layers.new(name, set_active=True)
        layer.opacity = 1.0
        layer.use_lights = False
        layer.frames.new(scene.frame_start)
        mod = obj.modifiers.new(name, "LINEART")
        mod.source_type = "COLLECTION"
        mod.source_collection = settings.source_collection
        mod.target_layer = layer.name
        mod.target_material = settings.ink_material
        mod.use_contour = contours
        mod.use_intersection = not contours
        mod.use_edge_mark = not contours
        mod.use_crease = False
        mod.use_material = False
        mod.use_loose = False
        mod.use_light_contour = False
        mod.use_shadow = False
        mod.fill_strokes = False
        mod.opacity = 1.0
        mod.level_start = 0
        mod.level_end = 0
        mod.silhouette_filtering = "NONE"
        # Separate evaluation keeps edge-type choices independent.
        mod.use_cache = False
        mod.stroke_depth_offset = 0.0001
        mod.overscan = 0.1
    settings.line_object = obj


def _ensure_fine_modifiers(settings):
    """Transfer per-vertex marks, then shrink only their generated strokes."""
    obj = settings.line_object
    if not obj:
        return
    if not obj.vertex_groups.get(FINE_GROUP):
        obj.vertex_groups.new(name=FINE_GROUP)
    for name, width, fine_width in (
        ("Konturer", settings.outline_px, settings.fine_outline_px),
        ("Folder", settings.detail_px, settings.fine_detail_px),
    ):
        lineart = obj.modifiers.get(name)
        if lineart:
            lineart.source_vertex_group = FINE_GROUP
            lineart.vertex_group = FINE_GROUP
            lineart.use_output_vertex_group_match_by_name = False
        modifier_name = "Smådetaljer | " + name
        modifier = obj.modifiers.get(modifier_name)
        if not modifier:
            modifier = obj.modifiers.new(modifier_name, "GREASE_PENCIL_THICKNESS")
        modifier.tree_node_filter = name
        modifier.vertex_group_name = FINE_GROUP
        modifier.use_uniform_thickness = False
        # False blends factor according to weight; True would zero unmarked areas.
        modifier.use_weight_factor = False
        modifier.thickness_factor = fine_width / max(width, 0.001)


def _apply_fill_to_object(settings, obj):
    existing = next((record for record in settings.sources if record.obj == obj), None)
    if existing is None:
        record = settings.sources.add()
        record.obj = obj
        record.active_material_index = obj.active_material_index
        for index, original_slot in enumerate(obj.material_slots):
            slot = record.materials.add()
            slot.material = original_slot.material
            slot.data_material = obj.data.materials[index]
            slot.link = original_slot.link
        # Material slots belong to mesh data; leave other users of that mesh intact.
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        if len(obj.data.materials) == 0:
            obj.data.materials.append(settings.fill_material)
        else:
            for index in range(len(obj.data.materials)):
                obj.material_slots[index].link = "DATA"
                obj.data.materials[index] = settings.fill_material


def _set_camera_direction(settings):
    camera = settings.camera
    if not camera:
        return
    azimuth = math.radians(settings.azimuth)
    elevation = math.radians(settings.elevation)
    direction = Vector((
        math.sin(azimuth) * math.cos(elevation),
        -math.cos(azimuth) * math.cos(elevation),
        math.sin(elevation),
    ))
    target = Vector(settings.target)
    camera.location = target + direction * settings.distance
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()


def _apply_settings(scene):
    settings = scene.wf_ink
    if not settings.studio_collection or not settings.camera or not settings.line_object:
        return
    render = scene.render
    render.engine = "BLENDER_EEVEE"
    render.resolution_x = settings.resolution
    render.resolution_y = settings.resolution
    render.resolution_percentage = 100
    render.pixel_aspect_x = 1.0
    render.pixel_aspect_y = 1.0
    render.film_transparent = True
    render.image_settings.file_format = "PNG"
    render.image_settings.color_mode = "RGBA"
    render.use_compositing = False
    render.use_sequencer = False
    render.use_freestyle = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    settings.camera.data.type = "ORTHO"
    settings.camera.data.ortho_scale = settings.ortho_scale
    settings.camera.data.sensor_fit = "HORIZONTAL"
    settings.camera.data.clip_start = 0.001
    settings.camera.data.clip_end = max(settings.distance * 5.0, 100.0)
    _set_camera_direction(settings)
    material = settings.fill_material
    if material and material.node_tree:
        material.diffuse_color = settings.base_color
        nodes = material.node_tree.nodes
        nodes["WF Base Color"].outputs[0].default_value = settings.base_color
        nodes["WF Grain"].inputs["Scale"].default_value = settings.texture_scale
        nodes["WF Image Texture"].image = settings.texture_image
        texture_source = (
            nodes["WF Image Texture"].outputs["Color"]
            if settings.texture_mode == "IMAGE"
            else nodes["WF Grain Contrast"].outputs["Color"]
        )
        mix = nodes["WF Texture Mix"]
        for link in list(mix.inputs[2].links):
            material.node_tree.links.remove(link)
        material.node_tree.links.new(texture_source, mix.inputs[2])
        mix.inputs[0].default_value = (
            0.0 if settings.texture_mode == "IMAGE" and not settings.texture_image
            else settings.texture_strength
        )
    update_shadow_nodes(material, settings)
    if settings.ink_material:
        settings.ink_material.grease_pencil.color = settings.ink_color
    _ensure_fine_modifiers(settings)
    for name, width in (("Konturer", settings.outline_px), ("Folder", settings.detail_px)):
        mod = settings.line_object.modifiers.get(name)
        if not mod:
            continue
        # Blender 5.2 Line Art writes half this value into drawing.radius.
        # Verified with evaluated drawings and actual orthographic PNG renders.
        mod.radius = min(1.0, width * settings.ortho_scale / settings.resolution)
        mod.stroke_depth_offset = mod.radius
        if name == "Konturer":
            mod.silhouette_filtering = "GROUP" if settings.outline_silhouette_only else "NONE"
        if name == "Folder":
            mod.use_contour = settings.outline_silhouette_only
            mod.silhouette_filtering = "NONE"
            mod.use_intersection = settings.intersections
            mod.use_edge_mark = True
            mod.use_crease = settings.auto_creases
            mod.crease_threshold = math.radians(settings.crease_angle)
            mod.use_material = settings.material_borders
    settings.line_object.data.update_tag()
    settings.line_object.update_tag()


def _live_update(settings, context):
    scene = settings.id_data
    if isinstance(scene, bpy.types.Scene):
        _apply_settings(scene)


def _fit_camera(context):
    settings = context.scene.wf_ink
    meshes = _source_meshes(settings)
    if not meshes:
        raise ValueError("Setup'et indeholder ingen mesh-objekter.")
    context.view_layer.update()
    depsgraph = context.evaluated_depsgraph_get()
    points = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    lower = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    upper = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    settings.target = (lower + upper) * 0.5
    settings.distance = max((upper - lower).length * 3.0, 1.0)
    _set_camera_direction(settings)
    rotation = settings.camera.rotation_euler.to_matrix()
    inverse_rotation = rotation.transposed()
    projected = [inverse_rotation @ (point - Vector(settings.target)) for point in points]
    min_x = min(point.x for point in projected)
    max_x = max(point.x for point in projected)
    min_y = min(point.y for point in projected)
    max_y = max(point.y for point in projected)
    shift = rotation @ Vector(((max_x + min_x) / 2, (max_y + min_y) / 2, 0))
    settings.target = Vector(settings.target) + shift
    settings.ortho_scale = max(max_x - min_x, max_y - min_y, 0.01) * (1 + 2 * settings.margin)
    _apply_settings(context.scene)
    context.view_layer.update()


def _remove_setup(scene):
    settings = scene.wf_ink
    for record in settings.sources:
        obj = record.obj
        if obj and obj.type == "MESH":
            # Restore slots in place: clear() would reset face material indices.
            wanted = len(record.materials)
            while len(obj.data.materials) < wanted:
                obj.data.materials.append(None)
            for index, saved in enumerate(record.materials):
                obj.data.materials[index] = saved.data_material
                obj.material_slots[index].link = saved.link
                if saved.link == "OBJECT":
                    obj.material_slots[index].material = saved.material
            while len(obj.data.materials) > wanted:
                obj.data.materials.pop(index=len(obj.data.materials) - 1)
            obj.active_material_index = min(
                record.active_material_index, max(0, len(obj.data.materials) - 1)
            )
    settings.sources.clear()
    camera = settings.camera
    if scene.camera == camera:
        scene.camera = settings.previous_camera
    if settings.backup_json:
        snapshot = json.loads(settings.backup_json)
        for key, value in snapshot["render"].items():
            setattr(scene.render, key, value)
        for key, value in snapshot["image"].items():
            setattr(scene.render.image_settings, key, value)
        # Restore transform before look: allowed look values depend on transform.
        for key, value in snapshot["view"].items():
            setattr(scene.view_settings, key, value)
    owned_objects = (settings.line_object, camera)
    settings.line_object = None
    settings.camera = None
    for obj in owned_objects:
        if obj and obj.get(ROLE) in {"lines", "camera"}:
            data = obj.data
            kind = obj.type
            bpy.data.objects.remove(obj, do_unlink=True)
            if data.users == 0:
                (bpy.data.grease_pencils if kind == "GREASEPENCIL" else bpy.data.cameras).remove(data)
    collections = (settings.source_collection, settings.studio_collection)
    settings.source_collection = None
    settings.studio_collection = None
    for collection in collections:
        if collection and collection.get(ROLE) in {"source", "studio"}:
            # A user may have moved or created meshes inside a managed collection.
            for obj in list(collection.objects):
                if all(owner in collections for owner in obj.users_collection):
                    if obj.name not in scene.collection.objects:
                        scene.collection.objects.link(obj)
            for child in list(collection.children):
                if child not in collections and child.name not in scene.collection.children:
                    scene.collection.children.link(child)
            bpy.data.collections.remove(collection)
    materials = (settings.fill_material, settings.ink_material)
    settings.fill_material = None
    settings.ink_material = None
    for material in materials:
        if material and material.get(ROLE) in {"fill", "ink"} and material.users == 0:
            bpy.data.materials.remove(material)
    settings.previous_camera = None
    settings.backup_json = ""


class WFInkMaterialBackup(PropertyGroup):
    material: PointerProperty(type=bpy.types.Material)
    data_material: PointerProperty(type=bpy.types.Material)
    link: EnumProperty(items=(("DATA", "Data", ""), ("OBJECT", "Object", "")), default="DATA")


class WFInkSourceBackup(PropertyGroup):
    obj: PointerProperty(type=bpy.types.Object)
    materials: CollectionProperty(type=WFInkMaterialBackup)
    active_material_index: IntProperty(default=0)


class WFInkSettings(PropertyGroup):
    base_color: FloatVectorProperty(
        name="Basisfarve", subtype="COLOR", size=4, min=0.0, max=1.0,
        default=(0.82, 0.76, 0.62, 1.0), update=_live_update,
    )
    ink_color: FloatVectorProperty(
        name="Stregfarve", subtype="COLOR", size=4, min=0.0, max=1.0,
        default=(0.0, 0.0, 0.0, 1.0), update=_live_update,
    )
    outline_px: FloatProperty(
        name="Konturer (px)", default=8.0, min=0.2, max=40.0,
        description="Omtrent fuld stregbredde i det valgte renderbillede",
        update=_live_update,
    )
    detail_px: FloatProperty(
        name="Folder (px)", default=5.0, min=0.2, max=40.0, update=_live_update,
    )
    outline_silhouette_only: BoolProperty(
        name="Tyk streg kun på yderkontur", default=False,
        description="Brug foldbredden til indre konturer og overlap", update=_live_update,
    )
    fine_outline_px: FloatProperty(
        name="Små konturer (px)", default=1.5, min=0.0, max=40.0,
        description="Konturbredden på områder markeret som små detaljer", update=_live_update,
    )
    fine_detail_px: FloatProperty(
        name="Små folder (px)", default=0.8, min=0.0, max=40.0,
        description="Indre stregbredde på områder markeret som små detaljer", update=_live_update,
    )
    shadow_mode: EnumProperty(
        name="Skygger", items=(
            ("OFF", "Ingen", "Behold den flade basisfarve"),
            ("SOLID", "Mørke felter", "Enkel formskygge med justerbar overgang"),
            ("HATCH", "Skravering", "Streger og valgfri krydsskravering i skygger"),
        ), default="OFF", update=_live_update,
    )
    shadow_strength: FloatProperty(
        name="Skyggestyrke", default=0.55, min=0.0, max=1.0, update=_live_update,
    )
    shadow_threshold: FloatProperty(
        name="Skyggernes omfang", default=0.45, min=0.0, max=1.0,
        description="Højere tal giver skygge på mere af figuren", update=_live_update,
    )
    shadow_softness: FloatProperty(
        name="Overgang", default=0.0, min=0.0, max=0.5,
        description="0 giver skarpe blækfelter; små værdier giver en smal overgang", update=_live_update,
    )
    shadow_azimuth: FloatProperty(
        name="Lysretning", default=-45.0, min=-360.0, max=360.0, update=_live_update,
    )
    shadow_elevation: FloatProperty(
        name="Lyshøjde (grader)", default=55.0, min=-90.0, max=90.0, update=_live_update,
    )
    hatch_density: FloatProperty(
        name="Skraveringens tæthed", default=18.0, min=0.1, max=200.0, update=_live_update,
    )
    hatch_width: FloatProperty(
        name="Skraveringens bredde", default=0.2, min=0.01, max=0.8,
        description="Stregbredde som andel af afstanden mellem streger", update=_live_update,
    )
    hatch_cross: BoolProperty(
        name="Krydsskravering i dybe skygger", default=True, update=_live_update,
    )
    hatch_dark_fill: BoolProperty(
        name="Helt mørke felter i dyb skygge", default=False, update=_live_update,
    )
    hatch_coordinates: EnumProperty(
        name="Skravering følger", items=(
            ("GENERATED", "Modellens form", "Overfladebundet skravering uden krav om UV-map"),
            ("UV", "UV-map", "Brug UV-map til at styre retning og tæthed"),
        ), default="GENERATED", update=_live_update,
    )
    intersections: BoolProperty(
        name="Streger ved overlap", default=True,
        description="Tegn skæringslinjer mellem flader; slå fra ved uønskede streger",
        update=_live_update,
    )
    auto_creases: BoolProperty(
        name="Automatiske kantstreger", default=False,
        description="Kan give mange streger på kantede low-poly-modeller",
        update=_live_update,
    )
    crease_angle: FloatProperty(
        name="Kantvinkel", default=140.0, min=0.0, max=180.0, update=_live_update,
    )
    material_borders: BoolProperty(
        name="Materialekanter", default=False,
        description="Tegn grænser mellem forskellige materialer", update=_live_update,
    )
    texture_strength: FloatProperty(
        name="Teksturstyrke", default=0.0, min=0.0, max=1.0, update=_live_update,
    )
    texture_mode: EnumProperty(
        name="Tekstur", items=(
            ("NOISE", "Let struktur", "Procedural struktur bundet til modellens overflade"),
            ("IMAGE", "Eget billede", "Billedtekstur med modellens UV-koordinater"),
        ), default="NOISE", update=_live_update,
    )
    texture_scale: FloatProperty(
        name="Strukturens tæthed", default=25.0, min=0.1, max=500.0, update=_live_update,
    )
    texture_image: PointerProperty(
        name="Teksturbillede", type=bpy.types.Image, update=_live_update,
    )
    resolution: IntProperty(
        name="Billedstørrelse", default=512, min=32, max=4096,
        description="Kvadratisk renderbillede i pixels", update=_live_update,
    )
    azimuth: FloatProperty(
        name="Vinkel omkring figur", default=45.0, min=-360.0, max=360.0,
        update=_live_update,
    )
    elevation: FloatProperty(
        name="Kamerahøjde (grader)", default=20.0, min=-80.0, max=80.0,
        update=_live_update,
    )
    ortho_scale: FloatProperty(
        name="Kameraskala", default=3.0, min=0.01, max=100000.0,
        description="Fast skala; større tal viser mere omkring figuren",
        update=_live_update,
    )
    margin: FloatProperty(
        name="Luft omkring figur", default=0.12, min=0.0, max=1.0,
        description="Bruges kun ved ny indramning",
    )
    target: FloatVectorProperty(size=3, default=(0.0, 0.0, 1.0), options={"HIDDEN"})
    distance: FloatProperty(default=6.0, min=0.01, options={"HIDDEN"})
    source_collection: PointerProperty(type=bpy.types.Collection)
    studio_collection: PointerProperty(type=bpy.types.Collection)
    camera: PointerProperty(type=bpy.types.Object)
    previous_camera: PointerProperty(type=bpy.types.Object)
    line_object: PointerProperty(type=bpy.types.Object)
    fill_material: PointerProperty(type=bpy.types.Material)
    ink_material: PointerProperty(type=bpy.types.Material)
    sources: CollectionProperty(type=WFInkSourceBackup)
    backup_json: StringProperty(options={"HIDDEN"})


class WFINK_OT_setup(Operator):
    bl_idname = "wf_ink.setup"
    bl_label = "Opret / tilføj fra markering"
    bl_description = "Giv markerede meshes basisfarve og opret stregkamera"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return context.mode == "OBJECT" and any(obj.type == "MESH" for obj in context.selected_objects)

    def execute(self, context):
        if bpy.app.version < (5, 2, 0):
            self.report({"ERROR"}, "Denne udgave kræver Blender 5.2 eller nyere.")
            return {"CANCELLED"}
        settings = context.scene.wf_ink
        first_setup = not settings.studio_collection
        meshes = [obj for obj in context.selected_objects if obj.type == "MESH"]
        if any(obj.library or obj.data.library for obj in meshes):
            self.report({"ERROR"}, "Gør sammenkædede meshes lokale før setup'et oprettes.")
            return {"CANCELLED"}
        try:
            if first_setup:
                _remember_scene(context.scene, settings)
                source = bpy.data.collections.new("WF | Figur")
                source[ROLE] = "source"
                context.scene.collection.children.link(source)
                settings.source_collection = source
                studio = bpy.data.collections.new("WF | Stregsetup")
                studio[ROLE] = "studio"
                context.scene.collection.children.link(studio)
                settings.studio_collection = studio
                settings.fill_material = _new_fill()
                settings.ink_material = _new_ink()
                camera_data = bpy.data.cameras.new("WF | Ortografisk kamera")
                camera = bpy.data.objects.new("WF | Kamera", camera_data)
                camera[ROLE] = "camera"
                studio.objects.link(camera)
                settings.camera = camera
                context.scene.camera = camera
                _new_lines(context.scene, settings)
            for obj in meshes:
                if obj.name not in settings.source_collection.objects:
                    settings.source_collection.objects.link(obj)
                _apply_fill_to_object(settings, obj)
            _apply_settings(context.scene)
            if first_setup:
                _fit_camera(context)
        except Exception as error:
            if first_setup:
                _remove_setup(context.scene)
            self.report({"ERROR"}, "Setup kunne ikke oprettes: " + str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, "Stregsetup klar. Brug F12 eller Render prøve for at se resultatet.")
        return {"FINISHED"}


class WFINK_OT_update(Operator):
    bl_idname = "wf_ink.update"
    bl_label = "Opdatér stregsetup"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return bool(context.scene.wf_ink.studio_collection)

    def execute(self, context):
        _apply_settings(context.scene)
        context.view_layer.update()
        return {"FINISHED"}


class WFINK_OT_frame_camera(Operator):
    bl_idname = "wf_ink.frame_camera"
    bl_label = "Indram nuværende positur"
    bl_description = "Indram én gang; behold derefter samme skala gennem animationen"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return bool(context.scene.wf_ink.camera and _source_meshes(context.scene.wf_ink))

    def execute(self, context):
        try:
            _fit_camera(context)
        except ValueError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class WFINK_OT_mark_folds(Operator):
    bl_idname = "wf_ink.mark_folds"
    bl_label = "Markér foldstreger"
    bl_description = "Markér valgte mesh-kanter som tegnede foldstreger"
    bl_options = {"REGISTER", "UNDO"}
    clear: BoolProperty(default=False)

    @classmethod
    def poll(cls, context):
        settings = context.scene.wf_ink
        return context.mode == "EDIT_MESH" and bool(settings.source_collection)

    def execute(self, context):
        sources = _source_meshes(context.scene.wf_ink)
        if any(obj not in sources for obj in context.objects_in_mode if obj.type == "MESH"):
            self.report({"ERROR"}, "Redigér kun meshes fra stregsetup'et, når folder markeres.")
            return {"CANCELLED"}
        bpy.ops.mesh.mark_freestyle_edge(clear=self.clear)
        context.scene.wf_ink.line_object.update_tag()
        return {"FINISHED"}


class WFINK_OT_mark_fine(Operator):
    bl_idname = "wf_ink.mark_fine"
    bl_label = "Tyndere streger på markering"
    bl_description = "Object Mode: hele meshes. Edit Mode: kun valgte punkter"
    bl_options = {"REGISTER", "UNDO"}
    clear: BoolProperty(default=False)

    @classmethod
    def poll(cls, context):
        return context.mode in {"OBJECT", "EDIT_MESH"} and bool(context.scene.wf_ink.line_object)

    def execute(self, context):
        settings = context.scene.wf_ink
        sources = _source_meshes(settings)
        in_edit = context.mode == "EDIT_MESH"
        meshes = [
            obj for obj in (context.objects_in_mode if in_edit else context.selected_objects)
            if obj.type == "MESH"
        ]
        if not meshes or any(obj not in sources for obj in meshes):
            self.report({"ERROR"}, "Markér meshes fra stregsetup'et.")
            return {"CANCELLED"}
        selections = []
        for obj in meshes:
            if in_edit:
                bm = bmesh.from_edit_mesh(obj.data)
                bm.verts.ensure_lookup_table()
                bm.verts.index_update()
                indices = [vert.index for vert in bm.verts if vert.select]
            else:
                indices = [vert.index for vert in obj.data.vertices]
            if indices:
                selections.append((obj, indices))
        if not selections:
            self.report({"WARNING"}, "Markér de punkter, som skal have tyndere streger.")
            return {"CANCELLED"}
        if in_edit:
            bpy.ops.object.mode_set(mode="OBJECT")
        try:
            for obj, indices in selections:
                group = obj.vertex_groups.get(FINE_GROUP)
                if self.clear:
                    if group:
                        group.remove(indices)
                else:
                    if not group:
                        group = obj.vertex_groups.new(name=FINE_GROUP)
                    group.add(indices, 1.0, "REPLACE")
                obj.data.update_tag()
            _apply_settings(context.scene)
        finally:
            if in_edit:
                bpy.ops.object.mode_set(mode="EDIT")
        context.view_layer.update()
        self.report({"INFO"}, "Normal stregbredde gendannet." if self.clear else "Markeringen bruger nu de små stregbredder.")
        return {"FINISHED"}


class WFINK_OT_merian_shadows(Operator):
    bl_idname = "wf_ink.merian_shadows"
    bl_label = "Prøv Merian-skygger"
    bl_description = "Et udgangspunkt med enkel skravering; basisfarven bevares"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return bool(context.scene.wf_ink.fill_material)

    def execute(self, context):
        settings = context.scene.wf_ink
        settings.shadow_mode = "HATCH"
        settings.shadow_strength = 1.0
        settings.shadow_threshold = 0.5
        settings.shadow_softness = 0.0
        settings.shadow_azimuth = -45.0
        settings.shadow_elevation = 55.0
        settings.hatch_density = 18.0
        settings.hatch_width = 0.2
        settings.hatch_cross = True
        settings.hatch_dark_fill = False
        _apply_settings(context.scene)
        return {"FINISHED"}


class WFINK_OT_remove_setup(Operator):
    bl_idname = "wf_ink.remove_setup"
    bl_label = "Fjern setup / gendan materialer"
    bl_description = "Gendan oprindelige materialer, kamera og renderindstillinger"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return context.mode == "OBJECT" and bool(context.scene.wf_ink.studio_collection)

    def execute(self, context):
        _remove_setup(context.scene)
        self.report({"INFO"}, "Setup fjernet; oprindelige materialer og renderindstillinger gendannet.")
        return {"FINISHED"}


class WFINK_OT_preview_render(Operator):
    bl_idname = "wf_ink.preview_render"
    bl_label = "Render prøve"
    bl_description = "Vis et renderbillede med gennemsigtig baggrund"

    @classmethod
    def poll(cls, context):
        return bool(context.scene.wf_ink.camera)

    def execute(self, context):
        _apply_settings(context.scene)
        context.scene.camera = context.scene.wf_ink.camera
        bpy.ops.render.render("INVOKE_DEFAULT")
        return {"FINISHED"}


class WFINK_PT_style(Panel):
    bl_label = "Walking Fortress – Stregstil"
    bl_idname = "WFINK_PT_style"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "WF Streg"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.wf_ink
        layout.operator("wf_ink.setup", icon="GREASEPENCIL")
        if not settings.studio_collection:
            layout.label(text="Markér figurens meshes i Object Mode.")
            layout.label(text="Materialer kan gendannes med Fjern setup.")
            return
        box = layout.box()
        box.label(text="Farve og streger")
        box.prop(settings, "base_color")
        box.prop(settings, "ink_color")
        box.prop(settings, "outline_px")
        box.prop(settings, "detail_px")
        box.prop(settings, "outline_silhouette_only")
        box.prop(settings, "intersections")
        box.prop(settings, "auto_creases")
        if settings.auto_creases:
            box.prop(settings, "crease_angle")
        box.prop(settings, "material_borders")
        box = layout.box()
        box.label(text="Små detaljer, fx fingre")
        box.prop(settings, "fine_outline_px")
        box.prop(settings, "fine_detail_px")
        box.label(text="Object Mode: vælg hænder / små meshes.")
        box.label(text="Edit Mode: vælg områdets punkter.")
        box.operator("wf_ink.mark_fine", text="Tyndere på markering")
        box.operator("wf_ink.mark_fine", text="Normal på markering").clear = True
        box = layout.box()
        box.label(text="Merian-inspirerede skygger")
        box.operator("wf_ink.merian_shadows")
        box.prop(settings, "shadow_mode")
        if settings.shadow_mode != "OFF":
            box.prop(settings, "shadow_strength")
            box.prop(settings, "shadow_threshold")
            box.prop(settings, "shadow_softness")
            box.prop(settings, "shadow_azimuth")
            box.prop(settings, "shadow_elevation")
            if settings.shadow_mode == "HATCH":
                box.prop(settings, "hatch_density")
                box.prop(settings, "hatch_width")
                box.prop(settings, "hatch_cross")
                box.prop(settings, "hatch_dark_fill")
                box.prop(settings, "hatch_coordinates")
        box = layout.box()
        box.label(text="Valgfri tekstur")
        box.prop(settings, "texture_strength")
        if settings.texture_strength > 0:
            box.prop(settings, "texture_mode")
            if settings.texture_mode == "IMAGE":
                box.template_ID(settings, "texture_image", open="image.open")
                box.label(text="Billedtekstur bruger modellens UV-map.")
            else:
                box.prop(settings, "texture_scale")
        box = layout.box()
        box.label(text="Kamera og billede")
        box.prop(settings, "resolution")
        box.prop(settings, "azimuth")
        box.prop(settings, "elevation")
        box.prop(settings, "ortho_scale")
        box.prop(settings, "margin")
        box.operator("wf_ink.frame_camera", icon="VIEW_CAMERA")
        box.label(text="Behold samme indramning i animationen.")
        box = layout.box()
        box.label(text="Udvalgte folder")
        box.label(text="Edit Mode: vælg kanter på figuren.")
        box.operator("wf_ink.mark_folds", text="Markér valgte kanter")
        box.operator("wf_ink.mark_folds", text="Fjern mærker på valgte").clear = True
        layout.operator("wf_ink.preview_render", icon="RENDER_STILL")
        layout.operator("wf_ink.update", icon="FILE_REFRESH")
        layout.operator("wf_ink.remove_setup", icon="LOOP_BACK")


CLASSES = (
    WFInkMaterialBackup, WFInkSourceBackup, WFInkSettings,
    WFINK_OT_setup, WFINK_OT_update, WFINK_OT_frame_camera, WFINK_OT_mark_folds,
    WFINK_OT_mark_fine, WFINK_OT_merian_shadows,
    WFINK_OT_remove_setup, WFINK_OT_preview_render, WFINK_PT_style,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.wf_ink = PointerProperty(type=WFInkSettings)


def unregister():
    del bpy.types.Scene.wf_ink
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()

