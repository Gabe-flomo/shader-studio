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
| Distance (metric) | With a metric model (Depth Pro, ZoeDepth: experimental), how far this pixel is in metres. 0 with other models and with a bake |

## The model

**Depth Anything V2 Small** (Apache-2.0): fast, with sharp edges. It's a 50 MB download (27 MB on
WebAssembly), offered by the card the first time a Depth node needs it. The browser keeps it after
that, and it works offline.

Base and MiDaS DPT-Hybrid were tried side by side and dropped (2026-10-10). **Resolution** is the long side of the
frame the model sees: smaller is faster, larger is finer.

### Experimental models

To try other models, open **Experimental models** (folded, at the bottom of the Depth card) and tick **Experimental
depth models**. It is one setting for every Depth node in this browser (App settings lists it). Then the card gets a
model picker and **Compare models** (every model side by side on the frame the node last sent, with its time per frame).
Turned off, every Depth node runs Small again; a graph that picked another model keeps its pick for next time.

Each is a separate opt-in download, pinned to a revision; sizes and licences were checked through the Hugging Face
API (2026-10-10). Timings are on this Mac (WebGPU, Apple Silicon) with the "ridges at dusk" still, after a warm-up:

| Model | Repo | Download | Licence | Time a frame | Notes |
|---|---|---|---|---|---|
| Depth Anything V2 Small (default) | `onnx-community/depth-anything-v2-small` | 50 MB | Apache-2.0 | 47 ms at 518 | Clean layers, sharp ridges, flat sky |
| Depth Anything V2 Base | `onnx-community/depth-anything-v2-base` | 72 MB | CC-BY-NC-4.0: testing only | 103 ms at 518 | Almost the same as Small here, a little crisper on the ridges |
| MiDaS DPT-Hybrid | `Xenova/dpt-hybrid-midas` | 118 MB | Apache-2.0 | 123 ms (always 384²) | Softer, smoother bands; a square frame |
| Depth Anything V3 Small | `onnx-community/depth-anything-v3-small` | 105 MB (fp32) | Apache-2.0 | 78 ms at 504 (first frame 1.4 s) | Gives depth, not inverse depth, so the near half is squeezed together: less separation between the near layers |
| Depth Pro (Apple) | `onnx-community/DepthPro-ONNX` | 600 MB (q4f16; 746 MB on WebAssembly) | apple-ascl (original weights: Apple ML Research licence): testing only | 6.9 s (always 1536²) | Metric. Very sharp, the most detail in the far ridges. Far too slow for live: bake or stills |
| ZoeDepth (NYU + KITTI) | `Heliosoph/zoedepth-nyu-kitti-onnx` | 693 MB (fp16) | MIT | 172 ms at 384 | Metric. Soft and low-contrast on this picture |

The metric models said the ridges were 2.5–4.0 m (Depth Pro) and 1.0–3.4 m (ZoeDepth) away: the "ridges" still is a
painting, and metric models are trained on photos (ZoeDepth's indoor head likely picked it), so check their scale on
a real photo before trusting it.

**How the new ones run:** Depth Anything V3 Small has no preprocessor config and takes a batch of views, so the
worker resizes (to a multiple of 14) and normalises the frame itself and sends a 5D input; its weights are one fp32
file with an external `_data` file. ZoeDepth has no Transformers.js model type and its files are at the repo's root:
it is loaded as a plain DPT-style session (pixel values in, predicted depth out) with the worker's own resizing (a
multiple of 32, mean/std 0.5). Depth Pro's processor doesn't resize, so the frame goes in at 1536².

**Metric depth:** with Depth Pro or ZoeDepth the texture also carries each pixel's distance in metres, and the Depth
node's **Distance** output reads it. Wire it into Depth Composite's or Depth Light's **Picture distance** and the
distances are used as they are (Nearest / Farthest are skipped; where Distance reads 0 they apply again). One scene
unit is one metre. A bake keeps only nearness.

**Not added:**
- **YOLO26-depth:** AGPL-3.0 (a paid release would have to open its source) and no ONNX export on Hugging Face.
- **DepthFM:** a flow-matching (diffusion-family) model: many network passes per frame at a large size, too heavy
  for a browser.

## Video

- **A video's depth is baked first.** Press **Bake depth**: it runs the model once over the clip, and
  then plays smoothly. A Video Input wired in live shows "press Bake depth" instead of working it out
  frame by frame.
- **Live** is for stills and the picture itself: a new depth as fast as the model goes. The picture
  never waits: the last depth stays until the next arrives.
- **Every Nth frame:** lighter.
- **Smoothing** blends each new depth with the last, to calm the flicker video depth has.
- **Bake depth** runs the model once over a whole clip (or an image), and stores the depth as a video
  (or image) in the library beside it. **Update: Baked** plays it in step with the source video, so
  playback, recordings and exports are smooth and repeatable.

## Web pages

Only a baked depth goes into an exported page. Live depth on pages comes later; the card says so.

## How it works

