"""Local animation library endpoints, without image or Blender imports at startup."""
from __future__ import annotations
import copy
import json
import math
from pathlib import Path
import re
import threading
from urllib.parse import unquote, urlsplit
import uuid

WRITE_LOCK = threading.RLock()
PICKER_LOCK = threading.Lock()
MAX_BODY = 1024 * 1024


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def manifest_path(root, version):
    value = version.get("characterUrl") or version.get("url")
    if not isinstance(value, str):
        raise ValueError("Versionen mangler sine færdige billeder.")
    parts = urlsplit(value)
    if parts.scheme or parts.netloc or parts.query or parts.fragment:
        raise ValueError("Figurens billeder skal ligge i det lokale bibliotek.")
    target = (root / unquote(parts.path).lstrip("/")).resolve()
    if not target.is_relative_to((root / "assets").resolve()) or target.name != "character.json" or not target.is_file():
        raise ValueError("Figurens færdige billeder kunne ikke findes.")
    return target


def has_animation(document, kind):
    return any(clip.get("kind") == kind and isinstance(clip.get("directions"), list)
               and clip["directions"] and all(isinstance(frames, list) and frames for frames in clip["directions"])
               and isinstance(clip.get("duration"), (int, float)) and clip["duration"] > 0
               for clip in document.get("clips", {}).values() if isinstance(clip, dict))


PIKE_DEFAULTS = {"darkness": 0.0, "opacity": 1.0, "widthScale": 1.0}


def clean_pike_appearance(value):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("Pikens udseende skal indeholde tal for mørkhed, dækevne og bredde.")
    result = {}
    for key, low, high in (("darkness", 0, 1), ("opacity", 0, 2), ("widthScale", .5, 3)):
        number = value.get(key, PIKE_DEFAULTS[key])
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not low <= number <= high:
            raise ValueError("Pikens mørkhed, dækevne eller bredde ligger uden for skydernes interval.")
        result[key] = float(number)
    return result


def appearance_book(root):
    path = Path(root) / "assets/library/appearance.json"
    if not path.is_file():
        return {"schema": "walking-fortress-pike-appearance-v1", "versions": {}}
    result = read_json(path)
    if result.get("schema") != "walking-fortress-pike-appearance-v1" or not isinstance(result.get("versions"), dict):
        raise ValueError("De gemte pikeindstillinger har et ukendt format.")
    return result


def version_appearance(root, character_id, version):
    key = str(character_id) + ":" + str(version["id"])
    value = appearance_book(root)["versions"].get(key, version.get("pikeAppearance"))
    return clean_pike_appearance(value)


def atomic_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save_appearance(root, library, config):
    root = Path(root).resolve()
    character_id, version_id = config.get("characterId"), config.get("versionId")
    character = next((c for c in library.get("characters", []) if c.get("id") == character_id), None)
    version = next((v for v in (character or {}).get("versions", []) if v.get("id") == version_id), None)
    if version is None:
        raise ValueError("Vælg en færdig figurversion, før pikens udseende gemmes.")
    path = manifest_path(root, version)
    document = read_json(path)
    if not document.get("pikeAtlas") and not any(page.get("pikeAtlas") for page in document.get("pages", [])):
        raise ValueError("Denne figurversion har ingen separat pike.")
    appearance = clean_pike_appearance(config.get("pikeAppearance"))
    with WRITE_LOCK:
        book = appearance_book(root)
        book["versions"][str(character_id) + ":" + str(version_id)] = appearance
        atomic_write(root / "assets/library/appearance.json", book)
        registry_path = root / "assets/characters.json"
        registry = read_json(registry_path)
        relative = path.relative_to(root / "assets").as_posix()
        changed = False
        for entry in registry["characters"].values():
            if entry.get("manifest") == relative:
                entry["pikeAppearance"] = appearance
                changed = True
        if changed:
            atomic_write(registry_path, registry)
    return {"saved": True, "characterId": character_id, "versionId": version_id, "pikeAppearance": appearance, "active": changed}


