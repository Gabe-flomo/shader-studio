# Expression Builder

Grow a GLSL expression one move at a time. You start from a seed (UV, a world position, time, or
a variable), and the builder shows the moves that real shaders apply next, each as a small picture
of *your* expression with that move applied. Pick one, and the grid updates for the result. When
you like what you see, **Add to graph** turns the chain into an Expression Block.

Open it from:

- the node browser's **Builders** section (**Expression Builder**);
- the empty canvas's right-click menu → **Builders**;
- the Do… bar: "new expression", "expression builder", "build an expression".

The plan, with the phases still to come, is in [expression-builder-plan.md](expression-builder-plan.md).

## A worked example: a grid of dots

1. Start from **UV**.
2. **Repeat**: `fract(x * 4)` cuts the picture into 4 × 4 cells, each running 0…1.
3. **Centre**: `x - 0.5` puts (0, 0) in the middle of every cell.
4. **Circle**: `length(x)` is the distance to that middle: a grid of round gradients.
5. Add an edge (`smoothstep(0.3, 0.25, x)`, under Same type) for crisp dots.

The "How this works" cards have this example as a button (**UV → Repeat → Centre → Circle**).

## The window

| Part | What it does |
|---|---|
| **Chain** (left) | The expression so far, one row per step, each with its picture. Click a row to go back to it. The rows after it stay, dimmed, until you pick a different move; picking the same one walks forward onto them. The sliders button on a row tunes that step at any time. |
| **Next moves** (middle) | The grid. **Same type** (vec2 → vec2: zoom, move, repeat, fold, warp…) is open; **Changes the type** (`x.x`, `length(x)`, a colour from space) and **Recipes** (moves seen together, added as one row per step) are folded, with a summary. Twelve tiles show at a time; **Show more** adds twelve. |
| **Preview** (right) | The hovered tile big, or the chain when nothing is hovered, with its range. |
| **Seed** tab | UV (2D), World position (3D, drawn on its z = 0 slice), Time (1D, drawn as a plot), or a float / vec2 / vec3 variable. Changing the seed starts a new chain. |
| **Code** tab | The block's lines exactly as Add to graph writes them. |

Each tile shows:

- its picture: a float in grey over its own range, a vec2 as red and green, a vec3 as colour, and
  time as a plot over 0…2π;
- the move's template (`fract(x * #a)`: `x` is your expression, `#a` a number);
- **used in**: up to three shaders the move was found in (or "made by type" for generated moves);
- **Tune**: the move's numbers as sliders, set before you pick it.

A tile whose move doesn't compile on your expression says so and can't be picked.

### Numbers are sliders

A move's numbers start at the value used most in the shaders it came from, with a slider around the
usual values. Type a number past the end and the range grows to fit it, as with every slider in
Playfield. There are no min/max fields.

## Add to graph

The chain becomes one **Expression Block**:

- one line per step: a `float` / `vec2` / `vec3` local (`s1`, `s2`…), each ending in a short note
  on what it does and where the move came from (the block's Note has the long version);
- a slider input for each number (`s2_a` is step 2's first number);
- the seed wired from a **UV** or **Time** node; a world position or a variable stays an input for
  you to wire (a March Loop's position, say);
- a vec3 result goes into the Output when its Color is free.

The chain is stored on the block (`__exprChain`), so a later version can reopen it here.

## Where the moves come from

The move catalogue (`src/exprBuilder/`, phase 1) is mined from the bundled examples' code, and from
your own saved graphs, imports and linked `.glsl` files, on this device only. A few families
(swizzles, one component driving another, products, rotations) are made by type instead.

For now the grid is ordered simply: moves seen where yours is (the seed's dimension and what fed
it) first, then by how often they were seen. Smarter ranking comes next.

## Code

- `src/exprBuilder/chain.ts`: seeds, steps, the grid of next moves, `rankMoves` (pure, replaceable).
- `src/exprBuilder/block.ts`: the chain as an Expression Block, and the small graph the pictures render.
- `src/exprBuilder/store.ts`, `actions.ts`: the window's state; Add to graph.
- `src/components/exprBuilder/`: the window and its pictures (the Explain build-up's render path).
