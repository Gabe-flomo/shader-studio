# Time cube: a video as a box of time

Stack every frame of a video one behind the next and you get a box. Two of its
sides are the frame and the third is time. This is the space-time volume, or
video cube. Fels and Mase's *Interactive Video Cubism* (1999) and Klein,
Sloan, Finkelstein and Cohen's *Video Cubism* (2001) cut it open with planes.
Every slit-scan picture is one such cut (Golan Levin's *Informal Catalogue of
Slit-Scan Video Artworks*, 2005, collects them).

Three nodes work with the box:

- **Time Cube** stacks the frames.
- **Time Cube View** draws the box in 3D: see-through before the slice, solid
  after it.
- **Time Slice** cuts it flat, as a picture.

## The nodes

### Time Cube (Sources)

Choose a video on the card:

- **Choose video** lists the Library's videos;
- **From a file…** adds a file to the Library first;
- **Test clip** is a built-in clip of a red car crossing a street. It is
  painted, not decoded, so it needs no file. It is the default and the one
  the examples use.

The node decodes the planned frames into one texture (see "How it works") and
shows its progress, with **Cancel**. After a cancel, an error or a missing
video, **Build** starts it again.

Once it is built, the card shows:

- the frame count, the frame size and the memory it takes;
- how far apart the frames are in time;
- a strip of eight of the frames;
- a line in amber when a cap cut the frame count (see "Limits").

| Setting | What it does |
|---|---|
| Frames | How many frames, spread evenly from Start to End (2 to 256, 128 by default). |
| Spacing | Spread a number of frames, or take one every so many seconds (**Every**). |
| Frame size | Each frame's width: 128, 192, 256 (the default), 384 or 512 px. The height follows the video's shape, rounded to a multiple of 8. |
| Start / End | The part of the video to stack, in seconds. End 0 means the end of the video. |

The graph keeps the video **by reference**: `videoId` (the same key Video
layers and Baked nodes use), its name, and its size and length (`_meta`). The
frames themselves are not saved. They are decoded again when the graph opens.

The Library and Files pages count the node as a use of its video, so **Clean
up** keeps the video. `.playfile` bundles carry it like a Video layer's.

### Time Cube View (3D Scene)

This node ray-marches the box front to back. It has these sockets:

- **Volume:** a Time Cube's output.
- **Offset:** where the slice is in time, 0 to 1. It is also a slider. Wire
  Time or an LFO into it to sweep the slice.
- **Ray Origin / Ray Dir:** a March Camera's rays. Unwired, the node uses its
  own orbit camera. It is the same maths as March Camera: Cam Distance, Angle,
  Elevation, Orbit speed and Zoom.
- **Background:** what is behind the box. Unwired, the node uses the
  Background colour.
- **Scene distance:** a March Loop's Distance. Scene surfaces nearer than the
  box hide it.

It has two outputs:

- **Color:** the box over the background.
- **Alpha:** how much of the pixel the box and its outline cover.

The settings are grouped into sections, and each section folds:

