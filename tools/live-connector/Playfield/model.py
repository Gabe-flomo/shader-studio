# Playfield Live connector: pure logic over Live's object model.
#
# Everything here works on duck-typed objects (the real Live API, or the
# fakes in tests/fake_live.py). Nothing here adds listeners or sends.

TRACK_SEP = " / "
DEVICE_SEP = " > "
MASTER_NAME = "Master"
RACK_NAME = "playfield"
# Top-level devices are depth 1; a rack's chains are walked while the rack's
# depth is below this, so devices nested up to 4 levels deep are catalogued.
MAX_RACK_DEPTH = 4
MAX_SELECTED_KEYS = 64


def safe_get(obj, name, default=None):
    """getattr that also survives Live raising RuntimeError on a stale object."""
    try:
        return getattr(obj, name)
    except Exception:
        return default


def safe_list(obj, name):
    try:
        value = getattr(obj, name)
        if value is None:
            return []
        return list(value)
    except Exception:
        return []


def obj_id(obj):
    """A stable identity for a Live object. Live's Python wrappers carry
    `_live_ptr` (the underlying object's address); fakes fall back to id()."""
    ptr = safe_get(obj, "_live_ptr", None)
    if ptr is not None:
        return ("ptr", ptr)
    return ("id", id(obj))


def same_object(a, b):
    if a is None or b is None:
        return False
    if a is b:
        return True
    return obj_id(a) == obj_id(b)


def as_text(value):
    if value is None:
        return ""
    try:
        return str(value)
    except Exception:
        return ""


def as_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def as_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def dedupe(names):
    """Keeps the first of each name, suffixes later twins " #2", " #3"...
    The result is always unique, even if a name already ends in " #2"."""
    used = set()
    counts = {}
    out = []
    for name in names:
        if name not in used:
            used.add(name)
            counts.setdefault(name, 1)
            out.append(name)
            continue
        n = counts.get(name, 1)
        while True:
            n += 1
            candidate = "%s #%d" % (name, n)
            if candidate not in used:
                break
        counts[name] = n
        used.add(candidate)
        out.append(candidate)
    return out


def make_key(track, device_path, param):
    return TRACK_SEP.join((track, device_path, param))


def is_playfield_rack(device):
    if not safe_get(device, "can_have_chains", False):
        return False
    return as_text(safe_get(device, "name", "")).lower() == RACK_NAME


def is_macro_param(index, param):
    if index == 0:
        return False  # "Device On"
    return as_text(safe_get(param, "name", "")) != "Chain Selector"


def live_version(application):
    if application is None:
        return ""
    parts = []
    for method, attr in (("get_major_version", "major_version"),
                         ("get_minor_version", "minor_version"),
                         ("get_bugfix_version", "bugfix_version")):
        value = None
        fn = safe_get(application, method, None)
        if callable(fn):
            try:
                value = fn()
            except Exception:
                value = None
        if value is None:
            value = safe_get(application, attr, None)
        if value is None:
            return ""
        parts.append(str(as_int(value)))
    return ".".join(parts)


def set_name(song):
    return as_text(safe_get(song, "name", ""))


# ---------------------------------------------------------------- parameters

def param_display(param):
    try:
        text = str(param)
        if text:
            return text
    except Exception:
        pass
    fn = safe_get(param, "str_for_value", None)
    if callable(fn):
        try:
            return as_text(fn(safe_get(param, "value", 0.0)))
        except Exception:
            pass
    return "%.4g" % as_float(safe_get(param, "value", 0.0))


def param_state(param):
    """(value, min, max, quantized 0/1, items string)"""
    value = as_float(safe_get(param, "value", 0.0))
    lo = as_float(safe_get(param, "min", 0.0))
    hi = as_float(safe_get(param, "max", 1.0))
    quantized = 1 if safe_get(param, "is_quantized", False) else 0
    items = ""
    if quantized:
        items = "|".join(as_text(i) for i in safe_list(param, "value_items"))
    return value, lo, hi, quantized, items


