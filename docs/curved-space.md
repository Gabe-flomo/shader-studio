# Curved space and reverse perspective

Three ways of looking at a ray-marched 3D scene that ordinary perspective can't give you. All are
off by default and leave every existing graph byte for byte as it was (the golden shader snapshots
are unchanged). The CPU versions of the maths live in `src/lib/curvedSpace.ts` and are tested in
`src/compiler/__tests__/curvedSpace.test.ts`; the GLSL is `src/compiler/curvedSpace.ts` (loops) and
`MarchCameraNode` in `src/nodes/definitions/scene3d.ts` (camera).

| What | Where | Setting |
|---|---|---|
| Spherical space (k > 0) | March Loop Group, GI Lit March Group | **Space curvature** |
| Hyperbolic space (k < 0) | the same slider | **Space curvature** |
| Reverse perspective | March Camera | **Perspective** = Reverse, **Reverse strength**, **Converge at** |
| Orthographic | March Camera | **Perspective** = Orthographic (same as Flatten 1) |

Examples: the **Curved space** folder (Spherical world, Hyperbolic tunnel, Reverse perspective room).

## 1. Reverse perspective (camera)

A normal camera starts every ray at one point (the eye) and fans them out, so lateral offset grows
with depth and far things look smaller. Reverse perspective starts the rays spread across the
picture and aims them at a point `D` (Converge at) in front of the camera:

```
lat   = u·right + v·up                       the pixel's offset on the image plane
a     = clamp(strength, 0, 1)
den   = max(1 − a·camDist / D, 0.2)
O     = (camDist / fov) / den · lat          where the ray starts, relative to the eye
ro    = ro0 + O
rd    = normalize(D·fwd − a·O)
```

A ray's sideways offset at depth z in front of the eye is `O · (1 − a·z/D)`. It shrinks with depth,
reaches 0 at `z = D/a` (all rays meet there when `a = 1`), then changes sign: past the focus the
picture is flipped, as a real lens does behind its focus. An object of fixed size therefore covers
more and more of the picture the farther away it is.

* `den` keeps the look-at target at its ordinary size: a ray at the target depth `camDist` is
  displaced by `u·camDist/fov`, exactly what a perspective camera gives. `den` is clamped so
  `Converge at` close to `camDist` can't blow up.
* `strength = 0` makes `rd = fwd`: parallel rays (orthographic).
* The depth-of-field lens (aperture) still applies on top.

It is ray-origin and ray-direction changes only: the camera's outputs are still `ro` and `rd`.
Orthographic is the same code with Flatten 1 (`projection: 'orthographic'`). Perspective `normal`
or unset emits nothing new.

## 2. Space curvature (March Loop)

### Where it lives, and why

On the **March Loop Group** (and the **GI Lit March Group**), as the `curvature` param. The loop is
where a ray advances: its position is computed as `ro + t·rd` at every step, for the hit point and
for the surface normal. The camera only makes `ro` and `rd` once and never sees the scene, so it
can't bend a path that depends on where the scene is. Putting curvature in the loop also means one
change covers the per-step position, the hit position, the normal and the Distance output.

A loop with no `curvature` param compiles exactly as before. With the param (a live uniform, so
Play can drive it) the shader gets three small helpers and the loop uses them; k within ±1e-4 of 0
is the plain straight ray at run time.

### The maths (exact geodesics)

For curvature k, let `κ = √|k|`. The camera is the point `q = (1, 0, 0, 0)` of S³ (k > 0) or of the
hyperboloid `−w² + x² + y² + z² = −1` (k < 0) in four dimensions (w first); the ray direction `rd`
is the unit tangent `V = (0, rd)`. The ray is the geodesic (a great circle, or a hyperbola):

```
k > 0 :  Q(t) = cos(κt) · q + sin(κt) · V       a unit 4-vector, always
k < 0 :  Q(t) = cosh(κt) · q + sinh(κt) · V
```

`t` is the true distance travelled (arc length), so the loop's Distance output and the fog in the
examples are real distances in the curved space. To evaluate the scene (which is a 3D function) the
point is mapped back to 3D by dropping `w` (the embedding chart): the spatial part of `Q` over `κ`,
placed at the camera:

