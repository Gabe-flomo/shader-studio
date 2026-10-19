# Live connector: plan

*Plan only (2026-10-18). Nothing here is built yet.*

Today Ableton Live reaches Playfield three ways (docs/connecting-ableton.md): **MIDI** through a
virtual port (notes and drawn CC, no tempo), **OSC** through Max for Live's Connection Kit plus
`npm run osc-bridge` (needs Live Suite and a Node process; the desktop app already listens on UDP
itself, `src-tauri/src/osc_listener.rs`), and **audio** through BlackHole. None of them gives us
Live's tempo and beat, its clip launches, or its parameters by name.

The idea: a **Playfield Remote Script**, a small Python folder the user drops into Live once (the
desktop app can do it for them), which streams Live's state to the Playfield desktop app with no
Max for Live and no extra process. This is how "Ableton MCP" servers and AbletonOSC work.

## What a Remote Script is (research)

| Fact | Detail | Source |
|---|---|---|
| Where user scripts go | The **User Library → `Remote Scripts`** folder (since Live 10.1.13). Survives Live updates. Mac: `~/Music/Ableton/User Library/Remote Scripts/`. Windows: `C:\Users\<you>\Documents\Ableton\User Library\Remote Scripts\`. Create the folder if missing. | [Ableton: Installing third-party remote scripts][ab-install] |
| A moved User Library | The real path is in Live's `Library.cfg` (Mac `~/Library/Preferences/Ableton/Live <ver>/Library.cfg`, Windows `%APPDATA%\Ableton\Live <ver>\Preferences\Library.cfg`). ableton-mcp's installer reads it. | [ableton-mcp][mcp] |
| Built-in scripts (don't touch) | Mac `…/Ableton Live 12 Suite.app/Contents/App-Resources/MIDI Remote Scripts/`; Windows `C:\ProgramData\Ableton\Live 12 <edition>\Resources\MIDI Remote Scripts\`. Overwritten on every update. | seen on this Mac (Live 12.4.6) |
| How it's switched on | Live → Settings → **Link, Tempo & MIDI** → a **Control Surface** slot → pick the script (its folder name); Input/Output **None**. A script can't select itself. | [Ableton][ab-install], [AbletonOSC][aosc] |
| Python | Live 11 moved scripts to **Python 3**; Live 10 and older are Python 2 (out of scope). **Live 12 runs Python 3.11** (checked: the bundled `.pyc` magic number on this Mac is 3495 = 3.11). Live 11 is reported as 3.7 (community decompiles; Ableton doesn't publish it), so we write 3.7-safe code. | [Ableton][ab-install], [Ableton forum][py-forum] |
| Base classes | `_Framework.ControlSurface` (old, still shipped), `ableton.v2.control_surface.ControlSurface` (AbletonOSC uses it), `ableton.v3` (Live 12 only; importing it on Live 11 fails). We use **v2** (works on 11 and 12) or plain `_Framework`. | [AbletonOSC manager.py][aosc-mgr], [LOM skill notes][lom-skill] |
| The object model | `self.song()` / `Live.Application.get_application()`: Song, Tracks, ClipSlots, Clips, Scenes, Devices, DeviceParameters. Almost every property has `add_<name>_listener`. Song: `tempo`, `is_playing`, `current_song_time` (in beats), `signature_numerator/denominator` are all observable. `Song.View.selected_parameter` (the last-clicked parameter) and `selected_track` are observable; `Track.View.selected_device` gives the blue-hand device. | [Cycling '74 LOM: Song][lom-song], [Song.View][lom-view] |
| Rate | Incoming work is polled on Live's **~100 ms** tick (`schedule_message(1, tick)`). Listeners fire as values change, on Live's main thread; `current_song_time` and similar fire "20–30 times a second". | [AbletonOSC manager.py][aosc-mgr], [ableton-js][ajs] |
| Threads | AbletonOSC: Live's Python "does not appear to support threading … beachballs when a thread is started", so it polls a **non-blocking UDP socket** on the tick. ableton-mcp does run a TCP server thread but hands every Live call back to the main thread with `schedule_message(0, …)`. Either way: **touch the Live API only on the main thread**, and never change the song from inside a listener (defer it). | [AbletonOSC manager.py][aosc-mgr], [ableton-mcp source][mcp] |
| Sockets are allowed | AbletonOSC (UDP OSC, 11000 in / 11001 out), ableton-mcp (TCP JSON, 127.0.0.1:9877), ableton-js (WebSocket, 127.0.0.1:39031). All MIT. | [AbletonOSC][aosc], [ableton-mcp][mcp], [ableton-js][ajs] |
| Updating a script | Live compiles to `__pycache__` at startup; a new version needs **Live restarted** (or the surface deselected and reselected). | [Ableton forum][py-forum] |
| Logs | Script errors and `log_message` go to Live's `Log.txt` (Mac `~/Library/Preferences/Ableton/Live <ver>/Log.txt`; Windows `%APPDATA%\Ableton\Live <ver>\Preferences\Log.txt`). | Ableton support, common knowledge |

**AbletonOSC in short** ([repo][aosc]): MIT, Live 11+, a Remote Script that speaks OSC on UDP.
Listens on **11000** (bound to `0.0.0.0`, every interface), replies to the sender's IP on **11001**.
Request/response plus `start_listen` subscriptions: `/live/song/start_listen/beat` (an integer beat
on each new beat only), `/live/song/get/tempo`, `/live/track/start_listen/<prop> <track>`,
`/live/device/start_listen/parameter/value <track> <device> <param>`, `/live/clip/fire`,
`/live/scene/fire`, `/live/view/start_listen/selected_track`, a bulk `/live/song/get/track_data`.
No listener for the selected device or the selected parameter. Everything is **addressed by
index**. Last code change 2025-11 (a year ago), "beta" badge, 72 open issues.

## 1. Recommendation: our own small script, AbletonOSC as the model

**Build a small Playfield script (~600–900 lines of Python) that speaks OSC over UDP, written in
AbletonOSC's style and crediting it where we borrow code (MIT allows it).** Don't require or bundle
AbletonOSC itself.

| | Require/bundle AbletonOSC | Our own `Playfield` script |
|---|---|---|
| Effort | Script: none. Client: **M–L**: we'd have to subscribe to every track, clip, scene and parameter by index, re-query on every set change, and rebuild beat phase from whole-beat ticks. | Script: **M**. Client: **S–M**: the script sends exactly what the sources need. |
| Fits what we need | Partly. No selected-device or selected-parameter (learn) listener, no "Playfield rack", beat events carry no phase, and every address breaks when the user moves a track or device. | Fully: push-only, by name, with a catalogue, a heartbeat, phase-accurate transport and learn. |
| Robustness | Index addressing; replies go to "the most recent client", so a user who already runs AbletonOSC for TouchOSC would fight Playfield for it. | Its own name and port; can sit beside AbletonOSC. |
| Safety | Listens on every network interface and accepts any command from anyone on the Wi-Fi. | 127.0.0.1 only; a short allow-list of commands. |
| Maintenance | Someone else's beta project, quiet for a year; we'd ship whatever version it is. | Ours; versioned with the app; Live API churn is small and we'd hit it either way. |
| Licence | MIT: fine to bundle with the notice. | Ours; the MIT notice in a `CREDITS` file for borrowed bits. |

What does make it mostly a client-side job is **the transport**: the script sends OSC, so the
desktop app's existing UDP listener, `src/lib/osc/decode.js` and the browser bridge all carry it
unchanged. The new Playfield work is a "Live" source kind and the tempo follower.

Worth keeping from AbletonOSC: tick polling with a non-blocking socket, the listener bookkeeping
(add on subscribe, remove all on `disconnect`), and logging to a file next to the script.

**Why not just Ableton Link for tempo?** Link syncs tempo, beat and phase very precisely and Live has
it built in. But it's GPLv2+ or a private licence from Ableton ([Link repo][link]; the Rust wrapper
`rusty_link` is GPL-2.0-or-later), and Playfield isn't GPL-licensed and sells Pro plans, so linking it in needs a licence decision. The script gives
us tempo and phase good to a few milliseconds after smoothing (below), which is enough for visuals.
Link stays a possible later add-on (open question 3).

**Playfield → Live: worth it, small.** "Launch clip / scene", "stop all", "tap tempo" and "next
scene" as Do actions on triggers (a pad, a hand gesture, a Play event) are cheap: the script
already polls its socket every tick, Live quantises launches to its own grid anyway so the 100 ms
poll doesn't matter, and it turns Playfield into a controller for the set. Setting parameters from
Playfield is a later maybe (it fights automation and the user's own hand).

## 2. Transport

| Option | Verdict |
|---|---|
| **UDP + OSC** | **Use it.** No connection to drop, nothing blocks Live's main thread, our listener and decoder exist, the browser bridge forwards it as-is, and anyone can watch it with an OSC monitor. |
| TCP / JSON (ableton-mcp) | Needs a server thread or careful non-blocking accept/partial reads in the script, plus framing. Good for request/response tools, not for a stream. |
| WebSocket (ableton-js) | Lets a browser talk to Live directly, which is tempting, but it's a hand-written WebSocket server inside Live's Python. Not worth it for v1. |

Details:

- **Ports.** The script listens on **127.0.0.1:11100** (commands from Playfield) and sends to
  **127.0.0.1:11101**. Not AbletonOSC's 11000/11001, and not our generic OSC port 9000, so all three
  can run at once. The desktop app gets a **second listener** for the Live port (the existing
  `osc_listener::Listener` takes a port, so it's another instance plus a small send helper: Playfield
  → Live needs a UDP send, which we don't have yet).
- **Packet size.** macOS caps a UDP datagram at **9216 bytes** by default
  (`net.inet.udp.maxdgram`, checked on this Mac), so the catalogue goes in chunks under 8 KB.
- **Batching.** Values that changed since the last send go out as one OSC bundle; a fast knob is sent
  at most every ~15 ms with the last value always delivered.
- **Heartbeat.** `/pf/hello` every second with the script version, Live version and set name.
  Playfield shows **Live: connected** while hellos arrive and **Live: not heard from** after ~3 s.
- **The browser version can't talk to Live directly.** Browsers can't open UDP sockets. It works
  through `npm run osc-bridge --udp 11101` exactly as OSC does today, receiving only (Playfield →
  Live would need the bridge to send too: a small addition, phase 6 at the earliest). The desktop
  app is the real home for this feature; the docs should say so plainly.

### The messages (draft)

Script → Playfield (all under `/pf/`):

| Address | Args | When |
|---|---|---|
| `/pf/hello` | script version, Live version, set name | every 1 s |
| `/pf/catalog/begin`, `/pf/catalog/param`, `/pf/catalog/track`, `/pf/catalog/end` | key, track, device, name, min, max, quantized, value items | on connect, on request, when the set's tracks/devices change |
| `/pf/param` | key, value (float, full resolution), display string | on change |
| `/pf/transport` | is_playing, tempo, song time in beats, signature num/den, a send counter | on change and ~25×/s while playing |
| `/pf/clip` | track, scene, state (`triggered`, `playing`, `stopped`), clip name, colour | on launch/stop |
| `/pf/scene` | scene index, name, colour | when a scene is fired |
| `/pf/track` | index, name, colour | on rename/recolour |
| `/pf/selected` | the selected parameter's key | when the user clicks a parameter (learn) |

Playfield → script: `/pf/subscribe <mode>`, `/pf/catalog/request`, `/pf/fire/clip <track> <scene>`
(by name, index as a fallback), `/pf/fire/scene <name|index>`, `/pf/stop/all`, `/pf/tap`. Anything
else is ignored and logged.

**Keys.** A parameter is known by `track name / device name / parameter name` (e.g.
`Bass / Auto Filter / Frequency`), with an index path kept beside it to tell twins apart. Names
survive moving a track; indexes don't. A duplicate name gets ` #2`.

