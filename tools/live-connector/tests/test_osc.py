import struct
import unittest

from Playfield import osc


class EncodeDecodeTests(unittest.TestCase):
    def test_round_trip_all_types(self):
        data = osc.encode_message("/pf/test", [
            ("i", -7), ("f", 0.5), ("d", 1234.123456789012), ("s", "héllo"), True, False,
            3, 2.25, "plain"])
        self.assertEqual(len(data) % 4, 0)
        address, args = osc.decode_message(data)
        self.assertEqual(address, "/pf/test")
        self.assertEqual(args[0], -7)
        self.assertAlmostEqual(args[1], 0.5)
        self.assertEqual(args[2], 1234.123456789012)  # 'd' keeps full precision
        self.assertEqual(args[3], "héllo")
        self.assertIs(args[4], True)
        self.assertIs(args[5], False)
        self.assertEqual(args[6], 3)
        self.assertAlmostEqual(args[7], 2.25)
        self.assertEqual(args[8], "plain")

    def test_type_tags(self):
        data = osc.encode_message("/a", [("i", 1), ("f", 1.0), ("d", 1.0), ("s", "x"), True, False])
        self.assertIn(b",ifdsTF\x00", data)

    def test_string_padding(self):
        for text, size in (("", 4), ("a", 4), ("abc", 4), ("abcd", 8), ("abcdefg", 8)):
            self.assertEqual(len(osc.encode_string(text)), size, text)
        # UTF-8 bytes count, not characters
        self.assertEqual(len(osc.encode_string("ééé")), 8)

    def test_float32_clamped(self):
        address, args = osc.decode_message(osc.encode_message("/x", [("f", 1e40)]))
        self.assertTrue(args[0] > 3e38)

    def test_no_typetag_message(self):
        self.assertEqual(osc.decode_message(osc.encode_string("/pf/ping")), ("/pf/ping", []))

    def test_bundle_round_trip_nested(self):
        a = osc.encode_message("/a", [1])
        b = osc.encode_message("/b", [("d", 2.5)])
        inner = osc.encode_bundle([b])
        packet = osc.encode_bundle([a, inner])
        self.assertTrue(packet.startswith(b"#bundle\x00"))
        self.assertEqual(struct.unpack(">Q", packet[8:16])[0], 1)
        self.assertEqual(osc.decode_packet(packet), [("/a", [1]), ("/b", [2.5])])

    def test_decode_errors(self):
        for bad in (b"", b"nope", b"/a\x00\x00,i\x00\x00", b"#bundle\x00", b"/a\x00\x00,q\x00\x00",
                    b"#bundle\x00" + b"\x00" * 8 + b"\x00\x00\x00\x40abc"):
            with self.assertRaises(osc.OscError):
                osc.decode_packet(bad)

    def test_bad_address_rejected(self):
        with self.assertRaises(osc.OscError):
            osc.encode_message("nope", [])


class PackBundlesTests(unittest.TestCase):
    def test_bundles_stay_under_limit_and_keep_order(self):
        messages = [osc.encode_message("/m", [("i", i), ("s", "x" * (i % 50))]) for i in range(500)]
        bundles = osc.pack_bundles(messages, limit=1000)
        self.assertTrue(len(bundles) > 1)
        out = []
        for bundle in bundles:
            self.assertLess(len(bundle), 1000)
            out.extend(osc.decode_packet(bundle))
        self.assertEqual([a[0] for _, a in out], list(range(500)))

    def test_exact_fit_boundary(self):
        msg = osc.encode_message("/m", [("s", "x" * 40)])
        per = 4 + len(msg)
        limit = 16 + per * 3 + 1  # three fit strictly under the limit
        bundles = osc.pack_bundles([msg] * 6, limit=limit)
        self.assertEqual(len(bundles), 2)
        for b in bundles:
            self.assertLess(len(b), limit)
        bundles = osc.pack_bundles([msg] * 6, limit=limit - 1)  # now only two fit
        self.assertEqual(len(bundles), 3)

    def test_oversize_message_dropped_and_logged(self):
        logs = []
        small = osc.encode_message("/s", [1])
        big = osc.encode_message("/big", [("s", "x" * 9000)])
        bundles = osc.pack_bundles([small, big, small], limit=8000, log=logs.append)
        decoded = []
        for b in bundles:
            self.assertLess(len(b), 8000)
            decoded.extend(osc.decode_packet(b))
        self.assertEqual([a for a, _ in decoded], ["/s", "/s"])
        self.assertEqual(len(logs), 1)

    def test_empty(self):
        self.assertEqual(osc.pack_bundles([]), [])


if __name__ == "__main__":
    unittest.main()
