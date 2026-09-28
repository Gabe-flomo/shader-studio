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

- **Sample**: any sound in the Library's Sounds (drum pad samples are Library sounds too), a **drum pad's sound** (a Library sample or a generated drum), a sound uploaded on the card, or a **generated tone** (a pad chord, a pluck, a voice-like vowel, noise; no file needed). The card shows the **waveform**, with every live grain drawn on it (where it reads, how loud) and the position/spray band. Click or drag on the waveform to set Position.
- **Modes**:
  - **Classic** (Granulator III's Classic): synchronous. Two overlapping grains per voice, a new one every half grain size. Density is ignored.
  - **Flux** (Granulator III's Loop crossed with Granulator II's Fluxus): a regular stream at **Density** grains per second, independent of the grain size, so the grains leave gaps or pile up. Each grain's level flickers by **Level random** and it may reverse by **Reverse**. With Density × Size ≈ 1 it is a crossfading loop through the scanned position.
  - **Cloud** (Granulator III's Cloud and Clouds' random density): asynchronous. Onsets are random (Poisson) at Density per second, each grain gets a random pitch inside ±Spread and a random pan, and they keep coming up to the cap.
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
  - per grain, `grainPos` / `grainAmp` with the grain's number (1–16)

  **Readouts → controls** makes controls for count, mean and spread (a group "Grains · <rack>"). **Grains → nulls** makes a few null layers that ride grains 1–8 (x = position in the file, y = level), which particles, paths and the rest can follow.
- **Output**: the granulator's sound goes through its own **Sound effect chain** (`rack:<id>`: Filter, Echo, Reverb, Distortion, Compressor, in Finish → Sound or on the card) to the page's master chain. The audio readers can listen to it (**Readers listen here** on the card). Audio Unit effects on a granulator rack are desktop-only and not wired to it (see Limits).
- **Takes and renders**: notes and parameter moves are recorded as for any rack. A frame-by-frame render replays them into the pure engine, sample-exactly, with the same seed, so two renders of one take are identical to the bit.
- **Exported web pages**: the runtime plays granulator racks (Drone, MIDI, mapped parameters, readers, readouts), carrying a Library sample in the page when it fits and making a generated tone when that is the sample.

Not built (yet):

- **Capture / Grab** of live input into the sample buffer.
- A second filter in series, filter width, the filter envelope, **Envelope 2**, and an internal LFO beyond the Scan LFO. Use Play's LFOs and mappings on the parameters instead; they are mapping targets for this reason.
- **MPE** (per-note Slide and Press), mono and glide, key scaling of the pitch and envelopes.
- FRAGMENTS' **Rhythmic** tempo-synced grains and Portal's **scale-locked pitch**.
- A per-grain array for the Particles layer to spawn from directly. The per-grain sensors and **Grains → nulls** cover that for now.
- Audio Unit effects after a granulator on the desktop: its sound is in Web Audio, and a send into a native rack is possible (lib/engineSend.ts) but isn't wired for it.
