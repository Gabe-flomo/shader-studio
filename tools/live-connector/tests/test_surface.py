import os
import shutil
import socket
import tempfile
import time
import unittest

import Playfield
from Playfield import osc, surface
from tests import fake_live as fl


def free_udp_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class SurfaceUdpTests(unittest.TestCase):
    def setUp(self):
        fl.reset()
        self.tmp = tempfile.mkdtemp()
        self.log_path = os.path.join(self.tmp, "log.txt")
        # Playfield's side: a socket that receives what the script sends.
        self.app_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.app_sock.bind(("127.0.0.1", 0))
        self.app_sock.settimeout(2.0)
        self.send_port = self.app_sock.getsockname()[1]
        self.surfaces = []

    def tearDown(self):
        for s in self.surfaces:
            s.disconnect()
        self.app_sock.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make_surface(self, listen_port):
        song = fl.make_song([fl.make_track("Bass", [fl.make_device("Auto Filter", ["Frequency"])])],
                            name="Test Set")
        s = surface.PlayfieldSurface(None, listen_port=listen_port, send_port=self.send_port,
                                     song=song, application=fl.Application(12, 4, 6),
                                     log_path=self.log_path)
        self.surfaces.append(s)
        return s

    def receive_until(self, address, surface_to_tick, timeout=2.0):
        deadline = time.time() + timeout
        seen = []
        self.app_sock.settimeout(0.05)
        while time.time() < deadline:
            surface_to_tick.update_display()
            try:
                data, _ = self.app_sock.recvfrom(65536)
            except socket.timeout:
                continue
            for addr, args in osc.decode_packet(data):
                seen.append(addr)
                if addr == address:
                    return args, seen
        self.fail("no %s within %.1fs (saw %s)" % (address, timeout, sorted(set(seen))))

    def drain(self):
        self.app_sock.settimeout(0.05)
        while True:
            try:
                self.app_sock.recvfrom(65536)
            except socket.timeout:
                return

    def test_ping_gets_hello_over_udp(self):
        listen_port = free_udp_port()
        s = self.make_surface(listen_port)
        self.assertTrue(s.pf_can_receive())
        args, _ = self.receive_until("/pf/hello", s)  # start-up hello
        self.assertEqual(args, [Playfield.VERSION, "12.4.6", "Test Set", 1])
        self.drain()

        sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sender.sendto(osc.encode_message("/pf/ping"), ("127.0.0.1", listen_port))
            args, seen = self.receive_until("/pf/ack", s)
            self.assertEqual(args, ["/pf/ping", 1, ""])
            self.assertIn("/pf/hello", seen)
        finally:
            sender.close()
        with open(self.log_path) as f:
            self.assertIn("listening on 127.0.0.1:%d" % listen_port, f.read())

    def test_port_in_use_runs_send_only(self):
        blocker = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        blocker.bind(("127.0.0.1", 0))
        port = blocker.getsockname()[1]
        try:
            s = self.make_surface(port)
            self.assertFalse(s.pf_can_receive())
            args, _ = self.receive_until("/pf/hello", s)
            self.assertEqual(args[0], Playfield.VERSION)
            s.update_display()  # polling is a no-op, nothing raises
            with open(self.log_path) as f:
                self.assertIn("running send-only", f.read())
        finally:
            blocker.close()

    def test_disconnect_sends_bye_and_clears_listeners(self):
        s = self.make_surface(free_udp_port())
        self.drain()
        self.surfaces.remove(s)
        s.disconnect()
        self.assertEqual(fl.total_listeners(), 0)
        self.app_sock.settimeout(1.0)
        addresses = []
        while True:
            try:
                data, _ = self.app_sock.recvfrom(65536)
            except socket.timeout:
                break
            addresses.extend(a for a, _ in osc.decode_packet(data))
        self.assertEqual(addresses[-1], "/pf/bye")

    def test_log_file_is_truncated(self):
        with open(self.log_path, "w") as f:
            f.write("x" * (surface.LOG_LIMIT + 10))
        self.make_surface(free_udp_port())
        self.assertLess(os.path.getsize(self.log_path), surface.LOG_LIMIT)

    def test_create_instance_entry_point(self):
        self.assertTrue(callable(Playfield.create_instance))
        with open(os.path.join(os.path.dirname(Playfield.__file__), "version.txt")) as f:
            self.assertEqual(f.read().strip(), Playfield.VERSION)
        import re
        with open(Playfield.__file__) as f:
            self.assertEqual(re.findall(r'VERSION = "(\d+\.\d+\.\d+)"', f.read()), [Playfield.VERSION])


if __name__ == "__main__":
    unittest.main()
