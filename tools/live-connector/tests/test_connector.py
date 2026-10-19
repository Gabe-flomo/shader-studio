import unittest

from Playfield import VERSION, model, osc
from Playfield.connector import Connector
from tests import fake_live as fl


class Clock(object):
    def __init__(self, t=100.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


class Harness(object):
    def __init__(self, song, app=None, start=True):
        self.song = song
        self.clock = Clock()
        self.datagrams = []
        self.logs = []
        self.c = Connector(song, app, self.datagrams.append, self.logs.append, self.clock)
        if start:
            self.c.start()

    def messages(self, address=None, since=0):
        out = []
        for data in self.datagrams[since:]:
            for addr, args in osc.decode_packet(data):
                if address is None or addr == address:
                    out.append((addr, args))
        return out

    def args(self, address, since=0):
        return [a for _, a in self.messages(address, since)]

    def mark(self):
        return len(self.datagrams)

    def command(self, address, *args):
        self.c.receive(osc.encode_message(address, list(args)))

    def tick(self, seconds=0.1):
        self.clock.advance(seconds)
        self.c.tick()


def basic_song():
    rack = fl.make_rack("Playfield", [fl.make_chain("Chain", [fl.make_device("Utility", ["Gain"])])],
                        macros=4)
    bass = fl.make_track("Bass", [fl.make_device("Auto Filter", ["Frequency", "Resonance"]), rack],
                         clips={0: ("Intro", 0xFF0000), 1: ("Drop", 0x00FF00)}, color=0x112233)
    drums = fl.make_track("Drums", [fl.make_device("Drum Buss", ["Drive"])], clips={0: ("Beat", 7)})
    ret = fl.make_track("A-Reverb", [fl.make_device("Reverb", ["Decay"])])
    scenes = [fl.Scene(name="Verse", color=1), fl.Scene(name="Chorus", color=2),
              fl.Scene(name="Outro", color=3)]
    song = fl.make_song([bass, drums], [ret], scenes, name="My Set")
    return song


class StartupTests(unittest.TestCase):
    def setUp(self):
        fl.reset()

    def test_hello_on_start_and_every_second(self):
        h = Harness(basic_song(), fl.Application(12, 4, 6))
        hellos = h.args("/pf/hello")
        self.assertEqual(hellos, [[VERSION, "12.4.6", "My Set", 1]])
        h.tick(0.5)
        self.assertEqual(len(h.args("/pf/hello")), 1)
        h.tick(0.5)
        self.assertEqual(len(h.args("/pf/hello")), 2)

    def test_hello_without_application(self):
        h = Harness(basic_song(), None)
        self.assertEqual(h.args("/pf/hello")[0][1], "")

    def test_ping_replies_now(self):
        h = Harness(basic_song())
        m = h.mark()
        h.command("/pf/ping")
        self.assertEqual(h.args("/pf/hello", m), [])  # not until the tick
        h.tick(0.01)
        self.assertEqual(len(h.args("/pf/hello", m)), 1)
        self.assertEqual(h.args("/pf/ack", m), [["/pf/ping", 1, ""]])

    def test_catalogue_on_start(self):
        h = Harness(basic_song())
        begin = h.args("/pf/catalog/begin")
        end = h.args("/pf/catalog/end")
        self.assertEqual(begin, [[1, len(h.c.catalog.params)]])
        self.assertEqual(end, [[1]])
        tracks = h.args("/pf/catalog/track")
        self.assertEqual(tracks, [[0, "Bass", 0x112233, "track"], [1, "Drums", 0, "track"],
                                  [2, "A-Reverb", 0, "return"], [3, "Master", 0, "master"]])
        self.assertEqual(h.args("/pf/catalog/scene"),
                         [[0, "Verse", 1], [1, "Chorus", 2], [2, "Outro", 3]])
        params = h.args("/pf/catalog/param")
        by_key = dict((p[0], p) for p in params)
        p = by_key["Bass / Auto Filter / Frequency"]
        self.assertEqual(p[1:4], ["Bass", "Auto Filter", "Frequency"])
        self.assertEqual(len(p), 10)
        self.assertEqual(p[6], 0)  # not quantized
        self.assertEqual(p[8], "")
        on = by_key["Bass / Auto Filter / Device On"]
        self.assertEqual((on[6], on[8], on[9]), (1, "Off|On", ""))
        self.assertEqual(by_key["Bass / Playfield / Macro 2"][9], "rack")
        self.assertEqual(by_key["Bass / Playfield / Chain Selector"][9], "")
        self.assertIn("Bass / Playfield > Chain > Utility / Gain", by_key)

    def test_catalog_request_resends_same_gen(self):
        h = Harness(basic_song())
        m = h.mark()
        h.command("/pf/catalog/request")
        h.tick()
        self.assertEqual(h.args("/pf/catalog/begin", m)[0][0], 1)
        self.assertEqual(h.args("/pf/catalog/end", m), [[1]])
        self.assertEqual(h.args("/pf/ack", m)[0][:2], ["/pf/catalog/request", 1])


class BigCatalogueTests(unittest.TestCase):
    def setUp(self):
        fl.reset()

    def test_big_set_is_chunked(self):
        tracks = []
        for t in range(60):
            devices = [fl.make_device("Device %d" % d, ["Parameter number %d" % p for p in range(29)])
                       for d in range(6)]
            tracks.append(fl.make_track("Track %d" % t, devices, slots=0))
        song = fl.make_song(tracks)
        h = Harness(song, start=False)
        h.c.start()
        expected = [p.key for p in h.c.catalog.params]
        self.assertEqual(len(expected), 60 * 6 * 30)

        ticks = 0
        per_tick = []
        start = 0
        while True:
            count = len(h.datagrams) - start
            per_tick.append(len([d for d in h.datagrams[start:] if d.startswith(b"#bundle")
                                 and b"/pf/catalog/" in d]))
            start = len(h.datagrams)
            if h.c.catalogue_pending() == 0:
                break
            h.tick()
            ticks += 1
            self.assertLess(ticks, 1000)
        self.assertTrue(ticks > 1)
        for n in per_tick:
            self.assertLessEqual(n, 8)
        catalogue_bundles = [d for d in h.datagrams if b"/pf/catalog/" in d]
        for d in catalogue_bundles:
            self.assertLess(len(d), 8000)
        got = []
        begins = []
        ends = []
        for d in catalogue_bundles:
            for addr, args in osc.decode_packet(d):
                if addr == "/pf/catalog/param":
                    got.append(args[0])
                elif addr == "/pf/catalog/begin":
                    begins.append(args)
                elif addr == "/pf/catalog/end":
                    ends.append(args)
        self.assertEqual(got, expected)
        self.assertEqual(begins, [[1, len(expected)]])
        self.assertEqual(ends, [[1]])


class WatchTests(unittest.TestCase):
    def setUp(self):
        fl.reset()
        self.song = basic_song()
        self.bass = self.song.tracks[0]
        self.filter = self.bass.devices[0]
        self.freq = self.filter.parameters[1]
        self.rack = self.bass.devices[1]
        self.macro1 = self.rack.parameters[1]

    def test_rack_macros_always_watched(self):
        h = Harness(self.song)
        watched = h.c.watched_keys()
        self.assertIn("Bass / Playfield / Macro 1", watched)
        self.assertNotIn("Bass / Playfield / Device On", watched)
        # current values sent once on start
        keys = [a[0] for a in h.args("/pf/param")]
        self.assertIn("Bass / Playfield / Macro 4", keys)
        h.tick(0.1)
        m = h.mark()
        self.macro1.value = 64.0
        self.assertEqual(h.args("/pf/param", m), [["Bass / Playfield / Macro 1", 64.0, 0.0, 127.0, "64.00"]])

    def test_unwatched_param_is_silent(self):
        h = Harness(self.song)
        self.assertEqual(self.freq.listener_count("value"), 0)
        m = h.mark()
        self.freq.value = 0.5
        h.tick()
        self.assertEqual(h.args("/pf/param", m), [])

    def test_watch_command_and_throttle(self):
        h = Harness(self.song)
        m = h.mark()
        h.command("/pf/watch", "Bass / Auto Filter / Frequency", "Nope / X / Y")
        h.tick(0.1)
        self.assertEqual(h.args("/pf/ack", m)[0][:2], ["/pf/watch", 1])
        # value sent once when it becomes watched
        self.assertEqual([a[0] for a in h.args("/pf/param", m)], ["Bass / Auto Filter / Frequency"])
        h.tick(0.1)

        m = h.mark()
        self.freq.value = 0.1  # sent at once
        h.clock.advance(0.005)
        self.freq.value = 0.2  # throttled
        h.clock.advance(0.005)
        self.freq.value = 0.3  # throttled
        sent = h.args("/pf/param", m)
        self.assertEqual(len(sent), 1)
        self.assertAlmostEqual(sent[0][1], 0.1)
        h.clock.advance(0.006)  # 16 ms after the first send
        self.freq.value = 0.4  # allowed again: latest value
        sent = h.args("/pf/param", m)
        self.assertEqual(len(sent), 2)
        self.assertAlmostEqual(sent[1][1], 0.4)
        h.clock.advance(0.002)
        self.freq.value = 0.45  # throttled, flushed by the tick
        self.assertEqual(len(h.args("/pf/param", m)), 2)
        h.tick(0.1)
        sent = h.args("/pf/param", m)
        self.assertEqual(len(sent), 3)
        self.assertAlmostEqual(sent[2][1], 0.45)
        h.tick(0.1)
        self.assertEqual(len(h.args("/pf/param", m)), 3)  # nothing new

    def test_throttled_values_flush_as_one_bundle(self):
        h = Harness(self.song)
        h.command("/pf/watch", "Bass / Auto Filter / Frequency", "Bass / Auto Filter / Resonance")
        h.tick()
        h.tick()
        res = self.filter.parameters[2]
        self.freq.value = 0.1
        res.value = 0.1
        m = h.mark()
        h.clock.advance(0.001)
        self.freq.value = 0.2
        res.value = 0.3
        self.assertEqual(h.mark(), m)
        h.tick(0.1)
        new = h.datagrams[m:]
        param_datagrams = [d for d in new if b"/pf/param" in d]
        self.assertEqual(len(param_datagrams), 1)
        self.assertTrue(param_datagrams[0].startswith(b"#bundle"))
        self.assertEqual(len(osc.decode_packet(param_datagrams[0])), 2)

    def test_watch_replaced_removes_listeners(self):
        h = Harness(self.song)
        h.command("/pf/watch", "Bass / Auto Filter / Frequency")
        h.tick()
        self.assertEqual(self.freq.listener_count("value"), 1)
        h.command("/pf/watch")
        h.tick()
        self.assertEqual(self.freq.listener_count("value"), 0)
        self.assertEqual(self.macro1.listener_count("value"), 1)  # rack stays


class TransportTests(unittest.TestCase):
    def setUp(self):
        fl.reset()
        self.song = basic_song()

    def test_transport_messages(self):
        h = Harness(self.song)
        first = h.args("/pf/transport")
        self.assertEqual(first, [[0, 120.0, 0.0, 4, 4, 1]])
        m = h.mark()
        self.song.tempo = 128.0
        self.song.is_playing = True
        sent = h.args("/pf/transport", m)
        self.assertEqual([s[5] for s in sent], [2, 3])
        self.assertEqual(sent[1][:2], [1, 128.0])

        # song time: throttled to 35 ms
        m = h.mark()
        h.clock.advance(0.010)
        self.song.current_song_time = 1.123456789012
        self.assertEqual(h.args("/pf/transport", m), [])
        h.clock.advance(0.030)
        self.song.current_song_time = 1.25
        sent = h.args("/pf/transport", m)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][2], 1.25)  # 'd' arrives at full precision
        self.assertEqual(sent[0][5], 4)
        h.clock.advance(0.010)
        self.song.current_song_time = 1.3
        self.assertEqual(len(h.args("/pf/transport", m)), 1)

        # on every tick while playing
        m = h.mark()
        h.tick()
        h.tick()
        self.assertEqual(len(h.args("/pf/transport", m)), 2)

        # stopped: one message, then no song time / tick sends
        self.song.is_playing = False
        m = h.mark()
        h.clock.advance(0.1)
        self.song.current_song_time = 2.0
        h.tick()
        self.assertEqual(h.args("/pf/transport", m), [])

    def test_signature_change(self):
        h = Harness(self.song)
        m = h.mark()
        self.song.signature_numerator = 7
        self.song.signature_denominator = 8
        sent = h.args("/pf/transport", m)
        self.assertEqual(sent[-1][3:5], [7, 8])


