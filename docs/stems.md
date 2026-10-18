# Stems: Separate on the Audio Source

**Separate** splits a song into stems on this device: drums, bass, vocals and the rest (*Other*), or with the optional
6-stem model also guitar and piano. Pick a **Stem** on the Audio Source and everything listening to it (its bands,
Hit, Learn a sound, the effects, Spectrum, Spectrogram, Waveform…) hears only that stem, while you still hear the whole
song. How to use it: [audio-tools.md](audio-tools.md#stems). The research behind the choices:
[stems-research.md](stems-research.md).

## The models

| | 4 stems (default) | 6 stems (optional) |
|---|---|---|
| Model | HT-Demucs v4 (`htdemucs`), Meta AI | HT-Demucs v4 6-source (`htdemucs_6s`), Meta AI |
| Stems | drums, bass, other, vocals | + guitar, piano |
| Files | [monteslu/htdemucs-web-onnx](https://huggingface.co/monteslu/htdemucs-web-onnx) @ `a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1`: a manifest and 21 ONNX pieces | [StemSplitio/htdemucs-6s-onnx](https://huggingface.co/StemSplitio/htdemucs-6s-onnx) @ `49df9b6989cf2150840ea65b0bef77a2e471b678`: `htdemucs_6s_fp16weights.onnx` |
| Download | 126 MB (125 886 563 bytes) | 136 MB (136 428 532 bytes) |
| Form | mixed precision (fp16, convolutions fp32), cut into 21 chained pieces of ~10–30 ms of GPU work; STFT / iSTFT in JS | one graph with the STFT inside (`mix` → `stems`), fp16 weights, fp32 maths |
| Licence | MIT (the export and Demucs) | MIT |

Every file is pinned by revision, size and SHA-256 in `src/stemModel/config.ts` and checked after it downloads, before
it runs. Nothing downloads until the person presses **Download (126 MB) and separate**; the browser keeps the files in
the same Cache Storage as the depth models (`transformers-cache`). The 6-stem model is a second, separate download; its
card says that guitar is usable but piano bleeds (other instruments leak into it) and *Other* gets thinner, as Demucs'
own README does.

## How it runs

- **One Web Worker** (`src/stemModel/worker.ts`) with ONNX Runtime Web, started the first time a downloaded model is
  used. WebGPU first (with `shader-f16`): the pieces' in-between tensors stay on the GPU, piece 0's input
  normalisation runs on the CPU (it overflows in fp16 on WebGPU). If WebGPU won't open, or its first result holds
  NaN, the worker reopens the model on WebAssembly and carries on.
- **WebAssembly threads** need cross-origin isolation (COOP / COEP). It is **off** everywhere: tried in the desktop
  app (2026.10.263), the headers stopped the preview from drawing in WKWebView, so they were taken out again
  (2026.10.264). WebAssembly runs on one thread; WebGPU (the usual path) doesn't need isolation.
  `VITE_CROSS_ORIGIN_ISOLATE=1` tries the headers in a browser dev server.
- **The song** is decoded at 44.1 kHz stereo (mono doubled), normalised by its mean and spread as `demucs.apply` does,
  cut into 7.8 s segments (343 980 samples) with 25 % overlap, and each segment goes through the model. For the 4-stem
  pieces the spectrogram is made in JS exactly as htdemucs `_spec` does (reflect pad, STFT n_fft 4096, hop 1024, Hann,
  normalised; the Nyquist bin and two frames at each end dropped), and each stem's spectrogram goes back through
  `_ispec` (`src/stemModel/dsp.ts`) and is added to the time branch. Segments are joined with demucs' triangular
  weights (`separateTrack`).
- **The picture pauses** while it runs (`lib/previewHold.ts`): the model gets the GPU, and a screen covers the app with
  the song, the step (download, segment *n* of *m*, encoding a stem), a progress bar, the time so far and an estimate,
  where it runs (WebGPU, or WebAssembly and how many threads) and **Cancel**. Done, cancelled or failed, the picture plays
  again. Cancel stops at the next piece; if the worker doesn't answer in 4 s it is stopped outright.

## Measured (Apple M3 Pro, 12 cores, Chromium 152, 2026-10-17)

| Path | Time per 7.8 s segment | A 3-minute song (31 segments) |
|---|---|---|
| WebGPU, the 21 pieces, in the browser | ~0.4–0.8 s | **~12–25 s** separating + ~6 s encoding (a 60 s clip: 8.5 s + 2.2 s; 30 s clips: 6 s in all) |
| WebAssembly, one thread (the web build without WebGPU) | 9.6 s | ~5 min |
| WebAssembly, 8 threads (ONNX Runtime Web in Node; the desktop app's case without WebGPU) | 2.7 s | ~1.5 min |
| ONNX Runtime native CPU (Node), for comparison | ~1.4 s | ~70 s |

The first run also downloads the model (126 MB: about 12 s here). WebGPU in the desktop app's WKWebView was not
measured (the app isn't launched in these checks).

**Quality check** (a synthetic song: a kick + snare loop, a low bass line, a sine "voice"): the drums stem correlates
0.99 with the kick loop and the bass stem 0.99 with the bass line (both near 0 with the other part), on ONNX Runtime
native and in the browser on WebGPU (0.93 / 0.99 after Opus). A pure sine isn't a voice to the model: it lands in
*Other*, not *Vocals*. Run the check yourself: `STEM_MODEL_DIR=<folder with the 4-stem files> npx vitest run
src/stemModel/__tests__/realModel.test.ts`.

## Storage

Each stem is encoded in the worker: **Opus at 160 kb/s in WebM** through WebCodecs' `AudioEncoder` (about 3.6 MB per
stem for 3 minutes; 600 KB for 30 s measured), muxed by a small writer in `src/stemModel/encode.ts`; where the browser
can't encode Opus, a **16-bit WAV** (about 32 MB per stem for 3 minutes). Both decode with `decodeAudioData` in Chromium
and WebKit. Decoded, the Opus stem lines up with the song within 32 samples (0.7 ms, Chromium's resampler), far under an
analysis frame.

The stems go into the media library (the videos and sounds store) with ids `stem_…`, so the sound pickers leave them
out. The Audio Source keeps the bake in its `stems` param: the model, its revision, the song's library id (`of`) and one
`sampleId` per stem. A different song in the node: its stems no longer apply (the card says so). **Re-separate** makes
new ones (with the model picked) and removes the old; **Remove stems** removes them. Saved .playfield / .playfile files
carry the stems like the song (their `sampleId`s are collected like any sound's).

## Playback and the analysis

The audio engine plays the picked stem beside the song (`setStem`): the two sources start at the same moment, at the
same offset, inside the same trim and loop, through the same effect chain; the stem has its own analyser, and that is
what the Audio nodes read (`lib/audioTools/engine.ts`). **Hear: Full mix** (the default) keeps the song on the speakers
and the stem silent; **Hear: This stem** swaps them. Learn a sound learns from the stem's samples; the window draws the
stem's waveform.

## Web pages

An exported page carries the picked stem like the song (each up to 6 MB as a data URL; a 3-minute Opus stem is about
3.6 MB) and plays it in step with the song: the page's Audio nodes hear the stem, the visitor hears the song (or the
stem with Hear: This stem). A stem over the limit stays out and the export dialog says so: there the page analyses the
whole song.

## Limits

- 44.1 kHz in; longer songs take proportionally longer (memory: ~250 MB of raw stems for 3 minutes before encoding,
  freed stem by stem).
- Stems leak (cymbals in vocals, bass in kick); for driving pictures it matters less than for remixing, and the bands
  and Hit filter on top.
- The 6-stem model has not been run here yet (wired, mock-tested only).
- Separating doesn't run during Play on its own: it pauses the picture until it's done.
- WKWebView: WebGPU, `AudioEncoder` (Opus) and cross-origin isolation under `tauri://` were not checked in the app
  (see the open questions in the PR). Without `AudioEncoder` the stems are kept as WAV.

## Plans

Separate (and Re-separate) is a **Pro** feature (`audio.stems` in src/lib/plan.ts). Stems a song already has stay usable on Free, and every other Audio node is free.
