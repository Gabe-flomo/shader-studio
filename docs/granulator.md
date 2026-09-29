# Granulator

A granular instrument for the Audio engine's racks, modelled on Ableton's Granulator III (Robert Henke) with ideas from a few other well-regarded granulators. This file starts with the research (what those instruments do), then says what we built and what we left out.

## Research

### Ableton Granulator III (Robert Henke, Live 12)

Sources: [Robert Henke's Granulator III page](https://roberthenke.com/technology/granulator3.html), [Sound On Sound: Ableton Live 12: Granulator III](https://www.soundonsound.com/techniques/ableton-live-12-granulator-iii), [Ableton pack page](https://www.ableton.com/en/packs/granulator-iii/), [MusicRadar tutorial](https://www.musicradar.com/how-to/granulator-iii-ableton-live-12), and for its predecessor [Granulator II](https://roberthenke.com/technology/granulator.html).

**Playback modes.** Granulator III has three grain modes. They are called **Classic, Loop and Cloud**. The brief for this work said "Classic / Flux / Cloud"; there is no Flux mode in Granulator III. "Fluxus" was Granulator II's random grain muting (its AM section). We kept the name **Flux** for our second mode and built it from Loop and Fluxus (below).

- **Classic** is Granulator II's engine: two overlapping grains per stereo channel, one starting every half grain, with a very flexible grain envelope. It is the most expressive mode. The grains are synchronous, so the sound has a steady pitch-synchronous texture.
- **Loop** plays one long grain through the sample and crossfades into the next, like a sampler with crossfading and random position modulation. Long sections play unaltered. A **Reverse** amount gives each grain a chance to play backwards (100% means all of them).
- **Cloud** plays a layer of up to **20 non-synced grains** per stereo channel per note. **Density** sets how many play at once. It gives a thick, chorused sound. Random grain pitch (Variation) works only in this mode, and the grain envelope is fixed to save CPU.

**Position, Scan, Variation.**
- **Position** says where in the sample each grain starts, as a percentage. Because it is a percentage it stays at the same relative place when another sample loads. You set it with the knob or by clicking the waveform.
- **Scan** is a ramp that starts when a note is triggered and moves the playhead through the sample. It has a loop option and can fold back at the end position. Its speed can follow key, velocity, MPE slide, Envelope 2 and the LFO. This is time-stretching: the grains keep their pitch while the playhead moves at its own speed.
- **Variation** (Granulator II called it **Spray**) randomises each grain's start position (absolute, 0–2 s), its size, its amplitude and, in Cloud only, its pitch.

**Grain size and density.** Grain size runs from 2 ms to 2 s. In Classic, the rate of new grains follows the size (two overlap). Density is a Cloud control: up to 20 grains per channel per note. SOS suggests sizes of 50–100 ms for pads.

**Pitch.** **Transpose** gives coarse and fine tuning, and **Key** scaling (default 100%) sets how far the pitch follows the keyboard. **Spread** detunes left against right into a stereo chorus and also offsets the grain onsets between the channels.

**Grain window (Shape).** In Classic the envelope morphs from a sharp attack with an exponential decay, through a smooth crossfade, to an exponential attack with an abrupt end. Values below 50 bring out transients. In Loop the shape is the crossfade length. In Cloud it is fixed.

**FM.** Granulator II had an FM section that modulated the grains' playback frequency (vibrato up to "digital dirt"), an AM section (Fluxus: random grain muting and level modulation) and a noise section. Granulator III dropped FM, AM and noise.

**Filter.** Two state-variable filters in series give 9 modes (24 and 12 dB low-pass, high-pass, notch, and combinations). **Width** offsets the second filter's frequency, and resonance acts on the main filter.

**Envelopes and LFO.** Envelope 1 is the amplitude ADSR, with very long times and key-scaled rates, and can also move the filter. Envelope 2 is a free modulator. The stereo LFO runs free (0.01–20 Hz) or synced (1/16 to 2 bars), with shapes Sine, Triangle, Up, Down, Rect, S&H, Rand and Move, a phase and a stereo offset.

**Capture.** Granulator III keeps the last few seconds of its audio input in memory. Pressing Capture makes that the sample (Cancel reverts it, Save writes a file), and the output can be fed back for resampling. Granulator II's version was Grab, up to 16 s in RAM.

**MIDI, polyphony, hold.** It has 8 voices, plus a monophonic mode with Glide (0–2 s). **Hold** sustains the last notes until a new note arrives or every key is released. MPE is supported: pitch bend (48 semitones recommended), Slide and Press, velocity, and the mod wheel (CC 2). Granulator II had up to 32 voices.

**Modulation.** Each parameter has its own set of modulation sources from Key, Velocity, Slide, Press, Env 2 and the LFO. A modulation display shows what is moving each one.

### Mutable Instruments Clouds and Beads

Sources: [Clouds manual](https://pichenettes.github.io/mutable-instruments-documentation/modules/clouds/manual/), [Beads manual](https://pichenettes.github.io/mutable-instruments-documentation/modules/beads/manual/).

- **Clouds.** Position, Size and Pitch (V/oct). **Density** is bipolar: at 12 o'clock there are no grains, clockwise gives randomly timed grains (asynchronous), anticlockwise gives regular ones (synchronous), and turning further in either direction adds overlap. **Texture** morphs the grain window from square through triangle to Hann, and past 2 o'clock a diffuser blurs transients. **Freeze** stops recording, so the grains keep reading the last few seconds. **Trigger** fires single grains. It plays 40–60 grains at once.
- **Beads.** **Latched** grain generation (the default) makes grains all the time at the Density rate, with the same bipolar random/regular behaviour. Unlatched, grains come only while Seed is held or a gate is high. **Freeze** halts the grains' envelopes, stops new grains and freezes the buffer.

Ideas worth borrowing: **one Density control for regular (synchronous) versus random (asynchronous) onsets**, a **window-shape morph** that runs from hard to smooth, and **latching**, so the instrument can drone without a key held.

### Arturia Efx FRAGMENTS

Sources: [Arturia overview](https://www.arturia.com/products/software-effects/efx-fragments/overview), [Sound On Sound review](https://www.soundonsound.com/reviews/arturia-efx-fragments), [manual](https://dl.arturia.net/products/efx-fragments/manual/efx-fragments_Manual_1_0_0_EN.pdf).

FRAGMENTS has three modes: **Classic** (freely set), **Rhythmic** (grains synced to the tempo) and **Texture** (dense clouds). Grain capture can follow a **Speed**, an **Offset** or a **Manual Scan**. Transient detection and snap-to-grid quantise when grains fire, and random **sprays** add variation. It also has Intensity and FX macros and a buffer display with the record head and the grain heads drawn on it. Ideas worth borrowing: **draw every grain on the waveform**, and **a Rhythmic mode** (left for later; see below).

### Output Portal

Sources: [Output: Granular synthesis 101](https://output.com/blog/granular-synthesis-101-a-portal-exploration), [MusicRadar review](https://www.musicradar.com/reviews/output-portal), [gearnews](https://www.gearnews.com/output-portal-a-granular-fx-plug-in-with-heaps-of-modulation/).

Portal's grain controls are Density (grain rate), Offset, Size, **Count** (how many grains may exist at once), Shape (the envelope: fully down keeps the transient, up adds fades on both sides) and Pitch, which can **lock to a scale**. Its strength is macros: a few big knobs, each driving many parameters with its own modulator. Ideas worth borrowing: **Count as a hard grain cap**, and **scale-locked grain pitch** (later).

### Ableton Emit and Image-Line Harmor (for Emit and Spectral, 2026-09-28)

Sources: [Sound On Sound: Granular synthesis in Ableton Live](https://www.soundonsound.com/techniques/granular-synthesis-ableton-live), [Ableton: new Max for Live devices](https://www.ableton.com/en/blog/sample-layering-granular-stereo-tools-and-more-new-max-live-devices-community/), [Harmor manual](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Harmor.htm), [EDMProd on Harmor](https://www.edmprod.com/fl-studio-harmor/).

- **Emit** (Max for Live) is a particle emitter drawn over a spectrogram: grain bursts shoot out and travel through the sample, and a draggable box sets the range and direction each grain may move in.
- It runs two independent emitters of up to 16 grains each over one sample, so two streams can cross the same material.
- Its playback is a phase vocoder, so particles travel at any speed without changing pitch; vertical movement on the display maps to filtering and panning.
- **Harmor** turns a loaded sound into partials (sines) and resynthesises them, up to 516 per voice, so the spectrum can be edited directly.
- Its **Prism** moves partials away from harmonic ratios (inharmonic, metallic) and **Blur** smears them in time or frequency. Our Shift (a hertz offset, not a ratio) is the cheap cousin of Prism; blur is left for later.

### Reaktor Grainstates

Grainstates (a Reaktor factory ensemble) runs several granular players side by side over one buffer. Its grain particles move between the players as a network of states, so the texture wanders on its own. We did not borrow from it directly. The Play page's own mappings, LFOs and readers already give a similar "system that moves by itself" when they are pointed at the granulator's numbers.

## What we'll build (and what we won't)

A **Granulator** is an **instrument on an Audio engine rack**, next to the Sample player and Audio Units. It is not a new layer kind. Racks already have what a playable sound source needs:

- MIDI input with device and channel routing
- the computer keyboard (DAW-style)
- the strip of keys on the card
- notes recorded into takes as `ae:<rack>` pad actions and replayed sample-exactly
- a spectrum for the audio readers (`engine:<rack>`)
- parameter controls with mappings
- volume and mute

A Drum pad-style layer would have repeated all of this. It also works as a sound source for Play: its readers, grain readouts and mapped parameters drive the picture like a drum pad layer's do.

It runs in **Web Audio** everywhere: in the browser, in the desktop app (WKWebView has AudioWorklet), in offline renders, and on exported web pages. The grain engine is plain JavaScript in the layer kit (`src/play/kit/granulator.js`), with no Web Audio inside it. The same code runs:

- in an **AudioWorklet** (built from the engine's own source, as a Blob module)
- on the main thread in a **ScriptProcessor** when AudioWorklet isn't there
- directly, as a pure function, for **offline renders and tests** (deterministic: a seeded random generator and sample-exact events)

We built:

- **Sample**: any sound in the Library's Sounds (drum pad samples are Library sounds too), a **drum pad's sound** (a Library sample or a generated drum), a sound uploaded on the card, or the one **generated tone**, the **pad chord** (no file needed). The other generated samples (pluck, vowel, bell, noise sweep, sine) were retired on 2026-09-28: a record or preset that names one plays the pad chord instead, and the Granulator example now uses the pad chord (its second rack, **Particle chimes**, plays it an octave up; the **Shine** reader listens at 880 Hz). Library sounds you uploaded are untouched. There were never sound files in the repo for them (they were made in code), so nothing left `public/`. The card shows the **waveform**, with every live grain drawn on it (where it reads, how loud) and the position/spray band. Click or drag on the waveform to set Position.
- **Modes**:
  - **Classic** (Granulator III's Classic): synchronous. Two overlapping grains per voice, a new one every half grain size. Density is ignored.
  - **Flux** (Granulator III's Loop crossed with Granulator II's Fluxus): a regular stream at **Density** grains per second, independent of the grain size, so the grains leave gaps or pile up. Each grain's level flickers by **Level random** and it may reverse by **Reverse**. With Density × Size ≈ 1 it is a crossfading loop through the scanned position.
  - **Cloud** (Granulator III's Cloud and Clouds' random density): asynchronous. Onsets are random (Poisson) at Density per second, each grain gets a random pitch inside ±Spread and a random pan, and they keep coming up to the cap.
  - **Emit** (after Ableton's Emit): each voice has **eight spawn points** that start around Position and **travel** through the sample; grains leave from them in turn, Density a second, and read from wherever their spawn point is now (plus Spray).
    - **Direction**: Forward, Backward, Both · alternate (every other spawn point goes the other way) or Both · random (each picks, seeded).
    - **Travel speed**: sample lengths a second (0 to 4; 0 keeps them still). A mapping target like every setting.
    - **Emit spread**: how far apart the spawn points start (spaced evenly, a little seeded jitter). 0: every grain shoots from Position in one line; 1: spread over the whole sample.
    - **At the end**: **Wrap** (on from the other end), **Bounce** (turns back), **Respawn** (jumps to a seeded random place).
    - Position, Scan and the Scan LFO move the whole set; Freeze stops the travel. Grain size, Density, pitch, the randoms, the window and the envelope apply as in Flux.
  - **Spectral** (after Harmor's resynthesis): grains play **frequency bands** of the sample instead of time slices.
    - The sample is **analysed once** (an STFT: Hann window of 1024, 2048 or 4096 samples, **Analysis window**, hop a quarter of it; longer hops past 1024 frames) into each frame's strongest 48 peaks (fractional bins by parabolic interpolation, sine amplitudes). It is remembered per sample and window: on the main thread in the app and on exported pages (sent to the worklet, which never analyses on the audio thread), and made on first use in offline renders and tests.
    - Each grain reads the frame at its time position (Position, Spray, Scan, LFO as usual), takes the **Partials** (1–16) strongest peaks inside its band and plays them as **sines** from a table, each at the phase of one steady oscillator of that frequency (so overlapping grains add up), through its window. No random numbers are drawn for phases, so the sequence never shifts. A bank of sines is cheap and deterministic in a worklet; an inverse FFT would need a whole frame per grain.
    - **Band** (0–1 on a log axis from 20 Hz to half the sample's rate) and **Band width** (a share of that axis) pick the frequencies. **Band spread** spaces the grains' bands (eight spawn points on the frequency axis, as Emit's on the time axis), and **Band travel** / **Band direction** / **Band at the end** move them along it (Bounce by default).
    - **Pitch** (and the note, bend, Spread, Pitch random, FM) multiplies the frequencies; **Shift** adds hertz (inharmonic, like a frequency shifter). A band with no peaks is silent.
    - The card shows the **spectrogram** (time across, frequency up) with the band; drag on it to set Position (across) and Band (up and down).
- **Position** (0–1 of the file) and **Spray** (random start offset, 0–2 s, as Granulator II's Spray and III's Variation).
- **Grain size** 2 ms–2 s and **Size random**.
- **Density** 1–200 grains per second (Flux, Cloud).
- **Pitch** ±48 semitones, **Spread** (0–24 st: left/right detune in Classic and Flux, a random range in Cloud), **Pitch random** (±st per grain, every mode), **Pan random**, **Level random**, **Reverse** chance.
- **FM** as in Granulator II: **FM rate** (0–2000 Hz) and **FM amount** (semitones) modulating the grains' playback rate. Slow rates give vibrato; audio rates give sidebands and "digital dirt".
- **Filter**: Off, Low-pass, High-pass, Band-pass or Notch (a TPT state-variable filter on the output, 12 dB), with **Cutoff** and **Resonance**.
- **Amp envelope**: ADSR per voice. Attack 0–10 s, Decay 0–10 s, Sustain, Release 0–20 s.
- **Grain window**: Hann, Triangle, Tukey (flat top), Rectangle, plus **Skew** (0.5 is symmetric; lower gives a sharp attack with a long tail, as Granulator III's Shape below 50 does; higher gives a slow attack with an abrupt end).
- **Scan**: a playhead ramp from note-on (−4…4 × the file's own speed, as Granulator III's Scan: 1 time-stretches at the original tempo), plus a **Scan LFO** (a sine on the position: rate and depth). **Freeze** stops the playhead where it is (ramp and LFO), so the grains keep reading one spot, as Beads' and Clouds' Freeze do.
- **Hold** (Granulator III's Hold): notes sustain after their key goes up until a new note starts with every key up. **Drone** (Beads' latch): a voice at the root note plays with no key held, so the instrument sounds on its own.
- **MIDI**: note to pitch from the **Root note** (the key where the sample plays at its own pitch), velocity to level by a **Velocity** amount, pitch bend ±2 semitones, CC 120/123 all off. The **computer keyboard** and the card's keys work through the rack as for any instrument.
- **Polyphony**: **Voices** 1–16 (the oldest is stolen). **Up to 64 grains at once**, with a **Grain cap** setting (1–64) that the engine never exceeds: a grain that would go over the cap is skipped, not queued.
- **Every numeric parameter is a mapping target** (the rack's `au:<rack>:inst::<address>` targets, as Audio Unit parameters are): the + beside each makes a control, and takes record them.
- **Grain readouts for visuals**: the host reports, as **sensors** on `ae:<rack>`:
  - `grains`: the active grain count ÷ 64
  - `grainMean`: the mean read position, 0–1 of the file
  - `grainSpread`: the positions' spread, 0–1
  - `grainLevel`: the mean amplitude
  - `grainPitch`: the mean pitch, 0.5 = unshifted, ±48 st at the ends
  - per grain, `grainPos` / `grainAmp` / `grainRow` with the grain's number (1–16)

  - Spectral: `grainBandMean` (the sounding grains' mean band centre, 0–1 on the Band axis), `grainEnergySum`, and per grain `grainBand` / `grainEnergy`, so visuals can follow spectral grains
  - the card also draws Emit's and Spectral's **spawn points** (triangles on the top edge for places in the sample, on the left edge for bands); the worklet posts them with the grains

  **Readouts → controls** makes controls for count, mean and spread (a group "Grains · <rack>"). **Grains → nulls** makes a few null layers that ride grains 1–8 (x = position in the file, y = the grain's stable row — see below), which particles, paths and the rest can follow.

### Where a grain is drawn / where its null goes (2026-09-28, after Serum 2's Granular view)

Grains used to rise and fade back on an arc (height from amplitude). They're drawn **straight** instead, everywhere a grain shows up:

- **The card's waveform** (Classic, Flux, Cloud, Emit): each grain is a short horizontal **pill**, its **x** where it currently reads (moving straight along the time axis as it plays — forward, backward, or Emit's travelling spawn points, whichever set it), its **length** its grain size (as a share of the sample's own duration, so a longer grain draws a longer pill), and its **y** a **stable row** for its life (see below). Its **opacity** follows its amplitude envelope (`grGrainOpacity(amp)`), so it fades in and out with the grain, never fully gone while it sounds and never past opaque. Colour is the rack's accent.
- **The card's spectrogram** (Spectral): the same pill, but oriented along the **frequency** axis (its natural moving axis there): its x stays the grain's file position (already meaningful in time), and it spans its **band** ± half of Band width vertically. Same opacity rule, from its energy.
- **The playhead** is a thin vertical line, drawn once, not per grain.
- No arcs anywhere; at most 64 pills a frame (the grain cap), cheap canvas strokes with round line caps.

**The grain's row** (`grGrainRow(id, pan, hasPan)`, `GrStats.row`) is 0–1, stable for as long as that grain sounds (its engine slot never changes hands while it's on):

- **Pan-based when Pan random is on** (`> 0`): pan (−1..1) maps straight across the row, so the layout means something — a grain panned left draws low, one panned right draws high (or the reverse, depending which edge you call which).
- **A hash of its slot otherwise** (`grIdHash`, a stable non-random function of the grain's id — not the seeded RNG the grains themselves use), so grains still spread out over the height instead of stacking on one line.
- Either way it's nudged a little off dead centre (0.5), so a pill never sits exactly on the waveform's zero line.

**Grains → nulls** carries the same mapping into the picture: a grain's null **x** = `grainPos` (0–1 along the sample), **y** = `grainRow` (0–1, pan-based when Pan random is on, else the id hash) — no more riding `grainAmp`. `GrStats.size` (the pill's length, 0–1 of the sample) has no null or sensor of its own: it only feeds the card's drawing, straight off `stats()`.

Where the numbers come from: `grGrainRow` / `grGrainSpan` / `grGrainOpacity` / `grIdHash` in `src/play/kit/granulator.js` (attached to the engine factory as `create.grainRow` etc., so the worklet's self-contained copy and this module's exports are the same code, bit for bit); `GrStats.size` / `GrStats.row` fill in `stats()`, carried over the worklet's packed message (`grReadStats`) the same as `pos` / `amp`. The card (`GranulatorPanel.tsx`, `drawPill`) and `grainControls.ts` (`addGrainNulls`) are the two places that read them.

  **The nulls' folder.** Grains → nulls puts its nulls in a folder of their own at the top level of the layer list ("Grains · <rack>", "(2)" for a second batch). The folder is **sealed**: a layer added later never joins it, even while the list shows the folder (it lands in the nearest open group around it, or at the top level, and the list goes there). Only dropping a layer in puts one inside. Grains from a layer (nulls as the source) makes no layers, so it has no folder. `LayerGroup.sealed` (types/layerGroups.ts, `newLayerHome`), `placeNewLayer` (components/play/groupOps.ts).
- **Output**: the granulator's sound goes through its own **Sound effect chain** (`rack:<id>`: Filter, Echo, Reverb, Distortion, Compressor, in Finish → Sound or on the card) to the page's master chain. The audio readers can listen to it (**Readers listen here** on the card). Audio Unit effects on a granulator rack are desktop-only and not wired to it (see Limits).
- **Takes and renders**: notes and parameter moves are recorded as for any rack. A frame-by-frame render replays them into the pure engine, sample-exactly, with the same seed, so two renders of one take are identical to the bit.
- **Exported web pages**: the runtime plays granulator racks (Drone, MIDI, mapped parameters, readers, readouts), carrying a Library sample in the page when it fits and making a generated tone when that is the sample.

### Grains from a layer (visuals → grains)

The card's **Grains from a layer** section (folded until used) lets a layer play the grains:

- **Source**: a particles layer, a bodies layer, a null, or a Relationship layer's members. **Inside**: a shape layer as the boundary (any shape, a drawn path too: a hand path works), or the whole picture. The card shows how many things are inside now ("5 in").
- Each thing inside plays **Grains per thing** a second (setting 35, a mapping target) while it stays inside, so the density follows the number of things. When more than the Grain cap are inside, the ones closest to the boundary's centre play. Cloud mode spaces each thing's grains at random; the others space them evenly. With **A particle just born plays a grain at once** (particles only, on by default), a burst of particles is a burst of grains.
- **Links**: up to 6 rows, each "a thing's number → a grain setting", on or off, from a value (at 0) to a value (at 1).
  - The numbers (each 0–1): X, Y, speed, heading, age (of its life), size, brightness under it (from the coarse picture), and distance to the boundary's centre.
  - The settings: file position, pitch, grain size, amplitude, pan, filter cutoff (one filter: the mean of the things'), and spray.
  - The defaults are X → file position, Y → pitch ±12, speed → grain size 40–300 ms, and age → amplitude 1–0.
- **Where it runs.** The kit reads the things (`grainThings` in kit/kit.js) after every frame the layers step. `lib/grainFrom.ts` turns them into points (`grFromPoints`) for the live granulator. During a render it logs each frame's points by time, and the offline mix replays them into the pure engine (`pointsAt`). The layers are deterministic in a render (the take's seed) and the grains are seeded, so the result is the same every time. Exported pages do the same in the runtime.
- **Limit: FFmpeg renders.** The FFmpeg render mixes the sound before it draws the frames, so it replays the points logged by the last pass over that span. Render to a PNG sequence (which mixes after the frames), or record in real time, for the exact grains of that pass. The PNG sequence and real-time recordings are exact.
- The example's second part plays a generated bell from the Flow particles inside a drifting Ring.

Not built (yet):

- **Capture / Grab** of live input into the sample buffer.
- A second filter in series, filter width, the filter envelope, **Envelope 2**, and an internal LFO beyond the Scan LFO. Use Play's LFOs and mappings on the parameters instead; they are mapping targets for this reason.
- **MPE** (per-note Slide and Press), mono and glide, key scaling of the pitch and envelopes.
- FRAGMENTS' **Rhythmic** tempo-synced grains and Portal's **scale-locked pitch**.
- A per-grain array for the Particles layer to spawn from directly. The per-grain sensors and **Grains → nulls** cover that for now.
- Link ranges as mapping targets (Grains per thing is one). The ranges are edited on the card.
- Audio Unit effects after a granulator on the desktop: its sound is in Web Audio, and a send into a native rack is possible (lib/engineSend.ts) but isn't wired for it.

## Where things are

| Piece | File |
| --- | --- |
| The engine (grains, modes, envelopes, filter, FM, scan, points), the worklet, the offline render, generated samples, Grains from's links | `src/play/kit/granulator.js` (+ `.d.ts`) |
| The record: the `granulator` slot, its sample, `from`, grain readout targets (`grains:<rack>::<read>`), sensors on `ae:<rack>` | `src/types/playAudioEngine.ts`, `src/types/play.ts` (`SensorRead`, `sensorKey`) |
| Live in Web Audio: the rack, its Sound chain `rack:<id>`, readouts as sensors | `src/lib/webGranulator.ts`, `src/lib/audioEngineHost.ts` |
| Grains from a layer: the overlay's tap, the render log | `src/lib/grainFrom.ts`, `src/play/overlay.ts` (`setGrainTap`), `src/play/kit/kit.js` (`grainThings`) |
| Renders (a take's notes and settings, sample-exact) | `src/lib/recordingAudio.ts` (`grainTracks`, `renderGrains`) |
| The card | `src/components/play/engine/GranulatorPanel.tsx` (the instrument device in `DeviceChain.tsx`) |
| Readouts → controls, Grains → nulls | `src/play/grainControls.ts` |
| Exported pages | `src/play/runtime/play-runtime.js` (granulator racks), `src/play/exportHtml.ts` (the kit, carried samples) |
| The example | `src/store/playExamples.ts` (`granulator`) |
| Emit's spawn points, Spectral's analysis and partials | `src/play/kit/granulator.js` (`headsStep`, `analyse`, `pickPartials` inside the engine; `grAnalyse`, `grBufferSpectrum`, `grSpectrumImage`, `grReadStats`) |
| The grain nulls' sealed folder | `src/play/grainControls.ts`, `src/types/layerGroups.ts` (`sealed`, `newLayerHome`), `src/components/play/groupOps.ts` (`placeNewLayer`) |
| Tests | `src/play/__tests__/granulator.test.ts`, `granulatorModes.test.ts` (Emit, Spectral), `grainGroups.test.ts` (the sealed folder), `grainLayout.test.ts` (where a grain is drawn) |

## Tests

`src/play/__tests__/granulator.test.ts` renders into buffers only (nothing reaches a speaker). It covers:

- the grain count never passes the cap (64, 10, 1) and reaches it
- Classic, Flux and Cloud differ, both in how many grains overlap and in how that count varies, and in their samples
- pitch shift and MIDI note → pitch, measured by zero crossings on a 220 Hz sine (+12 st gives 440 Hz, C5 over a C4 root gives 440 Hz, a fifth is ×1.5)
- two renders with one seed are identical to the bit, and another seed differs
- a note lands on its exact sample
- Drone, Hold and Freeze, and the voice count
- the real AudioWorklet in an `OfflineAudioContext` (node-web-audio-api): silent before the note, then at +12 st
- an offline mix with a take's note on its sample, the same twice
- the host running a rack in Web Audio and reporting sensors
- the record: parsing, targets, readouts kept and dropped with the rack, Grains → nulls
- the web export: the carried sample, and the page's kit
- Grains from a layer: the links, closest first up to the cap, the cutoff mean, density following the count, births firing at once, a logged render replayed identically, and parsing
- retired generated samples read as the pad chord; a drum pad's drum stays

`src/play/__tests__/granulatorModes.test.ts`:

- Emit: spawn points travel at Travel speed forward, backward and alternately; Wrap, Bounce and Respawn at the ends (Respawn the same for a seed); Spread 0 is one line, 1 is scattered; grains read at the spawn points; bit-exact renders per seed
- Spectral: the analysis finds the right peaks with their amplitudes, the same every time; a low band plays the low tone and a high band the high one (zero crossings), Pitch multiplies and Shift adds hertz, an empty band is silent; band and energy readouts and the travelling bands; bit-exact renders per seed; the real AudioWorklet getting the analysis from the main thread; the worklet's packed readouts round-trip

`src/play/__tests__/grainGroups.test.ts`: Grains → nulls makes a sealed top-level folder; a later layer stays outside it (even while the list shows it) or goes to the open group around it; a drop still puts one in; the seal survives a save.

`src/play/__tests__/grainLayout.test.ts`: the pure layout helpers (`grIdHash`, `grGrainRow`, `grGrainSpan`, `grGrainOpacity`) — pan-based rows map straight across and clear dead centre, the id hash spreads grains when pan is off, span is pos ± half the grain size, opacity follows the envelope and clamps; a live engine's `stats()` fills plausible `size` / `row`, and the worklet's packed message round-trips them.

## Audio Unit effects after a Granulator

*28 Sep 2026.* On the desktop, a Granulator track with Audio Unit effects gets a
native rack too: the Granulator's sound (after its own Sound effects chain,
`rack:<id>`) is sent into the engine the way **Sound in** sends a drum pad layer
(`engineSend` → `ae_rack_input`), the effects run there, their windows open,
and the track's volume and Listener read the native rack. Without Audio Unit
effects the Granulator plays in the page as before. Renders: an offline render
plays the Granulator itself; the Audio Units after it are captured in real-time
recordings (`docs/audio-engine.md`, Sound in).