## 3. How Live shows up in Playfield

### A "Live" kind in + Map

A new section in the + Map picker (`src/components/play/mapPicker.ts`), shown when the desktop app
has heard from the script:

```
Live  ● connected · My Set.als · 124 BPM
  Learn from Live       click a parameter in Live, it's mapped
  Playfield rack        Macro 1 … Macro 16 of the rack called "Playfield"
  Selected device       the parameters of the device with the blue hand
  Browse…               every track → device → parameter in the set
  Tempo and beat        beat phase, bar phase, playing
  Clips and scenes      a trigger when a clip or scene launches
```

| Source | Value | Notes |
|---|---|---|
| **Parameter** `{ kind: 'live', key, min, max }` | the parameter mapped from its own min/max to 0–1 | Quantised parameters (switches, choosers) show their item names; full float resolution, unlike MIDI's 128 steps. Card shows `Bass / Auto Filter / Frequency` and Live's own display string ("2.4 kHz"). |
| **Beat** `{ kind: 'live', read: 'beat' \| 'bar' \| 'playing' }` | 0→1 ramp each beat or bar, or a 0/1 gate | Driven by the tempo follower below. |
| **Trigger: Live clip** `{ on: 'liveClip', track?, clip? }` | fires when a matching clip launches (any clip on a track, or a named one) | Option: on **triggered** (early, when pressed) or on **playing** (on the beat Live starts it). |
| **Trigger: Live scene** `{ on: 'liveScene', scene? }` | fires on a scene launch | A natural way to switch Looks or Perform pages with the song's sections. |
| **Live beat** trigger | each beat / bar | Like today's Beat trigger but locked to Live. |

