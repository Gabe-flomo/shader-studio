# Pattern discovery: multi-node techniques across the examples

2026-10-07 · branch `claude/pattern-discovery` · code in `src/patterns/`, UI in the Code Explorer's **Patterns** tab.

The Code Explorer finds how one GLSL function is used. This goes one level up: the recurring *multi-node* ways of doing things (attenuating light, tiling space, making waves interfere) across the 397 bundled example graphs, the user's saved graphs and the open graph. The data model is meant to be queried later by the Do… bar ("apply a technique by goal") and by a query explorer (`show graphs using wave interference`); neither is built yet.

## How it works

| Step | File | What it does |
|---|---|---|
| Dataflow | `dataflow.ts` | A graph becomes typed dataflow. Plain groups are flattened (`lang/graphFlat.ts`). Other containers (March Loop, Scene, Agents) stay one node, and their insides are read as their own level, each inner node noting its container. Conversion nodes (Split/Make vec, Float → Color) are collapsed. Expression Blocks, Custom Functions and input expressions carry their GLSL line by line, with the `lib/glslPatterns` idioms found in each line. Every node also has its stage role (`structure/stages.ts`). |
| Mining | `mine.ts` | Finds frequent connected subgraphs of 2–6 nodes. It grows level by level (Apriori style), uses an exact canonical label (colour refinement, then every ordering of tied nodes), and counts support as the number of graphs a pattern appears in. It keeps provenance (graph id plus node uids) and marks a pattern *closed* when no pattern one node larger has the same support. Trivial nodes (UV, Time, constants, Output, group plumbing, Scene Pos) are left out, so `UV → X` and `X → Output` never count. Runs are deterministic: input order doesn't change the result (tested). |
| Catalogue | `catalogue.ts` | 41 hand-curated techniques in 13 families. Each technique has an id, name, family, a one-line explanation, its maths in one line, its slots (role + type in, role + type out) and its variants. Every variant has its own matcher over the wires and/or the GLSL. |
| Index | `patternIndex.ts` | `buildPatternIndex(graphs)` is a pure function that gives technique → graphs/nodes and graph → techniques, cached per graph by a hash of its nodes. Queries: `graphsUsing`, `techniquesIn`, `techniquesAtNode`, `findTechniques("wave interference")`, `familySummary`. |
| Candidates | `candidates.ts` | Mined closed patterns whose embeddings are mostly *not* inside a named technique's hit, ranked by support × size. Similar patterns are folded into one cluster. |
| UI | `components/codeExplorer/PatternsPanel.tsx` | A **Patterns** tab in the Code Explorer (lazy). Families start folded with a summary line ("5 ways to attenuate light · 165 graphs"). Each technique card shows the explanation, the maths, the variants side by side with counts (click one to filter), the slots and the graphs. Clicking a graph opens it with the matched nodes selected (inside groups, the group is selected). An **Unnamed clusters** fold mines on demand. The node right-click menu has **Patterns this is part of…**. |

**Timing on the 397 examples** (4,069 dataflow nodes, M-series laptop, vitest): the index takes **≈ 160 ms** cold and **≈ 8 ms** cached. Mining takes **≈ 1.2 s** (1,353 frequent patterns, 659 closed, min support 3). In the browser the Patterns tab reported 116 ms for the index.

## Coverage

**392 of 397 example graphs (98.7 %) contain at least one named technique.** The median graph has 3, the maximum is 10. Every folder is fully covered except these:

| Folder | Covered | Not covered |
|---|---|---|
| Learn | 39 / 42 | 01 · Hello colour, 03 · Where am I? st, 23 · YUV: a matrix on colour |
| Curves & Shapes | 2 / 3 | Bezier shaping curve |
| Convert | 1 / 2 | Convert: Soft circle, optimised |

The uncovered five are first-step lessons (a colour, the UV, a matrix on colour) or a single shaping curve. Nothing multi-node is happening in them, so leaving them out is expected.

## Families and techniques (graph counts over the examples)

Counts are graphs, not occurrences. A graph can use several variants.

