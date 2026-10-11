# Guided Convert

*Status: phases 1–3 built: phase 3 (helpers as groups, recognised patterns) on `claude/guided-convert-2`. Planned 2026-10-09; see "Phases" for what is left.*

The Convert page (docs/glsl-to-nodes.md) turns a whole shader into a graph in one go. **Guided** is the
other way to use it: you take part, choosing how the graph is cut. The shader's code is on the left; the
graph builds up on the right. You select lines, turn them into nodes, see what they make, choose which
numbers become sliders, group what belongs together, and go on with the next lines. The part you haven't
converted yet stays one piece of code (a *remainder* Custom Function), so **the graph renders the shader
at every step**, and the check under the preview says so (Same picture / Differs).

## The flow

1. On the Convert page, **Automatic | Guided** sits next to the editor's title. Guided opens on the shader
   the editor holds (and Code-page / Do-bar entries hand a shader to it the same way the GLSL page's
   Convert button does). At step 0 the graph is the remainder alone: one Custom Function wired to the
   Output, the same picture as the shader.
2. **Select lines** in the code (drag over the line numbers or the text). The selection snaps to whole
   statements of `main()`; a selection inside a helper function selects the lines of `main()` that call
   it, and offers to open the helper as a group of its own (see "Helper functions as groups"); a
   selection inside an opened helper selects statements of its body. A panel opens under the code:
   - the selection's **output, rendered right away** (the last value it makes, shown over the picture,
     as the line previews show a line);
   - **How:** *Nodes* (the converter splits it into library nodes, an Expression Block only where no node
     fits), *Expression* (the same, then the math folded into Expression Blocks) or *One function*
     (a Custom Function holding the lines as written);
   - **Numbers:** each number in the selection is a chip: *slider* (with a range guessed from its value),
     *input* (a socket fed from a named constant you can rewire), or *fixed* (kept as written);
   - **Recognised** (Nodes): the idioms in the lines that a library node draws, each as
     "a soft disc → Circle SDF + SDF Mask", with *Node | Block* (see "Recognised patterns");
   - **Needs / Makes:** the values it reads (its inputs) and the values later lines read (its outputs);
   - **Make nodes** (↵).
3. The new nodes appear on the canvas, and the lines they came from are tinted in the step's colour,
   in the gutter and on the cards (an outline in the same colour). The step joins the **step strip** at
   the bottom, with the converted share ("62% converted") and undo / redo.
4. **Group:** tick steps in the strip (or select lines that cover several steps) and press Group: name it
   and choose which sliders show on the group card; its inputs and outputs are the wires that cross it,
   named after the values they carry.
5. **Next:** the strip suggests the next cut ("Next: lines 12–18, the noise() call"), from the shader's
   own paragraphs and what the automatic converter would make of them. Skippable.
6. **Finish:** *Convert the rest* turns the remainder into nodes the automatic way, or *Keep the rest as
   a function* leaves it as it is. **Materialize** keeps the graph (as on the automatic page).

## The data model

```
GuidedState = { source: string; steps: Step[] }            // pure data: undo is popping a step
Step = { kind: 'convert'; id; units: number[]; mode: 'nodes' | 'blocks' | 'function'; name; chips;
         fn?: helperName;                                   // a statement of an opened helper's body
         recognised?: { [recognitionId]: 'node' | 'block' } }
     | { kind: 'group'; id; name; members: stepId[]; hidden: stableParamKey[] }
     | { kind: 'helper'; id; fn; name; callers: number[] }    // a helper opened as a group
```

Everything else is derived, deterministically, from `(source, steps)`:

- **Analysis** (`src/lib/guidedConvert/analyse.ts`): the shader is read as ours (`normaliseHostShader`,
  the converter's own reading) and parsed with locations. `main()`'s top-level statements are the
  **units**: each has its lines in the pasted text, the names it declares, reads and writes, the helper
  functions it calls and the numbers in it. A statement normalisation added (a Shadertoy
  `vec2 fragCoord = gl_FragCoord.xy;`) is *setup*: always converted, not counted.
- **Converted ranges** are the units a convert step owns; the code view tints those lines with the
  step's colour. The **remainder** is every unit no step owns.
- **Staged shader** (`stage.ts`): the shader rewritten so the converter makes exactly the cut you chose.
  Converted units stay in `main()` as written. Each run of remainder units (and each *One function* step)
  becomes a helper function, and `main()` calls it:

  ```glsl
  vec3 rest_1(in vec2 uv, in float u_time) { float d = …; vec3 col = …; return col; }   // remainder
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;      // converted: nodes
    vec3 col = rest_1(uv, u_time);                 // the remainder: one Custom Function
    gl_FragColor = vec4(col, 1.0);                 // converted
  }
  ```

  A run's parameters are the locals declared before it that it reads (`in`) or writes and later lines
  read (`inout`); locals it declares that later lines read are `out` (declared before the call). One
  output is the function's return value, several are out parameters (the converter packs those into
  Custom Functions four components at a time). Uniforms and time / resolution / mouse are passed in, so
  the remainder's node has the same Time and Resolution wires a converted node would. When a run
  touches `gl_FragColor`, `main()` keeps the colour in a local (`color_`) that runs read and write, and
  writes `gl_FragColor` once at the end.