class ClipSceneTrackTests(unittest.TestCase):
    def setUp(self):
        fl.reset()
        self.song = basic_song()
        self.bass, self.drums = self.song.tracks

    def test_clip_states(self):
        h = Harness(self.song)
        m = h.mark()
        self.drums.fired_slot_index = 0
        self.drums.playing_slot_index = 0
        self.drums.fired_slot_index = -1
        self.drums.playing_slot_index = -2  # Live uses -2 for "stopped"
        self.assertEqual(h.args("/pf/clip", m), [
            [1, "Drums", 0, "triggered", "Beat", 7],
            [1, "Drums", 0, "playing", "Beat", 7],
            [1, "Drums", 0, "stopped", "Beat", 7],
        ])

    def test_clip_switch_and_empty_slot(self):
        h = Harness(self.song)
        m = h.mark()
        self.bass.playing_slot_index = 0
        self.bass.playing_slot_index = 1
        self.bass.fired_slot_index = 3
        self.assertEqual(h.args("/pf/clip", m), [
            [0, "Bass", 0, "playing", "Intro", 0xFF0000],
            [0, "Bass", 1, "playing", "Drop", 0x00FF00],
            [0, "Bass", 3, "triggered", "", 0],
        ])

    def test_return_tracks_have_no_clip_listeners(self):
        Harness(self.song)
        ret = self.song.return_tracks[0]
        self.assertEqual(ret.listener_count("fired_slot_index"), 0)
        self.assertEqual(ret.listener_count("playing_slot_index"), 0)

    def test_scene_triggered(self):
        h = Harness(self.song)
        m = h.mark()
        self.song.scenes[1].is_triggered = True
        self.song.scenes[1].is_triggered = False
        self.assertEqual(h.args("/pf/scene", m), [[1, "Chorus", 2]])

    def test_old_scene_without_is_triggered(self):
        song = fl.make_song([fl.make_track("T")], scenes=[fl.OldScene(name="S")])
        h = Harness(song)
        self.assertEqual(h.args("/pf/catalog/scene"), [[0, "S", 0]])
        h.command("/pf/fire/scene", "S")
        h.tick()
        self.assertEqual(song.scenes[0].calls, ["fire"])

    def test_track_rename(self):
        h = Harness(self.song)
        m = h.mark()
        self.drums.name = "Bass"
        self.assertEqual(h.args("/pf/track", m), [[1, "Bass #2", 0]])
        self.assertEqual(h.args("/pf/catalog/begin", m), [])  # deferred to the tick
        h.tick()
        self.assertEqual(h.args("/pf/catalog/begin", m)[0][0], 2)
        self.assertEqual(h.args("/pf/catalog/end", m), [[2]])
        self.assertIn("Bass #2 / Drum Buss / Drive", h.c.catalog.by_key)
        h.tick(1.0)
        self.assertEqual(h.args("/pf/hello", m)[-1][3], 2)

    def test_track_recolour_no_rebuild(self):
        h = Harness(self.song)
        m = h.mark()
        self.bass.color = 0xABCDEF
        self.assertEqual(h.args("/pf/track", m), [[0, "Bass", 0xABCDEF]])
        h.tick()
        self.assertEqual(h.args("/pf/catalog/begin", m), [])

    def test_structure_changes_rebuild(self):
        h = Harness(self.song)
        gen = h.c.catalog_gen
        self.song.tracks = self.song.tracks + (fl.make_track("New", [fl.make_device("Delay", ["Time"])]),)
        h.tick()
        self.assertEqual(h.c.catalog_gen, gen + 1)
        self.assertIn("New / Delay / Time", h.c.catalog.by_key)
        # device added inside a rack chain
        chain = self.bass.devices[1].chains[0]
        chain.devices = chain.devices + (fl.make_device("Echo", ["Feedback"]),)
        h.tick()
        self.assertEqual(h.c.catalog_gen, gen + 2)
        self.assertIn("Bass / Playfield > Chain > Echo / Feedback", h.c.catalog.by_key)
        # several changes in one tick rebuild once
        self.song.scenes = self.song.scenes[:2]
        self.drums.devices = ()
        self.bass.devices[0].name = "Filter"
        h.tick()
        self.assertEqual(h.c.catalog_gen, gen + 3)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        fl.reset()
        self.song = basic_song()
        self.bass, self.drums = self.song.tracks

    def test_selected_parameter(self):
        h = Harness(self.song)
        m = h.mark()
        freq = self.bass.devices[0].parameters[1]
        freq.value = 0.75
        self.song.view.selected_parameter = freq
        self.song.view.selected_parameter = None
        self.song.view.selected_parameter = fl.DeviceParameter(name="Stranger")
        self.assertEqual(h.args("/pf/selected/param", m), [
            ["Bass / Auto Filter / Frequency", "Bass", "Auto Filter", "Frequency", 0.75, 0.0, 1.0, "0.75"]])

    def test_selected_device(self):
        h = Harness(self.song)
        m = h.mark()
        self.bass.view.selected_device = self.bass.devices[0]
        self.assertEqual(h.args("/pf/selected/device", m), [])  # deferred
        h.tick()
        sent = h.args("/pf/selected/device", m)
        self.assertEqual(sent, [["Bass", "Auto Filter", "Bass / Auto Filter / Device On",
                                 "Bass / Auto Filter / Frequency", "Bass / Auto Filter / Resonance"]])
        self.assertIn("Bass / Auto Filter / Frequency", h.c.watched_keys())
        # values of the newly watched params were sent
        self.assertIn("Bass / Auto Filter / Resonance", [a[0] for a in h.args("/pf/param", m)])

        # switching track re-hooks to the new track's view
        m = h.mark()
        self.song.view.selected_track = self.drums
        self.assertEqual(self.drums.view.listener_count("selected_device"), 0)
        h.tick()
        self.assertEqual(self.drums.view.listener_count("selected_device"), 1)
        self.assertEqual(self.bass.view.listener_count("selected_device"), 0)
        self.assertEqual(h.args("/pf/selected/device", m), [["Drums", ""]])
        self.assertNotIn("Bass / Auto Filter / Frequency", h.c.watched_keys())
        m = h.mark()
        self.drums.view.selected_device = self.drums.devices[0]
        h.tick()
        self.assertEqual(h.args("/pf/selected/device", m)[0][:3],
                         ["Drums", "Drum Buss", "Drums / Drum Buss / Device On"])

    def test_selected_nested_device(self):
        h = Harness(self.song)
        util = self.bass.devices[1].chains[0].devices[0]
        m = h.mark()
        self.bass.view.selected_device = util
        h.tick()
        self.assertEqual(h.args("/pf/selected/device", m)[0][:2], ["Bass", "Playfield > Chain > Utility"])


