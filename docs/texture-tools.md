# Texture tools

"The number you read is rarely the number you want." A texture is four numbers per place, and
turning one read into something useful (a mask, a direction, an outline, a fading trail) used to
take an Expression Block. The **Texture tools** are purpose-named nodes for the common moves in
the passes guide's sections 1.8 ("Getting information out of a texture") and 1.9 ("Shaping what
comes out"). They sit in the node browser under **Color & Post → Texture tools**, next to Passes.

Code: `src/nodes/definitions/textureTools.ts` (nodes and the JS mirror of their maths),
`src/nodes/recipes/textureRecipes.ts` (starter offers), `src/store/textureToolExamples.ts`
(the Texture tools example folder), `src/compiler/__tests__/textureTools.test.ts`.

## What they read

Every node takes a **Texture** input and an optional **UV** (picture coordinates: leave it empty
for this pixel, wire a warp to bend the read). Any texture works:

| Source | Output |
|---|---|
| Pass | Texture, Previous |
| Texture Input, Video Input | Texture |
| Baked | Texture |
| Motion (texture) | Texture |
| Agents | Trail field's Image, Draw agents' Image |

**Mask** and **Levels** also take a plain **Value** (float) or **Color** (vec3) when Texture is not
wired, so the same node shapes a Jump flood distance, an Edges strength or any number.

## The nodes