### Light falloff (165 graphs): ways to attenuate light
| Technique | Maths | Graphs | Variants (graphs) | e.g. |
|---|---|---|---|---|
| Exponential falloff | b = e^(−k·d) | 122 | SDF Glow, Glow mode 95 · exp(−k·d) in code 23 · Gaussian e^(−k·d²) 8 | Particle Glow, Letter Drop, Tilt-Shift |
| Smoothstep falloff | b = 1 − smoothstep(r₀, r₁, d) | 34 | Smoothstep on a distance 3 · SDF Fill 15 · code 16 | Grid: Metaballs, Grid: Breathing |
| Inverse falloff (1/d) | b = k / d | 12 | SDF Glow Simple 3 · Glow Layer 1 · code 8 | Fractal Rings (Carry), Neon Floor Grid, Ring Glow |
| Bounded falloff | b = max(0, 1 − k·d)² | 5 | Bounded mode 0 · Ring mode 4 · code 1 | Particles: climb and descend |
| Inverse-square falloff | b = 1 / (1 + k·d²) | **0** | Haze mode 0 · code 0 | none |

Finding: exponential falloff dominates, mostly because SDF Glow defaults to Glow. Haze (inverse-square), the physically motivated one, appears in **no** example. That gap is worth filling with an example.

### Light accumulation (108): ways to accumulate light
| Technique | Maths | Graphs | Variants |
|---|---|---|---|
| Tinted glow | c = b · tint | 106 | SDF Glow Tinted output 101 · Palette into Tint 5 · Glow to Color 5 |
| Glow in a loop | c += f(dᵢ) per step | 7 | Volume glow in a March Loop 4 · iterated group adding light 3 |
| Additive layers | c = Σ bᵢ·tintᵢ | 6 | Add Colors of glows 5 · `col += glow` in code 1 |
| Brightest wins (max) | c = max(a, b) | 1 | Max of two lights 1 |

### Space distortion (45): ways to distort space
| Technique | Graphs | Variants |
|---|---|---|
| Domain warp (p′ = p + k·noise(p)) | 15 | warp node 15 · noise into another node's position 3 |
| Polar coordinates | 14 | Polar Space 5 · atan(p.y, p.x) in code 9 |
| Lens & projection | 9 | lens node 9 |
| Fold & mirror (p′ = abs(p)) | 7 | Fold/Kaleido node 1 · abs(p) in code 6 |
| Twist & bend | 4 | node 3 · rotate by a distance 1 |

### Repetition & tiling (72)
| Technique | Graphs | Variants |
|---|---|---|
| Grid of cells | 33 | Grid Pattern 17 · Grid 13 · Array 5 |
| Tile with fract | 23 | Tile/Infinite Repeat 11 · fract on coords 1 · fract/mod in code 13 |
| Repeat, fold, repeat (iterated) | 11 | iterated group with fract/abs 5 · fractal node 6 |
| Repeat in 3D | 8 | Repeat 3D 8 |
| Angular repeat | 5 | Polar Repeat 1 · mod(atan) in code 4 |

### Waves & interference (19)
| Technique | Graphs | Variants |
|---|---|---|
| Summed waves (interference) | 8 | Wave Texture/Term 3 · sin(a)+sin(b) in code 5 · Add of two wave nodes 0 |
| Ripples from centres | 7 | sine of a distance 2 · code 4 · several centres **0** · Wave Radius 1 |
| Standing waves (Chladni) | 7 | Chladni node 3 · sin·sin in code 4 |

Finding: wave interference is almost always written in code or hidden inside one node. No example *wires* two waves into an Add, and none sums ripples from several centres. That would make a good teaching example and a good first Do… bar technique.

### Per-cell variation (37)
| Technique | Graphs | Variants |
|---|---|---|
| Cell id → hash → offset | 28 | Cell id → noise 13 · floor → hash in code 6 · cell id into code 5 · Cell Displace etc. 7 |
| Influence from a point | 11 | Grid Pattern's Affect wired 11 |
| Wave across cells | 5 | Cell → wave in a field shape 3 · Wave Radius/Density 2 |