```
P(t) = ro + rd · sin(κt)/κ      (k > 0)
P(t) = ro + rd · sinh(κt)/κ     (k < 0)
```

(`curvedRayPos` in GLSL; `curvedRayPosVia4D` in the tests checks it against the 4D geodesic.) In this
chart the rays from the camera stay straight, but depth is remapped, which is exactly what makes
fixed-size objects look right in the curved space: the sphere of true circumference at distance `t`
has radius `sin(κt)/κ`, so an object of size `a` subtends `a·κ/sin(κt)`.

* **k > 0, spherical.** Apparent size shrinks, is smallest at the equator `t = π/(2κ)`, then
  **grows again**. At `t = π/κ` (the antipode, `π/√k` away) `sin = 0`, so `P` is the camera again:
  every ray focuses there and whatever sits near the camera appears huge. A full circuit of the
  world is `2π/√k`. The far half folds back: `P(t) = P(π/κ − t)`.
* **k < 0, hyperbolic.** Apparent size `aκ/sinh(κt)` shrinks exponentially: a fisheye tunnel where
  repeated objects shrink fast.

### Stepping

Sphere tracing needs a step that can't overshoot. `d` is a distance in scene (chart) units; the
chart stretches distance along the ray by `dP/dt = cos(κt)` (k > 0, never more than 1) or
`cosh(κt)` (k < 0). So:

* k > 0: `t += d · stepScale` (the factor is 1; true distance ≥ chart distance).
* k < 0: `t += d · stepScale / cosh(κt)` (`curvedStep`). Progress in the chart is a full `d`, so a
  tunnel costs about the same steps as the flat scene.
* k < 0: `Max Dist` is a distance in the chart, so a ray stops at `t = asinh(κ·maxDist)/κ`
  (`curvedEnd`), which also keeps `sinh` from running to numbers where the scene function loses its
  precision. The Depth output stays `t / Max Dist`.

The scene's distance is still a lower bound in chart units, so the step is safe; it is not an exact
distance in the curved space, so thin features can still be missed at extremes: lower **Step Scale**.

### Choosing k

The visible world is a ball of radius `1/κ` in the scene for k > 0 (the chart folds there), so
**scene size matters**: with k = 0.04 the world is 5 across, a lattice with a 1.2 cell shows about
four cells each way. A scene built with 1-unit cells wants k between about 0.01 and 0.2; k = 1 is a
world only 6 units round. For k < 0 any scene works; −0.3 to −1 is a tunnel. **Max Dist** should be
above `2π/√k` to go once round a spherical world.

## 3. Limitations

* **The chart is centred on the camera.** Rays are straight in the chart and curve only through the
  depth remap, so the picture is "the flat scene seen as if its depth were curved around you". It
  is exact for what the camera sees through straight rays and fixed-size objects at a distance; it
  does not curve the scene itself. Moving the camera moves the chart with it.
* **The far half of a spherical world repeats the near half** (the fold): you see the camera's
  neighbourhood again at the antipode. That is correct for S³ seen from one point, and is the "huge
  antipode".
* **Only the camera ray bends.** Everything computed *after* the hit is flat-space, in scene
  coordinates: the normal, the built-in Lambert shading, the downstream lighting nodes (Multi-Light,
  fog, etc.), and the GI Lit group's own AO, shadow, GI and reflection rays, which march straight
  from the hit point. Reflection uses the camera's `rd`, not the bent arrival direction. Soft shadows
  and AO therefore don't curve round the world; with large |k| they are only approximate.
* **Volumetric loops** use the curved position and end distance but step by the scene distance
  without the 1/cosh factor (so glow weights stay consistent with Passthrough); glow in a strongly
  hyperbolic space is only approximate.
* **A body that reads March Pos or the ray** sees the curved position; warps in the body are applied
  to it (flat-space warps of the curved point).
* **Max Dist for hyperbolic space is in chart units** (see Stepping): the Distance output is true
  distance, which is much shorter.
* **Spherical k above about 0.3** makes the visible world very small (radius `1/√k`); pick it with
  the scene's scale in mind.

## Play

`Space curvature` (the loop's card) is a float param, so it can go on Play like any other slider; so
do Reverse strength and Converge at on the camera. The three examples each have Play sliders on
these.
