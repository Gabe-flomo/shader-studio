# Blur and glow

This page covers how Playfield blurs and glows a picture: the shared code in `src/play/kit/blur.js`, the hidden passes behind **Blur (texture)** and **Glow (texture)**, and the other places that blur. Sources are listed at the end.

## Why the old glows looked bad

The neon examples (Passes 1, 5 and 9, and a Play layer glowed through a Pass) showed **stacked ghost copies, streaks and rings** instead of a smooth falloff. The causes were:

| Where | What it did | Why it showed copies |
|---|---|---|
| Blur (texture), Glow (texture) | One pass with 12, 24 or 48 taps on a fixed Vogel (golden-angle) disc of radius R, every pixel using the same pattern | The taps are about R·√(π/N) apart: 5 picture pixels for R = 14 and N = 24, and 13 pixels for R = 48 and N = 48. A 1–2 pixel neon tube is read at a few fixed offsets, so the "glow" is N copies of the tube. Every pixel uses the same pattern, so the copies line up into visible rings and streaks. |
| Pass Scale ½ / ⅛ as the cure | The hint said to set the Pass upstream to ½ for wide blurs | A smaller Pass draws its input at fewer pixels. It does not filter it down, so tap spacing in texels only halves and thin lines alias. |
| Glow threshold | A smoothstep per tap | Fine on its own, but it amplified the copies above. |
| Neighbours (texture) Average | A square of point reads `Spacing` apart | Gaps (and copies) once Spacing > 1 px, and 9 reads for a 3×3. |
| Gaussian Blur (effects) | A 3×3/5×5/7×7 grid with taps `Radius` pixels apart | A grid of copies once Radius > 2. In the Look stack (no feedback to hide it) the copies are plain to see. |
| Bloom (effects) | A 28-tap spiral turned per pixel, or "Layered": 4 × 3×3 grids at R/4…R with no jitter | The spiral's radii were fixed (ring-shaped grain). The layered kernel is 36 copies on a grid. |
| Tilt-Shift Blur | 9 taps `br` pixels apart, weighted by tap index | At Max Blur the kernel goes flat: about 9 equal copies. |
| Lens Blur / Depth of Field | 12 or 16 taps on the outline of a disc, hexagon or octagon | A ring of copies (the bokeh shape drawn as an outline). |
| Look Bloom / Halation / CRT glow (finish.js) | ¼ level blurred with a 9-tap linear-sampled Gaussian (good). The ⅛ and 1/16 levels were blurred **while shrinking**, with steps 2 and 1.5 texels apart. | The linear-sampling pairs assume a 1-texel step. At 1.5 and 2 they skip texels, so a bright point rippled. The levels were then read back with bilinear filtering, which shows diamonds when 16× smaller. |
| Look Edges → Glow | 8 reads at ±4 × Width in 4 fixed directions | Copies of every outline 4 widths out. |
| Particles glow (gpuParticles.js) | ¼ and 1/16 levels (exact box down and a 9-tap Gaussian) | No copies. The 1/16 level read back bilinear 16× larger gave faint blocky diamonds round a lone particle. |

Precision was not the main cause. Pass targets were already half float by default, and the hidden passes are half float too. The 8-bit fallback is covered below.

## What replaced them

All of the shared code lives in **`src/play/kit/blur.js`**. It is pure: GLSL strings and plan numbers. The Studio compiler, the Finish stack, the Particles engine and web exports (the kit is inlined, `bl`/`BL_` prefix) run the same code. `blGlsl(T, read?, suffix?)` builds the sampling functions for GLSL ES 1.00 (`texture2D`) or 3.00 (`texture`), or with a fixed read: `BL_PREV_GLSL` reads `texture2D(u_prevFrame, …)` written out, so the Look stack can still rewrite it to read the picture (`play/lookGraph.ts`).

### Blur (texture) and Glow (texture): Method

