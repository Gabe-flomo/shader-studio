import unittest

from Playfield import model
from tests import fake_live as fl


class DedupeTests(unittest.TestCase):
    def test_suffixes_in_order(self):
        self.assertEqual(model.dedupe(["A", "B", "A", "A", "B"]),
                         ["A", "B", "A #2", "A #3", "B #2"])

    def test_always_unique(self):
        out = model.dedupe(["A", "A #2", "A"])
        self.assertEqual(len(set(out)), 3)
        self.assertEqual(out[:2], ["A", "A #2"])


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        fl.reset()

    def test_keys_tracks_returns_master_and_duplicates(self):
        bass1 = fl.make_track("Bass", [fl.make_device("Auto Filter", ["Frequency", "Frequency"]),
                                       fl.make_device("Auto Filter", ["Frequency"])])
        bass2 = fl.make_track("Bass", [fl.make_device("EQ Eight", ["Gain"])])
        ret = fl.make_track("A-Reverb", [fl.make_device("Reverb", ["Decay"])])
        master = fl.make_track("Master", [fl.make_device("Limiter", ["Ceiling"])])
        song = fl.make_song([bass1, bass2], [ret], master_track=master)
        cat = model.build_catalogue(song)

        self.assertEqual([(t.index, t.name, t.kind) for t in cat.tracks],
                         [(0, "Bass", "track"), (1, "Bass #2", "track"),
                          (2, "A-Reverb", "return"), (3, "Master", "master")])
        keys = [p.key for p in cat.params]
        self.assertEqual(keys, [
            "Bass / Auto Filter / Device On",
            "Bass / Auto Filter / Frequency",
            "Bass / Auto Filter / Frequency #2",
            "Bass / Auto Filter #2 / Device On",
            "Bass / Auto Filter #2 / Frequency",
            "Bass #2 / EQ Eight / Device On",
            "Bass #2 / EQ Eight / Gain",
            "A-Reverb / Reverb / Device On",
            "A-Reverb / Reverb / Decay",
            "Master / Limiter / Device On",
            "Master / Limiter / Ceiling",
        ])
        p = cat.by_key["Bass / Auto Filter #2 / Frequency"]
        self.assertEqual((p.track, p.device, p.name), ("Bass", "Auto Filter #2", "Frequency"))

    def test_master_always_named_master(self):
        master = fl.Track(name="Whatever")
        song = fl.make_song([fl.make_track("Master")], master_track=master)
        cat = model.build_catalogue(song)
        self.assertEqual([t.name for t in cat.tracks], ["Master", "Master #2"])

    def test_nested_racks_and_depth_limit(self):
        def nest(level):
            if level == 6:
                return fl.make_device("Deep", ["X"])
            return fl.make_rack("Rack", [fl.make_chain("Chain", [nest(level + 1)])], macros=1)

        inner = fl.make_rack("Inst Rack", [
            fl.make_chain("Lead", [fl.make_device("Saturator", ["Drive"])]),
            fl.make_chain("Lead", [fl.make_device("Saturator", ["Drive"]),
                                   fl.make_device("Saturator", ["Drive"])]),
        ], macros=2)
        song = fl.make_song([fl.make_track("Keys", [inner, nest(1)])])
        cat = model.build_catalogue(song)
        keys = set(p.key for p in cat.params)
        self.assertIn("Keys / Inst Rack > Lead > Saturator / Drive", keys)
        self.assertIn("Keys / Inst Rack > Lead #2 > Saturator / Drive", keys)
        self.assertIn("Keys / Inst Rack > Lead #2 > Saturator #2 / Drive", keys)
        self.assertIn("Keys / Inst Rack / Macro 1", keys)
        # depth: racks at depth 1-3 are walked, so devices exist down to depth 4
        depths = sorted(set(d.depth for d in cat.devices))
        self.assertEqual(depths, [1, 2, 3, 4])
        self.assertIn("Keys / Rack > Chain > Rack > Chain > Rack > Chain > Rack / Macro 1", keys)
        self.assertFalse(any("Deep" in k for k in keys))

    def test_playfield_rack_role(self):
        pf_nested = fl.make_rack("PLAYFIELD", [], macros=4)
        outer = fl.make_rack("Outer", [fl.make_chain("C", [pf_nested])], macros=1)
        top = fl.make_rack("Playfield", [], macros=2)
        not_rack = fl.make_device("Playfield", ["A"])  # not a rack: no role
        song = fl.make_song([fl.make_track("T", [outer, top, not_rack])])
        cat = model.build_catalogue(song)
        roles = dict((p.key, p.role) for p in cat.params)
        self.assertEqual(roles["T / Outer > C > PLAYFIELD / Macro 4"], "rack")
        self.assertEqual(roles["T / Playfield / Macro 1"], "rack")
        self.assertEqual(roles["T / Playfield / Device On"], "")
        self.assertEqual(roles["T / Playfield / Chain Selector"], "")
        self.assertEqual(roles["T / Outer / Macro 1"], "")
        self.assertEqual(roles["T / Playfield #2 / A"], "")
        self.assertEqual(cat.rack_keys, [
            "T / Outer > C > PLAYFIELD / Macro 1", "T / Outer > C > PLAYFIELD / Macro 2",
            "T / Outer > C > PLAYFIELD / Macro 3", "T / Outer > C > PLAYFIELD / Macro 4",
            "T / Playfield / Macro 1", "T / Playfield / Macro 2"])

    def test_param_state_and_display(self):
        p = fl.DeviceParameter(name="Mode", value=1.0, min=0.0, max=2.0, is_quantized=True,
                               value_items=["A", "B", "C"])
        self.assertEqual(model.param_state(p), (1.0, 0.0, 2.0, 1, "A|B|C"))
        self.assertEqual(model.param_display(p), "B")
        q = fl.DeviceParameter(name="F", value=0.25, min=0.0, max=1.0)
        self.assertEqual(model.param_state(q), (0.25, 0.0, 1.0, 0, ""))
        self.assertEqual(model.param_display(q), "0.25")

    def test_selected_device_keys_capped(self):
        dev = fl.make_device("Big", ["P%d" % i for i in range(100)])
        song = fl.make_song([fl.make_track("T", [dev])])
        cat = model.build_catalogue(song)
        keys = model.selected_device_keys(cat, dev)
        self.assertEqual(len(keys), 64)
        self.assertEqual(keys[0], "T / Big / Device On")
        self.assertEqual(model.selected_device_keys(cat, None), [])

    def test_live_version(self):
        self.assertEqual(model.live_version(fl.Application(12, 4, 6)), "12.4.6")
        self.assertEqual(model.live_version(None), "")

    def test_lookups(self):
        t1 = fl.make_track("Drums", clips={0: ("Intro", 5), 2: ("Fill", 6)})
        t2 = fl.make_track("Drums")
        song = fl.make_song([t1, t2], scenes=["Verse", "Chorus", "Verse"])
        self.assertEqual(model.find_regular_track(song, "Drums #2")[1], t2)
        self.assertEqual(model.find_regular_track(song, "Drums")[1], t1)
        self.assertEqual(model.find_regular_track(song, 1)[1], t2)
        self.assertIsNone(model.find_regular_track(song, 5))
        self.assertEqual(model.find_clip_slot(t1, "Fill")[0], 2)
        self.assertEqual(model.find_clip_slot(t1, 3)[0], 3)
        self.assertIsNone(model.find_clip_slot(t1, "Nope"))
        self.assertEqual(model.find_scene(song, "Verse")[0], 0)
        self.assertEqual(model.find_scene(song, "Verse #2")[0], 2)
        self.assertEqual(model.find_scene(song, 1)[0], 1)
        self.assertEqual(model.clip_info(t1, 2), ("Fill", 6))
        self.assertEqual(model.clip_info(t1, 1), ("", 0))


if __name__ == "__main__":
    unittest.main()
