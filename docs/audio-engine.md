# Audio engine: Audio Unit synths and effects

The Play page's **Engine** tab is a set of **racks**. Each rack is an instrument, then effects, played from MIDI and the computer keyboard, with its own spectrum for audio readers:

```
MIDI / keyboard / keys on the card ─→ [instrument: AU synth, or the sample player] ─→ [AU effects…] ─→ rack mixer ─→ main mixer ─→ output device
a page sound (a send) ─────────────→ [input fed from the page]                    ─┘                       │             └─→ tap → WAV (a real-time recording)
                                                                                                          └─→ tap → FFT → `audio-engine://frame` → readers, the card's spectrum
```

In the **desktop app on a Mac** the racks run in a native engine (AVAudioEngine) that hosts **Audio Units** (v2 and v3), so any installed synth or effect works. In a **browser** a rack plays the **sample player** only, in Web Audio; Audio Unit slots are kept in the setup and play again on the desktop.

Everything here is **Pro**: `audio.engine` (racks, the sample player, engine readers) and `audio.plugins` (Audio Units, on racks and behind "+ Audio Unit effect"). On Free the record keeps its racks (nothing is dropped), the Engine tab shows the Pro card, and `playableForPlan` gives the engine no racks. **Upload sounds** in the Library stays Free: the sounds are drum pad samples too, which are Pro-layer features already, but keeping uploads open costs nothing and the Sounds tab was Free before.

## The rack card

- **Played by**: any MIDI input (the default: a controller plugged in just plays, and so do the record's MIDI file and the MIDI node's keyboard stand-in), none, or one device by name; a channel or all (the default: an MPK mini's pads on channel 10 reach the rack along with its keys on channel 1). **Computer keyboard** gives the rack the computer keyboard (below). The strip of keys on the card plays with the mouse (higher on a key hits harder; Shift is full velocity) and lights the notes typed.
- **Spectrum**: the rack's sound after its effects. **Readers listen here** points the setup's audio readers at it (`audioReaders.input = engine:<rackId>`), then clicking the spectrum places readers exactly as on the Audio readers panel; **Audio readers…** opens the panel listening to the rack. In the panel, **Listen to** lists **Audio engine · <rack>**.
- **Instrument**: **Choose an instrument…** offers the **Sample player** and every enabled Audio Unit instrument (desktop). The sample player has **zones**: a Library sound on one key (drum-rack style from C2 = 36, the next free key each time) or across every key at its own pitch on C4. Each row sets the lowest key, the highest and the key where it plays unpitched. **Use the first 16 as a kit** fills C2… from the Library's sounds.
- **Effects**: **Audio Unit effect…** appends one; each card has bypass, earlier/later, remove. The order is the chain's order.
- On an Audio Unit card: the **window** button opens the plug-in's own view (AUv3 view controller, else the AUv2 Cocoa view, else Apple's generic view) in a native window; the **sliders** button lists its parameters. Every number, toggle and list is editable here, and the **+** makes it a Play control, target `au:<rackId>:<slotId>::<address>` (the instrument's slot id is `inst`). **Keep its settings** stores the unit's whole state (`fullState`, base64) in the setup, so a preset dialled in the plug-in's window comes back next time.
- **Volume** and **mute** per rack; the engine's **Output** device, **Volume** and mute at the top of the tab (this device's settings, `shader-studio:audio:engine`).

## Computer keyboard

**Computer keyboard** on a rack card plays the rack from the keyboard the way a DAW's musical typing does. Off by default, so a plugged-in controller is what plays; on for one rack at a time (turning it on for another rack turns it off here). While it's on and the Play page shows:

- **A W S E D F T G Y H U J K** are C, C#, D, D#, E, F, F#, G, G#, A, A#, B, C from the octave; **O L P ; '** carry on above. **Z / X** move the octave down and up, **C / V** the velocity by 16 (the card has the octave and a velocity slider too), **Shift** sustains: keys let go keep sounding until Shift goes up.
- **The keyboard is the rack's**: every plain key is swallowed, so the app's shortcuts (F, A, U, T, the number filters…), the Play page's key mappings, drum pad keys, Space and the arrow keys don't fire. Combos with ⌘, ⌃ or ⌥ (Save, Undo, Rebuild…) still work, Tab still moves focus, and text fields still type normally.
- **A pill in the top bar** says "Keyboard → <rack> · Esc" while a rack has it. **Esc**, or clicking the pill, gives the keyboard back; so does removing the rack or leaving the Play page. All of these write `keyboard: false` into the rack, so the card's toggle follows.
- Notes go through the Play overlay like MIDI notes (`ae:<rackId>` pad actions), so a **take records them**.

Stored per rack as `rack.keyboard` (`types/playAudioEngine.ts`: `setRackKeyboard`, `keyboardRack`). The runtime is `lib/rackKeyboard.ts` (the key handling, the `useRackKeyboard` store the card and pill read) and `lib/keyboardClaim.ts` (`keyboardClaimed(e)`, which every plain-key handler asks first). The host passes the record's keyboard rack to it in `frame()`; `audioEngineWire.ts` wires the record write-back.

The MIDI node's own **keyboard stand-in** (Studio, `midiEngine.setKeyboardEnabled`) is separate: it plays MIDI nodes and mappings, and reaches a rack on "any MIDI input" like a MIDI file would. It stands aside while a rack has the keyboard.

## Mapping and takes

A parameter control works like an audio effect's number: `parsePropTarget` gives the engine the prop id `au:<rack>:<slot>`, the mapping engine drives it (`playEngine.layerValue`), and every frame the host sends changed values to the native side, which glides numbers over 30 ms (`params.rs Smoother`) and jumps lists and toggles. A value moved on the card is kept in the record (`slot.params`) and put back when the unit loads, or when a mapping lets go. Removing a rack, an effect or an instrument removes the controls on it and their mappings (`withEngine`), and a loaded file keeps controls only for slots it has.

Notes go through the Play overlay as pad actions on `ae:<rackId>` (`pad` events, note + 1 as the amount, velocity 0..1, 0 for note off), so a **take records them** and plays them back into the rack; CC and pitch bend go straight to the rack and aren't recorded. Parameter controls are recorded like any control. A rack can **follow a Drum pad layer** (`rack.pads`): its hits (live, keys, MIDI, actions, a take) play note 36 + pad in the rack. **Finish → Sound → + Audio Unit effect** on a Drum pad layer's chain offers exactly that: it makes a rack with the layer's own samples, following the layer, and turns the layer's own Volume to 0 so the engine's version is what you hear.

## In renders and recordings (desktop)

The Record dialog lists each rack with an instrument or a send as a sound ("Audio engine · Rack 1") next to the songs; **Include** takes them all, and the same toggle leaves them out.

**Frame-by-frame renders (FFmpeg, the PNG sequence) of a take.** The racks are rendered offline, natively, in a second AVAudioEngine in manual rendering mode (nothing is heard), then put under the page's mix: `lib/engineRender.ts` turns the record and the take into a job — each rack as it is (units, presets, parameter values, sample player zones, volume, mute), every note the take recorded (`ae:<rack>` pad actions, and the hits of a drum pad layer the rack follows) as MIDI bytes at its second, and every parameter control on an `au:` target as steps every 10 ms where its value changed — and `ae_render_take` (`render.rs`) replays it **sample-exactly**: the render runs up to each event's sample, applies what is due there, and runs on (`schedule`). The reply is raw PCM (a u32 JSON header, then left and right as f32) and goes straight into the offline mix's destination, past the page's master chain, as live (`recordingAudio.ts`, `MixFx.engine`). A rack's units may report latency (`AUAudioUnit.latency`); the mix slides the render earlier by the largest (`engineRenderLead`). Without a take there is nothing to replay, and the dialog says so. A unit that won't load offline is left out with a note under the dialog ("… couldn't load offline; record it in real time instead"); the rest of the rack still renders. Renders run up to 90 s.

Measured with Apple's units (`cargo test --lib audio_engine::native -- --ignored`): a take with a note at 0.5 s and one at 1.25 s through DLSMusicDevice → AUDelay rendered at 48 kHz has RMS 0 before sample 23 800 and 0.037 in the 50 ms after sample 24 000; DLSMusicDevice and AUDelay report 0 latency, so no shift is applied. An input rack (a send) fed a sine renders it from frame 0 (no added latency offline).

**Real-time recordings.** When the recording starts, `ae_tap_start` puts a tap on the live engine's main mixer (after its Volume and mute) into a stereo ring; the worker thread drains the ring every 10 ms into a 16-bit WAV (`tap.rs`), zero-filling any stretch it missed so time never slips. When the recording is saved, `ae_tap_stop` finishes the file and `mux_recording_audio` runs FFmpeg to put it under the video (the picture copied, never re-encoded; mixed with the page's own sound track when there is one, else as the sound track), and the WAV is removed. **Alignment:** the page asks for the tap immediately before starting the recorder and notes both moments; the native side reports how long after the tap was installed its first buffer was rendered (`mach_absolute_time`, typically one I/O cycle: ≤ 11 ms at 512 frames); the WAV is shifted by the difference (`engineTapOffset`, `-itsoffset`). What is left is the recorder's own start-to-first-frame time, about a video frame; so the engine lands within roughly a frame of the picture and the page's sounds (which the recorder timestamps on its own clock). The engine's Output device latency is not compensated (neither is Web Audio's). A stretch the ring lost is silence, and the dialog says how much.

## Web sounds through Audio Units (sends, desktop)

**Sound in** on a rack card replaces the instrument with a page sound: **Everything the page plays** (the master bus, after the master chain) or one layer's sound (an audio layer's song, a Video layer's sound, a Drum pad layer: its chain, after the layer's own effects and before the master chain). Stored as `rack.source` ('master' or a chain id). What happens (`lib/engineSend.ts`):

```
the chain's output ─(audioFxHost.divert)─→ AudioWorklet (512 frames a chunk, resampled to the engine's rate) ─→ ae_rack_feed (raw bytes)
  ─→ the rack's input ring (AVAudioSourceNode) ─→ its AU effects ─→ rack mixer ─→ the engine's output
