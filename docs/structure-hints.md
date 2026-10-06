# Structure hints

Most shaders are built in roughly the same order: first the coordinates, then the shape, then the colour, then the finish. Structure hints show that order as a **loose guide**. They never block a wire, move a node or rewrite anything. The order comes from the bundled examples (see [The data](#the-data)).

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

## What you see

- **Flow strip.** A thin bar above the canvas: `2D  Space › Bend space › Shape › Shape it › Colour › Post`.
  - Stages the graph has are lit with their colour. Absent stages are faint.
  - The stage the Output has reached is bold. This is the furthest stage among everything that feeds the Output, including what's inside groups.
  - The stage after it is dashed and marked **next**. Two or three moves from the Suggestions system follow it, for the node that feeds the Output. Moves of the next stage come first. Clicking a move applies it as one undo step.
  - Clicking a stage name opens the node browser on that stage, listed by category. Back returns to the categories. On a phone this opens the Browse sheet's Nodes tab.
  - On a narrow canvas the moves fold into a "Next: …" menu, and only the current and next stages keep their names.
  - On a phone the strip collapses to a chip, for example `2D ● Colour › next Post`. The chip opens the same content in a popover: the stages with a line each, the next moves, notices and View.
  - The strip's × hides it. Hiding is remembered (`playfield:structure:strip`). The flow button in the canvas toolbar brings it back.
- **Stage tags.** A faint stage-coloured line along the top edge of each card. Nodes that belong anywhere get no tag. You can toggle tags in the strip's **View** menu, which also has the legend for the current flow.
- **Next-stage boost** (`src/structure/boost.ts`). This is deliberately small. It breaks near-ties but never overrides a confident preview finding or a strong habit of yours:
  - **Suggestions strip:** +0.35 to a move whose node is in the next stage. For scale, kind fit is 0.4–1, usage is up to ×3 and an output finding is up to ×4.
  - **Search** and the **Do… bar's node list:** +4 points within a match tier. Tiers are 10–20 points apart.
  - **Quick add:** a pick in the next stage rises at most one place.
  - There is no boost while the strip is hidden.
- **Order notices** (`src/structure/notices.ts`). These are phrased as questions and never block anything. They appear as a "1 note" chip at the end of the strip. **Show** selects the node, opening its group if needed. **It's intended** dismisses the notice for this graph, keyed by the saved graph's name. **Turn order notices off** switches them off everywhere, and so does the View menu.
  - *A bend after the colour:* a Bend-space node is fed a colour and its result goes on as a colour (into a colour step, a finish or the Output). The notice reads: "this bends the colours, not the shape". A bend whose result goes back into space, such as a shape's UV or a sampler, is colour-to-space. That's deliberate and is never flagged.
  - *Bloom after Tone map:* the brights are already squeezed into range.
  - *Noise mixed in after a finish:* a noise joins the picture after a Post node that it doesn't pass through.
  - **Exceptions:** anything wired to a node that reads a previous frame (Pass, Previous Frame, Echo, Fade, Grid Rules, Motion Blur) is left alone, because feedback is deliberate. So is anything inside an iterated group or loop, and anything passing through an Expression Block or custom function.
  - **False-positive bar:** fewer than 2% of the bundled examples may be flagged. Today none are (0 of 395).
- **Arrange by stage** (`src/structure/arrange.ts`). Open the ▾ beside **Auto layout** and choose **By stage**. Nodes are placed in left-to-right columns by stage, with the Output last.
  - Maths, time and constants sit in the column of the first stage they feed.
  - A loose group's members stay together in one column.
  - Empty columns are dropped and each column is stacked, so cards never overlap.
  - It is one undo step ("Arranged by stage"), and it lays out the level you're in.
- **In the builders.** The 3D Scene Builder (3D flow), Grid Rules (passes) and Agent Rules (agents) windows show their flow under the header.
  - Each stage has a line saying where it lives in that builder, for example "Quality: how far and how finely each ray steps". Stages that happen in the graph are outlined only.
  - The strip folds to the stage names, and the folded state is remembered.
  - Empty sections (an empty scene tree or an empty rule list) add a "Next in the flow: …" line. The data is in `src/structure/builders.ts`.

Settings are listed in Files → App settings → Studio:

- `playfield:structure:strip`
- `playfield:structure:tags`
- `playfield:structure:notices`
- `playfield:structure:dismissed`

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
395 bundled examples: 240 2D, 61 3D, 36 Passes, 58 Agents.

**2D** — 240 examples, 830 stage links. Forward 703, same stage 87, feedback 0, colour into an input 25, backward 15: **97.9% of order-carrying links follow the flow**; 10 of 240 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Space → Shape | 176 | 73.3% |
| Shape → Shape it | 120 | 50% |
| Shape it → Post | 88 | 36.7% |
| Shape → Colour | 74 | 30.8% |
| Colour → Post | 36 | 15% |
| Space → Bend space | 33 | 13.8% |
| Space → Colour | 26 | 10.8% |
| Bend space → Shape | 25 | 10.4% |
| Space → Post | 11 | 4.6% |
| Bend space → Colour | 9 | 3.8% |

| Stages feeding the Output | Examples |
|---|---:|
| Space → Shape → Shape it → Post | 85 |
| Space → Shape → Colour | 31 |
| Space → Shape → Colour → Post | 29 |
| Space → Colour | 14 |
| Space → Shape → Shape it | 12 |
| Space → Shape | 7 |

**3D** — 61 examples, 555 stage links. Forward 448, same stage 105, feedback 0, colour into an input 0, backward 2: **99.6% of order-carrying links follow the flow**; 2 of 61 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Camera → March | 44 | 72.1% |
| Scene → March | 43 | 70.5% |
| Bend space → Objects | 24 | 39.3% |
| Objects → Combine | 15 | 24.6% |
| Objects → March | 15 | 24.6% |
| March → Post | 14 | 23% |
| March → Colour | 13 | 21.3% |
| Combine → Scene | 12 | 19.7% |
| March → Lighting | 9 | 14.8% |
| Scene → Lighting | 9 | 14.8% |

| Stages feeding the Output | Examples |
|---|---:|
| Objects → March | 15 |
| Camera → Bend space → Objects → Scene → March | 7 |
| Camera → Bend space → Objects → Combine → Scene → March → Lighting → Post | 5 |
| Camera → Objects → Scene → March | 4 |
| Camera → Bend space → Objects → Scene → March → Colour | 3 |
| Camera → Objects → Scene → March → Lighting → Colour → Post | 3 |

**Passes** — 36 examples, 348 stage links. Forward 197, same stage 46, feedback 102, colour into an input 0, backward 3: **98.5% of order-carrying links follow the flow**; 2 of 36 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Source → Pass | 18 | 50% |
| Pass → Read out | 16 | 44.4% |
| Pass → Rule | 15 | 41.7% |
| Read out → Colour | 11 | 30.6% |
| Pass → Colour | 8 | 22.2% |
| Source → Read out | 6 | 16.7% |
| Source → Colour | 6 | 16.7% |
| Source → Rule | 3 | 8.3% |
| Rule → Read out | 3 | 8.3% |
| Pass → Post | 2 | 5.6% |

| Stages feeding the Output | Examples |
|---|---:|
| Source → Pass → Rule → Read out → Colour | 9 |
| Rule | 9 |
| Source → Pass → Read out → Colour | 6 |
| Source → Pass → Rule | 4 |
| Source → Pass → Colour → Post | 2 |
| Source → Pass → Rule → Read out | 2 |

**Agents** — 58 examples, 415 stage links. Forward 275, same stage 89, feedback 41, colour into an input 8, backward 2: **99.3% of order-carrying links follow the flow**; 2 of 58 examples have any backward link.

| Link | Examples with it | Share |
|---|---:|---:|
| Move → Draw | 34 | 58.6% |
| Move → Deposit | 32 | 55.2% |
| Deposit → Trail | 32 | 55.2% |
| Sense → Draw | 27 | 46.6% |
| Steer → Move | 25 | 43.1% |
| Sense → Move | 19 | 32.8% |
| Trail → Draw | 17 | 29.3% |
| Sense → Steer | 16 | 27.6% |
| Sense → Trail | 9 | 15.5% |
| Trail → Colour | 9 | 15.5% |

| Stages feeding the Output | Examples |
|---|---:|
| Sense → Move → Deposit → Trail → Draw | 10 |
| Sense → Steer → Move → Deposit → Trail → Draw | 9 |
| Sense → Draw | 8 |
| Draw | 5 |
| Sense → Move → Deposit → Trail → Draw → Colour | 5 |
| Sense → Steer → Move → Draw | 4 |

<!-- stats:end -->

What the data changed:

- Picking a colour is `any`, because colour constants used as tints made "Colour → Shape" look common.
- Feedback and tint links are counted separately.
- In the 3D flow, Lighting comes after March: in the examples, March → Lighting appears in 9 graphs and Lighting → March in none.

## Limits

- A graph has one flow. A 2D picture composited over a 3D scene reads as 3D, with the 2D stages aliased.
- The Output's stage is the *furthest* stage that feeds it, so one late node, such as a tone map, sets it.
- Order notices cover three common accidents. They aren't a linter.
- Notices dismissed in unsaved work share one key, `(unsaved)`.
- Stage tags are on the regular node card. Special cards, such as the Agents group card, don't show them.
- Arrange by stage doesn't move a collapsed loose group's box, only its members.
