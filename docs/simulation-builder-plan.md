# Simulation builder: plan

Wave 6, item 17 (`docs/plan-2026-10-10.md`); the backlog's "Simulation builder (bigger idea)"
(`docs/backlog-2026-10-10.md`). Phase 1 is built on `claude/w6-simulation-builder`; movers (phase 3's
headings and collisions), stacked rules as nodes (1b) and the grid builder's half are built on
`claude/simulation-p2` (below, "Phase 2 of the build").

## Your answers

- Simulations live as a **mode of the existing kinds** (Grid scene → Grid Rules; Agent scene).
- A cluster is a **local crowd** (as built), not a connected clump.
- Cells carry a **heading** for real collisions (built: Move and Collide cards).
- Stacked rules must **open as nodes**, each card an extra pass (built).
- Blocks, sand and gas **skip** stacked rules (as built).
- JS bodies are **skipped**.
- **One shared vocabulary** across grid cards, Agents rules and the builders' sentences.

What you asked for:

- stack rules on a base (start from Game of Life, add "two cells colliding explode into N copies");
- conditions: collisions, direction, crowding, clusters;
- actors, behaviours and conditions as a standard simulation toolkit;
- some simulations may live better as JavaScript layers (bouncing balls that grow or shrink when they
  collide, spawning within bounds).

## Open questions (with the answers I recommend)

1. **Where does it live in the Scene builder?** As a mode of the kinds that are already there, not a
   fifth kind. *Recommended:* cell simulations stay under **Grid scene → Grid Rules**, with
   **Stacked rules** as a section (built in phase 1). Body simulations (phase 2) go under **Agent
   scene** as a "Bodies" start, since the Agents layer already has actors, rules and groups. A
   "Simulation" kind would only route to these two, so it would add a click and nothing else.
2. **What does "collide" mean on a grid?** Cells don't move in Life, so nothing collides in the
   physical sense. *Recommended (built):* **"cells meet"**, a live cell with a set number of live
   neighbours (default exactly 1: two cells touching and nothing else round them). With Drift or a
   moving base (gliders), meetings happen where things run into each other. A true "two movers
   arrived at the same cell" collision needs a direction per cell (a state per heading, as in the
   HPP gas). I'd leave that for phase 3 (Movers).
3. **Is a cluster a connected clump or a local crowd?** A connected clump of any size (flood fill)
   doesn't fit one GPU pass. *Recommended (built):* **local density**: a live cell with at least K
   live cells in a square of radius R. It behaves like "a big clump" for clumps up to 9 × 9. Real
   connected-component sizes (jump flood on the GPU) are phase 3, only if local density falls short.
4. **Should stacked rules work on Blocks (sand, gas) and Smooth?** *Recommended:* not now. Blocks
   rules move cells in pairs to keep counts, and a card that adds or removes cells breaks that. Smooth
   holds numbers, not states. The cards are kept on the node but don't run on those two; the section
   says so.
5. **Should stacked rules open as nodes?** *Recommended:* later (phase 1b). Each card would be a
   second Pass of Sample cards, which is a large graph to learn from. Open as nodes says "switch the
   cards off" for now.
6. **Phase 2 bodies: extend the Agents layer, or a new layer?** *Recommended:* extend the
   **Agents layer** (Play, `docs/agents-layer.md`). It already has entities with position, velocity,
   size, energy and groups, a seeded fixed-step stepper and an ordered rule stack. What it lacks is
   contact between bodies and "on contact" actions.
7. **One words list?** *Recommended:* yes, one toolkit vocabulary (below), shared by the grid cards,
   the Agents layer's rules and the builders' sentences, so "when two meet, explode into 8" means the
   same thing in each.

## The model

A simulation is **actors** stepped by **behaviours**, each behaviour gated by a **condition**, on top
of a **base**:

