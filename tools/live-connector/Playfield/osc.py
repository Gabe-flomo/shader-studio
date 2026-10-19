# Playfield Live connector: a small OSC 1.0 encoder/decoder.
#
# Pure Python, standard library only, Python 3.7 safe. Supports the argument
# types i (int32), f (float32), d (float64), s (UTF-8 string), T, F, plus
# N/I (no data) and h (int64) and b (blob) on decode so odd senders don't
# break us.

import struct

BUNDLE_TAG = b"#bundle\x00"
IMMEDIATELY = 1  # OSC time tag 0x0000000000000001 = "now"

_FLOAT32_MAX = 3.4028234663852886e38
_INT32_MIN = -(2 ** 31)
_INT32_MAX = 2 ** 31 - 1


class OscError(ValueError):
    pass


def _pad_string(raw):
    # NUL terminated, padded with NULs to a multiple of 4 (always at least one NUL).
    return raw + b"\x00" * (4 - len(raw) % 4)


def encode_string(text):
    if isinstance(text, bytes):
        raw = text
    else:
        raw = str(text).encode("utf-8")
    # A NUL inside the string would end it early on the other side.
    raw = raw.replace(b"\x00", b"")
    return _pad_string(raw)


def _clamp_float32(value):
    value = float(value)
    if value != value:  # NaN passes through
        return value
    if value > _FLOAT32_MAX:
        return _FLOAT32_MAX if value != float("inf") else value
    if value < -_FLOAT32_MAX:
        return -_FLOAT32_MAX if value != float("-inf") else value
    return value


def _encode_arg(arg):
    """Returns (tag, payload bytes) for one argument.

    An argument may be a plain value (bool -> T/F, int -> i, float -> f,
    str -> s) or an explicit (tag, value) tuple such as ("d", 1.5).
    """
    if isinstance(arg, tuple) and len(arg) == 2 and isinstance(arg[0], str):
        tag, value = arg
    elif isinstance(arg, bool):
        tag, value = ("T" if arg else "F"), None
    elif isinstance(arg, int):
        tag, value = "i", arg
    elif isinstance(arg, float):
        tag, value = "f", arg
    elif isinstance(arg, (str, bytes)):
        tag, value = "s", arg
    else:
        raise OscError("cannot encode %r" % (arg,))

    if tag == "i":
        value = int(value)
        if value < _INT32_MIN or value > _INT32_MAX:
            raise OscError("int out of range: %d" % value)
        return "i", struct.pack(">i", value)
    if tag == "f":
        return "f", struct.pack(">f", _clamp_float32(value))
    if tag == "d":
        return "d", struct.pack(">d", float(value))
    if tag == "h":
        return "h", struct.pack(">q", int(value))
    if tag == "s":
        return "s", encode_string(value)
    if tag in ("T", "F", "N", "I"):
        return tag, b""
    raise OscError("unsupported type tag %r" % (tag,))


def encode_message(address, args=()):
    if not isinstance(address, str) or not address.startswith("/"):
        raise OscError("bad address %r" % (address,))
    tags = [","]
    payload = []
    for arg in args:
        tag, data = _encode_arg(arg)
        tags.append(tag)
        payload.append(data)
    return encode_string(address) + encode_string("".join(tags)) + b"".join(payload)


def encode_bundle(elements, timetag=IMMEDIATELY):
    """elements: encoded messages or bundles (bytes)."""
    parts = [BUNDLE_TAG, struct.pack(">Q", timetag)]
    for element in elements:
        parts.append(struct.pack(">i", len(element)))
        parts.append(element)
    return b"".join(parts)


def bundle_size(element_sizes):
    return 16 + sum(4 + n for n in element_sizes)


def pack_bundles(messages, limit=8000, log=None):
    """Groups encoded messages into bundles, each strictly smaller than `limit`
    bytes. Message order is kept. A message that can't fit in a bundle on its
    own is dropped (and logged), never sent over the limit."""
    bundles = []
    current = []
    size = 16
    for message in messages:
        need = 4 + len(message)
        if 16 + need >= limit:
            if log is not None:
                try:
                    log("osc: dropped a %d-byte message (over the %d-byte limit)" % (len(message), limit))
                except Exception:
                    pass
            continue
        if current and size + need >= limit:
            bundles.append(encode_bundle(current))
            current = []
            size = 16
        current.append(message)
        size += need
    if current:
        bundles.append(encode_bundle(current))
    return bundles


# ---------------------------------------------------------------- decoding

def _read_string(data, offset):
    end = data.find(b"\x00", offset)
    if end < 0:
        raise OscError("unterminated string")
    raw = data[offset:end]
    # Skip the terminator and padding.
    next_offset = offset + ((end - offset) // 4 + 1) * 4
    if next_offset > len(data):
        raise OscError("string padding runs past the end")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", "replace")
    return text, next_offset


def _need(data, offset, count):
    if offset + count > len(data):
        raise OscError("truncated argument")


def decode_message(data):
    """Returns (address, [args]). Raises OscError on malformed data."""
    data = bytes(data)
    address, offset = _read_string(data, 0)
    if not address.startswith("/"):
        raise OscError("bad address %r" % (address,))
    if offset >= len(data):
        return address, []
    tags, offset = _read_string(data, offset)
    if not tags.startswith(","):
        raise OscError("missing type tags")
    args = []
    for tag in tags[1:]:
        if tag == "i":
            _need(data, offset, 4)
            args.append(struct.unpack(">i", data[offset:offset + 4])[0])
            offset += 4
        elif tag == "f":
            _need(data, offset, 4)
            args.append(struct.unpack(">f", data[offset:offset + 4])[0])
            offset += 4
        elif tag == "d":
            _need(data, offset, 8)
            args.append(struct.unpack(">d", data[offset:offset + 8])[0])
            offset += 8
        elif tag == "h":
            _need(data, offset, 8)
            args.append(struct.unpack(">q", data[offset:offset + 8])[0])
            offset += 8
        elif tag == "s" or tag == "S":
            value, offset = _read_string(data, offset)
            args.append(value)
        elif tag == "b":
            _need(data, offset, 4)
            n = struct.unpack(">i", data[offset:offset + 4])[0]
            offset += 4
            if n < 0:
                raise OscError("negative blob size")
            _need(data, offset, n)
            args.append(data[offset:offset + n])
            offset += n + ((4 - n % 4) % 4)
        elif tag == "T":
            args.append(True)
        elif tag == "F":
            args.append(False)
        elif tag == "N":
            args.append(None)
        elif tag == "I":
            args.append(float("inf"))
        else:
            raise OscError("unsupported type tag %r" % (tag,))
    return address, args


def decode_packet(data, _depth=0):
    """Decodes a message or a (possibly nested) bundle into a flat list of
    (address, args) pairs, in order."""
    data = bytes(data)
    if _depth > 8:
        raise OscError("bundles nested too deep")
    if data.startswith(BUNDLE_TAG):
        if len(data) < 16:
            raise OscError("truncated bundle")
        offset = 16
        out = []
        while offset < len(data):
            _need(data, offset, 4)
            n = struct.unpack(">i", data[offset:offset + 4])[0]
            offset += 4
            if n <= 0 or offset + n > len(data):
                raise OscError("bad bundle element size")
            out.extend(decode_packet(data[offset:offset + n], _depth + 1))
            offset += n
        return out
    return [decode_message(data)]