class CommandTests(unittest.TestCase):
    def setUp(self):
        fl.reset()
        self.song = basic_song()
        self.bass, self.drums = self.song.tracks

    def acks(self, h, m):
        return h.args("/pf/ack", m)

    def test_fire_clip_by_name_and_index(self):
        h = Harness(self.song)
        m = h.mark()
        h.command("/pf/fire/clip", "Bass", "Drop")
        h.command("/pf/fire/clip", 1, 0)
        h.command("/pf/fire/clip", "Bass", "Missing")
        h.command("/pf/fire/clip", "Nobody", 0)
        h.command("/pf/fire/clip", 9, 0)
        # nothing happens inside receive()
        self.assertEqual(self.bass.clip_slots[1].calls, [])
        h.tick()
        self.assertEqual(self.bass.clip_slots[1].calls, ["fire"])
        self.assertEqual(self.drums.clip_slots[0].calls, ["fire"])
        acks = self.acks(h, m)
        self.assertEqual([a[:2] for a in acks], [["/pf/fire/clip", 1], ["/pf/fire/clip", 1],
                                                  ["/pf/fire/clip", 0], ["/pf/fire/clip", 0],
                                                  ["/pf/fire/clip", 0]])
        self.assertTrue(acks[2][2])

    def test_fire_clip_duplicate_track_name(self):
        self.drums.name = "Bass"
        h = Harness(self.song)
        h.command("/pf/fire/clip", "Bass #2", "Beat")
        h.tick()
        self.assertEqual(self.drums.clip_slots[0].calls, ["fire"])
        self.assertEqual(self.bass.clip_slots[0].calls, [])

    def test_fire_scene(self):
        h = Harness(self.song)
        m = h.mark()
        h.command("/pf/fire/scene", "Chorus")
        h.command("/pf/fire/scene", 2)
        h.command("/pf/fire/scene", "Nope")
        h.tick()
        self.assertEqual(self.song.scenes[1].calls, ["fire"])
        self.assertEqual(self.song.scenes[2].calls, ["fire"])
        self.assertEqual([a[1] for a in self.acks(h, m)], [1, 1, 0])

    def test_scene_next_wraps(self):
        h = Harness(self.song)
        self.song.view.selected_scene = self.song.scenes[1]
        h.command("/pf/scene/next")
        h.tick()
        self.assertEqual(self.song.scenes[2].calls, ["fire"])
        self.assertIs(self.song.view.selected_scene, self.song.scenes[2])
        h.command("/pf/scene/next")
        h.tick()
        self.assertEqual(self.song.scenes[0].calls, ["fire"])
        self.assertIs(self.song.view.selected_scene, self.song.scenes[0])

    def test_stop_all_and_tap(self):
        h = Harness(self.song)
        m = h.mark()
        h.command("/pf/stop/all")
        h.command("/pf/tap")
        self.assertEqual(self.song.calls, [])
        h.tick()
        self.assertEqual(self.song.calls, ["stop_all_clips", "tap_tempo"])
        self.assertEqual([a[:2] for a in self.acks(h, m)], [["/pf/stop/all", 1], ["/pf/tap", 1]])

    def test_unknown_and_garbage(self):
        h = Harness(self.song)
        m = h.mark()
        h.command("/pf/delete/everything", 1)
        h.c.receive(b"\xff\xfe garbage")
        h.c.receive(b"#bundle\x00short")
        h.tick()
        self.assertEqual(self.acks(h, m), [["/pf/delete/everything", 0, "unknown command"]])
        self.assertIn("ignored /pf/delete/everything", h.logs)

    def test_bundle_of_commands(self):
        h = Harness(self.song)
        bundle = osc.encode_bundle([osc.encode_message("/pf/tap"), osc.encode_message("/pf/stop/all")])
        h.c.receive(bundle)
        h.tick()
        self.assertEqual(self.song.calls, ["tap_tempo", "stop_all_clips"])

    def test_command_that_raises_is_acked_not_raised(self):
        h = Harness(self.song)

        def boom():
            raise RuntimeError("Live said no")
        object.__setattr__(self.song, "tap_tempo", boom)
        m = h.mark()
        h.command("/pf/tap")
        h.tick()
        ack = self.acks(h, m)[0]
        self.assertEqual(ack[:2], ["/pf/tap", 0])
        self.assertIn("Live said no", ack[2])