| Section | Setting | What it does |
|---|---|---|
| Slice | Offset | Where the slice sits: 0 is the first frame, 1 the last. |
| | Before opacity | How solid the frames before the slice (earlier) are, looking straight through all of them in time. 0.2 lets 80 % of what's behind through. The default is 0.45. |
| | After opacity | How solid the frames after the slice (later) are. 1 is a solid block. Its sides show each frame's edge pixels running through time: the slit-scan on the outside of the box. |
| | Slice face | How solid the frame at the slice is. At 1 that frame is drawn crisply, exactly where the ray crosses the plane, not at a march step. |
| | Tilt X° / Tilt Y° | Tilts the slice so time runs across the frame. The cut face becomes a slit-scan. |
| Box | Stack along | Which way time runs through the box: **depth** (frames one behind another), **width** (side by side) or **height** (stacked up like a layer cake). |
| | Time stretch | The box's length in time, against the frame's height of 1. |
| | Box size | Scales the whole box. |
| | Quality | Samples along each ray: **Draft** (96), **Good** (160) or **Best** (288). |
| Look | Brightness, Contrast | Applied to every frame. |
| | Dark is clear | Makes dark pixels see-through. At 1 only the bright parts of each frame stay, which suits footage shot on black. |
| | Background | The colour behind the box. |
| Colour key | Key | **Off**, **A colour** (RGB distance), **A hue (any brightness)**, or **A brightness range**. |
| | Key colour, Tolerance, Softness | What counts as a match. A hue also needs some saturation: greys never match. |
| | Brightness range | For a brightness key: from how dark to how bright. |
| | Key opacity | How solid the matching colour is, before and after the slice alike. At 1 it leaves a solid trail through time. |
| | Others | The opacity of everything else, multiplied by Before / After. Lower makes the rest ghostly. |
| | Others grey | Drains the colour from everything that doesn't match. |
| Edges | Edge width, Edge opacity, Edge colour | The box's outline, in pixels. Front edges are drawn over the box. Back edges show through whatever the march left clear. |
| | Slice outline | A line round the slice where it meets the box. |
| Camera | Cam Distance, Angle, Elevation, Orbit speed, Zoom | The built-in camera. With a March Camera wired, set Zoom to that camera's FOV so the edges stay the width you set. Adding the View to a scene does this for you. |

### Time Slice (Sources)

A flat cut through the box, as a picture. The **Cut** setting picks the cut:

- **Plane:** one frame at Offset. Tilt X / Tilt Y tip the plane so each column
  (or row) comes from its own moment. This is slit-scan.
- **Row through time:** one row of the video (Offset picks it) laid out with
  time running up the picture.
- **Column through time:** one column, with time running to the right.

The other settings:

- **Delay map:** a socket. A value per pixel (a gradient, noise, a shape)
  pushes each pixel back in time by that value times **Delay amount**. This is
  time displacement.
- **Past the ends:** **Hold** the first or last frame, **Loop**, or
  **Bounce**.
- **Brightness** and **Contrast**.

It has three outputs:

- **Color**;
- **Value**: the brightness;
- **Time**: where in time this pixel was read, 0 to 1.

No 3D is involved.

## Adding them

- **Time Cube View or Time Slice** on the top level reads the nearest Time
  Cube. If there is none, a new one (the test clip) is added to its left.
- **A View in a graph that already ray-marches a scene** joins the scene
  (`lib/timeCube/autoWire.ts`):
  - the March Camera's rays;
  - the March Loop's Color behind it and its Distance in front;
  - its Zoom set to the camera's FOV.

  The Output then shows the View, which is the scene with the box in it.
- **Otherwise**, the Output shows the new node only when nothing was wired
  into the Output.

Every node it adds has a note. Undo takes it all back in one step.

## Play, Time, LFO

Every slider on the View and the Slice is a live uniform, colours included.
Dragging one, or a Play control or mapping on it, needs no recompile. The tests
check every one.

These need a recompile:

- **Stack along**, **Quality** and **Key** are choices, and change the code.
- The Time Cube's own settings rebuild the volume. A change waits a third of a
  second for the next one, so a slider drag builds once, at the end.
  - Until the new volume is ready the box is blank, rather than showing the
    old frames laid out wrong.
  - A volume with the same settings as one built before comes back from the
    cache with no decoding. Undo and redo use this.

## Examples (the Time Cube folder)

Each node in them has a note.

- **Time cube: a video as a box of time**
  - Test clip → View, with the camera orbiting slowly.
  - A triangle LFO (0.5 ± 0.47, 14 s a round trip) sweeps the slice.
  - Before opacity 0.6.
- **Time cube: isolate a colour**
  - The Key is a hue: red, Tolerance 0.07.
  - The red car leaves a solid red ribbon slanting through the box (Time
    stretch 2.2).
  - The rest of the street is a grey ghost: Others 0.7, Others grey 0.85.
- **Slit-scan from a time cube**
  - A Time Slice tilted 40° across X, wrapping in time.
  - A sawtooth LFO runs it through the clip every 5 s.
  - The car comes out stretched and the bouncing ball bent.