### Colour mapping (286)
| Technique | Graphs | Variants |
|---|---|---|
| Tone map (soft clip) | 155 | Tone Map node 143 · 1 − e^(−x) 11 · x/(1+x) 1 |
| Value → palette | 106 | cosine palette 85 · stops/ramp 19 · iq palette in code 2 |
| Mix by a mask | 49 | Mix node 24 · mix(a, b, m) in code 25 |
| Threshold to two colours | 38 | Compare → Colorize 24 · Colorize a mask 30 · mix(…, step()) 8 |
| Colour grade | 14 | grade node 11 · gamma/contrast in code 3 |

### Feedback & trails (83)
| Technique | Graphs | Variants |
|---|---|---|
| Read the frame before | 35 | Pass → previous → sample 15 · Previous Frame/Echo 5 · Time Cube/Frame Stack 16 |
| Deposit, spread, sense | 35 | Deposit → Trail → agents 35 · Sense 31 |
| Cellular automaton | 26 | Grid Rules 11 · Neighbours 10 · Pass → sample → compare by hand 6 |

### SDF combination (38)
Union, cut, overlap: 21 graphs (node 14, Min of two shapes 4, code 3). Smooth union: 11 (node 10, Gaussian field 1, **smin in code 0**). Outline (onion): 9.

### Noise & texture (84)
Layered noise (fBm): 79 graphs. Noise moving with time: 58. Noise → colour: 56.

### Motion (40)
Oscillate with time: 29 graphs (LFO 14, Time → Sin 5, code 10). Spin with time: 13.

### Ray-marched 3D (46)
March a scene: 45 graphs. Light the hit: 14 (lights 7, shadow/AO 5, fresnel/glass 4). Move a shape in the scene: 14.

### Agents & particles (63)
Emit → agents → draw: 47 graphs. Sense → steer → move: 29. Particles: 16. Forces on movers: 13.

## Top mined candidates not yet named

These are frequent closed subgraphs that are mostly outside every named technique's nodes, after folding similar patterns into clusters. Support is the number of example graphs.