```

It is **one way**: the sound leaves the page's output (so it isn't heard twice) and its record bus (a real-time recording gets it from the engine's tap instead); the engine's output plays it. The rack's spectrum and readers hear it after the effects; the page's own readers on that sound keep reading it before the send. The ring starts with 21 ms of silence so a late chunk arrives late rather than as a hole; the card shows how much is buffered and counts dropouts. **Latency** one way, by construction: a 512-frame chunk (10.7 ms at 48 kHz) + the IPC hop (about 1–3 ms) + the 21 ms cushion + the engine's I/O buffer (about 11 ms) ≈ **45 ms**; this is computed, not measured on hardware (there is no hardware test here) — the card's buffer readout is the number to check. The web side needs an AudioWorklet (WKWebView has one). In a frame-by-frame render the sent tracks are mixed on their own first (a chain send with its chain's effects, without the master chain; a master send with everything) and uploaded as the rack's source (`ae_render_input`), so the render matches. Sends are desktop only; in a browser the rack is silent and the card says so. There is no way back into the page (the engine's sound stays in the engine); a true round trip would cost a second hop's latency and isn't offered.

## Limits

- No AUv3 out-of-process crash isolation beyond what macOS gives AUv3 extensions (they already run out of process); an AUv2 that crashes takes the app with it.
- One output device for the whole engine; racks can't go to separate outputs.
- Sample player zones have no envelope or velocity curve, and up to 8 voices per rack.
- Renders replay only what a take recorded: CC and pitch bend aren't recorded, so a render doesn't have them; a note held across the take's start isn't heard (the render starts silent). Plug-ins that can't render offline are left out (noted); record in real time for those.
- The engine's Volume and mute are in a real-time recording (the tap is after them); a muted engine records silence. A frame-by-frame render ignores the engine's master Volume (rack volumes apply).
- A send's latency (≈ 45 ms) is not compensated anywhere: a drum pad layer sent through a rack sounds that much after its pad lights.

## Plugins (Library → Settings → Plugins)

Every installed Audio Unit (instruments and effects, with maker, kind, version, AUv2/AUv3) with a switch: only the ones switched on appear in the instrument and effect pickers (a rack already using a hidden one keeps it). Search, **Enable all** / **Disable all** (of what the search shows), **Rescan plugins**, a count. A rescan tags newly found units **New** until the list is closed; **New plugins start disabled** makes them start off. Kept per device as `shader-studio:audio:plugins` (Files → App settings → Camera, MIDI, OSC and audio → Audio Unit plugins; resetting offers every unit again). `lib/pluginSettings.ts`.

## Where things are

| Piece | File |
| --- | --- |
| The record: racks, slots, zones, targets, parsing | `src/types/playAudioEngine.ts` |
| Running it: reconciling the record into the native engine, the browser sample player, MIDI in, mapped parameters, spectra | `src/lib/audioEngineHost.ts` (+ `audioEngineWire.ts` joins it to the overlay, Web Audio and the Library) |
| Frames, parameter lists, MIDI bytes (pure) | `src/lib/audioEngineProtocol.ts` |
| Readers on a rack | `src/lib/engineSound.ts`, `audioReaderBank.ts`, `readersPanelUi.ts` |
| UI | `src/components/play/engine/` (AudioEnginePanel, RackCard, UnitPicker, PluginsDialog, engineOps, KeyboardPill) |
| Computer keyboard | `src/lib/rackKeyboard.ts`, `src/lib/keyboardClaim.ts` |
| MIDI devices and the Monitor (the antenna button in the Engine header) | `src/components/play/MidiMonitor.tsx`, `src/lib/midiMonitor.ts`; docs/midi.md |
| Plugins setting | `src/lib/pluginSettings.ts` |
| Renders and recordings: the job, the reply, alignment | `src/lib/engineRender.ts` (pure), `engineExport.ts` (the export's part), `recordingAudio.ts` (engine tracks, sends' tracks) |
| Sends | `src/lib/engineSend.ts`, `audioFx.ts` (`divert`) |
| Native engine (Objective-C, AVAudioEngine): the live and render contexts, the input source, the recording tap | `src-tauri/native/audio_engine.m`, compiled by `build.rs` on macOS |
| Rust: commands, worker thread (glide + frames + tap drain), FFI, FFT and packing, parameter descriptions, offline replay, the tap's WAV | `src-tauri/src/audio_engine/{mod,ffi,analysis,params,render,tap}.rs`; `lib.rs` `mux_recording_audio` |
| Entitlement to load third-party AUv2 code | `src-tauri/Entitlements.plist` (`com.apple.security.cs.disable-library-validation`) |

Commands: `ae_status`, `ae_units`, `ae_rack_create/remove/volume`, `ae_set_instrument`, `ae_set_sampler`, `ae_sound_has/put` (the Library's sound cached under `<app cache>/engine-sounds/<id>.<ext>`), `ae_sampler_zone`, `ae_effect_insert/remove/move`, `ae_bypass`, `ae_params`, `ae_param_set` (with `smooth`), `ae_state_get/set`, `ae_midi`, `ae_outputs`, `ae_set_output`, `ae_master`, `ae_open_ui`; sends: `ae_rack_input`, `ae_rack_feed` (raw f32 body, header `x-rack`), `ae_rack_input_stats`; renders: `ae_render_input`, `ae_render_take` (a `Response` of bytes); recordings: `ae_tap_start/stop/discard`, `mux_recording_audio`. Rack ids beginning with `render:` name racks in the render context (the Rust side adds the prefix). Frames: `audio-engine://frame` `{ rack, sampleRate, bins, wave, rms, peak }`, 1024 bins as bytes (dB = byte / 2 − 130, Blackman window, smoothed like an AnalyserNode), 512 waveform bytes, about 33 a second while a rack sounds.

