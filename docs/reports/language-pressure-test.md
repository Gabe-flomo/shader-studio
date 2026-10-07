# Playfield language: pressure test

How many of the example graphs can be built by typing Do… bar lines, and what stops the rest.
Measured on main at 2026.10.67 ("One Playfield language"), 398 examples, 2026-10-07.

Nothing in the language changed for this. The PR adds a printer, a harness, this report and a
small **Show as commands** panel in the Do… bar.

- Printer: `src/lang/fromGraph.ts` (with `src/lang/graphFlat.ts`)
- Harness: `src/lang/__tests__/languagePressure.test.ts`, `src/lang/__tests__/pressure/*`
- Printer tests: `src/lang/__tests__/fromGraph.test.ts`
- Raw results: `npm run report:language` writes `language-pressure-test.json` and `tables.md` to
  `$REPORT_DIR` (default `/tmp/lang-pressure`)

## Summary

| Class | Examples | What it means |
|---|---:|---|
| **Full** | 166 (42%) | The rebuilt graph compiles to the same shader (comments aside) with the same uniform values |
| **Near** | 38 (10%) | Every node and wire is there; settings, ports or the shader differ a little |
| **Partial** | 194 (49%) | Some nodes or wires can't be said |
| **None** | 0 | Every example gets at least part of the way |

- Nodes made: 3,500 of 4,181 (84%). Wires: 2,725 of 3,752 (73%). Settings that differed from a
  new node's: 3,717 of 4,547 set (82%).
- 170 of 360 examples that compile both ways compile to the same shader. (Of the 38 rebuilt
  graphs that don't compile, 35 are Agents graphs whose group insides the bar can't reach.)
- **27 of the 38 Near examples are Full in all but name.** Their only gap is a Palette's `anim`
  input that keeps `defaultValue: 0` on the socket. The original inlines `0.0`, the rebuilt
  graph reads the same 0 from a uniform. Same picture, different text.
- **Play setups are not carried at all.** 253 examples have one (controls, live params, MIDI and
  mouse mappings, layers), 121 of them in Full. Full means the graph and its shader; the Play
  half of those examples is gone.
- Every line the printer kept also ran on the real store: 6,927 lines, 0 failures (plus 2,089
  `# cannot express` lines). In the browser the 8 examples tried ran line by line through the
  Do… bar with the same result as the runner.
- A script averages 22.7 lines (2.0 lines per node made). The longest are the hand-built
  cellular automata (Simulations: grids): 158 to 191 lines for 49 to 71 nodes.

### By folder

| Folder | Examples | Full | Near | Partial |
|---|---:|---:|---:|---:|
| Play | 111 | 82 | 28 | 1 |
| Learn | 42 | 6 | 0 | 36 |
| Simulations: grids | 20 | 10 | 0 | 10 |
| Grid | 17 | 5 | 0 | 12 |
| Particles | 14 | 3 | 1 | 10 |
| Node Combos | 13 | 3 | 0 | 10 |
| Simulation | 13 | 1 | 0 | 12 |
| From the Internet | 12 | 0 | 0 | 12 |
| Agents: rules | 11 | 7 | 0 | 4 |
| Passes | 10 | 1 | 0 | 9 |
| 3D SDF | 9 | 0 | 0 | 9 |
| Learn 3D | 9 | 1 | 0 | 8 |
| Time Cube | 9 | 9 | 0 | 0 |
| Matrices | 8 | 3 | 0 | 5 |
| Data | 8 | 4 | 0 | 4 |
| Agents with shaders | 8 | 0 | 0 | 8 |
| Simulations: agents | 8 | 0 | 0 | 8 |
| Frame Stack | 7 | 3 | 4 | 0 |
| Texture tools | 7 | 0 | 1 | 6 |
| 3D: Scene Builder | 6 | 6 | 0 | 0 |
| 3D Basics | 5 | 1 | 0 | 4 |
| Space & Texture | 5 | 3 | 2 | 0 |
| Blur & Lens | 5 | 3 | 0 | 2 |
| 3D Lighting | 5 | 0 | 0 | 5 |
| Agents in 3D | 5 | 0 | 0 | 5 |
| Iterated Groups | 4 | 0 | 1 | 3 |
| Effects & Lens | 4 | 2 | 0 | 2 |
| Volumetric | 3 | 0 | 0 | 3 |
| Color & Lighting | 3 | 3 | 0 | 0 |
| Curves & Shapes | 3 | 3 | 0 | 0 |
| Fractals | 2 | 2 | 0 | 0 |
| Physics | 2 | 2 | 0 | 0 |
| Halftone | 2 | 1 | 1 | 0 |
| GI Lighting | 2 | 0 | 0 | 2 |
| Convert | 2 | 0 | 0 | 2 |
| Rings, Unfiled (blank) | 2 | 2 | 0 | 0 |
| Functions, Inputs | 2 | 0 | 0 | 2 |

What reads well: the builders. All six **3D: Scene Builder** examples are one recipe line and
Full; 7 of 11 **Agents: rules** and 10 of 11 **Grid Rules** examples are one recipe line plus a
rename or two. Small 2D chains of named nodes (Play, Time Cube, Color & Lighting, Curves &
Shapes) also come out Full. What doesn't: anything with an Expression Block (302 of them across
the examples), hand-built 3D (Scene Group / March Loop Group insides), hand-built agents (Agents
group insides), and the math-heavy Learn lessons (vector-typed math nodes, `value` settings).

## How it was measured

1. **Print.** `graphToScript(nodes)` (`src/lang/fromGraph.ts`) writes the lines that would build
   the graph on an empty one (just an Output). Builder-made nodes print as their recipe (scene,
   `grid …`, `agents …`); everything else as `create`, `set`, `rename`, `connect`,
   `disconnect`, `delete` and `group(…)`. Plain groups are flattened: their members are made
   and wired at the top, then folded with `group(…)`. Other containers (Scene Group, March Loop
   Group, Agents group) are made by name, and their insides compared as a whole.
   The printer checks itself: it runs every line through the bar's own reader and executor on a
   working copy and keeps a line only when it did what was meant. So references are ones that
   resolve (`circle#2`, `"Halo"`), the UV that `create` adds is adopted or deleted, and an
   unreachable setting is caught. What can't be said becomes `# cannot express: …` and a gap with
   a category.
2. **Run.** The harness runs each line on the real store the way `DoBar.tsx` `run` does
   (picture and edit lines through `runCommand`, recipes through their builders), starting from
   an Output alone, keeping the selection between lines.
3. **Compare.** Structure: nodes, flattened wires, settings (numbers within 0.25%, colours to 8
   bits), labels, plain groups (members, port types, settings), containers' insides (a digest).
   Shader: both graphs compiled with the real compiler, the rebuilt one renamed to the original's
   ids (containers' insides paired by what they are), node notes stripped (they are written into
   the shader as comments), and settings filled from their defaults on both sides (an example
   node from before a setting existed inlines its value; a new node makes it a uniform). Uniform
   values compared too.

## Gaps, ranked

Two rankings. **Examples touched** counts every example a gap appears in. **Unlocks** is greedy:
fix the gap that alone would turn the most remaining examples Full, then the next, assuming the
printer saw every gap in an example. Gaps that follow from another (a wire into a node that
isn't made; a socket an unsettable setting would have made) are counted against their cause.

| # | Gap | Examples touched | Unlocks (cumulative) | Most often |
|---:|---|---:|---:|---|
| 1 | **Unwired input values** (`socket-default`) | 38 | 27 (27) | Palette · `anim` (38) |
| 2 | **Runner crash** (`runner-crash`) | 91 | 21 (48) | create mix (60), Colorize (49), connect … → output (35), palette (22), tone-map (18), sample-texture (17) |
| 3 | **Container insides** (`container-contents`) | 73 | 28 (76) | Agents group (36), Scene Group (38), March Loop Group (32) |
| 4 | **Code** (`param-code`) | 80 | 32 (108) | Expression Block result / expr / inputs / lines (552 settings) |
| 5 | **Unreachable setting names** (`param-name`) | 90 | 35 (143) | Constant · `value` (65), math `outputType` (Multiply 48, Divide 14, Add 12) |
| 6 | **Socket words read as 3D** (`dialect-clash`) | 24 | 18 (161) | `.background` (Colorize, SDF Fill), `.ao`, `.shadow`, `grid.columns` |
| 7 | **No create word** (`no-create-word`) | 25 | 18 (179) | Max (19), Subtract (11), Floor (9), Round (7), Step (5), Mask, Dot |
| 8 | **Value doesn't land** (`param-set-failed`) | 16 | 12 (191) | Expression names, Palette `offset`=0 as colour, select values kept as strings |
| 9 | **Structured values** (`param-structured`) | 14 | 7 (198) | Data outputs/columns, Constants items, Custom Function inputs |
| 10 | **Feedback refused as a loop** (`wire-failed`) | 8 | 6 (204) | a Pass's `previous` read back into its own chain (6), Loop Carry `next` (2) |
| 11 | **Media and attached files** (`param-media`, `media`) | 6 + 14 | 4 (208) | Data datasets, images, audio state |
| 12 | Loop Index inside groups (`group-loop-index`) | 10 | 5 (213) | a group's own `i` wired inside |
| 13 | Group ports (`group-ports`) | 8 | 6 (219) | `group(…)` adds a Loop Index; port keys `in0` vs `cin_uv` |
| 14 | Input expressions on settings (`param-inline-expr`) | 5 | 5 (224) | `__inExpr_radius` |
| 15 | Colours outside 0–1 (`param-colour-range`) | 3 | 3 (227) | Palette phase / offset vectors |
| 16 | Output socket choice, plain English failed too (`output-socket`) | 45 | 2 (229) | follows from math `outputType` (44) |
| 17 | Keyframes (`param-keyframes`) | 1 | 1 (230) | SDF Glow brightness track |
| 18–19 | Type check, missing sockets (`wire-type`, `container-socket`) | 44, 83 | 1 + 1 (232) | nearly all follow from math `outputType` and Expression inputs |
| — | Play setup (`play`) | 253 | not ranked | controls, live params, MIDI and mouse mappings, layers |
| — | Notes, positions (`notes`, `layout`) | 193, 398 | not ranked | |

With all 19 the count reaches 232, every non-Full example. That is an upper bound: past its first
blocker the printer's view of a graph is partial (a node that isn't made hides the gaps of its
settings), so some examples will show new gaps once the first ones are fixed.

