# Advect

**Texture tools → Advect.** Smoke, ink in water and marbled paper in one
node. In TouchDesigner you build these by feeding a picture back into
itself every frame through a Displace; Advect is that loop, wired for you.

## What it does

Advect keeps a picture of its own from one frame to the next. Every frame:

1. **Move.** Each pixel is carried along **Flow** by **Speed** pixels. (It
   looks back along the flow to where its paint was a frame ago and takes
   it from there, so nothing tears or leaves holes.)
2. **Soften and fade.** The moved picture is blurred a touch (**Soften**)
   and dimmed (**Fade**).
3. **Paint in.** Fresh **Source** is painted in by **Inject**, only where
   the **Inject mask** is (everywhere when it is empty), combined by
   **Mode**.

With nothing wired at all it still does something: a drifting spot of
colour is painted in and the built-in curl carries it off.

## Inputs

- **Source** (texture): the picture painted in each frame. Any texture:
  Texture Input, Video Input, the camera, a Pass.
- **Colour**: paint this colour instead (a shape, Voronoi's cell colour, a
  Palette). It wins over Source.
- **Flow** (vec2): which way each pixel moves, and how far (a Flow 1 long
  moves Speed pixels). Wire Noise's Slope, a Vector Field, Optical Flow, or
  Flow (texture). Empty: a gentle built-in curl, swirls that never pile up.
- **Inject mask** (number): where the Source goes in, 0 to 1. A circle, a
  Brush, a noise, a timer.

## Settings

| Setting | What it does |
|---|---|
| **Speed** | Pixels the picture moves along Flow each frame (at 60 frames a second; it moves the same distance per second at any frame rate). Negative runs it backwards. |
| **Swirl** | Turns the Flow by this many degrees first. 90 turns a slope (uphill) into a flow along its contours, which curls into swirls. On a whirlpool, a little Swirl pulls everything in or pushes it out. |
| **Built-in flow size** | How small the built-in curl's swirls are. Only used while Flow is empty. |
| **Inject** | How much Source goes in each frame. 0: nothing new, only what is already there keeps moving. |
| **Mode** | **Mix** paints over (ink in water), **Add** piles up (smoke, glow), **Max** keeps the brighter (trails that never wash out). |
| **Fade** | How quickly the old picture fades, per second. 0 never fades; 1 loses about two thirds each second. |
| **Soften** | A tiny blur each frame, so smoke and ink spread and their edges go soft. |
| **Reset** | A button (and a trigger for Play): clears the picture. |
| **Resolution** | Size of the kept picture: 1, ½ or ¼ of the output. Smaller is cheaper and softer. |
| **Edges** | What paint coming in from past the edge is: Clamp, Repeat (wraps round), Mirror. |

Every slider moves live: dragging one never recompiles, and each can be a
Play control or be wired from outside (right-click → Control from outside).
Mode, Resolution and Edges recompile.

## Outputs

- **Colour**: the moving picture at this pixel.
- **Density**: how much paint is here (0 to 1). It moves and fades with the
  colour, so it is a ready-made mask or alpha.
- **Texture**: the moving picture as a texture, for any texture node
  (Levels, Glow, Flow (texture), another Advect).

## Frame to frame

Advect runs on the same machinery as **Feedback (texture)**: the compiler
opens it into a step and a Pass of its own (`compiler/feedbackExpand.ts`),
so its picture is an ordinary Pass buffer (half float; colour, and density
in alpha). That means:

- **↺** (start over) clears it, as it clears every Pass.
- **Exports, recordings and Play** run it as they run every Pass, the same
  way as Feedback (texture): nothing about it is special to the preview.
- **Loops are allowed.** Its own Texture can come back into its Flow (Flow
  (texture) along its own contours, for smoke that curls round itself): a
  wire back into it reads the picture as it was a frame ago.
- It counts as one of the graph's Passes.
- It **can't be part of a field chain** (a shape wired into Grid Pattern's
  Shape, say): it keeps last frame's picture, which is not a function of
  position. Wire it into an ordinary socket instead.
- **Bypassed**, it passes the Source through with nothing kept.

## Examples (the Advect folder)

- **Ink drops in water**: timed drops of colour (and yours, press and
  drag) carried off by the built-in curl.
- **Smoke rising from a candle**: Add mode, an upward Flow plus a Noise
  wobble, Fade and Soften.
- **Marbled paper**: stripes painted in for the first moment only, then
  combed by a Noise slope turned 90° by Swirl. ↺ lays fresh stripes.
- **A photo melting**: the built-in photo as Source, a small Inject pulling
  it back against a downward flow.
- **Paint that follows the mouse**: a Brush as the Inject mask, Max mode.
- **Voronoi cells dragged by a whirlpool**: a Vector Field in Vortex mode
  as Flow.