def activate(root, library, config):
    """Change only the active role registry; immutable exports remain in the library."""
    root = Path(root).resolve()
    role = config.get("role")
    character_id, version_id = config.get("characterId"), config.get("versionId")
    if role not in ("pike", "shot"):
        raise ValueError("Vælg pikener eller musketer som figurens plads i formationen.")
    if not isinstance(character_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", character_id):
        raise ValueError("Ugyldig figur.")
    character = next((c for c in library.get("characters", []) if c.get("id") == character_id), None)
    version = next((v for v in (character or {}).get("versions", []) if v.get("id") == version_id), None)
    if version is None:
        raise ValueError("Vælg en færdig version fra biblioteket.")
    path = manifest_path(root, version)
    document = read_json(path)
    if document.get("schema") != "walking-fortress-formation-character-v2" or not all(has_animation(document, kind) for kind in ("idle", "walk")):
        raise ValueError("Formationerne kræver mindst én stilstands- og én ganganimation. Vælg deres type og render dem sammen.")
    with WRITE_LOCK:
        registry_path = root / "assets/characters.json"
        registry = read_json(registry_path)
        if registry.get("schema") != "walking-fortress-characters-v1":
            raise ValueError("Formationsstudioets figurliste har et ukendt format.")
        result = copy.deepcopy(registry)
        result["characters"][character_id] = {"manifest": path.relative_to(root / "assets").as_posix(), "label": character.get("label", character_id)}
        appearance = version_appearance(root, character_id, version)
        result["characters"][character_id]["pikeAppearance"] = appearance
        result["roles"][role] = character_id
        # Passive library figures must not consume textures or require march clips.
        active = set(result["roles"].values())
        if result.get("defaultCharacter") not in active:
            result["defaultCharacter"] = result["roles"]["pike"]
        result["characters"] = {key: value for key, value in result["characters"].items() if key in active}
        temporary = registry_path.with_name("characters." + uuid.uuid4().hex + ".tmp")
        try:
            temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temporary.replace(registry_path)
        finally:
            temporary.unlink(missing_ok=True)
    return {"activated": True, "characterId": character_id, "versionId": version_id, "role": role, "roles": result["roles"]}


def pick_blend():
    if not PICKER_LOCK.acquire(blocking=False):
        raise ValueError("Filvælgeren er allerede åben.")
    window = None
    try:
        import tkinter as tk
        from tkinter import filedialog
        window = tk.Tk()
        window.withdraw()
        window.attributes("-topmost", True)
        path = filedialog.askopenfilename(parent=window, title="Vælg karakterens Blender-fil", filetypes=[("Blender-figurer", "*.blend")])
        return {"path": path} if path else {"cancelled": True}
    except ImportError:
        raise ValueError("Filvælgeren er ikke tilgængelig. Indsæt i stedet stien til din .blend-fil.") from None
    finally:
        if window is not None:
            window.destroy()
        PICKER_LOCK.release()


class LibraryService:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self._jobs = None
        self._lock = threading.Lock()

    @property
    def jobs(self):
        with self._lock:
            if self._jobs is None:
                from library_jobs import LibraryJobs
                self._jobs = LibraryJobs(self.root)
        return self._jobs

    def snapshot(self):
        result = copy.deepcopy(self.jobs.library())
        result["jobs"] = self.jobs.list_jobs()
        result["capabilities"] = {"filePicker": True, "render": True}
        registry = read_json(self.root / "assets/characters.json")
        result["roles"] = registry["roles"]
        for character in result.get("characters", []):
            for version in character.get("versions", []):
                version["pikeAppearance"] = version_appearance(self.root, character["id"], version)
                try:
                    path = manifest_path(self.root, version).relative_to(self.root / "assets").as_posix()
                    version["activeRoles"] = [role for role, cid in registry["roles"].items()
                        if registry["characters"].get(cid, {}).get("manifest") == path]
                except ValueError:
                    version["activeRoles"] = []
        return result

    def close(self):
        if self._jobs is not None:
            self._jobs.close()

    def get(self, path):
        if path == "/api/library":
            return self.snapshot()
        if path == "/api/library/jobs":
            return {"jobs": self.jobs.list_jobs()}
        match = re.fullmatch(r"/api/library/jobs/([A-Za-z0-9_-]{1,80})", path)
        if match:
            return self.jobs.status(match[1])
        raise KeyError("Denne biblioteksadresse findes ikke.")

    def post(self, path, data):
        if path == "/api/library/pick":
            return pick_blend()
        if path == "/api/library/inspect":
            return self.jobs.inspect(data.get("path"), blender=data.get("blender"))
        if path == "/api/library/render":
            return self.jobs.submit(data)
        if path == "/api/library/appearance":
            return save_appearance(self.root, self.jobs.library(), data)
        if path == "/api/library/activate":
            return activate(self.root, self.jobs.library(), data)
        match = re.fullmatch(r"/api/library/jobs/([A-Za-z0-9_-]{1,80})/cancel", path)
        if match:
            return self.jobs.cancel(match[1])
        raise KeyError("Denne biblioteksadresse findes ikke.")
