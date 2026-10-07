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

## The Do… bar

**⌘K**, or the ✎ button in the canvas toolbar. Type what to do; a live preview lists the steps that
will run with their values, and how each word was read. Enter runs them all as **one undo step**.

```
circle in the middle with a glow, falloff 8     → Add Circle SDF at 0, 0 · Glow, falloff 8
add rings                                        → Rings on the selected shape
mix these colours                                → OkLab Mix of the two selected colours
smoothly blend the edges                         → Union with K of the two selected shapes
make it repeat 6 times around                    → Repeat around (Angular Repeat, 6) in front of its UV
twist the space 0.5                              → Twist (0.5) in front of its UV
tone map it                                      → Tone map on the colour it ends up as
```

### The Playfield language in the bar (`src/lang/`)

The bar reads the shared Playfield language (docs/playfield-language-plan.md). Plain English, as
above, is its sugar.

- **The canonical line.** Under the box, `→ circle · glow falloff=8` shows what was typed, in the
  language's own words. Clicking it puts that line in the box. When what you typed already is
  canonical, the row shows ✓.
- **Canonical lines run through the same executors as plain English.** `picture.ts` turns a line
  into the bar's sentence and runs it through `execCommand`. The tests check that every sentence in
  the corpus gives the same graph both ways.
- **Edit verbs leave "the" out.** For example: `set glow falloff=8`,
  `connect noise → glow.tint`, `insert tone-map between palette and output`, `it * circle`,
  `noise + it`, `mix(palette, glow) by=0.3`, `group(circle, glow) name="Neon"`.
- **Other dialects.** A line can also be a 3D scene (`surface · sphere · box at=(1,0,0)`, or any
  line with a 3D-only word), a Grid Rules line (`grid life walls`, or a preset name that is no
  other word) or an agents line (`species Slime: always do wander 7deg`). Enter builds a scene,
  adds Grid Rules or adds an Agents group with those rules. A line that mixes 3D-only and 2D-only
  words is refused.
- **Mistakes in a canonical line.** These are listed with their column and "did you mean". Each fix
  is a button.
- **Randomness.** Use `falloff=random`, `random(0.2..2)`, `random(red, teal)`, or a leading
  `random` (`random circle · glow · colour by length`). The row under the canonical line shows what
  was drawn, with **Roll again** and **Keep these**. `seed=42` repeats a result; without a seed,
  each run differs.
- **Surprise me.** The 🎲 button, or type `surprise me [small|medium|large] [2d|3d]`. It writes a
  whole line from the flow's order (space → shape → shape it → colour → post, or the 3D flow) for
  you to read, change and run (`src/lang/surprise.ts`).
- **History.** ↑ and ↓ bring back what you typed before, as you typed it (kept in this browser).
- **Type-ahead** comes from the language (`src/lang/barAssist.ts`):
  - after `create`, everything you can make, grouped;
  - after `connect`, the wires that fit on this graph (`uv → circle.position`), ranked by how often
    people make them;
  - after `set <node>`, its settings with their values;
  - a signature line for every head.
- **Good defaults.** A line with no numbers looks good. `circle · glow · colour by length` and a
  sample of about 60 lines like it are rendered headless. `src/lang/__tests__/defaults.test.ts` checks
  that none is blown out, invisible or flat (`tools/lang-defaults-render.mjs` records the frame
  stats). To get there:
  - a 2D box starts the size of the circle;
  - an outline starts 0.02 wide;
  - colour by length cycles its palette 2.5 times in view;
  - a colour step after a glow on a new shape works on the picture;
  - a bend after a glow bends the shape's space.

### How a phrase is read (`suggestions/doBar.ts`)

One left-to-right pass over a fixed vocabulary (`src/lang/vocabulary.ts`):

