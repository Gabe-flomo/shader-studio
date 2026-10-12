# Camera projections: Orthographic and Reverse for agents and splats

The March Camera has a **Perspective** select (docs/curved-space.md §1): **Normal** (far things smaller),
**Orthographic** (parallel rays: size does not change with distance) and **Reverse** (far things bigger), with
**Reverse strength** and **Converge at** shown only for Reverse. Draw agents' 3D camera and the Splat Scene now have
the same three, with the same words and the same maths, so walkers, splats and ray-marched shapes seen through one
camera line up in every mode.

| Where | What you set |
|---|---|
| Draw agents (3D), Camera section | **Perspective**, **Reverse strength**, **Converge at** (Reverse only), and **Flatten** |
| Agents builder → Look → Camera | the same, as chips and sliders (right-click a slider for the Play menu) |
| Splat Scene | the March Camera wired into Ray Origin / Ray Dir: its Perspective |
| Splat builder → Camera | **Perspective**, and **Reverse strength** / **Converge at** for Reverse (right-click for Play) |

Old graphs are unchanged: a camera that never chose a Perspective is Normal, and Flatten keeps its saved value.
Reverse's two sliders are live uniforms (drag, Play mappings and keyframes cost no recompile); switching the select
recompiles where it needs to (the March Camera's code), and costs nothing for Draw agents (the engine reads it).

Examples: **Agents in 3D → Reverse-perspective swarm** (a box of walkers drawn far-side-bigger) and **3D Basics →
3D: Splat scan, isometric** (the generated rings through an orthographic camera at the isometric angle, over a floor;
built with the Splat builder).

## One family of rays

Every March Camera setting is an *affine* family of rays: the ray at picture point g_uv = (u, v) leaves

    origin(uv) = eye + a · (u · right + v · up)

and heads along `forward + b · (u · right + v · up)`. A point at depth z along forward and offset x across it is on
the ray with

    u = x / (a + b · z)                                                     (1)

so `w(z) = a + b·z` is how far the rays have spread by depth z, per unit of g_uv. With the lens f (FOV, Zoom),
Distance D, strength s and Converge at C, and m = max(1 − s·D / C, 0.2) (the March Camera's own clamp):

| Perspective | a | b | w(z) |
|---|---|---|---|
| Normal (pinhole) | 0 | 1 / f | z / f |
| Orthographic | D / f | 0 | D / f |
| Reverse | D / (f·m) | −s·a / C | a · (1 − s·z / C) |
| Normal + Flatten φ | φ·D / f | (1 − φ) / f | (φ·D + (1 − φ)·z) / f |

In Reverse, w shrinks with depth, so far things are bigger; at z = C / s it is 0 (the rays cross) and past it the
picture flips, exactly as the march shows it. The looked-at point (z = D) keeps its Normal size in all of them.

## Draw agents: forward, not marched

Walkers are drawn, not marched, so the camera runs (1) forwards: a walker at offset (x, y) and depth z lands at
`(x, y) · L / W(z)` with `W(z) = A + B·z`, A = L·a, B = L·b (L the Zoom). The engine passes `u_proj = (A / D, B)`:
(0, 1) Normal, (1, 0) Orthographic, (1/m, −s·D/(m·C)) Reverse (`kit/agentPlan.js agProjection`). **Flatten** then
blends W toward D (orthographic) whatever was chosen, so it stays a smooth slider for animation:
`W = mix(A + B·z, D, Flatten)`. For Normal that is the old `mix(z, D, Flatten)` exactly.

- **Size** goes as D / |W|: constant in Orthographic, growing with depth in Reverse.
- **Depth of field**: the circle of confusion of a lens focused at F is ∝ |z − F| / W(z) (blur in the world,
  scaled to pixels by 1 / W), with W the chosen projection before Flatten, so Normal is the old |z − F| / z. In
  Orthographic blur grows evenly either side of the focus; in Reverse it grows toward the crossing.
- **Near the lens**: only Normal fades walkers very near the camera (nothing there is huge in the others).
- **Splats look**: the EWA Jacobian is that of (1): `L (r / W − B·x·f / W²)` (see below), B times 1 − Flatten.
- **Culling**: behind the camera's plane (z < 0.06) as before, and where |W| ≈ 0 (the crossing).

### Through a ray-marched scene's camera

With Camera from / Camera ray wired, the walkers are drawn through the scene's camera, rebuilt on the GPU from a
probe of its chain. The probe used to read four points (the origin; the rays at the centre, half right and half up),
enough for a pinhole. It now reads six (`AG_PROBE_POINTS`): also the ray *origins* half right and half up, which an
orthographic or reverse camera spreads out. `agSceneCam` (`kit/agentShaders.js AG_CAM_GLSL`) recovers a and b:
right and up come from the way the origins spread when they do (more than 5% of the picture's width at the world's
centre; less is a lens's aperture jitter, as before), else from the side rays; a from the origins' spread; b from the
side ray's lean (negative in Reverse). It then sets lens = D / (a + b·D) and proj = (a, b·D) / (a + b·D), so
lens / W(z) = 1 / (a + b·z) exactly: a walker lands where the scene's ray through it starts.

Depth (hiding walkers behind the scene's surfaces) compares the scene's Depth, the march's distance from each ray's
own origin, with the walker's distance from *its* ray's origin: `agRayDist` = |d − (x, y)·A/W₀| (|d| for a pinhole,
the depth z for an orthographic camera).

The CPU mirrors are `agProjection`, `agCamW`, `agProject3` (used for the lights' halos and the builder's diagrams) and
`agSceneCamera` (tests only).

## Splat Scene

The splat probe (`compiler/splatGraph.ts`, `SplatProbeOut`) is now 10 × 1: texels 8 and 9 are the ray origins at
g_uv (0.5, 0) and (0, 0.5). The vertex shader (`lib/splats/shaders.ts`) rebuilds per axis (a, b) as above
(`math.ts cameraFromProbe`, with the spread test at the scan's depth) and projects with

    uv = (x / wx, y / wy),   w = a + b·z

and the Jacobian of that map (pixels per world unit, k = H / 2):

    J = k · [[1/wx, 0, −bx·x / wx²],
             [0, 1/wy, −by·y / wy²]]

- **Normal**: b = 1/f, a = 0, so J = k f [[1/z, 0, −x/z²], [0, 1/z, −y/z²]], the 3DGS Jacobian (Kerbl et al. 2023).
- **Orthographic**: b = 0, so J = k [[1/a, 0, 0], [0, 1/a, 0]]: affine, no perspective division; a splat is the same
  size near and far, and its depth has no effect on its ellipse.
- **Reverse**: b = −s·a / C < 0, so ∂u/∂z = +s·a·x / (C·w²), the pinhole's term with its sign flipped, and 1/w grows
  with depth. Past the crossing w < 0; Σ₂ = J Σ Jᵀ is quadratic in J, so the ellipse is unchanged by the sign while
  its centre flips with the picture.

Distance (for compositing with the March Loop) is measured from the ray's own origin, `|t − (u·ax·right +
v·ay·up)|`, and the harmonics' view direction is that same vector. Splats behind the camera's plane (z < 0.05) and at
the crossing are skipped.

**Sorting** is unchanged and right for all three: splats are sorted far to near by depth along forward, and along
every ray of these families depth along forward grows. The probe's first eight texels are still what is read back.

`lib/splats/math.ts` holds the CPU mirror (`marchCamera` with `projection`, `reverseStrength`, `reverseDist`,
`ortho`; `cameraRay`, `cameraRayOrigin`, `cameraFromProbe`, `projectSplat`).

## Tests

`compiler/__tests__/cameraProjections.test.ts` runs the March Camera's real GLSL on the CPU (glslEval) and checks,
for Normal, Orthographic, Reverse (two settings) and Flatten: a point on the ray at g_uv lands at g_uv through Draw
agents' camera and through a camera rebuilt from the probe; ortho keeps a walker's size with depth and reverse grows
it; the splat camera, projection, distance and Jacobian (against finite differences) for each mode; the shaders
parse; a 3D Draw agents' spec only gains Perspective settings when one is chosen, and Reverse's are live uniforms.
`cameraProjectionsGolden.test.ts` holds snapshots, written from main before the change, of graphs that never chose
a Perspective (3D Draw agents with its own camera and through a scene's, the Splat examples, the Splat builder's
starting scene).