- **The graph** is `glslToGraph(staged)` with `origins` on (each node knows the statement of `main()` it
  was made for, so nodes map back to steps and lines), then: remainder regions labelled *Not converted
  yet · lines a–b*; number chips applied (a *slider* chip on a function is a slider input on the Custom
  Function, an *input* chip is a socket wired from a named constant, a *fixed* one stays in the text);
  *Expression* steps folded with the optimiser (`optimizeGraph({ only: the step's nodes })`); groups
  collapsed with the Studio's own grouping (`collapseToGroup`, extracted from the store's `groupNodes`);
  the columns laid out again.

### How a selection becomes nodes

- The selection's lines → the units they overlap (not already converted, not setup).
- *Nodes*: the units stay in `main()` of the staged shader, so the automatic converter turns them into
  library nodes, Expression Blocks for what no node fits, iterated groups for countable loops,
  Custom Functions for calls to helpers: the same rules and the same proof of equivalence as the
  automatic page. A *fixed* number is given a name (`float edge0 = 0.31;`), which the converter puts on
  the Constants card, fixed.
- *Expression*: as *Nodes*, then the step's chains of math cards folded into Expression Blocks (their
  sliders kept as slider inputs).
- *One function*: the units become a helper function named after the step, called from `main()`.
- A cut is refused (with the reason, nothing changes) when it can't be expressed: a value that crosses it
  is a matrix, an array or a bool; or the converter refuses the staged shader.

### How the remainder stays compilable