All three use the built-in test clip. The repository has no sample video, and
a painted clip works offline, in tests and in exported pages with no file to
carry. The clip shows a street:

- a red car (the only red thing) driving left to right;
- a blue ball bouncing the other way;
- a drifting cloud and a climbing sun;
- a swaying tree and blinking street lamps.

## How it works

**Storage: a 2D atlas, not a 3D texture.** The N frames are tiles on one 2D
texture, laid out near square: 128 frames of 256 × 144 make 9 × 15 tiles, a
2304 × 2160 texture. The shader reads it as a volume:

1. bilinear inside a frame;
2. blended between the two nearest frames;
3. two texture reads a sample (`tcSample`).

A `sampler3D` would read once a sample and blend in hardware, but the atlas
won because it fits what is already there:

- It is an ordinary image texture, so it goes through the store's
  `nodeTextures`, the same path a Texture Input takes. The preview, offline
  renders, Present and web exports bind it with no new uniform table.
- A web export carries it as one image.
- It works in WebGL1 too, which the web runtime still falls back to.

The cost of the extra read is small (see "Performance").

**No mipmaps.** The ray steps from tile to tile. Mip levels would blend
neighbouring frames, and at a jump the derivatives would pick a blurry level.
So the atlas has no mipmaps:

- in the app, `generateMipmaps` is false;
- in exported pages, the texture's `flat` flag tells the runtime to skip
  mipmaps.

Tiles are whole blocks of 8 pixels, so a JPEG of the atlas never bleeds one
frame into the next.

**Layout in the shader.** The layout is a pure function of the node's settings
and its video's size (`lib/timeCube/plan.ts planFrameStack`). So the compiler
writes it into the shader as defines next to the sampler:

- `#define u_tex_<slug>_vol vec4(cols, rows, frames, aspect)`;
- `#define u_tex_<slug>_volpx` for a half-texel inset.

Nothing needs a runtime uniform, and exports need nothing extra.

**Decoding.**

- A video's frames are read the way Bake's offline render reads a Baked
  node's video: a muted `<video>`, `currentTime` set to each frame's time, wait
  for `seeked`, draw the frame into its tile.
- This works in every browser and in the desktop app's WKWebView, with no
  WebCodecs and no demuxer.
- A WebM straight from a recorder often has no length in its header. Probing
  seeks far past the end to make the browser find it.
- Frame `i` is taken from the middle of its slot: start + (i + ½) × span / N.

**Rendering.** A slab test finds where each ray enters and leaves the box. The
march then steps front to back, compositing with emission and absorption (the
classic volume rendering of Levoy, 1988):

```
alpha_step = 1 − exp(−τ(opacity) · step / time length)
colour    += (1 − alpha) · alpha_step · sample
alpha     += (1 − alpha) · alpha_step
```

- **τ(o)**, the transfer function, is −ln(1 − o) up to 0.95. That makes an
  opacity "what the region hides looking through its whole length in time",
  however many steps it takes. From 0.95 it climbs steeply to 1000 at 1, so 1
  is a hard surface rather than thick fog.
- **Where each voxel's opacity comes from:**
  - the side of the slice plane it is on (Before / After);
  - Dark is clear;
  - the key: matching voxels take Key opacity, the rest Others × their side's
    opacity.
- **The slice plane** is linear along the ray, so the point where the ray
  crosses it is solved exactly. The slice frame is composited there, in order.
- **Jitter:** each pixel samples at its own point within each step
  (interleaved gradient noise). The fixed-step banding becomes a fine, still
  grain.
- **Early out:** the march stops when alpha reaches 0.995.
- **Edges:** the outline is where the ray's entry or exit point is near two
  faces at once (the middle of its three distances to the faces is small). The
  width is in pixels at that depth.

**Orientation.** The app's cameras (March Camera) put screen right at −x when
looking down −z. So the frame's u runs toward −x, and a frame reads the right
way round from the side time starts on: +z for depth, +x for width, +y for
height.

## Performance

