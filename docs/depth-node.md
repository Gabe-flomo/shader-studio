# Depth node

A picture in, its depth out. A small model works it out on this device; nothing is sent anywhere.
The Depth node is in the node browser under Texture tools. The plan it belongs to is
`docs/depth-and-splats-plan.md` (section 1).

## Wiring

- **Texture:** what to find depth in. Wire a Texture Input, Video Input, Baked node or a Pass.
  Unwired, it reads the picture itself, a frame late.
- **UV:** where to read the depth. Unwired, it reads this pixel.
- **Parallax direction:** which way Parallax UV moves near things (default: right). Wire the Mouse
  or an LFO to look around.

## Outputs

| Output | What it is |
|---|---|
| Depth | 0–1 at this pixel. With *Near is: Bright*, 1 is the nearest thing in the frame. It is relative, not a distance |
| Depth texture | The depth as a texture, for Sample, Blur, Edges, Displace, the Texture tools and Particles |
| Near mask | 1 where the picture is nearer than *Cut-off*, fading over *Softness*. Cut out a subject, or replace the background |
| Normals | The surface direction from the depth's slopes (z towards you). Wire it into a lighting node to relight a flat picture; *Relief* sets how deep the bumps are |
| Parallax UV | This pixel's UV moved by its depth. Wire it into the picture's Texture Input UV for a small 2.5D camera shift (*Shift*, *Focus*) |

## The models

Each is downloaded once, the first time a Depth node needs it. The card offers the download with its
size; the browser keeps it after that, and it works offline. They are here side by side for testing.
Once one proves best, the others go.

| Model | Download | Licence | Like |
|---|---|---|---|
| Depth Anything V2 Small (default) | 50 MB (WebGPU, fp16), 27 MB (WebAssembly, 8-bit) | Apache-2.0 | Fast, sharp edges |
| Depth Anything V2 Base | 72 MB / 102 MB | CC-BY-NC-4.0: **testing only, never in a paid release** | Cleaner surfaces, finer detail, slower |
| MiDaS DPT-Hybrid | 118 MB / 124 MB | Apache-2.0 (MIT code) | Smoother, softer edges; always runs at 384 px |

- **Compare models** runs every downloaded model on the current frame, side by side, with its time
  per frame. Models not yet downloaded offer the download there.
- **Resolution** is the long side of the frame the model sees: smaller is faster, larger is finer.

## Video

- **Live:** a new depth as fast as the model goes. The picture never waits: the last depth stays until
  the next arrives.
- **Every Nth frame:** lighter.
- **Smoothing** blends each new depth with the last, to calm the flicker video depth has.
- **Bake depth** runs the model once over a whole clip (or an image), and stores the depth as a video
  (or image) in the library beside it. **Update: Baked** plays it in step with the source video, so
  playback, recordings and exports are smooth and repeatable.

## Web pages

Only a baked depth goes into an exported page. Live depth on pages comes later; the card says so.

## How it works

`src/depthModel/` holds the model list (`config.ts`: pinned revisions, sizes, licences), the worker
(Transformers.js `depth-estimation`) and the client (downloads and progress). `src/lib/depth/engine.ts`
grabs frames of each Depth node's source at the model's size, after the preview draws, and sends them to the
worker. It smooths the result and uploads it to a half-float texture the node samples. `plan.ts` decides when
a node is due a run; `bake.ts` handles baking. For a local check, `tools/fetch-depth-models.mjs` downloads
the files into `.cache/depth-models/`, and `?depthModel=local` makes the dev server use them.