# ---------------------------------------------------------------- catalogue

class TrackEntry(object):
    def __init__(self, index, name, raw_name, colour, kind, track, kind_index):
        self.index = index
        self.name = name
        self.raw_name = raw_name
        self.colour = colour
        self.kind = kind
        self.track = track
        self.kind_index = kind_index  # index among tracks of the same kind


class SceneEntry(object):
    def __init__(self, index, name, colour, scene):
        self.index = index
        self.name = name
        self.colour = colour
        self.scene = scene


class DeviceEntry(object):
    def __init__(self, track_entry, path, device, depth, chains, playfield_rack):
        self.track_entry = track_entry
        self.path = path
        self.device = device
        self.depth = depth
        self.chains = chains  # chain objects of a rack (walked or not)
        self.keys = []
        self.is_playfield_rack = playfield_rack


class ParamEntry(object):
    def __init__(self, key, track, device, name, param, device_entry, role, index):
        self.key = key
        self.track = track
        self.device = device
        self.name = name
        self.param = param
        self.device_entry = device_entry
        self.role = role
        self.index = index


class Catalogue(object):
    def __init__(self):
        self.tracks = []
        self.scenes = []
        self.devices = []
        self.params = []
        self.by_key = {}
        self.by_param_id = {}
        self.by_device_id = {}
        self.by_track_id = {}
        self.rack_keys = []

    def track_for(self, track):
        return self.by_track_id.get(obj_id(track))

    def device_for(self, device):
        return self.by_device_id.get(obj_id(device))

    def param_for(self, param):
        return self.by_param_id.get(obj_id(param))

    def regular_tracks(self):
        return [t for t in self.tracks if t.kind == "track"]


def track_list(song):
    """[(track, kind)] in catalogue order: tracks, returns, master."""
    out = [(t, "track") for t in safe_list(song, "tracks")]
    out.extend((t, "return") for t in safe_list(song, "return_tracks"))
    master = safe_get(song, "master_track", None)
    if master is not None:
        out.append((master, "master"))
    return out


def track_entries(song):
    listed = track_list(song)
    raw = []
    for track, kind in listed:
        if kind == "master":
            raw.append(MASTER_NAME)
        else:
            raw.append(as_text(safe_get(track, "name", "")))
    names = dedupe(raw)
    entries = []
    counts = {}
    for i, (track, kind) in enumerate(listed):
        k = counts.get(kind, 0)
        counts[kind] = k + 1
        entries.append(TrackEntry(i, names[i], raw[i], as_int(safe_get(track, "color", 0)),
                                  kind, track, k))
    return entries


def scene_entries(song):
    out = []
    for i, scene in enumerate(safe_list(song, "scenes")):
        out.append(SceneEntry(i, as_text(safe_get(scene, "name", "")),
                              as_int(safe_get(scene, "color", 0)), scene))
    return out


def _walk_devices(devices, prefix, depth, track_entry, out):
    names = dedupe([as_text(safe_get(d, "name", "")) for d in devices])
    for device, name in zip(devices, names):
        path = name if not prefix else prefix + DEVICE_SEP + name
        is_rack = bool(safe_get(device, "can_have_chains", False))
        chains = safe_list(device, "chains") if is_rack else []
        entry = DeviceEntry(track_entry, path, device, depth, chains, is_playfield_rack(device))
        out.append(entry)
        if is_rack and depth < MAX_RACK_DEPTH:
            chain_names = dedupe([as_text(safe_get(c, "name", "")) for c in chains])
            for chain, chain_name in zip(chains, chain_names):
                _walk_devices(safe_list(chain, "devices"), path + DEVICE_SEP + chain_name,
                              depth + 1, track_entry, out)