These timings were measured in Chrome (ANGLE Metal) on an Apple M3 Pro. They
are GPU time from `EXT_disjoint_timer_query_webgl2`, the median of 20 frames,
rendering the compiled shader at **1920 × 1080**. The volume is the default,
**256 × 144 × 128** (2304 × 2160 atlas, 19.9 MB).

| Graph | GPU ms per frame at 1080p |
|---|---|
| View, Good (160 steps), slice at 0.5 | 0.92 |
| View, Draft (96 steps) | 0.82 |
| View, Best (288 steps) | 1.47 |
| View, Good, slice at 0.95 (almost all see-through) | 1.32 |
| View, Good, camera close (the box fills the frame) | 1.24 |
| Isolate a colour (Best, key on) | 1.48 |
| Slit-scan (Time Slice, 2D) | 0.22 |

Building a volume:

- **Test clip:** about 12 ms for 128 frames.
- **A video:** about 26 ms a frame by seeking. A 3 s, 640 × 360 VP8 WebM took
  3.3 s for 128 frames. Files with keyframes far apart decode more slowly.
- **Probing a video's size and length:** about 60 ms.

## Limits

- **Memory:**
  - At most 256 frames.
  - An atlas no wider or taller than 4096 px. WebGL2 promises only 2048, but
    every desktop and phone GPU in use has 4096 or more.
  - At most 64 MB of GPU memory a volume.
  - No more than 60 frames a second of video.

  The card says which cap cut the count. The default volume is 19.9 MB on the
  GPU, plus the same again for the canvas the app keeps (the export encodes
  it, and the card's strip draws from it). Up to three unused volumes stay
  cached for undo.
- **8-bit colour**, like the video.
- **Exported web pages:**
  - The atlas travels as one JPEG (quality 0.92). The default test clip adds
    about 1.1 MB to the page.
  - An atlas whose JPEG is over 3 MB is scaled to 2048 px on its longest
    side. The frames get smaller, the layout still holds, and the export
    dialog says "scaled to 2048 px".
  - The page doesn't decode video. The frames are baked into the image.
- **Opening a graph:** the volume is decoded again from the Library. In a
  browser without that video the card says it is missing. Choose it again.
- **Offline renders** (Record's exports, Bake) wait for builds in flight
  before their first frame.
- **Not tested:**
  - inside groups and Pass programs: the sampler is registered inside plain
    groups, but this is untested;
  - the mobile card, which has the sliders but no **Choose video** button;
  - the desktop app (WKWebView) decoding: its seeking path is the one Baked
    nodes use.
- **A key matches colours, not objects.** The red car's dark windows and
  wheels don't match red, so its ribbon has holes where you see through them.

## Code

| Part | Where |
|---|---|
| Planning, caps, the transfer function, slice and box maths | `src/lib/timeCube/plan.ts` |
| Decoding frames, the test clip | `src/lib/timeCube/frames.ts` |
| Building, caching and binding volumes | `src/lib/timeCube/volumes.ts` (synced from `ShaderCanvas`) |
| Adding a View or Slice | `src/lib/timeCube/autoWire.ts` |
| The nodes and their GLSL | `src/nodes/definitions/timeCube.ts` |
| The card | `src/components/timeCube/TimeCubeCardBody.tsx` |
| Examples | `src/store/timeCubeExamples.ts` (**Time Cube** folder) |
| Sampler registration | `compiler/shaderAssembler.ts` (as Texture Input's) |
| Web export: no mipmaps | `play/exportHtml.ts`, `play/runtime/play-runtime.js` (`flat`) |

The tests are in `src/lib/timeCube/__tests__/timeCube.test.ts`. They cover:

- frame-stack planning: counts, spacing, caps and memory, tile rounding, and
  the tile ↔ atlas mapping;
- the transfer function: opacity over a length, the hard surface at 1, before
  and after, Dark is clear, the key modes;
- the slice plane and box mapping;
- compiling: one sampler per Time Cube, shared helpers, the layout defines,
  every slider live, a March Camera wired in, an unwired view;
- adding a View or Slice;
- Library use counts.

`compiler/__tests__/goldenShaders.test.ts` leaves out the Time Cube folder.
Every other graph compiles byte for byte as before.