### What each is, and what to add

Syntax sketches follow the plan's decisions (§13): no `the` in edit slots, `key=value`,
`create` for new nodes, one line per clause in the bar.

**1. Unwired input values.** An input socket can keep its own value (`defaultValue`) when nothing
is wired. Only the Palette's `anim` does it in the examples, always 0, so the pictures match and
only the shader text differs. Cheapest fix is not in the language: drop `defaultValue: 0` on that
socket in the examples (or have `create palette` make the same socket). If inputs should have
values of their own, `set palette.anim=0` (socket in the key) is the natural form.

**2. The runner crash.** Not a language gap but the largest single blocker, and dangerous:
`parseDo` (`src/suggestions/doBar.ts`, the colour-target branch near line 410–437) does
`outputKinds(c).find(o => o.kind === 'colour')!.key` and throws when the subject's colour
source has no colour output. `execCommand` parses the *whole* sentence with `parseDo` first, so
any line containing an action word (`mix`, `palette`, `tone-map`, `tint`, `glow`, `colour`…)
can throw depending on what is selected, e.g. `create palette` right after `create time` on an
empty graph. In the Do… bar the same throw happens inside a `useMemo` with no try, so **the
whole app unmounts to a blank page** (seen in the browser, screenshots 09). Fix: guard the find
and return a `plan.problem`; wrap the bar's `parseDo` like its `execCommand`. No syntax change.

**3. Container insides.** The bar edits one level. Hand-built 3D (Scene Group, March Loop Group)
and hand-built agents (Agents group in node mode) keep most of their nodes inside. A minimal
addition that fits the grammar is a block header for a level:

```
inside "Scene":                      // later lines edit the Scene Group's level
  create sphere-sdf3d
  connect scene-pos → sphere-sdf3d.pos
end
```

or a path in references, `"Scene"/sphere-sdf3d`, usable by every verb. The block form also
prints readably. Builder-made containers don't need it (they print as recipes).

**4. Code.** 302 Expression Blocks across the examples; none can be written. `set` skips their
`expr`, `result`, `lines` and `inputs` on purpose (`SKIP_PARAMS`), and a line can't hold more
than one line of GLSL. The plan already has a `{…}` code value (§3.3). Proposal:

```
create expression result={a * 2.0 + b} a=float b=vec2      // inputs named by type
set exprnode#2 line+={vec2 tile = floor(cell / 24.0)}       // one body line at a time
```

Inputs-as-keys make the sockets exist, which also removes 330 of the 377 `container-socket`
gaps (wires into Expression inputs that don't exist on a new block).

**5. Setting names the bar can't reach.** `value` is in `findParam`'s filler list, so
`set constant value=0.35` reads as "set constant to 0.35" with no setting (65 examples). `val`
works by accident. And math nodes' width (`outputType`: float/vec2/vec3) is not a setting at all,
so `create divide` can't become a vec2 divide; the wires then fail the type check (the 44
`wire-type` and 44 `output-socket` gaps follow from this). Proposals: stop filtering `value`
when it is the key in canonical `key=value`; add `set divide type=vec2` (or
`create divide:vec2`) that retypes the sockets the way the card's type switch does.

**6. Socket words read as 3D.** `detectDialect` scans every word of the line, so a socket called
`background`, `ao` or `shadow` in `connect … → colorize.background` makes the line a
3D scene (and then an error, or "mixes a 3D scene and a 2D picture"). Proposal: a line whose
first word is an edit verb is an edit, full stop; or skip words after `.`.

**7. No create word.** Some types have no word that makes them: `create max` makes Intersect,
`create subtract` makes SDF Subtract, `create round` makes Offset, `create step` makes Agents
Move, `create mask` makes Smoothstep, `create dot` draws a circle, `create floor` reads as a
3D plane. Type ids don't work either (`create maxraw`). Proposal: let `create` take the type
id or a category path when a word is ambiguous: `create math.max`, `create node:max`. The
type-ahead should offer only words that make what they say (see UI friction).

**8. Values that don't land.** `set palette offset=0` (one number for a colour) is refused;
select values that look like numbers are kept as strings (`size="2"` on Neighbours); Expression
names. Smaller fixes in `valueFor`.

**10. Feedback refused as a loop.** Simulations built from a Pass read the Pass's `previous`
frame back into the chain that feeds the same Pass. That is legal (the read is a frame late),
but `connect` refuses it as a loop (`makesLoop` in `doCommands.ts` doesn't know Pass
`previous` breaks the cycle). Six hand-built grid simulations stop there (Pass nodes themselves are fine: `create pass`, and
its `previous` output by the plain-English form); more would once other
gaps are fixed (36 Pass nodes in the examples). Fix: treat a Pass's `previous` output (and Loop
Carry) as a cycle break in the loop check. No syntax change.

**9, 11. Structured values and media.** Data columns, Constants lists, Custom Function inputs,
datasets, images. A JSON-ish value (`items=[0.2, 0.5]`, `columns=[x, y]`) would cover the
lists; media needs a reference to an asset (`image="name.png"` from Files).

**12–13. Groups.** `group(…)` works, but always adds a Loop Index (an extra node when the
original had none) and names ports `in0`, `out1`, where hand-made iterated groups use `cin_uv`
style keys, so their shaders differ. A group's own `i` is wired inside, so needs the same
`inside "Group":` block as containers.

**Play setups (not ranked).** 253 examples. Controls, live params, MIDI/mouse mappings and layers
have no words. A `play` dialect line (`play knob "Size" → circle.radius 0.1..0.6`,
`play midi cc1 → glow.brightness`) would bring more examples whole than any graph fix, but it is
a new dialect, not an addition.

### Where the script is long or ugly even though it works

- **The UV `create` adds.** A node with a position input gets a new UV every time. When the
  graph shares one UV, the printer has to `delete before X` right after: 394 such lines. A
  `create noise on uv` (use this UV) or `create noise bare` would halve many scripts.
- **References by order.** 1,293 `word#n` references, because new nodes have no names until
  renamed. They resolve by canvas order, so they depend on where the bar placed things. A
  `create glow as "Halo"` (name at birth) would make scripts readable and stable.
- **Output sockets only in plain English.** Canonical `connect` has no form for which output to
  use. 222 wires needed the English form `connect the glow inner to the input of the
  floattovec3`. The plan's `glow.inner → floattovec3` (socket on the left) is the fix.
- **Wiring the bar could infer.** Most `connect` lines are chain wires (`a → b` where b has one
  free input of a's type) and the Output wire. A chain form, `time → fbm → palette → output`,
  would cover most of them.
- **Reserved words as values.** `heading=random` on Emit and `jitterNoise=random` on March Loop
  Groups draw a random number instead of choosing the option `random`. The printer quotes them
  (`heading="random"`, 72 settings), which works.
- **Odd shortest names.** The printer picks the shortest name that resolves: `margolus` for a
  Grid Rules node, `xor-warp` for Turbulence, `dot` for Circle SDF, `tint` for Colorize. They
  are real aliases, but a reader wouldn't guess them.

## The Do… bar in the browser

Eight examples across folders were rebuilt line by line in the real Do… bar on a Vite dev server
(port 5199, `VITE_GATE=off`): Neon Tube (Color & Lighting), Mouse moves a slider (Play 02),
Displacement Map: a picture pushed by noise map (Passes 10), Where am I? st (Learn 03), CRT TV (Effects & Lens), Game of Life (Grid
sims 1, Grid Rules), Glowing orb (3D: Scene Builder) and Slime mold (Agent rules 1).
For each: the example loaded, its script printed in the page, the graph reset to an Output,
then each line put into the bar's input and run with Enter (the bar's own `run`), then a
screenshot next to the original. Screenshots are in the scratchpad (`lang-pressure/shots/`).