## Tests

- `src/play/__tests__/audioEngine.test.ts`: the record, targets, parsing, the protocol, the host against a fake bridge (build, reorder, bypass, failures and retry, sound caching, Pro gates, notes through takes, drum pad following, mapped parameters, reader spectra), the Plugins setting, Library usage, app settings, MIDI routing by device and channel, the one-rack keyboard toggle.
- `src/lib/__tests__/rackKeyboard.test.ts`: musical typing, the claim that makes shortcuts wait, Esc and leaving Play giving the keyboard back.
- `src/play/__tests__/engineRender.test.ts`: the render job (racks, notes at their seconds inside the span, followed pads, parameter steps only where a value changed), the reply decoded, the render lined up in a real offline mix (a click lands where it was rendered, slid earlier by a reported latency), engine tracks and what a send takes out of the mix, the send choices, the tap's offset, and the host uploading a send's sound, rendering, tapping, muxing, and turning a rack into an input.
- `cargo test --lib audio_engine`: FFT and packing, parameter descriptions and the smoother, id checks, MIDI splitting, the replay schedule (render up to each event, group events at one sample, chunking, events at 0 first, late ones dropped), the job's shape and the reply's packing, the tap collector (a valid WAV, silence where frames were lost, an overlap kept once, the start offset); `cargo test --lib mux_tests`: FFmpeg's mux arguments.
- `cargo test --lib audio_engine::native -- --ignored --test-threads=1`: the real engine in **offline manual-rendering mode** (no device, nothing heard) with Apple's built-in units: DLSMusicDevice makes sound on a note and silence before it, the tap and FFT find A4, AUDelay / AULowpass / AUReverb2 load, a Hz parameter is set and read back, reorder, bypass, remove, preset round-trip, mute gives silence, a missing unit is an error, the sample player pitches a WAV up an octave; and a **take render** in the render context: two notes through DLSMusicDevice → AUDelay land at their samples (silence before, energy after, the second louder than the gap), a second render opens fine, a fed input comes through AUDelay from frame 0, a missing upload is an error, a missing unit is a note.

