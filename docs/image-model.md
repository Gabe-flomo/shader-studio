# The image model (kept, not used yet)

Playfield can run a small local image + text model. Nothing uses it at the moment: it is kept
downloaded and ready for future explanations and suggestions (see docs/retired-experiments.md).

**The model.** MobileCLIP-S0 (Apple), a small CLIP-style model, in the ONNX export Transformers.js
reads (`Xenova/mobileclip_s0`, pinned to a revision in `src/imageModel/config.ts`). The vision tower
runs in fp16 (21.8 MB) and the text tower in int8 (40.8 MB); with the tokenizer it is 65 MB. The vision
tower's int8 export is not used: it ranks colours wrongly, while fp16 matches fp32 to three places.
The upstream weights come with Apple's sample-code licence; the desktop bundle carries its notice.

**Where it runs.** In a Web Worker (`worker.ts`), on WebGPU when the adapter has `shader-f16`, else on
WebAssembly (ONNX Runtime's WebAssembly is an asset of the app, never a CDN). It loads lazily, the first
time something asks for it, never at app start. `embedImage(frame)` and `embedText(text)` (in
`client.ts`) return unit-length 512-d vectors, with small LRU caches. `looks.ts` draws a graph once for
the model (`lookFrame`) and embeds it (`lookOf`).

- **Web:** downloaded once from Hugging Face with a progress bar (Settings, App settings, Image model)
  and kept by the browser. After that, "Use the image model" is on by default.
- **Desktop:** the files are bundled with the app (`dist/models/`, copied in by `vite.config.ts` in a
  Tauri build; `tools/fetch-image-model.mjs` fetches them into `.cache/image-model/`), so it works
  offline from the first launch. It is on by default.
- **Off:** nothing changes; no feature depends on it.

Dev: `?imageModel=local` serves the files from `.cache/image-model/`; `?imageModel=wasm` forces
WebAssembly; `window.__imageModel` exposes the client.

**Settings.** The status (loaded or not, size, backend, load time), the one-time download button and
the on/off toggle live in App settings, in the Image model section
(`src/components/files/ImageModelSetting.tsx`).
