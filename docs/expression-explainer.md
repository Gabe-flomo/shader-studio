# Expression explainer and "Make a node from this" (2026-10-06)

**Status:** built. Deterministic: no AI, no network. The same text always gives the same words.

## In plain words

Any expression in the app can be explained in plain language, step by step, and any part of it can become a node of its own.

- **Expression Block editor.** Under every line, and under Return, there is an **Explain** row. Folded, it is a one-line summary (`uv, r → 2 steps → d`). Open it, or press the line's **▶**, for the **build-up view** (below): the line as GLSL builds it, a row per input and step with a small picture, which you can step through on the big preview.
- **Custom Function editor.** An **Explain** section under the body shows each statement's build-up (pictures worked out on the CPU).

> **2026-10-09:** the Explain panel no longer shows worded sentences ("In short", "First … then …"): they read badly and couldn't capture context. It shows the build-up instead. The wording below is still produced by the library and used by the code card's hover line, the Code explorer, the Do bar and the language model's prompt.
- **The code card's Code page.** Point at a line and its sentence appears at the bottom of the code (not on touch screens).
- **GLSL page.** Select an expression, or put the caret in a statement, and press **ⓘ Explain** in the toolbar. The explanation opens under the editor.

An explanation has a short sentence and an ordered breakdown that names the parts:

> `fract(sin(uv*3.0)*2.0)`
> **Repeating 0–1 ramps of sine waves of uv zoomed out 3×, doubled.**
> First, A = `uv*3.0`: zooms uv out 3× (3× as much fits; anything drawn in it gets 3× smaller). Then, B = `sin(A)`: takes the sine of each coordinate of the zoomed space: waves from −1 to 1, one every 2π. Then, C = `B*2.0`: doubles the waves (now −2…2). Finally, `fract(C)`: keeps the fractional part of the doubled waves: repeating 0…1 ramps (its −2…2 range becomes 4 ramps).

Well-known shader idioms are recognised first and read as one idea:

| Code | Reads as |
|---|---|
| `smoothstep(0.3, 0.35, length(uv))` | A soft-edged circle of radius 0.3 (0 inside, rising to 1 over 0.05 outside it) |
| `fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453)` | A pseudo-random number for each p (the classic sine hash) |
| `sin(t)*0.5+0.5` | The wave, moved to 0…1 |
| `vec3(0.5)+vec3(0.5)*cos(6.28318*(vec3(1.0)*t+vec3(0.0,0.33,0.67)))` | A palette colour for t (Inigo Quilez's cosine palette) |
| `mat2(cos(a),-sin(a),sin(a),cos(a))*p` | p rotated by a |
| `exp(-3.0*d)` | A glow around d |

The same operation reads differently depending on what it acts on. `* 3.0` on space (a vec2, or a name like `uv` or `p`) is "zooms out 3×". On a colour (a vec3, `col`) it is "3× brighter". On time (`t`) it is "3× faster", and on a distance (`d`) "scales the distance by 3".

### Plain meaning first, the literal reading under it

A line that is a known idiom leads with its **plain meaning**: what the values are, what it looks like and what it is for. The literal reading and the steps fold under it (**Literal reading and steps**, collapsed by default and remembered for the session):

> `float silent = 1.0 - step(0.02, a)`
> **`silent` is 1 while `a` stays under 0.02 and 0 otherwise: a switch that is on only when `a` is almost 0.** ☆ a hard on/off mask
> ▸ Literal reading and steps: `silent` is where `a` is below 0.02. It cuts `a` at 0.02: 1 below it, 0 at or above (a hard edge).

Every idiom has a meaning and a **use** tag (`src/lib/glslPatterns/meanings.ts`). A composed expression (no idiom at its root) ends with a one-line summary built from its parts: **In short: `uv` → zoomed space → waves → doubled waves → ramps, 0…1 per component.**

### Names, numbers and code as chips

The explainer emits **segments** (`text`, `var`, `num`, `code`, `fn`), not plain strings, and one component draws them everywhere (`ExplainText`): a variable in its type's colour (the GLSL highlighter's float / vec2 / vec3 colours, which follow the socket hues), a number in the number colour, a function name in the function colour, and code highlighted with the same tokenizer and colours as the GLSL page and the code card, in light and dark. Each chip keeps its words for screen readers ("variable a"). The code at the top of an explanation and each step's code are highlighted too.

