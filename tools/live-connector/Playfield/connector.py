# Playfield Live connector: the core.
#
# Connector owns the listener bookkeeping, the catalogue, the watched
# parameters and the command handling. It never touches sockets: it gets a
# send function (bytes -> None), a log function, and a clock (seconds), so
# the tests can drive it with fakes.
#
# Rules this file follows (see CREDITS.txt for where they come from):
# - Live listeners only record state, queue work or send UDP. They never
#   change the song and never add or remove listeners.
# - Everything else happens in tick(), which Live calls about every 100 ms on
#   its main thread. tick() never raises.
# - Every listener added is recorded and removed on rebuild and disconnect.

import random

from . import model
from . import osc

PROTOCOL_HELLO_INTERVAL = 1.0
PARAM_THROTTLE = 0.015
TRANSPORT_THROTTLE = 0.035
BUNDLE_LIMIT = 8000
CATALOG_BUNDLES_PER_TICK = 8
MAX_COMMANDS_PER_TICK = 256
COUNTER_WRAP = 2 ** 31

STRUCTURE = "structure"
SONG = "song"
SELECTED = "selected"


class Connector(object):
    def __init__(self, song, application, send_fn, log_fn, clock_fn, script_version=None):
        if script_version is None:
            from . import VERSION
            script_version = VERSION
        self._song = song
        self._application = application
        self._send_fn = send_fn
        self._log_fn = log_fn
        self._clock = clock_fn
        self._version = script_version

        self._listeners = {SONG: [], STRUCTURE: [], SELECTED: []}
        self._param_hooks = {}  # key -> (param, fn)

        self.catalog = model.Catalogue()
        self.catalog_gen = 0
        self._catalog_queue = []
        self._structure_dirty = False
        self._selected_rehook = False
        self._selected_send = False
        self._watch_dirty = False

        self._watch_keys = []        # from /pf/watch
        self._selected_keys = []     # params of the selected device
        self._watched = set()
        self._pending = []           # keys waiting to send, in order
        self._pending_set = set()
        self._last_param_send = {}

        self._transport_counter = 0
        self._last_transport = None
        self._last_hello = None
        self._playing_slot = {}      # obj_id(track) -> slot index or -1
        self._selected_track = None

        # Playfield Send devices: /pf/sends goes out when its content changes
        # (checked on the tick after the catalogue drains) or on request.
        self.sends = []
        self._sends_dirty = False
        self._sends_force = False
        self._last_sends = None
        self._random = random.Random()

        self._commands = []
        self._started = False
        self._closed = False
        self._send_errors = 0

    # ------------------------------------------------------------ plumbing

    def log(self, text):
        try:
            self._log_fn(text)
        except Exception:
            pass

    def now(self):
        try:
            return float(self._clock())
        except Exception:
            return 0.0

    def _send_raw(self, data):
        try:
            self._send_fn(data)
        except Exception as e:
            self._send_errors += 1
            if self._send_errors <= 5 or self._send_errors % 100 == 0:
                self.log("send failed (%d): %s" % (self._send_errors, e))

    def send(self, address, args=()):
        try:
            data = osc.encode_message(address, args)
        except Exception as e:
            self.log("encode %s failed: %s" % (address, e))
            return
        self._send_raw(data)

    def _send_many(self, encoded):
        for bundle in osc.pack_bundles(encoded, BUNDLE_LIMIT, self.log):
            self._send_raw(bundle)

    def _safe(self, label, fn, *args):
        try:
            return fn(*args)
        except Exception as e:
            self.log("%s failed: %s" % (label, e))
            return None

    def _add_listener(self, group, obj, prop, fn):
        """Adds and records a listener; quietly skips properties this Live
        doesn't have. Returns True when added."""
        if obj is None:
            return False
        try:
            adder = getattr(obj, "add_%s_listener" % prop, None)
        except Exception:
            adder = None
        if adder is None:
            return False
        try:
            has = getattr(obj, "%s_has_listener" % prop, None)
            if has is not None and has(fn):
                return False
            adder(fn)
        except Exception as e:
            self.log("add %s listener failed: %s" % (prop, e))
            return False
        self._listeners[group].append((obj, prop, fn))
        return True

    def _remove_one(self, obj, prop, fn):
        try:
            has = getattr(obj, "%s_has_listener" % prop, None)
            if has is not None and not has(fn):
                return
            getattr(obj, "remove_%s_listener" % prop)(fn)
        except Exception as e:
            # Typically the object was deleted from the set; nothing to remove.
            self.log("remove %s listener skipped: %s" % (prop, e))

    def _remove_group(self, group):
        entries = self._listeners.get(group, [])
        self._listeners[group] = []
        for obj, prop, fn in entries:
            self._remove_one(obj, prop, fn)

    def _remove_param_hooks(self, keys=None):
        if keys is None:
            keys = list(self._param_hooks.keys())
        for key in keys:
            hook = self._param_hooks.pop(key, None)
            if hook is not None:
                self._remove_one(hook[0], "value", hook[1])

    def listener_count(self):
        return sum(len(v) for v in self._listeners.values()) + len(self._param_hooks)

    # ------------------------------------------------------------ lifecycle

    def start(self):
        if self._started:
            return
        self._started = True
        self._safe("hook song", self._hook_song)
        self._safe("rebuild", self._rebuild)
        self._safe("selected track", self._rehook_selected)
        self._safe("selected device", self._send_selected_device)
        self._selected_rehook = False
        self._selected_send = False
        self._safe("watch", self._update_watched)
        self._safe("hello", self.send_hello)
        self._safe("transport", self.send_transport)
        self._safe("params", self._flush_params)
        self._safe("catalogue", self._drain_catalogue)
        # /pf/sends waits for the first tick: start() runs inside the surface's
        # constructor, where a duplicate pairing id must not be changed yet.

    def disconnect(self):
        if self._closed:
            return
        self._closed = True
        for group in list(self._listeners.keys()):
            self._safe("remove listeners", self._remove_group, group)
        self._safe("remove param listeners", self._remove_param_hooks)
        self._commands = []
        self._catalog_queue = []
        self.send("/pf/bye")

    def receive(self, data):
        """Queues a datagram from Playfield; it is handled in the next tick."""
        if self._closed:
            return
        if len(self._commands) >= 1024:
            self.log("command queue full; dropped a datagram")
            return
        self._commands.append(bytes(data))

    def tick(self):
        if self._closed:
            return
        try:
            if not self._started:
                self.start()
            self._safe("commands", self._process_commands)
            if self._structure_dirty:
                self._structure_dirty = False
                self._safe("rebuild", self._rebuild)
            if self._selected_rehook:
                self._selected_rehook = False
                self._safe("selected track", self._rehook_selected)
            if self._selected_send:
                self._selected_send = False
                self._safe("selected device", self._send_selected_device)
            if self._watch_dirty:
                self._safe("watch", self._update_watched)
            self._safe("params", self._flush_params)
            if self._is_playing():
                self._safe("transport", self.send_transport)
            now = self.now()
            if self._last_hello is None or now - self._last_hello >= PROTOCOL_HELLO_INTERVAL:
                self._safe("hello", self.send_hello)
            self._safe("catalogue", self._drain_catalogue)
            self._safe("sends", self._maybe_send_sends)
        except Exception as e:  # belt and braces: the tick must never raise
            self.log("tick failed: %s" % e)

    # ------------------------------------------------------------ hello

    def send_hello(self):
        self._last_hello = self.now()
        self.send("/pf/hello", [
            ("s", self._version),
            ("s", model.live_version(self._application)),
            ("s", model.set_name(self._song)),
            ("i", self.catalog_gen),
        ])

    # ------------------------------------------------------------ catalogue

    def _rebuild(self):
        self._remove_group(STRUCTURE)
        cat = model.build_catalogue(self._song, self.log)
        self.catalog = cat
        self.catalog_gen += 1
        self._hook_structure(cat)
        # Watched params and the selected device may point at new objects.
        self._remove_param_hooks()
        self._watch_dirty = True
        self._selected_rehook = True
        self._selected_send = True
        self._sends_dirty = True
        self._queue_catalogue()

    def _catalogue_messages(self):
        cat = self.catalog
        gen = self.catalog_gen
        out = [osc.encode_message("/pf/catalog/begin", [("i", gen), ("i", len(cat.params))])]
        for t in cat.tracks:
            out.append(osc.encode_message("/pf/catalog/track", [
                ("i", t.index), ("s", t.name), ("i", t.colour), ("s", t.kind)]))
        for s in cat.scenes:
            out.append(osc.encode_message("/pf/catalog/scene", [
                ("i", s.index), ("s", s.name), ("i", s.colour)]))
        for p in cat.params:
            try:
                value, lo, hi, quantized, items = model.param_state(p.param)
                out.append(osc.encode_message("/pf/catalog/param", [
                    ("s", p.key), ("s", p.track), ("s", p.device), ("s", p.name),
                    ("f", lo), ("f", hi), ("i", quantized), ("f", value),
                    ("s", items), ("s", p.role)]))
            except Exception as e:
                self.log("catalogue: skipped %s: %s" % (p.key, e))
        out.append(osc.encode_message("/pf/catalog/end", [("i", gen)]))
        return out

    def _queue_catalogue(self):
        # A newer catalogue replaces one still being sent.
        self._catalog_queue = osc.pack_bundles(self._catalogue_messages(), BUNDLE_LIMIT, self.log)

    def _drain_catalogue(self):
        count = 0
        while self._catalog_queue and count < CATALOG_BUNDLES_PER_TICK:
            self._send_raw(self._catalog_queue.pop(0))
            count += 1

    def catalogue_pending(self):
        return len(self._catalog_queue)

    # ------------------------------------------------------------ Playfield Send

    def _mark_sends_dirty(self):
        self._sends_dirty = True

    def _maybe_send_sends(self):
        """Runs on the tick only (never from a listener): it may change ids."""
        if not (self._sends_dirty or self._sends_force):
            return
        if self._catalog_queue:
            return  # after the catalogue, so the app knows the tracks
        self._check_sends(self._sends_force)

    def _check_sends(self, force=False):
        self._sends_dirty = False
        self._sends_force = False
        entries = model.send_entries(self.catalog)
        self._fix_duplicate_ids(entries)
        self.sends = entries
        args = []
        for e in entries:
            if e.id is None:
                continue
            args.extend([("i", e.id), ("s", e.track), ("i", e.colour), ("i", e.track_index),
                         ("s", e.kind)])
        content = tuple(args)
        if not force and content == self._last_sends:
            return
        self._last_sends = content
        self.send("/pf/sends", args)

    def _fix_duplicate_ids(self, entries):
        """Gives a later Playfield Send that repeats an earlier one's id a fresh
        unused id (the plugin re-rolls itself; this is the backup)."""
        used = set(e.id for e in entries if e.id is not None)
        seen = set()
        for e in entries:
            if e.id is None:
                continue
            if e.id not in seen:
                seen.add(e.id)
                continue
            if len(used) > model.PAIRING_MAX:
                self.log("Playfield Send: no free pairing id for %s" % e.track)
                continue
            new_id = self._random.randint(0, model.PAIRING_MAX)
            while new_id in used:
                new_id = self._random.randint(0, model.PAIRING_MAX)
            try:
                e.param.value = model.pairing_value(e.param, new_id)
            except Exception as err:
                self.log("Playfield Send on %s: could not change pairing id %d: %s"
                         % (e.track, e.id, err))
                continue
            self.log("Playfield Send on %s: pairing id %d was taken, now %d"
                     % (e.track, e.id, new_id))
            used.add(new_id)
            seen.add(new_id)
            e.id = new_id

    # ------------------------------------------------------------ listeners

    def _mark_dirty(self):
        self._structure_dirty = True

    def _hook_song(self):
        song = self._song
        for prop in ("tracks", "return_tracks", "scenes"):
            self._add_listener(SONG, song, prop, self._mark_dirty)
        for prop in ("is_playing", "tempo", "signature_numerator", "signature_denominator"):
            self._add_listener(SONG, song, prop, self._on_transport_change)
        self._add_listener(SONG, song, "current_song_time", self._on_song_time)
        view = model.safe_get(song, "view", None)
        if view is not None:
            self._add_listener(SONG, view, "selected_parameter", self._on_selected_parameter)
            self._add_listener(SONG, view, "selected_track", self._on_selected_track)

    def _hook_structure(self, cat):
        self._playing_slot = {}
        for t in cat.tracks:
            track = t.track
            self._add_listener(STRUCTURE, track, "name", self._track_listener(track, True))
            self._add_listener(STRUCTURE, track, "color", self._track_listener(track, False))
            self._add_listener(STRUCTURE, track, "devices", self._mark_dirty)
            if t.kind == "track":
                self._playing_slot[model.obj_id(track)] = model.as_int(
                    model.safe_get(track, "playing_slot_index", -1), -1)
                self._add_listener(STRUCTURE, track, "fired_slot_index", self._fired_listener(track))
                self._add_listener(STRUCTURE, track, "playing_slot_index", self._playing_listener(track))
        for d in cat.devices:
            self._add_listener(STRUCTURE, d.device, "name", self._mark_dirty)
            self._add_listener(STRUCTURE, d.device, "parameters", self._mark_dirty)
            if model.is_playfield_send(d.device):
                param = model.pairing_param(d.device)
                if param is not None:
                    self._add_listener(STRUCTURE, param, "value", self._mark_sends_dirty)
            if model.safe_get(d.device, "can_have_chains", False):
                self._add_listener(STRUCTURE, d.device, "chains", self._mark_dirty)
                for chain in d.chains:
                    self._add_listener(STRUCTURE, chain, "name", self._mark_dirty)
                    self._add_listener(STRUCTURE, chain, "devices", self._mark_dirty)
        for s in cat.scenes:
            self._add_listener(STRUCTURE, s.scene, "name", self._mark_dirty)
            if hasattr(s.scene, "add_is_triggered_listener"):
                self._add_listener(STRUCTURE, s.scene, "is_triggered", self._scene_listener(s.scene))

    # ------------------------------------------------------------ tracks

    def _track_position(self, track):
        """(catalogue index, key-style name, colour) from the song as it is now."""
        for t in model.track_entries(self._song):
            if model.same_object(t.track, track):
                return t.index, t.name, t.colour
        return -1, model.as_text(model.safe_get(track, "name", "")), 0

    def _track_listener(self, track, is_name):
        def on_change():
            try:
                index, name, colour = self._track_position(track)
                if index >= 0:
                    self.send("/pf/track", [("i", index), ("s", name), ("i", colour)])
                self._sends_dirty = True
                if is_name:
                    self._structure_dirty = True
            except Exception as e:
                self.log("track listener: %s" % e)
        return on_change

    # ------------------------------------------------------------ clips

    def _regular_track_position(self, track):
        entries = [t for t in model.track_entries(self._song) if t.kind == "track"]
        for t in entries:
            if model.same_object(t.track, track):
                return t.kind_index, t.name
        return -1, model.as_text(model.safe_get(track, "name", ""))

    def _send_clip(self, track, slot, state):
        index, name = self._regular_track_position(track)
        clip_name, colour = model.clip_info(track, slot)
        self.send("/pf/clip", [("i", index), ("s", name), ("i", slot), ("s", state),
                               ("s", clip_name), ("i", colour)])

    def _fired_listener(self, track):
        def on_fired():
            try:
                slot = model.as_int(model.safe_get(track, "fired_slot_index", -1), -1)
                if slot >= 0:
                    self._send_clip(track, slot, "triggered")
            except Exception as e:
                self.log("fired listener: %s" % e)
        return on_fired

    def _playing_listener(self, track):
        tid = model.obj_id(track)

        def on_playing():
            try:
                slot = model.as_int(model.safe_get(track, "playing_slot_index", -1), -1)
                previous = self._playing_slot.get(tid, -1)
                if slot >= 0:
                    self._playing_slot[tid] = slot
                    self._send_clip(track, slot, "playing")
                else:
                    self._playing_slot[tid] = -1
                    if previous >= 0:
                        self._send_clip(track, previous, "stopped")
            except Exception as e:
                self.log("playing listener: %s" % e)
        return on_playing

    # ------------------------------------------------------------ scenes

    def _scene_listener(self, scene):
        def on_triggered():
            try:
                if not model.safe_get(scene, "is_triggered", False):
                    return
                scenes = model.safe_list(self._song, "scenes")
                index = model.index_of(scenes, scene)
                self.send("/pf/scene", [
                    ("i", index), ("s", model.as_text(model.safe_get(scene, "name", ""))),
                    ("i", model.as_int(model.safe_get(scene, "color", 0)))])
            except Exception as e:
                self.log("scene listener: %s" % e)
        return on_triggered

    # ------------------------------------------------------------ transport

    def _is_playing(self):
        return bool(model.safe_get(self._song, "is_playing", False))

    def send_transport(self):
        song = self._song
        self._last_transport = self.now()
        self._transport_counter = (self._transport_counter + 1) % COUNTER_WRAP
        self.send("/pf/transport", [
            ("i", 1 if self._is_playing() else 0),
            ("f", model.as_float(model.safe_get(song, "tempo", 120.0), 120.0)),
            ("d", model.as_float(model.safe_get(song, "current_song_time", 0.0))),
            ("i", model.as_int(model.safe_get(song, "signature_numerator", 4), 4)),
            ("i", model.as_int(model.safe_get(song, "signature_denominator", 4), 4)),
            ("i", self._transport_counter),
        ])

    def _on_transport_change(self):
        try:
            self.send_transport()
        except Exception as e:
            self.log("transport listener: %s" % e)

    def _on_song_time(self):
        try:
            if not self._is_playing():
                return
            now = self.now()
            if self._last_transport is None or now - self._last_transport >= TRANSPORT_THROTTLE:
                self.send_transport()
        except Exception as e:
            self.log("song time listener: %s" % e)

    # ------------------------------------------------------------ selection

    def _on_selected_parameter(self):
        try:
            view = model.safe_get(self._song, "view", None)
            param = model.safe_get(view, "selected_parameter", None)
            if param is None:
                return
            entry = self.catalog.param_for(param)
            if entry is None:
                return
            value, lo, hi, _q, _items = model.param_state(entry.param)
            self.send("/pf/selected/param", [
                ("s", entry.key), ("s", entry.track), ("s", entry.device), ("s", entry.name),
                ("f", value), ("f", lo), ("f", hi), ("s", model.param_display(entry.param))])
        except Exception as e:
            self.log("selected parameter listener: %s" % e)

    def _on_selected_track(self):
        self._selected_rehook = True

    def _on_selected_device(self):
        self._selected_send = True

    def _rehook_selected(self):
        self._remove_group(SELECTED)
        view = model.safe_get(self._song, "view", None)
        track = model.safe_get(view, "selected_track", None)
        self._selected_track = track
        track_view = model.safe_get(track, "view", None)
        if track_view is not None:
            self._add_listener(SELECTED, track_view, "selected_device", self._on_selected_device)
        self._selected_send = True

    def _send_selected_device(self):
        track = self._selected_track
        track_view = model.safe_get(track, "view", None)
        device = model.safe_get(track_view, "selected_device", None)
        track_entry = self.catalog.track_for(track) if track is not None else None
        track_name = track_entry.name if track_entry is not None else ""
        device_entry = self.catalog.device_for(device) if device is not None else None
        device_path = device_entry.path if device_entry is not None else ""
        keys = model.selected_device_keys(self.catalog, device)
        if keys != self._selected_keys:
            self._selected_keys = keys
            self._watch_dirty = True
        self.send("/pf/selected/device", [("s", track_name), ("s", device_path)] + [("s", k) for k in keys])

    # ------------------------------------------------------------ watching

    def watched_keys(self):
        return set(self._watched)

    def _wanted_keys(self):
        wanted = []
        seen = set()
        for key in list(self.catalog.rack_keys) + list(self._selected_keys) + list(self._watch_keys):
            if key in seen or key not in self.catalog.by_key:
                continue
            seen.add(key)
            wanted.append(key)
        return wanted

    def _update_watched(self):
        self._watch_dirty = False
        wanted = self._wanted_keys()
        wanted_set = set(wanted)
        stale = []
        for key, (param, _fn) in self._param_hooks.items():
            entry = self.catalog.by_key.get(key)
            if key not in wanted_set or entry is None or not model.same_object(entry.param, param):
                stale.append(key)
        self._remove_param_hooks(stale)
        for key in wanted:
            if key in self._param_hooks:
                continue
            param = self.catalog.by_key[key].param
            fn = self._param_listener(key)
            if self._add_listener_param(key, param, fn) and key not in self._watched:
                self._mark_pending(key)
        for key in list(self._pending):
            if key not in wanted_set:
                self._pending_set.discard(key)
        self._pending = [k for k in self._pending if k in self._pending_set]
        self._watched = wanted_set

    def _add_listener_param(self, key, param, fn):
        try:
            has = getattr(param, "value_has_listener", None)
            if has is not None and has(fn):
                return False
            param.add_value_listener(fn)
        except Exception as e:
            self.log("watch %s failed: %s" % (key, e))
            return False
        self._param_hooks[key] = (param, fn)
        return True

    def _param_listener(self, key):
        def on_value():
            try:
                self._on_param_value(key)
            except Exception as e:
                self.log("value listener %s: %s" % (key, e))
        return on_value

    def _mark_pending(self, key):
        if key not in self._pending_set:
            self._pending_set.add(key)
            self._pending.append(key)

    def _param_message(self, key):
        entry = self.catalog.by_key.get(key)
        if entry is None:
            return None
        value, lo, hi, _q, _items = model.param_state(entry.param)
        return osc.encode_message("/pf/param", [
            ("s", key), ("f", value), ("f", lo), ("f", hi), ("s", model.param_display(entry.param))])

    def _on_param_value(self, key):
        self._mark_pending(key)
        now = self.now()
        last = self._last_param_send.get(key)
        if last is not None and now - last < PARAM_THROTTLE:
            return  # the latest value goes out on a later event or tick
        message = self._param_message(key)
        self._pending_set.discard(key)
        self._pending = [k for k in self._pending if k != key]
        if message is not None:
            self._last_param_send[key] = now
            self._send_raw(message)

    def _flush_params(self):
        if not self._pending:
            return
        now = self.now()
        ready = []
        keep = []
        for key in self._pending:
            last = self._last_param_send.get(key)
            if last is None or now - last >= PARAM_THROTTLE:
                ready.append(key)
            else:
                keep.append(key)
        self._pending = keep
        self._pending_set = set(keep)
        messages = []
        for key in ready:
            message = self._param_message(key)
            if message is not None:
                self._last_param_send[key] = now
                messages.append(message)
        self._send_many(messages)

    # ------------------------------------------------------------ commands

    def _process_commands(self):
        batch = self._commands[:MAX_COMMANDS_PER_TICK]
        self._commands = self._commands[MAX_COMMANDS_PER_TICK:]
        for data in batch:
            try:
                messages = osc.decode_packet(data)
            except Exception as e:
                self.log("bad datagram (%d bytes): %s" % (len(data), e))
                continue
            for address, args in messages:
                try:
                    self._handle(address, args)
                except Exception as e:
                    self.log("%s failed: %s" % (address, e))
                    self._ack(address, False, "error: %s" % e)

    def _ack(self, command, ok, detail=""):
        self.send("/pf/ack", [("s", command), ("i", 1 if ok else 0), ("s", detail)])

    def _handle(self, address, args):
        handler = _COMMANDS.get(address)
        if handler is None:
            self.log("ignored %s" % address)
            self._ack(address, False, "unknown command")
            return
        ok, detail = handler(self, args)
        self._ack(address, ok, detail)

    def _cmd_ping(self, args):
        self.send_hello()
        return True, ""

    def _cmd_catalog_request(self, args):
        self._queue_catalogue()
        self._sends_force = True
        return True, "gen %d" % self.catalog_gen

    def _cmd_sends_request(self, args):
        self._check_sends(True)
        return True, "%d sends" % len(self.sends)

    def _cmd_watch(self, args):
        keys = []
        for a in args:
            if isinstance(a, str) and a not in keys:
                keys.append(a)
        self._watch_keys = keys
        self._update_watched()
        missing = [k for k in keys if k not in self.catalog.by_key]
        if missing:
            return True, "%d keys, %d not in this set" % (len(keys), len(missing))
        return True, "%d keys" % len(keys)

    def _cmd_fire_clip(self, args):
        if len(args) < 2:
            return False, "needs track and clip"
        found = model.find_regular_track(self._song, args[0])
        if found is None:
            return False, "track not found: %s" % (args[0],)
        _index, track, track_name = found
        slot = model.find_clip_slot(track, args[1])
        if slot is None:
            return False, "clip not found on %s: %s" % (track_name, args[1])
        slot_index, clip_slot = slot
        clip_slot.fire()
        return True, "%s slot %d" % (track_name, slot_index)

    def _cmd_fire_scene(self, args):
        if len(args) < 1:
            return False, "needs a scene"
        found = model.find_scene(self._song, args[0])
        if found is None:
            return False, "scene not found: %s" % (args[0],)
        index, scene = found
        scene.fire()
        return True, "scene %d" % index

    def _cmd_scene_next(self, args):
        scenes = model.safe_list(self._song, "scenes")
        if not scenes:
            return False, "no scenes"
        view = model.safe_get(self._song, "view", None)
        current = model.index_of(scenes, model.safe_get(view, "selected_scene", None))
        index = (current + 1) % len(scenes) if current >= 0 else 0
        scene = scenes[index]
        scene.fire()
        try:
            view.selected_scene = scene
        except Exception as e:
            self.log("select scene failed: %s" % e)
        return True, "scene %d" % index

    def _cmd_stop_all(self, args):
        self._song.stop_all_clips()
        return True, ""

    def _cmd_tap(self, args):
        self._song.tap_tempo()
        return True, ""


_COMMANDS = {
    "/pf/ping": Connector._cmd_ping,
    "/pf/catalog/request": Connector._cmd_catalog_request,
    "/pf/sends/request": Connector._cmd_sends_request,
    "/pf/watch": Connector._cmd_watch,
    "/pf/fire/clip": Connector._cmd_fire_clip,
    "/pf/fire/scene": Connector._cmd_fire_scene,
    "/pf/scene/next": Connector._cmd_scene_next,
    "/pf/stop/all": Connector._cmd_stop_all,
    "/pf/tap": Connector._cmd_tap,
}
