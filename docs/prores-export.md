# ProRes export (with alpha)

Record › Video can write Apple ProRes `.mov` files, in every profile, on the desktop and in the
browser. ProRes 4444 and 4444 XQ keep the alpha channel, so a transparent export drops straight
into After Effects, Premiere, Resolve or Final Cut as footage with transparency.

| Profile | Alpha | prores_ks `-profile:v` | FFmpeg `pix_fmt` | fourcc | ~Mbit/s at 1080p30 |
| --- | --- | --- | --- | --- | --- |
| 4444 | yes | 4 | `yuva444p10le` (+ `-alpha_bits 16`) | `ap4h` | 330 |
| 4444 XQ | yes | 5 | `yuva444p10le` (+ `-alpha_bits 16`) | `ap4x` | 500 |
| 422 HQ | no | 3 | `yuv422p10le` | `apch` | 220 |
| 422 | no | 2 | `yuv422p10le` | `apcn` | 147 |
| 422 LT | no | 1 | `yuv422p10le` | `apcs` | 102 |
| 422 Proxy | no | 0 | `yuv422p10le` | `apco` | 45 |

The table lives in `src/utils/prores.ts` (`PRORES_PROFILES`); the rates are Apple's targets and
drive the dialog's size estimate (scaled by pixels and frame rate, ×1.5 for the 4444 pair's alpha
plane, which Apple's figures leave out). A soft glow keyed to alpha measured about 2× Apple's rate
(720×1254, 60 fps, 5 s: 368 MB against 180 MB unadjusted); flat pictures come in lower.

## Two paths

**Desktop (FFmpeg).** Mode › FFmpeg (HQ), Codec › ProRes, then a profile. A transparent export
always uses ProRes (4444 unless 4444 XQ is picked). `runFfmpegEncode` sends each frame's RGBA bytes
to `start_ffmpeg_encode` / `send_frame_rgba`; FFmpeg reads them as `rawvideo rgba` and
`src-tauri/src/export_codecs.rs` picks `prores_ks` with the profile's number and pixel format.
The codec names are `prores_proxy`, `prores_lt`, `prores_422`, `prores` (422 HQ, its old name),
`prores4444`, `prores4444xq`. Sound goes in as PCM.

**Browser (WASM).** In the browser (and the desktop's Real-time mode), Format › ProRes renders frame
by frame, offline, and encodes with [ProRes WASM Encoder](https://github.com/OlivierEstevez/ProRes-WASM-encoder)
(`src/utils/proresWasm.ts`). It runs in a pool of Web Workers (blob workers; the single-thread encoder
where workers can't start). It writes video only: the Sound toggle is off on this path, with a note.
The whole file is held in the tab until it saves, so the dialog warns above about 2 GB.
Without ProRes, transparency in the browser is still a PNG sequence in a .zip.

## Alpha from the render

The exported alpha is the picture's, decided by Background › Transparent:

- **Its own alpha**: the graph ends in Output (RGBA) (`vec4Output`).
- **Black turns clear**: alpha from brightness (`lumaKey`), for glows and particles on black.
- **Layers only**: the shader picture is left out; only the Play layers.

The offline render (ShaderCanvas `renderAtTime`) draws the shader with no blending (three.js
`ShaderMaterial` is opaque, so its `gl_FragColor` is written as is) into a half-float target, and the
dithering blit copies alpha through into the 8-bit read-back target. Play layers and the Finish stack
are laid over on a 2D canvas, whose `getImageData` returns un-premultiplied values. So frames reach both
encoders as **straight** alpha, which is what ProRes 4444 stores; nothing is un-premultiplied.
(A graph that itself outputs premultiplied colour, such as a Splat Scene's texture straight into
Output (RGBA), is exported as it outputs it.)

With Transparent off, a ProRes frame is forced opaque (`forceOpaque`), so a 4444 file doesn't carry
a stray shader alpha; the dialog warns that the 4444 file will be opaque. With Transparent on and a
graph without Output (RGBA), it warns that the alpha comes from brightness.

**Smooth depth of field** (March Camera's Lens › Smooth, docs/march-camera.md) uses its hidden pass's
alpha for the blur size, so it only opens when the graph's Output colour is wired: a graph ending in
Output (RGBA) compiles the lens as Grain instead. A transparent export with its own alpha therefore
gets Grain's depth of field, not Smooth's.

## Licence (LGPL)

ProRes WASM Encoder 1.0.3, by Olivier Estevez, is LGPL-2.1-or-later. It's an npm dependency
(`prores-wasm-encoder`, pinned), used unmodified, and is only reached through `import()` in
`utils/proresWasm.ts`; `vite.config.ts` gives it a chunk of its own (`prores-wasm-*.js`), so it is
never in the app's main script and can be swapped for another build of the library on its own.
Its licence text ships at `licenses/prores-wasm-encoder.txt` (from `public/licenses/`), it is listed
in `src/lib/thirdParty.ts`, and the Record dialog credits it with links to the licence and source when
the browser path is picked. Nothing is fetched from a CDN: the WASM is inlined in the chunk.

## Tests

`src/utils/__tests__/prores.test.ts`: the profile table against `export_codecs.rs` (codec, profile
number, pixel format, alpha bits) and `rgba` input; the effective profile; size estimates; the
dialog's notes (keeps transparency, opaque-file and no-alpha warnings, the browser's no-audio note and
memory warning); `forceOpaque`; RGBA frames with alpha reaching FFmpeg untouched; the browser encoder
getting straight RGBA and the profile number, falling back to one thread, freeing itself on cancel;
the encoder only ever imported lazily, in its own chunk; and its licence listed and shipped.
`src-tauri/src/export_codecs.rs` has Rust tests too (`rustc --edition 2021 --test src-tauri/src/export_codecs.rs`).