| Piece | On a grid (GPU) | As bodies (JS layer) |
|---|---|---|
| **Actor** | a cell and its state (0 empty, 1 live, 2… stages) | a body: position, velocity, size, colour, energy, group |
| **Base** | the Grid Rules rule: Life, a Stages rule, Stencils | the motion: gravity, bounce, wander, the Agents layer's steering rules |
| **Condition** | meet (n live neighbours), crowded (≥ n), in a cluster (≥ n within R), the way is clear (direction) | touching (another body, a wall), crowded (n within R), heading (angle), in a cluster, age, size, energy |
| **Behaviour** | explode into copies, die, step away, drift, change state | grow, shrink, split, merge, bounce, explode, spawn within bounds, die, change group, send a signal |
| **Chance** | rolled per cell and step (dice the GPU and CPU share) | rolled per body and step (the layer's seeded source) |

**Base plus stacked rules.** The base runs first, then each card in order, each on the board (or
bodies) the one before left. Order is part of the design: a later card has the last word. "Crowd →
explode" lets the cells crowding left alone explode; "explode → crowd" never sees them. Tested in
`gridRulesStack.test.ts`.

**Gathered, not scattered.** On the GPU each cell can only write itself, so every card is written
as "what becomes of me, given what is round me": a copy lands on an empty cell because a meeting
cell sits `distance` away in one of the copy directions. Two movers aiming at one empty cell leave
one cell there (the other is lost). Explode only fills empty cells. Bodies in JS can scatter freely.

## GPU or JavaScript

| Goes to the GPU (Grid Rules + stacked rules) | Goes to JS layers (Agents layer, later Bodies) |
|---|---|
| Many identical actors on a lattice, thousands to millions of cells | Tens to a few thousand bodies, each its own size and shape |
| Neighbourhoods are fixed offsets (8 round, a radius) | Neighbours by distance, any position (spatial hash) |
| State is a few whole numbers per cell | State is floats per body, plus lists (who touched whom) |
| Rules are the same for every cell, every step | Events: on contact, on catch, on leaving the bounds, firing signals |
| No conservation needed, or Margolus blocks for it | Momentum, bounces and size changes that must be exact |
| Examples: Life + explode, crowded cells stepping away, wind, burning clumps | Examples: bouncing balls that grow when they collide, cells that split in two, spawning inside a shape |

Why: a fragment shader is a gather over a fixed neighbourhood. That is perfect for a lattice and
awkward for anything with a size, a velocity or an event ("A hit B"). The Agents layer already
steps bodies in fixed 1/60 s steps with a seeded random source, so a body sim replays the same in
a take or an export. Between them: a grid can be read by bodies (the Agents layer's "picture under
it" already reads a texture), and bodies can be drawn into a grid's start image.

## How it appears in the builders

- **Grid scene → Grid Rules → Stacked rules** (built): a section after Neighbourhood, for Count,
  Stages and Stencils. A chain line ("Base: Count B3/S23 → 1 explode → 2 drift"), one card per rule
  with its sentence and settings, **Add another card** (the four kinds), and **Or start from one**
  (base and cards together). Pointing at a card lights, on the try board, the cells it changes next
  step. The nav summary reads "+ explode, drift"; the node's card reads "Count B3/S23 + 2 rules".
- **Agent scene → Bodies** (phase 2): a start beside the Agent Builder's kinds; the same card
  language (When two touch → grow).
- **As text** everywhere: the grid's `then` lines (`then explode copies=8 distance=3 chance=0.05`)
  are the model for the bodies' lines.

## Phases

1. **Stacked rules on a cell grid** *(built)*: four cards on Grid Rules (explode when cells meet,
   crowding: die or step away, drift in a direction, clusters change), GPU stages in the board Pass's
   Repeat, the same step on the try board's CPU, recipes, `then` lines, tests. Details in
   [grid-rules.md](grid-rules.md#stacked-rules).
   - 1b: Open as nodes with cards; card numbers as live uniforms (no recompile on a slider); a
     "when" picker on every card (any condition with any behaviour, not four fixed pairs).
2. **Bodies on the Agents layer (JS)** *(skipped, your answer)*: a **Touch** condition (two bodies' circles overlap, a body
   and a wall) with **grow / shrink / split / merge / explode / die / change group / signal**
   actions; **Spawn within bounds** (a rectangle, a circle or a shape layer's outline); size as a
   per-body state that collisions read. Presets: "Balls that grow when they meet", "Cells that split
   at a size", "Fireworks". An **Agent scene → Bodies** start.
3. **Movers on the grid** *(built, below)*: cells with a heading (extra state in red's fraction, not
   states per direction), so "two movers arrive at the same cell" is a true collision. Connected-
   cluster sizes with a jump flood stay unbuilt (you chose local crowds).
4. **One toolkit**: the condition and behaviour words shared across grid cards, Agents rules and
   Play's When/Do, so a card can move between them; Surprise me for stacks.

## Phase 1, as built

| What | Where |
|---|---|
| The cards: types, read, sentences, recipes, the CPU step, the GPU stage | `src/gridRules/stack.ts` |
| The board's stages (base, then each card) | `src/gridRules/glsl.ts` (`gridStepGLSL`), `src/compiler/gridRulesExpand.ts` (Repeat = Steps × (1 + cards), the Step wired in) |
| The try board's step | `src/gridRules/cpu.ts` (`cpuStep` runs the cards; `cpuStepUpTo` for one card's picture) |
| The section | `src/components/gridRules/StackForm.tsx`, `builderLayout.ts gridRulesSections`, `TryBoard.tsx` (`focus.card`) |
| As text | `src/lang/dialects/grid.ts` (`then` lines) |
| Tests | `src/compiler/__tests__/gridRulesStack.test.ts`, `gridRulesBuilderUi.test.tsx` |

## Phase 2 of the build (`claude/simulation-p2`)

| What | Where |
|---|---|
| Headings (red = state + heading / 32), the Move and Collide cards, the heading filter on every card, flying copies, recipes, CPU step and GPU stage | `src/gridRules/stack.ts`, `stackRecipes.ts` |
| The base keeps a staying cell's heading; drawn headings dealt | `src/gridRules/glsl.ts`, `cpu.ts`, `startCells.ts` (`heads`) |
| Arrows on the try board (draw, show, Use as the start) | `src/components/gridRules/TryBoard.tsx`, `useTryRun.ts`, `gridRules/tryRun.ts` (`paintCell`) |
| The cards' settings | `src/components/gridRules/StackForm.tsx` |
| Stacked rules open as nodes (a Pass a card); big neighbourhoods in one block | `src/store/gridRulesAsNodes.ts` |
| As text | `src/lang/dialects/grid.ts` (`then move`, `then collide`, `heading=`) |
| Tests | `src/compiler/__tests__/gridRulesMovers.test.ts`, `gridRulesAsNodes.test.ts` |

**The GPU scheme** is claim and resolve, gathered: every mover claims the cell ahead; a cell that is
empty and claimed once takes its mover; anything else is a conflict. Collide (one stage) settles the
conflicts it sees, Move (the next stage) moves the rest, so a step is the two passes of the scheme.
No cell is ever written by two, and moving, bouncing, turning and stopping keep every cell. The CPU
try board runs the same card on the same dice, so it steps exactly as the GPU (value for value,
headings included). Details: [grid-rules.md](grid-rules.md#movers-headings-and-collisions).

**Open as nodes** with cards: the base Pass, then a Pass a card (an Expression Block whose function is
the node's own stage GLSL), the base reading the last card's Previous. Same boards as the node, step
for step, one step a frame.

**Grid builder** (docs/grid-builder.md): rules that stay changed, if / then / else and and / or, and
a state per drawn shape in Make it a simulation.

**Agent Builder**: pause, step one frame, and step back through kept frames (docs/agent-builder.md).

### Next

- Card settings as live uniforms (an edit recompiles today).
- A "when" picker on every card (any condition with any behaviour), sharing the words with Play's
  When/Do (phase 4).
- Diagonal bounces that reflect off a flat wall (a blocked diagonal mover turns round today).
- Movers longer than one cell (a heading shared by a clump).