| Words | Examples |
|---|---|
| Shapes (2D and 3D) | circle / disc / dot, box / square, ring, heart, triangle, hexagon, star, cross, moon, diamond, ellipse, line; and every Scene Builder shape and alias (sphere / ball, torus / donut, capsule / pill, cylinder / pillar…) |
| Actions (≈30, with synonyms) | glow / halo / neon, rings / ripples, outline / border, onion / hollow, round / grow, blend / melt / smooth union, warp / distort / noise, swirl, twist / spiral, polar, mirror, repeat / tile (… around → repeat around), zoom / rotate, mix / tint, palette / colorize, tone map / aces, grade, brighter, grain / dither, soften / feather, invert, blur, trails / feedback, flow, remap |
| Targets | it / this (the selection), these / both (the two selected), the space / uv (the UV input), the picture (what the Output shows) |
| Parameters | falloff, count (times, x, copies), amount (strength, by), thickness / width, smoothness / k, radius / size, speed, angle (degrees or radians), zoom |
| Values | numbers (0.5, six, half), counts ("6 times", "8 rings"), colours (red … ice, #ff8800), places (middle, top left …) |

- A **shape** starts a new subject; a place and a bare size right after it go on the shape.
- An **action** is a step on the current subject: the last shape named, else what a target word
  says, else the selection, else the Output's picture.
- A parameter word with a number fills that slot; a colour fills the colour slot; a bare number
  fills the first number slot ("twist the space 0.5" → amount 0.5).
- The action is resolved by what the subject carries: **glow** on a distance is SDF Glow, on a
  colour Bloom, on a texture (a Pass) Glow (texture); a colour move on a shape goes to the colour
  it ends up as; a space move goes in front of the shape's UV.
- **Typos**: an exact word wins; otherwise one letter off for words of 4–6 letters, two for longer
  ones ("circel with a glwo"). Words under 4 letters must be exact. A colour word beats a typo of
  something else ("blue" isn't "blur"). Plurals fold ("circles").
- A phrase it can't run says why ("Blur works on a texture: select a Pass"); one it can't read
  falls back to **node search** (your made nodes included) and the explainer's **idioms**.

### Idioms (`suggestions/idiomBlocks.ts`)

The explainer's idiom library (`lib/glslPatterns`, `idiomVocabulary()`) is in the Do… bar:
"sine hash", "centre uv", "soft circle", "cosine palette"… offer the idiom; picking it adds an
Expression Block computing its first spelling, each `$hole` an input. A phrase read only by
guessing at typos ("sine" ≈ "shine") gives way to an idiom with that name.

### Grid Rules presets (`suggestions/doBarGridRules.ts`)

A Grid Rules preset's name ("game of life", "brian's brain", "falling sand", "reaction diffusion"…)
adds a Grid Rules node with that preset, with optional board size, speed and colours ("game of life
on a chunky board, fast, green on black"). The phrase must be only the name, slots and glue: any
other word sends it to the normal reading, and a name that is also an action ("ripples") needs a
grid word. Empty graph: wired to the Output; else beside the selection. See docs/grid-rules.md.

### Commands: sentences that edit the graph (`suggestions/doCommands.ts`)

The Do… bar also reads a small command language, documented verb by verb in
[do-bar-commands.md](do-bar-commands.md) (generated from `src/lang/commands.ts`; the **ⓘ** in the
bar, Keys → Do… bar commands, and More tools open the same reference in the app).

- **Clauses**: a sentence splits at commas, "then", "after that" and "and" before a verb. Each
  clause is a verb with its slots, or a build phrase as above; "it" is what the clause before made,
  so "create a ring with falloff 0.3, colour it with a palette by the length of the space, multiply
  it by the circle, then output it" builds in four steps.
- **Edit verbs**: create, connect, disconnect, reconnect, insert (between / after / before),
  multiply / add / subtract / divide / mix / screen / overlay / union / intersect / cut, output,
  switch (the card's Switch to, `nodes/switchNode.ts`), delete, rename, duplicate, set, make
  bigger / smaller / brighter… (increase, double, halve), group, select, colour … by ….
- **References** (`suggestions/doRefs.ts`): "it", "this", "these", a quoted label, a type ("the
  circle", "the noise"), a role ("the current output", "what feeds the output"), a position ("the
  node before the output", "the second circle", "circle 2"), "all circles". When a name fits
  several nodes the selected one (or "it") wins; else the preview lists them, points at them on the
  canvas, and waits for a pick.
- **Preview**: every clause runs on a copy of the graph, so the bar lists numbered steps with the
  exact nodes, wires and values (a diff). A clause it can't read, a reference that fits nothing, or
  a wire whose types don't fit (`lib/typesCompatible.ts`) is marked with why and "did you mean" /
  fixes you can click; the rest still previews, and Enter waits until all of it reads.
- **Running**: the store's `runCommand` runs it again with real ids as one undo step (a final
  "group …" inside the same step).
- A sentence of build phrases only still goes to the phrase language whole, as before.

### Shared with the 3D Scene Builder

`src/lang/vocabulary.ts` folds in the Scene Builder's shapes and aliases (`sceneBuilder/spec.ts`),
so "donut", "pill" or "box frame" name the same node in both languages (`sceneKind` gives the
Scene Builder's own kind), and `ACTION_TO_SCENE_WARP` maps the space actions onto its warps
(twist → twist, repeat around → polar-repeat, warp → noise…). A test keeps both in step.

### Outputs of a 3D scene (`suggestions/doOutputs.ts`)

"output the depth", "show the normals", "colour it by distance with a palette", "colour by
height palette fire", "show the picture". The phrase names one of the Scene Builder's outputs
(`sceneBuilder/output.ts`: depth, distance, height, normal, hit, position, steps, ao, shadow) and
optionally a palette; "colour … by" without one uses sunset. On a scene the Scene Builder made,
the scene is rebuilt with that output in its spec (so the builder, its recipe and Describe show
it); on a hand-made March Loop or GI Lit March the same nodes the builder makes
(`emitOutput`) are added beside it and wired into the Output. Volumetric and Glass scenes say why
they keep the picture; with no 3D scene the bar says to build one.

### Type checks

A move is refused up front when the value can't be wired into it: the graph's own rule decides
(`lib/typesCompatible.ts`, through `lang/typeCheck.ts`), and the message says why and how to fix
it. "remap it" on a Palette: "Can't wire that: Palette · Color is three numbers (vec3), Remap
takes a number (float). Fix: use its brightness (Luminance), or take .x." Each fix is a button that
runs a ready plan: a Luminance node (or an Expression Block taking .x / the length), then the
move on it. Make a node refuses "Use it here" when an input is retyped so the value it stands for
can't feed it (a vec3 into a float), with **Keep it vec3**.

### Type-ahead

The bar completes the word at the caret from the vocabulary (`lang/complete.ts`): "circ" offers
*circle → Circle SDF* first, then *cylinder*; each line has its one-line description and how it
is written. After an action, its settings show below ("glow falloff 10 colour"). Tab takes a
suggestion; Enter still runs the phrase.

### Is this typical? (`suggestions/connectionCheck.ts`)

On demand: type "is this typical?" (or "how common", "check this") with a wired node or a few
wired nodes selected, or **right-click a wire's + badge**. It answers from the same weighted usage
table as the ranking:

- "Seen in 4 of your graphs, 1 imported graph, about 12 in the examples. Usually followed by
  Palette." (A chain counts the graphs that hold every wire of it.)
- Rare: says so, with the nearest common alternatives ("Circle SDF → SDF Glow · Distance",
  "Abs · Output → Hue Rotate").
- A chain in 3 or more of your graphs offers **Teach this?**.

It is not shown in the background (on demand only).

### Teaching it a phrase (`suggestions/taught.ts`)

Select some wired nodes (or one node with the settings you like), type "teach …" in the Do… bar
and give a phrase with optional slots: `neon edge {colour} {width}`.

- **What is saved**: the selection, with the wires between them.
- **Where the value comes in**: the first wire from outside.
- **Where the result goes out**: the first output read from outside, else the last node's main output.
- **Slots**: each slot is matched to a setting by key, label or vocabulary synonym ({colour} → Tint, {falloff} → Falloff).

Then:

- typing the phrase builds that chain with the slots filled ("neon edge pink 0.02", or "width 0.02");
- the suggestions strip offers it, ranked with the rest, on the same kind of value;
- a chain with no input ("cloudy colours") is added on its own.

The ☆ list in the Do… bar renames, deletes, exports and imports them. They are stored in this
browser (localStorage `playfield:suggestions:taught`).

## The snippet library (`suggestions/snippets.ts`)

The Functions panel of the Expression Block and Custom Function editors has a **Snippets** section,
searchable by name and phrase with the panel's filter:

- smooth min / max
- SDF round, onion and repeat
- IQ cosine palette
- hash, value noise
- rotate 2D, to polar
- remap, gain, bias

- **Expression Block**: Insert appends the snippet's lines, wired to the block's variables. The
  first float it reads takes the block's first float, and so on; temporaries are renamed past any
  name already taken. When the block still returns a bare input of the same type, the result
  switches to the snippet's value.
- **Custom Function**: Insert adds the helper function once (to Helper functions) and a call at the
  caret, with the function's own inputs as arguments. Helper names avoid the built-in nodes' own
  functions (smin, opRepeat, valueNoise), which would clash in a graph using those nodes.

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
| Shared vocabulary | `src/lang/vocabulary.ts` |
| Do… bar language, plans | `src/suggestions/doBar.ts`; the store's `runDoPlan` (one undo step) |
| Do… bar UI | `src/components/NodeGraph/DoBar.tsx`, `src/suggestions/doBarStore.ts` |
| Command language | `src/suggestions/doCommands.ts` (clauses, verbs, diffs), `src/suggestions/doRefs.ts` (lexer, references); the store's `runCommand` |
| Command registry, reference, docs | `src/lang/commands.ts`; `src/components/NodeGraph/DoCommandsReference.tsx`; `docs/do-bar-commands.md` (`npm run docs:do-bar`); scratch graphs `src/suggestions/doScratch.ts` |
| Connection check | `src/suggestions/connectionCheck.ts` |
| Taught phrases | `src/suggestions/taught.ts` |
| Idioms as blocks | `src/suggestions/idiomBlocks.ts` |
| Snippets | `src/suggestions/snippets.ts`; `components/code/ReferencePanel.tsx` (`onSnippet`) |
| Output phrases, type fixes | `src/suggestions/doOutputs.ts` |
| Type-ahead | `src/lang/complete.ts`; `components/builders/TypeAhead.tsx` |
| Type checks | `src/lang/typeCheck.ts` (wires through `lib/typesCompatible.ts`) |

## Limits

- The output rules only see the node under the eye preview (the readback exists for that node).
- The readback is small, so the hard-edge test can't see a one-pixel antialiased edge as soft at
  full size; it only fires on exact 0/1 masks.
- 3D nodes get no moves yet (the 3D Scene Builder owns that); their kind is recognised.
- Linked folders that aren't mirrored into this browser's storage are not learned from.
- Moves apply inside groups too, but nothing is put on an Output there.
- The Do… bar builds 2D; 3D shapes are recognised and sent to the Scene Builder.
- A build phrase works on one subject at a time; "these" means the first two selected. Sentences
  of clauses (the command language) chain subjects through "it".
- Commands work on the level being edited; "group" goes last; see do-bar-commands.md → Limits.
- A taught move keeps one way in and one way out; other wires from outside the selection are dropped.
- Idiom blocks use the idiom's first spelling with 1.0 for unnamed number holes.
