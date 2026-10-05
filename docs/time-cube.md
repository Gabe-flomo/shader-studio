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
  after it, as a soft rounded block with a glow; it can pick out frames, move
  them, let the clip flow through, pulse a key, and focus like a lens.
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
| Frames from | **Pick one frame** (the default) for each stacked frame, or read **Sub-frames** frames (2 to 16) spread over its slot of time and combine them: **Average** (a long exposure, motion blur), **Brightest** (light trails), **Darkest**, **Motion** (only what changed from one sub-frame to the next) or **Median** (what stayed put; moving things vanish). The card says how many frames that reads and, for a video, about how long it takes. |
| Precision | When combining: **8-bit** (the default, the video's own depth) or **16-bit float**. An Average or Median lands between the 8-bit steps; 16-bit keeps those shades (smooth gradients, no banding) as a half-float (RGBA16F) texture, at twice the memory (the card shows it, marked 16-bit). WebGL2 filters half-float textures everywhere, Safari and the desktop app included; web exports still carry the 8-bit atlas. |
| Frame order | **Time** (the default), **Reverse**, **Shuffle** (a seed; the same seed always gives the same order) or **Sort** by **brightness**, **hue**, **saturation**, **motion** (the change from the frames either side) or **amount of a colour** (Colour, Colour tolerance), lowest first; **Invert** puts the highest first. Equal values keep their time order. |

Changing Frame order rearranges the frames already read: nothing is decoded
again. The atlas keeps its layout; only which picture sits in which tile
changes, so the View, the Slice and Frame Stack all show the new order.

Each volume's per-frame numbers are worked out once, when first needed, and
kept with it: `timeCubes.frameStats(nodeId)` returns them (brightness, hue,
saturation, motion and key share, each 0 to 1, in time order) and the order
the tiles are in (`order[i]` is the time-ordered frame tile i shows).

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
- **Flow time:** in Flow mode, drives the flow (see "Flow"). It is also a
  slider.
- **Ray Origin / Ray Dir:** a March Camera's rays. Unwired, the node uses its
  own orbit camera. It is the same maths as March Camera: Cam Distance, Angle,
  Elevation, Orbit speed and Zoom.
- **Background:** what is behind the box. Unwired, the node uses the
  Background colour.
- **Scene distance:** a March Loop's Distance. Scene surfaces nearer than the
  box hide it.

It has two outputs:

- **Color:** the box over the background.
- **Alpha:** how much of the pixel the box covers, with its glow, outline and
  shadow.

By default the box is a soft, rounded block with a faint lilac rim glow and no
outline. The settings are grouped into sections, and each section folds:

| Section | Setting | What it does |
|---|---|---|
| Slice | Time | **Slice**: the box stands still and Offset moves the crisp frame through it. **Flow**: the crisp frame stays at Frame position and the clip flows through the box past it (see "Flow"). |
| | Offset | Where the slice sits: 0 is the first frame, 1 the last. |
| | Frame position, Flow speed, Flow time | Flow only: where the crisp frame sits (0 the front), how fast the clip moves through the box (clip lengths a second, negative runs it backwards), and an offset to drive it by hand. |
| | Before opacity | How solid the frames before the slice (earlier) are, looking straight through all of them in time. 0.2 lets 80 % of what's behind through. The default is 0.45. |
| | After opacity | How solid the frames after the slice (later) are. 1 is a solid block. Its sides show each frame's edge pixels running through time: the slit-scan on the outside of the box. |
| | Slice face | How solid the frame at the slice is. At 1 that frame is drawn crisply, exactly where the ray crosses the plane, not at a march step. |
| | Tilt X° / Tilt Y° | Tilts the slice so time runs across the frame. The cut face becomes a slit-scan. |
| Shape | Corner roundness | 0 is a sharp box, 1 rounds the edges by half the frame's height: a pill. The default is 0.4. |
| | Edge softness | Feathers the silhouette and the slice frame's border, like the blurry edges in the reference pictures. 0 is a crisp (anti-aliased) edge. |
| | Bulge | Puffs the faces out at their middles, like a cushion. |
| Glow | Rim glow, Rim width, Rim colour | A soft glow of the rim colour round the silhouette, inside and out (Fresnel-like). Width is in frame heights. 0 turns it off. |
| | Side tint, Tint from, Tint to, Tint along | Mixes a two-colour gradient into the frames, but not the slice frame: pastel sides with the picture crisp on the face. The gradient runs diagonally, along time or up the box. |
| | Shadow, Shadow softness, Shadow gap | A soft shadow on a ground below the box. 0 turns it off. |
| Highlights | Highlight frames | Switches highlights on (one recompile; the sliders are then live). |
| | Count, Spacing (frames), Start (frames), Thickness (frames) | Count frames, Spacing apart, from Start frames after the slice (or after the first frame when Fixed), each Thickness frames thick. |
| | Highlights move | **With the slice, looping round** (the default): they travel with Offset and wrap round the end of the box (modular), so as you scan they keep coming round. **With the slice**: no wrap. **Fixed**: counted from the first frame. |
| | Opacity, Tint, Colour, Outline | Each highlighted frame is a sheet this solid, tinted toward the colour, with an outline round it (Line width). |
| | Others | Thins the frames that are not highlighted (times Before / After). |
| | Send through | Sends the first highlighted frame's picture through the whole box: at 1 every frame is that one (a slit-scan of one frame). |
| Frame motion | Move frames | Switches frame motion on (one recompile). |
| | Moves frames near, Falloff (frames) | A wave round the slice, the highlighted frames, or both, easing off over Falloff frames either side. It travels with Offset. |
| | Lift, Lift sideways, Scale, Turn°, Fade | What the wave does to the frames in it: lift (frame heights), scale, turn in their own plane, fade out. |
| Frame effects | Frame effects | Switches them on (one recompile). |
| | Hue across time | Turns each frame's hue by its time: 1 goes once round the colour wheel from first frame to last. |
| | Posterize | Levels per channel, 2 to 16 (0 is off). |
| | Grey with age | Drains the colour from frames older than the slice, more the older. |
| Box | Stack along | Which way time runs through the box: **depth** (frames one behind another), **width** (side by side) or **height** (stacked up like a layer cake). |
| | Time stretch | The box's length in time, against the frame's height of 1. |
| | Box size | Scales the whole box. |
| | Quality | Samples along each ray: **Draft** (96), **Good** (160) or **Best** (288). |
| Look | Brightness, Contrast | Applied to every frame. |
| | Dark is clear | Above 0 makes dark pixels see-through (footage on black). Below 0 makes light pixels see-through (footage on white, or a light background). |
| | Background | The colour behind the box. |
| Colour key | Keep | **Off**, **A colour** (RGB distance), **A hue (any shade of it)**, or **A brightness range**. Under the settings the card says how much it keeps (*Keeps about 4% of the video (9% of the slice frame)*, or that it keeps nothing) and shows the slice frame's main colours: click one to keep it (turning the key on if it is off). |
| | Colour, How close, Soft edge | What counts as a match. A hue also needs some saturation: greys never match. How close defaults to 0.12. |
| | Brightness range | For a brightness key: from how dark to how bright. |
| | Kept opacity | How solid what is kept is, before and after the slice alike. At 1 it leaves a solid trail through time. |
| | Shift the colour | Turns the colour round the wheel by hand (1 = once round). Play-mappable. |
| Key: everything else | Opacity | The opacity of everything not kept, times Before / After. 0 hides it, low makes it a ghost. |
| | Drain colour | Turns everything not kept grey. |
| Key: animate | Animate the key | Switches the animation on (one recompile; starts with Pulse 1 and Lightning 0.4 so you can see it). Older saves with a pulse, lightning or drift set count as on. |
| | Colour drift | Turns the colour round the wheel on its own, in turns a second. |
| | Pulse, Pulse direction, speed, position, Bands, Band width, Band softness | Shows what is kept only in bands that travel through the box: Bands of them, each Band width of the space between them, Forward, Backward, Back and forth, or Out from the slice. Pulse 0 shows all of it. |
| | Lightning, Flashes a second, Flash length, Flash pattern | Flashes through random stretches of time: what is kept flares toward white and the rest of the stretch lights up, for about a fifth of a second. Up to 0.5 they come in on top; from 0.5 to 1 the rest of the key fades, so at 1 only the flashes show it. The same pattern number gives the same flashes. |
| Outline | Outline | **Off** (the default), **Silhouette** (a line round the soft shape) or **Box edges** (all twelve edges, the back ones behind the frames). |
| | Line width, Line opacity, Line colour | The lines in pixels: thin, anti-aliased, the same width wherever they are, so they don't flicker as the camera turns. |
| | Slice outline | A line round the slice frame. |
| Focus | Depth of field | **Off**, **Focus at a distance**, or **Focus on the slice** (follows the scan). The same controls as Frame Stack's. Choosing it recompiles once. |
| | Focus, Blur, Max blur | Where it is sharp (a share of the distance to the box's middle; on the slice, each ray is sharp exactly where it crosses the slice plane), how fast things soften away from it (the default Blur visibly blurs the ends of the box), and the most they blur (pixels). |
| | Blur quality | **Smooth** (the default) reads the picture up to 32 times on a golden-angle disc where it is most blurred, turned per pixel, so the blur is soft and even (fine grain, never copies of the picture); **Fast** at most 8 times. Thin stretches of the box take one read each, turned a little further every stretch. |
| Camera | Cam Distance, Angle, Elevation, Orbit speed, Zoom | The built-in camera. With a March Camera wired, set Zoom to that camera's FOV so lines stay the width you set. Adding the View to a scene does this for you. |
| | Swing | Above 0 the camera swings back and forth by this much (radians) instead of going all the way round. |
| | Flatten (isometric) | From perspective (0) to orthographic (1). With Elevation 0.62 and Angle 0.79 it is the isometric view. |

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

- **Time**, **Stack along**, **Quality**, **Key**, **Pulse direction**,
  **Highlights move**, **Moves frames near**, **Tint along**, **Outline** and
  **Depth of field** are choices, and change the code.
- **Highlight frames**, **Move frames** and **Frame effects** are switches.
  Off, their code is left out of the march, which keeps the plain View as fast
  as it was; on, their sliders are live.
- The Time Cube's own settings rebuild the volume. A change waits a third of a
  second for the next one, so a slider drag builds once, at the end.
  - Until the new volume is ready the box is blank, rather than showing the
    old frames laid out wrong.
  - A volume with the same settings as one built before comes back from the
    cache with no decoding. Undo and redo use this. A new Frame order reuses
    the frames of the volume it came from.

## Examples (the Time Cube folder)

Each node in them has a note.

- **Time cube: a video as a box of time**
  - Test clip → View, with the camera orbiting slowly.
  - A triangle LFO (0.5 ± 0.47, 14 s a round trip) sweeps the slice.
  - The soft look: Corner roundness 0.4, Edge softness 0.2, a faint lilac rim
    glow, no outline.
- **Time cube: soft pill**
  - After the soft boxes in product illustrations: a pill on white, seen flat
    (Flatten 1), the crisp frame on its face, pastel sides (Side tint 0.85,
    peach to mint), a pink rim glow and a faint shadow.
  - Flow mode with the frame at the front, so the face plays the video.
- **Time cube: highlighted frames loop**
  - Six frames twelve apart, outlined in amber and lifted out of the box.
  - A sawtooth LFO runs the slice through the clip; the highlighted frames ride
    along and wrap round, so they keep coming round.
- **Time cube: flow**
  - The frame stays near the front and the clip flows through the box past
    it, wrapping round. Frames lift as they pass the frame; four frames of the
    clip, outlined in blue, ride the flow.
- **Time cube: pulsing key** (a Play example)
  - On black, only the car's red shows, in four bands pulsing through time,
    with lightning flashes. The slice frame stays vivid.
  - Play panel: Key colour, Key hue shift (a slow LFO rocks it, inside the
    hue range so the car stays keyed), Key hue drift, Hue range, Pulse speed
    and width, Lightning. The camera looks across the car's path, so its red
    ribbon through time shows; it used to look along it, edge-on, and with the
    LFO turning the colour further than the hue range the key matched almost
    nothing: pulses and lightning had nothing to show.
- **Time cube: depth of field**
  - A close camera focused on the slice: as the slice sweeps, the focus
    follows it and the frames in front and behind go soft.
- **Time cube: long exposure**
  - Each of 64 frames is the brightest of six from its slot (Frames from:
    Brightest), so the car, the ball and the lamps leave trails; the frames are
    then sorted by brightness.
- **Time cube: isolate a colour**
  - The Key is a hue: red, Tolerance 0.07.
  - The red car leaves a solid red ribbon slanting through the box (Time
    stretch 2.2).
  - The rest of the street is a grey ghost: Others 0.7, Others grey 0.85.
- **Slit-scan from a time cube**
  - A Time Slice tilted 40° across X, wrapping in time.
  - A sawtooth LFO runs it through the clip every 5 s.
  - The car comes out stretched and the bouncing ball bent.

All of them use the built-in test clip. The repository has no sample video, and
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
  crosses it is solved exactly. The march **stops on it**: the stretch in front
  of the plane, then the slice frame, then the stretch behind it, so nothing
  about the slice depends on where the steps fall (a step that straddled the
  plane used to draw the solid side behind the frame's soft border a random
  part of a step deep: jagged, zig-zag borders).
- **Highlighted frames** are planes too: the march finds the next one along
  the ray (`tcCombNext`) and stops on it as well, drawing the frame there as a
  sheet. They used to be drawn a bit in every step that overlapped the frame's
  thickness, each at a different point, which hatched their bottoms ("||||")
  and dotted their outlines.
- **Sheet borders** (the slice frame, highlighted frames, their outlines) are a
  pixel soft on screen, not in the sheet's own plane: the ramp is stretched by
  how far the sheet is turned from the camera (`tcFootprint`, from the shape's
  gradient), worked out only near the border.
- **Where in a stretch to read:** each pixel reads at its own point
  (interleaved gradient noise), as a free flight through the stretch
  (`tcFreeFlight`): anywhere in a thin stretch, right at the start of a nearly
  solid one, so a solid face shows its surface, not a pixel or two inside it.
  The fixed-step banding becomes a fine, still grain.
- **Early out:** the march stops when alpha reaches 0.995.
- **Jitter** leaves a fine grain on hard keyed surfaces seen at a slant (the
  red ribbon): its surface is found to within a step.

**The shape.** The box is a rounded box with puffed faces, as a signed
distance (`tcShape`; `lib/timeCube/style.ts shapeDistance`). The rounding is
Corner roundness × the smallest half size. Bulge adds to each face's half size
in proportion to (1 − u²)(1 − v²) across it.

- **Entry and exit, exactly.** A rounded box seen from outside its bounds is
  met analytically (`tcRayRoundBoxIn`, after Inigo Quilez's rounded-box
  intersection: the bounding box, then a face, an edge cylinder or a corner
  sphere); the exit is the same test from beyond the box looking back. The
  march runs between the two. Sphere tracing used to find them, and ran out
  of its 32 steps on rays that skim a face: wedges and flat bevels cut out of
  the box, and a curved sheet across the tops of lifted frames. A bulging box
  (or a camera inside the bounds) is still sphere traced, 64 steps, shortened
  by 1 / (1 + 2 × bulge) because the distance overestimates.
- **md**, the least distance to the shape along the ray (minus how deep, when
  it goes in), drives the soft edge, the rim glow and the silhouette line. A
  miss finds it by golden-section search over the search box (the distance
  along a line to a convex shape has one minimum); a ray that goes in only
  shallowly (near the silhouette) refines it the same way between entry and
  exit. A deep ray needs no more.
- **Edge softness is coverage.** A ray that only grazes the shape covers
  little of its pixel: the march's result is scaled by
  smoothstep(−½ px, max(feather, px), −md). Near the silhouette that fades the
  box out over Edge softness; a pixel wide at 0, so the edge is anti-aliased.
  The slice frame's border fades over the same width, so the picture melts
  into the sides; the frame keeps at least its own coverage, so a box edge
  seen end-on no longer shaves its rounded corner flat.
- **Rim glow** mixes the rim colour in by strength × exp(−|md| / width):
  brightest on the silhouette, the same either side of it.
- **Lines** are a set number of pixels wide wherever they are: the silhouette
  line from |md|, the box edges as the distance from the ray to each of the
  twelve edge segments (through the middle of each rounded edge), divided by a
  pixel's width at that depth. Front edges are drawn over the box, back ones
  (behind the middle of the chord) under what the march left clear.
- **Shadow:** the ray meets a ground plane below the box; the shadow is a
  rounded rectangle the box's footprint, blurred by Shadow softness.
- **Flatten** spreads the rays' origins across the picture and closes up their
  directions; the plane through the box's middle keeps its size, so the box
  doesn't jump as it flattens.

**Highlights.** The highlighted frames are a comb in time: start + k × spacing
for k < Count (`tcComb`, `style.ts combDistance`), wrapping modulo the box's
length when looping. For each march step the shader takes the time span the
step covers (the slice's side function is linear along the ray), finds the
tooth nearest its middle and measures the overlap:

- the share of the step inside the tooth lifts Others back to full;
- the share of the tooth's thickness the step crosses composites the frame as
  a sheet of Opacity, read at the tooth's own time so it is crisp. The steps
  through one frame add up to one whole frame whatever the ray's angle, so a
  highlight never flickers or drops out between steps.

**Frame motion** is inverse mapping. Each sample asks which point of the still
frame lands on it: the bump b (a half cosine of the distance in time to the
slice or the nearest highlight, over Falloff) is known from the sample's time,
and the frame's move (turn, scale, then lift) is undone (`tcWarp`,
`style.ts warpUv`). The shape is tested at the undone point too, so a lifted
frame carries its rounded border with it. The march runs through the box grown
by how far frames can reach (`motionReach`), with the step length the same
share of the bigger box. Frames moved out of the box are not softened by Edge
softness (the coverage belongs to the box).

**Flow.** The clip time read at box time z is fract(z + τ − Frame position),
with τ = Flow time + Flow speed × seconds (`style.ts flowTime`). At the frame
the clip plays; a frame of the clip moves toward the front as τ grows and
comes round at the back. Before / After are measured from the frame. In Flow
the comb of highlights is shifted by the same amount, so highlighted frames
belong to the clip and ride the flow; Send through sends the frame at the slice
(plus Start).

**Key pulse and lightning.** The keyed opacity is multiplied by a visibility:
the pulse is a train of bands, 1 − smoothstep(w(1 − softness), w, |fract(x ×
count − phase) − ½| × 2), with x the box time (mirrored, or the distance from
the slice, for the other directions) and the phase Pulse phase + speed ×
seconds (a triangle for Back and forth). Lightning is two bursts at a time, one
for the current slot of a clock at Flashes a second and one for the slot
before: each strikes (four slots in five) at a hashed moment and place, with a
hashed width, and dies away as e^(−10 × age in seconds) (about a fifth of a
second, whatever the rate; it used to die in an eighth of a slot, 50 ms at 2.5
a second), flickering. A flash raises what is kept toward white and lights the
rest of its stretch (its opacity at least the flash's). They are
worked out once a pixel, before the march. The key colour is turned round the
grey axis by Key hue shift + drift × seconds before matching.

**Depth of field** blurs what the march reads, not the finished picture (a
fragment can't read its neighbours). The blur radius at distance t along the
ray is Blur × 0.08 × Box size × |t − F| / F, capped at Max blur pixels, with F
the focus distance along the ray (to the box's middle, or to the slice's
middle, times Focus). Each sample reads the volume four times round the point
(a rotated square, a soft disc); the soft edge widens to the blur at the
silhouette's depth, and lines widen and fade with it. Highlight sheets are read
once (sharp).

**Frames from and Frame order** are done while building
(`lib/timeCube/order.ts`). Combining draws each sub-frame into a tile-sized
canvas, reads its pixels and combines them per channel (`combineFrames`).
Per-frame numbers read every fifth pixel of a tile (`frameStat`); motion is the
mean change in luma from the frames either side (`frameMotion`). A new order
copies tiles from the time-ordered frames into a new atlas; volumes that share
those frames share one canvas of them, freed when the last one goes.

**Orientation.** The app's cameras (March Camera) put screen right at −x when
looking down −z. So the frame's u runs toward −x, and a frame reads the right
way round from the side time starts on: +z for depth, +x for width, +y for
height.

## Performance

These timings were measured in headless Chrome (ANGLE Metal) on the Apple
M-series GPU of the machine that built this. They are GPU time from
`EXT_disjoint_timer_query_webgl2`, rendering the compiled shader at
**1920 × 1080**, with the default volume, **256 × 144 × 128**. The GPU's clock
moves a lot between runs, so every row is the fastest of five runs taken in
turns with main's shader, in one session. Main's numbers are the same graphs
before this change.

| Graph | This | Main |
|---|---|---|
| View, Good, the default look (soft, rim), slice at 0.5 | 0.71 | 0.51 (old look, same camera) |
| View, Good, the old look (sharp, no rim, old camera) | 0.83 | 0.45 |
| View, Good, camera close (the box fills the frame) | 1.57 | 1.07 |
| View, box edges outline | 1.14 | – |
| Soft pill (Flow, side tint, shadow, flattened) | 0.24 | – |
| Highlights and motion on, Good, no lift | 1.15 | – |
| Highlighted frames loop (Best, 6 highlights, lift) | 3.26 | – |
| Flow (highlights, lift) | 1.46 | – |
| Isolate a colour (Best, key) | 2.08 | 1.38 |
| Pulsing key (Best, key, pulse, lightning) | 2.52 | – |
| Depth of field example (close, Good, focus on the slice) | 2.48 | – |
| The same, Depth of field off | 1.66 | – |

What costs what:

- The soft shape costs about 0.2 to 0.5 ms at 1080p: the sphere traces in and
  out, the golden-section search near the silhouette, the coverage and the rim.
- Highlights, Frame motion, Frame effects and Depth of field cost nothing when
  off (they are switched out of the code). On, highlights add a comb test each
  step and a crisp read where a step crosses one; motion adds a warp and a
  shape test each step, and a bigger box to march (Best quality, which thin
  lifted frames want, doubles that); depth of field reads the volume once a
  thin stretch and up to 32 times (8 with Fast) where it is nearly solid.

Artifact fixes (exact entry and exit, stopping on the slice and highlight
planes, free-flight reads, the smooth blur), measured the same way but by wall
clock over 60 offline frames at 1920 × 1080 (best of five, in turns with
main's build, in one session; headless WebKit, then headless Chrome), ms:

| Example | WebKit main | WebKit this | Chrome main | Chrome this |
|---|---|---|---|---|
| Time cube: a video as a box of time | 1.05 | 1.13 | 0.67 | 0.75 |
| Soft pill | 1.37 | 0.85 | 0.57 | 0.63 |
| Highlighted frames loop | 4.02 | 3.90 | 3.93 | 3.84 |
| Flow | 2.37 | 2.70 | 1.84 | 2.17 |
| Pulsing key (its camera and box changed too) | 3.15 | 2.92 | 3.09 | 2.94 |
| Depth of field (Smooth; the blur now shows) | 3.43 | 4.02 | 3.39 | 3.91 |
| Long exposure | 0.87 | 0.90 | 0.83 | 0.89 |
| Isolate a colour | 2.63 | 2.43 | 2.61 | 2.38 |
| Slit-scan | 0.50 | 0.50 | 0.48 | 0.46 |

Building a volume:

- **Test clip:** about 12 ms for 128 frames; Frames from multiplies it by
  Sub-frames (still well under a second).
- **A video:** about 26 ms a frame by seeking, times Sub-frames when combining.
  A 3 s, 640 × 360 VP8 WebM took 3.3 s for 128 frames. Files with keyframes far
  apart decode more slowly.
- **A new Frame order:** no decoding; one atlas copy (a few milliseconds) and,
  for Sort, the per-frame numbers once (about 0.1 s for 128 frames).
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
- **Shape, glow and lines follow the box, not moved frames.** The soft edge,
  the rim glow, the silhouette line, the box edges and the shadow are worked
  out for the box as it stands. Frames lifted out of it have hard, step-sized
  edges.
- **Big lifts need more steps.** A lifted frame is as thin as Thickness or
  Falloff makes it; with Good quality a very thin one can break up. Use Best,
  a wider Falloff, or a smaller lift.
- **Thin keyed surfaces** seen at a slant show a fine grain (the march's
  jitter).
- **Depth of field** blurs the frames as they are read, and the box's edge: it
  doesn't blur the rim glow, the shadow or the background, and a keyed View's
  frames stay sharp (only its edge softens).
- **Frames from** reads Sub-frames times as many frames: for a long video at
  16 sub-frames that is minutes. The card says how long.
- **Not done:** an arbitrary shader graph per frame (each frame through its own
  chain) is future work; so is animating the frame order on the GPU (Frame
  Stack's Shuffle does that for cards).
- **A key matches colours, not objects.** The red car's dark windows and
  wheels don't match red, so its ribbon has holes where you see through them.

## Code

| Part | Where |
|---|---|
| Planning, caps, the transfer function, slice and box maths | `src/lib/timeCube/plan.ts` |
| The View's look: shape, coverage, rim, highlights, motion, flow, pulse, lightning, blur (the GLSL's twin) | `src/lib/timeCube/style.ts` |
| Frames from and Frame order: combining, per-frame numbers, sorting, shuffling | `src/lib/timeCube/order.ts` |
| Decoding frames, the test clip | `src/lib/timeCube/frames.ts` |
| Building, caching and binding volumes | `src/lib/timeCube/volumes.ts` (synced from `ShaderCanvas`) |
| Adding a View or Slice | `src/lib/timeCube/autoWire.ts` |
| The nodes and their GLSL | `src/nodes/definitions/timeCube.ts` |
| The card | `src/components/timeCube/TimeCubeCardBody.tsx` |
| The march's exact parts: ray and rounded box, the next highlighted frame, where in a stretch to read | `src/lib/timeCube/march.ts` |
| The key's card line and swatches | `src/lib/timeCube/keyInfo.ts`, `src/components/timeCube/TimeCubeViewKeyInfo.tsx` |
| 16-bit atlases | `src/lib/timeCube/deep.ts` |
| Examples | `src/store/timeCubeExamples.ts` (**Time Cube** folder) |
| Sampler registration | `compiler/shaderAssembler.ts` (as Texture Input's) |
| Web export: no mipmaps | `play/exportHtml.ts`, `play/runtime/play-runtime.js` (`flat`) |

The tests are in `src/lib/timeCube/__tests__/timeCube.test.ts`,
`timeCubeStyle.test.ts`, `timeCubeMarch.test.ts` and `timeCubeKeyDeep.test.ts`.
They cover:

- the exact ray–rounded-box test against a fine walk along random rays
  (grazing ones too), enter and exit, the next highlighted frame (fixed and
  looping, none skipped), the free-flight read, the default blur's size, the
  blur's reads, a lightning flash lasting several frames, and the view
  stopping on the slice and highlight planes;
- the key's share of pixels and main colours, the Animate switch (off leaves
  its code out; old saves that animate count as on), and 16-bit atlases
  (unrounded averages, twice the memory, the half-float rows, reordering);

- frame-stack planning: counts, spacing, caps and memory, tile rounding, and
  the tile ↔ atlas mapping;
- the transfer function: opacity over a length, the hard surface at 1, before
  and after, Dark is clear, the key modes;
- the slice plane and box mapping;
- compiling: one sampler per Time Cube, shared helpers, the layout defines,
  every slider live, a March Camera wired in, an unwired view;
- adding a View or Slice;
- Library use counts;
- the rounded box and bulge, coverage and the rim, the highlight comb (modular
  wrap, crossings that add up to one frame), the motion bump and its inverse
  mapping, the flow wrap, pulse bands and lightning (deterministic), the blur
  radius and the per-frame effects;
- frame order (reverse, seeded shuffle, stable sort and invert), combining
  (average, brightest, darkest, motion, median), sub-frame times, per-frame
  numbers, and the default volume keys staying as they were;
- every new slider live, switched-off features left out of the code, Flow time
  taking a wire, the pulsing key's Play panel.

`compiler/__tests__/goldenShaders.test.ts` leaves out the Time Cube folder.
Every other graph compiles byte for byte as before.