| Method | What it is | Passes |
|---|---|---|
| **Smooth** (Blur's default; old graphs) | A true separable Gaussian, σ = 0.45 × Radius (the old disc weighed exp(−2.5r²), so σ = R/√5 and Radius keeps its meaning). Each 1D pass uses **linear sampling** (Rákos): one bilinear read between texels i and i+1 at (i·wᵢ + (i+1)·wᵢ₊₁)/(wᵢ + wᵢ₊₁) returns both, so about half the reads cover every texel in reach. Nothing is skipped, so there are no copies. For wide radii it first **halves** the source with Jimenez's 13-tap filter until σ ≤ 4 texels (at most 4 times), then **subtracts** the variance the downsamples and the final cubic read already add (as Aras Pranckevičius's "Smol Gaussian" does). The node reads the result through a **4-tap cubic B-spline** when it is smaller than the picture, which avoids bilinear diamonds. | 2 hidden passes, plus 1 per halving |
| **Bloom chain** (Glow's default for new nodes) | The mip-chain bloom of Jimenez (CoD:AW), also used in LearnOpenGL's physically based bloom and close to Bjørge's dual filter. Level 1 is a 13-tap downsample with the **Threshold / Knee** per tap and the **Karis average**, which stops fireflies. Each level below is another 13-tap downsample. Going back up, each level adds its own downsample, weighed by its share of Radius, to the level below read through a **9-tap tent**. Level 1 holds the sum, and the node divides by the weights' total, so the glow's energy equals what passed the threshold (times Intensity and Tint). The result is a soft core with a long, wide tail. | levels × 2 − 1 (Radius 12 → 4 levels, 7 passes; Radius 24 → 5 levels, 9 passes) |
| **Fast** (one pass) | The old disc, kept for cheap previews. It now reads between texels, and each pixel turns its spiral by up to one golden-angle step and slides its taps out by up to one ring (**interleaved gradient noise**, Jimenez 2014). Too few taps then show as fine grain, not copies. Quality (12/24/48) applies only here. | none |

Glow also gained **Knee** (the width of the soft ramp above Threshold; 0.1 matches the old fixed ramp) and **Tint**, and adds ±½ of an 8-bit step of noise so a wide, faint glow doesn't band on screen.

**Migration.** A node saved before Method has no `method` and compiles as **Smooth**, with the same Radius units. Old graphs keep their look without the copies, and Smooth is cheaper than the old disc at wide radii. A newly added Glow starts as a Bloom chain. Its energy is spread over a much wider tail, so at the same Intensity the halo near the source is dimmer than Smooth's. Glows saved without a method therefore stay Smooth rather than change brightness. The examples state their method.

### Hidden passes (compiler/blurPasses.ts, compiler/hiddenBlurs.ts)

One program can't blur across and then down, so the compiler gives each Smooth or Bloom-chain node passes of its own:

- **Plan.** `planBlur(method, radius, sourceScale, glow)` lists the stages, what each reads (the node's own Texture wire, or an earlier stage) and their scales. The source scale is the Pass's Scale, or 1 for an image, video, trail or drawing.
- **Compile.** Each stage is an internal `blurStage` node with the Blur's **own id**, so its Radius / Threshold / Knee compile to the same `u_p_…` uniforms as the card. A slider drag, a Play mapping or a keyframe drives every stage, with no recompile. A slider wired through a group's param socket (`__param_*`) is computed again in each stage. A stage that reads the source includes the source's ancestors (Pass nodes as sources, Agents trails, Texture Inputs).
- **Schedule.** The stages are ordinary pass programs (half float, linear, clamp), marked `hidden`, and drawn just before the first program that has the node: a Pass's program or the final picture. They inherit that program's stage (before or after Agents, before Particles), so both hosts (`lib/passRunner.ts` and `kit/passHost.js`) and offline renders run them unchanged. The node, annotated with the last stage's sampler, reads it instead of blurring.
- **Budget.** Hidden passes **don't count** towards the 8 Pass nodes (`MAX_PASSES`). A graph may add up to **`MAX_HIDDEN_PASSES` = 48**; a node past that falls back to one pass. The Performance panel lists hidden passes under the node's name ("Blur (texture) · across ½"). Show passes doesn't tint them.
- **A graph with no Pass node** (a Texture Input blurred directly) now compiles as a pass graph when it has a Smooth or Bloom node with Texture wired (`hasHiddenBlur`).
- **Stays in one pass** (the node's single-pass look, `blSoft`: an exact 2D linear-sampled Gaussian while σ ≤ 3 px, else a 48-tap turned disc):
  - a node inside a repeated Pass that blurs that Pass's own Previous, because the hidden passes would run once per frame, not once per repeat;
  - a node inside an Agents program or a Trail's step;
  - a node inside a group with no Pass (only groups with a Pass are opened for the cut);
  - nodes past the budget.

### Everything else that blurs

| Place | Change |
|---|---|
| Neighbours (texture), **Average / Difference** | Read between texels (Xor, "Blur Philosophy 2"): (size − 1)² bilinear reads half a step off the grid cover the size × size disc. That is 3×3 in 4 reads and 5×5 in 16, with every pixel counted. Max / Min / Range keep the per-pixel grid, because a blend would soften the max. |
| Gaussian Blur (effects) | Both: `blSoftPrev`, an exact 2D Gaussian while small, a turned disc past that. Horizontal / Vertical: `blGaussPrev`, a 1D linear-sampled Gaussian. σ = the old grid's σ × Radius; this pixel's own (live) colour keeps the old centre weight. Kawase is unchanged: by design it is one iteration of the 4-diagonal-tap filter. |
| Bloom (effects) | Spiral: the radii are now jittered per pixel as well as the angle. Layered: each pixel turns and stretches its 3×3 grids. |
| Tilt-Shift Blur | A 1D linear-sampled Gaussian along the blur direction, σ = 2 × the local blur. |
| Lens Blur / Depth of Field | Disc: turned and stretched per pixel. Hexagon / Octagon: each read at its own depth into the shape, so the bokeh fills in instead of ringing; the orientation is kept. |
| Radial Blur | Each pixel starts its reads at its own fraction of a step: grain instead of stair steps. |
| Look **Bloom / Halation tail / CRT glow** (finish.js) | The ⅛ and 1/16 levels now start from a 13-tap downsample, then blur across and down **one texel apart**, so no texel is skipped and the ripple is gone. All levels are read back through the cubic B-spline. There are two more small passes and two more targets (`ed`, `gd`). |
| Look **Edges → Glow** | The four directions are turned per pixel and each takes its own distance (1.5–4 × Width): a soft band instead of copies. |
| Particles glow (also the Agents' Draw glow, which shares `GP_COMPOSE`) | The ¼ and 1/16 levels are read back through the cubic B-spline. The 3D Draw depth of field is untouched. |

**Deliberately left alone:**

- **The Agents trail diffuse** (3×3 mean or 5×5 binomial with `texelFetch`) is dense, with every texel read.
- **The Look's Halation tight bleed** is a dense max-spread.
- **Frame Stack's depth of field** already turns per pixel with interleaved gradient noise.
- **The canvas-side blurs** use browser filters or dense CPU boxes, which don't ghost:
  - the Lens layer (`ctx.filter`);
  - mattes (`shadowBlur`);
  - motion, water and contours (dense CPU boxes);
  - p5 `filter(BLUR)`.
- **Analytic glows** (SDF Glow, Glow Layer, Deep Glow, the light halos and so on) compute a falloff and sample nothing.
- **The Layers node** does no blur of its own. Its Color into a Pass, then Glow / Blur (texture), takes the new path, as do particle layers glowed that way.

### Precision

Hidden passes ask for **half float**. Hosts without float render targets fall back to 8-bit, as every Pass does. The Glow node adds ±½ LSB interleaved-gradient-noise dither to its output, so an 8-bit screen doesn't band a wide, faint glow. The Look's glow levels keep their own `v/(1+v)` encoding on 8-bit hosts.

## Cost (1080p)

The test was a headless Chrome on an Apple M3 Pro (ANGLE Metal), using `EXT_disjoint_timer_query_webgl2` over chained runs (each reading the one before). The source was a full-size half-float texture of thin lines. Times are the median ms per blur, including every hidden pass and the node's final read. The headless GPU runs at low clocks, so treat the numbers as relative. In the same harness a 400-tap single pass took about 34 ms.

| Radius (px) | Old disc, 24 taps | Old disc, 48 taps | **Smooth** | **Bloom chain** | Fast (new, 24) |
|---|---|---|---|---|---|
| 4 (small) | 2.1 | 4.4 | 2.8 | 1.5 | 3.1 |
| 16 (medium) | 2.4 | 4.0 | 1.8 | 1.9 | 4.4 |
| 64 (huge) | 2.3 | 4.5 | 1.5 | 1.8 | 13.6 |

- **Smooth gets cheaper as Radius grows**, because the Gaussian runs on a smaller copy. From about 8 px it beats the old 24-tap disc, which at those radii showed copies.
- **Fast** is the old cost at small radii. At wide radii its per-pixel turn defeats the texture cache. A random read pattern is inherently cache-hostile, and a full turn was slower still. Use Smooth there.

## Limits

- **The downsampling depth is chosen when the graph compiles**, from the saved Radius. A Radius animated live far past it (say 8 → 64) still blurs correctly: the 1D passes take wider strides past 24 pairs a side. But it reads coarser than a recompile would, and some fine detail can alias. The Bloom chain keeps one spare level for the same reason. Aras Pranckevičius's article covers the fully adaptive version.
- **The Bloom chain's brightness at a given Intensity differs from Smooth's**, because it is energy-preserving with a longer tail. Raise Intensity for a brighter core.
- **Hidden passes don't appear as cards.** They show in the Performance panel only.
- **A blur in a repeated Pass of its own Previous, an Agents program, or a group without a Pass stays single-pass** (see above).
- **Fast is grainy at wide radii by design.**

## Tests

- `src/play/__tests__/blurKit.test.ts` covers:
  - the Gaussian weights (they sum to 1);
  - the linear-sampling taps, which sum to 1 and, read through a simulated bilinear filter, reproduce the discrete kernel exactly;
  - the Smooth plan (halvings, variance) and the Bloom plan (level counts, sizes at 1080p, weights);
  - the shared GLSL (one string per variant, literal loop bounds, the `u_prevFrame` variant).
- `src/compiler/__tests__/hiddenBlurs.test.ts` covers:
  - stage plans and migration;
  - hidden passes not counting towards the 8;
  - the 48 budget;
  - the repeated-Pass fallback, the Previous case, Fast, and a graph with no Pass.
- **Golden snapshots** were updated only for graphs that contain a changed node: agentShaderFeedback, comboBloomDots, dofDepthBlur, fcTrippyNoise, passBlurGroup, passEdgeGlow, passGlowBright, passParticleEdges, passReactionDiffusion, tiltShiftScene, ttReactionLevels, ttVideoOutline. The GP engine shader snapshot was updated for `GP_COMPOSE`. Every other example compiles byte for byte as before.

## Sources

- Daniel Rákos, [Efficient Gaussian blur with linear sampling](https://www.rastergrid.com/blog/2010/09/efficient-gaussian-blur-with-linear-sampling/), RasterGrid, 2010: separable Gaussian, bilinear pairs.
- Jorge Jimenez, [Next Generation Post Processing in Call of Duty: Advanced Warfare](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/), SIGGRAPH 2014 Advances in Real-Time Rendering: the 13-tap downsample, Karis average, tent upsample, mip-chain bloom, and interleaved gradient noise.
- Marius Bjørge, [Bandwidth-Efficient Rendering](https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_slides.pdf), SIGGRAPH 2015 (ARM): dual filtering (Kawase-style down/up chains).
- Masaki Kawase, *Frame Buffer Postprocessing Effects in DOUBLE-S.T.E.A.L (Wreckless)*, GDC 2003: the Kawase blur (the Gaussian Blur node's Kawase option).
- Alexander Christensen, [Physically Based Bloom](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom), LearnOpenGL: the 13-tap / Karis / tent chain as implemented here.
- Xor, [Blur Philosophy](https://mini.gmshaders.com/p/blur-philosophy) and *Blur Philosophy 2*, GM Shaders: separable passes, reading between texels (4 taps for 3×3), the ±√½ offset, and repeating small blurs or downscaling for wide ones.
- Aras Pranckevičius, [Fast blur with animated radius](https://aras-p.info/blog/2026/10/01/Fast-blur-with-animated-radius/), 2026: downsample, then Gaussian, then B-spline reconstruction, subtracting the variance the resampling adds.
- Christian Sigg and Markus Hadwiger, *Fast Third-Order Texture Filtering*, GPU Gems 2, ch. 20: the 4-tap cubic B-spline read.

## Tail (bloom chain)

A Glow (texture) made since Tail existed weights its wider levels more: level k counts `1 + Tail × (k − 1)` times. The sum is still divided by the total weight, so brightness stays the same. 0 spreads the glow evenly (the old look); 0.4 (the default) or more gives a tight core with a long, dreamy falloff, like a camera lens. A Glow saved before Tail compiles exactly as before.

## Upgrading the old Bloom

The **Bloom** node (Effects) reads the frame before, so anything moving lags and smears, and it needs a brightness floor so faint light doesn't creep across the frame. Right-click it, or use the spark button on its card, and choose **Upgrade to same-frame glow**. That replaces it with:

```
picture ─► Pass ─texture─► Glow (texture), Bloom chain ─┐
     └──────── Pass Color ─────────────────────────────┴─► Add glow ─► (where Bloom went)
```

The Glow keeps the Bloom's id, so Play controls on Threshold, Intensity and Radius keep working. Softness becomes Knee, and Radius is halved (the chain's tail reaches several times further). Wires into Bloom's Threshold or Intensity sockets come off, because the Glow has those as sliders. Undo puts the old Bloom back.

Tone Map gains **Jodie Reinhard**: Reinhard on luminance, blended toward per-channel Reinhard as the light gets brighter, so bright glows keep their colour instead of going white.
