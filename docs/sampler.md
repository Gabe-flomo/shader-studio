# Sampler

The **Sampler** layer plays samples, after Ableton's Simpler, Sampler and Drum Rack. It has two views of one engine:

- **Drum view** (Drum Rack): 128 pads, 16 in view, each pad its own sound and settings (a chain), with choke groups.
- **Keys view** (Sampler): zones across the keyboard and velocity, played at pitch, with Classic, One-shot and Slice modes.

It draws nothing on the picture. Its sound goes through its own effect chain (Finish → Sound, `layer:<id>`) to the master bus, feeds the audio readers (`pads:<id>`), and is mixed into recordings and renders. Add it from **Add layer → Inputs & helpers → Sampler** (layers are Pro). It replaces the **Drum pads** layer: setups made with Drum pads open as a Sampler in its Drum view, sounding the same (see [Migration](#migration-from-drum-pads)). The plan and the Ableton research behind it are in [sampler-plan.md](sampler-plan.md).

## The editor

One editor, wherever the layer is edited:

- **The sidebar card** is the compact version: the view switch, the pads (or the zone editor), the selected sound's waveform, its amp envelope and its main numbers, with the other sections as small tabs. **Expand** (Open full editor) opens the split view's big Layers panel on this layer (`openLayerInSplit`), or a full-height sheet on a phone.
- **The big panel** adds the pad overview, waveform zoom, the zone editor's Velocity tab and roomier controls.

Its tabs: **Pads** / **Zones** (the primary one, open first), **Sample**, **Filter**, **Pitch & LFO**, **Voice** (Keys), **Kit** (Drum) and **Play**. Every number is a ruler with the app's conventions: type past the end of a soft range to widen it (times, amounts; physical ranges like Start, Pan or Sustain clamp), right-click for the Play/knob menu (add to controls, drive with a null, reset).

### Drum view

- **Pads**: a 4 × 4 window over the 128 pads, like Drum Rack's. Each pad shows its sound's name and its note (C1 = 36, Live's names), its choke group and its key. Click a pad to play it (higher on the pad is harder) and select it. **Drop sound files** on a pad: several fill the following pads. **Drag a pad onto another** to swap them (sounds and numbers). A missing file says so on the pad.
- **The pad overview** beside the pads is all 128 notes as 32 rows of 4, the window outlined and pads with sounds lit. Click or drag it (or scroll, or ↑ / ↓) to move the window a row at a time. The window is the layer's `bank` (its first note; C1 by default).
- **The selected pad**: its sound (a file, a linked folder's file, or a generated drum), its waveform, **Mode** (*One-shot*: plays to the end; *Classic*: plays while held, then Release; with **Loop**, round the loop brace while held), **Rev**, **Choke** (groups 1–16: a hit cuts every pad sounding in its group, over 4 ms, no click), the **amp envelope** picture, Gain, Transpose and Pan.
- **Sample** tab: Start, End, the loop (start, end, crossfade), One-shot's Fade out, Detune, Vel → Vol and its curve, and **Slice to pads**: the pad's sample is cut at its hits (inside Start…End) and one slice goes on each pad from this one on, as Ableton's Slice to Drum Rack.
- **Kit** tab: Save kit… / Load kit… (below), Sample index, Index spread, Index mode.

### Keys view

- **The zone editor**: the keyboard along the top (click or drag along it to play), one bar per zone underneath across its keys. Drag a bar's ends to resize it, its middle to move it, the small triangle to move its root key. The **Velocity** tab shows the same bars against velocity 1–127, for soft and hard layers.
- **Dropping files** (on the editor, or Add sounds…) makes a zone each, rooted at the note in its file name (`Cello_A2.wav` → A2, `piano-c#3` → C#3, `Pad 48.wav` → 48), else C3. Several with different roots split the keyboard between them (each zone from halfway to the root below to halfway to the root above), like Sampler's auto-map.
- **Modes**: *Classic* (plays while held; a zone with Loop on goes round its loop brace; then Release), *One-shot* (to the end; letting go does nothing), *Slice* (below).
- **Overlaps**: where zones overlap a note, *All* play together (layered), *Round robin* takes turns note by note, *Random* picks one (seeded, so a take repeats it).
- **The selected zone**: its sound, waveform, Root, Tune, Track (pitch tracking: off plays every key at the root's pitch, for drums), Loop, Rev, Gain, Pan, Crossfade.
- **Voice** tab: Voices (1–32; the oldest fades out to make room), Retrigger (the same note again restarts it with a 4 ms fade instead of stacking), Legato (with one voice: a note while another is held slides there without a new attack), Glide, Detune, Pan, Vel → Vol and its curve.
- The instrument's numbers are layer properties named `k_<key>` (`k_cutoff`, `k_attack`…), so each maps, records and reads like any layer number.

### Slice mode

Keys view → **Slice**: the first zone's sample is cut where its hits start, and slice 1 plays on pad 1 (the base note), slice 2 on the next, and so on. **Detect** finds the hits at the **Sensitivity** you set (higher finds softer ones). On the waveform, drag a slice line to move it, double-click the wave to add one, double-click a line to remove it. **Hold** makes a slice play only while held (else to its end). Slices are kept in the zone (`slices`), so takes, renders and web pages play the same cuts.

### The waveform

A dark surface with the sample's real wave (min/max per pixel column from the decoded buffer), the region that plays lit and the rest dimmed:

- **S** and **E** flags: drag to set Start and End. The **loop brace** (Classic with Loop on) has its two ends to drag, and its crossfade drawn as a ramp into the loop end.
- **SNAP** (on by default) puts every marker on the nearest zero crossing, so a cut never clicks.
- **Zoom**: ⌘/Ctrl + scroll or a trackpad pinch zooms around the pointer; Shift + scroll or a sideways swipe moves along; dragging the empty wave moves too; −, + and *fit* (to the region) below. The strip under the wave is the whole sample with the view's window: drag it to move, double-click it to see everything.
- Time is marked along the top; the line below says where S and E are, how long the region is and where the loop sits.

### Envelopes, filter, LFO

- **Amp envelope**: Attack, Decay, Sustain, Release, drawn and dragged like the Envelope card (the peak sideways for Attack, the next point for Decay and Sustain, the end for Release; a log-like time scale inside each stage). The **diamonds** halfway along each stage bend it: up on Attack rises fast then eases in; down on Decay and Release falls fast then tails off (natural); double-click a diamond to straighten it. One-shot sounds draw Release faint (it never happens).
- **Filter**: Off, Low-pass, High-pass or Band-pass at 12 or 24 dB. The response is drawn from the same biquads the engine builds; drag the dot sideways for Frequency and up and down for Resonance (Shift: finer), double-click to open it fully. **Vel → Freq** opens it on hard hits; **Env amount** (semitones) sweeps it with its own envelope (shown as a band on the response and as its own envelope picture).
- **Pitch envelope**: an amount in semitones and its own A / D / S / R (a kick's drop, a zap).
- **LFO**: one per voice, started with the note: Sine, Triangle, Square or Saw, its Rate and Amount, to Pitch (up to an octave either way), Filter (up to four octaves), Amp (tremolo) or Pan.
- **Velocity → volume**: Vel → Vol sets how much velocity matters; the small curve beside it bends it (drag up: soft hits louder).

## What plays it

Every hit names a pad: pad *N* is note (`baseNote` + *N* − 1) mod 128, so pad 1 is C1 by default. In the Drum view that is the pad on that note; in the Keys view it is simply the note.

- **Clicks** on the pads, or on the zone editor's keyboard.
- **Keys** (on the Play page, not while typing): in the Drum view Z X C V, A S D F, Q W E R and 1 2 3 4 play the 16 pads in view (bottom row first, like the pads). In the Keys view the keyboard is Live's: A W S E D F T G Y H U J K O L P ; ' from C of the layer's **Octave** (3: C3), Z and X move the octave. Turn off with **Keys**.
- **MIDI notes** play the pad on their note (Drum, all 128) or the zones under them (Keys), on any channel or one. Note-on velocity sets how hard; note-off lets a Classic sound go.
- **The pad grid** (MIDI settings → Pad grid): its lower-left 4 × 4 plays the 16 pads in view (Drum view).
- **Actions**: **Do: Play pad N** from any trigger or signal.
- **Takes** record every hit as a `pad` event (pad number, velocity, 0 for a let-go) stamped with the clock time it landed, and what it picked (`slot`: the pad its Sample index chose, or the zone a round robin or random pick chose), so a replay and a render play the same sounds.

A hidden layer is silent and ignores everything.

## The engine

`src/play/kit/sampler.js` (names `sm…`/`SM_…`, building on `drumPads.js`'s `dp…`) is used by the app (`src/play/drumPads.ts`, the host), offline renders (`lib/recordingAudio.ts`) and web exports (`SSKit.sampler`). A voice:

```
BufferSource → filter (0–2 biquads) → amp envelope → release → kill → volume → tremolo → pan → the layer's output
  ▲ detune: pitch envelope, LFO, glide          ▲ detune: filter envelope, LFO
```

- **Timing**: every stage of a hit (the sample, the envelopes, the filter, the LFO) starts on the AudioContext clock at the hit's time: sample-accurate offline, and "now" for a live hit (no timers, no waiting for a frame).
- **Smooth envelopes**: stages with no slope are linear ramps (exactly the old drum pads' sound); sloped ones are `setValueCurveAtTime` curves (`smShape`). The amp envelope is never cancelled: Release is its own gain going 1 → 0 from wherever the level is, and a choke, a voice steal or a retrigger is a third gain going 1 → 0 over 4 ms (`SM_KILL`). No `cancelAndHoldAtTime` (Firefox lacks it), no jumps, no clicks. One-shots end with their Fade out (3 ms by default).
- **Loops** with a crossfade play a copy of the buffer whose last `xfade` seconds before the loop end are blended (equal power) into the audio leading up to the loop start (`smLoopBuffer`, cached), so the wrap is continuous.
- **Voices**: 32 per layer in the Drum view, Voices in the Keys view; the oldest (a released one first) fades out to make room. A Classic pad is one voice at a time; a retriggering note too.
- **Live numbers**: mapped Transpose, Gain, Pan, Frequency and LFO amount glide on sounding voices (10 ms), and only what changed is sent.
- `smHits(layer, pad, velocity, env, slot)` turns a hit into its voices from the plain layer record (the Sample index, zone picks, slices, glide), so the app, renders and pages agree.

### Numbers

`SM_PARAMS`: start, end, pitch (Transpose), volume (Gain), pan, attack, decay, sustain, release, vel (Vel → Vol) — the old drum pads' ten, same keys and defaults — plus velCurve, detune, loopStart, loopEnd, xfade, fadeOut, aSlope, dSlope, rSlope, cutoff, res, fEnv, fA, fD, fS, fR, fVel, pEnv, pA, pD, pS, pR, lfoRate, lfoAmt and glide. A pad's are `pad<N>_<key>` (made when the pad gets a sound; a pad with no sound keeps none), the Keys instrument's `k_<key>`. The pad's choices (mode, loop, reverse, choke, filter, lfoShape, lfoTo) are on the pad; a zone's sample settings (keys, velocities, root, tune, detune, gain, pan, start, end, loop, crossfade, reverse, track, slices) on the zone; the instrument's choices (mode, select, seed, voices, retrigger, legato, filter, lfoShape, lfoTo, sensitivity, sliceGate) in `inst`.

## Migration from Drum pads

A layer saved as `kind: 'drumpad'` (setups, presets, layer sets, kits, `.play` files, examples) parses as a `sampler` in its Drum view (`parseLayer`): its pads, every number, choke groups, Keys / MIDI / Pad grid, base note, channel, Sample index and Volume as they were, and its window on its base note. Its pad numbers keep their names (`pad3_pitch`), so controls, mappings, conditions and takes on `layer:<id>::pad3_pitch` keep working. The new numbers default to what the old engine did (linear stages, no filter, no pitch envelope, no LFO, a 3 ms fade at a one-shot's end), so a migrated kit renders the same as before (tested sample against sample). Old takes' hits play the same pads.

## Recordings, renders, websites

- **Real-time recordings** take the Sampler from the record bus, like any sound.
- **Frame-by-frame renders of a take** (`lib/recordingAudio.ts`): each Sampler layer with a sound open is a track (`padTrackOf`), the take's hits become hits in the mix (`padHitsOf`, with their `slot`), and `playPadHits` plays each at its exact sample through the same engine and `smHits`, the numbers where the take had them at each hit.
- **Web exports** carry each pad's and zone's sample as a data URL (pads by index, zones as `z<id>`, at most 6 MB each, as songs); generated drums need nothing; what stays out is listed under **Left out**. The page plays the same engine (`SSKit.sampler`): keys (player embeds), MIDI notes (after Enable MIDI), the player panel's buttons (a pad each, or C1–C5 for a Keys view), Play pad actions, readers and effect chains.

## Kits

A **kit** is the Drum view as a preset (`src/play/drumKits.ts`): every pad (its sound, name, mode, loop, reverse, choke, filter, LFO), each pad's numbers, Keys / MIDI / Pad grid, Volume and the layer's effect chain. **Save kit…** / **Load kit…** in the Kit tab: built-in kits (808-ish, Acoustic-ish, Percussion: generated drums), saved ones (Replace, or Merge into empty pads), rename, delete, Save as a .play file. Stored in `shader-studio:drum-kits`; they travel in library ZIPs, profile ZIPs, `.play` items and the workspace folder, and show on the Files page under Presets → Drum kits.

## Samples and auditioning

Samples live in the media library next to the videos (IndexedDB), named on the pad or zone by their library id, or used from a linked folder where they are (docs/linked-folders.md). The Library's **Sounds** tab and the linked-folder browser preview a sample as you arrow through it (Splice-style, one shared preview player, separate from the master chain).

## Plan

The Sampler is a layer, so it's Pro (`play.layers`). On Free it isn't in what plays.

## Tests

- `src/play/__tests__/samplerEngine.test.ts`: real Web Audio in Node (`node-web-audio-api`), into buffers only. Note names, roots from file names, pads ↔ notes, slopes, envelope stage levels and times, one-shot fades, velocity curves, zero crossings, transient slicing of a click train, defaults; a hit at *t* starting on *t*'s sample, envelope stages and sloped stages rendered, release from wherever the level is, a choke within 4 ms with no step, voice stealing, a crossfaded loop's continuity, the pitch envelope, the filter and its envelope, the LFO; the defaults rendering exactly like the old drum pads' sampler; key and velocity zones, pitch tracking, round robin and seeded random, slices, glide.
- `src/play/__tests__/sampler.test.ts`: Drum pads → Sampler migration (the record, control targets, takes) and a migrated kit rendering the same as the old engine; the Keys view in an offline mix.
- `src/play/__tests__/drumPads.test.ts`, `drumKits.test.ts`: the host (MIDI, keys, the grid, actions), offline mixes of takes, the record, exports, kits.
- `src/components/play/__tests__/samplerEditor.test.tsx`: the editor in the sidebar, the big panel and on phones.

## Not yet

- Mute / solo per pad, sends to return chains (the layer has one effect chain).
- Sample Select zones (beyond round robin and random), zone crossfades, a release loop.
- More LFOs and a modulation matrix; filter circuits beyond the biquads; key → filter tracking.
- The pad grid on websites; Presentations' own copies of samples.
- Warping to a tempo (the app has no set tempo).