| Example | Lines | Ran | Result |
|---|---:|---:|---|
| Neon Tube | 13 | 13 | same picture, same node types |
| Mouse moves a slider | 7 | 7 | same picture; the mouse mapping (Play) is gone |
| Displacement Map | 15 | 15 | same picture |
| Where am I? st | 10 | 10 | black: the Divide stays float, its two inputs unwired (as the runner predicted) |
| CRT TV | 12 | 12 | no screen bow or vignette: CRT Screen can't be made (the crash) |
| Game of Life (Grid Rules) | 2 | 2 | same node and rule (the original screenshot is at time 0, before it runs) |
| Glowing Orb | 1 | 1 | same orb |
| Slime mold (rules) | 4 | 4 | same picture |

Nothing worked in the runner and failed in the UI, or the other way round. Friction found:

- **The crash blanks the app.** Typing `create crt-screen` (or `create palette`, `create mix`…)
  with a Time node selected unmounts the whole app (blank page, console:
  `Cannot read properties of undefined (reading 'key') at parseDo`). It happens while typing,
  before Enter, because the bar re-reads the line on every keystroke.
- **Type-ahead offers words that make more than they say.** After `create`, the list suggests
  `circle-sdf`, `box-sdf`: those go down the shape path and add a UV, the shape and an SDF Fill.
  The word that makes just the node is `circlesdf`, which the list doesn't show.
- **"Tab or Enter to take"** is shown under the suggestion list, but Enter runs the line (it does
  not take the highlighted suggestion). Tab takes.
- **✓ on lines that can't run.** A line that reads canonically gets the ✓ even when running it
  will fail (`create circlesdfcreate circlesdf` showed ✓ and "isn't a node or shape").
- **Focus.** Opening the bar from the toolbar button and typing straight away lost the first
  keystrokes (focus is set in a `setTimeout`).
- **Placement.** Every created node lands below the last one, so a rebuilt graph is a tall
  column; Fit all nodes doesn't fit a column that long in a narrow canvas.
- **Speed.** Each line previews and runs in well under 100 ms. Printing a graph in the page takes
  25–50 ms for typical examples, 420 ms for the largest (Simulations: grids, 190 lines).
- **One toast per line.** A 15-line script leaves 15 toasts and a notification count.

## Show as commands

The Do… bar has a new code button (next to the star) that shows the level being edited as Do…
lines, with `# cannot express` lines dimmed and a Copy button
(`ScriptPanel` in `src/components/NodeGraph/DoBar.tsx`, screenshot 10). The lines run one at a
time in the bar.

## Sample scripts

**Full: Neon Tube** (7 nodes, 13 lines). The plain-English line is the only way to name an
output socket.

```
create circlesdf
set dot radius=0.5
create sdf-glow
set glow brightness=6 tint=(1,0.25,0.55) innerFalloff=14
create floattovec3
create add-colors
create tone-map
connect dot → glow.distance
connect the glow inner to the input of the floattovec3
connect glow → addcolor.a
connect floattovec3 → addcolor.b
connect addcolor → tonemap.color
connect tonemap → output
```

**Full: Glowing Orb** (3D: Scene Builder, 21 nodes, one line).

```
volumetric density=0.035 falloff=12 shell=0.12 exposure=1.4 tint=(0.35,0.75,1) · smooth-union(sphere r=0.6 name=Core, torus R=0.95 r=0.04 rot=(70,0,0) name="Ring A", torus R=1.15 r=0.035 rot=(-40,30,0) name="Ring B") k=0.15 · background night · tone none · camera dist=3.6 elev=12 orbit=8 · quality steps=110 dist=8
```

**Near: Group: Domain Warp (Carry)** (Iterated Groups). Every node and wire, but `group(…)` adds a
Loop Index and names the carry port differently, so the shader differs.

```
create time
create uv-warp-smooth
set uv-warp strength=0.18 scale=2.5 speed=0.3
create fractal-noise
delete before fbm
set fbm scale=2.5 time_scale=0.05
create palette
set palette preset=1
# cannot express: Palette · input anim keeps 0 (an unwired input's own value has no words)
connect time → uv-warp.time
connect uv-warp → fbm.uv
connect time → fbm.time
connect fbm → palette.value
connect palette → output
group(uv-warp) name="Warp Step"
# cannot express: group “Warp Step”: group(…) adds a Loop Index the original doesn't have
set "Warp Step" iterations=4
```

**Partial: 03 · Where am I? st** (Learn). All six nodes, but the Divide can't be made a vec2 divide, so the two
wires into it fail the type check, and Resolution's `res` output can't be named.

```
create pixel-coordinates
create resolution
create divide
# cannot express: Divide · outputType="vec2" (Divide has no setting “the outputtype”.)
create split-vec2
delete before splitvec2
create make-vec3
# cannot express: Pixel Coordinates · coord → Divide · a (Type check: Pixel Coordinates · Coord is a position (vec2); Divide · A takes a number (float). Try: take .x.)
# cannot express: Resolution · res → Divide · b (it took output “width”, not “res”)
connect divide → splitvec2.v
connect splitvec2 → makevec3.r
connect the splitvec2 y to the g of the makevec3
connect makevec3 → output
# cannot express: the Play setup (1 controls, 0 mappings, 0 layers): controls, live params and MIDI mappings have no words
```

**Partial: CRT TV.** The crash takes out CRT Screen; everything else lands.

```
create time
# cannot express: CRT Screen (create crt-screen: the runner threw: Cannot read properties of undefined (reading 'key'))
create fractal-noise
delete before fbm
set fbm scale=1.6 time_scale=0.2
create palette
set palette scale=1.3
create crt-mask
set crtmask cellSize=5 pulse=0.04 scanlines=0.35
connect time → fbm.time
connect fbm → palette.value
connect palette → crtmask.color
connect crtmask → output
```

## Caveats

- Full is about the graph and its shader. Play setups, node notes, positions and attached media
  are listed as gaps but don't change the class.
