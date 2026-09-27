# Audio effects

Built-in effects on the app's sound, as ordered chains: **Filter**, **Echo**, **Reverb**, **Distortion** and **Compressor**. They live in the Play page's **Finish** tab, under **Sound** (the picture's stack is under **Picture**). The example is **Audio effects** in the Play folder's Finish group.

## Where the chains sit

A chain per sound, then one on the master bus:

| Chain id | Sound |
| --- | --- |
| `master` | Everything the app plays, after each sound's own chain |
| `synth` | The MIDI tone synth (`lib/toneSynth.ts`) |
| `layer:<id>` | An audio layer's song, or a Video layer's sound (before its volume) |
| `node:<id>` | An Audio Input node's song |

```
song / video / synth ─→ inlet ─→ [its chain] ─→ (video: volume) ─→ mix ─→ [master chain] ─→ master volume ─→ speakers
                          └─ analyser (before) ┘└─ analyser (after, default)                 └─→ record bus (real-time recordings)
```

Web Audio contexts are separate, so the master chain is built once per context: the audio engine's (songs, video sound), the tone synth's, and the test loop's (`liveAudio.startTest`). A microphone or other live input is never played aloud and never goes through a chain.

## The pieces

- `src/play/kit/audioFx.js` — the effects: their numbers and options (`AF_EFFECTS`), the distortion curves (`afShape`, `afCurve`), generated impulse responses (`afImpulseData`: room, hall, plate; seeded, so a render hears the same reverb), the bitcrusher's sample-rate reducer (an AudioWorklet loaded from a Blob URL), and `afCreateChain(ctx)`, which the app, renders and websites all use. `update(chain, valueOf, when)` rebuilds only when the order, the kinds, an on/off or an option changes; numbers glide with `setTargetAtTime` (15 ms), so a mapping never clicks.
- `src/types/playAudioFx.ts` — `play.audioFx` (`{ chains, analyse? }`), targets, parsing, presets (this device, localStorage).
- `src/lib/audioFx.ts` — `audioFxHost`: every place a sound is made attaches a slot (context, chain id, inlet, outlet, analyser); `frame()` runs each frame from `ShaderCanvas`.
- `src/lib/audioFxOffline.ts` — the same chains in an `OfflineAudioContext` for a render's sound, following a take's recorded numbers.

## Effects

| Effect | Numbers (all mappable) | Options |
| --- | --- | --- |
| Filter | cutoff (Hz), resonance (Q; 0.71 flat), LFO rate (Hz), LFO depth (octaves) | low-pass, high-pass, band-pass, notch |
| Echo | time (ms), tempo (BPM), feedback, tone (low-pass in the loop), mix | sync (off, 1/1 … 1/16, dotted, triplets), ping-pong |
| Reverb | size, decay (s, RT60), pre-delay (ms), damping, mix | room, hall, plate |
| Distortion | drive (0–36 dB), tone, bits, downsample, mix, output (dB) | soft (tanh), hard clip, wavefold, tube (asymmetric), bitcrush |
| Compressor | threshold, ratio, knee, attack (ms), release (ms), makeup (dB) | — |

Mixes are equal-power. Distortion drives the signal into a WaveShaper curve spanning ±8 (`AF_SPAN`), 4× oversampled (bitcrush isn't, so its steps stay steps), followed by a 15 Hz DC blocker (the tube curve is asymmetric) and the tone filter. Low- and high-pass read Web Audio's Q in dB, so the resonance number is converted (20·log10 Q) to mean the same thing on every filter type.

Reverb size and decay build a new impulse response, crossfaded between two convolvers and rebuilt at most every 120 ms when mapped; bitcrush's bits swap the curve. In an offline render those three keep their starting values; every other number follows the take.

## Mapping

Each number is a control target: `audiofx:<chainId>:<effectId>::<key>` (for example `audiofx:layer:song:ec_1::feedback`). The + beside a number makes the control; `parsePropTarget` gives the mapping engine the prop id `audiofx:<chainId>:<effectId>`, so the value lives beside layer properties and Finish numbers (`playEngine.layerValue`), is recorded in takes, played back, and read by conditions. Removing an effect removes its controls and their mappings. Map a cutoff with an **Exp** curve for an even sweep.

## Readers: after or before

**Readers hear** (`audioFx.analyse`, default after): the analyser each sound already had (the audio readers, audio layers, Audio Input uniforms) taps the chain's output, or with **Before** its input. The master chain has no analyser of its own, except on the test loop, which is a single sound.

## Recordings, renders and websites

- **Real-time recordings** tap the record bus after the master chain, so they carry every chain (the synth is still left out, as before).
- **Frame-by-frame renders** (`mixdown` in `lib/recordingAudio.ts`) build the chains in the `OfflineAudioContext`: each track through its chain (a Video layer's volume after it), all through the master. Numbers start where they are now, or with a take, follow its recorded control tracks every 20 ms with the same smoothing.
- **Website exports** carry `play.audioFx`; the runtime builds the chains from the inlined kit (`SSKit.audioFx`) for Audio Input songs and Video layers' sound, with a master chain per context, and drives the numbers from its own mappings.

## Plan

Audio effects are **Pro** (`play.audioFx` in `lib/plan.ts`), like the picture's Finish stack: they sit in the Finish tab, and most of the sounds they act on (audio and Video layers, the MIDI synth) are Pro already. On Free every chain is straight through, the record keeps its effects, and the "needs Pro" note lists them. Audio as a mapping source stays Free.

## Tests

`src/play/__tests__/audioFx.test.ts` renders through real Web Audio in Node (`node-web-audio-api`, a dev dependency), into buffers only: curve shapes, chains of every kind, a low-pass on a two-tone signal (levels at 200 Hz and 6 kHz), ping-pong alternation, smoothing, an offline mix with and without a low-pass, a take's cutoff sweep in a render, the record's parsing, Free, and the exported kit rendering the same chain.

## Not yet

- The drum pad sampler (its own chain) and plugin hosting (see `docs/backlog.md`).
- Audio effect numbers in the Map… menu and in condition value pickers (use the + on the card, then map the control).
