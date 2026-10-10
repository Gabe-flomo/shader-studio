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

## Depth in 3D scenes

Two nodes put a picture with depth inside a ray-marched scene (3D Scene in the node browser).

**Depth Composite** puts 3D objects behind or in front of what's in the picture.
- **Wire:** the picture's colour, the Depth node's Depth, and the March Loop's Color, Distance and Hit.
- **Result:** at each pixel the nearer one wins. A sphere 3 units back hides behind a person standing at
  2, and shows around them.
- **Calibrate:** depth models give relative nearness, not distances. **Nearest** and **Farthest** say
  where, in scene units, the picture's nearest and farthest things are. Set them with **Show: Picture
  distance** (bright is near), so objects sit where you expect.
- **Edge softness** fades the scene in at the picture's edges, to hide halos round hair.
- **Scene in front** is a mask of where the 3D objects show.

**Depth Light** lights the picture from a light in the scene, such as a glowing sphere.
- **Wire:** the picture (or a Depth Composite's Color), its Depth, the March Camera's Ray Origin and Ray
  Dir, and the light's position (a glowing sphere's centre) and colour.
- **How it works:** each pixel is placed in 3D along the camera's ray at the picture's distance. Its
  neighbours give the way it faces, and light adds where it faces the light, fading with distance
  (**Reach**). **Wrap** softens it round curved surfaces.
- **Own light** dims the picture's own lighting first, for a night relight.
- **Where:** wire 1 − Depth Composite's *Scene in front* so the 3D objects aren't lit as if they were
  the picture.
- **Several lights:** chain several Depth Lights.
- **Outputs:** **Light** gives only the added light (blur it for a soft glow), and **Picture point** and
  **Picture normal** give each pixel's place and direction in the scene.

**Limits:**
- The camera must roughly match the picture's: a still or tripod shot, with a March Camera at a similar
  field of view. Moving cameras need tracking (planned).
- The picture's own lighting is baked in, so a light can add and tint but can't remove a harsh shadow.
- The picture is a surface seen from the front.
- Shadows from 3D objects onto the picture, and the picture as an environment for reflections, are next.