class ListenerBookkeepingTests(unittest.TestCase):
    def setUp(self):
        fl.reset()

    def test_disconnect_removes_everything(self):
        song = basic_song()
        h = Harness(song)
        h.command("/pf/watch", "Bass / Auto Filter / Frequency")
        song.tracks[0].view.selected_device = song.tracks[0].devices[0]
        h.tick()
        self.assertGreater(fl.total_listeners(), 0)
        m = h.mark()
        h.c.disconnect()
        self.assertEqual(fl.objects_with_listeners(), [])
        self.assertEqual(fl.total_listeners(), 0)
        self.assertEqual(h.c.listener_count(), 0)
        self.assertEqual(h.messages(since=m), [("/pf/bye", [])])
        h.tick()  # ticking after disconnect is harmless and silent
        self.assertEqual(len(h.datagrams), m + 1)

    def test_rebuild_does_not_duplicate(self):
        song = basic_song()
        h = Harness(song)
        before = fl.total_listeners()
        counts = dict((id(o), o.listener_count()) for o in fl.all_objects())
        for _ in range(3):
            song.tracks[0].devices[0].name = "Auto Filter"  # structure change, same shape
            h.tick()
        self.assertEqual(fl.total_listeners(), before)
        self.assertEqual(dict((id(o), o.listener_count()) for o in fl.all_objects()), counts)

    def test_removed_objects_lose_listeners(self):
        song = basic_song()
        h = Harness(song)
        drums = song.tracks[1]
        drum_buss = drums.devices[0]
        self.assertGreater(drums.listener_count(), 0)
        song.tracks = song.tracks[:1]
        h.tick()
        self.assertEqual(drums.listener_count(), 0)
        self.assertEqual(drum_buss.listener_count(), 0)

    def test_listener_on_deleted_object_that_raises(self):
        song = basic_song()
        h = Harness(song)
        drums = song.tracks[1]

        def dead(*a):
            raise RuntimeError("object deleted")
        object.__setattr__(drums, "name_has_listener", dead)
        song.tracks = song.tracks[:1]
        h.tick()  # must not raise
        self.assertEqual(h.c.catalog_gen, 2)

    def test_tick_never_raises(self):
        song = basic_song()
        h = Harness(song)

        class Broken(object):
            def __getattr__(self, name):
                raise RuntimeError("broken " + name)
        h.c._song = Broken()
        h.c._structure_dirty = True
        h.c._selected_rehook = True
        h.tick()
        h.tick(1.0)

    def test_send_failures_are_swallowed(self):
        song = basic_song()

        def bad_send(data):
            raise OSError("no buffer space")
        logs = []
        c = Connector(song, None, bad_send, logs.append, Clock())
        c.start()
        c.tick()
        self.assertTrue(any("send failed" in l for l in logs))


