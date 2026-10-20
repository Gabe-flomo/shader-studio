# Expression Block

A node of a few lines of GLSL: inputs (each a local variable, a float can be a slider), lines that
run top to bottom (`uv *= 2.0`, `float d = length(uv) - r`), and a Return. Any line variable can
also be an output socket (Also outputs). A Custom Function is the same idea written as one body.

For a single line, **Simple Expression** (`docs/simple-expression.md`) is the lighter node: the line on
the card, inputs added with + Input that take the type of their wire. A block that is only a Return
line (no lines, loop, sliders, extra outputs or pictures) can be turned into one: right-click →
**Simplify to Simple Expression**; a Simple Expression's **Convert to Expression Block** goes back.

## The card

The card on the canvas is read-only: a carousel of **Code**, **Preview** and **Note** pages (empty
ones left out). Its bar holds only the page name and the pager; the page name's tooltip is the
block's signature (`float ring_glow(vec2 uv, float r)`).

- **Edit:** the expression button in the card's header, a double-click on the card, or ↵ when it
  has focus. (The card's own "Edit" pill is gone.)
- **Note:** the comment button in the card's footer, the Note page's "Edit note", or the editor's
  Note field. (The card's "+ Note" and "+ Description" pills are gone.)

### One note, no separate description

A block used to have a note (`params.__comment`, the comment every node can have) and a
description (`params.__description`, written only from the card). They said the same thing, so
there is one now: the note.

Old graphs lose nothing. On load (`migrateDescriptionToNote`, codeCard/codeCardModel.ts) a
block's description is merged into its note, description first, then the note, separated by a
blank line (when one already contains the other, the longer one is kept), and the old field is
removed. Until a node is loaded that way (a preset placed from an older save, say) the Note page
shows both texts merged, and saving the note writes the merged text. "Make a node from this" now
writes its description into the note.

## The editor

| Part | What it does |
|---|---|
| **Inputs** (left) | Name, type, slider and its range, carry (inside a loop). |
| **Lines** | One assignment each; ⌘/ switches a line off (kept as a comment). ▶ previews it. |
| **Return** | The block's value, of the chosen type. |
| **Note** | The block's description: what it does, why, where it comes from. It shows on the card's Note page. ⌘↵ or leaving the field saves; Esc drops the edit. |
| **Also outputs** | Expose an input or a typed line variable as an extra socket. |
| **Functions** (right edge) | A slim ‹ ƒ tab on the editor's right edge opens the function palette beside the code; › on its edge folds it again (⌘] too). It replaced the header's "ƒ Functions" button, matches the Inputs panel's fold arrow, and is remembered for every code editor (the Custom Function editor has the same tab). On a narrow window the palette is a drawer with its own scrim. |
| **Copy as code** (header) | Copies the block as plain GLSL lines: each line as it compiles, off lines as `// off:` comments, then `return …;`. |
| **Make a function** (header) | **Turn into a Custom Function** (in place: same id, inputs, sliders, wires, keyframes and Play controls; the lines become the body; one undo step). **Make a node from Return…** (the explainer's "Make a node from this", for a block that is only a Return). **Copy as a GLSL function** (the block with its inputs as parameters, slider values in a comment). |
| **Edit in Builder** (header) | Only on a block the Function Builder made (it marks it with `fnBuilderFns`) and only while it has no lines of its own: the Builder writes one expression back, so on any other block it lost the lines. |

Turning into a Custom Function writes out what the block gave for free: `float t = u_time;` when a
line uses `t`, the scratch `p`, and a local copy of an input a line assigns to (`vec2 uv_v = uv;`),
since a Custom Function's inputs are the upstream values themselves. Exposed line variables become
the function's extra outputs. A block whose inputs carry between loop iterations, or that outputs
one of its own inputs, stays a block (a message says why).

## Loop

The **Loop** switch beside Lines runs the lines N times. The block then has three groups of lines,
top to bottom, and Return after them:

| Part | Runs | What it is for |
|---|---|---|
| **Before the loop** | once | Start values for what the loop updates: `vec2 z = uv * 1.4`, `float acc = 0.0`. |
| **The looped lines** (in the bracket) | N times | The step: `z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c`. |
| **Break when** (optional) | after each pass | A bool: true stops the loop there (`dot(z, z) > 4.0`). |
| **After the loop** (optional) | once | Finish what the loop built: `float s = esc / n`. |

- **Names in the loop:** `i` (int, 0 at the first pass), `fi` (`float(i)`), `n` (Iterations as a
  float; it is there after the loop too) and `k` (`i / (n − 1)`, 0 to 1 across the passes; 0 when
  n is 1). They autocomplete and are drawn bold while Loop is on. An input or line that takes one
  of these names gets a warning.
- **Variables carry:** everything lives in the block's scope, so an input or a Before variable keeps
  what the last pass left in it. A looped line that declares a variable (`float d = …`) is hoisted:
  declared once before the loop (zero), assigned each pass, readable in After, Return and Also
  outputs.
- **Iterations** is a live slider, in the bracket's header and on the card. The loop compiles to
  `for (int i = 0; i < MAX; i++) { if (i >= N) break; … }`, N a uniform (rounded, clamped to
  0…MAX), so a drag never recompiles. **Max iterations** (beside it; 128 by default, up to 1024) is
  the compiled bound: changing it recompiles. Typing a count past Max raises Max.
- **Step through the passes** (under the bracket) scrubs pass by pass and shows every variable the
  loop writes after that pass: its value at a sample pixel and its spread across the picture,
  measured on the CPU from the same sample inputs Explain uses (`workedLoop`,
  lib/glslPatterns/worked.ts; explain/LoopPasses.tsx). A line the CPU can't evaluate (a texture,
  a helper function) shows a dash.
- **Copy as code** writes a real GLSL `for` loop; **Copy as a GLSL function** wraps it; **Turn into
  a Custom Function** keeps the loop in the body and makes Iterations a slider input
  (`iterations`), still live. The card's Code page shows the same loop. Line previews (▶) of a
  looped line run the loop without After; the Return preview runs everything.
- **Off** keeps Before, After and Break when for later; the lines then run once, as before.
- **Where it compiles:** the picture, passes, an Agents group's update program and a Splat Scene's
  per-splat modifier program (all compile blocks the same way). Saved with the graph and in
  Expression Block presets (`loop`, `loopN`). The Do… bar prints the loop as a code gap, like the
  lines.

All of it comes from one place, `nodes/exprLoop.ts` (`loopCode`), used by the node's GLSL, the card
and Copy as code, so they can't drift. Examples: **Loop: Julia set**, **Loop: fbm** and **Loop: Kali
fold** in the Functions folder (store/exprLoopExamples.ts).

## Make a slider

Put the caret on a number in a line, in Return, or in a Custom Function's body (or select it) and
**Make a slider 0.6 → amount** appears under the field. It:

- adds a float input with a slider, starting at the number, so the picture doesn't change;
- names it from where the number sits, the way "Make a node from this" names its literals
  (`smoothstep(0.6, …)` → `edge0`, `uv * 3.0` → `zoom`, `mix(a, b, 0.3)` → `amount`,
  `sin(t * 2.0)` → `speed`), unique in the block;
- gives it a range around the value (0–1 for small numbers, else 0 to about twice it, symmetric
  for a negative one); typing past the end on the slider extends it, as every slider does;
- replaces the number with the input's name (a whole number where GLSL wants an int, like a loop
  bound, reads `int(count)`);
- is one undo step, both in the editor's undo and the graph's.

A leading minus belongs to the number (`vec2(-2.0, 1.0)`), a subtraction doesn't (`x - 2.0`).

The text work is shared (`lib/glslPatterns/literalSlider.ts`: `literalAt`, `nameForLiteral`,
`literalToSlider`), the node work too (`nodes/codeSlider.ts`), and the offer is one component
(`components/code/MakeSlider.tsx`), so any editor whose node has inputs can use it. The GLSL page
has no inputs to hold a slider (its shader declares its own uniforms), so it doesn't offer it yet.

## Tests

- `src/lib/glslPatterns/__tests__/literalSlider.test.ts`: finding the number at a caret or
  selection (minus signs, names, swizzles, `.5`, exponents, ints), names from where it sits, unique
  names, ranges, `int(…)`.
- `src/nodes/__tests__/codeSliderAndCustomFn.test.ts`: Make a slider in a line, Return and a
  function body (and the compiled block reading the input), Copy as code and as a function, Turn
  into a Custom Function (and that it compiles), when Edit in Builder shows.
- `src/components/code/__tests__/functionsTab.test.tsx`: the Functions fold tab opens and folds
  the palette, is remembered across editors and sessions, and ⌘] still works.
- `src/components/NodeGraph/__tests__/codeCard.test.ts`: the pages, the merged note and the
  migration.
- `src/nodes/__tests__/exprLoop.test.ts`: Loop's code per section, hoisted and carried variables,
  Break when, Iterations live (a uniform, the same shader) against Max (a recompile), the clamp,
  name clashes, Copy as code / as a function / Turn into a Custom Function, autocomplete and types,
  save round-trip and presets, the examples, the pass-by-pass numbers, and compiling in an Agents
  group and a Splat Scene's modifier program.