| # | Cluster (mined subgraph) | Support | Where | Suggested name |
|---|---|---|---|---|
| 1 | `divide → compare.b`, `compare.mask → colorize.field`, `colorize → colorize.background` (stacked, up to 3) | 7–10 | Learn 08 Fract and floor, 10 Mix and gradients, 31 1D noise | **Plot a function**: compare y with f(x) and paint layered masks over a background |
| 2 | `exprNode.result → agentSense.channels` | 16 | 3D flock, Ants, Boids | **Choose what to smell**: agent rule picks the channels it senses |
| 3 | `circleSDF.distance → compare`, `compare.mask → multiply → circleSDF.offset` | 8 | Grid sims 3/6/7 (under the hood) | **State → dot**: a cell's state sizes or offsets its dot |
| 4 | `agentEmit → agentEmit.also → agentsGroup` (+ draw) | 6–8 | Galaxy, Multi-species slime, Crowd | **Several emitters** feeding one population |
| 5 | `multiply.result → add` (and two multiplies into one add) | 12–13 | Web: Main Frame, Trippy Noise, Fractal Rings (Carry) | **Scale and offset / weighted sum** (a·x + b, Σ wᵢxᵢ) |
| 6 | `exprNode.h → agentMove.heading`, `exprNode.speed → agentMove.speed` | 8–12 | Agent rules 2/3/8/11 | **Heading and speed rule in code** (could be a variant of Sense → steer → move) |
| 7 | `pass.previous → sampleTexture ×2 → add/compare`, `floor → mix`, `round → pass.alpha` | 3–4 (36+ alike) | Grid sims 1–3 (under the hood) | **Count neighbours by hand**: the hand-wired CA rule body |
| 8 | `marchLoopGroup.hit/normal → multiLight + sdfAo + softShadow`, `materialSelect → multiLight.baseColor` | 4 | 3D Lighting, Scene Builder | **Full shading stack** (lights + AO + shadow + material) |
| 9 | `exprNode.result → pass.color` | 11 | Born from your shader, Wireworld | **Code into a Pass** (a shader that writes state) |
| 10 | `materialSelect` chained with `sdfUnion` chain | 3 | Scene Builder examples | **Material per shape** (union and pick the nearer's colour) |
| 11 | `remap → circleSDF.radius` | 7 | Data examples, Array moons | **Data → size** |
| 12 | `planeSDF3D → sdfUnion` | 7 | GI examples, Learn 3D | **Ground plane** |
| 13 | `pass.texture → blurTexture`, `glowTexture → addColor` | 5 | Passes, Grid sims | **Bloom: blur the bright and add it back** |
| 14 | `timeCube.volume → timeCubeView` | 8 | Time Cube folder | **Time as a volume** |

Clusters 1, 5, 9 and 13 are the strongest general-purpose candidates. 3 and 7 are how the "under the hood" grid sims draw and update their state. They are specific, but they show how a CA is built by hand.

## Recommended first techniques for the Do… bar

These are chosen for frequency, how clearly they are defined, and the fact that each fills a gap between a common graph state and a common goal. Slots are what an "apply technique" needs to bind. *in* is resolved from the graph (by stage role and type), and *out* is what it hands back.

| # | Technique (id) | Goal phrase | Slots in → out | Why first |
|---|---|---|---|---|
| 1 | `falloff-exp` | "make it glow" | distance:float, falloff:float → brightness:float | 122 graphs; one SDF Glow; the base of most pictures |
| 2 | `falloff-inverse` / `falloff-inverse-square` as variants of 1 | "softer / longer glow" | same as 1 | Switching the mode is the "3 ways to attenuate light" lesson. Inverse-square has no example yet. |
| 3 | `accum-additive` | "add another light" | layers:vec3 ×n → colour:vec3 | only 6 graphs wire it; the commonest thing users try next |
| 4 | `soft-clip` | "stop it blowing out" | colour:vec3 → colour:vec3 | 155 graphs; always the last step before Output |
| 5 | `palette-map` | "colour this by its value" | value:float → colour:vec3 | 106 graphs; noise/distance → palette |
| 6 | `domain-warp` | "make it liquid / warp it" | position:vec2, amount:float → position:vec2 | inserts on the *space* stage; 15 graphs |
| 7 | `tile-fract` | "repeat it" | position:vec2, count:float → cell position:vec2, cell id:vec2 | 23 graphs; the cell id output feeds 8 |
| 8 | `cell-hash` | "make every cell different" | cell id:vec2, amount:float → random:float, offset:vec2 | 28 graphs; needs 7's cell id slot |
| 9 | `waves-summed` / `ripples` | "make waves interfere" | position:vec2, time:float, centres:vec2 ×n → wave:float | the named request; no wired example exists, so the technique would teach it |
| 10 | `oscillate` | "make it pulse" | time:float, speed:float → value:float | 29 graphs; binds to any float input |

Suggested slot binding: resolve *in* slots by role first (`distance` ← the nearest upstream node in the Shape stage, `position` ← the Space/Bend stage output feeding the shape, `time` ← Time), then by type. Insert *out* where the slot's role is consumed downstream. That is the same stage reading `structure/flow.ts` already does.

## Limits and next steps

- Matchers are heuristics. Code matchers are regexes plus glslPatterns idioms over single lines, so a technique spread across several Expression Block lines can be missed. Node matchers look at wires within 1–3 hops.
- Mining uses node *types* as labels, so SDF Glow's modes are invisible to it. The catalogue reads them as variants.
- Plays: the index is a pure function over graph nodes, so a Play's graph indexes the same way. The UI covers the examples, the saved graphs (localStorage) and the open graph.
- Example thumbnails: there is no cheap source, so graphs are listed by name.
- Not built, by design: Do… bar techniques and a query language. `findTechniques` and `graphsUsing` are the hooks for them.