def build_catalogue(song, log=None):
    cat = Catalogue()
    cat.tracks = track_entries(song)
    cat.scenes = scene_entries(song)
    for t in cat.tracks:
        cat.by_track_id[obj_id(t.track)] = t
        try:
            _walk_devices(safe_list(t.track, "devices"), "", 1, t, cat.devices)
        except Exception as e:
            if log is not None:
                log("catalogue: skipped devices of %s: %s" % (t.name, e))
    for d in cat.devices:
        cat.by_device_id[obj_id(d.device)] = d
        params = safe_list(d.device, "parameters")
        names = dedupe([as_text(safe_get(p, "name", "")) for p in params])
        for index, (param, name) in enumerate(zip(params, names)):
            key = make_key(d.track_entry.name, d.path, name)
            role = "rack" if (d.is_playfield_rack and is_macro_param(index, param)) else ""
            entry = ParamEntry(key, d.track_entry.name, d.path, name, param, d, role, index)
            if key in cat.by_key:
                # Only possible with odd names (e.g. " / " inside a name); keep the first.
                continue
            cat.params.append(entry)
            cat.by_key[key] = entry
            cat.by_param_id[obj_id(param)] = entry
            d.keys.append(key)
            if role == "rack":
                cat.rack_keys.append(key)
    return cat


def selected_device_keys(cat, device):
    entry = cat.device_for(device) if device is not None else None
    if entry is None:
        return []
    return list(entry.keys[:MAX_SELECTED_KEYS])


# ---------------------------------------------------------------- lookups

def find_regular_track(song, ref):
    """ref: an int index among regular tracks, or a name (key-style with " #2",
    or the raw name). Returns (index, track, name) or None."""
    entries = [t for t in track_entries(song) if t.kind == "track"]
    if isinstance(ref, bool):
        return None
    if isinstance(ref, (int, float)):
        i = int(ref)
        if 0 <= i < len(entries):
            e = entries[i]
            return e.kind_index, e.track, e.name
        return None
    ref = as_text(ref)
    for e in entries:
        if e.name == ref:
            return e.kind_index, e.track, e.name
    for e in entries:
        if e.raw_name == ref:
            return e.kind_index, e.track, e.name
    return None


def find_clip_slot(track, ref):
    """ref: int slot index or a clip name. Returns (slot_index, clip_slot) or None."""
    slots = safe_list(track, "clip_slots")
    if isinstance(ref, bool):
        return None
    if isinstance(ref, (int, float)):
        i = int(ref)
        if 0 <= i < len(slots):
            return i, slots[i]
        return None
    ref = as_text(ref)
    for i, slot in enumerate(slots):
        if not safe_get(slot, "has_clip", False):
            continue
        clip = safe_get(slot, "clip", None)
        if clip is not None and as_text(safe_get(clip, "name", "")) == ref:
            return i, slot
    return None


def find_scene(song, ref):
    scenes = safe_list(song, "scenes")
    if isinstance(ref, bool):
        return None
    if isinstance(ref, (int, float)):
        i = int(ref)
        if 0 <= i < len(scenes):
            return i, scenes[i]
        return None
    ref = as_text(ref)
    raw = [as_text(safe_get(s, "name", "")) for s in scenes]
    for i, name in enumerate(raw):
        if name == ref:
            return i, scenes[i]
    for i, name in enumerate(dedupe(raw)):
        if name == ref:
            return i, scenes[i]
    return None


def index_of(items, obj):
    for i, item in enumerate(items):
        if same_object(item, obj):
            return i
    return -1


def clip_info(track, slot_index):
    """(clip name, colour) for a slot, or ("", 0)."""
    slots = safe_list(track, "clip_slots")
    if not (0 <= slot_index < len(slots)):
        return "", 0
    slot = slots[slot_index]
    if not safe_get(slot, "has_clip", False):
        return "", 0
    clip = safe_get(slot, "clip", None)
    if clip is None:
        return "", 0
    return as_text(safe_get(clip, "name", "")), as_int(safe_get(clip, "color", 0))
