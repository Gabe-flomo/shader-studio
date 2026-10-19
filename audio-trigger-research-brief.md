# Research brief: audio trigger detection in Playfield

*Written 2026-10-19 for an agent doing deeper research. Playfield is a node-graph GLSL editor with a live-performance Play page (web plus a Tauri desktop app on macOS). The repository is Gabe-flomo/shader-studio.*

## The goal

Visuals react to music. The user picks a **frequency band** in an audio source (a file, the mic, a video's sound, or, in the desktop app, an Ableton Live track through the Playfield Send plug-in). From that band, Playfield produces two things:

- a **Value**: a smooth 0–1 envelope that drives sliders;
- **Hits**: discrete trigger events that fire envelopes, steps and actions.

The user comes from Ableton and TouchDesigner. They want hits that land on every kick, snare or hat, never in silence, with no perceptible delay, and with a UI that needs almost no tuning.

## Where we are, and why it's not good enough

The history matters, because each step was meant as an improvement and the user now says detection is worse than the first version.

1. **v1, adaptive (before commit `6413ca2c`).** Each band's level was compared with an adaptive threshold that followed the music, controlled by one **Sensitivity** setting. The user found it "a bit inaccurate", but it needed little setup.
2. **v2 "Steady triggers" (release 2026.10.283, commit `6413ca2c`).** Fixed lines replaced the adaptive threshold:
   - **Threshold:** fire when the level crosses it.
   - **Release ×:** re-arm only after the level drops below Threshold × this.
   - **Gate:** below it the band counts as silence, with an 80 ms hold.
   - **Min ms** and **Cooldown.**

   Files are analysed ahead of time in a worker: a 2048-point FFT every 5 ms. Hits then fire when the matching moment is *heard*, using `AudioContext.getOutputTimestamp`/`outputLatency` plus a user Sync offset. Old bands were migrated with `Threshold = 0.7 − 0.4 × Sensitivity`.

   **Known weakness:** on a kick over a sustained bass line, the level never falls below Release, so hits merge.
3. **Detect modes (release 2026.10.306).** Each band got a Detect feature that the fixed lines then work on:

   | Mode | How it's computed |
   |---|---|
   | Hits | Spectral flux on log magnitudes, half-wave rectified, summed over the band's bins, normalised by a local mean (τ 0.5 s, k 3). |
   | Transient | dB jump of the level above a slow follower (τ 0.1 s), with 15 dB reading as 1. |
   | Noisy↔tonal | Spectral flatness within the band (30 dB scale). |
   | Brightness | Log centroid within the band. |
   | Drums only | HPSS (median filter: 0.2 s across time, 17 bins across frequency, 96 groups), then Hits on the percussive part. |
   | Only: Noisy / Tonal | Judges the 40 ms after each hit by flatness and drops the ones that don't match. |

   It also added Kick, Snare, Hats and Melody-notes presets. These were only tested on synthetic signals.

**The user's evidence.** On an 8 s drum test WAV, with Band 63–134 Hz, Detect Transient, Only Noisy, Threshold 0.5, Release 0.8 and Gate 0.71, the scope read **"gate shut · armed · 4547–5528 hits"**, with hits all through the silences. Suspected causes:

- On the ahead path, the Gate compares against a level on a different scale, so it never closes.
- Transient and Hits blow up in near-silence: they're relative to a tiny local mean, with no absolute floor.
- The hit count adds up across loops.

**The user's verdict:** "all of the new audio detection work seems almost worse than what we had before". The UI is also "a lot of stuff without any clear meaning".

**Work in progress** (another agent, branch `claude/detect-overhaul`): reproduce and fix the silence hits; bring v1's adaptive trigger back as the default "Auto"; build an accuracy harness that scores F-measure within ±30 ms on synthetic songs plus the user's reference loop; simplify the band row (what to catch, Sensitivity, Send value / Send hits, with the rest folded under "Fine-tune").

## How it works now

| Part | Where | Details |
|---|---|---|
| Shared detection code | `src/play/kit/audioTools.js` | Used by the app, the offline worker and exported web pages, so they give identical numbers. |
| Band level | `atBandLevel` | The mean of the dB values of the FFT bins in [lo, hi], floored at −100 dB and mapped to 0–1. Not energy-summed, not perceptually weighted. |
| Live input | Web Audio `AnalyserNode` | `fftSize` 2048 (about 43 ms at 48 kHz), `smoothingTimeConstant` 0. Read once per animation frame, about every 16.7 ms. |
| Files | `src/lib/audioTools/ahead.ts` | The same features, analysed in a worker every 5 ms, then fired when heard. |
| Band EQ | `bandFilter.ts`, `BandEqEditor.tsx` | Biquad cascades (RBJ cookbook) used for Solo and the drawing. Detection doesn't use them: it sums FFT bins. |
| Playfield Send (desktop) | `docs/playfield-send-plan.md`, `src-tauri/src/live_send.rs` | Raw audio from a VST3 plug-in through shared memory, into a worklet, into the same `AnalyserNode` path. The user says latency is "pretty bad". That work is paused, but it's part of the bigger question. |
| Constants | top of `audioTools.js` | `AT_ONSET_*`, `AT_TRANSIENT_*`, `AT_HPSS_*`, `AT_TRIGGER_DEFAULTS`, `AT_GATE_HOLD`, `AT_OFFLINE_FFT` / `HOP`. |
| Docs and tests | `docs/audio-tools.md`, `src/lib/audioTools/__tests__/` | `detect.test.ts`, `triggers.test.ts`, `aheadEngine.test.ts`. |

## Questions for the research

Answer each with sources (papers, docs, code) and a concrete recommendation for Playfield.

1. **State of the art for real-time, low-latency onset detection per frequency band, for VJ use.**
   - Compare spectral flux variants (SuperFlux with vibrato suppression, log-filtered flux, complex-domain), high-frequency content, energy envelope derivatives, and multi-band envelope followers (IIR band-pass plus a fast/slow envelope ratio).
   - Cover peak picking: adaptive thresholds such as a median plus a multiple of the MAD, the mean plus k, moving-maximum rules (as in madmom and librosa `onset_detect`), and the parameters each uses.
   - Report latency, CPU cost and robustness to silence and noise.
2. **How production tools do it.**
   - TouchDesigner: Audio Analysis CHOP (kick, snare and rhythm outputs), Audio Spectrum CHOP, Beat CHOP.
   - Resolume's audio FFT triggers.
   - Ableton: Convert Drums to MIDI, transient markers, Envelope Follower.
   - Max/MSP: bonk~, sigmund~, the Zsa descriptors.
   - Synesthesia and MadMapper.
   - aubio's onset methods (`hfc`, `energy`, `complex`, `phase`, `specflux`, `kl`, `mkl`, `specdiff`), with its silence threshold and minimum inter-onset interval.

   What defaults do they ship, and how do they avoid triggering in silence (absolute dB gates, minimum energy)?
3. **Drums vs everything else.**
   - Kick, snare and hat detection inside a full mix: band choices, HPSS variants (soft masks, kernel sizes, causal or online HPSS), NMF-based drum transcription (ADTLib, madmom DrumTranscription), and lightweight learned models (TCN or CNN onset detectors, ONNX size, latency).
   - What can run in a browser AudioWorklet or in Rust at under about 5 ms per block?
4. **Silence and noise.**
   - Proper absolute floors, noise-floor estimation (minimum statistics), and hysteresis.
   - How normalised features such as flux ÷ local mean should behave as energy approaches 0.
5. **Tempo-aware triggering.**
   - Beat tracking (online beat trackers, BTrack, madmom's online DBN, Ableton Link phase when connected) to quantise or confirm hits.
   - Expected-onset windows that suppress false hits between beats.
6. **Latency budget.**
   - What's achievable in a browser (AudioWorklet with 128-sample render quanta) versus native (Rust on raw samples), versus TouchDesigner's typical 5–20 ms.
   - Whether the analyser window (2048) should become a short filter bank or an STFT of 256–512 with hop 64–128.
   - Whether Playfield Send's analysis should move to Rust, sending only band values and hits to the page.
7. **The UX of triggers in other tools.**
   - Which controls users actually touch (one Sensitivity versus threshold, release and gate).
   - How scopes, meters and "learn" flows are presented.
   - Recommend the smallest set of controls with sensible automatic defaults (auto-gain, auto-threshold).
8. **Evaluation.**
   - A standard way to score detection: F-measure within ±25–50 ms, with MIREX onset rules.
   - Public datasets with drum onset annotations usable for tuning: ENST-Drums, IDMT-SMT-Drums, MDB Drums, the Böck onset dataset. Note licences.
   - How to build reliable ground truth from a drum loop of known tempo.

## Materials you can use

- **The user's reference loop:** "sw_v2 - dancehell 120 BPM.wav". 8.000 s, 48 kHz, 24-bit stereo, 120 BPM (16 beats; a 16th note is 125 ms). It's from a commercial sample pack, so **never commit it or play it aloud**. A copy is in the coordinator's session scratchpad, `ref-song/dancehell-120.wav`; the original is on the user's drive.
- **The synthetic test WAV:** scratchpad `trigger-detect/drums-test.wav`, with its generator `genwav.mjs` (kicks, snares and hats over a bass line, chords and melody).
- **Code and docs:** listed in the table above. `git show 6413ca2c^:src/play/kit/audioTools.js` gives the v1 adaptive version.

## Rules

- No sound played out loud.
- Research and analysis only, unless asked otherwise.
- If you prototype, do it in a scratch folder with offline scoring, and report numbers.

## What to deliver

A report covering:

1. a ranked recommendation of methods per use (kick, snare, hats, tonal notes, a generic band), with the parameters to start from;
2. the silence and noise-floor policy;
3. the latency plan, browser and native;
4. the control set and UX;
5. the evaluation plan and datasets.

Use concise tables and cite every claim. Flag anything that needs the user's ears or their Ableton setup to confirm.
