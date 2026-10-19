"""A small stand-in for Ableton Live's Python object model.

Every class lists its observable properties in `_props`. For each one the
object answers add_<prop>_listener(fn), remove_<prop>_listener(fn) and
<prop>_has_listener(fn), and assigning the property fires its listeners
(always, like a test poking Live). Adding the same listener twice or removing
one that isn't there raises RuntimeError, as Live does.
"""

_ALL = []


def reset():
    del _ALL[:]


def all_objects():
    return list(_ALL)


def total_listeners():
    return sum(o.listener_count() for o in _ALL)


def objects_with_listeners():
    return [o for o in _ALL if o.listener_count()]


class FakeLiveObject(object):
    _props = ()
    _defaults = {}

    def __init__(self, **kwargs):
        object.__setattr__(self, "_values", {})
        object.__setattr__(self, "_listeners", {})
        object.__setattr__(self, "calls", [])
        for prop in self._all_props():
            default = self._all_defaults().get(prop)
            if isinstance(default, list):
                default = list(default)
            self._values[prop] = default
        for name, value in kwargs.items():
            setattr(self, name, value)
        _ALL.append(self)

    @classmethod
    def _all_props(cls):
        props = []
        for klass in reversed(cls.__mro__):
            for p in klass.__dict__.get("_props", ()):
                if p not in props:
                    props.append(p)
        return props

    @classmethod
    def _all_defaults(cls):
        out = {}
        for klass in reversed(cls.__mro__):
            out.update(klass.__dict__.get("_defaults", {}))
        return out

    def __getattr__(self, name):
        props = type(self)._all_props()
        if name.startswith("add_") and name.endswith("_listener") and name[4:-9] in props:
            prop = name[4:-9]
            return lambda fn: self._add_listener(prop, fn)
        if name.startswith("remove_") and name.endswith("_listener") and name[7:-9] in props:
            prop = name[7:-9]
            return lambda fn: self._remove_listener(prop, fn)
        if name.endswith("_has_listener") and name[:-13] in props:
            prop = name[:-13]
            return lambda fn: fn in self._listeners.get(prop, [])
        values = object.__getattribute__(self, "_values")
        if name in values:
            return values[name]
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name in type(self)._all_props():
            self._values[name] = value
            for fn in list(self._listeners.get(name, [])):
                fn()
        else:
            object.__setattr__(self, name, value)

    def _add_listener(self, prop, fn):
        listeners = self._listeners.setdefault(prop, [])
        if fn in listeners:
            raise RuntimeError("Listener already connected")
        listeners.append(fn)

    def _remove_listener(self, prop, fn):
        listeners = self._listeners.get(prop, [])
        if fn not in listeners:
            raise RuntimeError("Listener not connected")
        listeners.remove(fn)

    def listener_count(self, prop=None):
        if prop is not None:
            return len(self._listeners.get(prop, []))
        return sum(len(v) for v in self._listeners.values())


class Application(FakeLiveObject):
    def __init__(self, major=12, minor=4, bugfix=6, **kwargs):
        FakeLiveObject.__init__(self, **kwargs)
        object.__setattr__(self, "_version", (major, minor, bugfix))

    def get_major_version(self):
        return self._version[0]

    def get_minor_version(self):
        return self._version[1]

    def get_bugfix_version(self):
        return self._version[2]


class DeviceParameter(FakeLiveObject):
    _props = ("name", "value", "min", "max", "is_quantized", "value_items")
    _defaults = {"name": "", "value": 0.0, "min": 0.0, "max": 1.0, "is_quantized": False,
                 "value_items": []}

    def __str__(self):
        items = self.value_items or []
        if self.is_quantized and items:
            i = int(self.value)
            if 0 <= i < len(items):
                return str(items[i])
        return "%.2f" % self.value


class Device(FakeLiveObject):
    _props = ("name", "parameters")
    _defaults = {"name": "", "parameters": ()}
    can_have_chains = False
    class_name = "FakeDevice"


class Chain(FakeLiveObject):
    _props = ("name", "devices", "color")
    _defaults = {"name": "", "devices": (), "color": 0}


class RackDevice(Device):
    _props = ("chains",)
    _defaults = {"chains": ()}
    can_have_chains = True
    class_name = "AudioEffectGroupDevice"


