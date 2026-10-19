# Connecting Ableton (and other gear) to Play

*The same guide is in the app: Play page → Mappings → ⓘ.*

For Ableton Live, start with the **Live connector**: Live's tempo and beat, clip and scene launches, and any parameter by name, with nothing else to run. MIDI, OSC and audio carry other things, and you can use them all at once.

| Route | Sends | Best for | Needs |
|---|---|---|---|
| **Live connector** (recommended) | Live's tempo and beat, clip and scene launches, track names and colours, any parameter or rack macro by name at full resolution; Playfield can launch clips and scenes back | following Live's tempo, switching looks with the song's scenes, mapping Live's knobs and macros | Live 11 or 12. Desktop app: one click installs it. Browser: copy one folder and run `npm run osc-bridge -- --live` |
| **MIDI** | notes (which, how hard), knobs as CC 0–127, pitch bend. Not sound. | hitting notes to fire envelopes; drawn CC automation | a virtual MIDI port (built into macOS; loopMIDI on Windows), Chrome or Edge |
| **OSC** | any number from any knob or fader in Live, full resolution | many Live parameters, smooth sweeps, TouchOSC on a phone | Max for Live + Connection Kit, and `npm run osc-bridge` |
| **Audio** | the sound itself: level, bass, low-mid, high-mid, treble, and hits | visuals that react to the music; kick-driven flashes | a virtual audio cable (BlackHole / VB-CABLE), or a microphone |
| **A MIDI controller** | its keys, knobs and pads | playing the visuals by hand | Chrome or Edge; no Ableton needed |

## Ableton → Live connector

A small script that runs inside Live as a **Control Surface** (`tools/live-connector/Playfield`, a MIDI Remote Script in Python). It talks to Playfield over OSC on this computer only (127.0.0.1: it listens on UDP **11100** and sends to **11101**), so it sits beside AbletonOSC or TouchOSC setups. How it works and why: docs/live-connector-plan.md.

1. **Install it.**
   - *Desktop app:* Play → Sources ⋯ → **Connect gear…** → **Ableton · Live connector** → **Install the Live connector**. It finds Live's User Library (from Live's `Library.cfg`, Live 11 and 12; else `~/Music/Ableton/User Library`) and copies the script to `User Library/Remote Scripts/Playfield/`, keeping an older copy as `Playfield.bak`. When the app ships a newer script, the button says **Update the Live connector**, and the status says so when Live runs an older one.
   - *By hand (or a browser):* copy the `tools/live-connector/Playfield` folder to `~/Music/Ableton/User Library/Remote Scripts/Playfield` (Mac) or `Documents\Ableton\User Library\Remote Scripts\Playfield` (Windows). Make the **Remote Scripts** folder if it isn't there. If you moved the User Library, Live → Settings → Library shows where it is.
2. **Restart Live**, then Settings → **Link, Tempo & MIDI** → pick **Playfield** in an empty **Control Surface** slot, Input and Output **None**.
3. **In Playfield:** the dot in the guide (and in + Map's **Ableton Live** section) turns green: *Connected · your set · its BPM*. The desktop app listens while the Play page is open; a browser needs the bridge: `npm run osc-bridge -- --live` (UDP 11101 in, `ws://127.0.0.1:9002`, and the page's commands back to Live on 11100).

**Using it**

- **+ Map → Ableton Live**: **Learn from Live** (click any parameter in Live: it's mapped), the **Playfield rack**'s macros, the **selected device**'s parameters (Live's blue hand), **Any parameter…** (pick a track, device and parameter on its card), **Live beat** (0→1 each beat), **Live bar**, **Live playing**, and **Clip launches** / **Scene launches** (envelopes; pick the track and clip, or the scene, on the card; *Launched* fires as you press, *Plays* on Live's grid). Learn on the Sources header also takes a parameter clicked in Live.
- **The Playfield rack** is the steady way for a show: an Audio or MIDI Effect Rack named **Playfield** on any track. Map anything in Live to its macros with Live's own Map, name the macros, and Playfield sees "Filter sweep", not "Macro 3". Its macros always stream.
- Parameters are saved by **name** (`Bass / Auto Filter / Frequency`; racks `Rack > Chain > Device`), so moving tracks doesn't break them; a renamed or deleted one says **not in this set** on its card.
- **Follow Live**: a **Clock** source, a **Beat** trigger, and the Arrangement's transport (the link button: Live's play and stop run the tape from Live's playhead) follow Live while it's connected, and their own BPM when it isn't. The beat is smoothed (a small phase-locked loop: a few ms of jitter, never running backwards). **Latency** in the guide delays it by your audio interface's output latency so flashes land on the kick you hear. Perform shows Live's tempo and bar.beat while connected.
- **Do in Live**: a rule's Do can **launch a clip** (a track and a clip name, or `#2` for the second slot), **launch a scene** (a name or `#3`), **launch the next scene**, **stop all clips**, or **tap the tempo**. Live quantises launches to its own grid.

**If it doesn't connect**

| Symptom | Likely cause |
|---|---|
| "Playfield" isn't in Live's list | Live wasn't restarted; the folder isn't in the User Library Live uses; it ended up nested (`Playfield/Playfield/`). |
| Listed, but never green | The Control Surface slot isn't set; another Playfield window or the bridge with `--live` holds port 11101; the script hit an error: the guide's **Show Live's log** opens `Log.txt` (Mac `~/Library/Preferences/Ableton/Live <version>/Log.txt`, Windows `%APPDATA%\Ableton\Live <version>\Preferences\Log.txt`). The script also writes `log.txt` in its own folder. |
| Values move in steps | Live sends them 20–30 times a second; raise the mapping's smoothing. |
| The beat is late | Set the guide's Latency to your audio interface's output latency. |
| Live 10 or older | Not supported (Python 2). |

*Windows:* the script and the paths above work; the desktop app isn't on Windows yet, so install by hand and use the browser with the bridge.

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

No extra software: pick your microphone and point it at the speakers. Expect 20–50 ms of delay either way. The Studio's Audio Source node plays files or listens to the Mic; live input also lives on the Play page.

## A MIDI controller

Plug it in, open Shader Studio in Chrome or Edge, Mappings → **Learn**, move a knob or hit a pad. Knobs are CC sources, keys velocity, the wheel pitch bend; pads work well as **Trigger → MIDI note** with Envelope, Toggle or Step. On Windows some drivers let only one app use a controller: turn off its Track/Remote switches in Ableton or close Ableton. No controller: the MIDI Input node's keyboard stand-in plays two octaves on your QWERTY keys.