Hovering a variable chip lights where the code reads it, and hovering a variable in the code lights its chips, the same way hovering a step lights its part of the code.

Places that need a string (the code card's hover tooltip, Make-a-node descriptions saved into node notes, Code Explorer search, tests) use `toPlainText`, which wraps names and code in backticks: "`silent` is where `a` is below 0.02."

### The build-up view (the Explain panel)

The panel shows a line as it is built, in the order GLSL computes it (`src/components/explain/BuildUpView.tsx`, rows from `src/lib/glslPatterns/buildUp.ts`):

- **One row per input** the line reads, **one per step** (the explainer's steps, inside-out, earlier steps shown as their letters: `sin(A)`), then **the result** (the line's target, or `result` for Return).
- Each row has its label, its code, its type, **a small picture** and **its range**:
  - the same everywhere (a number, a slider, the clock, a colour constant): a **swatch** for a vec3 / vec4, else the **number**;
  - varies across the screen: a **small render** (64 px): a float in grey with its range mapped to black … white and labelled, a vec2 as red / green, a vec3 as its colour;
  - when a render per row would cost too much: a **1D strip** along the screen's horizontal middle, worked out on the CPU (`cpuStrip`, from the sample inputs) where the evaluator can, else one rendered row (96 × 1).
- **The sample inputs** ("With `base` = … Reset") drive the CPU pictures, the numbers of constants nothing rendered, and the usual ranges. A rendered picture's range is measured from the render.
- **Step-through.** Click a row, or press **← / →** while the list has focus, to show that row on the big ▶ preview (the line preview, pointed at the sub-expression) and light its span in the code. The selected row is marked. **Escape**, or clicking it again, goes back to the whole line (Escape then doesn't close the editor).
- **▶ on a line opens it.** Pressing ▶ on a line (or Return) in the Expression Block opens that line's Explain row with the build-up focused, ready for ← / →.
- Hovering a row lights its part of the code; hovering an input lights its reads. Steps keep **+ Node**, an idiom's name and **Where else?**; "Explain these steps" and "Explain more" (the optional model) stay where they were.
- The build-up is the panel's primary section: open by default, its fold remembered for the session. The Explain row itself starts folded.

**What varies.** In an Expression Block the host knows the wiring (`src/components/explain/buildUpHost.ts`, `exprBlockVarying`): an input wired from anything but a constant source (Time, a constant, a colour, Mouse…) varies, a slider doesn't, and a line's variable varies when its expression reads one that does. Elsewhere (the GLSL page, a Custom Function) screen coordinates and space-like names vary. A render that comes out flat is shown as a constant anyway.

**Cost.** All the rows of a line are **one compile**: a copy of the block keeps the lines above, declares each row as its own variable (`float pv_s0 = …;`), and one program writes the row a `u_pvSel` uniform picks; each row is then one tiny draw into a float target, read back (`nodePreviewRenderer.renderValues`). Renders are debounced (250 ms), cached by shader + uniform values, made only while the panel is open, on screen and the page visible. Before rendering, the upstream graph is checked (`pictureBudget`): a March Loop, a Pass, agents, particles, feedback, textures or video, more than 40 nodes, or a last render over 120 ms → strips instead. A block inside a group gets strips (its inputs come from the group's sockets).

### A picture of the line

When a line is a function of one number (float → float: `1.0 - step(0.02, a)`, smoothstep, sin, fract, pow, a remap, a clamp), a **mini transfer plot** sits beside the sentence (about 120×60; click to enlarge, with the axes' numbers). x is the input over a range picked from the literals (0…0.1 around a 0.02 edge, the two ends of a smoothstep, a clamp's limits, 0…2π for a sine), y the result, and every edge is marked and labelled. It is sampled on the CPU with the explainer's own evaluator (`evaluate.ts`, ~160 points), so it costs no GPU work (`plot.ts`).

A line that reads space (a vec2 / vec3 such as `uv`, `p`) or several inputs gets its pictures from the build-up view instead (the old **Show picture** button is gone: selecting the result row shows the whole line on the ▶ preview).

Parts the explainer has no rule for get literal words. An unknown function reads as "calls foo(p, 2), a function this explainer doesn't know". It never guesses past its rules.

### Make a node from this

Every step of an explanation has a **+ Node** button, and the whole expression has **Make a node from this**. The dialog turns that part into a reusable function:

- **Inputs.** The free variables and the numbers become inputs.
  - A recognised idiom names them (radius, width, falloff…).
  - Otherwise names keep their own name, and a number is named by where it sits: the edges of a smoothstep are `edge0` / `edge1`, a factor on space is `zoom`, on a colour `brightness`, on time `speed`.
- **Types** come from the editor: the block's inputs, its typed lines, the function's parameters and locals, the shader's declarations. Otherwise a type comes from how a name is used (`q.y` needs at least a vec2) or from the name itself (uv is a vec2, col a vec3). A guess is marked "(type guessed)" and has a type picker.
- **Constants and sliders.** Every number can stay a constant or become a slider, with its value as the slider's default. 0, 1 and the numbers inside an all-number `vec3(…)` start as constants. An idiom's own numbers, like the `0.5`s of `x*0.5+0.5`, are part of the idiom and stay in the code.
- **As the idiom / As written.** For a recognised idiom you can switch to "as written" and get every name and number instead.
- **Rename** inputs and the function. Bad names (GLSL words, repeats, two underscores in a row) are flagged before saving.
- **Save as** either:
  - **an Expression Block preset**, which goes in the sidebar's Expressions with its slider defaults, or
  - **a node in the palette**: the existing publish dialog opens with everything filled in, and the description is taken from the explanation. In a recognised idiom's description, a number that became an input reads as its default, marked adjustable ("a soft-edged circle of radius 0.3 (adjustable) around p"), never as the input's name; an input with no default that the words already name reads "the given …" ("a circle of the given radius"). The node then appears in the node browser and search like any published node. Publishing is Pro, as before.
- **Use it here too** replaces the original part with the new thing:
  - Custom Function: the function goes into Helper functions and the part becomes a call to it.
  - GLSL page: the function goes above the function the selection is in, and the selection becomes a call.
  - Expression Block: blocks can't call functions. The new node is added next to the block and wired from the same sources as the block inputs it reads. Its result comes back as a new block input, which replaces the part. This only works when every part it reads is a wired block input. When it reads a line's own variable, the clock or a slider on the block, the dialog says so and the option is off.

### Where else is this used?

From any recognised idiom (the **Where else?** button on its step) or from the Make-a-node dialog, **Where else is this used?** scans:

- the current graph (inside groups too), and
- every bundled example.

It lists each structural match with its provenance, for example *This graph → Group → Fn → Statement 1 (line 1)*, with the matched part highlighted. **Show** selects the node (or the group it is in). **Open** loads the example first, after asking, because it replaces the canvas.

It looks at Expression Block lines and Custom Function statements. It is simple and in memory: every search re-parses what it scans. The Code Explorer (docs/code-explorer-plan.md) will index everything, saved graphs, imported shaders and linked folders included. When it lands, `findUses` is the one place to swap that index in.

### Function cards: click a function name

Any function name in code can be explained in a small card: what it takes and returns, what it means, what it looks like, and what *this* call does.

> **`smoothstep`** GLSL built-in · Common
> | returns | parameters |
> |---|---|
> | genType | smoothstep(genType edge0, genType edge1, genType x) |
> | genType | smoothstep(float edge0, float edge1, genType x) |
>
> genType: float, vec2, vec3 or vec4
> **A soft ramp from 0 to 1 as x goes from edge0 to edge1 (an S-curve, flat at both ends).** ☆ soft edges, fades  [plot, with this call's numbers]
> **Here:** goes smoothly from 0 to 1 as `d` goes from 0.3 to 0.35 …
> How is this used? · Insert snippet · Docs

**Where.** Everywhere code is shown:
- **Editable code:** Expression Block lines and Return, the Custom Function editor (body and helper functions), the GLSL page (and the Convert page's editor).
- **Read-only code:** the code card's Code page on the canvas, the Generated code panel (and the phone's code view), Code Explorer instances, and the explainer's own code (steps, chips, the card's signatures).

**How to open it.** The rule: never steal the caret or the click from editing.

| | Desktop | Touch |
|---|---|---|
| Editable code | Rest the pointer on a function name (0.6 s) for a peek. **⌥-click** or **⌘-click** (Ctrl-click off the Mac) for a card that stays. **F1** or **⌘I** (Ctrl+I) with the caret on a name *or anywhere in its arguments* opens the call around the caret. A plain click only places the caret, and none of these move it. | Long-press the name. |
| Read-only code | A **plain click** on a function name, or a rest of the pointer. F1 / ⌘I with text selected in it. A drag that selects text never opens it, and inside a clickable row (a search hit) only hovering opens it. | A tap or a long press. |

**Closing.** **Esc** closes it and gives focus back to where it was (the editor's caret is where it was). So does a click or tap outside, or the ✕. A card opened by hovering closes when the pointer leaves both the name and the card, or when you type. Using a peek (clicking in it, tabbing into it) keeps it open. Esc closes the card first, not the dialog under it.

**Accessibility.** The card is a `role="dialog"` labelled "*name*: function card", focusable, and every link is a button you can reach with Tab. Opened from the keyboard or with a click in read-only code, it takes focus; opened by hovering or ⌥-click in an editor it doesn't, so typing carries on.

**What it shows.**
- **Name and kind:** GLSL built-in (with its group), type constructor, Playfield helper, your function, or unknown.
- **Signature with types.** A built-in shows a table of its overloads (`genType` and friends are explained under it). A function the code declares (a Custom Function's helpers, a function on the GLSL page, the generated shader's own) shows the signature parsed from its source, with the comment just above it as its description. A Playfield helper that the code redeclares with a different signature reads as the user's.
- **Plain meaning** from the registry (`functions.ts`), worded with the parameter names, and a **use** tag.
- **A mini plot** for functions of one number (the explainer's `TransferPlotView`). The call's own literal arguments are plugged in: `smoothstep(0.3, 0.35, d)` plots `smoothstep(0.3, 0.35, x)` with its two edges; without literals it plots typical values (labelled so).
- **Here:** this call, explained by the explainer: an idiom's plain meaning when the call is one, else the call's own step.
- **Links:** **How is this used?** opens the Code Explorer on the name. **Insert snippet** puts the snippet library's version in, as the Functions panel does (lines in an Expression Block, a helper plus a call in a Custom Function), when the function has one and the card was opened from such an editor; elsewhere it's **Copy snippet**. **Docs** opens the Khronos reference page for a built-in, or Inigo Quilez's article for the SDF, smin and palette helpers.

**Node cards.** The ⓘ in a canvas node's footer opens the same card for the node: its description, and a plain-meaning line from its main idiom when one applies. A node that is one GLSL function (Smoothstep, Sin, Mix…) uses that function's meaning. An Expression Block uses what it returns, followed back to the line that makes it, or else its last line that is an idiom or a known call. A Custom Function uses its `return`. **Sockets and wiring** opens the longer node info that the ⓘ used to show.

**Coverage.** `FUNCTION_REGISTRY` has every GLSL ES 3.0 built-in the highlighter colours: angle and trig, exponential, common, packing, geometric, matrix, vector comparison, texture sampling (including the WebGL 1 names), derivatives, plus the ES 3.1 bit functions and the geometry-shader ones (marked as not in WebGL). It also has the type constructors and every function in the shader prelude (`noiseHash1/2`, `valueNoise`, `rotate`, `rot2D`, `smin`, `sdBox`, `sdSegment`, `sdEllipse`, `opRepeat`, `opRepeatPolar`) and `palette`. The tests check every highlighter built-in and every prelude function has an entry with a meaning.

**For code views.** Mark the element and, when you know more, register a scope (`src/components/explain/functionCard/fnCardStore.ts`):
- editable: `data-fn-card="edit"` on the textarea or input (CodeField does it for GLSL, CodeInput and GlslEditor always);
- read-only: `data-fn-code` on an element whose text is the code (a line or a block; GlslCode does it);
- `useFnCardScope({ types, source, onSnippet })` on any ancestor: the names' types (for "Here"), more source to find the user's functions in, and where Insert snippet goes. The nearest scope wins; types and source merge.

The listeners are installed once at start-up (`triggers.ts`, from `main.tsx`), and the card is a lazy chunk (`FunctionCard.tsx`, mounted by `FunctionCardHost`).

## The pattern library: `src/lib/glslPatterns/`

A shared module. The suggestions / Do… bar work and the Code Explorer should import it from `src/lib/glslPatterns` (the index), not from the files inside.

| File | What |
|---|---|
| `ast.ts` | The expression AST, `printExpr` (minimal parentheses, with substitutions), `formatNumber`. |
| `parse.ts` | `parseExpr` (a Pratt parser for one expression: exact spans, never throws), `parseLine` (`float d = …`, `p *= …`, `return …`), `splitStatements`, `pickExplainSpan`. |
| `types.ts` | `inferTypes` (GLSL's rules plus the built-ins and Playfield helpers), `typesFromCode` (declarations in a block of code), `GLOBAL_TYPES`. |
| `roles.ts` | `inferRoles`: space, colour, value, mask, distance, angle, time, direction, cell. They are decided by the graph, then the name, then the type, then the operation. Also `roleOfSourceNode`. |
| `match.ts` | Structural matching with holes; see below. |
| `idioms.ts` | `IDIOMS`: 62 idioms, `registerIdiom`. |
| `explain.ts` | `explainExpression`, `explainLine`, `explainTree`, `breakdownText` / `breakdownSegs`, `fmt`. |
| `segments.ts` | `Seg`, `mark` (tokens inside template text), `parseSegs`, `toPlainText` (names in backticks), `stripMarks`, `spokenToken`. |
| `meanings.ts` | Each idiom's plain `meaning` and `use`. |
| `plot.ts` | `transferPlot` (a float → float expression sampled over a range from its literals, edges marked), `needsPicture`, `edgesOf`, `plotRange`. |
| `generalise.ts` | `generalise`, `generaliseText`, `buildFunction`, `descriptionFor`. |
| `evaluate.ts` | A tiny CPU evaluator (float, vec2–4, mat2, the common built-ins), used to prove a made function gives the same values. |
| `findUses.ts` | `findUses`, `matchesInLine`, `codeLines`, `provenance`, `exprBlockEnv`, `customFnEnv`. |
| `saveFlows.ts` | `toExprPreset`, `exprPresetParams`, `toPublishNode`, `insertFunction`, `callInCustomFn`. |
| `functions.ts` | `FUNCTION_REGISTRY` (built-ins, constructors, helpers: overloads, meaning, use, plot, snippet, docs), `functionInfo`, `signatureText`, `GENERIC_TYPES`. |
| `fnAt.ts` | `functionAt` (the function name at a caret or click, or with `enclosing` the call around it), `functionsIn`, `declaredFunctions` (user functions with their comments), `commentSpans`. |
| `fnCard.ts` | `functionCard` / `functionCardFor` (the card's model), `plotForCall`, `explainCall`, `snippetFor`. |

The UI lives in `src/components/explain/`: `ExplainText` (segments as chips), `GlslCode` (highlighted code with lit spans), `TransferPlotView`, `ExplainView`, `ExplainRow`, `StatementsExplain`, `GlslExplainPanel`, `MakeNodeDialog`, `FindUsesDialog`, `useExplainDialogs`, `useHoverExplain`, and `hosts.ts` (each editor's context and its "Use it here too").

### API

```ts
import { explainExpression, explainLine, generaliseText, buildFunction, findUses, matchPattern, IDIOMS } from '../lib/glslPatterns';

const ex = explainExpression('fract(sin(uv*3.0)*2.0)', { types: { uv: 'vec2' } });
if (ex.ok) {
  ex.sentence;      // 'Repeating 0–1 ramps of sine waves of `uv` zoomed out 3×, doubled.' (plain text)
  ex.sentenceSegs;  // [{ kind: 'text', … }, { kind: 'var', text: 'uv', name: 'uv', type: 'vec2' }, { kind: 'num', text: '3' }, …]
  ex.steps;         // [{ label: 'A', code: 'uv*3.0', text: 'zooms `uv` out 3× …', segs, start, end, idiom?, type, role }, …]
  ex.breakdown;     // 'First, `A = uv*3.0`: … Then, … Finally, `fract(C)`: …' (and breakdownSegs)
  ex.inShort;       // 'In short: `uv` → zoomed space → … → ramps, 0…1 per component.' (composed only)
  ex.meaning;       // an idiom at the root: 'Gives …' (and meaningSegs, use)
  ex.idioms;     // [{ idiom, node, bindings, pattern }]
}

const line = explainLine('float d = length(p) - 0.3;', { types: { p: 'vec2' } });
// line.lineSentence: '`d` is the signed distance to a circle of radius 0.3.'   (the literal reading)
// line.lead:         '`d` is how far `p` is from the edge of a circle of radius 0.3: …' (plain meaning when there is one)
// transferPlot(line): null here (p is a vec2); for `1.0 - step(0.02, a)` → { input: 'a', from: 0, to: 0.1, edges: [0.02], points }

const g = generaliseText('smoothstep(0.3, 0.35, length(uv))', { types: { uv: 'vec2' } });
// g.inputs: radius (0.3, slider), width (0.05, slider), p (vec2, from the idiom's hole)
const fn = buildFunction(g, { names: { 2: 'pos' }, constant: { 1: true } });
// fn.code: 'float softCircle(float radius, vec2 pos) {\n    return smoothstep(radius, radius + 0.05, length(pos));\n}'
// fn.call: 'softCircle(0.3, uv)'   fn.pattern: 'smoothstep($radius, $radius + 0.05, length($pos))'

findUses({ idiomId: 'soft-circle' }, [{ graph: 'This graph', nodes }]);
findUses({ pattern: fn.pattern }, sources);
matchPattern('exp(-$k * $d)', expr);   // Bindings | null
```

**Context.** `ExplainContext` takes:
- `types`: the names in scope (the editor's inputs, locals and parameters). The globals (`u_time`, `u_resolution`, `vUv`, `gl_FragCoord`, `PI`, `TAU`, the `i*` Shadertoy names) are known already.
- `roles`: roles known for certain, such as an input wired from a UV node (`hosts.exprBlockRoles`).
- `noIdioms`.

`GeneraliseContext` adds `globals`, names that stay as they are (`t` in an Expression Block), and `plain` (ignore idioms).

**Vocabulary.** `idiomVocabulary()` gives `{ id, name, category, words }` for every idiom. This is what a search index (the Do… bar, the node browser, the Code Explorer's phrase library §8.1) can register. The suggestions module isn't on main yet, so nothing registers it today. Made nodes reach the node browser and search through the existing user-node registry, and presets through the sidebar's Expressions list.

### How matching works

Patterns are GLSL expressions with holes:
- `$x` matches any sub-expression.
- `#k` matches only a number: a literal, or a constant such as `2.0 * PI`.

Both sides are normalised first, so spelling doesn't matter:
- **Constants fold.** `6.28318`, `TAU`, `2.0 * PI` and `2.0 * 3.14159` are one number. Numbers compare within 2·10⁻⁴ (relative, at least 10⁻⁴ absolute), so `1.0/2.2` matches `0.4545`.
- **Commutativity.** `+` and `*` chains flatten and match in any order: `0.5 + sin(x)*0.5` is `sin(x)*0.5 + 0.5`, and `(3-2x)*x*x` is `x*x*(3-2x)`. `-` and `/` keep their order.
- **Signs come out of products.** `-k*d`, `-(k*d)`, `k*-d` and `-2.0*d` are one shape.
- **Splats and aliases.** `vec3(0.5)` matches `vec3(0.5, 0.5, 0.5)`. `.rgb` is `.xyz`. `texture2D` is `texture`. `iTime` is `u_time` and `iResolution` is `u_resolution`.
- **Repeated holes.** A hole used twice must bind equal code, compared on the normalised form.
- **Literal sums.** `smoothstep(0.3, 0.35, …)` matches `smoothstep($r, $r + $w, …)` with r = 0.3 and w = 0.05. `$r - $w` works the same way.
- **Leftover operands.** A bare hole in a `+` / `*` chain can take several operands: `$a + 1.0` matches `x + y + 1.0`.

Idioms are tried at every node, top-down: the first idiom (in library order) whose pattern matches and whose conditions hold wins that node. Its holes are then explained inside-out, and everything else gets the per-function and per-operator templates.

### Adding a pattern

Add an entry to `IDIOMS` in `src/lib/glslPatterns/idioms.ts`, above anything more general that would also match. The first match wins, so `1.0 - smoothstep(…length…)` sits before `1.0 - $x`.

```ts
{
  id: 'soft-circle', name: 'Soft circle', category: 'shape', fnName: 'softCircle', short: 'the soft circle',
  patterns: ['smoothstep($r, $r + $w, length($p))', 'smoothstep($r - $w, $r + $w, length($p))'],
  holes: { r: { input: 'radius' }, w: { input: 'width' }, p: { types: ['vec2', 'vec3'], input: 'p' } },
  where: c => (c.v('w') ?? 1) > 0,          // a negative width is the filled disc, another idiom
  noun: c => `a soft-edged circle of radius ${c.h('r')}`,
  how: c => `makes a soft-edged circle of radius ${c.h('r')} around the origin of ${c.h('p')}: …`,
  role: 'mask', keywords: ['circle', 'soft', 'smoothstep'],
}
```

- **`patterns`**: list the genuinely different spellings only. Reorderings of `+` / `*`, `TAU` against `6.28318`, splats and sign placement are already handled.
- **`holes`**:
  - `types` / `roles` restrict what a hole may bind. An unknown type or role passes unless `strict: true`. A role read only off a type is weak evidence and also passes unless strict.
  - `input` is the input's name when the idiom becomes a node.
- **`where`**: extra conditions on the match. `c.v('k')` is a literal hole's number and `c.type('p')` a hole's type.
- **`noun`**: a short noun phrase for the sentence.
- **`how`**: a verb phrase for the step. `c.h('x')` is the hole's phrase (its code, or a later step's short name) and `c.n('k')` the number formatted for prose (π multiples as π).
- **`short`**: what later steps call the result ("the disc").
- **`meaning`** / **`use`** (in `meanings.ts`, keyed by id): the plain meaning, a noun phrase that reads after "x is …", and the common job ("a soft round mask"). Every built-in idiom needs both; a test checks.
- **`fnName`**: the made function's name.
- **`keywords`**: search words.

Then add a positive and a negative case to `src/lib/glslPatterns/__tests__/match.test.ts`. The library test checks that every pattern parses and every id is unique.

## Tests

`src/lib/glslPatterns/__tests__/`:
- **match.test.ts**:
  - the parser, line and statement splitting;
  - commutativity, literal tolerance, sign pulling, repeated holes, folded sums;
  - 47 positive and 9 negative idiom cases.
- **explain.test.ts**:
  - the user's example, step by step with spans;
  - 37 composition sentences;
  - role-aware wording of the same `* 3.0`;
  - idioms inside compositions, and lines (declarations, compound assignment, return);
  - role inference by graph, name, type and operation.
- **segments.test.ts**: segments for a set of idioms, `toPlainText` backticks, In short summaries, every idiom has a meaning and a use and its meaning reads without empty holes.
- **buildUp.test.ts**: rows (inputs, steps inside-out, the result; a compound line; Return; an idiom as one step), what varies (host-given and default), constant / render / strip-cpu / strip-render, every fallback reason, the CPU strip, flatness.
- **plot.test.ts**: the 0.02 edge plots over 0…0.1, every edge is inside the range, ranges for shapers, no plot for space or several inputs.
- **functionCard.test.ts**: every highlighter built-in and every prelude helper has a meaning (one test per registry entry), helper signatures match their GLSL; function detection at a caret or click (in and right after a name, across lines and tokens, with `enclosing` in the arguments; not in comments, members, `#define`s, keywords); user function signatures and comments; overloads; the plot with a call's literals; per-call explanations; snippets.
- **generalise.test.ts**:
  - inputs, names, types and defaults for idioms and as written;
  - every made function parses with `@shaderfrog/glsl-parser`, its body's type is the declared return type, and it gives the same values as the original on sample inputs (CPU evaluator);
  - renames and constants, bad names;
  - the preset flow, and the user-node flow through `buildUserNodeDefinition`;
  - "Use it here too" in GLSL text and in a Custom Function;
  - find uses with provenance, inside groups, by idiom and by made pattern.

`src/components/explain/__tests__/buildUp.test.tsx` (jsdom): which Expression Block names vary, the step probe (lines above + `pv_step`, compiled by the eye preview, graph untouched, ↑ / ↓ from a step), one compile for all rows of a line with `u_pvSel` and the cache, the heavy-graph count, the picture colour maps; the view renders a row per input / step / result with no worded sentences, click / again / ← → / Escape step through, an open request opens and focuses, and ▶ on a line in the real Expression Block editor opens its build-up and steps on the preview.

`src/components/explain/functionCard/__tests__/`:
- **functionCard.test.tsx** (jsdom): the shortcut and click rules, a point to a character in a field (lines, tabs, scrolling), placement; a plain click in read-only code opens a focused card and a click on a variable doesn't; not inside a button or after a selection; Esc closes and gives focus back, a click outside closes; ⌥-press opens without moving the caret and the click after it is swallowed; ⌘I / F1 in the arguments; one-line inputs; hover peek, leave and typing; long press and a moved finger; scopes; the card's dialog, table, meaning, plot, Here and links; Insert / Copy snippet; the node ⓘ toggle.
- **nodeCard.test.ts**: a node that is one function, an Expression Block's returned idiom and its fallback to a line, a Custom Function's return, nothing when nothing applies.

## Limits

- The transfer plot is for the line as a whole; steps get build-up pictures instead.
- Build-up pictures are a snapshot: they re-render when the block changes or the panel opens, not when an upstream slider moves, and at u_time as it was. Stepping through on the big preview works in the Expression Block only (a Custom Function's statements get CPU pictures and the whole-statement preview). A row whose type the explainer can't tell (`unknown`) gets a CPU strip or nothing.

- One expression at a time. A statement's control flow (`if`, `for`) is skipped and only the simple statements inside are explained. Ints, bools and matrices beyond `mat2` have types but few words.
- Roles are heuristics with stated evidence. A float named `c`, used as a coordinate, may read as a colour channel. The graph's wiring wins when there is one.
- Ranges ("now −2…2") are tracked only through sin / cos / fract / smoothstep / step / clamp, scaling and shifting by numbers.
- The CPU evaluator is for tests and quick checks: no textures, no ints, no `mat3` / `mat4`.
- "Use it here too" in an Expression Block needs every part it reads to be a wired block input (see above). An idiom hole that matched a computed part (`sin(t)` in `sin(t)*0.5+0.5`) counts as computed.
- Find uses scans Expression Block lines and Custom Function statements of the current graph and the bundled examples in memory, up to 200 / 300 hits. Saved graphs, presets, shaders, linked files and presentations come from the Code Explorer's index (`findIndexedUses` in `src/codeExplorer/queries.ts`, shown by `IndexedUses` in the dialog), matched one indexed line at a time.
- The suggestions vocabulary isn't on main yet; `idiomVocabulary()` is ready for it.
- Function cards: in the Generated code panel each line is its own piece of code, so a call whose arguments run onto the next line gets no "Here". Editors' pointer positions assume a monospace font without wrapping (true of every code field). The ⓘ opens the node card; a click on a node's title still selects and drags it.