class Clip(FakeLiveObject):
    _props = ("name", "color")
    _defaults = {"name": "", "color": 0}


class ClipSlot(FakeLiveObject):
    _props = ("has_clip", "clip")
    _defaults = {"has_clip": False, "clip": None}

    def fire(self):
        self.calls.append("fire")


class TrackView(FakeLiveObject):
    _props = ("selected_device",)


class Track(FakeLiveObject):
    _props = ("name", "color", "devices", "clip_slots", "fired_slot_index",
              "playing_slot_index")
    _defaults = {"name": "", "color": 0, "devices": (), "clip_slots": (),
                 "fired_slot_index": -1, "playing_slot_index": -1}

    def __init__(self, **kwargs):
        object.__setattr__(self, "view", None)
        FakeLiveObject.__init__(self, **kwargs)
        object.__setattr__(self, "view", TrackView())


class Scene(FakeLiveObject):
    _props = ("name", "color", "is_triggered")
    _defaults = {"name": "", "color": 0, "is_triggered": False}

    def fire(self):
        self.calls.append("fire")


class OldScene(FakeLiveObject):
    """A scene from a Live without is_triggered."""
    _props = ("name", "color")
    _defaults = {"name": "", "color": 0}

    def fire(self):
        self.calls.append("fire")


class SongView(FakeLiveObject):
    _props = ("selected_parameter", "selected_track", "selected_scene")


class Song(FakeLiveObject):
    _props = ("tracks", "return_tracks", "scenes", "is_playing", "tempo",
              "signature_numerator", "signature_denominator", "current_song_time", "name")
    _defaults = {"tracks": (), "return_tracks": (), "scenes": (), "is_playing": False,
                 "tempo": 120.0, "signature_numerator": 4, "signature_denominator": 4,
                 "current_song_time": 0.0, "name": ""}

    def __init__(self, **kwargs):
        master = kwargs.pop("master_track", None)
        FakeLiveObject.__init__(self, **kwargs)
        object.__setattr__(self, "view", SongView())
        object.__setattr__(self, "master_track", master if master is not None else Track(name="Master"))

    def stop_all_clips(self):
        self.calls.append("stop_all_clips")

    def tap_tempo(self):
        self.calls.append("tap_tempo")


# ---------------------------------------------------------------- builders

def make_params(names, values=None):
    params = [DeviceParameter(name="Device On", value=1.0, min=0.0, max=1.0, is_quantized=True,
                              value_items=["Off", "On"])]
    for i, name in enumerate(names):
        value = values[i] if values else 0.0
        params.append(DeviceParameter(name=name, value=value, min=0.0, max=1.0))
    return tuple(params)


def make_device(name, param_names=("Frequency", "Resonance")):
    return Device(name=name, parameters=make_params(param_names))


def make_rack(name, chains, macros=8):
    params = [DeviceParameter(name="Device On", value=1.0, is_quantized=True,
                              value_items=["Off", "On"])]
    for i in range(macros):
        params.append(DeviceParameter(name="Macro %d" % (i + 1), value=0.0, min=0.0, max=127.0))
    params.append(DeviceParameter(name="Chain Selector", value=0.0, min=0.0, max=127.0))
    return RackDevice(name=name, parameters=tuple(params), chains=tuple(chains))


def make_chain(name, devices):
    return Chain(name=name, devices=tuple(devices))


def make_track(name, devices=(), slots=4, clips=None, color=0):
    """clips: {slot index: (clip name, colour)}"""
    clips = clips or {}
    clip_slots = []
    for i in range(slots):
        if i in clips:
            clip_name, clip_colour = clips[i]
            clip_slots.append(ClipSlot(has_clip=True, clip=Clip(name=clip_name, color=clip_colour)))
        else:
            clip_slots.append(ClipSlot())
    return Track(name=name, color=color, devices=tuple(devices), clip_slots=tuple(clip_slots))


def make_song(tracks=(), returns=(), scenes=(), **kwargs):
    if scenes and isinstance(scenes[0], str):
        scenes = [Scene(name=s) for s in scenes]
    song = Song(tracks=tuple(tracks), return_tracks=tuple(returns), scenes=tuple(scenes), **kwargs)
    if tracks:
        song.view.selected_track = tracks[0]
    if scenes:
        song.view.selected_scene = scenes[0]
    return song
