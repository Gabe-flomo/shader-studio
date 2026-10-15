# Optical Flow

**Optical Flow** (Texture tools) finds how each part of a moving picture moved since the last frame: a direction
and distance at every pixel. It is TouchDesigner's Optical Flow TOP.

Wire a Video Input (or the camera), Baked or a Pass into **Texture**.

## Outputs

| Output | What it is |
|---|---|
| Flow | How far this part of the picture moved since the last frame, in picture units (times Strength). |
| Speed | The length of Flow. |
| View | The flow as colour: hue is the direction, brightness the speed (times View gain). |
| Flow texture | The flow as a texture (red, green: the flow; blue: its speed), at Resolution. |

## Uses

- **Trails that follow the motion:** Flow into Feedback (texture)'s Flow (example 18).
- **Bend a picture along the movement:** Flow into Displace or a UV.
- **Light up what moves:** Speed into a Mask, a glow, an Envelope's gate.
- **Push particles or agents** along the motion.

## Settings

- **Resolution:** ½, ¼ (default) or ⅛ of the picture. Smaller is smoother and cheaper; it also follows faster motion.
- **Window:** 3 × 3, 5 × 5 (default) or 7 × 7 pixels round each one. Bigger is steadier and blurrier.
- **Strength:** scales Flow. **Smoothing:** blends with the last frame's flow. **Min speed:** slower is none
  (hides camera noise). **View gain:** View's brightness. All four are live sliders and Play controls.

## How it works

`compiler/opticalFlowExpand.ts` opens the node into two Passes at Resolution (half float):

1. a Pass of the source (its Previous is last frame);
2. the flow step's Pass: Lucas–Kanade over the Window. The brightness slopes (from both frames) and its change in
   time give, for each window, the one motion that best explains the change (−A⁻¹b, regularised so flat areas stay
   still), in picture units, times Strength, below Min speed set to 0, blended with last frame's flow by Smoothing.

The node itself becomes the read of the flow Pass. It uses two of the graph's 8 Pass slots.

It follows motion of up to about a pixel or two a frame at its Resolution: at ¼ on a 1080p preview that is fast
movement at 60 fps. At low frame rates (a busy or hidden preview) big jumps break into speckle; lower Resolution
helps.

## Limits (v1)

- Inside a group it gives no motion (open the group, or keep it at the top level).
- One scale (no image pyramid): very fast motion needs a smaller Resolution.

Example: Texture tools 18 · Optical Flow: trails that follow the motion. Code: `src/nodes/definitions/opticalFlow.ts`,
`src/compiler/opticalFlowExpand.ts`. Tests: `src/compiler/__tests__/opticalFlow.test.ts`.
