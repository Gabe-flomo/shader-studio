# Audio engine: Audio Unit synths and effects

The Play page's **Engine** tab is a set of **racks**. Each rack is an instrument, then effects, played from MIDI and the computer keyboard, with its own spectrum for audio readers:

```
MIDI / keyboard / keys on the card ─→ [instrument: AU synth, or the sample player] ─→ [AU effects…] ─→ rack mixer ─→ main mixer ─→ output device
                                                                                                          └─→ tap → FFT → `audio-engine://frame` → readers, the card's spectrum
```

In the **desktop app on a Mac** the racks run in a native engine (AVAudioEngine) that hosts **Audio Units** (v2 and v3), so any installed synth or effect works. In a **browser** a rack plays the **sample player** only, in Web Audio; Audio Unit slots are kept in the setup and play again on the desktop.

Everything here is **Pro**: `audio.engine` (racks, the sample player, engine readers) and `audio.plugins` (Audio Units, on racks and behind "+ Audio Unit effect"). On Free the record keeps its racks (nothing is dropped), the Engine tab shows the Pro card, and `playableForPlan` gives the engine no racks. **Upload sounds** in the Library stays Free: the sounds are drum pad samples too, which are Pro-layer features already, but keeping uploads open costs nothing and the Sounds tab was Free before.

## The rack card

- **Played by**: any MIDI input, none, or one device by name; a channel or all. **Computer keyboard and MIDI file** lets the keyboard stand-in (A–K white keys, W E T Y U black, Z/X octave, C/V velocity; **Keys as a piano** turns it on) and the record's MIDI file play the rack. The strip of keys on the card plays with the mouse (higher on a key hits harder; Shift is full velocity).
- **Spectrum**: the rack's sound after its effects. **Readers listen here** points the setup's audio readers at it (`audioReaders.input = engine:<rackId>`), then clicking the spectrum places readers exactly as on the Audio readers panel; **Audio readers…** opens the panel listening to the rack. In the panel, **Listen to** lists **Audio engine · <rack>**.
- **Instrument**: **Choose an instrument…** offers the **Sample player** and every enabled Audio Unit instrument (desktop). The sample player has **zones**: a Library sound on one key (drum-rack style from C2 = 36, the next free key each time) or across every key at its own pitch on C4. Each row sets the lowest key, the highest and the key where it plays unpitched. **Use the first 16 as a kit** fills C2… from the Library's sounds.
- **Effects**: **Audio Unit effect…** appends one; each card has bypass, earlier/later, remove. The order is the chain's order.
- On an Audio Unit card: the **window** button opens the plug-in's own view (AUv3 view controller, else the AUv2 Cocoa view, else Apple's generic view) in a native window; the **sliders** button lists its parameters. Every number, toggle and list is editable here, and the **+** makes it a Play control, target `au:<rackId>:<slotId>::<address>` (the instrument's slot id is `inst`). **Keep its settings** stores the unit's whole state (`fullState`, base64) in the setup, so a preset dialled in the plug-in's window comes back next time.
- **Volume** and **mute** per rack; the engine's **Output** device, **Volume** and mute at the top of the tab (this device's settings, `shader-studio:audio:engine`).

## Mapping and takes

A parameter control works like an audio effect's number: `parsePropTarget` gives the engine the prop id `au:<rack>:<slot>`, the mapping engine drives it (`playEngine.layerValue`), and every frame the host sends changed values to the native side, which glides numbers over 30 ms (`params.rs Smoother`) and jumps lists and toggles. A value moved on the card is kept in the record (`slot.params`) and put back when the unit loads, or when a mapping lets go. Removing a rack, an effect or an instrument removes the controls on it and their mappings (`withEngine`), and a loaded file keeps controls only for slots it has.

Notes go through the Play overlay as pad actions on `ae:<rackId>` (`pad` events, note + 1 as the amount, velocity 0..1, 0 for note off), so a **take records them** and plays them back into the rack; CC and pitch bend go straight to the rack and aren't recorded. Parameter controls are recorded like any control. A rack can **follow a Drum pad layer** (`rack.pads`): its hits (live, keys, MIDI, actions, a take) play note 36 + pad in the rack. **Finish → Sound → + Audio Unit effect** on a Drum pad layer's chain offers exactly that: it makes a rack with the layer's own samples, following the layer, and turns the layer's own Volume to 0 so the engine's version is what you hear.

## Limits of v1

- **Web sounds don't pass through Audio Units.** Audio layers, Video sound and the built-in effect chains play in Web Audio inside the webview; the native engine can't take that stream yet. "+ Audio Unit effect" on those chains explains this and opens the Engine tab. Drum pads have the follow-rack route above.
- **The engine's sound isn't in recordings or renders.** Real-time recordings tap Web Audio's record bus; the native engine goes straight to the output device. Frame-by-frame renders don't render AU racks. To capture it, record the output with a loopback device (BlackHole, Loopback) or a DAW, or set the engine's Output to such a device.
- No AUv3 out-of-process crash isolation beyond what macOS gives AUv3 extensions (they already run out of process); an AUv2 that crashes takes the app with it.
- One output device for the whole engine; racks can't go to separate outputs.
- Sample player zones have no envelope or velocity curve, and up to 8 voices per rack.

## Plugins (Library → Settings → Plugins)

Every installed Audio Unit (instruments and effects, with maker, kind, version, AUv2/AUv3) with a switch: only the ones switched on appear in the instrument and effect pickers (a rack already using a hidden one keeps it). Search, **Enable all** / **Disable all** (of what the search shows), **Rescan plugins**, a count. A rescan tags newly found units **New** until the list is closed; **New plugins start disabled** makes them start off. Kept per device as `shader-studio:audio:plugins` (Files → App settings → Camera, MIDI, OSC and audio → Audio Unit plugins; resetting offers every unit again). `lib/pluginSettings.ts`.

## Where things are

| Piece | File |
| --- | --- |
| The record: racks, slots, zones, targets, parsing | `src/types/playAudioEngine.ts` |
| Running it: reconciling the record into the native engine, the browser sample player, MIDI in, mapped parameters, spectra | `src/lib/audioEngineHost.ts` (+ `audioEngineWire.ts` joins it to the overlay, Web Audio and the Library) |
| Frames, parameter lists, MIDI bytes (pure) | `src/lib/audioEngineProtocol.ts` |
| Readers on a rack | `src/lib/engineSound.ts`, `audioReaderBank.ts`, `readersPanelUi.ts` |
| UI | `src/components/play/engine/` (AudioEnginePanel, RackCard, UnitPicker, PluginsDialog, engineOps) |
| Plugins setting | `src/lib/pluginSettings.ts` |
| Native engine (Objective-C, AVAudioEngine) | `src-tauri/native/audio_engine.m`, compiled by `build.rs` on macOS |
| Rust: commands, worker thread (glide + frames), FFI, FFT and packing, parameter descriptions | `src-tauri/src/audio_engine/{mod,ffi,analysis,params}.rs` |
| Entitlement to load third-party AUv2 code | `src-tauri/Entitlements.plist` (`com.apple.security.cs.disable-library-validation`) |

Commands: `ae_status`, `ae_units`, `ae_rack_create/remove/volume`, `ae_set_instrument`, `ae_set_sampler`, `ae_sound_has/put` (the Library's sound cached under `<app cache>/engine-sounds/<id>.<ext>`), `ae_sampler_zone`, `ae_effect_insert/remove/move`, `ae_bypass`, `ae_params`, `ae_param_set` (with `smooth`), `ae_state_get/set`, `ae_midi`, `ae_outputs`, `ae_set_output`, `ae_master`, `ae_open_ui`. Frames: `audio-engine://frame` `{ rack, sampleRate, bins, wave, rms, peak }`, 1024 bins as bytes (dB = byte / 2 − 130, Blackman window, smoothed like an AnalyserNode), 512 waveform bytes, about 33 a second while a rack sounds.