`src/depthModel/` holds the model list (`config.ts`: pinned revisions, sizes, licences, what each output means),
the experimental setting (`experimental.ts`), the worker (Transformers.js depth models, with its own frame
preparation for repos without a processor) and the client (downloads and progress). `src/lib/depth/engine.ts`
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
- **Picture distance:** from a metric model's Distance (see Experimental models): real distances, no calibration.
- **Several lights:** "Add a light" on the card, or chain Depth Lights by hand.
- **Glowing scene:** wire a Scene Group of glowing objects (or the whole scene). Their glow reaches the
  picture from wherever they are, whatever their shape, and follows them as they move. Each pixel asks
  the scene how far the nearest glowing surface is, and which way. Set it with **Glow colour**,
  **Glow strength** and **Glow reach**. No positions are typed in.
- **Shadows from:** wire the scene, and its objects cast soft shadows of the point light onto the
  picture. **Shadow sharpness** sets the edge, and **Light size** stops the shadow ray short of the
  light, so a glowing sphere around it doesn't shadow itself.
- **Outputs:** **Light** gives only the added light (blur it for a soft glow), and **Picture point** and
  **Picture normal** give each pixel's place and direction in the scene.

### Link to a scene object

On the Depth Light card, **Link to scene object…** lists the shapes and Translate 3D nodes inside the Scene Groups
the graph draws (with where each sits). Pick one and the light's position follows it:
- **How:** the Scene Group gets an output for that object ("Sphere: position"), wired into Light position. A value
  inside a Scene Group can't leave it by wire otherwise (the group is a distance function); the compiler works the
  object's place out in the main program from its Translates.
- **Where it is:** the sum of the Translate 3D offsets on the object's position chain, from Scene Pos up to the
  picked Translate, or up to the picked shape (its centre).
- **It stays live:** a Translate's slider is a live uniform, so dragging it, Play mappings and keyframes move the light
  with no recompile; a value wired into the group's face (a pinned setting or a port) works too; and a chain wired
  inside the group that doesn't read the point being measured (Time → Sin → Y) is copied into the main program.
- **Not followed:** rotations, repeats and warps on the chain (offsets are added as if they weren't there), objects in
  a group nested inside the Scene Group, a chain that reads Scene Pos, and a Scene Group inside a March Loop's body.
- **Colour:** when the object has one, Light colour is wired too: a Scene Builder shape's colour swatch, or else the
  scene's glow tint (a Glow to Color after the March Loop that draws it). Both stay live.
- **Unlink** takes the wires (and the Scene Group's output) off; the sliders apply again.

**Several lights:** **Add a light** puts another Depth Light after this one (it takes this one's Color as its picture,
and the same depth, rays, mask and shadows), linked to the object you pick, and the Output follows. One light per
node, chained, rather than N lights in one node: each light keeps its own colour, strength, reach and shadow
settings on its own card, you can switch one off (bypass) or delete it, and the cost is the same either way. The
Glowing scene is read by the first light only, so it isn't added twice.

### The picture as the environment

**Picture Environment** (3D Scene) gives the picture's colour for any direction, so objects reflect the picture and
pick up its light: a chrome sphere shows the room.
- **Wire:** the picture's **Texture**, a **Direction** (reflect(Ray Dir, Normal) for a mirror, the Normal for soft
  light), and the March Camera's **Forward**, **Right** and **Up**. Set **Camera FOV** to the camera's.
- **Outputs:** **Color** (what that direction sees; **Blur** softens it for rough metal), **Ambient** (the picture's
  average colour, from a 5 × 5 grid) and **Picture UV**.
- **The mapping:** the picture is the backdrop the camera saw. A direction that points at a pixel reads that pixel
  (the camera's own projection); past the frame's edge it carries on evenly in angle and mirrors back and forth; behind
  the camera it is the front, mirrored.
- **Limits:** the picture is only what the camera saw. What's behind the camera, above and below the frame is made up
  by mirroring, so a mirror ball shows the room twice rather than the real room behind you; reflections don't move
  with parallax (they are a backdrop at infinity, not the picture's 3D surface); and Ambient is one colour for every
  direction.
- **Wiring into lighting:** "Add a picture with depth → …lit, and reflected" wires it for you: the objects mix their
  own colour, tinted by Ambient, with the reflection, more at grazing angles (Schlick's Fresnel) with a Reflectivity
  slider. The same Expression Block shows how to add it after a light rig.

### Add a picture with depth

A March Loop or GI Lit card has an **Add a picture with depth** button (the layers icon). It offers:
- **Picture with depth:** an empty Texture Input (drop an image on it), its **Depth**, and a **Depth Composite**
  wired to the picture, its depth, and the loop's Color (or what the Output showed after it, such as a light rig),
  Distance and Hit, on the Output.
- **…lit by the scene:** the same, plus a **Depth Light** with Glowing scene and Shadows from wired to the loop's
  Scene, the March Camera's rays, only on the picture, and linked to the scene's first object.
- **…lit, and reflected:** plus **Picture Environment**, so the objects reflect the picture.
- **Turn the camera to face the picture** (on by default): March Camera Angle and Elevation 0, no orbit.

It is one undo step, every node has a note, and picking again replaces what it added.

**Limits:**
- The camera must roughly match the picture's: a still or tripod shot, with a March Camera at a similar field of
  view. Moving cameras need tracking (planned).
- The picture's own lighting is baked in, so a light can add and tint but can't remove a harsh shadow.
- The picture is a surface seen from the front.
