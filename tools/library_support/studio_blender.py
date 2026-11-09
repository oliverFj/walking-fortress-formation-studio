"""Small, Blender-independent contracts shared by the background workers."""

import hashlib
import json
import math
import re
from pathlib import Path


WORKER_VERSION = 1
MAX_ATLAS_SIDE = 16384
MAX_ATLAS_PIXELS = 16777216


def progress(phase, done, total, message):
    print("STUDIO_PROGRESS " + json.dumps({
        "phase": phase, "done": done, "total": total, "message": message,
    }, ensure_ascii=False), flush=True)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def finite_number(value, name, minimum=None, maximum=None):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number.")
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number.") from None
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite.")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}.")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be at most {maximum}.")
    return value


def integer(value, name, minimum, maximum):
    value = finite_number(value, name, minimum, maximum)
    if value != int(value):
        raise ValueError(f"{name} must be an integer.")
    return int(value)


def sample_animation(first, last, source_fps, animation_fps, loop):
    """Keep inclusive source duration while changing the exported image count.

    Loop samples divide the complete source-frame interval without appending a
    closing pose. Non-loop samples span the start/end poses, then hold their
    last pose for its image interval. All exported image intervals are equal.
    """
    first = finite_number(first, "start")
    last = finite_number(last, "end")
    if last < first:
        raise ValueError("end must be greater than or equal to start.")
    source_fps = finite_number(source_fps, "source_fps", 0.000001)
    animation_fps = finite_number(animation_fps, "animation_fps", 0.000001)
    if not isinstance(loop, bool):
        raise ValueError("loop must be true or false.")
    length = last - first + 1.0
    duration = length / source_fps
    count = max(1, int(math.floor(duration * animation_fps + 0.5)))
    if not loop and last > first:
        count = max(2, count)
    if count > 10000:
        raise ValueError("An animation cannot exceed 10000 exported images per direction.")
    if loop:
        frames = [first + index * length / count for index in range(count)]
    elif count == 1:
        frames = [first]
    else:
        frames = [first + index * (last - first) / (count - 1) for index in range(count)]
    return {
        "frames": frames, "duration_seconds": duration,
        "sample_count": count, "playback_fps": count / duration,
        "frame_duration_seconds": duration / count,
    }


def framing_frames(first, last, samples):
    """Include every original integer frame and every rendered subframe."""
    return sorted(set(
        [float(first), float(last)]
        + list(range(math.ceil(first), math.floor(last) + 1)) + list(samples)
    ))


def sheet_layout(count, tile_size, preferred_columns=4, padding=2):
    """Keep deterministic four-column layout unless a taller sheet needs more."""
    if count < 1:
        raise ValueError("Cannot pack an empty spritesheet.")
    stride = tile_size + 2 * padding
    max_columns = MAX_ATLAS_SIDE // stride
    if max_columns < 1 or count > max_columns * max_columns:
        raise ValueError("Spritesheet exceeds 16384 pixels; lower pixels or animation fps.")
    columns = min(count, max_columns, max(preferred_columns, math.ceil(count / max_columns)))
    rows = math.ceil(count / columns)
    if columns * rows * stride * stride > MAX_ATLAS_PIXELS:
        raise ValueError('Spritesheet is too large for safe packing; lower pixels or animation fps.')
    return columns, rows, columns * stride, rows * stride


def validate_slot_info(slot_infos, rig_name, identifier):
    """Validate an explicit selection; never silently choose an action slot."""
    if not slot_infos:
        if identifier:
            raise ValueError("This legacy action has no slots.")
        return None
    if not identifier:
        raise ValueError("Choose an explicit action slot for this rig.")
    matching = [slot for slot in slot_infos if slot["identifier"] == identifier]
    if len(matching) != 1:
        raise ValueError("The chosen slot does not uniquely belong to this action.")
    selected = matching[0]
    if selected.get("target_id_type") != "OBJECT":
        raise ValueError("A rig action slot must target an Object.")
    if rig_name not in selected.get("compatible_rigs", []):
        raise ValueError(f"Slot {identifier!r} does not belong to rig {rig_name!r}.")
    return selected


def normalized_pike(value, body_meshes):
    """A rigid weapon attachment in its object's local coordinates."""
    if not isinstance(value, dict):
        raise ValueError("pike must be an object.")
    name = value.get("object")
    if not isinstance(name, str) or not name:
        raise ValueError("Choose the separate pike mesh object.")
    if name in body_meshes:
        raise ValueError("The separate pike must not be among the rendered body meshes.")
    result = {"object": name}
    for key in ("butt", "tip", "grip"):
        point = value.get(key)
        if not isinstance(point, (list, tuple)) or len(point) != 3 or any(
            isinstance(coordinate, bool) or not isinstance(coordinate, (int, float))
            or not math.isfinite(coordinate) or abs(coordinate) > 1000000 for coordinate in point
        ):
            raise ValueError(f"pike.{key} must contain three finite coordinates.")
        result[key] = [float(coordinate) for coordinate in point]
    if sum((a - b) ** 2 for a, b in zip(result["butt"], result["tip"])) <= 1e-12:
        raise ValueError("The pike butt and tip must be distinct.")
    result["width_world"] = finite_number(value.get("width_world", 0.03), "pike.width_world", 0.000001, 1000)
    result["layer"] = value.get("layer", "front")
    if result["layer"] not in ("front", "back"):
        raise ValueError("pike.layer must be front or back.")
    return result