## Tests

- `src/play/__tests__/audioEngine.test.ts`: the record, targets, parsing, the protocol, the host against a fake bridge (build, reorder, bypass, failures and retry, sound caching, Pro gates, notes through takes, drum pad following, mapped parameters, reader spectra), the Plugins setting, Library usage, app settings.
- `cargo test --lib audio_engine`: FFT and packing, parameter descriptions and the smoother, id checks, MIDI splitting.
- `cargo test --lib audio_engine::native -- --ignored --test-threads=1`: the real engine in **offline manual-rendering mode** (no device, nothing heard) with Apple's built-in units: DLSMusicDevice makes sound on a note and silence before it, the tap and FFT find A4, AUDelay / AULowpass / AUReverb2 load, a Hz parameter is set and read back, reorder, bypass, remove, preset round-trip, mute gives silence, a missing unit is an error, the sample player pitches a WAV up an octave.

## For the owner to test on hardware

1. Build the desktop app; on first launch open Library → Settings → **Plugins** and check the list has Apple's units (DLSMusicDevice, AUSampler, AUDelay, AUReverb2, AULowpass…) and your third-party ones. Hide one and check it leaves the pickers.
2. Engine tab → Add a rack → Choose an instrument → **DLSMusicDevice**; play the card's keys and a MIDI keyboard: sound from the chosen output, the spectrum moving. Readers listen here → place a reader → map it to a control.
3. Add **AUDelay** and **AUReverb2**; open their windows, reorder, bypass. Move a parameter, make it a control, map an LFO to it: it should glide, not click.
4. A third-party AUv2 (a signed build needs the entitlement; an ad-hoc dev build loads them anyway) and an AUv3 (it appears with "AUv3"; its own view should open in the window).
5. Keep its settings → save the setup → reopen: the plug-in comes back as dialled.
6. Upload sounds in the Library → a sample player rack → "Use the first 16 as a kit" → play from a pad controller.
7. Record a take while playing a rack; play it back.
8. Change the output device while playing; unplug it.
