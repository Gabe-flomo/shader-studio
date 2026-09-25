# Connecting Ableton (and other gear) to Play

*The same guide is in the app: Play page → Mappings → ⓘ.*

MIDI, OSC and audio carry different things, and you can use all three at once.

| Route | Sends | Best for | Needs |
|---|---|---|---|
| **MIDI** | notes (which, how hard), knobs as CC 0–127, pitch bend. Not sound. | hitting notes to fire envelopes; drawn CC automation | a virtual MIDI port (built into macOS; loopMIDI on Windows), Chrome or Edge |
| **OSC** | any number from any knob or fader in Live, full resolution | many Live parameters, smooth sweeps, TouchOSC on a phone | Max for Live + Connection Kit, and `npm run osc-bridge` |
| **Audio** | the sound itself: level, bass, low-mid, high-mid, treble, and hits | visuals that react to the music; kick-driven flashes | a virtual audio cable (BlackHole / VB-CABLE), or a microphone |
| **A MIDI controller** | its keys, knobs and pads | playing the visuals by hand | Chrome or Edge; no Ableton needed |

## Ableton → MIDI

1. **Make a virtual port.**
   - *Mac:* Audio MIDI Setup → Window → Show MIDI Studio → double-click **IAC Driver** → tick **Device is online**. You now have **IAC Driver Bus 1**.
   - *Windows:* install **loopMIDI** (tobias-erichsen.de), click **+**, leave it running.
2. **Send from Ableton.** Settings → Link, Tempo & MIDI → MIDI Ports: switch **Track** on for **Out: IAC Driver (Bus 1)** / **Out: loopMIDI Port**. On a MIDI track set **MIDI To** to that port, channel 1. Clips now play into Shader Studio. For knobs, draw **MIDI Ctrl** clip envelopes (e.g. 1-Modulation → CC 1).
   A track sending to the port is silent; to hear it, add a second MIDI track with an instrument whose **MIDI From** is the first track, Monitor **In**.
3. **In Shader Studio** (Chrome or Edge): Play → Mappings → **Learn**, play a note or move the CC, allow MIDI. For hits: source **Trigger** → On **MIDI note** → row Learn → **Envelope**. Match tempo with a **Clock** source at Ableton's BPM (MIDI clock sync isn't supported yet).

## Ableton → OSC

1. **Start the bridge** (Node.js 18+): `npm run osc-bridge` in the shader-studio folder. It listens on UDP **9000** and serves the browser on `ws://127.0.0.1:9001`. `--verbose` prints each message; `--lan` accepts phones and other computers.
2. **Send from Ableton:** Max for Live (Suite) with the free **Connection Kit** pack. Drag **OSC Send** onto a track, host **127.0.0.1**, port **9000**, click **Map** on a row and click the Live parameter to send; the row's name is its address. (Labels vary a little between versions.)
3. **In Shader Studio:** a mapping with source **OSC**; the dot turns green when the bridge is connected; row **Learn**, move the knob, the address fills in. Ableton sends 0–1, the default range. Buttons: **Trigger** → On **OSC message** (above 0.5 is a press).

*TouchOSC:* run the bridge with `--lan`, set the app's host to your computer's IP (`ipconfig getifaddr en0` on a Mac, `ipconfig` on Windows) and port 9000.

## Ableton → Audio

1. **Install a virtual audio cable.**
   - *Mac:* **BlackHole 2ch** (existential.audio/blackhole or `brew install blackhole-2ch`). To keep hearing the music: Audio MIDI Setup → **+** → **Create Multi-Output Device** → tick your speakers and BlackHole 2ch (Drift Correction on BlackHole).
   - *Windows:* **VB-CABLE** (vb-audio.com/Cable). To keep hearing: Sound settings → More sound settings → Recording → **CABLE Output** → Properties → Listen → **Listen to this device** on your speakers.
2. **Point Ableton at it:** Settings → Audio → Output Device: the **Multi-Output Device** (Mac) or **CABLE Input** with Driver Type **MME/DirectX** (Windows; ASIO can only use your interface).
3. **In Shader Studio:** source **Live audio in** → **Listen** → allow the microphone (browsers ask this for any audio input) → pick **BlackHole 2ch** / **CABLE Output**. Bands: Level, Bass, Low-mid, High-mid, Treble; raise **gain** if it barely moves. Kick flashes: **Trigger** → On **Audio hit** → Bass → **Envelope**, and nudge the threshold.

No extra software: pick your microphone and point it at the speakers. Expect 20–50 ms of delay either way. The Studio's Audio Input node plays files; live input lives on the Play page.

## A MIDI controller

Plug it in, open Shader Studio in Chrome or Edge, Mappings → **Learn**, move a knob or hit a pad. Knobs are CC sources, keys velocity, the wheel pitch bend; pads work well as **Trigger → MIDI note** with Envelope, Toggle or Step. On Windows some drivers let only one app use a controller: turn off its Track/Remote switches in Ableton or close Ableton. No controller: the MIDI Input node's keyboard stand-in plays two octaves on your QWERTY keys.
