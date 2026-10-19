# Playfield Live connector: an Ableton Live MIDI Remote Script that streams
# Live's tempo, clips, scenes and parameters to Playfield over OSC/UDP on
# 127.0.0.1 (listens on 11100, sends to 11101).
#
# Install: copy this folder to "User Library/Remote Scripts/Playfield/",
# restart Live, then Settings > Link, Tempo & MIDI > Control Surface:
# Playfield (Input and Output: None).

VERSION = "1.1.0"


def create_instance(c_instance):
    from .surface import PlayfieldSurface
    return PlayfieldSurface(c_instance)
