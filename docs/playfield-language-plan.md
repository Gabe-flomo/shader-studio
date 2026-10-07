# One Playfield language: plan

Status: **plan only, nothing implemented.** Written 2026-10-07 against `main` at 2026.10.60
(`fac31145`).

The ask: *"a standard language that works for the Do… bar and the 3D Scene Builder (and Grid
Rules, Agent Rules), so newcomers don't have to learn several syntaxes. I like the recipe style
more than the Do bar."*

The short answer: make the **Scene Builder recipe** the core syntax for everything, widen it so
it covers 2D pictures, grid rules, agent rules, passes and graph edits, and keep the Do… bar's
plain English as **sugar**. Sugar is turned into canonical recipe lines, and the UI always shows
the canonical line, so people pick the syntax up by using the bar. Under it sits one lexer, one
parser to one AST, one printer, one registry of words, and one compiler per domain. Each compiler
targets the data the builders already store (`SceneSpec`, Grid Rules params, `AgentRuleSet`) or
the graph ops the Do… bar already runs.

```
circle r=0.3 · glow falloff=8 · colour by length                      2D picture
surface · sphere r=1 @move(0,1,0) · smooth-union(box, torus) k=0.5 · output depth   3D scene
grid life survive=2,3,4 board=240 walls                                grid rules
species Ants states=searching,carrying · when searching and food ahead > 0.5 do become carrying, turn around
pass "trails" · fade 0.5s · blur 4                                     passes
connect the noise → the glow.tint · set the glow falloff=8             edits
```

Contents:

1. [What exists today](#1-what-exists-today) (with the places the syntaxes disagree)
2. [Goals and principles](#2-goals-and-principles)
3. [Grammar](#3-grammar) (with an EBNF)
4. [Domains as dialects](#4-domains-as-dialects-of-one-grammar)
5. [Sugar: plain English to canonical](#5-sugar-plain-english-to-canonical)
6. [Mapping tables](#6-mapping-tables): every current phrase, clause, rule and verb
7. [Worked examples](#7-worked-examples) (42)
8. [Architecture](#8-architecture)
9. [Migration and compatibility](#9-migration-and-compatibility)
10. [UX](#10-ux)
11. [Phases, tests and risks](#11-phases-tests-and-risks)
12. [Open questions](#12-open-questions)

---

## 1. What exists today

There are four text surfaces and none of them shares a parser with another. They share some
words.

| Surface | Grammar | Parser | Printer | Code |
|---|---|---|---|---|
| **Do… bar, phrases** | Free English, read left to right over a fixed vocabulary. A shape starts a subject and an action is a step on it. | `parseDo` | none: the preview lists steps, not text | `src/suggestions/doBar.ts`, `src/lang/vocabulary.ts` |
| **Do… bar, commands** | English sentences of clauses split by `,`, "then" and "and" + verb. A verb with slots, references, connectors. | `execCommand`, `classify`, `readRef` | `refText` (a reference only) | `src/suggestions/doCommands.ts`, `doRefs.ts`, `src/lang/commands.ts` |
| **Do… bar, extras** | Grid presets with slots ("game of life on a chunky board, fast, green on black"), 3D outputs ("colour by height palette fire"), builder phrases ("new 3d scene"), idioms, taught phrases | `readGridRules`, `readOutputPhrase`, `readBuilderCommand`, `matchTaught` | none | `doBarGridRules.ts`, `doOutputs.ts`, `src/builders/doBuilders.ts`, `taught.ts`, `idiomBlocks.ts` |
| **Scene Builder recipe** | `clause · clause`, `head key=value`, `op(item, item) k=…`, `@warp(…)`, units, comments, a pretty multi-line form | `parseRecipe` (a real tokenizer and recursive descent, with errors at line and column and "did you mean") | `printRecipe` (shortest form, one-line, multiline or pretty), `formatRecipe` | `src/sceneBuilder/recipe.ts`, `highlight.ts`, `recipeRows.ts`, `output.ts` |
| **Grid Rules text** | B/S notation only (`B36/S23`, `S/B`, `23/3`) in **As text**; the card's one-line summary is output-only | `parseRuleString` | `ruleString`, `ruleSummary`, `gridRecipeText` | `src/gridRules/spec.ts`, `src/builders/recipe.ts` |
| **Agent Rules** | Sentences, **output-only**: "When food trail anywhere ahead > 0.05 → turn toward food trail (20°)". Rules are edited in a form; nothing parses text into rules. | none | `describeRule`, `describeCondition`, `describeAction` | `src/agentRules/spec.ts` |
| Explainer | Roles and plain meanings for GLSL (reads code, writes English) | `lib/glslPatterns/parse.ts` | `meanings.ts`, `explain.ts` | `src/lib/glslPatterns/` |
| Code Explorer | Search words, synonyms to code terms | `words.ts` | none | `src/codeExplorer/synonyms.ts`, `words.ts` |

What is already shared:

- `src/lang/vocabulary.ts` folds the Scene Builder's shapes and aliases into the Do… bar's
  `SHAPES` and maps space actions onto scene warps (`ACTION_TO_SCENE_WARP`).
- `src/lang/typeCheck.ts` (wire checks and fixes, `inferType` for one-line GLSL) is used by the
  Do… bar, the recipe parser, Grid Rules' custom update and Make a node.
- `src/lang/complete.ts` ranks completions for all four surfaces (`recipeAssist`,
  `doBarAssist`, `wordAssist`, `pickerAssist`).
- `src/lang/commands.ts` is a registry that generates the in-app Commands reference and
  `docs/do-bar-commands.md`. `doCommands.test.ts` (around line 370) fails when the shipped doc
  drifts.
- `BuilderWindow`, `BuilderHelp` and `TypeAhead` are shared by all three builders
  (`src/components/builders/`).

### 1.1 Where the syntaxes disagree

These were found by reading the code and, for the recipe, by running `parseRecipe` and
`printRecipe` on sample lines. Each one has to be settled before one grammar can exist.

| # | Disagreement | Where | Resolution in this plan |
|---|---|---|---|
| D1 | **Four lexers.** `vocabulary.tokenize` (lower-cases, drops quotes), `doRefs.lex` (keeps quotes and separators), recipe `tokenize` (numbers with units, hex, `@`, strings, comments) and highlight `lex` (a copy of the recipe one, for colouring) | `vocabulary.ts`, `doRefs.ts:33`, `recipe.ts:58`, `highlight.ts:37` | One lexer (§8.1) |
| D2 | **Two edit distances and two "did you mean" thresholds.** The vocabulary allows none under 4 letters, 1 under 7, else 2. The recipe's `suggest` allows `max(1, len/3)`. | `vocabulary.ts editDistance/fuzzBudget`, `recipe.ts suggest` | One `fuzzy.ts`, using the vocabulary's budget (stricter, already tested on "blue" vs "blur") |
| D3 | **Two colour tables.** The Do… bar's `red` is (1, 0.15, 0.12) and the recipe's is (0.9, 0.15, 0.12). The recipe has silver, brown, cream, sky, night. The bar has lime, warm, cool, neon, fire, ice. | `vocabulary.ts COLOURS`, `recipe.ts COLOR_NAMES` | One table: the union, with the recipe's values where both define a name, because printed recipes already rely on them (§9.3) |
| D4 | **The clause separator.** The bar ends clauses at `,`, "then" and "and" before a verb. The recipe uses `· • | ;` and a new line, and inside brackets `,` separates items. | `doRefs.splitClauses`, `recipe.ts tokenize` | Canonical: `·` or a new line. A top-level `,` is sugar only (§3.2) |
| D5 | **`add` and `subtract`.** In the bar, "add A to B" makes an Add node and "subtract" is arithmetic (`COMBINE_OPS`, `doCommands.ts:954`). In a recipe, `add(…)` is a CSG union and `subtract(…)` is a CSG cut. | `doCommands.ts`, `recipe.ts OP_WORDS` | Arithmetic becomes infix (`the palette + the glow`). Word ops are CSG everywhere (§3.6) |
| D6 | **`glow`.** An action in the bar (SDF Glow, Bloom or Glow (texture), chosen by kind). In a recipe, `glow` is the **volumetric render mode**: `glow · sphere` prints `volumetric · sphere`. | `vocabulary.ts ACTIONS`, `recipe.ts MODE_WORDS` | `glow` is the action everywhere. As a scene mode it is a deprecated alias with a hint |
| D7 | **`both`.** A pair reference in the bar ("both", "these"); `intersect` in a recipe (`both(sphere, box)` prints `intersect(sphere, box)`). | `commands.ts REFERENCE_FORMS`, `recipe.ts OP_WORDS` | A following `(` decides: `both(` is intersect, otherwise it means the two selected nodes |
| D8 | **`noise`.** In the bar it is both a node ("create a noise") and a word for the warp action (`ACTIONS.warp.words`). In a recipe it is the warp kind. | `vocabulary.ts`, `spec.ts WARPS` | `noise` is the node. The warp is written `warp` in both dialects; scene `noise` stays an alias (§9.2) |
| D9 | **`turn`.** A recipe warp (Rotate 3D); in the bar a `replace` verb word ("turn X into Y") and a `zoom-rotate` action word; in agent rules an action ("turn toward"). | `recipe.ts`, `commands.ts`, `agentRules/spec.ts` | The next word decides: `into` is switch sugar, `toward`/`away`/`around` is an agent action, otherwise it is the rotate warp |
| D10 | **`show` and `output`.** In the bar, "output X" or "show X" wires node X to the Output. In a recipe, `output depth` or `show depth` picks what the scene shows. | `commands.ts output`, `output.ts OUTPUT_WORDS` | One verb, `output`. Its argument decides: an output word (depth, normal…) or a reference |
| D11 | **`colour`.** The bar's `colour <ref> by <driver>` puts a palette on a value. The recipe's `colour by depth palette sunset` is an output. | `commands.ts colour`, `output.ts outputClause` | Both are `colour by <driver> [palette=<name>]`. `palette` is an alias head (§4.1) |
| D12 | **Values.** The bar takes `falloff 8`, `8 falloff`, `6 times` and `6x`. The recipe takes `falloff=8` and positional values in a fixed order. | `doBar.ts`, `recipe.ts args` | Canonical `key=value`. The registry marks one **primary** param per head that may be written bare (§3.4) |
| D13 | **Vectors in `@warp(…)`.** `@move(0,1,0)` fails today ("Unexpected ,", and it prints `@move(0)`); it has to be written `@move((0,1,0))`, as `docs/scene-builder.md` does for `@repeat((2,100,2))`. | `recipe.ts warpBody → args([')'])` | When a head's primary param is a vector, a call's bare numbers fill it: `@move(0,1,0)` |
| D14 | **Grid presets clash with other words.** `swirl` (a Stages preset and a bar action), `ripples` (Smooth, and a rings alias), `diamonds` (Count, and the diamond shape), `spirals`. The bar needs a grid word for these. The key `maze` is a Count preset **and** a Smooth preset (label Labyrinth). | `doBarGridRules.ts`, `gridRules/spec.ts` | Grid lines start with `grid` outside the Grid Rules editor. Presets are named by their slugged label (`maze`, `labyrinth`) |
| D15 | **No text in for grid stencils, blocks or agent rules.** Patterns and Blocks exist only as click grids. Agent rules exist only as the form. | `gridRules/stencils.ts`, `agentRules/spec.ts` | New grammar for them (§4.3, §4.4) |
| D16 | **Two lists of value kinds.** Suggestions use `ValueKind` (distance, mask, colour, space, texture, scene3d, scalar). The explainer uses `Role` (space, colour, value, mask, distance, angle, time, direction, cell). | `suggestions/kinds.ts:12`, `glslPatterns/roles.ts:13` | The language's type checker uses `ValueKind`, plus the explainer's angle, time and direction where it can tell them apart (§8.6) |
| D17 | **Synonyms in three places.** `vocabulary.ts` words, `recipe.ts` aliases and `codeExplorer/synonyms.ts` rows overlap (glow/bloom/halo, union/merge/combine, rotate/turn/spin). | three files | Aliases live in the registry; Code Explorer reads them from there (§8.2) |

Some useful facts the probe confirmed:

- Top-level warps in a recipe bend the **whole scene** wherever they are written. The printer
  moves them after the items: `twist 0.5 · sphere · box` prints `surface · sphere · box · twist 0.5`.
- The printer always writes the render mode first (`surface · …`), so a printed recipe already
  starts with a word that says "this is a scene".
- Positional values are filled in order and defaults are left out: `torus 1 0.2` prints
  `torus R=1`, because `r=0.2` is the default.

---

## 2. Goals and principles

1. **Recipe style is the core.** A line is clauses separated by `·`. A clause is a head word
   followed by `key=value` settings, with `(…)` for nesting and `@modifier(…)` for per-item
   changes. This is today's `recipe.ts` grammar, widened, not replaced.
2. **One grammar, several dialects.** 2D pictures, 3D scenes, grid rules, agent rules, passes and
   graph edits use the same tokens, values, nesting and modifiers. A dialect only adds head words
   (from the registry) and one or two rules about what a bare clause applies to (§4).
3. **Plain English is sugar.** Every phrase the Do… bar reads today keeps working. The sugar layer
   rewrites a phrase into a canonical AST. The UI prints the canonical line beside the result
   ("→ `circle · glow falloff=8`") so the short form is taught by use.
4. **Readable.** Words, not symbols. The only symbols are `·`, `=`, `( )`, `,`, `@`, `→` (or
   `->`), `#` for hex, quotes for names, `{ }` for raw GLSL, and `+ - * /` between values.
5. **Forgiving.** Case, spacing, plurals, aliases, units and small typos are accepted. A mistake
   is reported at its line and column with "did you mean". The rest of the line still applies, as
   `parseRecipe` and `execCommand` both do today.
6. **Deterministic.** The same text on the same graph always gives the same AST and the same graph
   ops. There is no learned ranking inside the parser (taught phrases are explicit entries), and
   ties are broken by fixed rules (§3.9).
7. **Round-trippable.** For builder-made parts, data → text → data is the identity:
   `parse(print(spec))` equals `spec`, and `print(parse(text))` is the canonical form of `text`.
   The scene recipe has this today (`recipeFormat.test.ts`, `sceneBuilder.test.ts`). The plan
   extends it to Grid Rules params, `AgentRuleSet` and pass chains. Free graph edits are not
   round-tripped: they are commands, not descriptions.
8. **Text is a view, data is the truth.** Builders keep storing their specs (`META_KEY` on the
   Scene Group, Grid Rules params, `params.agentRules`). The language never becomes the stored
   form, so no saved file has to be migrated (§9).
9. **One registry.** Every head word, alias, param, unit, example and hint is defined once. The
   parser, printer, highlighter, completion, signature help, type checker, the in-app reference and
   the generated docs all read it, as `commands.ts` already does for the bar's verbs.

---

## 3. Grammar

### 3.1 Lines, clauses, separators

A **program** is lines, and a line is clauses:

- `·` (also `•`, `|`, `;`) or a new line ends a clause.
- `//` starts a comment.
- Inside brackets, an **indented** new line, or one that starts with `)`, continues the clause.
  This is today's `continuesClause` rule, which allows the pretty form.
- Under a **block header** (`species …`, `patterns …`, `blocks …`, `pass …`), indented lines
  belong to that block (§3.7). A line that is not indented closes the block.

`,` separates items inside `( )`, values in a list (`survive=2,3`) and actions in a
`do` list. At the top level of a clause, `,` is **never** a clause separator in canonical text.
The sugar reader treats it as one ("circle with a glow, falloff 8").

### 3.2 Clauses

Every clause is one of these:

| Clause | Shape | Example |
|---|---|---|
| **maker** | a head that makes something, then settings and modifiers | `circle r=0.3`, `sphere at=(1,0,0) @twist(2)`, `noise scale=4` |
| **step** | a head that acts on *it* (the subject), then settings | `glow falloff=8`, `twist 0.5`, `tone-map`, `fade 0.5s` |
| **combine** | `op(item, item…)` then settings and modifiers | `smooth-union(sphere, box) k=0.3`, `mix(the palette, the glow) by=0.3` |
| **setting** | a dialect setting: one value or `key=value` | `camera dist=4 orbit=10`, `fog 0.3`, `board=240`, `edges=bounce` |
| **output** | what is shown | `output depth`, `colour by depth palette=fire`, `output the glow` |
| **reference** | just a reference: it becomes the subject | `the circle`, `these`, `"Halo"` |
| **expression** | values joined by `+ - * /` | `it * the circle`, `the noise + it`, `it * 2` |
| **edit** | a verb with fixed slots | `connect the noise → the glow.tint`, `switch the noise to voronoi` |
| **rule** | `when … do …`, `always do …` | `when searching and food ahead > 0.5 do become carrying` |
| **header** | starts a dialect or a block | `surface`, `grid life`, `species Ants`, `pass "trails"` |

What a head word means comes from the registry for the dialect in force (§4). A word can be a
maker in one dialect and an alias in another, but never two things in the same dialect.

### 3.3 Values

| Value | Written | Notes |
|---|---|---|
| number | `1`, `-0.5`, `.25`, `1e-3` | `−` (U+2212) is accepted |
| angle | `30deg`, `30°`, `0.5rad` | Angles are degrees when no unit is given, as in the recipe today |
| time | `0.5s`, `200ms` | New. For fade tails, agent ages and timers |
| rate | `1/s`, `60%/s` | New. For "count up a second" and chance a second |
| percent | `60%` | New. Means 0.6 |
| count | `6x` | Sugar for `6` (the bar accepts "6x" today) |
| vector | `(x,y)`, `(x,y,z)`, `(x,y,z,w)` | One number fills every part: `size=0.5`. Two numbers fill x and y with z = 0 (recipe rule) |
| colour | `#rgb`, `#rrggbb`, a colour word, `(r,g,b)` in 0–1 | In a colour slot a vector is a colour. One table (D3) |
| place | `middle`, `top-left`, `bottom-right`… | A word for a 2D position (`vocabulary.ts PLACES`). Same as the vector |
| list | `2,3` after `key=`; or `(2,3)` | A list ends at a token that cannot be a value, such as `·`, a new `key=` or a word that is not a name |
| range | `34..45` | New. Larger-than-Life ranges |
| name | `Body`, `"My shape"` | A bare word, or quoted when it has spaces |
| code | `{u + 0.2 * lap_u}` | Raw GLSL, checked by `typeCheck.inferType`. `custom(…)` in a recipe stays as an alias |
| reference | `it`, `the circle`… | §3.8 |
| choice | `aces`, `wrap`, `moore` | A word from the param's option list |
| flag | `glass`, `wrap`, `walls`, `off` | A bare word the registry marks as a boolean or choice shortcut |

### 3.4 Settings: `key=value`, positional values, the primary

- **Canonical** settings are `key=value`. The keys are the recipe's keys (`r`, `size`, `at`,
  `rot`, `k`, `falloff`…). A key can have aliases (`radius` and `size` for `r`, `colour` for
  `color`), taken from `vocabulary.ts PARAMS` and the recipe's `ParamDef`s.
- **Positional** values fill the head's params in order (today's recipe rule: `torus 1 0.2` is
  `torus R=1 r=0.2`).
- The registry may mark one param as a head's **primary**. The printer writes the primary bare
  and every other param as `key=value`. This is exactly today's printer behaviour for warps
  (`twist 0.5`, `polar-repeat 6`) and single-value settings (`fog 0.3`, `tone agx`), extended
  to steps (`blur 4`, `fade 0.5s`, `wander 7deg`).
- **Relative** values, which are new: `radius*=1.25`, `falloff+=2`, `speed/=2`. These carry the
  bar's "make it bigger", "double the speed" and "increase … by 0.1" (`commands.ts adjust`).
- A **flag** is a bare word the registry lists for the head (`glass`, `wrap`, `walls`, `off`).

### 3.5 Nesting: combines and groups

- `op(item, item, …)` then `k=`, `name=` and `@modifiers`. Items are makers, combines or
  references, separated by `,`. Combines nest. All of this is today's recipe grammar.
- The same syntax works in 2D (`union(circle, box at=right)`), where it compiles to the
  `sdfUnion`, `sdfSubtract` and `sdfIntersect` nodes the bar's `union`/`cut`/`intersect` verbs
  already use (`doCommands.ts COMBINE_OPS`) and the smooth blend of the `blend` move.
- `mix(a, b) by=0.3`, `screen(a, b)`, `overlay(a, b)` are colour combines, using the same nodes
  as `COMBINE_OPS` mix, screen and overlay.
- `group(…)` names a node group in edits: `group(the circle, the glow) name="Neon"`. The bar's
  "group … as" is sugar for it. Inside a scene, `group` stays an alias of `union`, as it is
  today.

### 3.6 Arithmetic (D5)

Arithmetic nodes are written as **infix expressions**, with spaces around the operator because
`-` can be part of a word (`smooth-union`, `tone-map`):

```
it * the circle            Multiply (base: it)
the noise + it             Add (base: the noise, so the result takes the noise's place)
it * 2                     Multiply by a number
the palette - the glow     Subtract (arithmetic)
```

The left operand is the **base**, which is where the result goes. This is the bar's rule ("add A
to B uses B as the base", `commands.ts combine`), now written in the order a reader expects. The
word ops `add`, `subtract`, `minus`, `cut`, `union`, `intersect` are **CSG** in every dialect.

### 3.7 Blocks

Some dialects need several lines under one header:

```
species Ants speed=0.3 states=searching,carrying
  always do memory += 1/s, wander 5deg
  when searching and mask Food > 0.5 do become carrying, turn around @last

patterns states=4
  stencil .../.1./... → 2
```

A header clause opens a block. Indented clauses belong to it. On one line, `·` after a block
header keeps adding to that block until the next header of the same or a higher level, so
`species Ants · always do wander 7deg` is one species with one rule.

### 3.8 References

References carry over the bar's reference forms (`commands.ts REFERENCE_FORMS`,
`doRefs.readRef`) and give each one a short canonical spelling:

| Form | Canonical | Sugar accepted |
|---|---|---|
| The last result | `it` | that, the result, the last one, the new one |
| The selection | `this`, `these` | the selection, them, those, both (when no `(` follows) |
| By label | `"Halo"` | the "Halo" node, the 'Halo' node |
| By type | `the circle`, `the noise` | the circle node, circle (in a reference-only slot) |
| By order | `the circle#2` | the second circle, circle 2 |
| By role | `the picture` | the current output, what the output shows, what feeds the output |
| Along the chain | `before the output`, `after the circle` | the node before the output |
| Several | `all circles`, `the circle and the glow` | every circle |
| A socket | `the glow.tint`, `the output.color` | the tint of the glow, the glow's tint |
| A scene item | `the scene`, `the scene.Body` | (new) a named item in a built scene |

**New thing or existing thing?** A bare type word in a maker position makes a **new** node, and
`the <type>` refers to an **existing** one. In a slot that only takes references (connect,
set, delete…), a bare word is a reference, and the printer leaves the `the` out there:
`set glow falloff=8`. This is the bar's own test: `hasDefiniteRef` in `doCommands.ts` treats
"the" as the sign of a reference.

When a reference fits several nodes, the selected one wins, then `it`, and otherwise the
preview asks for a pick. These are today's rules (`CmdPick`).

### 3.9 Edit verbs

Every verb in `commands.ts COMMAND_VERBS` has a canonical form. Its slots are fixed, and a few
small keywords join them (`to`, `→`, `between … and`, `after`, `before`, `as`):

```
create <maker>                         (the verb is optional: a maker clause creates)
connect <ref> → <ref>[.<socket>]
disconnect <ref> [from <ref>] | disconnect <ref>.<socket>
reconnect <ref> → <ref>[.<socket>]
insert <maker> between <ref> and <ref> | insert <maker> after <ref> | insert <maker> before <ref>
<expr>                                 (multiply, add, subtract, divide: §3.6)
mix(<ref>, <ref>) by=<n> | screen(…) | overlay(…) | union(…) | intersect(…) | subtract(…)
output [<ref> | <output-word> [palette=<p>]]
switch <ref> to <type>
delete <ref>
rename <ref> "<name>"
duplicate <ref>
set <ref> <key>=<value> …              (and <key>*=, +=, -=, /=)
group(<ref>, …) [name="<name>"]
select <ref>
colour by <driver> [palette=<p>]       (on it; "the glow · colour by time")
```

**Tie-breaks**, applied in order so that reading is deterministic:

1. A word followed by `(` is a call: a combine, `@modifier`, `group` or `custom`.
2. A word followed by `=` is a key.
3. The longest registry phrase wins (`smooth-union` over `smooth`). This is `matchAt`'s rule.
4. Within a dialect, a head word means one thing. Across dialects, the dialect in force decides
   (§4.0).
5. An exact word beats an alias, which beats a plural, which beats a typo (`matchAt`'s order).

### 3.10 Outputs

| Canonical | Means | Today |
|---|---|---|
| `output` | wire *it* to the Output | "output it", "show it" |
| `output the glow` | wire that node to the Output | "output the glow" |
| `output depth` | a 3D scene shows depth (also normal, hit, position, steps, ao, shadow, distance, height, picture) | recipe `output depth`, bar "show the depth" |
| `colour by depth palette=fire` | a 3D output through a palette | recipe `colour by depth palette fire` |
| `colour by length palette=sunset` | 2D: *it* coloured by a driver through a palette (driver: `length`, `angle`, `x`, `y`, `time`, `noise`, or a reference) | bar `colour it with a palette by the length of the space` |
| `show=state` | Grid Rules: what Color shows (colours, state, age, neighbours) | editor **Show** |
| `picture trail` | Agent Rules: what the picture shows (trail, channel1–4, density) | **What the picture shows** (`agentRules/outputs.ts`) |

`palette=` takes the keys in `sceneBuilder/output.ts PALETTES` in both 2D and 3D. The printer
writes `palette=` as a key. The recipe's bare `palette fire` stays accepted.

### 3.11 EBNF

```ebnf
program     = { line } ;
line        = [ clause { SEP clause } ] NEWLINE ;
SEP         = "·" | "•" | "|" | ";" ;                     (* NEWLINE also ends a clause *)

clause      = header | rule | edit | combine | maker | step | setting | output
            | expression | reference ;

header      = HEADWORD { arg } ;                           (* registry: kind = header *)
maker       = HEADWORD { arg } { modifier } ;              (* kind = maker *)
step        = HEADWORD { arg } { modifier } ;              (* kind = step; acts on "it" *)
setting     = HEADWORD { arg } | KEY "=" value ;           (* kind = setting *)
combine     = OPWORD "(" item { "," item } ")" { arg } { modifier } ;
item        = combine | maker | reference ;
output      = "output" [ reference | OUTWORD { arg } ]
            | "colour" "by" driver { arg } ;
driver      = OUTWORD | "length" | "angle" | "x" | "y" | "time" | "noise" | reference ;

arg         = KEY "=" value
            | KEY ( "*=" | "/=" | "+=" | "-=" ) number
            | FLAG
            | value ;                                      (* positional: fills params in order *)
modifier    = "@" WORD [ "(" { arg } ")" ] ;

value       = number | vector | colour | list | range | string | code | reference | WORD ;
number      = NUM [ UNIT ] ;
UNIT        = "deg" | "°" | "rad" | "s" | "ms" | "%" | "x" | "/s" ;
vector      = "(" number { "," number } ")" ;              (* 1–4 numbers *)
colour      = HEX | COLOURWORD | vector ;
list        = value "," value { "," value } ;              (* only after KEY= *)
range       = NUM ".." NUM ;
string      = '"' { CHAR } '"' ;
code        = "{" { CHAR | code } "}" ;                    (* balanced braces: raw GLSL *)

expression  = operand OP operand { OP operand } ;          (* spaces around OP *)
operand     = reference | number | "(" expression ")" ;
OP          = "+" | "-" | "*" | "/" ;

reference   = "it" | "this" | "these" | "the" "picture" | "the" "scene" [ "." NAME ]
            | string
            | "the" TYPEWORD [ "#" INT ] [ "." SOCKET ]
            | ( "before" | "after" ) reference
            | "all" TYPEWORD
            | reference "and" reference ;

edit        = "connect" reference ARROW reference
            | "disconnect" reference [ "from" reference ]
            | "reconnect" reference ARROW reference
            | "insert" maker ( "between" reference "and" reference | ( "after" | "before" ) reference )
            | "switch" reference "to" TYPEWORD
            | "delete" reference | "duplicate" reference | "select" reference
            | "rename" reference string
            | "set" reference arg { arg } ;
ARROW       = "→" | "->" | "to" | "into" ;

rule        = ( "when" cond { "and" cond } | "always" ) "do" action { "," action } { modifier } ;
cond        = [ "not" ] NAME                                       (* a state *)
            | NAME WHERE CMP number                                (* a trail channel *)
            | "near" NAME CMP number | "chance" number
            | "age" CMP number | "memory" CMP number | "mask" NAME CMP number ;
WHERE       = "ahead" | "left" | "right" | "anywhere" | "here" ;
CMP         = ">" | "<" | "=" ;
action      = HEADWORD { arg } | "memory" ( "=" | "+=" ) value ;

stencil     = "stencil" ROW3 "/" ROW3 "/" ROW3 ARROW INT { arg } { modifier } ;
block       = "block" ROW2 "/" ROW2 ARROW ROW2 "/" ROW2 { arg } { modifier } ;
ROW3        = 3 * CELL ;  ROW2 = 2 * CELL ;
CELL        = "." | "*" | "=" | DIGIT ;                    (* any, not empty, unchanged, state *)
```

`HEADWORD`, `OPWORD`, `OUTWORD`, `TYPEWORD`, `FLAG`, `KEY` and `COLOURWORD` are all looked up in
the registry for the dialect in force. The grammar itself has no domain words.

---

## 4. Domains as dialects of one grammar

### 4.0 Choosing the dialect

The first rule that applies decides:

1. **The surface.** A builder's Recipe tab fixes its dialect: Scene, Grid or Agents. Pass
   chains and edits can be used inside every dialect.
2. **A header** at the start of the line or block: a render mode (`surface`, `volumetric`,
   `glass`, `gi`) or `scene` for 3D; `grid` or a grid rule type or preset for grid rules;
   `agents` or `species` for agent rules; `pass` for a pass chain.
3. **Inference** in the Do… bar. A line is 3D when it uses a 3D-only word (`cone`, `capsule`,
   `output depth`, `camera`, `@move`…) and no 2D-only word. When it uses both, the preview asks
   for a header and offers `scene ·` as a fix.
4. **Otherwise** the line is a 2D picture or an edit on the graph level being edited, which is
   what the bar does today.

What a bare clause applies to (**it**) is the one place the dialects differ:

| Dialect | Top-level makers | Top-level steps / warps | Starting *it* |
|---|---|---|---|
| 2D picture | each starts a new subject (the bar today) | act on *it*; a space step goes in front of its UV | the selection, else the picture |
| 3D scene | joined by an implicit union (the recipe today) | bend the **whole scene**, wherever they are written (recipe today) | the scene |
| Grid | (none) | settings on the rule | the Grid Rules node |
| Agents | (none) | rules belong to the species block | the rule set |
| Pass | (none) | act on the pass's texture | the new Pass |
| Edit | a maker creates a node | act on *it* | the selection, else the picture |

### 4.1 2D picture

Heads come from the bar's vocabulary.

- **Makers**: the shapes in `vocabulary.ts SHAPES` (2D nodes), every node by name (`noise`,
  `voronoi`, `gradient`, `uv`, `time`… through `doRefs.typeByName`), idioms
  (`idiom soft-circle`, from `idiomVocabulary()`) and taught phrases (`neon-edge pink width=0.02`).
- **Steps**: the 30 `ACTIONS`, under canonical hyphenated names (§6.2). They resolve by kind as
  today: `glow` on a distance is SDF Glow, on a colour Bloom, and on a texture Glow (texture)
  (`doBar.ts`, `kinds.ts`).
- **Space steps** (`twist`, `swirl`, `mirror`, `repeat`, `polar-repeat`, `polar`, `warp`,
  `zoom-rotate`) go in front of *it*'s UV. As modifiers they go on one item:
  `circle @twist(0.5)`. A top-level `twist 0.5` is "twist the space" of *it*.
- **Settings on a maker**: the node's params by key, label or `PARAMS` word: `r`, `at`,
  `color`, `falloff`.

```
circle r=0.3 · glow falloff=8 · colour by length
```

`palette by length` reads as the same clause. The bar's `palette` action word becomes the head
alias (§12, Q1).

### 4.2 3D scene

This is today's recipe grammar unchanged, apart from the decisions in §1.1: `@move(0,1,0)`
works (D13), the `noise` warp prints as `warp` (D8), and `glow` as a mode prints as
`volumetric` with a hint (D6).

```
surface · sphere r=1 @move(0,1,0) · smooth-union(box, torus) k=0.5 · output depth
```

Heads: modes (`surface`, `volumetric`, `glass`, `gi`), the 20 shapes of `spec.ts SHAPES`, the
6 combines, the 14 warps of `spec.ts WARPS`, the settings (`sun`, `sky`, `bounce`, `shadows`,
`ao`, `fog`, `background`, `tone`, `camera`, `quality`), `output` and `colour by`.

### 4.3 Grid rules

The header is `grid` (it can be left out inside the Grid Rules editor), followed by a rule type
or a preset. Everything after it maps one-to-one onto Grid Rules params
(`gridRules/spec.ts GRID_DEFAULTS`).

```
grid life survive=2,3,4 board=240 walls
grid count born=3 survive=2,3 neighbours=moore board=240 wrap
grid count neighbours=radius radius=5 born=34..45 survive=33..57         (Bosco)
grid stages born=2 survive= states=3                                     (Brian's Brain)
grid smooth waves speed=0.9 damping=0.995 board=480 walls
grid smooth custom u={u + 0.2 * lap_u} v={v} a=0.5
```

| Setting | Params | Values |
|---|---|---|
| rule type | `ruleType` | `count`, `stages`, `smooth`, `patterns`, `blocks` (or a preset that implies one) |
| `born=`, `survive=` | `bornMask`, `surviveMask` (or `bornLo..bornHi` for a radius) | a list `3,6` or a range `34..45`; `B36/S23` is accepted as a value for the pair |
| `neighbours=` | `neighbourhood`, `radius`, `shape` | `moore`, `von-neumann`, `radius` with `radius=1..7`, `shape=box|circle` |
| `states=` | `states` | 2–16 |
| template (smooth) | `template` and its sliders | `heat`/`diffusion spread= cooling=`, `waves speed= damping=`, `reaction feed= kill= spread-a= spread-b=`, `custom u={…} v={…} a= b= c= d=` |
| `board=` | `board` | cells across at 1080p, snapped to the nearest size (960, 480, 240, 120, 60), as `boardFor` does today |
| `wrap` / `walls` | `edges` | flags |
| `speed=`, `steps=` | `rate`, `steps` | 0–1; 1–16 (the bar's `speedParams` rule: a speed above 1 means steps) |
| `start=` | `start`, `density`, `seed` | `noise density=0.3 seed=1`, `empty`, `image`, `centre` |
| `brush` | `brushRadius`, `brushState`, `brushFill` | `brush size=3 state=1 fill=0.5` |
| `colours` | `color0…7`, `glowColor`, `oldColor` | `colours empty=black on=green dying=… old=…` (names per type), or `color0=…` |
| `afterglow=`, `age-fade=` | `afterglow`, `ageFade` | numbers |
| `show=` | `view` | `colours`, `state`, `age`, `neighbours` |

**Stencils** (Patterns) are 3×3 cells, top row first, rows split by `/`: `.` any, `*` not
empty, `0–9` a state. Then `→` and the state it becomes. A `count=` asks for "min..max
neighbours in state". Symmetry is a modifier: `@turns` (four) or `@turns-mirrors` (eight); the
default is as drawn. These map one-to-one onto `PatternRule` (`stencils.ts`).

```
grid patterns states=4                      // Wireworld
  stencil .../.1./... → 2
  stencil .../.2./... → 3
  stencil .../.3./... → 1 count=1:1..2
```

**Blocks** (Margolus) are 2×2 before and after: `TL TR / BL BR`. Before cells are `.` any, `*`
not empty, or a state. After cells are `=` unchanged or a state. Then `chance=` and `@mirror` or
`@turns`. These map onto `BlockRule`.

```
grid blocks states=3                        // Falling sand
  block 11/00 → 00/11
  block 1./0. → 0=/1= @mirror
  block 10/*0 → 00/=1 @mirror chance=0.8
```

**Presets** are named by their slugged labels, the same in both editors: `life`, `highlife`,
`seeds`, `day-and-night`, `maze`, `coral`, `anneal`, `diamoeba`, `replicator`,
`life-without-death`, `caves`, `diamonds`, `bosco`, `majority`; `brians-brain`, `star-wars`,
`frogs`, `sticks`, `spirals`, `swirl`, `lava`, `bloomerang`; `heat`, `ripples`, `mitosis`,
`coral-growth`, `worms`, `spots`, `labyrinth`; `wireworld`, `falling-dots`, `crystal`;
`falling-sand`, `gas`. A preset brings its look. Settings after it override, so the printer
writes `grid life walls` rather than spelling out the masks again (`matchingPreset` already
finds the preset).

### 4.4 Agent rules

This dialect is new. Its sentences follow `describeRule` closely, so the Rules chip already reads
almost like canonical text.

```
agents edges=bounce
sensors ahead=0.04 angle=35deg
channels home, food
masks Food, Nest
species Ants speed=0.3 states=searching,carrying
  always do memory += 1/s, wander 5deg
  when searching and mask Food > 0.5 do become carrying, turn around, memory = 0 @last
  when carrying and mask Nest > 0.5 do become searching, turn around, memory = 0 @last
  when searching do leave home 1 fade=0.15
  when searching and food anywhere > 0.05 do turn toward food 20deg
  when carrying do leave food 1 fade=0.15, turn toward home 20deg, turn toward (-0.15,-0.1) 2deg
```

| Part | Canonical | `AgentRuleSet` |
|---|---|---|
| set settings | `agents edges=wrap|bounce|slide` · `sensors ahead= angle=` · `flow size= evolve=` · `picture trail|channel1…4|density` | `edges`, `sensor`, `flow`, outputs |
| channels | `channels home, food` (blank: channel1…4) | `channels` |
| masks | `masks Food, Nest` (`Food:texture` for a texture mask) | `masks` |
| species | `species <Name> speed= states=a,b,…` and `state <name> color=…` | `species[i]` |
| rule | `when <cond> and … do <action>, …` or `always do …`; `@last` (stop after this rule); `@off` | `AgentRule.when`, `.do`, `.stop`, `.off` |

Conditions (the `RuleCondition` kinds): `always`; `<channel> <where> > v` (where is `ahead`,
`left`, `right`, `anywhere` or `here`; `trail` is its own channel); `near <Species> > v`;
`chance 60%` (a second); `age > 2s`; `<state>` or `not <state>`; `memory > v`, `memory < v`,
`memory = v`; `mask <Name> > v`.

Actions (the `RuleAction` kinds): `turn toward|away from <channel>|(x,y)|centre|mouse <deg>`;
`wander <deg>`; `speed <v>`; `accelerate <v>/s`; `leave <channel> <amount> [fade=]`;
`become <state>`; `memory = v`, `memory += v`, `memory += v/s`, `memory = random v`; `stop`;
`stick`; `die`; `spawn <amount>`; `turn around` (alias `bounce`); `follow flow <deg>`;
`against flow <deg>`; `align <deg>`.

**Names.** A bare word in a condition is a state. A channel is always followed by a where word,
and a mask always follows `mask`. Those rules alone tell them apart, even in the Ants template,
where a channel is called `food` and a mask `Food`. A state whose name is a keyword is quoted.

### 4.5 Passes

This dialect is new. It gives a name to chains the bar's texture moves already build (`moves.ts`
`TEXTURE`: `blur-texture`, `glow-texture`, `trails`, `outline-texture`, `flow`).

```
pass "trails" scale=1/2 · fade 0.5s · blur 4
```

- `pass "<label>" [scale=1|1/2|1/4|1/8|1/16|1/32] [repeat=] [format=half|byte]
  [filter=linear|nearest] [edges=clamp|repeat|mirror]` adds a Pass node (`passes.ts`) fed by
  *it*. Its Texture becomes *it*.
- `fade <tail>` is the `trails` move: Fade (feedback), `textureFade` `tail` in seconds, reading
  the Pass's Previous, through the `fade-trails` node recipe. `clean=` and `tint=` are its other
  params.
- `blur <px>` is `blurTexture radius`, `glow threshold= radius= intensity=` is `glowTexture`,
  `edges strength= width=` is `edgesTexture`, and `flow strength=` is `textureFlow` →
  `readTexture`.

### 4.6 Edits on existing graphs

Edits are the bar's command language in canonical form (§3.9). They can be mixed with makers and
steps on one line, because every clause runs on the graph that the clauses before it left. That is
how `execCommand` works today, with a working copy and a diff per clause.

```
disconnect the picture · the noise + it · output
```

Edits on a **builder-made** part go through its spec. `output depth` on a built scene is today's
rebuild with `spec.output` (`doOutputs.ts`). In the new design, `set the scene.Body r=0.6` would
be a spec edit followed by a rebuild, rather than a node param edit, so the recipe stays true
(§12, Q4).

---

## 5. Sugar: plain English to canonical

The sugar reader is today's Do… bar, kept whole and pointed at a new target. Today
`parseDo` makes `DoStep`s and `execCommand` makes `CmdClause`s. In the new design both make
**canonical AST nodes**, which the shared compiler then runs. Every rule they apply stays: filler
words, plurals, typos, number words, places, "it", targets and the relative words.

How the bar decides, deterministically:

1. **Builder phrases** (`readBuilderCommand`, an exact normalised phrase) come first, as now.
2. **Canonical first.** If the whole line parses as canonical in the dialect chosen by §4.0, with
   no errors, it is canonical.
3. **Otherwise sugar.** The phrase readers run in today's order: taught phrases, then grid
   presets (`readGridRules`), then 3D outputs (`readOutputPhrase`), then commands and phrases
   (`execCommand`, which falls back to `parseDo`). Each one now returns AST.
4. **Neither.** The bar falls back to node search and idioms, as it does today.

In step 2, a line with a sugar-only token (`with`, `in the`, `times`, a top-level `,`) is never
canonical. That keeps the two readers from both claiming one line.

Sugar rules (all of them exist today):

| Sugar | Canonical | Source |
|---|---|---|
| `X with a glow` | `X · glow` | `doBar.ts` subject rule |
| `falloff 8`, `8 falloff` | `falloff=8` | `PARAMS` |
| `6 times`, `6x`, `six` | `6` (the primary, or `count=`) | `PARAMS.count`, `NUMBER_WORDS` |
| `in the middle`, `at the top left` | `at=middle`, `at=top-left` | `PLACES` |
| `it`, `this`, `the selection` | `it`, `this` | `TARGETS`, `REFERENCE_FORMS` |
| `the space` | a space step on *it* (or `@step` on the named item) | `TARGETS.space` |
| `the picture`, `the current output` | `the picture` | `TARGETS.picture`, role refs |
| `, then`, `and then`, `after that` | `·` | `CONNECTORS` |
| `make it bigger` | `set it r*=1.25` | `RELATIVE_WORDS`, `RELATIVE_STEP` |
| `a bit` / `much` | `*=1.1` / `*=1.6` | `RELATIVE_STEP` |
| `add A to B` | `B + A` | `combine`, base B |
| `subtract A from B` | `B - A` (arithmetic) | `combine` |
| `multiply A by B` | `A * B` | `combine` |
| `cut A from B` | `subtract(B, A)` (CSG) | `COMBINE_OPS.cut` |
| `turn X into Y`, `replace X with Y` | `switch X to Y` | `replace` |
| `the tint of the glow`, `the glow's tint` | `the glow.tint` | `of`, `'s` connectors |
| `game of life on a chunky board, fast, green on black` | `grid life board=120 speed=1 colours empty=black on=green` | `readGridRules` |
| `show the normals` | `output normal` | `readOutputPhrase` |

Unknown words: a sugar line keeps today's behaviour ("Skipped …"). A canonical line reports the
word at its column, with "did you mean".

---

## 6. Mapping tables

What "changes" means in these tables: **same** means the text the user types still works and
already is canonical. **sugar** means it keeps working and the bar shows the canonical line
beside it. **alias** means a word that still works in its dialect and gets a gentle
deprecation hint. **new** means there is no text form today.

### 6.1 Do… bar verbs (`commands.ts COMMAND_VERBS`, 16)

| Verb (words) | Example today | Canonical | Changes |
|---|---|---|---|
| create (new, draw, make a, add a, place) | create a ring with falloff 0.3 | `ring · glow falloff=0.3` | sugar; the verb is optional |
| connect (wire, plug, link, feed, hook up, attach) | connect the noise to the tint of the glow | `connect the noise → the glow.tint` | sugar; `→` or `->` |
| disconnect (unplug, unwire, unlink, detach) | disconnect the position of the circle | `disconnect the circle.position` | sugar |
| reconnect (rewire, reroute) | reconnect the circle to the output | `reconnect the circle → the output` | sugar |
| insert (put, slot, splice) | insert a tone map between the palette and the output | `insert tone-map between the palette and the output` | sugar; node names hyphenated |
| combine: multiply, times, add, subtract, divide | multiply the output with the noise | `the picture * the noise` | infix (§3.6) |
| combine: mix, blend (colours) | mix the palette with the glow by 0.3 | `mix(the palette, the glow) by=0.3` | sugar |
| combine: screen, overlay | screen the glow over the palette | `screen(the palette, the glow)` | sugar |
| combine: union, merge, intersect, cut | union the circle with the box | `union(the circle, the box)` | sugar; `cut` means `subtract(…)` (CSG) |
| output (show, display, preview) | output the glow | `output the glow` | same |
| replace (switch, swap, turn, change) | switch the noise to voronoi | `switch the noise to voronoi` | same; `turn … into` is sugar |
| delete (remove, erase, drop) | remove all circles | `delete all circles` | sugar |
| rename (call, name, label) | rename the glow to "Halo" | `rename the glow "Halo"` | sugar |
| duplicate (copy, clone) | duplicate the circle | `duplicate the circle` | same |
| set (change) | set the glow falloff to 8 | `set the glow falloff=8` | sugar |
| adjust (make, increase, double, halve…) | make the glow much wider | `set the glow width*=1.6` | sugar; relative assignment is new |
| group (bundle, wrap up) | group the circle and the glow as "Neon" | `group(the circle, the glow) name="Neon"` | sugar |
| select (pick, find, highlight) | select the node before the output | `select before the output` | sugar |
| colour (color, paint, shade) | colour it with a palette by the length of the space | `colour by length` | sugar |

### 6.2 Do… bar build actions (`vocabulary.ts ACTIONS`, 30)

| Action id | Words today (first few) | Canonical head | Notes |
|---|---|---|---|
| glow | glow, halo, neon, bloom | `glow` | by kind (unchanged); not a scene mode any more (D6) |
| rings | rings, ripples, contours | `rings` | `ripples` stays an alias outside grid lines |
| outline | outline, border, edges | `outline` | |
| onion | onion, hollow, shell | `onion` | |
| round | round, grow, bigger | `round` | `bigger` alone becomes relative sugar (§5) |
| blend | blend, melt, smooth union | `smooth-union` | same word as 3D; on `these` it is the pair blend |
| mask-from | mask, cutout, stencil | `mask` | `stencil` means the grid stencil inside grid lines |
| warp | warp, distort, noise, organic | `warp` | `noise` is the node (D8) |
| swirl | swirl, vortex, spin | `swirl` | |
| twist | twist, spiral | `twist` | |
| polar | polar, radial | `polar` | to polar coordinates (2D only) |
| mirror | mirror, symmetric, flip | `mirror` | 3D: Fold 3D |
| repeat | repeat, tile, grid of | `repeat` | `grid of` stays sugar; `grid` is the grid header |
| repeat-around | repeat … around, petals, kaleidoscope | `polar-repeat` | same name as the 3D warp |
| zoom-rotate | zoom, scale, rotate, turn | `zoom-rotate zoom= angle=` | `rotate` alias; `turn` per D9 |
| code-here | custom code, expression | `custom {…}` | |
| mix-with | mix, tint | `mix with=<colour>` | |
| palette | palette, colorize, rainbow | `colour by` (alias `palette`) | Q1 |
| tone-map | tone map, aces | `tone-map` | 3D: `tone aces` setting |
| grade | grade, colour grade | `grade` | |
| brighten | brighter, exposure | `brighten` | |
| grain | grain, dither | `grain` | |
| blend-with | blend mode, screen, overlay | `screen(…)` / `overlay(…)` | |
| soft-edge | soften, feather | `soft-edge` | |
| invert | invert, negate | `invert` | |
| grow-mask | shrink, erode, dilate | `grow-mask` | |
| mix-two | mix two pictures | `mix(…) by=<mask>` | |
| blur-texture | blur, defocus | `blur` | pass dialect |
| trails | trails, feedback, echo | `fade` (alias `trails`) | pass dialect |
| flow | flow, stream, smudge | `flow` | pass dialect |
| remap | remap, normalize | `remap` | |

### 6.3 References, targets, connectors

| Today | Canonical | Changes |
|---|---|---|
| it, that, the result, the last one | `it` | sugar |
| this, these, them, both, the selection | `this` / `these` | sugar; `both(` is intersect (D7) |
| "Glow", the 'Halo' node | `"Glow"` | same |
| the circle, the noise | `the circle` | same |
| the current output, what the output shows | `the picture` | sugar |
| the node before / after X | `before X` / `after X` | sugar |
| the first / second / last circle, circle 2 | `the circle#1`, `the circle#2`, `the circle#last` | sugar |
| all circles, every circle | `all circles` | same |
| the space, the uv | a space step on *it* | sugar |
| `,` `then` `and then` `after that` `next` `finally` | `·` | sugar |
| `and` (+ verb) | `·` | sugar |
| `with` | a setting, or the second operand | sugar |
| `by` | `by=` (mix), `*` (multiply), `colour by` | sugar |
| `to`, `into`, `onto` | `→` (connect), `to` (switch) | partly kept |
| `between`, `after`, `before` | same | same |
| `from` | `disconnect X from Y`, base of `-` | partly kept |
| `of`, `'s` | `.socket` / the key | sugar |
| `as` | `name=` | sugar |

### 6.4 Builder phrases (`commands.ts BUILDER_COMMANDS`, 10)

| Id | Today | Canonical |
|---|---|---|
| open-scene-builder | open the scene builder | `open scene-builder` |
| new-3d-scene | new 3d scene | `new scene` (or just type a scene line: `surface · sphere`) |
| edit-scene | edit this scene | `open scene-builder the scene` |
| open-grid-rules | open grid rules | `open grid-rules` |
| new-grid-rules | new grid rules | `new grid-rules` (or `grid life`) |
| edit-rules | edit the rules | `open rules` |
| open-agent-rules | open agent rules | `open agent-rules` |
| new-agent-rules | new agent rules | `new agent-rules` (or `species … · always do …`) |
| show-recipe | show the recipe | `show-recipe` |
| copy-recipe | copy the recipe | `copy-recipe` |

All of today's phrases stay as sugar. These commands open windows. They are not graph data and
are never printed back.

### 6.5 Do… bar extras

| Today | Canonical | Changes |
|---|---|---|
| Grid preset phrase: game of life | `grid life` | sugar |
| …on a chunky board / big cells / 120 cells across | `board=120` | sugar |
| …slow / fast / speed 0.3 / 8 steps | `speed=0.2` / `speed=1` / `speed=0.3` / `steps=8` | sugar |
| …green on black / black background | `colours on=green empty=black` | sugar |
| 3D output: output the depth, show the normals | `output depth`, `output normal` | sugar |
| colour by height palette fire | `colour by height palette=fire` | same (bare `palette fire` accepted) |
| show the picture | `output picture` | sugar |
| Idiom: "soft circle", "sine hash" | `idiom soft-circle` | sugar |
| Taught phrase: neon edge pink 0.02 | `neon-edge pink width=0.02` | sugar; the head is the taught name |
| is this typical? / teach … | (not language: intents) | unchanged |

### 6.6 Scene recipe clauses (`recipe.ts`, `spec.ts`, `output.ts`)

| Clause | Today | Canonical | Changes |
|---|---|---|---|
| modes | surface, lit, solid; volumetric, volume, glow, glowing; glass, glassy; gi, gi-lit, global | `surface`, `volumetric`, `glass`, `gi` | `glow`/`glowing` become aliases with a hint (D6) |
| shapes (20) | sphere (ball, orb), box (cube, rounded-box), torus (donut, ring)… | same | same |
| shape settings | `at=`, `rot=`, `color=`, `shine=`, `glass`, `name=` | same | same |
| combines (6) | union (add, combine, group), smooth-union (blend, merge, smooth), subtract (cut, difference, minus), smooth-subtract (smooth-cut), intersect (intersection, both), smooth-intersect | same | `add(` and `both(` are aliases; `smooth` alone becomes an alias |
| warps (14) | move, turn, repeat, mirror-repeat, limited-repeat, mirror, fold, polar-repeat, kaleido, twist, bend, sine, noise, displace | same, except `noise` prints as `warp` | D8, D13 |
| `@warp(…)` | `@move((0,1,0))` | `@move(0,1,0)` (both read) | D13 |
| settings | sun, sky, bounce, shadows, ao, fog, background (bg), tone, camera (cam), quality | same | same |
| custom | `custom(label)`, `custom-warp(label)` | same (labels; recognised graphs) | same |
| output | `output depth`, `show depth` | `output depth` | `show` becomes an alias |
| colour by | `colour by depth palette sunset` | `colour by depth palette=sunset` | `palette` printed as a key |
| comments, pretty form, units | `//`, indented continuation, `30deg` | same | same |

### 6.7 Grid Rules text

| Today | Canonical | Changes |
|---|---|---|
| `B3/S23` in As text | `grid count born=3 survive=2,3` (or `grid life`) | B/S accepted as a value and a whole clause |
| `S23/B3`, `23/3` | same as above | accepted |
| Rule chip: "Life B3/S23 · 240×135 · wrap" | `grid life board=240 wrap` | the chip shows canonical |
| preset picker | `grid <preset>` | new text form |
| Stages "/2/3" | `grid stages born=2 survive= states=3` | new |
| Smooth template + sliders | `grid smooth waves speed=0.9 damping=0.995` | new |
| custom update `u + 0.2 * lap_u` | `u={u + 0.2 * lap_u}` | braces; checked by `customUpdateProblem` and `checkExprType` as today |
| Patterns (click grid) | `stencil …/…/… → n` | new |
| Blocks (click grid) | `block ../.. → ../..` | new |
| shared settings (start, speed, board, edges, brush, colours, show) | §4.3 table | new |

### 6.8 Agent rules (`agentRules/spec.ts`)

| Rule part | Sentence today (`describe…`) | Canonical |
|---|---|---|
| always | always | `always do …` |
| sense | food trail anywhere ahead > 0.05 | `food anywhere > 0.05` |
| near | near Predators's trail (trail 2) > 0.2 | `near Predators > 0.2` |
| chance | a 60% chance a second | `chance 60%` |
| age | age > 2 s | `age > 2s` |
| state | searching / not searching | `searching` / `not searching` |
| memory | Memory number > 1 | `memory > 1` |
| mask | Food > 0.5 | `mask Food > 0.5` |
| turn | turn toward food trail (20°) | `turn toward food 20deg` |
| turn (point) | turn toward the point (-0.15, -0.1) (2°) | `turn toward (-0.15,-0.1) 2deg` |
| wander | wander ±7° | `wander 7deg` |
| speed | set speed 0.4 / accelerate 0.1 a second | `speed 0.4` / `accelerate 0.1/s` |
| trail | leave home trail 1 (fading with Memory ×0.15) | `leave home 1 fade=0.15` |
| state change | become carrying | `become carrying` |
| memory | set Memory number to 0 / add 1 / count up 1 a second / random 0–2 | `memory = 0` / `memory += 1` / `memory += 1/s` / `memory = random 2` |
| stop, stick, die | stop / stick (never move again) / die | `stop` / `stick` / `die` |
| spawn | spawn a child (birth mark 1) | `spawn 1` |
| bounce | bounce (turn round) | `turn around` (alias `bounce`) |
| flow | follow / go against the flow field (10°) | `follow flow 10deg` / `against flow 10deg` |
| align | align with the crowd (10°) | `align 10deg` |
| stop after this rule | "; stop after this rule" | `@last` |
| off | "(off)" | `@off` |

### 6.9 Explainer and Code Explorer words

These are not syntaxes. They are word lists the language should share:

- **Explainer roles** (`glslPatterns/roles.ts`): the type checker's messages use the same nouns
  ("a distance", "a colour", "a space"), and `inferType` gains the explainer's role rules, so it
  can say "this is an angle" (D16).
- **Idioms** (`idiomVocabulary()`): `idiom <name>` heads, ranked in completion with the rest.
- **Code Explorer synonyms** (`codeExplorer/synonyms.ts`): each registry entry gains an
  `expand` list (its node's GLSL function names). `SYNONYMS` is then built from the registry plus
  the code-only rows (hash, fwidth…). Typing "halo" in the explorer and "halo" in the bar mean
  the same thing.

---

## 7. Worked examples

Each example shows what someone might type (sugar, where it differs) and the canonical line the UI
shows. Graphs named in brackets are the bar's scratch graphs (`commands.ts SCRATCH_LABELS`).

### 2D pictures (1–12)

1. *circle radius 0.3 with a glow, falloff 8, colour it with a palette by the length of the space*
   → `circle r=0.3 · glow falloff=8 · colour by length`
2. *circle in the middle with a glow, falloff 8* → `circle · glow falloff=8`
   (`at=middle` is the default, so it is not printed)
3. *heart at the top left with rings* → `heart at=top-left · rings`
4. *star with a glow falloff 4, then repeat it 6 times around* →
   `star · glow falloff=4 · polar-repeat 6`
5. *circle with 12 rings, then swirl the space 2* → `circle · rings 12 · swirl 2`
6. *create a hexagon with an outline width 0.01 pink, glow the hexagon falloff 12 pink, then tone
   map the picture* →
   `hexagon · outline width=0.01 color=pink · the hexagon · glow falloff=12 color=pink · the picture · tone-map`
7. *create a noise, warp it 0.6, then colour it with a palette and output it* →
   `noise · warp 0.6 · colour by it · output`
8. *twist the space 0.5* (a circle selected) → `twist 0.5`
9. A shape whose space alone is twisted, written directly: `union(circle @twist(0.5), box at=right) · glow`
10. *mix these colours* (two selected) → `these · mix`
11. *smoothly blend the edges* (two selected shapes) → `these · smooth-union`
12. *circle at the top left with a glow, then trails on the picture* →
    `circle at=top-left · glow · the picture · fade` (Fade's default `tail` is 1.5 s, so it is
    not printed)

### 3D scenes (13–21)

13. `volumetric · smooth-union(sphere r=1, cone h=2 rot=(30,0,0)) · twist 0.5 · polar-repeat 6 · camera dist=4 orbit=10`
    (today's doc example, with `k=0.3` left out because it is the default)
14. `sphere r=1 @move(0,1,0) · smooth-union(box, torus) k=0.5 · output depth`, typed without a
    header, prints as `surface · sphere r=1 @move(0,1,0) · smooth-union(box, torus) k=0.5 · output depth`.
    `output depth` is 3D-only, so the line is inferred to be 3D (§4.0). `@move(0,1,0)` fails
    today (D13).
15. Pretty form, unchanged:
    ```
    surface
    smooth-union(
      sphere r=0.55 color=(0.85,0.45,0.3) shine=0.4 name=Body,
      capsule h=0.5 r=0.12 at=(0.1,-0.3,0.55) rot=(0,0,60)
    ) k=0.35 name=Sculpture
    plane y=-0.6
    background top=(0.45,0.6,0.85) bottom=(0.85,0.75,0.65)
    camera dist=3.8 orbit=6
    ```
16. `surface · union(cylinder r=0.22 h=1.6, box size=(0.36,0.06,0.36) at=(0,1.55,0)) @repeat(2,100,2) · plane y=-1 · fog 0.9`
    (infinite pillars; today this needs `@repeat((2,100,2))`)
17. `glass ior=1.45 · sphere r=0.45 at=(-0.65,0,0) glass · box size=0.32 round=0.06 glass · plane y=-0.5 color=(0.3,0.25,0.35)`
18. `surface · subtract(box size=1, union(cross s=0.33, sphere r=1.3)) · fold xyz` (Menger-like)
19. `gi · torus · output normal`
20. *show the normals* (on a built scene) → `output normal`
21. *colour it by distance with a palette* → `colour by distance palette=sunset`

### Grid rules (22–29)

22. *game of life* → `grid life`
23. *game of life on a chunky board, fast, green on black* →
    `grid life board=120 speed=1 colours on=green empty=black`
24. *B36/S23* typed in As text → `grid highlife`
25. `grid count born=3 survive=2,3 board=240 wrap`, which prints back as just `grid life`:
    `life`'s masks match, and ⅛ (240 across) and `wrap` are the defaults (`GRID_DEFAULTS`)
26. `grid count neighbours=radius radius=5 shape=box born=34..45 survive=33..57`, which prints
    back as `grid bosco`
27. *brian's brain* → `grid brians-brain`; the long form is `grid stages born=2 survive= states=3`
28. Wireworld as stencils:
    ```
    grid patterns states=4
      stencil .../.1./... → 2
      stencil .../.2./... → 3
      stencil .../.3./... → 1 count=1:1..2
    ```
29. Falling sand as blocks, with a custom smooth update next to it for comparison:
    ```
    grid blocks states=3 walls board=480
      block 11/00 → 00/11
      block 1./0. → 0=/1= @mirror
      block 10/*0 → 00/=1 @mirror chance=0.8
    grid smooth custom u={mix(u, avg_u, 0.9) * 0.996} v={v}
    ```

### Agent rules (30–34)

30. Slime mold (the `slime` template):
    `agents · sensors ahead=0.035 angle=22.5deg · species Slime speed=0.22 · always do turn toward trail 45deg, wander 7deg, leave trail 1`
31. The user's example, in one line:
    `species Ants states=searching,carrying · when searching and food ahead > 0.5 do become carrying, turn around`
32. Ants with food: the block in §4.4.
33. Infection (SIR), the `sir` template in full:
    ```
    agents
    sensors ahead=0.02 angle=40deg
    channels germs
    species People speed=0.12 states=healthy,sick,recovered
      always do wander 30deg
      when healthy and age < 0.3s and chance 0.2% do become sick, memory = 0
      when healthy and germs here > 0.3 and chance 60% do become sick, memory = 0
      when sick do memory += 1/s, leave germs 1
      when sick and memory > 5 do become recovered, memory = 0
      when recovered do memory += 1/s
      when recovered and memory > 20 do become healthy, memory = 0
    ```
34. DLA growth, the `dla` template on one line:
    `agents · sensors ahead=0.006 angle=60deg · channels crystal · masks Seed · species Particles speed=0.3 states=free,stuck · when free and mask Seed > 0.5 do stick, become stuck @last · when free and crystal anywhere > 0.3 do stick, become stuck @last · when stuck do leave crystal 1 @last · always do wander 60deg`

### Passes (35–36)

35. `pass "trails" · fade 0.5s · blur 4`
36. *glow the pass* (a Pass selected) → `this · glow threshold=0.6 radius=16 intensity=0.8`
    (the `glow-texture` move's values)

### Edits (37–42)

37. *create a ring with falloff 0.3, colour it with a palette by the length of the space, multiply
    it by the circle, then output it* [circle] →
    `ring · glow falloff=0.3 · colour by length · it * the circle · output`
38. *disconnect the current output, add it to the noise, and output the result* [mixed] →
    `disconnect the picture · the noise + it · output`
39. *connect the noise to the tint of the glow* [mixed] → `connect the noise → the glow.tint`
40. *insert a tone map between the palette and the output* [noise] →
    `insert tone-map between the palette and the output`
41. *copy the glow, then set its falloff to 3* [glow] → `duplicate the glow · set it falloff=3`
42. *make the circle a bit smaller, rename it to "Dot" and group the circle and the glow as
    "Neon"* [glow] →
    `set the circle r/=1.1 · rename it "Dot" · group(the circle, the glow) name="Neon"`

---

## 8. Architecture

```
            text ──► lex ──► parse ──► AST ◄── sugar (Do… bar phrase readers, rewritten)
                                        │
                     check (types, names, dialect)  ──► diagnostics (line, col, did-you-mean, fixes)
                                        │
            ┌──────────┬─────────┬──────┴─────┬──────────┬──────────┐
          picture    scene      grid        agents      pass       edit      ◄ compilers
            │          │          │            │          │          │
         DoStep    SceneSpec  GridParams  AgentRuleSet  DoStep    CmdClause  ◄ today's targets
            └──────────┴────── GraphOps (one undo step, a diff per clause) ──┘
                                        ▲
            print (compact · pretty) ◄──┘ from AST or from a spec
```

All new code goes in `src/lang/`, next to the files already there.

### 8.1 One lexer: `src/lang/lex.ts`

The recipe tokenizer (`recipe.ts:58`) is the starting point, because it already handles numbers
with units, hex, strings, `@`, `( ) , =`, comments and the indented continuation. It gains `→`,
`->`, `*= /= += -=`, `..`, `%`, `s`, `ms` and `/s` units, `{…}` code, and the `/` between
stencil rows. Every token keeps `from` and `to`, so highlighting and errors share positions. The
highlighter (`highlight.ts`) colours the same tokens instead of lexing again (D1).
`vocabulary.tokenize` and `doRefs.lex` stay inside the sugar reader, which works on words.

### 8.2 One registry: `src/lang/registry.ts`

```ts
interface Entry {
  id: string;                       // 'glow', 'sphere', 'smooth-union', 'connect', 'stencil'…
  kind: 'header' | 'maker' | 'step' | 'combine' | 'setting' | 'output' | 'verb' | 'condition' | 'action' | 'modifier';
  dialects: Dialect[];              // 'picture' | 'scene' | 'grid' | 'agents' | 'pass' | 'edit'
  words: string[];                  // first is canonical; the rest are aliases
  deprecated?: Record<string, string>;   // alias → hint ("glow as a mode: write volumetric")
  params: ParamSpec[];              // key, aliases, type (number, angle, vec3, colour, list…), default, min/max, primary?
  flags?: string[];
  summary: string; hint: string;    // the reference and signature help
  examples: Array<{ text: string; on?: ScratchId; selected?: string[] }>;
  expand?: string[];                // Code Explorer synonyms
  kindsIn?: ValueKind[]; kindOut?: ValueKind;   // the type checker
}
```

It is built from what exists rather than written out again: `vocabulary.ts` (shapes, actions,
params, colours, places), `sceneBuilder/spec.ts` (`SHAPES`, `WARPS`, `ParamDef`), `output.ts`
(`OUTPUTS`, `PALETTES`), `commands.ts` (`COMMAND_VERBS`, `CONNECTORS`, `REFERENCE_FORMS`,
`BUILDER_COMMANDS`), `gridRules/spec.ts` (presets, `GRID_DEFAULTS`), `agentRules/spec.ts` (the
condition and action kinds), `moves.ts` (move args) and node definitions for nodes by name.
`commands.ts` keeps its role as the place to document verbs. It now feeds the registry instead of
holding a separate list. A test checks that no word means two things within one dialect, which
catches problems like D5 to D11 before they ship.

### 8.3 One parser and AST: `src/lang/parse.ts`, `ast.ts`

A recursive descent over §3.11, recovering from errors per clause (today's `skipClause`) and
per item (the combine loop). The AST has positions throughout:

```ts
type Clause =
  | { t: 'maker' | 'step' | 'setting' | 'header'; head: Word; args: Arg[]; mods: Modifier[]; span }
  | { t: 'combine'; op: Word; items: Item[]; args: Arg[]; mods: Modifier[]; span }
  | { t: 'output'; what: Ref | Word; args: Arg[]; span }
  | { t: 'expr'; expr: Expr; span } | { t: 'ref'; ref: Ref; span }
  | { t: 'edit'; verb: string; slots: Record<string, Ref | Clause | Value>; span }
  | { t: 'rule'; when: Cond[]; do: Action[]; mods: Modifier[]; span }
  | { t: 'stencil' | 'block'; cells: …; to: …; args: Arg[]; mods: Modifier[]; span }
  | { t: 'block'; header: Clause; body: Clause[]; span };
```

`parseRecipe` becomes `parse(text, { dialect: 'scene' })` followed by the scene compiler. It
keeps its signature and result (`ParseResult`) so callers don't change.

### 8.4 Compilers, one per dialect: `src/lang/dialects/*.ts`

Each compiler turns AST into the data its domain already runs, so nothing downstream changes:

| Dialect | Compiles to | Runs through (unchanged) |
|---|---|---|
| scene | `SceneSpec` (today's `Parser.recipe()` logic, moved) | `build.ts`, `apply.ts` (rebuild, `checkEdits`), `doOutputs.ts` |
| grid | Grid Rules params (`Record<string, unknown>`, with `patterns` and `blocks` arrays) | the node, `gridRulesExpand.ts`, `addGridRules` |
| agents | `AgentRuleSet` (`normalizeRuleSet` on the way in) | `agentRules/generate.ts`, `apply.ts`, `storeActions.ts` |
| picture | `DoStep[]` (shape, move, chain) | `runDoPlan`, `applyMove` |
| edit | the clause executors in `doCommands.ts` (`execClause` per verb), called with resolved slots instead of tokens | `execCommand`'s working copy, diff, picks, one undo step |
| pass | `DoStep`s for the texture moves, plus a Pass node | `runDoPlan` |

The first version reuses the executors and does not rewrite them. `doCommands.ts`'s
`execClause` is split into "read tokens into slots" (replaced by the parser) and "run slots"
(kept).

### 8.5 One printer: `src/lang/print.ts`

- `print(ast, { form: 'compact' | 'pretty' })`. Compact is one line with `·`. Pretty is one
  clause a line, with combine items and block bodies indented (today's `printRecipe` pretty form).
- Per-dialect `fromSpec` functions: `printScene(spec)` (today's `printRecipe`, moved),
  `printGrid(params)` (shortest form: a preset plus differences, using `matchingPreset`),
  `printAgents(set)` (canonical rules, using the same names as `describeRule`).
- The rules: print the canonical word; the primary bare; the rest `key=value`; leave defaults
  out; colour words or hex when they round-trip exactly (today's `fmtColour`); places as words
  when they match `PLACES` exactly; references in reference-only slots without `the`.

### 8.6 One checker: `src/lang/check.ts`

- **Types**: `typeCheck.ts` stays the engine (`checkWire`, `fixesFor`, `inferType`). The checker
  runs it on every arg against the registry's param type (the recipe's `typeMismatch` moves
  here), on every wire an edit makes, and on `{code}` values (Grid custom updates, `custom`).
  Fixes come back as code actions: `r=(1,2,3)` → `r=1`.
- **Kinds**: a step's `kindsIn` is checked against *it*'s kind (`suggestions/kinds.ts`). A
  refusal reads as the bar's do today ("Blur works on a texture: select a Pass").
- **Names**: states, masks, channels and species in agent rules; scene item names; labels.
- **Dialect**: a 3D-only word in a 2D line and the other way round (§4.0), and settings that do
  nothing in a mode (today's recipe warnings, such as fog in volumetric).

### 8.7 One completion and signature help: `src/lang/complete.ts`

`recipeAssist`, `doBarAssist` and `wordAssist` become one `assist(text, caret, { dialect,
graph })`, driven by the parser's partial AST at the caret rather than regexes. It offers
clause heads at a clause start, keys after a head, values after `key=` (colours with swatches,
choices, palettes, names from the graph or the rule set), items in `(`, modifiers after `@`,
states, channels and masks in rules, and sockets after `the glow.`. `rankCompletions` and
`matchScore` stay as they are. Signature help comes from the registry's params.

### 8.8 One reference: generated

`commandReference()` and `commandsMarkdown()` are generalised to the registry:
`languageReference()` builds the in-app Commands panel (ⓘ in the bar, Keys → Do… bar commands,
More tools, and each builder's help) and `docs/playfield-language.md`. `docs/do-bar-commands.md`
keeps being generated as the edit-verbs section, so existing links work. The snapshot test that
compares the shipped doc with the generated one (`doCommands.test.ts:370`) moves with it.

### 8.9 One place to run text: `src/lang/run.ts`

```ts
runLine(text, { surface: 'do-bar' | 'scene' | 'grid' | 'agents', graph, selected, picks, target? })
  → { ast, canonical, diagnostics, plan /* steps + diff per clause */, apply() }
```

The Do… bar, the Scene Builder Recipe tab, the new Grid and Agent Recipe tabs, the Recipe chip's
"open" and Make a node all call this. The store's `runCommand` wraps `apply()` in one undo step,
as it does today.

---

## 9. Migration and compatibility

### 9.1 Nothing stored changes

- Scene Group `META_KEY` specs, Grid Rules params, `params.agentRules`, taught phrases
  (`playfield:suggestions:taught`) and example files keep their shape. Text is printed from them
  every time.
- `.playfield` / playfile documents hold graphs, not text, so no format bump is needed.

### 9.2 Old text keeps working

- Every word in today's vocabularies stays in the registry as a word or an alias.
- Aliases that clash with the new canonical meanings (`glow` as a mode, `add(`/`both(` as
  combines, `noise` as a scene warp, `show` as output) keep working **in their old dialect**,
  with a quiet hint and a one-click rewrite: "`glow` as a render mode: write `volumetric`".
  The hints follow `deprecated` in the registry. There is no removal date in this plan.
- Every recipe printed by today's `printRecipe` parses to the same `SceneSpec` with the new
  parser. Test: every template in `sceneBuilder/templates.ts`, the six scene examples
  (`store/sceneBuilderExamples.ts`), and the strings in `sceneBuilder.test.ts` and
  `recipeFormat.test.ts`.
- **Printed text changes only where this plan decides it should**: `noise` warps print as `warp`;
  `@move(…)` and `@repeat(…)` print with single brackets; palettes print as `palette=`. Each
  change gets its own commit and test, and the Recipe chip shows the new form.
- Do… bar phrases: the whole `doCommandsCorpus.ts` CORPUS, every example in `commands.ts`
  (verbs, `ACTION_EXAMPLES`, `RECIPES`), and every test sentence in `doBar.test.ts`,
  `doBarGridRules.test.ts` and `doOutputs.test.ts` must give the **same graph diff** as today
  (§11.1).

### 9.3 Colour table merge (D3)

A colour **name** in old text keeps the value its old surface gave it. The sugar reader passes the
bar's values, and scene recipes use the recipe's. The canonical table takes the recipe's values,
because recipe text is what users copy and keep. A bar phrase then prints the colour as hex when
its value differs from the canonical one (the bar's red prints as `(1,0.15,0.12)`, since `fmtColour` only writes hex when it
round-trips exactly), so nothing
changes colour silently. Q3 asks whether to snap instead.

### 9.4 Docs

- `docs/playfield-language.md` is new and generated from the registry: grammar, dialects and
  every head.
- `docs/do-bar-commands.md` is still generated (the edit section).
- `docs/scene-builder.md` "The recipe language", `docs/grid-rules.md` "As text",
  `docs/agent-rules.md` and `docs/suggestions.md` "The Do… bar" are rewritten to link to the
  language page and keep only what is domain-specific.
- Release notes get What's new entries in each phase that changes what users see (the release
  notes process).

---

## 10. UX

### 10.1 The Do… bar shows the canonical line

- Under the input, above the step list: **→ `circle r=0.3 · glow falloff=8`**, coloured by the
  shared highlighter (today's recipe colours, `recipeColours.ts`).
- Clicking it puts the canonical line into the bar, so people can edit the short form.
- When the input already is canonical, the line shows ✓ in its place.
- A refused clause is underlined at its column (canonical) or marked on its clause (sugar), with
  fixes as buttons, as today.
- The **reading** list ("circle → shape", "8 → falloff") stays and gains the canonical word:
  "glwo → `glow`".
- History (↑) remembers what was typed. An option (Q5) lets it store the canonical line instead.

### 10.2 Every builder gets a Recipe tab

The Scene Builder's Recipe tab (rows, Edit as text, Copy, type-ahead, signature, swatches; the
components `RecipeRows.tsx`, `RecipeCode.tsx` and `recipeColours.ts`) moves to
`src/components/builders/recipe/` and is used by:

- **Grid Rules**: a Recipe tab next to the form. Rows are the rule type and settings, and one row
  per stencil or block. The form and the text edit the same params. **As text** (B/S) becomes the
  tab's first row.
- **Agent Rules**: a Recipe tab with one row per rule, blocks per species, and the settings rows
  at the top. "Show the lines" (GLSL) stays as it is.
- **Recipe chip** on Grid Rules cards and rules groups shows the canonical text (today's
  `gridRecipeText` and summary sentences), with Copy and Open.

### 10.3 Learning aids

- **Hover any word** in a recipe or the bar's canonical line to see its registry summary,
  aliases and one example ("`glow` · SDF Glow on a distance, Bloom on a colour · also: halo,
  neon").
- **"Show the words"** (in the scene tab today) is available in every Recipe tab: the line with
  each clause labelled (maker, step, setting…).
- **Examples** in builder help cards (`helpContent.ts`) are canonical lines with **Insert**.
- **One Commands reference** for everything, searchable (`searchReference`), with "Show me how"
  running an example on a scratch graph, as the bar's reference does today.
- **The bar teaches gently**: after the same sugar phrase has been used three times, the
  canonical line gets a short "you can also type this" note. It is off when Tips are off (the
  builders' Tips switch).
- The type-ahead's signature line works the same way in all four places.

### 10.4 Phone

The bar and the Recipe tabs are already on the phone (builders open from the node browser's first
section). The canonical line wraps, and rows use ▲▼ instead of drag, as the scene tab does today.
On a narrow screen, `→` and `·` get extra space so they are easy to tap.

---

## 11. Phases, tests and risks

Sizes: **S** is up to a day, **M** two to four days, **L** one to two weeks. There is one PR per
phase, stacked, each gated on the full vitest run.

| # | Phase | Size | Ships to users? |
|---|---|---|---|
| 0 | Corpus and goldens | M | no |
| 1 | Lexer, registry, AST, printer core; colour table; fuzzy matching | L | no |
| 2 | Scene dialect on the core (parse, print, highlight, complete) | M | yes, almost invisible: D13 works, aliases get hints |
| 3 | Grid dialect and the Grid Rules Recipe tab | M | yes |
| 4 | Agents dialect and the Agent Rules Recipe tab | L | yes |
| 5 | Picture and edit dialects; the sugar reader rewritten to AST; the canonical line in the bar | L | yes, the main change |
| 6 | Pass dialect | S–M | yes |
| 7 | One assist, one checker, one generated reference; Code Explorer reads the registry | M | yes |
| 8 | Learning aids, deprecation hints, docs rewrite, release notes | M | yes |

### 11.0 Phase 0: corpus and goldens

Gather every phrase and line that exists, and record what it does **today**:

- the bar: `doCommandsCorpus.ts` CORPUS, `COMMAND_VERBS` examples, `ACTION_EXAMPLES`, `RECIPES`,
  `CONNECTORS` and `REFERENCE_FORMS` examples, `BUILDER_COMMANDS` words, every `GRID_PHRASES`
  name with and without slots, `DO_OUTPUT_PHRASES`, and the test sentences in `doBar.test.ts`,
  `doBarGridRules.test.ts` and `doOutputs.test.ts`;
- recipes: `templates.ts`, `sceneBuilderExamples.ts`, and the strings in the scene builder tests;
- grid: every preset in the five tables, and every example in `gridRulesExamples.ts`;
- agents: the eight templates in `agentRules/templates.ts`.

For each bar entry, the golden is the **graph diff** (`CmdStep` adds, removes, wires, params,
`select`) on its scratch graph. For each spec, the golden is the spec. These are stored as JSON
under `src/lang/__tests__/goldens/`.

### 11.1 Tests, built up across phases

1. **Corpus equivalence** (from phase 5): every bar entry gives the same graph diff through
   sugar → AST → compile as the golden.
2. **Canonical fixpoint**: `print(parse(print(parse(x)))) === print(parse(x))` for every corpus
   entry.
3. **Sugar ⇄ canonical**: `parse(canonical(sugar))` compiles to the same diff as `sugar`.
4. **Spec round trip**: `parse(print(spec))` deep-equals `spec` for every scene template and
   example, every grid preset (34, and each with random overrides), every agent template (8),
   and random specs from small generators (shapes, warps, nesting depth ≤ 3; random masks and
   stencils; random rules within the limits: 4 species, 8 states, 2 masks).
5. **Old text**: every string today's `printRecipe` can produce for the corpus parses to the same
   spec (§9.2).
6. **Registry**: no word means two things in one dialect; every head has at least two examples
   that parse and compile (extending today's "every verb has examples that parse" test); every
   alias resolves; every deprecated alias has a hint.
7. **Diagnostics**: a table of bad inputs with the expected message, line, column and suggestion
   (`sphre` → sphere, `colr` → color, an unclosed `(`, `r=(1,2,3)` → its fix, a grid custom
   update that is a vec3, an agent rule naming an unknown state).
8. **Generated docs**: the shipped `docs/playfield-language.md` and `docs/do-bar-commands.md`
   match the registry.
9. **GPU or CPU equivalence** where a text form is new (grid stencils and blocks, agent rules):
   the params a line makes run on the CPU (`gridRules/cpu.ts`; the agent rules `cpuSim.ts`) the
   same as the preset or template they print as.
10. **Performance**: parsing, checking and compiling a 200-clause recipe stays under 2 ms, and a
    typical bar line under 0.3 ms, so the preview can run on every keystroke (the perf rules for
    UI work: no store churn per keystroke).

### 11.2 Risks

| Risk | Why | Mitigation |
|---|---|---|
| **Behaviour drift in the bar** | The bar's subject and kind rules (`doBar.ts`, `kinds.ts`) are subtle, and a rewrite could change which node a move lands on | Phase 0 goldens; phase 5 keeps `runDoPlan` and the clause executors and changes only what feeds them |
| **New vs existing ambiguity** | A bare `circle` makes a new one and `the circle` refers to one; people will mix them up | The preview says "new Circle SDF" or "the Circle SDF (selected)". When a bare maker word matches a selected node of that type, a hint asks "did you mean `the circle`?" |
| **Comma meaning** | `,` separates items, lists and actions in canonical text, and clauses in sugar | §5 rule 2: a top-level `,` makes a line sugar; the printer never writes a top-level `,` |
| **Printed recipe changes** | Users have recipes copied in notes and examples | Old text keeps parsing (§9.2); only three printing changes, each with a test and a What's new entry |
| **Agent rule names** | Free names (states, channels, masks) can clash with keywords | The where-word and `mask` rules (§4.4), quoting, and a checker error on a clash with a suggested rename |
| **Scope** | Six dialects is a lot | Phases ship one at a time; scene and grid come first because they already have specs and printers; pass is last and small |
| **Two readers that both apply** | A line could parse as both canonical and sugar | Canonical is tried first, and sugar-only tokens rule canonical out (§5) |
| **Colour drift** | Merging tables changes a name's value on one surface | §9.3: old values are kept when reading; differences print as hex |
| **Recompiles** | Grid stencils and agent rule numbers bake into GLSL, so text edits recompile | The same as the forms today; the Recipe tab applies on Enter or blur, not per keystroke |
| **Performance** | One parser per keystroke, with type checks and a dry run | The parse and check are pure and fast; the dry run on a working copy is what the bar does today; see test 10 |

---

## 12. Open questions

1. **`colour by` or `palette by`** as the canonical head for 2D colouring? This plan picks
   `colour by`, because 3D outputs already use it and it reads as what happens. `palette by` is an
   accepted alias. If the user prefers `palette by length` as it appeared in the brief, it is a
   one-word registry change.
2. **`the` in reference-only slots.** This plan prints `set glow falloff=8` (shorter). Should it
   be `set the glow falloff=8`, which is more consistent and easier to teach?
3. **Colour names.** Keep the bar's values when reading bar phrases (this plan), or snap
   everything to one table now and accept a small colour shift in new graphs?
4. **Edits to builder-made parts.** Should `set the circle r=0.5` on a node inside a built scene
   edit the spec and rebuild (keeping the recipe true), or edit the node (today's behaviour, which
   marks the scene **edited since build**)?
5. **History.** Should the bar's ↑ history store what was typed or the canonical line?
6. **Grid header.** Is `grid` required in the bar for every grid line (simple), or only for
   presets that clash with other words (D14; today's rule)? This plan requires it in canonical
   output and accepts it being left out when nothing clashes.
7. **Agent blocks on one line.** `species Ants · always do …` keeps adding to the species until
   the next header. Is that clear enough, or should one-line rules need `species Ants: …`?
8. **Mixing dialects on one line** (`surface · sphere · pass "x" · fade 1s`) is allowed by the
   grammar. Should the first version refuse it to keep things simple?