| Node | Modes | Outputs | Like |
|---|---|---|---|
| **Mask (texture)** | Source: Brightness, Red, Green, Blue, Alpha, Saturation, Hue range (hue, range), Colour key (key colour, tolerance, softness). Threshold: Off, Hard, Soft (level, width). Invert | Mask (float), Color, Source (the number before the threshold), Seed (a jump flood's start) | TouchDesigner Threshold / Chroma Key TOP, Nuke Keyer, AE Linear Color Key |
| **Levels (texture)** | Channel: All, Brightness, R, G, B, A. Gain, Offset, In black / white, Gamma, Roll-off, Out black / white, Clamp. Signed: Off, Unpack (0.5 = zero), Pack (−1…1 → 0…1) | Value, Color | TD Level / Math TOP, Nuke Grade, AE Levels |
| **Flow (texture)** | From: Brightness, a channel, Stored direction (red, green), Stored 8-bit. Direction: Uphill, Downhill, Along the contours (and reversed). Length: Unit, Raw. Strength, Reach | Flow (vec2, picture units), Steepness, UV (this pixel moved along Flow) | TD Slope TOP, Nuke VectorGenerator (from slopes) |
| **Neighbours (texture)** | Average, Difference from average (Laplacian), Max (grow, dilate), Min (shrink, erode), Range (max − min). Size 3 / 5 / 7 / 9, Spacing, Strength | Color, Value, Alpha | Nuke Erode / Dilate, AE Minimax, TD Convolve |
| **Change (texture)** | Measure: Brightness, Colour. Amount, Threshold, Softness | Motion (mask), Change (signed), Direction (normal flow), Color | Frame difference, Nuke Difference |
| **Outline (distance)** | Draw: Outline (width), Glow (reach), Rings (spacing, thickness, fade, speed), Inside (grown shape), Outside. Offset, Softness, Tint. Takes Distance (Jump flood, any SDF or float), or a texture holding one in red | Mask, Light (tint × mask) | AE Stroke / Offset Path, a distance-field iso line |
| **Fade (feedback)** | Tail (seconds to 1%), Clean (per second), Tint (per-channel tail), Fresh paint: Add, Brighter of the two, Over | Color, Alpha | TD Feedback TOP + Level, AE Echo decay |
| **Read (texture)** | Zoom, Turn, Move X / Y, Pivot X / Y, Flow (input) and Flow amount, Edges: As the texture, Clamp, Repeat, Mirror | Color, Alpha, UV (the bent place) | TD Transform TOP, Nuke Transform / STMap |

Sample (texture) is unchanged: Read is the version with the bend built in.

## Shaping what comes out (guide 1.9)

| Move | Formula | Node and setting |
|---|---|---|
| Gain and offset | v × a + b | Levels: **Gain**, **Offset** |
| Hard threshold | step(t, v) | Mask: Threshold **Hard**, **Level** |
| Soft threshold | smoothstep(t, t + w, v) | Mask: Threshold **Soft**, **Level**, **Width** |
| Curve | pow(v, g) | Levels: **Gamma** (below 1 lifts faint values) |
| Roll-off | x / (1 + x × k) | Levels: **Roll-off** |
| Decay | max(old × d − e, 0) | Fade: **Tail** sets d per frame from seconds, **Clean** is e per second |
| Colour from a number | Palette, mix(a, b, v) | Palette, Color Ramp or Mix: the first quick adds on a Mask, Levels, Neighbours, Change or Outline number |
| Bend the read UV | UV → math → UV | Read: **Zoom**, **Turn**, **Move**, **Pivot**, **Flow**; or Flow's **UV** output into any UV |
| Layer | Add Colors, Blend Modes, Mix | The first quick adds on Outline's **Light** and Glow (texture)'s **Glow** |
| Packing signed values | v × 0.5 + 0.5, s × 2 − 1 | Levels: Signed **Pack** / **Unpack**; Flow: From **Stored 8-bit** |

And from 1.8: channels and brightness are Mask's and Levels' Source / Channel; the gradient is
Flow; the neighbourhood is Neighbours; the time difference is Change; the distance is Jump flood
then Outline (distance).

## Live uniforms and recompiles

Every float and colour setting is a live uniform (a drag is a uniform write; Play can map it).
The selects and switches (Source, Threshold, Invert, Channel, Signed, Clamp, Mode, Direction,
Length, Size, Measure, Draw, Fresh paint, Edges) shape the code and recompile when changed.
Neighbours' **Size** is the loop's count, so it is a compile-time setting and is listed in the
Performance panel's Compiles note.

## Performance

| Node | Texture reads per pixel |
|---|---|
| Mask, Levels, Read, Fade, Outline (texture) | 1 |
| Flow | 4 (from a slope), 1 (stored direction) |
| Change | 2, plus 4 for Direction (the GPU's compiler drops unused reads when Direction isn't wired) |
| Neighbours | 1 + 9 / 21 / 37 / 69 for Size 3 / 5 / 7 / 9 (a disc inside the square) |

- **Samplers.** None of the tools declares a sampler: each reads the one wired in. The program's
  count (`MAX_SAMPLERS`, 16, checked in `compiler/passGraph.ts`) is the same with or without them;
  a test sums all eight on one Pass and checks the count is unchanged.
- **Neighbours' loop** is one `for` with a literal bound (Size²), with the square's corners
  skipped, so the Performance panel's Loops row shows "up to 9× / 25× / 49× / 81×" and its
  Texture reads row counts it. Wider reach costs nothing extra through **Spacing** (gaps appear
  on fine detail); for wide, smooth reach, set the Pass upstream to ½.
- **Change's Direction** is a cheap normal flow (−dI/dt · ∇I / |∇I|²): it only sees motion across
  edges, never along them.

## Fade's frame length

Fade's **Tail** is in seconds, the same at any frame rate: each frame keeps
d = 0.01^(dt / Tail) and takes **Clean** × dt off. dt is the uniform `u_frameDt`, declared only by
Fade, and set by every host: the Studio preview (the clock's step while playing), offline
renders (the render's 1 / fps) and exported web pages (`play-runtime.js`). A host that doesn't
set it reads 0, which Fade treats as 1/60 s.

## Change on a video

A Pass has a Previous (last frame) and Change compares Texture with it. A Video Input, Texture
Input or Baked has no previous frame of its own, so draw it into a Pass first and wire that
Pass's Texture and Previous. The starter offer on Change (**Motion in a video**) sets that up.

## Around the nodes

- **Quick adds** (`components/NodeGraph/quickAdds.ts`). A texture output offers Mask, Levels and
  Flow. A texture input offers Pass, Texture Input and Video Input. A number from Mask, Levels,
  Neighbours, Change or Outline offers Palette, Color Ramp and Mix. Jump flood's Distance offers
  Outline (distance) first. Outline's Light and Glow (texture)'s Glow offer Add Colors and Blend
  Modes. Quick adds now take the socket's node type into account (`nodeType`).
- **Switch to.** The tools share a category, so each can be switched to any other whose sockets
  fit (Mask ↔ Levels ↔ Neighbours…), wires and settings kept.
- **Starter offers** (`nodes/recipes/textureRecipes.ts`).
  - Jump flood: Outline the picture, Glow round it, Rings round it. Each builds the whole
    repeated-Pass flood from what the Output shows.
  - Change: Motion in a video, Motion in the picture.
  - Fade: Trails, Drifting trails (with Read).
- **Inline curves** (`components/NodeGraph/vizGeneric.tsx`).
  - Mask: its threshold.
  - Levels: its transfer curve.
  - Outline (distance): the mask over distance.
  - Fade: each channel's fade over three seconds.
  - Read: a checker seen through its bend.
  - The card's picture thumbnail can't read textures, as for the Passes nodes, so Flow,
    Neighbours and Change show it black.
- **Hints.** The texture outputs of Pass, Texture Input, Video Input, Baked, Motion (texture),
  Trail field and Draw agents name the tools.

## Examples (Texture tools folder)

1. **Glowing outline from a video.** Video → Mask → Pass → Neighbours (Range) → Pass → Glow (texture), over the video dimmed with Levels.
2. **Motion trails with Fade.** A drifting picture in a Pass → Change → Fade, read through Read (zoom and swirl) → trails Pass → Levels (roll-off).
3. **A slime trail bends a picture.** The Agents slime mold's Trail image → Flow (along the contours) → a photo's UV.
4. **Colour key on a video.** Video → Mask (Colour key) → Mix with a drifting backdrop.
5. **Reaction-diffusion, shaped and coloured.** Neighbours (Difference from average) as the Laplacian; Levels (Channel: Green) → Stops Palette.
6. **Grow and shrink a mask.** Neighbours Max and Min on a photo → Mask on each Value → two Mix nodes.
7. **Outline and rings from a jump flood.** Mask's Seed → repeated Pass → Jump flood → two Outline (distance) nodes.

Examples 1 and 4 are black until a video (or the camera) is chosen on their Video Input. Every
node has a note; the Expression Blocks left (the Gray-Scott step, the flood's reach and start)
explain each line. The bundled examples that already had Expression Blocks for these moves
(Passes 1 to 9) are unchanged: the guide walks through those blocks line by line.

## Limits

- **No Coverage / Average reading.** No GPU reduction exists in the graph compiler, and a
  per-pixel average of a whole texture costs too much to run in every pixel.
- **No previous frame for a video.** Change needs a Pass for Video Input, Texture Input and
  Baked (see above).
- **Change's Direction is rough.** It is normal flow, not real optical flow.
- **Distance only from Jump flood.** Outline (distance) needs a distance. A Mask has none until a
  jump flood makes one, and the flood still needs its two small Expression Blocks (the reach per
  round, and seeds on round 0).
