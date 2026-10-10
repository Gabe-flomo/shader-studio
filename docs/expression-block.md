# Expression Block

A node of a few lines of GLSL: inputs (each a local variable, a float can be a slider), lines that
run top to bottom (`uv *= 2.0`, `float d = length(uv) - r`), and a Return. Any line variable can
also be an output socket (Also outputs). A Custom Function is the same idea written as one body.

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
