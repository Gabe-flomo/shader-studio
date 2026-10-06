# Suggestions

Select a node and a small **Suggestions** strip appears under its card with the 3–5 moves most
likely to come next: Glow, Rings or Onion for a distance; a warp, Polar or Repeat in front of a
shape's UV; Tone map or Grain for a colour. Each has a one-line *why*. Click one and it is applied
in place, as one undo step, with a note on every node it adds.

Everything is deterministic and offline: no AI, no network. The ranking learns from **your own
graphs**, and it all stays in this browser.

## In plain words

- **What it offers** depends on what the node carries (its *kind*): a distance, a mask, a colour, a
  space (UV), a texture, 3D, or a plain number. A circle's distance gets distance moves; its UV
  input gets space moves.
- **The order** comes from three things, strongest first:
  1. **What its preview shows**, when the eye is on it and the reading is confident: "clips 10% to
     white" puts Tone map first.
  2. **What you usually do**: "you often add Outline (distance) after Circle SDF".
  3. **What fits the kind**, with a short reason: "a distance: lights the edge".
- **The why** says which: the measurement, your habit, "common after Circle SDF in the examples"
  (while you have little data of your own), or the kind.
- **Hiding it**: the × on the strip, or the ⚡ button in the canvas toolbar (it brings it back).
  App settings → Studio lists "Suggestions under the selected node".
- **Reset learning**: App settings → Studio → "Suggestions: what they learned from your graphs" →
  Reset. The suggestions forget your graphs and wiring and start again from the examples; graphs
  saved before the reset are not read again.

The strip sits under the card (above it when there is no room), never over a socket: sockets are
on the card's sides. It hides while you drag, while a starter-recipe offer is open, on a locked
canvas, and when the card is off screen.

## The moves

