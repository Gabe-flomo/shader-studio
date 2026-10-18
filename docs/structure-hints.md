# Structure hints

Most shaders are built in roughly the same order: first the coordinates, then the shape, then the colour, then the finish. The stage map below records that order. It is used by the builders' flow strips and the node library's relevance; the Studio graph itself does not show stages (see [Where stages show](#where-stages-show)). The order comes from the bundled examples (see [The data](#the-data)).

## The flows

| Flow | Stages |
|---|---|
| **2D** | Space (UV, centre, zoom) → Bend space (warp, repeat, polar, pixelate, grid) → Shape (SDFs, noise, fractals) → Shape it (glow, rings, mask, levels) → Colour (palette, mix, ramp, grading) → Post (tone map, bloom, grain, vignette, Look) |
| **3D** | Camera → Bend space (3D transforms, warps) → Objects (3D primitives) → Combine (union, subtract, intersect) → Scene (Scene Group) → March → Lighting (shading, shadows, AO, fog) → Colour → Post |
| **Passes / sims** | Source (texture, video, a seed) → Pass (Pass, Previous Frame, Echo) → Rule (Grid Rules, Fade, Neighbours, Blur texture) → Read out (Mask, Levels, Flow, Sample) → Colour → Post |
| **Agents** | Sense → Steer (Steer, forces) → Move (Move, Integrate, Collide, Age) → Deposit → Trail → Draw → Colour → Post |

A graph's flow is chosen automatically from its *marker* nodes: a camera, 3D shape, ray march or 3D lighting node means 3D. A Pass, Previous Frame or rule node means passes. A Sense, Steer, Move, Trail, Draw or Particles node means agents. When a graph has markers for more than one flow, the flow with the most markers wins; ties go to agents, then passes, then 3D. A graph with no markers is 2D.

Each flow also reads the other flows' stages as one of its own. For example, Union is Combine in 3D but Shape in a 2D graph, and a texture input is Shape in 2D. This means a mixed graph still lights up sensible stages.

### Stage map (`src/structure/stages.ts`)

Every node type has a stage or the explicit `any`. Maths, time, constants, Expression Blocks, custom functions, outputs and loop parts are `any`: they belong anywhere. The map is data-driven:

1. `CATEGORY_STAGE` gives each registry category's usual stage. For example, `2D Space` is Bend space, `Color` is Colour and `3D Primitives` is Objects.
2. `TYPE_STAGE` holds the exceptions. UV, UV Transform and Rotate 2D are Space. Domain Warp is Bend space. SDF Glow and Glow Layer are Shape it. Tone Map and Grain are Post. Previous Frame is Pass. Picking a colour is `any`, because it's a constant tint and not a colouring step.

A registry-wide test checks that every node resolves to a stage, that every category is mapped and that no override names a missing type. A node added to a known category is covered automatically. User nodes are `any`.

## Where stages show

**Not in the Studio graph** (removed 2026-10-18). The graph has no flow strip, no stage tags on cards, no stage browse in the node library, no order notices and no "Arrange by stage"; suggestions, quick add, search and the Do… bar no longer lean to a "next stage". Node cards keep their category colours. The strip's settings (`playfield:structure:strip`, `:tags`, `:notices`, `:dismissed`) are no longer read.

What still uses the stage map:

- **The builders.** The 3D Scene Builder (3D flow), Grid Rules (passes) and Agent Rules (agents) windows show their flow under the header (`BuilderFlowStrip.tsx`).
  - Each stage has a line saying where it lives in that builder, for example "Quality: how far and how finely each ray steps". Stages that happen in the graph are outlined only.
  - The strip folds to the stage names, and the folded state is remembered (`playfield:structure:builderStripFolded`).
  - Empty sections (an empty scene tree or an empty rule list) add a "Next in the flow: …" line. The data is in `src/structure/builders.ts`.
- **The node library's relevance** (`src/structure/relevance.ts`): the graph's flow (2D, 3D, passes, agents; `detectFlow` in `flow.ts`) decides which categories fit it.
- **The numbers below** (`src/structure/stats.ts`, printed by its test), and the pattern miner's stage labels.

**Auto layout** (`layoutByRank` in `src/store/graphLayout.ts`, also used by Convert and GLSL import; in the canvas's right-click menu). Nodes go in left-to-right columns by data-flow rank, and the layout stays compact:

- A node is pulled right, next to the first node it feeds (`compactRanks`). A Time or a constant read only at the end of a long chain used to sit alone in the first column, far from everything else.
- Each connected piece of the graph is laid out on its own (`connectedPieces`). The piece with the Output comes first. The others are packed beside it in rows no wider than the widest piece, with the usual column gap (`packPieces`), so nothing is stranded far left or far right.

## The data

The flows were checked against every bundled example (`src/structure/stats.ts`, `src/structure/__tests__/stats.test.ts`).

A **link** is a staged node and the nearest staged node feeding it, skipping nodes that go anywhere. For example, UV → Multiply → Circle SDF is one Space → Shape link. Links are sorted into these kinds:

- **forward:** the later stage is fed by the earlier one.
- **same stage:** both nodes are in the same stage.
- **feedback:** the link closes the flow's loop. This means anything drawn into a Pass, or a trail read by the next agent step.
- **colour into an input:** a colour fed into an earlier node's colour slot, such as a picture laid into a grid, a glow's tint or Draw agents' "over".
- **backward:** anything else.

The test requires at least 95% of order-carrying links (forward and backward) to go forward in every flow. To regenerate the tables:

```
WRITE_DOCS=1 npx vitest run src/structure/__tests__/stats.test.ts
```

<!-- stats:start -->
496 bundled examples: 278 2D, 91 3D, 56 Passes, 71 Agents.

**2D** — 278 examples, 909 stage links. Forward 754, same stage 111, feedback 0, colour into an input 29, backward 15: **98% of order-carrying links follow the flow**; 10 of 278 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Space → Shape | 177 | 63.7% |
| Shape → Shape it | 135 | 48.6% |
| Shape it → Post | 88 | 31.7% |
| Shape → Colour | 74 | 26.6% |
| Colour → Post | 35 | 12.6% |
| Space → Bend space | 35 | 12.6% |
| Space → Colour | 29 | 10.4% |
| Bend space → Shape | 28 | 10.1% |
| Shape it → Colour | 10 | 3.6% |
| Bend space → Colour | 9 | 3.2% |

| Stages feeding the Output | Examples |
|---|---:|
| Space → Shape → Shape it → Post | 85 |
| Space → Shape → Colour | 31 |
| Space → Shape → Colour → Post | 28 |
| Space → Colour | 19 |
| Space → Shape → Shape it | 16 |
| Space | 15 |

**3D** — 91 examples, 908 stage links. Forward 706, same stage 182, feedback 0, colour into an input 2, backward 18: **97.5% of order-carrying links follow the flow**; 11 of 91 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Camera → March | 67 | 73.6% |
| Scene → March | 67 | 73.6% |
| Bend space → Objects | 43 | 47.3% |
| March → Post | 36 | 39.6% |
| Objects → Combine | 28 | 30.8% |
| Lighting → Post | 25 | 27.5% |
| Combine → Scene | 25 | 27.5% |
| March → Lighting | 24 | 26.4% |
| Objects → March | 19 | 20.9% |
| Objects → Scene | 16 | 17.6% |

| Stages feeding the Output | Examples |
|---|---:|
| Objects → March | 18 |
| Camera → Bend space → Objects → Combine → Scene → March → Lighting → Post | 13 |
| Camera → Bend space → Objects → Scene → March | 8 |
| Camera → Objects → Scene → March → Lighting → Post | 5 |
| Camera → Bend space → Objects → Combine → Scene → March → Post | 5 |
| Camera → Objects → Scene → March | 4 |

**Passes** — 56 examples, 580 stage links. Forward 313, same stage 126, feedback 122, colour into an input 13, backward 6: **98.1% of order-carrying links follow the flow**; 5 of 56 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Pass → Read out | 33 | 58.9% |
| Source → Pass | 24 | 42.9% |
| Read out → Colour | 20 | 35.7% |
| Source → Read out | 19 | 33.9% |
| Pass → Rule | 17 | 30.4% |
| Source → Colour | 13 | 23.2% |
| Pass → Colour | 11 | 19.6% |
| Colour → Post | 7 | 12.5% |
| Rule → Colour | 5 | 8.9% |
| Source → Rule | 4 | 7.1% |

| Stages feeding the Output | Examples |
|---|---:|
| Source → Pass → Read out | 9 |
| Source → Pass → Read out → Colour | 9 |
| Source → Pass → Rule → Read out → Colour | 9 |
| Rule | 9 |
| Source → Pass → Read out → Colour → Post | 6 |
| Source → Pass → Colour → Post | 2 |

**Agents** — 71 examples, 552 stage links. Forward 358, same stage 129, feedback 42, colour into an input 21, backward 2: **99.4% of order-carrying links follow the flow**; 2 of 71 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Move → Draw | 46 | 64.8% |
| Move → Deposit | 41 | 57.7% |
| Deposit → Trail | 41 | 57.7% |
| Steer → Move | 40 | 56.3% |
| Sense → Steer | 27 | 38% |
| Sense → Move | 22 | 31% |
| Trail → Draw | 17 | 23.9% |
| Trail → Colour | 16 | 22.5% |
| Sense → Draw | 15 | 21.1% |
| Sense → Colour | 10 | 14.1% |

| Stages feeding the Output | Examples |
|---|---:|
| Sense → Steer → Move → Deposit → Trail → Draw | 12 |
| Sense → Steer → Move → Deposit → Trail → Draw → Colour | 10 |
| Sense → Draw | 6 |
| Draw | 6 |
| Steer → Move → Draw | 5 |
| Sense → Move → Deposit → Trail → Draw | 5 |

<!-- stats:end -->

What the data changed:

- Picking a colour is `any`, because colour constants used as tints made "Colour → Shape" look common.
- Feedback and tint links are counted separately.
- In the 3D flow, Lighting comes after March: in the examples, March → Lighting appears in 9 graphs and Lighting → March in none.

## Limits

- A graph has one flow. A 2D picture composited over a 3D scene reads as 3D, with the 2D stages aliased.
