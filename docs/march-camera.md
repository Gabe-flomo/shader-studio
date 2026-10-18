# March Camera

The camera for ray-marched scenes: it orbits a target (Cam Dist, Angle, Elevation, Rot Speed), looks through a lens
(FOV), and hands every pixel a ray (Ray Origin, Ray Dir) to a March Loop Group or GI Lit March Group. Its axes
(Forward, Right, Up) are outputs too. Perspective and Flatten are in docs/camera-projections.md and
docs/curved-space.md.

## Depth of field (Lens)

**Aperture** is the lens's radius (0 = a pinhole, everything sharp) and **Focal Dist** the distance that stays
sharp. **Lens** says how the blur is made:

| Lens | How | Cost |
|---|---|---|
| **Grain** | Every pixel's ray starts at a random point of the lens and aims at the focal point, so out-of-focus parts are a fine noise. Lens Speed drifts the pattern over time. | Free (one ray, as before) |
| **Smooth** | The scene is drawn once through the pinhole into a hidden pass, with each pixel's circle of confusion; a bokeh blur then gathers it in the same frame. | One extra pass and 16–64 reads per pixel |
| **Soft grain** | The Grain rays, drawn into the same hidden pass, with a lighter bokeh blur over them: the grain melts into a soft haze. **Softness** (a live slider) scales that blur. | Same as Smooth |

The grain lens is capped at 6% of Focal Dist, so the blur tops out at a few percent of the picture: before, a near
Focal Dist with a wide Aperture fanned the rays out so far that the picture dissolved into noise.

Saved graphs keep Grain (a camera saved before Lens migrates to Grain, and its code is unchanged). New cameras start
on Grain too: Smooth costs about 0.5 ms at 2 MP even when Aperture is 0 (the pass and its probes still run), and
1.2 / 1.9 / 2.9 ms at 16 / 32 / 64 taps with a blur (measured on the DoF: Orbit Orbs example, 1216×1712, GPU timer
queries in a Chromium browser on a Mac). Pick Smooth when you see the grain.

Smooth's settings (shown only for Smooth):

- **Blur quality**: 16, 32 (default) or 64 taps per pixel, in a golden-angle disc turned per pixel.
- **Bokeh shape**: Disc, Hex (6 blades) or Oct (8 blades).
- **Max blur %**: the widest blur, as a percentage of the picture height (default 4). Things very near the camera
  are capped here. It rebuilds the shader when changed; Aperture and Focal Dist stay live sliders.

### How Smooth works

`compiler/smoothDofExpand.ts` opens the camera before the passes are cut:

```
camera (pinhole) ─▶ march ─Distance─▶ CoC ─┐ alpha
… ─▶ what the Output showed ───────────────┴▶ hidden Pass "Smooth lens" ─▶ gather ─▶ Output
```

- The camera shoots pinhole rays and hands over Aperture × FOV and 1 / Focal Dist.
- **CoC** (thin lens, the same geometry as Grain): a point at distance *d* along the ray spreads over a disc of
  radius `A·|1/d − 1/f|` radians, which FOV turns into picture units: `coc = ½·A·FOV·(1/f − 1/d)` picture heights.
  Signed (negative in front of the focus), so comparing two CoCs compares their depths. It goes into the Pass's
  alpha (half float, nearest filtering, so an edge's CoC isn't blended).
- **Gather** (`lensDofGather`, nodes/definitions/lensDof.ts): 16 probes on two rings find how far a nearer, blurrier
  neighbour reaches into this pixel; the taps then cover the larger of that and this pixel's own CoC. A tap counts
  only when its own CoC reaches this pixel (scatter-as-gather), and a tap behind this pixel can be at most twice as
  blurred as this pixel. So a sharp foreground keeps a crisp edge over a blurred background, and a blurred foreground
  still spills over a sharp one. A tap that doesn't count adds the running average (no darkening).

The blur matches Grain's amount at the same settings (the same CoC); Grain's noise is the same disc, sampled once.

Where it opens: a top-level camera whose Ray Dir is wired straight into a march with a Distance output (March Loop
Group, GI Lit March Group), with the graph's Output colour wired. Anything else (the camera inside a group, a
Vec4 Output, no march) compiles as Grain. Everything the Output showed is drawn once, in the pass; the final program
is only the gather. Recordings, PNG/video exports and web pages run the same programs (the pass is an ordinary
hidden Pass to passRunner and kit/passHost.js).

Not done: a half-resolution blur, and averaging Grain frames while the camera is still. The 3D Scene Builder has no
depth-of-field setting yet (reading a graph with an Aperture warns that it has none), so it offers no Lens either.

Tests: `src/compiler/__tests__/smoothDof.test.ts` (CoC maths, Grain unchanged, migration, the pass in the DoF example,
builder-built Surface and GI scenes, every quality and shape, the web export).
