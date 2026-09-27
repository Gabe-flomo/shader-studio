# Drum pads

A **Drum pads** layer is a 4 × 4 sampler: each pad plays a sample, Simpler-style, hit by clicks, keys, MIDI notes, a pad grid, actions and signals, and takes. It draws nothing on the picture; its sound goes through its own effect chain to the master bus, feeds the audio readers, and is mixed into recordings and renders. Add it from **Add layer → Inputs & helpers → Drum pads** (layers are Pro). The example is **Drum pads** in the Play folder, next to Audio effects.

## Pads

Sixteen pads, drawn like the hardware: pads 1–4 along the bottom, 13–16 on top. Click a pad to play it (higher on the pad is a harder hit) and to select it for editing. Drop a sound file on a pad to load it.

Each pad plays one of:

- **A file of your own** (WAV, MP3, OGG, M4A, AIFF, FLAC). It goes into the media library in IndexedDB (the `videos` store of `shader-studio-backgrounds`, where Video layers' files live). The pad keeps only the file's library id, name and size (`sampleId`, `fileName`, `bytes`). So samples travel wherever videos do: library ZIPs (`backgrounds/videos.json` and `backgrounds/videos/`), the workspace and backup folders, profiles, and `.playfile`s (a pad's `sampleId` is collected like a Video layer's `videoId`, `playfile/bundle.ts videoIdsIn`). A sample this browser doesn't have is shown as **missing**, and the pad asks for it again.
- **A generated drum**: kick, snare, closed hat, open hat, clap, tom, rim or cowbell (`dpSynthData` in the kit). They're made from a seed when the layer loads, so they need no file and sound the same everywhere, websites included.

Per pad:

| Setting | What it does |
| --- | --- |
| Start, End | The part of the sample that plays (0..1). Drag the edges on the waveform. With Loop, start to end is the loop. |
| Mode | **One-shot** plays to the end, however short the hit. **Gate** plays while the pad, key or note is held, then fades over Release. |
| Loop | Gate pads: go round start to end while held. One-shot pads ignore it. |
| Reverse | Play backwards, from End to Start. |
| Pitch | Semitones, −24 to +24. The sample plays faster or slower, like tape (`dpRate`). |
| Volume, Pan | Level (0–1.5) and left/right. |
| Attack, Decay, Sustain, Release | The amp envelope: straight lines up to full level, down to Sustain, then (gate pads, once let go) down to silence over Release. One-shots end with a 3 ms fade so they never click. |
| Velocity | How much a hit's velocity sets its volume: 0 plays every hit the same, 1 plays a soft hit quietly. |
| Choke | Groups 1–8: a hit cuts every pad sounding in its group, over 4 ms. Put a closed and an open hat together. |

A pad's numbers are layer properties named `pad<N>_<key>` (`pad3_pitch`, `pad1_start`). So each one is a control target (`layer:<id>::pad3_pitch`), mappable, recorded in takes and read by conditions, like any layer number. Only pads that play something list their numbers. Pitch, volume and pan also move sounding voices, gliding over 10 ms. The layer's **Volume** (after its effect chain) is a layer number too.

## What plays them

- **Clicks** on the layer card.
- **Keys** (on the Play page, not while typing): Z X C V play pads 1–4, A S D F 5–8, Q W E R 9–12, 1 2 3 4 13–16. Turn off with **Keys**.
- **MIDI notes**: from the **base note** (36 by default, so 36–51 like a drum rack), on any channel or one channel. Note-on velocity sets how hard, and note-off lets a gate pad go. MIDI files and the computer-keyboard stand-in play them too.
- **The pad grid** (MIDI settings → Pad grid): its lower-left 4 × 4, from the device or the on-screen grid. A note the grid takes isn't also played as a note.
- **Actions**: **Do: Play pad** with the pad's number, from any trigger (a key, a beat, an audio reader crossing, a zone click, a hand gesture) or a **signal**. So conditions and signal chains can play drums.
- **Takes**: every hit is recorded as a `pad` event (pad number, velocity, and 0 for a gate pad let go). Each is stamped with the clock time it landed between frames (`playDrumPads.clockNow`), not the next frame's. Playing a take back plays them.

A hidden layer is silent and ignores everything.

## Sound

```
hits → sampler (voices: source → envelope → volume → pan) → [layer:<id> chain] → Volume → mix → [master chain] → speakers
                                                                 └─ analyser (the readers)                 └─→ record bus
```

- `src/play/kit/drumPads.js`: the sampler (`dpCreateSampler`), the pad math, the generated drums. The app, offline renders and web pages all use it.
- `src/play/drumPads.ts`: the app's host. It loads and decodes samples in the audio engine's context, builds a kit per layer on first use, attaches its chain to `audioFxHost` and joins it to the mix with `audioEngine.connectOutside`. It also listens to keys, MIDI and the pad grid, and routes every hit through the overlay (`playOverlay.act` → `onPad`), so takes see them.
- `src/lib/padSound.ts`: where the readers and offline mixes find a layer's analyser and decoded samples.

**Effects**: one chain for the whole kit, `layer:<id>`, listed in Finish → Sound as the layer (docs/audio-effects.md).

**Readers**: **Listen to → Drum pads · <layer>** (input `pads:<layerId>`). **Readers listen here** on the card does the same. By default the readers hear the kit after its effects.

## Recordings and renders

- **Real-time recordings** take the kit from the record bus, like any sound.
- **Frame-by-frame renders of a take** (`lib/recordingAudio.ts`): each Drum pad layer with a sample open is a track (`padTrackOf`). The take's pad events become hits in the mix's seconds (`padHitsOf`). `playPadHits` schedules each one in the `OfflineAudioContext` at its exact sample, through the same sampler and the layer's chain. Each pad's numbers come from the take's control tracks at the moment of the hit (`takeValueAt`, which now follows layer numbers as well as effect numbers). A render without a take has no hits, so the kit is silent: it never plays by itself.

## Websites

A web export carries each pad's sample in the pad as a data URL (`src`). The file must be open in the app this session and at most 6 MB, the same limit as songs (`lib/mediaSources.ts`, key `dsample:<sampleId>`). Generated drums need nothing. A sample that stays out is listed under **Left out**, and that pad is silent on the page. The page decodes the samples as it opens, and sound starts at the visitor's first click or key. On the page:

- **Keys** (player embeds only; a background never takes keys) and **MIDI notes** (after **Enable MIDI**) play pads.
- The player's panel has a button per pad that plays something.
- **Play pad** actions play them from any trigger the page runs.
- Readers can listen to the kit (`pads:<id>`), and the kit goes through its effect chain and the master chain.

The page doesn't map the pad grid to the pads yet.

## Plan

Drum pads are a layer, so they're Pro (`play.layers`). On Free the layer isn't in what plays (`planGates.ts`), so nothing hits it.

## Tests

`src/play/__tests__/drumPads.test.ts` renders through real Web Audio in Node (`node-web-audio-api`), into buffers only. It covers:

- the pad math: pitch → rate, regions, reverse, the envelope, velocity, keys, notes and cells
- the sampler: hit timing, pitch, start/end, reverse, gate release, looping, choke, velocity
- triggering from MIDI (range, channel), keys (not while typing, not off the Play page), the on-screen grid and actions
- an offline mix placing a take's hit on its exact sample, with the take's pitch
- the record (parse, old files, actions, take events, targets) and web exports (samples carried or left out, the page's kit)

## Not yet

- Banks (A/B): 16 pads per layer. Add a second layer for more.
- A library tab of its own for sounds: samples are listed with the videos (no poster).
- Presentations' own copies of pad samples (a Play in a presentation plays generated drums, and its sample pads are silent on the page).
- The pad grid on websites. Sample slicing, time-stretch, and filter or pitch envelopes per pad.
- A MIDI file's notes play the pads live, but a render only hears hits recorded in a take.