It is the shader's own text, moved into functions that take and return exactly the values that cross
each cut, so it compiles wherever the original did, and the converter already turns a call with out
parameters into Custom Functions. The staged shader is checked against the original on the CPU in the
tests (`cpuGlsl.ts`, a small GLSL interpreter: same value at every sample pixel, at every step), and the
page checks the converted graph against the original on the GPU at every step (`RenderPair`, the
automatic page's check), with a warning when it differs.

## Helper functions as groups

Selecting lines inside a helper (`float sdCircle(vec2 p, float r) { … }`) shows, above the usual panel,
**sdCircle() as a group of its own**: *Convert this function* (open it and turn its whole body into nodes)
or *Open as a group* (its body stays one Custom Function inside the group; select its lines to convert
them step by step, as for `main()`). Its parameters are the group's input ports, its return value the one
output.

- **Every call is a copy.** The codebase has no linked group instances (group presets are copies), so
  each converted call of the helper is its own Group node, made from the same body (the same inside,
  labelled with the helper's name, `params.__helper`). Opening the helper also converts (as Nodes) the
  lines of `main()` that call it and aren't converted yet, so the group shows where it is used; a call
  inside code that stays text (the remainder, a loop kept as code) calls the helper as code.
- **Staged like main().** `analyse` reads each helper's body as units (with its parameters, return type
  and callers). An opened helper is staged as `main()` is: converted statements as written, each run not
  converted yet wrapped in a function (`sdCircle_rest`), the run that holds the `return` giving the
  helper's value back (`return sdCircle_rest(p, r);`). The staged shader still computes exactly what the
  original does, checked on the CPU at every step.
- **The converter's side** (`glslToGraph(…, { helperGroups })`): a call to an opened helper converts its
  body inside a plain Group (one pass): parameters through input ports (a number argument comes in from a
  Constants entry named after the parameter), the shader's consts and time / resolution through ports,
  the return expression the output port. Nodes inside know the helper statement they were made for
  (`helperOrigins`), so they map back to the step and lines, and the remainder inside is labelled
  *Not converted yet · lines a–b*.
- **What can open** (`HelperFn.openable`, else the reason is shown): one definition (no overloads), `in`
  parameters only, a float or vector back, one `return` at the end (no early return), no `discard`, no
  writes to `gl_FragColor` or globals. Helper body steps are Nodes or One function (no Expression mode
  inside a group yet).
- **Limits:** a loop inside an opened helper stays code inside its group (the compiler doesn't run an
  iterated group inside another group yet), and a call inside an iterated group stays code for the same
  reason.

## Recognised patterns

In Nodes mode, the selection's lines are read with the Explain panel's matcher (`src/lib/glslPatterns`:
`matchPattern` over the idioms' spellings, constants folded, `+`/`*` in any order). An idiom a library
node draws becomes that node instead of generic math cards (`recognise.ts`, recipes in `recipes.ts`):

| Idiom | Becomes |
|---|---|
| `length(p) - r` | Circle SDF |
| `1 - smoothstep(r, r + w, length(p))` and spellings | Circle SDF + SDF Mask (the fill) |
| `smoothstep(r, r + w, length(p))` | Circle SDF + Smoothstep |
| `abs(length(p) - r)` (`- w`) | Ring SDF (+ Subtract) |
| box SDF (`length(max(abs(p) - b, 0)) + min(max(q.x, q.y), 0)`) | Box SDF |
| `mat2(cos a, -sin a, sin a, cos a) * p`, `p * M`, `uv *= M` | Transform (2D, turn ±a) |
| `fract(p * n) - 0.5`, `fract(p * n)`, `floor(p * n)` | Tile, Grid UV, Tile's Cell ID |
| `a + b * cos(6.28318 * (c * t + d))` | Palette |
| `(x - a) / (b - a)`, `clamp((x - a) / (b - a), 0, 1)` | Remap (clamp off / on) |
| `x * x * (3 - 2x)`, `a + (b - a) * t`, `min(max(x, 0), 1)` | Smoothstep, Mix, Clamp |
| a helper whose body is fractal noise (`fbm()`) | FBM (offered only if the picture matches) |

A helper call is recognised too when its body, inlined (declarations and one return), is one of these:
`pal(t)` returning a cosine palette becomes a Palette, a `box(p, b)` helper a Box SDF.

- **How it stays the same picture.** The matched code is cut out of the statement as a call to a
  one-line function of its parts (`rc_softDisc(uv, 0.3, 0.02)` with `return 1.0 - smoothstep(r, r + w,
  length(p));`), so the staged shader computes exactly what the original does; the converter
  (`nodeCalls`) makes that call the recipe's nodes, or one Expression Block holding the body (*Block*),
  or, when the recipe can't take the values, the body as plain nodes.
- **Offered only when it matches.** `offers.ts` tries each pattern alone: it is offered when its node was
  really made and the compiled graph draws the same as the plain conversion on the CPU (`check.ts`: the
  GLSL interpreter on an 8×6 grid at two moments, within 1.5/255). Exact recipes are offered even when
  the interpreter can't run the shader; the others (a different but equal formula, 6.28318 against the
  shader's 2π, the FBM node's own noise) are not, with the reason ("Kept as written: the picture would
  change by up to 87/255"). The page's GPU check (*Same picture*) still runs after every step.
- **Numbers.** The numbers a node takes the place of (the `1.0 -` of a soft disc) aren't chips; the ones
  in its arguments stay chips and feed its sliders.

## Phases

1. **Phase 1 (built):** the analysis, the staged shader, the graph at every step, the layout (code with
   tints, canvas with outlines, preview and check, step strip with undo / redo and % converted), select →
   Nodes / One function, the selection's preview, number chips, Convert the rest / keep the rest.
2. **Phase 2 (built):** groups (name, shown sliders) from the step strip, Expression mode, next-cut
   suggestions, a selection inside a helper selecting its callers, the entry from the GLSL page.
3. **Phase 3 (built):** helper functions as groups (above), recognised patterns as library nodes (above).
4. **Later:**
   - linked group instances (one body, every call follows an edit) once the Studio has them;
   - loops inside an opened helper as iterated groups (a group inside a group);
   - Expression mode inside a helper's group;
   - more recognitions (SDF unions as an SDF combine node, polar space, hashes) and the matcher folding
     `(0.6 - 0.2)`-style constants on the pattern side;
   - several outputs on one Custom Function (today the converter packs four components per function);
   - optional extra outputs (a value only the selection uses, exposed anyway);
   - renaming group sockets from the dialog (today: on the card after Materialize);
   - a phone layout (the page is desktop-first; on a phone Guided shows the automatic page).