**Choosing which parameters stream** (the script only watches what's asked for, so a 200-device
set doesn't flood anything):

1. **The Playfield rack** (default, best for shows): any rack named "Playfield" anywhere in the
   set. Its macros are always streamed. The user maps anything in Live to those macros, which is
   Live's own familiar mapping flow, and Playfield sees "Macro 3: Filter sweep" by its macro name.
2. **Selected device**: follows the blue hand; good for exploring, poor for shows.
3. **Learn**: Playfield sends `/pf/subscribe learn`, the user clicks any parameter in Live, the
   script reports `Song.View.selected_parameter` and starts streaming it. Mapped parameters are
   then subscribed by key every time the set is opened.

### Tempo and beat: following Live

Today the **Clock** source and the **Beat** trigger run free from Playfield's own clock
(`playEngine.ts`: `this.time * clockRate(bpm, beats)`). Following Live adds one shared
**Live tempo follower** in `src/lib/` that both read:

- Each `/pf/transport` gives (song time in beats, tempo) at a receive time. The follower keeps an
  estimate `beats(now) = b0 + (now − t0) × tempo / 60` and nudges `b0` towards each new sample
  (a simple phase-locked loop: small corrections, never jumps backwards while playing). Messages
  arrive 20–30×/s with some jitter from Live's main thread; smoothing over a few samples should keep
  the visual beat within a few ms. A jump (the user moved the playhead, looped, or stopped) of more
  than a quarter-beat snaps instead of easing.
- A **latency offset** (ms, default 0, ± slider) for the user's audio output delay so flashes land
  on the heard kick, not on Live's internal clock.
- **Clock**, **Beat** trigger and Perform get a **Follow Live** switch (on by default when Live is
  connected): the BPM field shows Live's tempo, greyed. Stopped in Live = the beat holds (or keeps
  free-running: a setting).