| Kind | Moves | How |
|---|---|---|
| Distance | **Glow** (SDF Glow, laid over the picture), **Rings** and **Outline** (Outline (distance), laid over), **Onion**, **Grow / round** (Offset), **Smooth blend** with another shape (Union with K), **Mask from it** (SDF Mask) | Onion, Grow and Blend go in place: what read the shape reads the result |
| Space (a UV input, or a UV output) | **Warp** (Domain Warp), **Swirl**, **Twist** (an Expression Block), **Polar**, **Mirror**, **Repeat** (Tile), **Repeat around** (Angular Repeat), **Zoom / rotate** (UV Transform), **Custom code here** (an Expression Block between) | In front of an input it goes between the input and its source (a UV node is added when nothing was wired); after an output, in place |
| Colour | **Mix with…** (OkLab Mix + a Color), **Palette** (by brightness), **Tone map**, **Grade** (Lift / Gamma / Gain), **Brighter**, **Glow** (Bloom), **Grain**, **Blend** (Blend Modes with a stand-in picture), **Trails** | In place |
| Mask | **Soft edge** (raises the node's own softness when it has one, else Smoothstep), **Invert**, **Grow / shrink**, **Mix two pictures** (Mask node: the picture inside, a stand-in outside) | |
| Texture | **Blur**, **Glow**, **Trails**, **Outline** (Edges), **Flow** (Flow + Read) | On a Pass that feeds nothing yet, Blur, Glow and Outline hand over to the Pass's own starter recipes |
| Number | **Palette**, **Remap**, and the quick-add rules for the socket ("Add Float → Color"…) | |
| Fixes (from the preview) | **Lower / Raise intensity** (the node's own setting; SDF Glow's Falloff the other way), **Wire UV in**, **Add noise**, **Add a gradient**, **Dither**, **Turn on Jitter** (march loops) | Only offered by the output rules |

Reuse, not duplication: Trails adds a Fade node and runs Fade's own "Trails" starter recipe; a
Pass's Blur / Glow / Outline use the Pass recipes; the generic "add a node here" moves are the
quick-add rules (`quickAdds.ts`) turned into moves. The "custom code" move is the Expression Block.

How a move is shown when it makes something new (a branch):

- light (Glow, Rings, Outline, a texture's Glow and Outline) is **added over** what the Output
  shows, with Add Colors;
- a whole new picture (Mix two pictures, Blur, Flow, Palette from a number) **goes on** the Output;
- a mask goes on the Output only when it shows nothing yet (as grey).

A transform that had nothing to take over (the socket fed nothing) is shown the same way when the
Output is empty: a distance painted with SDF Fill, a number as grey. On the top level, an Output
is added when the graph has none.

After a move, its result node is selected, so the next suggestions follow the chain.

## Ranking

```
score = kind fit + 3 × usage + 4 × output finding          (each 0…1)
```

- **Kind fit**: the node's main output 1 (a colour output leads, as the preview picks), other
  outputs 0.6, its space inputs 0.8 (0.5 when the node is itself a space), the quick-add rules 0.4,
  "Custom code here" × 0.4.
- **Usage**: how strongly the move's node follows this socket in the learned table, socket to
  socket (`circleSDF.distance → light.distance`), else node to node × 0.6. Strength is
  P(next | this), damped for rare pairs (`count / (count + 1.5)`) and for pairs no more common
  than chance (lift near 1: everything feeds the Output).
- **Output**: a confident finding's severity (below).
- Ties keep the library's order.

### The co-occurrence table (`suggestions/usage.ts`)

Every wire is a pair `from-type.output → to-type.input`. Ends are normalised: old node types go to
their canonical node with renamed socket keys (`nodes/definitions/aliases.ts`), `__param_x` is
`x`. Expression Blocks, Custom Functions, groups and For Loops are **wildcards**: a wire into one
says nothing about which dedicated node to suggest, so it isn't counted. A graph counts each pair
**once** (into groups at any depth). The table keeps counts with their margins, so it gives
P(next | this) and lift.

### Where the counts come from (`suggestions/learning.ts`)

| Source | Weight | When |
|---|---|---|
| (a) Your saved graphs | 1 | When you save; and on first use, every graph already saved here |
| (b) Graphs that arrived another way: imported files, converted GLSL, bulk imports, graphs a workspace folder brought in | 0.5 | On import / convert; a saved graph that changed without your Save is "arrived" |
| (c) Wires you make (and moves you pick) | 0.75, halving every week | As you work |
| (d) The bundled examples | a prior worth 40 wires × 40 / (40 + yours) | Always, fading as yours grows |

The examples prior (`suggestions/examplePrior.json`) is built at build time from every example,
counting each pair once per example, and **identical templates share one example's weight** (the
many tiny circle → glow graphs don't dominate). Regenerate it after adding examples:

```
WRITE_PRIOR=1 npx vitest run src/suggestions/__tests__/examplePrior.test.ts
```

**Incremental**: each graph is stored with a signature of its saved text and re-read only when it
changes; deleted graphs are forgotten. The store listens for saves (`saved-graphs-changed`) and
other tabs, and catches up when the browser is idle.

**Storage**: localStorage `playfield:suggestions:learning` (outside the `shader-studio` keys, so
the workspace folder doesn't sync it): one dictionary of pair strings, each graph a list of
indices, the last 400 wires. Typically tens of KB. **Nothing leaves this device.**

### Also ranked by it

- **Quick add** (Smart connect's "add a node"): up to two learned picks for the clicked socket come
  before the hand-written rules, noted "you often use it here" or "usually goes here".
- **Search**: results that usually go with the node you came from (the socket's node, or the
  selected node) get a nudge within their match tier; browsing with an empty query shows a
  **Usually next** group first.
- **Switch to**: within each family, the compatible siblings are ordered by how often each sits
  between this node's neighbours.

## Output-aware suggestions (`suggestions/outputRules.ts`)

When the eye preview is on the selected node, its readback (`lib/nodePreview`, about 256 × 144
float texels) is measured at most once a second:

| Finding | Confident when | Fix |
|---|---|---|
| Clipping | > 5% of a colour or a glow at or past white | Tone map; lower the node's intensity (SDF Glow: a higher Falloff) |
| Mostly black | > 85% black, a colour or a number | Raise the intensity; Brighter (colour); Remap min…max → 0…1 (number) |
| Flat | the value is exactly the same everywhere | Wire UV in (an unwired space input); else a gradient (colour) or noise (number) |
| Aliased hard edge | > 90% of the 0.5 crossings jump straight between exactly 0 and 1, and under 3% of the picture is in between | Soft edge |
| Banding | most neighbours equal, the rest one equal small step, 4–64 levels | Jitter on a march loop; Grain on a colour; Dither on a number |

Nothing is offered when fewer than 95% of the texels are finite, or for nodes that are meant to be
flat, stepped or clipped (Posterize, Floor, Step, Compare, Color, Constant, Time, Halftone…).

## Files

| Piece | Where |
|---|---|
| Kinds | `src/suggestions/kinds.ts` |
| Co-occurrence table | `src/suggestions/usage.ts` |
| Example prior (built) | `src/suggestions/prior.ts`, `examplePrior.json` |
| Learning store | `src/suggestions/learning.ts` |
| Moves | `src/suggestions/moves.ts` |
| Applying a move | `src/suggestions/applyMove.ts`; the store's `applySuggestion` (one undo step, compile, toast) |
| Output rules | `src/suggestions/outputRules.ts` |
| Ranking | `src/suggestions/rank.ts` |
| Strip and toolbar toggle | `src/components/NodeGraph/SuggestionStrip.tsx`, `src/suggestions/settings.ts` |

## Limits

- The output rules only see the node under the eye preview (the readback exists for that node).
- The readback is small, so the hard-edge test can't see a one-pixel antialiased edge as soft at
  full size; it only fires on exact 0/1 masks.
- 3D nodes get no moves yet (the 3D Scene Builder owns that); their kind is recognised.
- Linked folders that aren't mirrored into this browser's storage are not learned from.
- Moves apply inside groups too, but nothing is put on an Output there.
