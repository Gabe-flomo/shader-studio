# Depth Mix

A picture with depth and a scene, put together. The Depth node ([depth-node.md](depth-node.md)) says how near each
part of a picture is; Depth Mix uses that to make a scene (2D shapes, a glow, a pattern, anything with a colour)
behave as if it were in the picture. It is in the node browser under Texture tools.

The 2D Scene Builder builds it for you (its **Depth** tab, [scene-builder-2d.md](scene-builder-2d.md#picture-with-depth)),
and so does the 3D Scene Builder for 3D scenes ([scene-builder-3d.md](scene-builder-3d.md#a-picture-with-depth)).

## Wiring

| Input | What to wire |
|---|---|
| Picture | The picture's colour: a Texture node's Color, or a Sample (texture) |
| Depth | The Depth node's Depth (Near is: Bright, 1 nearest) |
| Scene | The scene's colour. Unwired: black, when you only want the outputs |
| Scene mask | Where the scene has something (1) and is empty (0), for *With the picture: Over*. Unwired: everywhere |
| UV | The point *Depth UV* moves. Unwired: this pixel |
| Value | A size to scale by depth (a radius). *Sized value* is Value × Scale. Unwired: 1 |
| Phase | Added to the gradient's Phase: wire Time to make the colours flow along depth |
| Direction | (on demand, from *Direction°*) Which way *Shift* moves near things: wire the Mouse to look around |

Every slider is also a socket of its own name ([wireable-sliders.md](wireable-sliders.md)): right-click it → Control from outside, and wire Time, an LFO or any number in. A mode's own settings (Fog, Light, Mix) and the gradient's show once that mode or a gradient is picked.

## Outputs

| Output | What it is |
|---|---|
| Color | The scene and the picture together, by the Mode |
| Shaped depth | The depth after *Depth range* and *Curve*: 0 far, 1 near |
| Scale | *Size far* … *Size near* by depth: multiply a radius by it, or wire it into a Transform's Grow |
| Sized value | Value × Scale |
| Depth UV | UV moved by depth: wire it into the shapes' position |
| Near mask | 1 where the picture is nearer than *Scene sits at* |
| Scene shows | How much of the scene shows here (Occlude: in front; Fog: not fogged; otherwise the Scene mask) |
| Gradient | The gradient over depth at this pixel (black when Gradient is Off) |

## Modes

Every mode first shapes the depth: **Far end** and **Near end** say which nearness counts as 0 and 1 (raise Far end
to flatten the background), and **Curve** bends it (above 1 only the nearest things count).

- **Depth → size.** Shapes grow on near things and shrink on far ones. Wire *Scale* into a shape's size (or a radius
  through *Value* → *Sized value*). The radius changes per pixel, so a circle stays a circle where the depth is even
  and bends round the picture's edges where it isn't: the circles look as if they sit on the things in the picture.
  *Size far* and *Size near* set how big shapes are at each end. Color is the scene over the picture.
- **Depth → space.** The point the shapes are measured from moves by depth. Wire *Depth UV* into the shapes.
  **Move by**: *Shift* slides near and far apart along *Direction°* (parallax), *Zoom* pushes near things out from the
  centre, *Turn* turns the point round the centre. Small *Amount* is parallax; large *Amount* drags each glow across
  everything at its depth, so it beams through the picture. *Focus* is the depth that stays still.
- **Occlude.** The scene sits at one depth (**Scene sits at**, 0 far … 1 near). Wherever the picture is nearer, the
  picture hides it; **Softness** fades the edge (depth is soft round hair). Far parts show the scene; there is no haze.
- **Fog.** The other way round: near things stay clear and the scene fades out where the picture is far (**Density**:
  1 gone on the farthest things), while **Haze** (0.6 by default) lays the **Fog colour** over the picture's far part,
  so the scene sits in the picture's air.
- **Light by depth.** The scene is coloured light falling on the picture: `picture × (Own light + Strength × scene ×
  depth)`, most on near things, so the picture keeps its own colours. Where that runs past white the colour is scaled
  down as a whole (not clipped channel by channel, which bleached it grey-white). The scene itself goes on top by
  Screen × **Glow** (0.35 by default: keep it low so the scene reads as light, not as a layer). Lower *Own light* for a
  night relight.
- **Mix.** The scene and the picture blended by depth: **Near shows** the picture (or the scene), far the other;
  **Amount** says how far the blend goes.

**With the picture** (Size, Space, Occlude and Fog) says how the scene goes over the picture:
*Add (light)* adds it (glows brighten the photo; the default), *Screen* the same but never past white,
*Over (by Scene mask)* paints it where the Scene mask is 1, and *Tint by the picture* gives the scene the picture's
colours. **Picture** is how bright the picture shows underneath (0: the scene alone).

## Gradient over depth

A palette laid along depth: the colour shifts as the picture gets deeper. **Gradient** picks one of the Palette
node's cosine palettes (Off by default). **On**: the scene, the picture or both. **How**: *Multiply* tints,
*Colorize* keeps only brightness and takes the gradient's colour, *Add* lays it on as light. **Cycles** is how many
times the palette repeats from far to near; **Phase** shifts it, and the **Phase** socket adds to it: wire Time (or
Time × a speed) and the colours flow through the picture's depth.

## Why two in the 2D Scene Builder

A scene that reads *Depth UV* (or *Scale*) and is wired back into the same node's *Scene* would be a loop. So the
builder makes two: **Depth Mix for the shapes** (no scene; its Scale and Depth UV feed the shapes) and **Depth Mix**
(the scene and the picture together, by the look). Each slider is live on the node it belongs to.

## Seeing the depth

The 2D Scene Builder's **Depth** tab (its **Preview** card) and the 3D Scene Builder's **Picture with depth** card
have a preview switch: **Result | Picture | Depth | Shaped depth**. It changes only the builder's own preview (the
2D Preview, the 3D viewport); Build always makes the result. A chip on the preview names the view; click it (or
leave the tab) to go back to the result.

- **Picture:** the picture alone, as it covers the frame.
- **Depth:** the raw depth from the Depth node, greyscale (white near, black far) or, with **Heat map**, red near
  and blue far.
- **Shaped depth:** the depth after the **Depth range** and **Curve** (2D: Depth Mix's Shaped depth output, what
  every look and effect reads); in 3D, the picture's distance through **Nearest** and **Farthest** (near bright).
- When they are on (2D), the depth-only effects too: **Gradient** (the gradient over depth alone), **Size** (Size by
  depth's factor, Size far dark … Size near bright) and **Space** (Space by depth's shift: grey is none, the colour
  is the direction).

Each view is the graph the preview already compiles, with one Expression Block in front of its Output, so it reads
the same Depth node and the same depth texture as the build (generated, live on the canvas, or the brightness
stand-in) and follows a slider while it moves. **Side by side** adds a strip of every view, small; click one to show
it big. Code: `src/builders/depthPreview.ts` (`withDepthView`), `src/components/builders/DepthViewSwitch.tsx`.

## Examples

**2D: Scene Builder** folder, on the "ridges at dusk" still (its depth needs the model: a one-time download on
the Depth card, kept by the browser):
- **Circles sized by depth:** a field of glowing circles (a Tile space) whose radius follows the depth, tinted by the
  picture. The user's first look: depth into the circle's radius, then mixed with the picture's colour.
- **Glow beaming through depth:** a ring of glowing rings whose point is shifted by depth, so the glow beams through
  the picture, with a sunset gradient flowing along depth. The user's second look: depth into the circle's UV.

Both are also 2D templates (**Templates → Circles sized by depth / Glow beaming through depth**); from a template
the picture is an empty Texture node until you drop one on it.

## Code and tests

- Node: `src/nodes/definitions/depthMix.ts` (the GLSL, and the same maths in plain JS: `depthMixShape`,
  `depthMixScale`, `depthMixUv`, `depthMixFront`, `depthMixGradient`).
- 2D builder: `src/sceneBuilder2d/depth.ts` (the spec, the recipe clause), `build.ts` (`emitDepthPicture`,
  `emitDepthMix`), `src/components/sceneBuilder2d/DepthTab.tsx`.
- Generate depth: `src/builders/depthPicture.ts` (runs the model once, `bakeImageDepth` in `src/lib/depth/bake.ts`),
  `src/components/builders/DepthGenerateRow.tsx`; the builders' previews show its depth through
  `components/builders/previewTextures.ts` (`registerPreviewDepth`).
- Tests: `src/nodes/definitions/__tests__/depthMix.test.ts` (every mode, combine, space style and gradient
  compiles; the maths on a synthetic depth; Light, Fog and Occlude's colour run on the CPU on a synthetic depth), `src/sceneBuilder2d/__tests__/depth.test.ts` (every look, size and
  space, the recipe, Build round-trip, the bake, templates and examples), `src/sceneBuilder/__tests__/depthPicture.test.ts`.
  No test downloads the model.
