# Expression explainer and "Make a node from this" (2026-10-06)

**Status:** built. Deterministic: no AI, no network. The same text always gives the same words.

## In plain words

Any expression in the app can be explained in plain language, step by step, and any part of it can become a node of its own.

- **Expression Block editor.** Under every line, and under Return, there is an **Explain** row. Folded, it is one sentence: `d is the signed distance to a circle of radius 0.3.` Open it for the steps. Hovering a step lights up its part of the code.
- **Custom Function editor.** An **Explain** section under the body explains it statement by statement.
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
  - **a node in the palette**: the existing publish dialog opens with everything filled in, and the description is taken from the explanation. The node then appears in the node browser and search like any published node. Publishing is Pro, as before.
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
| `explain.ts` | `explainExpression`, `explainLine`, `explainTree`, `breakdownText`, `fmt`. |
| `generalise.ts` | `generalise`, `generaliseText`, `buildFunction`, `descriptionFor`. |
| `evaluate.ts` | A tiny CPU evaluator (float, vec2–4, mat2, the common built-ins), used to prove a made function gives the same values. |
| `findUses.ts` | `findUses`, `matchesInLine`, `codeLines`, `provenance`, `exprBlockEnv`, `customFnEnv`. |
| `saveFlows.ts` | `toExprPreset`, `exprPresetParams`, `toPublishNode`, `insertFunction`, `callInCustomFn`. |

The UI lives in `src/components/explain/`: `ExplainView`, `ExplainRow`, `StatementsExplain`, `GlslExplainPanel`, `MakeNodeDialog`, `FindUsesDialog`, `useExplainDialogs`, `useHoverExplain`, and `hosts.ts` (each editor's context and its "Use it here too").

### API

```ts
import { explainExpression, explainLine, generaliseText, buildFunction, findUses, matchPattern, IDIOMS } from '../lib/glslPatterns';

const ex = explainExpression('fract(sin(uv*3.0)*2.0)', { types: { uv: 'vec2' } });
if (ex.ok) {
  ex.sentence;   // 'Repeating 0–1 ramps of sine waves of uv zoomed out 3×, doubled.'
  ex.steps;      // [{ label: 'A', code: 'uv*3.0', text: 'zooms uv out 3× …', start, end, idiom?, type, role }, …]
  ex.breakdown;  // 'First, A = uv*3.0: … Then, … Finally, fract(C): …'
  ex.idioms;     // [{ idiom, node, bindings, pattern }]
}

const line = explainLine('float d = length(p) - 0.3;', { types: { p: 'vec2' } });
// line.lineSentence: 'd is the signed distance to a circle of radius 0.3.'

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
- **generalise.test.ts**:
  - inputs, names, types and defaults for idioms and as written;
  - every made function parses with `@shaderfrog/glsl-parser`, its body's type is the declared return type, and it gives the same values as the original on sample inputs (CPU evaluator);
  - renames and constants, bad names;
  - the preset flow, and the user-node flow through `buildUserNodeDefinition`;
  - "Use it here too" in GLSL text and in a Custom Function;
  - find uses with provenance, inside groups, by idiom and by made pattern.

## Limits

- One expression at a time. A statement's control flow (`if`, `for`) is skipped and only the simple statements inside are explained. Ints, bools and matrices beyond `mat2` have types but few words.
- Roles are heuristics with stated evidence. A float named `c`, used as a coordinate, may read as a colour channel. The graph's wiring wins when there is one.
- Ranges ("now −2…2") are tracked only through sin / cos / fract / smoothstep / step / clamp, scaling and shifting by numbers.
- The CPU evaluator is for tests and quick checks: no textures, no ints, no `mat3` / `mat4`.
- "Use it here too" in an Expression Block needs every part it reads to be a wired block input (see above). An idiom hole that matched a computed part (`sin(t)` in `sin(t)*0.5+0.5`) counts as computed.
- Find uses scans Expression Block lines and Custom Function statements of the current graph and the bundled examples only, in memory, up to 200 / 300 hits. Saved graphs, imported shaders and linked folders wait for the Code Explorer's index.
- The suggestions vocabulary isn't on main yet; `idiomVocabulary()` is ready for it.