def project_attachment_point(point, origin, right, up, pixels_per_world_unit, pivot):
    """Top-left tile pixels, including points outside the body tile."""
    relative = [point[index] - origin[index] for index in range(3)]
    return [
        pivot[0] + sum(relative[index] * right[index] for index in range(3)) * pixels_per_world_unit,
        pivot[1] - sum(relative[index] * up[index] for index in range(3)) * pixels_per_world_unit,
    ]


def normalized_settings(config):
    if not isinstance(config, dict):
        raise ValueError("Render configuration must be an object.")
    settings = config.get("settings", config)
    if not isinstance(settings, dict):
        raise ValueError("settings must be an object.")
    rig = settings.get("rig")
    meshes = settings.get("meshes")
    if not isinstance(rig, str) or not rig:
        raise ValueError("Choose a rig.")
    if not isinstance(meshes, list) or not meshes or any(
        not isinstance(name, str) or not name for name in meshes
    ) or len(set(meshes)) != len(meshes):
        raise ValueError("Choose distinct mesh object names.")
    anchor = settings.get("anchor_mesh", meshes[0])
    if anchor not in meshes:
        raise ValueError("The anchor mesh must be among the selected meshes.")
    clips = settings.get("clips")
    if not isinstance(clips, list) or not clips:
        raise ValueError("Choose at least one action.")
    normalized_clips = []
    names = set()
    for clip in clips:
        if not isinstance(clip, dict):
            raise ValueError("Every clip must be an object.")
        name = clip.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", name):
            raise ValueError("Clip names may contain letters, numbers, underscores and hyphens.")
        if name in names:
            raise ValueError("Clip names must be unique.")
        names.add(name)
        action = clip.get("action")
        if not isinstance(action, str) or not action:
            raise ValueError("Every clip needs an action name.")
        slot = clip.get("slot")
        if slot is not None and not isinstance(slot, str):
            raise ValueError("slot must be an identifier or null.")
        loop = clip.get("loop", True)
        if not isinstance(loop, bool):
            raise ValueError("loop must be true or false.")
        result = {"name": name, "action": action, "slot": slot or None, "loop": loop}
        for key in ("start", "end"):
            if clip.get(key) is not None:
                result[key] = finite_number(clip[key], key)
        if "start" in result and "end" in result and result["end"] < result["start"]:
            raise ValueError("Clip end must be greater than or equal to start.")
        normalized_clips.append(result)
    remove_motion = settings.get("remove_root_motion", True)
    if not isinstance(remove_motion, bool):
        raise ValueError("remove_root_motion must be true or false.")
    bone = settings.get("root_motion_bone", "root")
    if bone is not None and not isinstance(bone, str):
        raise ValueError("root_motion_bone must be a bone name or null.")
    result = {
        "rig": rig, "meshes": list(meshes), "anchor_mesh": anchor,
        "clips": normalized_clips,
        "pixels": integer(settings.get("pixels", 512), "pixels", 32, 2048),
        "animation_fps": finite_number(settings.get("animation_fps", 6), "animation_fps", 0.1, 120),
        "directions": integer(settings.get("directions", 8), "directions", 1, 32),
        "elevation": finite_number(settings.get("elevation", 30), "elevation", -89, 89),
        "azimuth": finite_number(settings.get("azimuth", 0), "azimuth", -36000, 36000),
        "root_motion_bone": bone or None, "remove_root_motion": remove_motion,
        "margin": finite_number(settings.get("margin", 0.08), "margin", 0, 1),
    }
    render_style = settings.get("render_style", "WORKBENCH")
    if render_style not in ("WORKBENCH", "INK"):
        raise ValueError("render_style must be WORKBENCH or INK.")
    # Omit the existing renderer's default, keeping old resume signatures stable.
    if render_style == "INK":
        result["render_style"] = "INK"
    if settings.get("pike") is not None:
        result["pike"] = normalized_pike(settings["pike"], meshes)
    if settings.get("ortho_scale") is not None:
        result["ortho_scale"] = finite_number(settings["ortho_scale"], "ortho_scale", 0.000001, 1000000)
    return result


def file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def render_signature(settings, source):
    source = Path(source).resolve()
    payload = {"worker_version": WORKER_VERSION, "settings": settings,
               "source_blend": str(source), "source_sha256": file_digest(source)}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