- The printer is one way to say a graph; a person might find a shorter one (for example `val=`
  for a Constant's value works by accident). It never uses a form the bar doesn't accept.
- Containers' insides are compared by digest, so "made" counts for them are approximate.
- The unlock counts assume the printer saw every gap in an example. For examples deep in Partial
  it may not have (a missing node hides the gaps of its settings).

## Every example

Folder, class, node count (insides of containers included), share of nodes made, script lines,
and the three most frequent gaps (Play setups listed as `play`).

| Example | Folder | Class | Nodes | Made | Lines | Main gaps |
|---|---|---|---:|---:|---:|---|
| Raymarch Spheres | 3D Basics | Full | 4 | 100% | 5 | — |
| 3D: Hello Sphere | 3D Basics | Partial | 10 | 60% | 18 | container-contents ×2 |
| 3D: Normal to Color | 3D Basics | Partial | 11 | 64% | 18 | container-contents ×2 |
| 3D: Shapes + Ground | 3D Basics | Partial | 16 | 38% | 18 | container-contents ×2 |
| 3D: Soft Metaballs | 3D Basics | Partial | 22 | 36% | 29 | param-name ×5, wire-missing-node ×3, container-contents ×2 |
| Fresnel Schlick: Rim Glow | 3D Lighting | Partial | 15 | 73% | 31 | container-contents ×2, param-name, wire-type |
| Glass 3D: Physical | 3D Lighting | Partial | 10 | 70% | 21 | wire-missing-node ×2, container-contents, runner-crash |
| Glass Metaballs | 3D Lighting | Partial | 17 | 41% | 21 | wire-missing-node ×2, container-contents, runner-crash |
| Lit Still Life | 3D Lighting | Partial | 21 | 48% | 36 | container-contents ×2, dialect-clash ×2, wire-missing-node ×2 |
| Refract Dir: Fake Glass | 3D Lighting | Partial | 14 | 79% | 44 | param-name ×13, wire-missing-node ×2, container-contents |
| 3D: Bend Deform | 3D SDF | Partial | 11 | 55% | 16 | container-contents ×2, param-set-failed |
| 3D: Gyroid + Domain Warp | 3D SDF | Partial | 12 | 50% | 16 | container-contents ×2 |
| 3D: Infinite Pillars | 3D SDF | Partial | 11 | 55% | 18 | container-contents ×2 |
| 3D: Polar Repeat — Radial Symmetry | 3D SDF | Partial | 12 | 50% | 16 | container-contents ×2 |
| 3D: SD Cross | 3D SDF | Partial | 12 | 50% | 17 | container-contents ×2 |
| 3D: Spiral World | 3D SDF | Partial | 17 | 47% | 24 | container-contents ×2, socket-default |
| 3D: Voxel Terrain | 3D SDF | Partial | 20 | 60% | 44 | wire-missing-node ×4, param-name ×3, param-code ×3 |
| Bake: a heavy 3D scene, effects on top | 3D SDF | Partial | 17 | 65% | 32 | container-contents ×2 |
| MLG: Wiggle Tunnel | 3D SDF | Partial | 19 | 58% | 30 | container-contents ×2, socket-default |
| 3D: Scene Builder · Glass objects | 3D: Scene Builder | Full | 24 | 100% | 1 | — |
| 3D: Scene Builder · Glowing orb | 3D: Scene Builder | Full | 21 | 100% | 1 | — |
| 3D: Scene Builder · Infinite pillars | 3D: Scene Builder | Full | 45 | 100% | 1 | — |
| 3D: Scene Builder · Menger-like fold | 3D: Scene Builder | Full | 42 | 100% | 1 | — |
| 3D: Scene Builder · Smooth-blob sculpture | 3D: Scene Builder | Full | 65 | 100% | 1 | — |
| 3D: Scene Builder · Twisted torus | 3D: Scene Builder | Full | 35 | 100% | 1 | — |
| 3D flock | Agents in 3D | Partial | 15 | 53% | 29 | param-code ×4, container-socket ×2, container-contents |
| 3D slime mold | Agents in 3D | Partial | 14 | 57% | 29 | param-code ×4, container-socket ×2, container-contents |
| Fireflies in the dark | Agents in 3D | Partial | 12 | 50% | 22 | param-code ×4, container-contents, container-socket |
| Galaxy in 3D | Agents in 3D | Partial | 12 | 58% | 26 | param-code ×4, container-contents, container-socket |
| Swarm round a torus | Agents in 3D | Partial | 23 | 43% | 38 | container-socket ×4, container-contents ×3, wire-missing-node ×2 |
| Born from your shader | Agents with shaders | Partial | 17 | 53% | 37 | param-code ×7, container-socket ×4, container-contents |
| Ink along a noise field | Agents with shaders | Partial | 13 | 62% | 27 | param-code ×4, container-socket ×3, container-contents |
| Rings that pulse to sound | Agents with shaders | Partial | 18 | 61% | 50 | param-code ×12, container-socket ×10, param-name ×3 |
| Shapes as walls | Agents with shaders | Partial | 22 | 64% | 66 | param-code ×15, container-socket ×10, param-structured |
| Slime on SDF rings | Agents with shaders | Partial | 17 | 59% | 48 | param-code ×12, container-socket ×6, param-name ×3 |
| Slime traces outlines | Agents with shaders | Partial | 21 | 67% | 61 | param-code ×15, container-socket ×8, param-name |
| Spirals from polar UV | Agents with shaders | Partial | 16 | 63% | 43 | container-socket ×9, param-code ×8, param-name ×4 |
| Trails reshape a shader | Agents with shaders | Partial | 18 | 67% | 57 | param-code ×11, container-socket ×10, param-name ×2 |
| Agent rules 1 · Slime mold | Agents: rules | Full | 14 | 100% | 4 | — |
| Agent rules 10 · Swarm: orbiters | Agents: rules | Full | 16 | 100% | 12 | — |
| Agent rules 3 · Flock (boids) | Agents: rules | Full | 14 | 100% | 12 | — |
| Agent rules 5 · Infection (SIR) | Agents: rules | Full | 21 | 100% | 11 | — |
| Agent rules 6 · Termites | Agents: rules | Full | 25 | 100% | 11 | — |
| Agent rules 7 · Fireflies | Agents: rules | Full | 21 | 100% | 12 | — |
| Agent rules 9 · Particles: spark fountain | Agents: rules | Full | 15 | 100% | 12 | — |
| Agent rules 11 · Crowd: two-way walkers | Agents: rules | Partial | 18 | 100% | 24 | param-code ×4, container-socket |
| Agent rules 2 · Ants with food | Agents: rules | Partial | 25 | 100% | 37 | param-code ×12, container-socket ×5 |
| Agent rules 4 · Predator & prey | Agents: rules | Partial | 21 | 100% | 24 | param-code ×4, container-socket |
| Agent rules 8 · DLA growth | Agents: rules | Partial | 20 | 100% | 20 | param-code ×4, container-socket |
| Combo: Wave Texture + Blur H/V | Blur & Lens | Full | 7 | 100% | 16 | — |
| Motion Blur Trails | Blur & Lens | Full | 5 | 100% | 10 | — |
| Tilt-Shift | Blur & Lens | Full | 7 | 100% | 19 | — |
| Depth of Field: Post-Process Blur | Blur & Lens | Partial | 16 | 44% | 18 | wire-missing-node ×2, container-contents, runner-crash |
| DoF: Orbit Orbs | Blur & Lens | Partial | 17 | 35% | 16 | wire-missing-node ×2, container-contents, runner-crash |
| Color: Stops Palette + Colorize | Color & Lighting | Full | 9 | 100% | 21 | — |
| Cosine palettes | Color & Lighting | Full | 5 | 100% | 8 | play |
| Neon Tube | Color & Lighting | Full | 7 | 100% | 13 | — |
| Convert: Soft circle, as written | Convert | Partial | 10 | 90% | 28 | param-name ×4, wire-type ×2, output-socket ×2 |
| Convert: Soft circle, optimised | Convert | Partial | 5 | 100% | 19 | param-code ×4, param-name ×4, container-socket ×3 |
| Bezier shaping curve | Curves & Shapes | Full | 10 | 100% | 24 | play |
| SDF: Circle SDF + SDF Fill | Curves & Shapes | Full | 4 | 100% | 7 | play |
| SDF: distance as light | Curves & Shapes | Full | 5 | 100% | 8 | play |
| Data 3 · City temperatures, a month at a time | Data | Full | 4 | 100% | 8 | play, media |
| Data 4 · A route drawn on | Data | Full | 4 | 100% | 8 | play, media |
| Data 5 · A poem, word by word | Data | Full | 4 | 100% | 8 | play, media |
| Data 6 · A sketch reads s.data() | Data | Full | 4 | 100% | 8 | play, media |
| Data 1 · A year of weather | Data | Partial | 14 | 100% | 43 | output-socket ×5, param-media, param-structured |
| Data 2 · Every row a glowing point | Data | Partial | 12 | 92% | 34 | output-socket ×3, param-media ×2, param-structured ×2 |
| Data 7 · A constellation, typed in | Data | Partial | 10 | 90% | 28 | output-socket ×3, param-media ×2, param-structured ×2 |
| Data 8 · A live feed | Data | Partial | 9 | 89% | 25 | output-socket ×3, param-media ×2, param-structured ×2 |
| Echo Trails | Effects & Lens | Full | 8 | 100% | 17 | — |
| Lens Distortion | Effects & Lens | Full | 6 | 100% | 14 | — |
| CRT TV | Effects & Lens | Partial | 7 | 86% | 13 | wire-missing-node ×3, runner-crash |
| Feedback Smear | Effects & Lens | Partial | 9 | 89% | 21 | runner-crash ×3, wire-missing-node ×2, output-socket |
| Gravity Lens | Fractals | Full | 6 | 100% | 10 | — |
| Newton z⁵−1 | Fractals | Full | 4 | 100% | 5 | — |
| Frame stack: ring in shallow focus | Frame Stack | Full | 4 | 100% | 9 | — |
| Frame stack: ring of frames | Frame Stack | Full | 4 | 100% | 9 | — |
| Frame stack: stack to ring | Frame Stack | Full | 4 | 100% | 9 | — |
| Frame stack: drift apart and back | Frame Stack | Near | 4 | 100% | 10 | runner-crash |
| Frame stack: highlighted frames loop | Frame Stack | Near | 4 | 100% | 10 | runner-crash |
| Frame stack: isometric cards | Frame Stack | Near | 4 | 100% | 10 | runner-crash |
| Frame stack: shuffle the contact sheet | Frame Stack | Near | 4 | 100% | 10 | runner-crash |
| Web: Atlantic | From the Internet | Partial | 18 | 44% | 22 | container-contents ×2, wire-missing-node ×2, param-name |
| Web: Bitshift | From the Internet | Partial | 11 | 100% | 32 | param-code ×4, param-name ×2, container-socket ×2 |
| Web: Gradient 4 | From the Internet | Partial | 7 | 100% | 25 | param-code ×6, container-socket ×3, param-colour-range ×2 |
| Web: Grain Gradient | From the Internet | Partial | 31 | 81% | 88 | wire-missing-node ×19, runner-crash ×12, param-code ×11 |
| Web: Main Frame | From the Internet | Partial | 19 | 95% | 82 | param-code ×22, container-socket ×12, param-set-failed ×3 |
| Web: Orb | From the Internet | Partial | 20 | 35% | 21 | container-contents ×2, wire-missing-node ×2, param-name |
| Web: Pillars | From the Internet | Partial | 7 | 100% | 27 | param-code ×6, container-socket ×5, param-colour-range |
| Web: Rotating Cross Tiles | From the Internet | Partial | 22 | 100% | 95 | param-code ×15, container-socket ×9, output-socket ×2 |
| Web: Shield | From the Internet | Partial | 14 | 93% | 57 | param-code ×16, container-socket ×8, param-set-failed ×3 |
| Web: Solar | From the Internet | Partial | 11 | 91% | 30 | param-code ×7, container-socket ×4, wire-missing-node ×2 |
| Web: The Screen | From the Internet | Partial | 9 | 89% | 37 | param-code ×14, container-socket ×6, param-set-failed ×2 |
| Web: Trippy Noise | From the Internet | Partial | 33 | 100% | 118 | param-code ×9, param-name ×9, container-socket ×5 |
| Ring Glow | Functions | Partial | 4 | 100% | 11 | container-socket ×2, param-structured, param-code |
| GI: Box Frame | GI Lighting | Partial | 13 | 46% | 16 | wire-missing-node ×2, container-contents, runner-crash |
| GI: Sphere & Ground | GI Lighting | Partial | 11 | 55% | 16 | wire-missing-node ×2, container-contents, runner-crash |
| Grid 1 · Built-in shapes and patterns | Grid | Full | 4 | 100% | 6 | play |
| Grid 7 · An Array in every cell | Grid | Full | 11 | 100% | 34 | play |
| Grid: Breathing | Grid | Full | 7 | 100% | 17 | — |
| Grid: Cell ID and hash | Grid | Full | 8 | 100% | 22 | param-name, play |
| Grid: Grid Pattern and the mouse | Grid | Full | 4 | 100% | 6 | play |
| Beat Grid | Grid | Partial | 15 | 93% | 35 | wire-missing-node ×2, runner-crash, play |
| Grid 2 · By hand: Grid node + SDF Fill | Grid | Partial | 10 | 90% | 25 | wire-missing-node ×2, runner-crash, play |
| Grid 3 · One wire: shapes that morph and spin per cell | Grid | Partial | 15 | 87% | 35 | wire-missing-node ×6, runner-crash ×2, play |
| Grid 4 · Big patterns from per-cell numbers | Grid | Partial | 11 | 82% | 24 | wire-missing-node ×5, no-create-word, runner-crash |
| Grid 5 · The mouse changes the shape | Grid | Partial | 9 | 78% | 15 | wire-missing-node ×6, runner-crash ×2, play |
| Grid 6 · Overflow: rings that cross their cells | Grid | Partial | 9 | 89% | 19 | wire-missing-node ×2, no-create-word, play |
| Grid 8 · Array as the grid: melting dots | Grid | Partial | 10 | 90% | 24 | wire-missing-node ×2, runner-crash, play |
| Grid: Attract | Grid | Partial | 8 | 88% | 18 | wire-missing-node ×2, runner-crash |
| Grid: Density Wave | Grid | Partial | 7 | 100% | 25 | param-code ×4, container-socket ×3, runner-crash ×2 |
| Grid: Effects across the grid | Grid | Partial | 7 | 86% | 17 | param-name ×2, wire-missing-node ×2, runner-crash |
| Grid: Metaballs | Grid | Partial | 8 | 100% | 21 | socket-default, param-name, wire-type |
| Lava Lamp | Grid | Partial | 11 | 91% | 27 | wire-missing-node ×4, param-set-failed ×2, no-create-word |
| Webcam CMYK | Halftone | Full | 5 | 100% | 11 | — |
| CMYK Halftone | Halftone | Near | 6 | 100% | 14 | socket-default |
| MIDI: Keys to Glow | Inputs | Partial | 14 | 100% | 38 | param-name, output-socket |
| Group: Domain Warp (Carry) | Iterated Groups | Near | 6 | 100% | 17 | socket-default, group-ports |
| Group: FBM Octaves (Carry) | Iterated Groups | Partial | 10 | 100% | 29 | param-code ×3, param-name, socket-default |
| Group: Fractal Rings (Carry) | Iterated Groups | Partial | 16 | 94% | 43 | param-code ×3, container-socket ×2, socket-default |
| Publish a Node + Keyframes | Iterated Groups | Partial | 9 | 100% | 22 | param-keyframes, group-loop-index |
| 01 · Hello colour | Learn | Full | 2 | 100% | 2 | play |
| 18 · Combining shapes | Learn | Full | 9 | 100% | 21 | play |
| 22 · Move, turn, scale in one node | Learn | Full | 7 | 100% | 15 | play |
| 24 · Tiling | Learn | Full | 5 | 100% | 9 | play |
| 37 · Fractal noise (FBM) in 2D | Learn | Full | 5 | 100% | 9 | play |
| 39 · Domain warp | Learn | Full | 6 | 100% | 13 | play |
| 02 · Uniforms: time | Learn | Partial | 5 | 80% | 9 | wire-missing-node ×2, runner-crash, play |
| 03 · Where am I? st | Learn | Partial | 6 | 100% | 14 | param-name, wire-type, output-socket |
| 04 · Plot a function | Learn | Partial | 10 | 100% | 27 | runner-crash ×3, param-name, wire-type |
| 05 · Pow and friends | Learn | Partial | 12 | 100% | 36 | runner-crash ×4, dialect-clash ×2, param-name |
| 06 · Step and smoothstep | Learn | Partial | 12 | 92% | 34 | runner-crash ×4, wire-missing-node ×2, dialect-clash ×2 |
| 07 · Sin and cos | Learn | Partial | 19 | 100% | 55 | runner-crash ×4, param-name ×3, dialect-clash ×2 |
| 08 · Fract and floor | Learn | Partial | 15 | 93% | 41 | runner-crash ×4, param-name ×2, wire-missing-node ×2 |
| 09 · Shaping functions by hand | Learn | Partial | 13 | 100% | 43 | runner-crash ×4, param-code ×3, param-name ×2 |
| 10 · Mix and gradients | Learn | Partial | 20 | 85% | 52 | wire-missing-node ×12, runner-crash ×7, dialect-clash ×3 |
| 11 · HSB colour | Learn | Partial | 8 | 100% | 20 | param-name, wire-type, output-socket |
| 12 · Polar colour wheel | Learn | Partial | 10 | 100% | 25 | runner-crash, dialect-clash, play |
| 13 · Rectangle from step | Learn | Partial | 14 | 93% | 39 | param-name ×5, wire-missing-node ×3, runner-crash ×2 |
| 14 · Circle from distance | Learn | Partial | 7 | 100% | 17 | runner-crash ×3, param-name, dialect-clash |
| 15 · Distance fields | Learn | Partial | 8 | 100% | 20 | runner-crash ×3, dialect-clash, play |
| 16 · Polar shapes | Learn | Partial | 11 | 100% | 29 | runner-crash ×3, dialect-clash, play |
| 17 · Polygons: polar + distance | Learn | Partial | 10 | 100% | 32 | param-code ×4, runner-crash ×3, param-name ×2 |
| 19 · Translate: move the space | Learn | Partial | 10 | 90% | 23 | wire-missing-node ×3, runner-crash ×2, param-name |
| 20 · Rotate with a matrix | Learn | Partial | 9 | 100% | 21 | runner-crash ×2, play |
| 21 · Scale with a matrix | Learn | Partial | 10 | 100% | 25 | runner-crash ×2, play |
| 23 · YUV: a matrix on colour | Learn | Partial | 7 | 100% | 19 | param-name, wire-type, play |
| 25 · Transforms inside the tiles | Learn | Partial | 10 | 100% | 25 | runner-crash ×2, play |
| 26 · Offset patterns: bricks | Learn | Partial | 14 | 93% | 35 | wire-missing-node ×2, runner-crash ×2, no-create-word |
| 27 · Truchet tiles | Learn | Partial | 14 | 93% | 35 | wire-missing-node ×3, param-name, no-create-word |
| 28 · Random from a sine | Learn | Partial | 10 | 100% | 28 | runner-crash ×3, param-name, wire-type |
| 29 · Random cells | Learn | Partial | 6 | 83% | 15 | wire-missing-node ×2, runner-crash ×2, param-name |
| 30 · A random maze (10 PRINT) | Learn | Partial | 14 | 86% | 31 | wire-missing-node ×5, param-name ×2, no-create-word ×2 |
| 31 · Smooth random: 1D noise | Learn | Partial | 21 | 86% | 52 | wire-missing-node ×10, runner-crash ×5, dialect-clash ×2 |
| 32 · 2D noise | Learn | Partial | 5 | 100% | 10 | runner-crash ×2, play |
| 33 · Noise at work: wood grain | Learn | Partial | 11 | 100% | 33 | runner-crash ×2, param-name, wire-type |
| 34 · Distance to the nearest point | Learn | Partial | 17 | 94% | 47 | runner-crash ×3, wire-missing-node ×2, dialect-clash ×2 |
| 35 · Cellular noise | Learn | Partial | 6 | 100% | 14 | runner-crash, dialect-clash, play |
| 36 · Octaves: fractal noise | Learn | Partial | 11 | 100% | 31 | runner-crash ×3, param-name, wire-type |
| 38 · Turbulence and ridges | Learn | Partial | 16 | 100% | 52 | runner-crash ×2, param-name, wire-type |
| 40 · Fractals: the Mandelbrot set | Learn | Partial | 6 | 100% | 16 | param-name ×2, wire-type, play |
| 41 · A fractal by hand: Loop Carry | Learn | Partial | 11 | 100% | 27 | wire-failed, group-loop-index, play |
| 42 · Extra: first ray march | Learn | Partial | 10 | 60% | 19 | container-contents ×2, play |
| 3D 1 · The camera: one ray per pixel | Learn 3D | Full | 4 | 100% | 7 | play |
| 3D 2 · A sphere is a distance | Learn 3D | Partial | 6 | 100% | 14 | param-code ×2, container-socket, play |
| 3D 3 · The march: counting steps | Learn 3D | Partial | 10 | 50% | 15 | container-contents ×2, play |
| 3D 4 · Hit, normal and light | Learn 3D | Partial | 12 | 50% | 20 | container-contents ×2, wire-missing-node ×2, runner-crash |
| 3D 5 · Combining shapes | Learn 3D | Partial | 14 | 36% | 16 | container-contents ×2, param-name, container-socket |
| 3D 6 · Moving the camera | Learn 3D | Partial | 13 | 46% | 17 | container-contents ×2, play |
| 3D 7 · Glow: through the shape | Learn 3D | Partial | 20 | 50% | 28 | container-contents ×3, wire-missing-node ×2, runner-crash |
| 3D 8 · GI lighting vs the plain loop | Learn 3D | Partial | 19 | 53% | 29 | container-contents ×3, play |
| 3D 9 · Glow from the Volumetric switch | Learn 3D | Partial | 12 | 33% | 15 | container-contents ×2, wire-missing-node ×2, param-structured |
| Matrix 2 · Combine and undo: place a shape | Matrices | Full | 17 | 100% | 41 | play |
| Matrix 3 · Lattices: hexagons, bricks, triangles | Matrices | Full | 8 | 100% | 19 | play |
| Matrix 4 · A grid with any basis | Matrices | Full | 14 | 100% | 33 | play |
| Matrix 1 · What a matrix does to space | Matrices | Partial | 5 | 100% | 11 | param-name, wire-type, play |
| Matrix 5 · Fold, rotate, scale: a fractal from one matrix | Matrices | Partial | 15 | 80% | 35 | wire-missing-node ×4, runner-crash ×4, no-create-word ×2 |
| Matrix 6 · Corner pin: a picture on a tilted card | Matrices | Partial | 6 | 83% | 11 | wire-missing-node ×4, no-create-word, play |
| Matrix 7 · Rotated noise octaves | Matrices | Partial | 23 | 100% | 72 | param-name, wire-type, play |
| Matrix 8 · Colour matrices | Matrices | Partial | 9 | 89% | 16 | wire-missing-node ×3, runner-crash, play |
| Combo: Grid Pattern + FBM per cell | Node Combos | Full | 8 | 100% | 19 | play |
| Combo: Grid Pattern + SDF Glow | Node Combos | Full | 8 | 100% | 19 | play |
| Combo: Grid Pattern + Shapes + Grid Paint | Node Combos | Full | 10 | 100% | 30 | play |
| Combo: Array of grouped moons | Node Combos | Partial | 9 | 89% | 26 | wire-missing-node ×2, runner-crash, param-inline-expr |
| Combo: Array of stars | Node Combos | Partial | 6 | 83% | 16 | param-inline-expr ×2, wire-missing-node ×2, runner-crash |
| Combo: Chaos Layers + Glow to Color | Node Combos | Partial | 6 | 83% | 8 | wire-missing-node ×4, runner-crash ×2 |
| Combo: Dome + Repeat + Height | Node Combos | Partial | 12 | 100% | 40 | param-code ×3, param-name ×2, container-socket ×2 |
| Combo: Grid + SDF Fill + Bloom | Node Combos | Partial | 11 | 91% | 30 | wire-missing-node ×3, runner-crash ×2, param-name |
| Combo: Grid Pattern + grouped flower | Node Combos | Partial | 11 | 91% | 30 | wire-missing-node ×2, param-inline-expr, runner-crash |
| Combo: Grid Pattern + Shape by wire | Node Combos | Partial | 8 | 88% | 16 | wire-missing-node ×2, runner-crash, play |
| Combo: Repeat + Cell ID + Hash | Node Combos | Partial | 9 | 100% | 23 | dialect-clash |
| Combo: Turbulence + SDF + Glow | Node Combos | Partial | 7 | 86% | 13 | wire-missing-node ×3, runner-crash |
| Combo: Voxelize + Sphere 3D + Hash | Node Combos | Partial | 21 | 57% | 43 | param-name ×3, param-code ×3, container-contents ×2 |
| Ink in Water | Particles | Full | 2 | 100% | 3 | — |
| Particle Galaxy | Particles | Full | 6 | 100% | 12 | — |
| Particles: Flow Field | Particles | Full | 5 | 100% | 9 | — |
| Particles: Image Dissolve | Particles | Near | 3 | 100% | 11 | param-code ×4, media |
| Particles in a 3D Scene | Particles | Partial | 11 | 64% | 26 | container-contents ×2 |
| Particles round a Shape | Particles | Partial | 7 | 100% | 17 | dialect-clash |
| Particles: Chladni Sand | Particles | Partial | 6 | 100% | 22 | param-code ×7, container-socket ×2, param-media |
| Particles: Currents into a Heart | Particles | Partial | 8 | 100% | 26 | param-code ×7, container-socket ×3 |
| Particles: Cymatics in 3D | Particles | Partial | 4 | 100% | 13 | param-code ×3, param-media, container-socket |
| Particles: Dust in Air | Particles | Partial | 4 | 100% | 13 | param-code ×4, container-socket |
| Particles: Embers | Particles | Partial | 5 | 100% | 16 | param-code ×4, container-socket |
| Particles: Rain | Particles | Partial | 5 | 100% | 15 | param-code ×3, container-socket |
| Particles: Sound Field | Particles | Partial | 4 | 100% | 12 | param-code ×3, container-socket |
| Particles: Star Outline | Particles | Partial | 5 | 100% | 13 | param-code ×4, container-socket |
| Passes 10 · Displacement Map: a picture pushed by noise | Passes | Full | 6 | 100% | 16 | play |
| Passes 1 · Edge glow | Passes | Partial | 13 | 100% | 44 | param-code ×4, container-socket ×4, param-set-failed ×2 |
| Passes 2 · Particles born on edges | Passes | Partial | 10 | 100% | 42 | param-code ×8, container-socket ×4, play |
| Passes 3 · Feedback trails | Passes | Partial | 10 | 100% | 51 | param-code ×16, container-socket ×7, param-name ×2 |
| Passes 4 · Reaction-diffusion | Passes | Partial | 10 | 100% | 47 | param-code ×12, container-socket ×7, param-name ×2 |
| Passes 5 · Glow only the bright parts | Passes | Partial | 12 | 100% | 55 | param-code ×12, container-socket ×7, param-set-failed ×3 |
| Passes 6 · Slime along edges | Passes | Partial | 21 | 67% | 69 | param-code ×18, container-socket ×8, param-name ×2 |
| Passes 7 · Jump-flood distance field | Passes | Partial | 11 | 100% | 58 | param-code ×17, container-socket ×11, param-set-failed |
| Passes 8 · Edges straight from a picture | Passes | Partial | 7 | 100% | 29 | container-socket ×5, param-code ×4, param-name |
| Passes 9 · A reusable blur group | Passes | Partial | 9 | 100% | 44 | param-code ×7, container-socket ×5, param-set-failed ×3 |
| Chladni Field (Quick) | Physics | Full | 4 | 100% | 6 | — |
| Chladni Mode Frequency | Physics | Full | 7 | 100% | 15 | — |
| 01 · Controls from the graph | Play | Full | 5 | 100% | 8 | play |
| 02 · Mouse moves a slider | Play | Full | 5 | 100% | 8 | play |
| 03 · Remap curves | Play | Full | 5 | 100% | 8 | play |
| 04 · LFOs and the clock | Play | Full | 5 | 100% | 8 | play |
| 05 · Noise: smooth, drift, random, stepped | Play | Full | 5 | 100% | 9 | play |
| 06 · Controls that drive controls | Play | Full | 5 | 100% | 8 | play |
| 08 · Colour channels | Play | Full | 5 | 100% | 8 | play |
| 09 · Keys: hold and hit | Play | Full | 5 | 100% | 8 | play |
| 10 · Triggers: toggle, step, random | Play | Full | 5 | 100% | 9 | play |
| 100 · Piano roll: a clip in a scale | Play | Full | 5 | 100% | 9 | play |
| 101 · Granulator: Spectral, emitted grains | Play | Full | 5 | 100% | 9 | play |
| 102 · Particles: hear an engine track | Play | Full | 2 | 100% | 4 | play |
| 103 · Particle Glow | Play | Full | 5 | 100% | 8 | play |
| 105 · Letter Drop | Play | Full | 5 | 100% | 9 | play |
| 107 · Water: a wake, rain and splashes | Play | Full | 5 | 100% | 9 | play |
| 109 · Water layer: a boat and its wake | Play | Full | 5 | 100% | 9 | play |
| 11 · Beats | Play | Full | 5 | 100% | 8 | play |
| 12 · Live audio (mic or DAW) | Play | Full | 5 | 100% | 8 | play |
| 13 · Audio readers | Play | Full | 5 | 100% | 9 | play |
| 14 · MIDI controller | Play | Full | 5 | 100% | 8 | play |
| 16 · OSC (Ableton, TouchOSC) | Play | Full | 5 | 100% | 8 | play |
| 17 · Phone tilt | Play | Full | 5 | 100% | 9 | play |
| 18 · Nulls: a point you drag | Play | Full | 5 | 100% | 9 | play |
| 19 · Following nulls (springs) | Play | Full | 5 | 100% | 9 | play |
| 20 · Distance between nulls | Play | Full | 5 | 100% | 8 | play |
| 21 · Proximity: fire when close | Play | Full | 5 | 100% | 9 | play |
| 22 · Conditions and signals | Play | Full | 5 | 100% | 9 | play |
| 23 · Pairs, XY pads and axis swap | Play | Full | 5 | 100% | 9 | play |
| 24 · Increments: move in steps | Play | Full | 5 | 100% | 9 | play |
| 29 · Camera | Play | Full | 5 | 100% | 9 | play |
| 30 · Video with sound | Play | Full | 5 | 100% | 9 | play |
| 31 · Brush | Play | Full | 5 | 100% | 9 | play |
| 32 · Audio visualiser | Play | Full | 5 | 100% | 8 | play |
| 36 · Particles: flow field | Play | Full | 5 | 100% | 9 | play |
| 37 · Particles: climb and descend | Play | Full | 5 | 100% | 8 | play |
| 38 · Particles: noise field | Play | Full | 5 | 100% | 9 | play |
| 39 · Attractors | Play | Full | 5 | 100% | 9 | play |
| 40 · Emitters and absorbers | Play | Full | 5 | 100% | 9 | play |
| 41 · Flocking | Play | Full | 5 | 100% | 9 | play |
| 42 · Bursts on the beat | Play | Full | 5 | 100% | 9 | play |
| 43 · Collisions and links | Play | Full | 5 | 100% | 9 | play |
| 44 · Particle looks | Play | Full | 5 | 100% | 9 | play |
| 46 · Multiply | Play | Full | 5 | 100% | 8 | play |
| 47 · Walls and containers | Play | Full | 5 | 100% | 9 | play |
| 48 · Portals | Play | Full | 5 | 100% | 9 | play |
| 49 · Wind, vortex and drag | Play | Full | 5 | 100% | 9 | play |
| 50 · Tint and resize zones | Play | Full | 5 | 100% | 9 | play |
| 51 · Sensors: how full is the box | Play | Full | 5 | 100% | 9 | play |
| 52 · Relationship: a chase | Play | Full | 5 | 100% | 9 | play |
| 53 · Relationship: orbits and the picture | Play | Full | 5 | 100% | 9 | play |
| 54 · Agents: boids | Play | Full | 5 | 100% | 8 | play |
| 55 · Agents: predators and prey | Play | Full | 5 | 100% | 8 | play |
| 56 · Shape triggers | Play | Full | 5 | 100% | 9 | play |
| 59 · Glowing text and strokes | Play | Full | 5 | 100% | 8 | play |
| 60 · Script: a first sketch | Play | Full | 5 | 100% | 9 | play |
| 61 · Script: 3D on a 2D canvas | Play | Full | 5 | 100% | 9 | play |
| 62 · 3D Script: shapes over the shader | Play | Full | 5 | 100% | 9 | play |
| 64 · Script: the mouse | Play | Full | 5 | 100% | 9 | play |
| 66 · Script: nulls as handles | Play | Full | 5 | 100% | 9 | play |
| 67 · Script: buttons on keys and beats | Play | Full | 5 | 100% | 9 | play |
| 68 · Script: particles in plain JS | Play | Full | 5 | 100% | 9 | play |
| 70 · p5: an imported flow field | Play | Full | 5 | 100% | 9 | play |
| 71 · p5: a sketch in three files | Play | Full | 5 | 100% | 9 | play |
| 72 · p5: a WEBGL sketch in 3D | Play | Full | 5 | 100% | 9 | play |
| 73 · Script: the shader glows around it | Play | Full | 5 | 100% | 8 | play |
| 74 · Background: a colour, no shader | Play | Full | 5 | 100% | 9 | play |
| 75 · Background: particles over a photo | Play | Full | 5 | 100% | 9 | play |
| 77 · Matte: a photo through particles | Play | Full | 5 | 100% | 9 | play |
| 79 · Motion: reveal and trigger where it moves | Play | Full | 5 | 100% | 9 | play |
| 80 · Hands: fingertips move particles | Play | Full | 5 | 100% | 9 | play |
| 81 · Hands: pinch, point and fist | Play | Full | 5 | 100% | 9 | play |
| 82 · Hands: two at once | Play | Full | 5 | 100% | 8 | play |
| 83 · Hands: touch a shape | Play | Full | 5 | 100% | 9 | play |
| 85 · A recorded take | Play | Full | 5 | 100% | 9 | play |
| 88 · Finish: CRT, bloom, grain and shake | Play | Full | 5 | 100% | 9 | play |
| 89 · Finish: halation | Play | Full | 5 | 100% | 9 | play |
| 91 · Finish: pixel sort and light leaks | Play | Full | 5 | 100% | 9 | play |
| 93 · Finish: ASCII terminal | Play | Full | 5 | 100% | 9 | play |
| 96 · Finish: motion extract | Play | Full | 5 | 100% | 9 | play |
| 97 · Drum pads | Play | Full | 5 | 100% | 9 | play |
| 98 · Granulator | Play | Full | 5 | 100% | 9 | play |
| 99 · Audio effects | Play | Full | 5 | 100% | 9 | play |
| 07 · Expression knobs | Play | Near | 5 | 100% | 13 | param-inline-expr ×2, param-name ×2, play |
| 104 · Flow Around Words | Play | Near | 6 | 100% | 12 | socket-default, play |
| 106 · Look: effects from nodes and code | Play | Near | 6 | 100% | 12 | socket-default, play |
| 110 · Displace: text rippling through a map | Play | Near | 6 | 100% | 12 | socket-default, play |
| 111 · Displace: particles by the shader, the picture by a word | Play | Near | 6 | 100% | 12 | socket-default, play |
| 15 · Pad grid (Push, Launchpad) | Play | Near | 6 | 100% | 14 | param-inline-expr, play |
| 25 · Text: over, reveal, luma | Play | Near | 6 | 100% | 12 | socket-default, play |
| 26 · Picture: layers only | Play | Near | 6 | 100% | 12 | socket-default, play |
| 27 · Text sequences | Play | Near | 6 | 100% | 12 | socket-default, play |
| 28 · Images | Play | Near | 6 | 100% | 12 | socket-default, play |
| 33 · Glyphs: ASCII and halftone | Play | Near | 6 | 100% | 12 | socket-default, play |
| 34 · Contours | Play | Near | 6 | 100% | 12 | socket-default, play |
| 35 · Lens | Play | Near | 6 | 100% | 12 | socket-default, play |
| 45 · Particles as a mask | Play | Near | 6 | 100% | 12 | socket-default, play |
| 57 · Drawn shapes and trim | Play | Near | 6 | 100% | 12 | socket-default, play |
| 58 · The picture as a shape | Play | Near | 6 | 100% | 12 | socket-default, play |
| 63 · 3D Script: the shader on a cube | Play | Near | 6 | 100% | 12 | socket-default, play |
| 65 · Script: reading the picture | Play | Near | 6 | 100% | 12 | socket-default, play |
| 69 · Script: a p5 sketch, pasted in | Play | Near | 6 | 100% | 12 | socket-default, play |
| 76 · Background queue | Play | Near | 6 | 100% | 12 | socket-default, play |
| 78 · Masks: text through a moving window | Play | Near | 6 | 100% | 12 | socket-default, play |
| 84 · Hand paths | Play | Near | 6 | 100% | 12 | socket-default, play |
| 86 · Finish: grade and lens | Play | Near | 6 | 100% | 12 | socket-default, play |
| 87 · Finish: looks and split toning | Play | Near | 6 | 100% | 12 | socket-default, play |
| 90 · Finish: time displacement | Play | Near | 6 | 100% | 12 | socket-default, play |
| 92 · Finish: comic print | Play | Near | 6 | 100% | 12 | socket-default, play |
| 94 · Finish: presets into a mandala | Play | Near | 6 | 100% | 12 | socket-default, play |
| 95 · Finish: datamosh and layer echo | Play | Near | 6 | 100% | 12 | socket-default, play |
| 108 · Agents: a hand and a beat | Play | Partial | 12 | 33% | 13 | param-structured, container-contents, play |
| Fractal Rings | Rings | Full | 4 | 100% | 4 | — |
| Slime rule, by hand (JS) | Simulation | Full | 5 | 100% | 9 | play |
| Ants | Simulation | Partial | 18 | 61% | 54 | param-code ×15, container-socket ×9, container-contents |
| Boids | Simulation | Partial | 16 | 50% | 29 | param-code ×4, container-socket ×2, container-contents |
| Curl smoke | Simulation | Partial | 11 | 36% | 11 | container-contents |
| Galaxy | Simulation | Partial | 12 | 58% | 26 | param-code ×4, container-contents, container-socket |
| Grow toward a picture | Simulation | Partial | 19 | 63% | 61 | param-code ×18, container-socket ×8, param-name ×2 |
| Multi-species slime | Simulation | Partial | 15 | 53% | 32 | param-code ×4, container-socket ×2, container-contents |
| Mycelium | Simulation | Partial | 15 | 60% | 32 | param-code ×2, container-socket ×2, container-contents |
| Particles from nodes | Simulation | Partial | 13 | 46% | 22 | param-code ×4, container-contents, param-set-failed |
| Sand on a plate | Simulation | Partial | 9 | 67% | 22 | param-code ×4, container-contents, container-socket |
| Slime mold | Simulation | Partial | 12 | 50% | 18 | container-contents, container-socket |
| Sound burst | Simulation | Partial | 11 | 36% | 10 | container-contents |
| Strands | Simulation | Partial | 13 | 46% | 19 | container-contents, container-socket |
| Crowd: lanes in two-way traffic | Simulations: agents | Partial | 26 | 38% | 41 | param-code ×8, container-socket ×4, container-contents |
| Diffusion-limited aggregation | Simulations: agents | Partial | 19 | 47% | 39 | param-code ×8, container-socket ×4, container-contents |
| Fireflies flashing in time | Simulations: agents | Partial | 18 | 44% | 30 | param-code ×4, container-socket ×3, container-contents |
| Infection spread (SIR) | Simulations: agents | Partial | 20 | 40% | 30 | param-code ×4, container-socket ×3, container-contents |
| Painter bots | Simulations: agents | Partial | 18 | 39% | 28 | param-code ×4, container-socket ×2, container-contents |
| Predators and prey | Simulations: agents | Partial | 29 | 41% | 50 | param-code ×8, container-socket ×5, container-contents |
| Sand drift: dunes from wind | Simulations: agents | Partial | 24 | 33% | 34 | param-code ×4, container-socket ×4, container-contents |
| Termites and wood chips | Simulations: agents | Partial | 18 | 44% | 30 | param-code ×4, container-socket ×3, container-contents |
| Grid sims 1 · Game of Life (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 10 · Pattern rules: frost (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 11 · Block rules: gas (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 2 · Life-like rules (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 3 · Brian's Brain (Grid Rules) | Simulations: grids | Full | 4 | 100% | 11 | play |
| Grid sims 4 · Cave generator (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 5 · Water ripples (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 6 · Heat diffusion (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 7 · Forest fire (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 8 · Falling sand (Grid Rules) | Simulations: grids | Full | 2 | 100% | 3 | play |
| Grid sims 1 · Game of Life (under the hood) | Simulations: grids | Partial | 50 | 82% | 150 | wire-missing-node ×21, param-name ×8, container-socket ×8 |
| Grid sims 2 · Life-like rules (under the hood) | Simulations: grids | Partial | 49 | 84% | 187 | container-socket ×28, param-name ×23, wire-missing-node ×19 |
| Grid sims 3 · Brian's Brain (under the hood) | Simulations: grids | Partial | 55 | 85% | 158 | wire-missing-node ×23, runner-crash ×18, container-socket ×8 |
| Grid sims 4 · Cave generator (under the hood) | Simulations: grids | Partial | 35 | 91% | 121 | container-socket ×9, wire-missing-node ×8, param-name ×3 |
| Grid sims 5 · Water ripples (under the hood) | Simulations: grids | Partial | 41 | 95% | 115 | wire-missing-node ×5, param-name ×3, no-create-word ×2 |
| Grid sims 6 · Heat diffusion (under the hood) | Simulations: grids | Partial | 25 | 92% | 65 | wire-missing-node ×8, param-name ×4, runner-crash |
| Grid sims 7 · Forest fire (under the hood) | Simulations: grids | Partial | 71 | 86% | 191 | wire-missing-node ×28, runner-crash ×11, no-create-word ×8 |
| Grid sims 8 · Falling sand (under the hood) | Simulations: grids | Partial | 52 | 96% | 176 | runner-crash ×15, container-socket ×15, wire-missing-node ×7 |
| Grid sims 9 · Wireworld (Grid Rules) | Simulations: grids | Partial | 6 | 100% | 21 | param-code ×4, container-socket ×2, param-name |
| Grid sims 9 · Wireworld (under the hood) | Simulations: grids | Partial | 62 | 81% | 177 | wire-missing-node ×36, runner-crash ×11, container-socket ×10 |
| Magic Texture | Space & Texture | Full | 4 | 100% | 4 | — |
| Neon Floor Grid | Space & Texture | Full | 7 | 100% | 17 | — |
| Space Atlas | Space & Texture | Full | 7 | 100% | 18 | — |
| Wave Interference | Space & Texture | Near | 7 | 100% | 23 | param-name ×4, param-set-failed, socket-default |
| Wave Texture | Space & Texture | Near | 5 | 100% | 10 | param-set-failed, socket-default |
| Texture tools 1 · Glowing outline from a video | Texture tools | Near | 12 | 100% | 40 | param-set-failed, play |
| Texture tools 2 · Motion trails with Fade | Texture tools | Partial | 12 | 100% | 38 | wire-failed, play |
| Texture tools 3 · A slime trail bends a picture | Texture tools | Partial | 16 | 63% | 34 | container-contents, param-name, container-socket |
| Texture tools 4 · Colour key on a video | Texture tools | Partial | 8 | 100% | 20 | param-name, output-socket, wire-type |
| Texture tools 5 · Reaction-diffusion, shaped and coloured | Texture tools | Partial | 11 | 100% | 46 | param-code ×8, container-socket ×6, param-name ×2 |
| Texture tools 6 · Grow and shrink a mask | Texture tools | Partial | 11 | 100% | 41 | output-socket ×3, param-set-failed ×2, param-name ×2 |
| Texture tools 7 · Outline and rings from a jump flood | Texture tools | Partial | 13 | 100% | 55 | param-code ×6, container-socket ×5, play |
| Slit-scan from a time cube | Time Cube | Full | 4 | 100% | 9 | — |
| Time cube: a video as a box of time | Time Cube | Full | 4 | 100% | 8 | — |
| Time cube: flow | Time Cube | Full | 3 | 100% | 4 | — |
| Time cube: fly-through | Time Cube | Full | 3 | 100% | 5 | play |
| Time cube: highlighted frames loop | Time Cube | Full | 4 | 100% | 8 | — |
| Time cube: isolate a colour | Time Cube | Full | 4 | 100% | 8 | — |
| Time cube: long exposure | Time Cube | Full | 4 | 100% | 9 | — |
| Time cube: pulsing key | Time Cube | Full | 3 | 100% | 5 | play |
| Time cube: soft pill | Time Cube | Full | 3 | 100% | 4 | — |
| [ New ] | Unfiled | Full | 4 | 100% | 5 | — |
| 3D: Glow Marcher | Volumetric | Partial | 16 | 69% | 31 | container-contents ×2, param-name ×2, output-socket ×2 |
| Volumetric: Animated Repeat | Volumetric | Partial | 27 | 44% | 37 | container-contents ×2, socket-default, output-socket |
| Volumetric: Volume Glow | Volumetric | Partial | 13 | 46% | 18 | wire-missing-node ×3, container-contents ×2, runner-crash ×2 |