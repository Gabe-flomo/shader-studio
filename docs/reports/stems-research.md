# Stem separation for the Audio Source node: research

*2026-10-17. Research only. Nothing downloaded, nothing changed in the repo.* (Kept as history: Separate was built from this, then removed on 2026-10-18.)

## TL;DR

- **Primary model: HT-Demucs v4 (`htdemucs`, 4 stems: drums, bass, vocals, other).** ~9.0 dB SDR on MUSDB18-HQ,
  ~80-125 MB as fp16, MIT code. Several ONNX exports already run in **onnxruntime-web on WebGPU** with a WASM fallback.
  The STFT and iSTFT run in JS, outside the graph.
- **Guitar and piano: `htdemucs_6s`, an opt-in "More instruments" model** (~136 MB fp16 ONNX). Guitar is "okay".
  Piano bleeds a lot (Demucs' own README says so). Don't promise it.
- **Lighter fallback:** use the same `htdemucs` on WASM with less overlap. No smaller model is both open and good:
  Spleeter is about 3 dB worse and no smaller (~79 MB fp16 for 4 stems). Spleeter 2-stem (vocals and the rest) is the only real "light" choice.
- **Best quality, later, opt-in:** `htdemucs_ft` (4 models, ~333 MB, about 4× slower, +~0.2 dB) for desktop or patient users.
- **Avoid in a paid app:** Open-Unmix `umxl` (CC BY-NC-SA). BS-RoFormer SW and Mel-RoFormer Kim are labelled CC-BY-NC-SA
  in one place and MIT in another, so treat them as non-commercial until confirmed. UVR / MDX-Net community weights have no
  clear licence. SAM Audio (500M-3B parameters, SAM License) is too big.
- **Path:** one worker on onnxruntime-web, like the Depth model's. WebGPU fp16 first, WASM q/fp32 fallback. The same
  code runs in the browser and in the Tauri WKWebView. A native `ort` crate path (CPU or CoreML) in Rust is phase 2, only if the
  webview is too slow.
- **Speed for a 3-minute song (estimates from published numbers; we must measure our own):**
  - WebGPU: ~10-60 s.
  - WASM multithreaded: ~2-5 min.
  - WASM single-thread (no cross-origin isolation): ~10+ min.
  - Native ORT CPU on an M4 Pro: ~45 s.

## What the app already has (pattern to reuse)

- `src/depthModel/` (config.ts, client.ts, worker.ts, workerCore.ts) runs Transformers.js on onnxruntime-web in one
  Web Worker:
  - started only after the opt-in download, files pinned to a Hugging Face revision with byte sizes in `config.ts`;
  - per backend, a weights file (`webgpu` fp16 / `wasm` q8);
  - backend chosen by `requestAdapter()` plus the `shader-f16` feature;
  - `?depthModel=local` reads from `.cache/` (tools/fetch-depth-models.mjs), and the browser cache keeps the files;
  - `numThreads = 1` when the page isn't `crossOriginIsolated`.

  The worker already imports `onnxruntime-web/ort-wasm-simd-threaded.asyncify.{wasm,mjs}`, so plain
  `ort.InferenceSession` is available without a new dependency.
- `src/lib/segment/` uses MediaPipe in a worker and has a `bake.ts` (Bake-to-video), which is the "bake once, keep beside the source" idea.
- Licence discipline already exists: `commercial: false` flags on models, "testing only" in the UI (Depth Anything Base, Depth Pro).
  Stems need the same.
- The desktop app has no ML crate today (Cargo.toml: tauri, ffmpeg-sidecar, ureq, coremidi…). `ffmpeg-sidecar` could
  encode stems to FLAC/AAC on desktop.
- I found no COOP/COEP headers in vite.config / tauri.conf.json, so WASM is probably single-threaded today (the depth
  worker's `numThreads=1` branch). For a WASM stem fallback this matters a lot (see Risks).

## 1. Candidate models

SDR is MUSDB18-HQ average in dB unless noted. "Weights licence" is the part that matters for selling.

| Model | Stems | Quality (SDR) | Size | Code / weights licence | ONNX / browser |
|---|---|---|---|---|---|
| **htdemucs** (Demucs v4) | drums, bass, vocals, other | ~9.0 (paper, single model); ZFTurbo's list 9.16 on Multisong | 81-84 MB f16 (demucs.cpp, demucs-rs); ONNX 168-173 MB fp32, **126 MB mixed fp16** | Code MIT. Weights: no separate grant; the repo's only licence text is MIT. unblend notes "no explicit license grant". Every community re-host labels them MIT. | Yes, several: webnn/stem-separator, timcsy/demucs-web, monteslu (WebGPU, 21-piece split), bakkot/demucs-js, sevagh/demucs.onnx |
| **htdemucs_6s** | + guitar, piano | Multisong: bass 11.2, drums 10.2, vocals 8.05. No official guitar/piano SDR; README: guitar "okay", piano "a lot of bleeding and artifacts". Its "other" drops to ~5.5 | 53 MB f16 (demucs.cpp); ONNX 136 MB fp16 / 258 MB fp32 | as htdemucs | adowu/htdemucs-6s-onnx (STFT as Conv1d in the graph, ORT CPU tested, browser example on WASM); demucs-rs browser |
| **htdemucs_ft** | 4 (one model per stem) | ~9.0-9.2; per-stem: drums 11.1, bass 12.0, vocals 8.4, other 5.9 (ZFTurbo's list) | 4 × ~84 MB = ~333 MB | as htdemucs | monteslu/htdemucs-ft-webgpu (4 × 84 MB fp16), StemSplit export |
| hdemucs_mmi (v3) | 4 | 7.7 | ~160 MB | MIT | demucs.cpp only |
| Open-Unmix **umxl** | 4 | vocals 7.2, bass 6.0, drums 7.2, other 4.9 | ~45 MB quantised+gzipped (olilarkin's umx.cpp WASM site) | Code MIT, **weights CC BY-NC-SA 4.0: not for a paid app** | umx.cpp to WASM |
| Open-Unmix umxhq | 4 | vocals 6.3, bass 5.1, drums 6.0, other 4.3 | ~similar | Code MIT; weights licence not stated on README (check Zenodo) | no maintained ONNX |
| **Spleeter** | 2 / 4 / 5 (5 adds piano) | 4-stem ~5.9 avg (vocals 6.9, drums 6.7, bass 5.5, other 4.0) | 4-stem ONNX: 4 × 19.7 MB fp16 (~79 MB) | MIT code; weights ship in the same repo's releases | Best-Practice/spleeter-4stems-onnx (~18× realtime on CPU); fast but clearly worse |
| MDX-Net / UVR (Kim Vocal 1/2, Inst HQ…) | mostly vocals vs instrumental | strong on vocals | Kim_Vocal_2.onnx 66.8 MB | UVR code MIT; **individual community weights: licence unclear** | already ONNX (UVR ships .onnx) |
| **BS-RoFormer** (ZFTurbo, MUSDB-only) | 4 | **9.65** | ~257 MB fp16 ONNX | Trainer repo MIT; the silverdaw ONNX is labelled MIT | silverdaw/bs-roformer-rhythm-onnx (8 s chunks, host STFT, ORT CPU/DirectML) |
| BS-RoFormer **SW** (6 stems) | + guitar, piano | Multisong (MVSEP): vocals 11.3, bass 14.6, drums 14.1, guitar 9.05, piano 7.83, other 8.7: by far the best guitar/piano | large | **unblend lists CC-BY-NC-SA-4.0** | unblend browser ONNX |
| Mel-RoFormer (Kim) | vocals / rest | vocals 12.1 (audiojs, 50 previews) | 464 MB fp16 | audiojs says MIT; **unblend says CC-BY-NC-SA-4.0**: conflicting | audiojs/mel-roformer (WebGPU: ~3 s per 8 s chunk on M4 Max) |
| **SCNet** (small / large / XL) | 4 | small 9.03, base 9.0 (10 M params, ¼ of HT-Demucs, 48 % of its CPU time), large 9.7, XL IHF 10.08 | ~40 MB est. for base | Code MIT; checkpoints on Google Drive with **no licence stated** | no ONNX found |
| Band-SCNet (Interspeech 2025) | 4, causal | 7.79 with 2.6 M params, 92 ms latency | tiny | weights release not confirmed | no |
| SAM Audio (Meta, Dec 2025) | anything by text prompt ("piano") | n/a | 500 M / 1 B / 3 B params | "SAM License" (verify) | no: too big for this |
| DrumSep (MDX23C / HTDemucs, inagoy, jarredou…) | kick, snare, toms, hi-hat, cymbals (from a drums stem) | kick 16.7, snare 11.5, toms 12.3, hh 4.0 (jarredou MDX23C) | ? | community, licence unclear | would need export |

Notes:
- **The training data is a grey area for everyone.** MUSDB18 is a research-licensed dataset. htdemucs adds 800 internal Meta songs.
  The silverdaw card calls dataset-to-weights licensing "an unsettled, industry-wide question". Moises, LALAL,
  freemusicdemixer and Logic/Ableton-adjacent tools all ship Demucs-family models commercially. That isn't legal advice, but it is the norm.
- **freemusicdemixer.com (sevagh):** the WASM and JS are MIT, but its own custom/ensemble weights are **proprietary**.
  Don't take weights from that site. demucs.cpp's conversions of Meta's weights are fine.
- **Repo status:** Demucs was archived 2025-01-01; bug fixes continue in adefossez/demucs. The model is frozen, which is fine for us.

## 2. Running in the browser

What exists:
- **onnxruntime-web ports of htdemucs (closest to our pattern).**
  - Every working port moves the STFT and iSTFT out of the graph into JS, because `torch.onnx` can't trace complex ops.
    WebGPU also can't place the in-graph STFT or many ScatterND ops.
  - Shapes:
    - input `x` [1,4,2048,336] (CAC spectrogram) plus `xt` [1,2,343980] (waveform);
    - outputs `x_out` [1,16,2048,336] and `xt_out` [1,8,343980];
    - one segment = 343,980 samples = 7.8 s at 44.1 kHz.
  - WebGPU gotchas reported by monteslu:
    - fp16 normalisation overflows to NaN on WebGPU, so pin those nodes to CPU;
    - export with the legacy `torch.onnx` exporter at opset 17 (dynamo also gave NaNs);
    - a single monolithic session gives 200-330 ms GPU bursts that freeze a WebGPU app sharing the GPU (12-18 fps). Splitting
      the model into 21 pieces kept a 30 fps render steady. **This matters for Playfield: the renderer shares the GPU.**
- **demucs.cpp to WASM (freemusicdemixer):** CPU only (Eigen, Emscripten). Their own numbers are ~5-9 min for a song
  with 8 workers and ~20-41 min without. Too slow to be our main path, but proof that low-memory segmented WASM works.
- **demucs-rs (Burn + wgpu):** Rust, Apache-2.0, runs in the browser via WASM + WebGPU and natively on Metal. Weights are
  84 MB (4 and 6 stem) and 333 MB (ft). They say WASM is "significantly slower" than native.
- **Transformers.js:** no source-separation pipeline. Use raw `ort.InferenceSession`, which the depth worker can already reach.

Speed for a 3-minute song (180 s of audio, ~23 segments at 25 % overlap, ~45 at 50 %):

| Path | Evidence | Estimate (3 min) |
|---|---|---|
| WebGPU, mixed fp16, split | monteslu: ~22× realtime back-to-back, ~8× with UI-friendly pacing (Radeon RX 7600) | **~10-25 s** on a decent GPU |
| WebGPU, plain ONNX | bakkot/demucs-js: ~3× realtime | ~60 s |
| Apple Silicon WebGPU | not published for Demucs. Mel-RoFormer (a heavier model) takes ~3 s per 8 s chunk on M4 Max via ORT WebGPU | likely 20-60 s for htdemucs; **measure on this Mac** |
| WASM SIMD, multithreaded | native ORT CPU, M4 Pro: RTF 0.20 (1.6 s per 7.8 s segment, ~1.1 GB RAM). WASM is typically 2-4× slower than native | ~2-5 min |
| WASM single-thread | no cross-origin isolation | ~10-20 min: not acceptable |

Memory:
- ~1.1 GB per session on CPU (htdemucs_6s).
- The decoded song itself: a 3-minute stereo float32 is ~63 MB, and each stem is the same size, so 4 stems ≈ 250 MB and 6 ≈ 380 MB
  in RAM before encoding.
- Settings to use:
  - process segment by segment, writing straight into preallocated output arrays;
  - `preferredOutputLocation: 'gpu-buffer'`, disposing each segment's tensors;
  - on low-memory devices, `enableCpuMemArena:false`, `enableMemPattern:false` (timcsy).

Chunking and overlap:
- Segment 7.8 s (fixed by the model).
- Overlap 0.25 (Demucs default; 0.1 is slightly faster). Ports use 25-50 % with triangular-weighted overlap-add.
- Reflect-pad at the ends.
- Normalise by the mix's mean and std, as `demucs.apply` does.
- `shifts=1`: random-shift averaging multiplies the time, so skip it.

## 3. Running natively in Tauri (Rust)

- **`ort` crate (ONNX Runtime 1.2x):**
  - Same ONNX files, same JS-side STFT logic ported to Rust (rustfft).
  - CPU EP: RTF ~0.2 on M4 Pro, so **~45 s for 3 min** including overlap.
  - **CoreML EP** can use the GPU or ANE. There are no Demucs benchmarks, and op coverage for the transformer and
    normalisation nodes is the risk (partitions fall back to CPU). It could be 2-5× faster, unverified.
  - Adds ~20-30 MB of onnxruntime dylib to the app bundle (or use `ort`'s `load-dynamic`).
- **demucs-rs (Burn + Metal), Apache-2.0:** pure Rust, no C++ runtime. Could be pulled in as a crate. Speed is not published.
- **demucs.cpp via FFI:** MIT, small, CPU only (Eigen + OpenMP). Slower than ORT (sevagh himself made demucs.onnx because
  it "should perform significantly faster").
- **PyTorch MPS reference:** `htdemucs_ft` (4 models) ~47 s per 3-min song on M4 Pro (StemSplit vendor card), so
  plain `htdemucs` would be ~12-15 s on a GPU path. A Medium post claims an Apple Silicon port does a 7-minute song in 12 s (not verified).
- **Verdict:** WKWebView on macOS 26 has WebGPU, so the browser worker likely gives near-native GPU speed with one code path.
  Add native `ort` only if measurement says the webview is slow, or for a "High quality (ft)" desktop-only mode.

## 4. Single instruments (guitar, piano, others)

- **Guitar/piano with a commercial-safe licence today: only `htdemucs_6s`.**
  - Guitar is usable.
  - Piano is unreliable: lots of bleed, by the authors' own account.
  - "Other" gets worse because guitar and piano are taken out of it.
- **Much better guitar/piano** (BS-RoFormer SW: guitar 9.05, piano 7.83) is CC-BY-NC-SA per unblend. It could live in
  Playfield as an "experimental, testing only" model the way Depth Pro does, never in a paid build, unless the author licenses it.
- **Drum parts (kick/snare/hats) from the drums stem** (DrumSep models) would be the best feed for Hit and Learn a
  sound, but the licences are unclear and they would need ONNX exports. Later.
- **Vocals-only, highest quality:** Mel-RoFormer Kim (12 dB), but 464 MB and the licence conflicts. Not needed: htdemucs
  vocals are good enough to drive visuals.
- Caveat for the UI: stems leak (cymbals in vocals, bass in kick). For driving pictures this is far less critical
  than for remixing, and the bands and Hit already filter by frequency on top.

## 5. Recommendation

**Model plan**

| Tier | Model | Download | Speed (3 min, est.) | Licence |
|---|---|---|---|---|
| Default "Separate" | `htdemucs` 4-stem, WebGPU fp16 (+ WASM fp32/q8 file) | ~85-125 MB (one backend's file) | ~10-60 s WebGPU; ~2-5 min WASM threaded | MIT (code); weights MIT by the repo's only licence |
| "More instruments" (opt-in) | `htdemucs_6s` | ~55-136 MB | about the same | same |
| Later, desktop/patient | `htdemucs_ft` | ~333 MB | ~4× slower | same |
| Experimental only | BS-RoFormer SW | large | slower | CC-BY-NC-SA: `commercial:false` |

We will probably need **our own export** (pinned in our own HF repo or served by the app):
- legacy exporter, opset 17, STFT and iSTFT outside the graph;
- a mixed fp16 file (fp32 convs) for WebGPU, with the normalisation on CPU;
- an fp32 or q8 file for WASM.

monteslu's MIT exports are a good starting point or reference. Validate against PyTorch (correlation > 0.999, as theirs does).

**Implementation plan (the bake)**

1. **`src/stemModel/`** mirrors `src/depthModel/` (config with pinned files and bytes, client store, worker).
   - Opt-in download prompt with size, sharing the depth "download once, the browser keeps it" flow; `?stemModel=local` for dev.
   - Backend choice: WebGPU if `shader-f16`, else WASM.
2. **Worker pipeline:**
   - decode with `decodeAudioData` (resample to 44.1 kHz stereo; mono gets duplicated);
   - normalise;
   - for each 7.8 s segment (25 % overlap), in JS: reflect-pad, STFT (n_fft 4096, hop 1024), run the model, mask,
     iSTFT, then add the time branch;
   - triangular overlap-add into per-stem Float32Arrays;
   - post `{segment, total, eta}` for progress, and support a Cancel.
   - Yield between segments, or use a split model, so the renderer keeps its frame rate. Better still, **pause the
     separation while Play is running**, or let it run at a lower pace.
3. **Storage:**
   - Each stem goes into the existing media library (IndexedDB, as the sounds are), linked to the source sound's id plus the model id and revision.
   - Encode to save space: 16-bit WAV is ~32 MB per stem per 3 min; FLAC/AAC via ffmpeg-sidecar on desktop; WebCodecs
     AudioEncoder (Opus) in the browser. Opus at 160 kb/s is ~3.5 MB per stem.
   - "Separate" is a bake: run once, keep, **Re-separate** / **Remove stems**, like Bake depth.
4. **Stem picker on Audio Source:**
   - `Full mix | Drums | Bass | Vocals | Other (| Guitar | Piano)`, plus a "mix of" multi-select later.
   - The picked stem's buffer becomes what the analysers (bands, Hit, Learn a sound, effects) read.
   - Playback still plays the full mix, as an option ("Hear: mix / stem"), so you see drums but hear the song.
   - Keep stems sample-aligned with the trim. Show a hint if the stems are missing (the library was cleared).
5. **Export/web pages:** baked stems ride along like baked depth (size warning), or the analysers' outputs bake to
   data. Decide later.
6. **Tests:** STFT round-trip against a reference, overlap-add identity (`stems sum ≈ mix`), progress/cancel, and a small
   fixture through a tiny dummy ONNX graph (no real model in CI).

**Risks**

- **WASM fallback speed:** without cross-origin isolation (COOP/COEP), ORT WASM is single-threaded, which means 10+ minutes.
  Options: enable COOP/COEP in the dev server, in web hosting and in the Tauri custom protocol (check that it doesn't break
  cross-origin images/CDNs), or label WASM as "slow: leave it running".
- **WebGPU numerics:** fp16 NaNs and op placement mean we need our own export and validation.
- **Sharing the GPU** with the live renderer causes stutter during separation. Split the model or pace it.
- **Memory:** ~1-1.5 GB peak. Long tracks (10 min or more) need streaming output writes. Mobile Safari may kill the tab.
- **Licence:** Demucs weights have no explicit separate grant. The MUSDB/training-data question is industry-wide. Before a Pro launch,
  have someone confirm; credit Meta/Défossez in About.
- **6-stem expectations:** piano is weak, so label it.
- **Maintenance:** Demucs is archived (stable but frozen). The RoFormer and SCNet ecosystems move fast but mostly carry NC weights.

## Open questions for the user

1. Is a ~100 MB opt-in download for 4 stems OK, plus ~140 MB more for guitar and piano? Or start with 4 stems only?
2. Is guitar and piano worth shipping at Demucs 6s quality (piano is weak), or wait for a commercially licensed better model?
3. Should we enable cross-origin isolation (COOP/COEP) app-wide? It would also speed up the WASM depth/segment paths, but can
   break cross-origin media without CORP headers.
4. Separate during Play, or only when paused (to protect frame rate)?
5. Should stems be stored compressed (Opus, ~3.5 MB per stem) or lossless (WAV, ~32 MB per stem for 3 minutes)?
6. Free vs Pro: is Separate a Pro feature, and is a desktop-only "High quality (ft)" mode wanted?
7. OK to host our own pinned ONNX export (an HF repo under the user's account) rather than depend on a community repo?

## Sources

- Demucs (README: models, 6s piano caveat, segment and speed notes, MIT, archived): https://github.com/facebookresearch/demucs , fork https://github.com/adefossez/demucs
- demucs.cpp (MIT; f16 weights 81/53/160 MB; quality "practically identical"): https://github.com/sevagh/demucs.cpp
- demucs.onnx (STFT outside graph, ORT minimal build): https://github.com/sevagh/demucs.onnx
- freemusicdemixer.com repo (WASM MIT, weights proprietary, timings): https://github.com/sevagh/freemusicdemixer.com
- Open-Unmix (umxl CC BY-NC-SA, SDR table): https://github.com/sigsep/open-unmix-pytorch ; umx.cpp WASM site: https://github.com/olilarkin/free-music-demixer
- monteslu htdemucs WebGPU split export (126 MB, 22×/8× realtime, GPU stutter): https://huggingface.co/monteslu/htdemucs-web-onnx
- monteslu htdemucs_ft WebGPU (4 × 84 MB, fp16 NaN workarounds): https://huggingface.co/monteslu/htdemucs-ft-webgpu
- WebNN stem separator (168 MB, 50 % overlap OLA, shapes): https://huggingface.co/webnn/stem-separator
- demucs-web (timcsy; 172 MB; COOP/COEP needed): https://github.com/timcsy/demucs-web
- demucs-js (bakkot; ~3× realtime WebGPU): https://github.com/bakkot/demucs-js
- demucs-rs (Burn, Apache-2.0, 84/84/333 MB): https://github.com/nikhilunni/demucs-rs
- htdemucs_6s ONNX (136/258 MB, M4 Pro CPU RTF 0.20, 1.1 GB): https://huggingface.co/adowu/htdemucs-6s-onnx ; 4-stem: https://huggingface.co/adowu/htdemucs-onnx
- unblend (licence labels: Demucs "no explicit grant", BS-RoFormer SW and Mel-RoFormer Kim CC-BY-NC-SA): https://huggingface.co/Ryan5453/unblend
- BS-RoFormer 4-stem ONNX (MIT, 257 MB, ZFTurbo 9.65 checkpoint): https://huggingface.co/silverdaw/bs-roformer-rhythm-onnx
- Mel-RoFormer vocals ONNX (464 MB, WebGPU timings on M4 Max): https://huggingface.co/audiojs/mel-roformer
- ZFTurbo pretrained models list (SDR for SCNet, BS-RoFormer, HTDemucs ft, DrumSep): https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md
- MVSEP BS-RoFormer SW 6-stem scores: https://mvsep.com/news/64?lang=en
- SCNet paper: https://arxiv.org/abs/2401.13276 ; code: https://github.com/starrytong/SCNet
- Band-SCNet (Interspeech 2025): https://www.isca-archive.org/interspeech_2025/yang25d_interspeech.html
- BS-RoFormer paper: https://arxiv.org/abs/2309.02612 ; Mel-RoFormer paper: https://arxiv.org/abs/2310.01809
- Spleeter models: https://github.com/deezer/spleeter/wiki/3.-Models ; ONNX 4-stem: https://huggingface.co/Best-Practice/spleeter-4stems-onnx ; SDR: https://joss.theoj.org/papers/10.21105/joss.02154.pdf
- UVR MDX CoreML card (MIT claim for Inst_HQ_3): https://huggingface.co/gyoom/UVR-MDX-CoreML
- SAM Audio: https://www.theregister.com/2025/12/16/meta_sam_ai_audio/ , https://huggingface.co/AEmotionStudio/sam-audio-models
- htdemucs_ft MPS timing (vendor): https://huggingface.co/StemSplitio/htdemucs-ft-pytorch
- ONNX Runtime CoreML EP: https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html
