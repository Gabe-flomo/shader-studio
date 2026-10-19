# Playfield Send: plan

*Plan (2026-10-19). Nothing built yet. The user chose this on 2026-10-18. It replaces "Listen to an app", which is dropped.*

**What it is.** "Playfield Send" is a small audio plugin. You put it on any Ableton Live track, return or group. It passes the audio through untouched and streams that track's audio to the Playfield **desktop app** on the same Mac. In Playfield each instance is a source, named after its track ("Live · Drums"). You choose it next to File / Mic / Video on the Audio Source node and in Play's readers. Bands, Detect, triggers, effects and readers all work on it, and it never plays to the speakers. It is hidden in the browser build.

It is **the only way** to get one track's audio from Live: no screen or app capture, and no BlackHole route for this. (BlackHole stays documented for the plain Mic tab, as today.)

## Recommendation in short

- **Plugin:** a hand-written **VST3** in **Rust** on the MIT/Apache [`vst3` crate][vst3-crate] (bindings generated from Steinberg's SDK, MIT since VST 3.8). It is about 1 kLOC: pass-through, a ring writer, two parameters and an announce thread. It builds **universal** (arm64 + x86_64). There is **no AU and no CLAP**: Live on macOS loads VST3, and Live has no CLAP.
- **Licence:** everything we link (vst3 crate, VST3 SDK 3.8) is MIT or Apache, so we can ship the plugin closed or open as we like. We do **not** use nih-plug today: its VST3 export still links GPLv3-only `vst3-sys`, and the switch to the MIT binding is an open, unmerged PR ([#263][nih-263], [#274][nih-274]).
- **Transport:** each instance writes its audio into its own **POSIX shared-memory ring** (lock-free, single writer, single reader). It also sends a **UDP/OSC hello** once a second to 127.0.0.1:11102 so the app can find it. The audio thread does no syscalls, no allocation and no locks.
- **Raw audio, not bands:** the app receives raw samples and puts them into the page's own `AudioContext` through an **AudioWorklet source**. That way the probe analyser, bands, Detect, learned sounds, Filter / Resonator / Spectral effects and readers all work unchanged.
- **Getting it into the page:** there is no SharedArrayBuffer (COOP/COEP stopped the WKWebView preview, see `vite.config.ts`). Instead, Rust batches about 10 ms of every *subscribed* instance into **one binary Tauri `Channel` message**. The page passes each chunk to the worklet with `postMessage` (transferred, not copied). The worklet keeps a small jitter buffer (≈ 30 ms) that drops or pads to absorb clock drift.
- **Names:** each instance has a 4-digit **Pairing ID** parameter. The Live connector's Remote Script finds "Playfield Send" devices, reads the ID and reports `id → track name, colour`. Without the connector, you name the source in Playfield.
- **Shipping:** the plugin bundle is built in this repo and signed with the app's Developer ID. It ships inside Playfield.app as a resource, so the app's notarisation covers it. **Install Playfield Send** copies it to `~/Library/Audio/Plug-Ins/VST3/`. Windows comes later.
- **Estimated end-to-end latency:** ≈ 40–70 ms, compared with what Live *processes*. Live's own output buffer is part of that, so compared with what you *hear* it is less. The source's existing **Sync offset** trims the rest.

## 1. Framework

| Option | Formats | Language / build | Licence today | Fit |
|---|---|---|---|---|
| **nih-plug** ([repo][nih]) | VST3, CLAP. No AU. | Rust, `cargo xtask bundle` | Framework is ISC, but "the VST3 bindings used by `nih_export_vst3!()` are licensed under the GPLv3" ([README][nih]). The move to the MIT `vst3` crate is open PR [#263][nih-263] / tracking issue [#274][nih-274] (June 2026). The README says the project is "in maintenance mode". | Most features for free (params, state, GUI via egui/iced/vizia), but it forces GPLv3 on the plugin until #263 lands, and it pulls in a large framework for a plugin that has almost nothing to do. |
| **Hand-written VST3 on the `vst3` crate** ([vst3-rs][vst3-rs]) | VST3 | Rust, our own small bundle script | MIT OR Apache-2.0. Since 0.3.0 (2025-12-07) the generated bindings are in the crate source, made possible by the SDK's MIT relicence ([author's post][micah]). | **Recommended.** The plugin is tiny: `IPluginFactory`, a single-component `IComponent` + `IAudioProcessor` + `IEditController`, 2–3 params, state. It shares a protocol crate with `src-tauri`, so there is one language and one toolchain. |
| CLAP in Rust ([clack][clack] / `clap-sys`, MIT) + [clap-wrapper][clap-wrapper] (MIT) | CLAP → VST3, AUv2, AUv3 | Rust + CMake/C++ wrapper, needs the VST3 SDK at build time | All MIT | A good route **if we ever want AU** (Logic, MainStage). It adds a C++/CMake step to CI. Not needed for Live. |
| **JUCE 8** | VST3, AU, AUv3, standalone | C++ / CMake or Projucer | AGPLv3 or the JUCE EULA. Starter is free only up to **$20k** revenue or funding (gross, across all JUCE products), then Indie up to $300k ([JUCE forum][juce-eula], [tiers][juce-tiers]). | Playfield has paid Pro plans, so we would end up paying or going AGPL. It also adds a second big C++ toolchain. Not worth it for a pass-through. |
| **iPlug2** ([repo][iplug2]) | VST2/3, AUv2/v3, AAX, CLAP, WAM | C++ | zlib-style: "free to use in closed source projects" | Licence is fine, but it is C++ in a Rust repo with nothing to gain over the `vst3` crate. |
| Plain C++ on Steinberg's SDK | VST3 | C++ / CMake | MIT since 3.8 | Possible, but a second language for no gain. |

**What Live loads** ([Ableton: AU and VST on macOS][ab-mac], [VST on Windows][ab-win], [Live 12 manual: plug-ins][ab-manual]):
- **macOS:** AU (v2, and v3 since 11.2), VST2 and VST3.
- **Windows:** VST2 and VST3.
- **CLAP:** not supported in Live 11 or 12. It is a long-running feature request with no Ableton commitment ([forum][ab-clap]).
- **Apple Silicon:** since Live 11.1, the Universal Live loads only VST2/VST3 built natively for arm64. Intel Macs, and Live under Rosetta, need x86_64. So we build **universal**.
- **AU on Mac:** this would only matter for other hosts. Skip it in v1, and avoid AUv3 entirely: it runs sandboxed out of process, where POSIX shm to our app would be fenced off.
- **VST2:** not an option. Its SDK has been withdrawn.

## 2. Licensing

- **VST3 SDK:** Steinberg released **VST 3.8 under the MIT licence on 2025-10-29**, replacing the GPLv3/proprietary dual licence ([Steinberg press release][stb-pr], [Sound On Sound][sos], [CDM][cdm], [licence text][stb-lic]). There is no agreement to sign with Steinberg any more. We keep the copyright and licence notice and follow the VST trademark/logo rules if we show the logo. (The "you need a separate VST3 licence" line in JUCE's 2024 forum post is from before this change.)
- **`vst3` crate:** MIT OR Apache-2.0 ([crates.io][vst3-crate], [repo][vst3-rs]). It can go in a closed-source or differently licensed binary.
- **`vst3-sys` (nih-plug's VST3 path today):** GPLv3. A plugin built with it must be GPLv3 with source available. Playfield and the plugin are separate programs that only share memory and UDP, which most readings treat as aggregation, so the app itself would not be affected. Still, the plugin's source would have to be published under GPLv3. Using the `vst3` crate avoids the question altogether.
- **Playfield's own licence:** the repo has no LICENSE file (`src-tauri/Cargo.toml` has `license = ""`), so the app is effectively all-rights-reserved. Nothing in the recommended stack constrains that.
- **AU (if ever):** Apple's AudioToolbox headers and frameworks come with the OS and Xcode under Apple's normal developer terms. There is no separate SDK licence. clap-wrapper is MIT.
- **What we can ship:** a closed or open (our choice) universal `Playfield Send.vst3`, with an MIT notice for the VST3 SDK and the `vst3` crate in a `CREDITS.txt` inside the bundle. This is the same pattern as `tools/live-connector/Playfield/CREDITS.txt`.

## 3. Transport: plugin → desktop app

**Rules for the audio thread** (`process()` in the plugin):
- No allocation, no locks, no syscalls (no `sendto`, no `write`, no logging) and no waiting.
- Copy the input to the output if the buffers don't alias (pass-through), then copy into the ring. Live can call `process()` with any block size up to `maxSamplesPerBlock` from `setupProcessing`, and on different threads for different tracks. Each instance is a single writer, so that is fine.

| Choice | Audio-thread cost | Latency | Notes |
|---|---|---|---|
| **Shared-memory ring** (POSIX `shm_open` + `mmap`) | A `memcpy` and an atomic store | Set by the reader's poll interval (≈ 2–5 ms) | **Recommended.** Neither Live nor Playfield is sandboxed (Playfield's `Entitlements.plist` has no app-sandbox; Live loads in-process plugins). On macOS shm names are limited to 31 characters, and segments can't be listed, so discovery goes through a hello message (below). macOS has no unnamed process-shared POSIX semaphores, so the reader **polls** and never waits on a wake-up. |
| Local UDP | A `sendto` per block: a syscall, can block, and isn't RT-safe | ≈ 1 ms | Safe only through an in-plugin ring plus a sender thread, which means two hops and a thread wake-up. Packets can drop under load. |
| Unix socket / TCP | Same syscall problem, plus back-pressure | ≈ 1 ms | No advantage over shm for a single local reader. |
| Mach ports / XPC | Message send: a syscall | low | macOS-only and more code; no advantage over shm. |

**The segment** (one per instance, created by the plugin in `setActive(true)` or `setupProcessing`, never on the audio thread). The name is `/pfsend.<pid>.<n>`.

```
header (cache-line aligned)
  magic "PFSEND", protocol version, generation (bumped on every re-create)
  sample_rate (f64), channels (1|2), capacity_frames (≈ 1 s, rounded to a power of two)
  write_frame (u64, atomic, Release)        — total frames written; position = write_frame % capacity
  last_process_host_time (u64, atomic)      — mach_absolute_time() at the last process(); a commpage read, no syscall
  state flags (active, bypassed, offline-render)
  pairing id (u16), instance name (UTF-8, 64 bytes, seqlock, written from the UI/main thread)
  app → plugin area (seqlock): the resolved "Live · Drums" + colour, for the plugin's status line
ring: capacity_frames × channels × f32, interleaved
```

**The reader** (a thread in `src-tauri`, new module `live_send.rs`):
- Every 2–5 ms it reads `write_frame` (Acquire) and copies the new frames out. It keeps its own read position per instance.
- **Overrun:** the writer got more than a ring ahead, because the app stalled for over a second. The reader skips to the newest frames and counts a dropout.
- **Stale:** no progress for 250 ms means the device is off, the track is deactivated, or Live has stopped processing. The source shows **Paused** and reads silence.
- A **generation** change re-maps the segment. That happens when Live's sample rate changes: Live deactivates the plugin, calls `setupProcessing`, and reactivates it.
- A plugin that disappears (Live quit or crashed) is caught by the missing hello and a dead pid (`kill(pid, 0)`). The app closes and unlinks the segment.

**Discovery:**
- A plain background thread in the plugin (not the audio thread) sends `/pfsend/hello <id> <name> <shm name> <sample rate> <channels> <pid> <version>` as OSC over UDP to **127.0.0.1:11102** once a second, and `/pfsend/bye` on terminate.
- The app reuses `osc_listener.rs` on that port, as `live_connector.rs` does on 11101. If the app isn't running, nothing listens and the hellos cost nothing.

**Sample rate and buffer size:**
- The ring carries Live's own rate (44.1, 48, 96 kHz…) and works with any block size.
- Rust resamples each subscribed instance to the page `AudioContext`'s rate (the page tells it on subscribe). It uses a small polyphase resampler, e.g. the [`rubato`][rubato] crate, or linear interpolation as `engineSend.ts` already does in the other direction.
- **Drift:** Live's device clock and the page's output clock are different crystals. The worklet keeps its buffer between ½× and 2× its target. When it is over, it drops the oldest frames; when it is under, it pads silence. At ~50 ppm that is one drop every few minutes, which analysis doesn't notice because the stream is never heard.
- **Offline (Live's Export / Freeze):** `processMode == kOffline` runs faster than real time. The plugin sets the "offline-render" flag and the reader ignores those frames, so Playfield doesn't get a burst of minutes of audio.

**Many instances:**
- Each instance's ring is ≈ 1 s (384 KB at 48 kHz stereo f32), and memory and CPU grow linearly.
- The reader **only forwards subscribed instances** to the page, meaning the ones an Audio Source or a reader set is using. All others just get a cheap RMS in Rust for the picker's meters.
- 16 instances all subscribed is ≈ 6 MB/s over IPC, which is fine on macOS (see 5). The plan's test target is 16 instances, CPU measured in Live.

**Raw audio, not pre-analysed bands.** The page's analysis expects real audio in a Web Audio graph:
- the probe analyser (FFT 2048, no smoothing), Detect's Drums only (HPSS over time), learned sounds, and Hit;
- the **effects** (Filter, Resonator bank, Spectral in `play/kit/audioChain.js`), which are Web Audio nodes built on the source;
- Play's readers.

Sending bands would mean re-implementing all of that in Rust and keeping two copies identical. We would only send analysis frames as a **fallback** (an `audio-engine://frame`-like event computed by the existing `audio_engine/analysis.rs`) if the raw path proves too heavy. That fallback loses the effects.

## 4. Naming and pairing

- **Pairing ID** is a VST3 parameter: discrete, 0–9999 (`stepCount` 9999), shown as "4821", and not automatable (`kIsReadOnly` is not set, so Live lists it, but `kCanAutomate` is off).
  - A random value is picked on first load and saved in the plugin state, so it survives reopening the set.
  - **Duplicated tracks** copy the state, so two instances would share an ID. A process-wide registry inside the plugin dylib catches this, since Live hosts all plugins in one process. When the second instance activates with a taken ID, it re-rolls and tells Live through `restartComponent(kParamValuesChanged)` (main thread).
- **Remote Script** (`tools/live-connector/Playfield/`):
  - The catalogue walk (`model.py _walk_devices`, already 4 levels into racks) recognises devices whose `class_name` is `PluginDevice` and whose `class_display_name` is "Playfield Send". It doesn't use the device name, because users rename devices.
  - It reads the "Pairing ID" parameter, using the display string first and `round(value × 9999)` as a fallback.
  - It sends `/pf/sends <id> <track name> <colour> <track index> <kind: track|return|group|master>` for each one, and again when a track is renamed or recoloured or the device is added or removed (listeners it mostly has already).
  - The app joins this to the hellos by ID and writes the name back into the segment's app → plugin area.
- **Without the connector:** the source is listed as **"Send 4821"** with the plugin's own name if one was set. You can rename it in Playfield, and the name is kept per ID in the app's settings. In a later phase, the plugin's small UI has a name field (see open question 2).
- **What a saved graph stores:** `{ source: 'send', sendId: 4821, sendLabel: 'Drums' }`. If that ID isn't there when the graph is opened, the card says *"Waiting for Playfield Send 4821 (Drums)"* and reads silence.

## 5. The Playfield side

**Where it shows up:**
- **Audio Source:** a new tab **Live** (desktop only; hidden in the browser and in exported pages).
  - It lists every instance the app has heard from: "Live · Drums ● 48 kHz" with a meter, a status (*Streaming*, *Paused in Live*, *Not found*), and the buffer and dropout counts in the Open ↗ window (like the Send device's readout in `docs/audio-engine.md`).
  - It is a new `AudioSourceKind` **`'send'`** in `nodes/definitions/audioTools.ts`. Not `'live'`: that name is taken by the live-audio band, and `'ableton'` by the connector's sources.
  - Its transport works like Mic: Play / Pause only, never to the speakers. The band editor's **Solo / Hear** are greyed out on it, because it is never heard.
- **Play:** the readers' input (`audioReaders.input`) gets `send:<id>`, and its control group is **Audio readers · Live · Drums**. The Live audio chip lists sends next to the mic.

**Getting the samples into the web `AudioContext`** (what the desktop app allows):
- **No SharedArrayBuffer.** It needs cross-origin isolation, and COOP/COEP stopped WKWebView drawing the preview (`vite.config.ts`, `docs/reports/stems-research.md`).
- **AudioWorklet exists in WKWebView.** `engineSend.ts` already uses one to send page audio to Rust (`ae_rack_feed`).
- **Tauri `ipc::Channel` with raw bytes** (`InvokeResponseBody::Raw`):
  - Payloads under 1 KB go by `eval`. Larger ones go by one `fetch` of the IPC custom protocol, delivered to JS as an `ArrayBuffer` (`tauri-2.10.2/src/ipc/channel.rs`: `MAX_RAW_DIRECT_EXECUTE_THRESHOLD = 1024`).
  - That is roughly one `fetch` per message, so we send **one multiplexed message per tick** (all subscribed instances), not one per instance.
  - A Tauri discussion measured ~10 MB binary IPC at ≈ 5 ms on macOS ([tauri #11915][tauri-ipc]). We need ≈ 4 KB per instance per 10 ms.

```
plugin (Live's audio thread) ─memcpy→ shm ring
  ─poll 2–5 ms→ live_send.rs reader thread ─resample to ctx rate→ per-instance staging
  ─every 10 ms: one Channel message [u32 header len][JSON header {ids, frames, dropouts}][f32 PCM…]→
page main thread (lib/liveSend.ts) ─postMessage(chunk, [chunk.buffer])→
AudioWorkletNode "playfield-receive" (one per subscribed instance; jitter buffer, drop/pad)
  ─→ the source's analyser / probe / effects, exactly as the Mic's MediaStreamSource feeds them today (never to destination)
```

- **Main-thread stalls:** the chunks go through the page's main thread, so a long stall caused by a heavy graph (more than the ≈ 30 ms cushion) becomes a short gap. The worklet counts it, and the analysis reads silence for that moment. The cushion is a setting (default 30 ms, up to 100 ms).
- **If WebKit doesn't pull a destination-less worklet:** the Mic path suggests an analyser-only graph is pulled. If a destination-less `AudioWorkletNode` turns out not to be, we connect it through a `GainNode(0)` to the destination. That is still silent.
- **Fallback B (no main thread):**
  - A dedicated Worker long-polls a custom protocol (`pfsend://localhost/pull?after=N`; `register_asynchronous_uri_scheme_protocol`). Rust answers once 10 ms of new audio is ready.
  - The Worker hands chunks to the worklet through a `MessageChannel`.
  - Try it in phase 2 only if stalls show up. Whether a Worker's `fetch` reaches a Tauri custom scheme in WKWebView must be checked first.
- **Fallback C:** analysis frames from Rust (see 3), losing the effects.

**Latency budget** (computed; to be measured in phase 2 with the fake sender and in phase 4 with Live):

| Hop | ms |
|---|---|
| Live's block (128–512 frames at 48 kHz) | 3–11 |
| Reader poll | 0–5 |
| Batch to the page | 0–10 |
| IPC (eval + fetch) | 1–3 |
| Main thread → worklet | 0–16 |
| Worklet cushion | ≈ 30 |
| Analysis is read once per rendered frame | 0–16 |
| **Total** | **≈ 40–70** |

Live's output buffer delays what you hear by its own 5–20 ms, so the picture lags the *heard* sound by less than this. The source's **Sync offset** (ms, already in the Open ↗ window) is there for the rest.

**Pro or Free:** the Audio nodes are Free today, the Audio engine and Live connector extras are Pro (`docs/accounts-and-plans.md`). See open question 1.

## 6. Build and ship

**Where the code goes:**
- `crates/pfsend-protocol/`: the segment layout, ring reader and writer, and the hello encoding. It is `no_std`-friendly for the writer side and has unit tests.
- `tools/playfield-send/`: the plugin `cdylib`.
- `src-tauri/src/live_send.rs`: reader, resampler, Channel and commands. `src-tauri` uses the protocol crate through a path dependency, so the plugin and the app can't drift.

**Bundle** (`tools/playfield-send/bundle.sh` or a small `xtask`):
1. `cargo build --release` for `aarch64-apple-darwin` and `x86_64-apple-darwin`.
2. `lipo -create` the two builds.
3. Lay out `Playfield Send.vst3/Contents/{Info.plist (CFBundlePackageType BNDL), PkgInfo, MacOS/Playfield Send, Resources/moduleinfo.json, Resources/CREDITS.txt}`.
4. Export `GetPluginFactory`, `bundleEntry` and `bundleExit`.

**Validate:**
- Steinberg's **validator** (from the SDK, MIT, built once in CI) runs on the bundle.
- [pluginval][pluginval] (GPLv3, used only as a test tool) is optional.

**Signing and notarisation:**
- `codesign --force --options runtime --timestamp --sign "Developer ID Application: …"` on the bundle, **before** it is copied into the app. Tauri's bundler won't reliably sign a Mach-O sitting in resources, and notarisation rejects unsigned nested code.
- The app's notarisation then covers the nested bundle.
- There are reports that stapling a bare `.vst3` fails ([KVR][kvr-notar]). We don't distribute it bare, so we don't need to.
- If a stand-alone download is ever wanted, the way to go is a notarised, stapled `.pkg` ([JUCE forum][juce-sign], [HISE][hise-sign]).

**Gatekeeper and Live:**
- Quarantine comes from the download, not from a signature check on plugins. "Open Anyway" doesn't work for plugins, and users end up running `xattr -rd com.apple.quarantine` ([JUCE forum][juce-gatekeeper], [Ableton forum][ab-quarantine]).
- **A copy made by our app is not quarantined.** Playfield isn't a quarantine-aware downloader. Check with `xattr` in phase 0.
- On arm64 every Mach-O must be at least ad-hoc signed. The linker does that by itself, so a local dev build loads too.
- Live loads third-party plugins signed by other teams, so library validation is off in Live. An ad-hoc dev build should load. Confirm this in phase 0.

**Install from the app:**
- Settings → Live → **Install Playfield Send**, next to *Install the Live connector*. It copies the bundled `.vst3` to `~/Library/Audio/Plug-Ins/VST3/`. This is the per-user folder, so no admin rights are needed, and Live scans it when "Use VST3 Plug-in System Folders" is on (the default).
- It copies to a temp name and then **renames atomically**, so a Live that has the old one loaded keeps running.
- Afterwards it says: *Restart Live, or Settings → Plug-ins → Rescan.*

**Updates:**
- Each hello carries the plugin's version. The app shows *"Update Playfield Send"* when Live is running an older one.
- The protocol version in the segment header lets the app read versions N and N-1, so an old plugin keeps working until Live restarts.

**Windows (later, with the desktop app):**
- Same plugin, built for `x86_64-pc-windows-msvc` (arm64 later).
- Shared memory via `CreateFileMappingW("Local\\pfsend.<pid>.<n>")`.
- Per-user VST3 folder `%LOCALAPPDATA%\Programs\Common\VST3`; the system one is `C:\Program Files\Common Files\VST3` and needs admin.
- Authenticode signing.

## 7. Phases

| # | Phase | Effort | Tests | Needs your Live |
|---|---|---|---|---|
| 0 | **Spike:** a pass-through VST3 on the `vst3` crate that writes a sine's level to shm, plus a CLI reader that prints it. Check that an **ad-hoc-signed local build** scans and loads in Live 12 (and 11 if you have it) on Apple Silicon, that the Remote Script's LOM sees the Pairing ID parameter, and that an app-made copy has no quarantine attribute. | S | none (by hand) | **yes**: rescan, drop it on a track, read the log |
| 1 | **Protocol crate + fake sender + reader:** the segment, the ring, hello/bye, overrun, stale, generation change and dead-pid clean-up. `live_send.rs` with the list of instances and their meters. | M | `cargo test`: ring wrap, overrun, a generation change mid-read, the seqlock name. **`pfsend-fake`** (a Rust bin): N fake instances at a chosen rate and block size, with jitter, stalls, a rate change and a crash. It is used by `src-tauri` tests and by hand with the app. | no |
| 2 | **Into the page:** the Channel multiplexer, `lib/liveSend.ts`, the `playfield-receive` worklet with its jitter buffer, the Audio Source **Live** tab (`kind 'send'`), status and counters. Measure latency and stalls against the fake sender. Try fallback B only if needed. | M | vitest: the multiplex decoder, the jitter buffer's drop/pad, `audioSourceKind`, a saved `sendId` that is missing. A Rust test of the resampler (a sine stays at its pitch across 44.1 → 48 kHz). | no |
| 3 | **Plugin v1:** params and state, the duplicate-ID re-roll, the hello thread, `setupProcessing` and rate changes, ignoring offline renders, a universal bundle, the validator in CI. | M | Rust unit tests of the processor (pass-through is bit-exact, the ring gets the frames). Steinberg validator in CI (macOS runner). | yes: duplicate a track, change the sample rate, export, freeze |
| 4 | **Pairing:** the Remote Script reports `/pf/sends`, the app joins it to the IDs, names and colours appear on the cards, and the name is written back to the plugin. | S | Python tests with `tests/fake_live.py` (a PluginDevice on a track, a return, nested in a rack, renamed, recoloured, removed). vitest with `tools/fake-live.mjs` sending `/pf/sends`. | yes |
| 5 | **Play:** reader input `send:<id>`, control groups, the Live audio chip. | S | vitest (`readerControls`, `setReaderInput`) | a quick look |
| 6 | **Install, update, sign:** the bundle as a Tauri resource, the Install / Update button, the version check, Developer ID signing in the release script, a notarised app with the nested plugin. | S–M | Rust test: install into a temp folder, atomic replace, version read. | **yes**: a clean install from a signed build |
| 7 | **Plugin UI** (if wanted): a small native view with the name field, the "→ Live · Drums ● Streaming" status, and the ID. | M | by hand | yes |
| 8 | **Docs and release:** an `audio-tools.md` section, `connecting-ableton.md`, What's new, `release:sync`. | S | — | — |
| later | Windows; AUv2 via clap-wrapper for other hosts; Rust-side analysis frames if the raw path is too heavy. | | | |

Phases 1–3 are the core (M+M+M) and need no Live except for phase 3's checks. Live is needed for phase 0's load test, and later for the feel of the latency, duplicate tracks, sample-rate changes, export/freeze and install. The user tests these; we don't launch Live. CPU test: 16 instances in one set, Live's CPU meter before and after.

## 8. Open questions for you

1. **Free or Pro?** The Audio nodes are Free today. Should a Live track as a source be Free, or a Pro feature alongside the Live connector's extras?
2. **The plugin's own UI in v1, or later?** Without one, you name a send in Playfield, and with the Live connector it is named after the track automatically. A native UI (name field and status) is phase 7, about a week more.
3. **Signing:** is there an Apple **Developer ID** (paid developer account) for the desktop app's releases? Without it, the plugin can only be ad-hoc signed. It still loads for you, but other people's downloads would hit Gatekeeper.

## Sources

- Steinberg: [VST 3.8 press release (2025-10-29)][stb-pr], [VST 3 SDK licence][stb-lic]; coverage: [Sound On Sound][sos], [CDM][cdm]
- nih-plug: [README][nih], [PR #263 switch to `vst3`][nih-263], [issue #274][nih-274]
- `vst3` crate: [crates.io][vst3-crate], [coupler-rs/vst3-rs][vst3-rs], [Micah Johnston: vst3 0.3][micah]
- [clap-wrapper][clap-wrapper], [clack][clack], [iPlug2][iplug2]
- JUCE: [JUCE 8 EULA changes][juce-eula], [revenue tiers][juce-tiers]
- Ableton: [AU and VST plug-ins on macOS][ab-mac], [VST on Windows][ab-win], [Live 12 manual: Using Plug-Ins][ab-manual], [CLAP request thread][ab-clap], [quarantine thread][ab-quarantine]
- Signing: [JUCE: signing audio plugins][juce-sign], [JUCE: Open Anyway and unsigned VST3][juce-gatekeeper], [KVR: notarising plugins][kvr-notar], [HISE: code signing 2024][hise-sign]
- Tauri: [IPC performance discussion #11915][tauri-ipc]; `tauri-2.10.2/src/ipc/channel.rs` (local source)
- [rubato][rubato], [pluginval][pluginval]

[stb-pr]: https://ocl-steinberg-live.steinberg.net/_storage/asset/819253/storage/master/Press%20Release%20-%202025-10-29%20-%20VST%203.8%20-%20EN.pdf
[stb-lic]: https://forums.steinberg.net/t/vst-3-sdk-license/201637
[sos]: https://www.soundonsound.com/node/4934285
[cdm]: https://cdm.link/open-steinberg-vst3-and-asio/
[nih]: https://github.com/robbert-vdh/nih-plug
[nih-263]: https://github.com/robbert-vdh/nih-plug/pull/263
[nih-274]: https://github.com/robbert-vdh/nih-plug/issues/274
[vst3-crate]: https://crates.io/crates/vst3
[vst3-rs]: https://github.com/coupler-rs/vst3-rs
[micah]: https://micahjohnston.com/posts/vst3
[clap-wrapper]: https://github.com/free-audio/clap-wrapper
[clack]: https://github.com/prokopyl/clack
[iplug2]: https://github.com/iPlug2/iPlug2
[juce-eula]: https://forum.juce.com/t/amendments-to-the-juce-end-user-licence-agreement-for-juce-8/61265
[juce-tiers]: https://forum.juce.com/t/revenue-limits-for-juce-tiers/61058/23
[ab-mac]: https://help.ableton.com/hc/en-us/articles/209068929
[ab-win]: https://help.ableton.com/hc/en-us/articles/209071729
[ab-manual]: https://www.ableton.com/de/live-manual/12/using-plug-ins/
[ab-clap]: https://forum.ableton.com/viewtopic.php?p=1823301
[ab-quarantine]: https://forum.ableton.com/viewtopic.php?p=1802866
[juce-sign]: https://forum.juce.com/t/how-to-start-with-signing-audio-plugins/44972
[juce-gatekeeper]: https://forum.juce.com/t/mac-open-anyway-not-working-for-unsigned-mac-vst3/64574
[kvr-notar]: https://www.kvraudio.com/forum/viewtopic.php?p=7756392
[hise-sign]: https://forum.hise.audio/topic/10812/codesigning-notarization-2024?page=2
[tauri-ipc]: https://github.com/orgs/tauri-apps/discussions/11915
[rubato]: https://crates.io/crates/rubato
[pluginval]: https://github.com/Tracktion/pluginval
