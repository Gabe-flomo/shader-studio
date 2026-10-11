# Guided Convert

*Status: phase 1 and phase 2 built (branch `claude/guided-convert`). Planned 2026-10-09; see "Phases" for what is left.*

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
   it. A panel opens under the code:
   - the selection's **output, rendered right away** (the last value it makes, shown over the picture,
     as the line previews show a line);
   - **How:** *Nodes* (the converter splits it into library nodes, an Expression Block only where no node
     fits), *Expression* (the same, then the math folded into Expression Blocks) or *One function*
     (a Custom Function holding the lines as written);
   - **Numbers:** each number in the selection is a chip: *slider* (with a range guessed from its value),
     *input* (a socket fed from a named constant you can rewire), or *fixed* (kept as written);
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
Step = { kind: 'convert'; id; units: number[]; mode: 'nodes' | 'blocks' | 'function'; name; chips }
     | { kind: 'group'; id; name; members: stepId[]; hidden: stableParamKey[] }
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

## Phases

1. **Phase 1 (built):** the analysis, the staged shader, the graph at every step, the layout (code with
   tints, canvas with outlines, preview and check, step strip with undo / redo and % converted), select →
   Nodes / One function, the selection's preview, number chips, Convert the rest / keep the rest.
2. **Phase 2 (built):** groups (name, shown sliders) from the step strip, Expression mode, next-cut
   suggestions, a selection inside a helper selecting its callers, the entry from the GLSL page.
3. **Later:**
   - a helper function opened as a group of its own (its body converted, its parameters the group's
     inputs), instead of a Custom Function per call;
   - recognised idioms as single library nodes (the Explain panel's pattern matcher);
   - several outputs on one Custom Function (today the converter packs four components per function);
   - optional extra outputs (a value only the selection uses, exposed anyway);
   - renaming group sockets from the dialog (today: on the card after Materialize);
   - a phone layout (the page is desktop-first; on a phone Guided shows the automatic page).