def sends_song():
    rack = fl.make_rack("Rack", [fl.make_chain("Chain", [fl.make_send(1234, name="Bass send")])])
    drums = fl.make_track("Drums", [fl.make_send(4821)], color=0xFF0000)
    bass = fl.make_track("Bass", [fl.make_device("Auto Filter"), rack], color=0x00FF00)
    ret = fl.make_track("A-Reverb", [fl.make_send(77)], color=3)
    return fl.make_song([drums, bass], [ret])


class PlayfieldSendTests(unittest.TestCase):
    def setUp(self):
        fl.reset()

    def test_sent_on_first_tick_as_flat_tuples(self):
        h = Harness(sends_song())
        self.assertEqual(h.args("/pf/sends"), [])  # not inside start()
        h.tick()
        self.assertEqual(h.args("/pf/sends"), [[4821, "Drums", 0xFF0000, 0, "track",
                                                1234, "Bass", 0x00FF00, 1, "track",
                                                77, "A-Reverb", 3, 2, "return"]])
        m = h.mark()
        h.tick()
        h.tick()
        self.assertEqual(h.args("/pf/sends", m), [])  # unchanged: silent

    def test_none_is_an_empty_message(self):
        h = Harness(basic_song())
        h.tick()
        self.assertEqual(h.args("/pf/sends"), [[]])

    def test_track_rename_and_recolour_resend(self):
        song = sends_song()
        h = Harness(song)
        h.tick()
        m = h.mark()
        song.tracks[0].name = "Kit"
        h.tick()
        self.assertEqual(h.args("/pf/sends", m)[-1][:5], [4821, "Kit", 0xFF0000, 0, "track"])
        m = h.mark()
        song.tracks[0].color = 0x0000FF
        h.tick()
        sent = h.args("/pf/sends", m)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][:5], [4821, "Kit", 0x0000FF, 0, "track"])

    def test_device_removed_and_added(self):
        song = sends_song()
        h = Harness(song)
        h.tick()
        m = h.mark()
        song.return_tracks[0].devices = ()
        h.tick()
        self.assertEqual(h.args("/pf/sends", m), [[4821, "Drums", 0xFF0000, 0, "track",
                                                   1234, "Bass", 0x00FF00, 1, "track"]])
        m = h.mark()
        song.return_tracks[0].devices = (fl.make_send(500),)
        h.tick()
        self.assertEqual(h.args("/pf/sends", m)[0][10:], [500, "A-Reverb", 3, 2, "return"])

    def test_renamed_device_does_not_change_content(self):
        song = sends_song()
        h = Harness(song)
        h.tick()
        m = h.mark()
        song.tracks[0].devices[0].name = "Whatever"
        h.tick()
        self.assertEqual(h.args("/pf/sends", m), [])
        self.assertEqual(h.c.sends[0].id, 4821)

    def test_id_change_resends(self):
        song = sends_song()
        h = Harness(song)
        h.tick()
        m = h.mark()
        fl.pairing(song.tracks[0].devices[0]).value = 2222 / 9999.0
        self.assertEqual(h.args("/pf/sends", m), [])  # the listener only marks
        h.tick()
        self.assertEqual(h.args("/pf/sends", m)[0][:5], [2222, "Drums", 0xFF0000, 0, "track"])

    def test_duplicate_id_reassigned_on_the_tick_not_in_the_listener(self):
        song = sends_song()
        h = Harness(song)
        h.tick()
        later = fl.pairing(song.return_tracks[0].devices[0])
        changes = []
        later.add_value_listener(lambda: changes.append(later.value))
        m = h.mark()
        later.value = 4821 / 9999.0  # the user loads a copy with Drums' id
        self.assertEqual(changes, [4821 / 9999.0])  # nothing re-entered the listener
        self.assertEqual(h.args("/pf/sends", m), [])
        h.tick()
        self.assertEqual(len(changes), 2)
        new_id = model.pairing_id(later)
        self.assertNotIn(new_id, (4821, 1234))
        self.assertTrue(0 <= new_id <= 9999)
        self.assertAlmostEqual(later.value, new_id / 9999.0)
        self.assertEqual(fl.pairing(song.tracks[0].devices[0]).value, 4821 / 9999.0)  # first keeps it
        sent = h.args("/pf/sends", m)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0::5], [4821, 1234, new_id])
        self.assertTrue(any("pairing id 4821 was taken, now %d" % new_id in l for l in h.logs))
        m = h.mark()
        h.tick()
        self.assertEqual(h.args("/pf/sends", m), [])  # the change's own listener: no resend

    def test_duplicates_at_load_fixed_on_first_tick(self):
        a = fl.make_send(10)
        b = fl.make_send(10)
        c = fl.make_send(10)
        song = fl.make_song([fl.make_track("One", [a, b]), fl.make_track("Two", [c])])
        h = Harness(song)
        self.assertEqual(fl.pairing(b).value, 10 / 9999.0)  # untouched in start()
        h.tick()
        ids = h.args("/pf/sends")[0][0::5]
        self.assertEqual(ids[0], 10)
        self.assertEqual(len(set(ids)), 3)

    def test_sends_request_answered_even_when_unchanged(self):
        h = Harness(sends_song())
        h.tick()
        m = h.mark()
        h.command("/pf/sends/request")
        h.tick()
        self.assertEqual(len(h.args("/pf/sends", m)), 1)
        self.assertEqual(h.args("/pf/ack", m), [["/pf/sends/request", 1, "3 sends"]])

    def test_catalog_request_resends_after_the_catalogue(self):
        h = Harness(sends_song())
        h.tick()
        m = h.mark()
        h.command("/pf/catalog/request")
        h.tick()
        names = [a for a, _ in h.messages(since=m)]
        self.assertIn("/pf/sends", names)
        self.assertLess(names.index("/pf/catalog/end"), names.index("/pf/sends"))

    def test_disconnect_removes_pairing_listeners(self):
        song = sends_song()
        h = Harness(song)
        h.tick()
        self.assertEqual(fl.pairing(song.tracks[0].devices[0]).listener_count("value"), 1)
        h.c.disconnect()
        self.assertEqual(fl.total_listeners(), 0)


if __name__ == "__main__":
    unittest.main()