## For the owner to test on hardware

1. Build the desktop app; on first launch open Library → Settings → **Plugins** and check the list has Apple's units (DLSMusicDevice, AUSampler, AUDelay, AUReverb2, AULowpass…) and your third-party ones. Hide one and check it leaves the pickers.
2. Engine tab → Add a rack → Choose an instrument → **DLSMusicDevice**; play the card's keys and a MIDI keyboard: sound from the chosen output, the spectrum moving. Readers listen here → place a reader → map it to a control.
   Then **Computer keyboard** on the card: the top bar shows "Keyboard → Rack 1 · Esc", A–K play, F no longer fits the view, ⌘Z still undoes; Esc gives it back and the toggle goes off.
3. Add **AUDelay** and **AUReverb2**; open their windows, reorder, bypass. Move a parameter, make it a control, map an LFO to it: it should glide, not click.
4. A third-party AUv2 (a signed build needs the entitlement; an ad-hoc dev build loads them anyway) and an AUv3 (it appears with "AUv3"; its own view should open in the window).
5. Keep its settings → save the setup → reopen: the plug-in comes back as dialled.
6. Upload sounds in the Library → a sample player rack → "Use the first 16 as a kit" → play from a pad controller.
7. Record a take while playing a rack; play it back.
8. Change the output device while playing; unplug it.
9. **Render the take** (Record → the take → Encode with FFmpeg, Include sounds on): the video's sound has the rack's notes where you played them, with the delay and reverb; scrub to a hit and check it lands on the frame. Make a control of a parameter, wiggle it while recording another take, render: the sweep is in the sound. With a song playing too: both in the mix, the song through its chain, the rack straight in.
10. **Record in real time** with a rack sounding (and a song): the file has the rack's sound; the dialog says "Adding the Audio engine's sound…" at the end. Play the video against the live sound in your head: the racks and the song should line up (within a frame). Try with the engine muted (silence), and a longer recording (a minute) for dropouts.
11. **Sound in**: on a rack with AUDelay and AUReverb2, choose a Drum pad layer (or Everything the page plays). The pads now sound through the engine's output only, with the effects; the card shows about 20–40 ms buffered and no dropouts. Listen for the latency (a pad hit lands about 45 ms late), clicks (dropouts count up), and that switching back to "Its instrument" restores the page's sound. Render a take of it: the same sound offline.
