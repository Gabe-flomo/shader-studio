# Playfield Live connector: the thin wrapper Live talks to.
#
# Live calls update_display() about every 100 ms on its main thread; that is
# our tick. The UDP socket is non-blocking and polled there (no threads:
# Live's embedded Python doesn't cope with them). See CREDITS.txt.

import errno
import os
import socket
import time

from . import VERSION
from .connector import Connector

try:
    from _Framework.ControlSurface import ControlSurface as _BaseSurface
    IN_LIVE = True
except ImportError:
    IN_LIVE = False

    class _BaseSurface(object):
        """Stand-in used outside Live (tests)."""

        def __init__(self, c_instance=None, *a, **k):
            self._fallback_c_instance = c_instance

        def song(self):
            c = self._fallback_c_instance
            return c.song() if c is not None and hasattr(c, "song") else None

        def application(self):
            return None

        def log_message(self, *message):
            pass

        def update_display(self):
            pass

        def disconnect(self):
            pass


HOST = "127.0.0.1"
LISTEN_PORT = 11100
SEND_PORT = 11101
MAX_DATAGRAMS_PER_TICK = 256
LOG_LIMIT = 200 * 1024
DEFAULT_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "log.txt")

_WOULD_BLOCK = set([errno.EAGAIN, getattr(errno, "EWOULDBLOCK", errno.EAGAIN)])


def _monotonic():
    try:
        return time.monotonic()
    except Exception:
        return time.time()


class PlayfieldSurface(_BaseSurface):
    def __init__(self, c_instance, listen_port=LISTEN_PORT, send_port=SEND_PORT, host=HOST,
                 song=None, application=None, log_path=DEFAULT_LOG_PATH, clock=None):
        _BaseSurface.__init__(self, c_instance)
        self._pf_host = host
        self._pf_listen_port = listen_port
        self._pf_send_port = send_port
        self._pf_log_path = log_path
        self._pf_socket = None
        self._pf_can_receive = False
        self._pf_connector = None
        self._pf_log("Playfield %s starting" % VERSION)

        if song is None:
            try:
                song = self.song()
            except Exception as e:
                self._pf_log("no song: %s" % e)
        if application is None:
            application = self._pf_find_application()

        self._pf_open_socket()
        try:
            self._pf_connector = Connector(song, application, self._pf_send, self._pf_log,
                                           clock or _monotonic, VERSION)
            self._pf_connector.start()
        except Exception as e:
            self._pf_log("start failed: %s" % e)

    # ------------------------------------------------------------ logging

    def _pf_log(self, text):
        line = "Playfield: %s" % text
        try:
            self.log_message(line)
        except Exception:
            pass
        path = self._pf_log_path
        if not path:
            return
        try:
            mode = "a"
            if os.path.exists(path) and os.path.getsize(path) > LOG_LIMIT:
                mode = "w"
            with open(path, mode) as f:
                f.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), text))
        except Exception:
            pass

    def _pf_find_application(self):
        try:
            app = self.application()
            if app is not None:
                return app
        except Exception:
            pass
        try:
            import Live
            return Live.Application.get_application()
        except Exception:
            return None

    # ------------------------------------------------------------ socket

    def _pf_open_socket(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setblocking(False)
        except Exception as e:
            self._pf_log("could not open a UDP socket: %s" % e)
            return
        self._pf_socket = sock
        try:
            sock.bind((self._pf_host, self._pf_listen_port))
            self._pf_can_receive = True
            self._pf_log("listening on %s:%d, sending to %s:%d" % (
                self._pf_host, self._pf_listen_port, self._pf_host, self._pf_send_port))
        except Exception as e:
            self._pf_can_receive = False
            self._pf_log("port %d is in use (%s); running send-only" % (self._pf_listen_port, e))

    def _pf_send(self, data):
        if self._pf_socket is None:
            return
        self._pf_socket.sendto(data, (self._pf_host, self._pf_send_port))

    def _pf_poll(self):
        if self._pf_socket is None or not self._pf_can_receive or self._pf_connector is None:
            return
        for _ in range(MAX_DATAGRAMS_PER_TICK):
            try:
                data, _addr = self._pf_socket.recvfrom(65536)
            except BlockingIOError:
                return
            except ConnectionResetError:
                # Windows reports an earlier send to a closed port here; skip it.
                continue
            except socket.error as e:
                if getattr(e, "errno", None) in _WOULD_BLOCK:
                    return
                self._pf_log("receive failed: %s" % e)
                return
            self._pf_connector.receive(data)

    def pf_can_receive(self):
        return self._pf_can_receive

    def pf_connector(self):
        return self._pf_connector

    # ------------------------------------------------------------ Live hooks

    def update_display(self):
        try:
            _BaseSurface.update_display(self)
        except Exception as e:
            self._pf_log("base update_display failed: %s" % e)
        try:
            self._pf_poll()
            if self._pf_connector is not None:
                self._pf_connector.tick()
        except Exception as e:
            self._pf_log("tick failed: %s" % e)

    def disconnect(self):
        try:
            if self._pf_connector is not None:
                self._pf_connector.disconnect()
        except Exception as e:
            self._pf_log("disconnect failed: %s" % e)
        try:
            if self._pf_socket is not None:
                self._pf_socket.close()
        except Exception:
            pass
        self._pf_socket = None
        self._pf_log("Playfield stopped")
        try:
            _BaseSurface.disconnect(self)
        except Exception:
            pass