- **Arrangement** (`docs/arrangement.md`): the tape's BPM follows Live's; optionally **Live's
  play/stop starts and stops the tape** and Live's song position becomes the record point. Worth
  doing, but behind a switch (open question 2).

### Latency, jitter, reconnects

- Parameter values are applied on the next frame. Live's listeners already arrive in bursts, so a
  source can use the mapping's existing smoothing; the default for Live parameters is a light one
  (~30 ms) to hide the 20–30 Hz steps.
- **Reconnect** is automatic: no connection to lose with UDP. When hellos stop, Live sources hold
  their last value and the status dot goes grey; when they return Playfield re-sends its
  subscriptions and asks for the catalogue. A different set name triggers a catalogue refresh and
  re-resolves keys; a key that's gone shows "not in this set" on the card instead of failing.
- Saved setups store keys and names, never Live's run-time object ids.

## 4. Install

**One button in the desktop app**: Settings (or the Live section of + Map) → **Install the Live
connector**.

1. Find the User Library: read `Library.cfg` from the newest `~/Library/Preferences/Ableton/Live *`
   folder (Windows: `%APPDATA%\Ableton\Live *\Preferences\`), else the default path.
2. Copy the bundled `Playfield/` folder (shipped as a Tauri resource) into
   `<User Library>/Remote Scripts/Playfield/`, replacing an older copy (old one kept as
   `Playfield.bak` for one version).
3. Show three steps with a picture: **restart Live** → Settings → Link, Tempo & MIDI → a Control
   Surface slot → **Playfield**, Input and Output **None** → done when the dot turns green.
4. The script writes a small `version.txt`; the hello message carries the version. If Live runs an
   older script than the app ships, the Live status says **"Update the Live connector"** (one click
   re-copies; Live must restart).

Troubleshooting, in the app and in docs/connecting-ableton.md:

| Symptom | Likely cause |
|---|---|
| "Playfield" isn't in Live's list | Live wasn't restarted; the User Library was moved (Live → Settings → Library shows where); the folder ended up nested (`Playfield/Playfield/`). |
| Listed, but never connects | The surface slot isn't set; another app holds port 11101; Live's `Log.txt` shows a Python error (the app offers "Open Live's log"). |
| Values jump in steps | Expected at Live's listener rate; raise the mapping's smoothing. |
| Beat is late | Set the latency offset to your audio interface's output latency. |
| Live 10 or older | Not supported (Python 2). |

Windows: the same flow; the paths above. The desktop app isn't on Windows yet, so this lands with it
(the script itself is cross-platform).

## 5. Phases

| # | Phase | Effort | Tests | Needs your Live |
|---|---|---|---|---|
| 0 | **Spike**: a 100-line script sending `/pf/hello` and `/pf/transport` on 127.0.0.1; watch it with `npm run osc-bridge --udp 11101 --verbose`. Measure real listener rates and jitter for tempo, song time, a knob under automation. | S | none | **yes**: install, select, play a set |
| 1 | **Script v1**: transport, catalogue, Playfield rack, selected device, learn, clips/scenes/tracks, heartbeat, 127.0.0.1 only, logs. Code that runs on 3.7 and 3.11. | M | Python unit tests with a **fake `Live` module** (stub Song/Track/Device objects with listeners) run under plain CPython in CI: message encoding, chunking under 8 KB, key naming and duplicates, listener add/remove on set change. | yes: Live 12; Live 11 if you have it |
| 2 | **Desktop receive**: a second UDP listener for the Live port, `liveClient.ts` (status, catalogue, latest values), the Live section in + Map, parameter sources, the card. | M | A **fake Live sender** (`tools/fake-live.mjs`: hello, catalogue, a sweeping knob, a 120 BPM transport, clip launches, with jitter and packet loss options) used by vitest through the decoder and by hand with the app. | a quick look |
| 3 | **Tempo follower**: the PLL, Follow Live on Clock, Beat trigger and Perform, latency offset. | M | vitest: the follower against a fake transport stream with jitter, a tempo change, a loop, stop/start, a playhead jump: phase error stays under a set bound. | **yes**: by eye and ear against a kick |
| 4 | **Clips and scenes as triggers**, track names/colours on cards. | S | vitest with the fake sender. | yes |
| 5 | **Install button**, update check, troubleshooting text, docs/connecting-ableton.md section, What's new. | S | Rust unit test for finding the User Library from a sample `Library.cfg`; copying into a temp dir. | **yes**: a clean install on your Mac |
| 6 | **Playfield → Live**: fire clip/scene, stop all, tap tempo as Do actions; a UDP send command in Rust. | S | Python tests: allowed commands run (deferred, not inside a listener), others are ignored. | yes |
| 7 | **Arrangement follows Live's transport** (if wanted). | S–M | tape tests with a fake transport. | yes |
| later | Browser via the bridge; Ableton Link; setting Live parameters from Playfield. | | | |

Phases 0–3 are the useful core (about M+M+M). The fake sender keeps CI honest without Live; only
the spike, the feel of the tempo lock and the install need your machine (Live 12.4.6 Suite is
installed here).

## 6. Open questions for you

1. **How should people pick parameters by default: the "Playfield" rack, or Learn?** (Plan: the rack
   for shows, Learn as the quick way; both built.)
2. **Should Live's play/stop drive the Arrangement tape**, or only its tempo?
3. **Ableton Link later?** It's the most precise tempo sync, but GPL or a licence from Ableton. If
   the script's sync feels tight enough in phase 3 we can skip it.
4. **Live 11 support**: do you or your users still run Live 11? (Costs little if we avoid `ableton.v3`,
   but we can only test on 12 here.)

## Sources

- [Ableton: Installing third-party remote scripts][ab-install]
- [Ableton forum: which Python does Live use][py-forum]
- [Cycling '74 Live Object Model: Song][lom-song], [Song.View][lom-view]
- [AbletonOSC (ideoforms)][aosc], [its manager.py][aosc-mgr], [osc_server.py][aosc-srv]
- [ableton-mcp (ahujasid)][mcp]
- [ableton-js (leolabs)][ajs]
- [Ableton Link][link], [rusty_link on crates.io][rusty]
- [Ableton LOM skill notes (community)][lom-skill]

[ab-install]: https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts
[py-forum]: https://forum.ableton.com/viewtopic.php?p=1832300
[lom-song]: https://docs.cycling74.com/apiref/lom/song/
[lom-view]: https://docs.cycling74.com/apiref/lom/song_view/
[aosc]: https://github.com/ideoforms/AbletonOSC
[aosc-mgr]: https://github.com/ideoforms/AbletonOSC/blob/master/manager.py
[aosc-srv]: https://github.com/ideoforms/AbletonOSC/blob/master/abletonosc/osc_server.py
[mcp]: https://github.com/ahujasid/ableton-mcp
[ajs]: https://github.com/leolabs/ableton-js
[link]: https://github.com/Ableton/link
[rusty]: https://crates.io/crates/rusty_link
[lom-skill]: https://skills.cat/skills/mikecfisher/ableton-lom-skill
