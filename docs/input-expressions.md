# Input expressions

A one-line GLSL expression on a float input that modifies the value arriving
there. `input * 2.0`, `input + sin(t)`, `fract(input)`,
`smoothstep(0.0, 1.0, input)`. The raw input is untouched: its wire, its
slider, its keyframes or the Play control driving it all keep working, and the
expression is a layer on top, applied exactly where the card reads the input.

## Using it

Hover an input row on a card and a faint **ƒ** appears at the right of the
label (float inputs only; not on the Output card or a group's ports); on a
touch screen it is always there, since there is no hover. Click it
for the editor: one line, the names it may use as chips (click inserts), a
check as you type, Enter or **Done** applies, **Remove** clears. When an
expression is set, the row shows it as a purple chip; click the chip to edit,
and the socket tooltip lists it. Setting and removing are undo steps.

On a phone, the node view's Wiring list shows the same ƒ on every eligible
input row: faint when unset, the expression as a purple chip when set. Tapping
it opens the same editor as a bottom sheet, knobs included.

Names an expression may use:

| name | what it is |
| --- | --- |
| `input` | the raw value at this input: wire, slider or keyframes. Required: an expression that doesn't mention it isn't modifying anything. |
| `t` | time in seconds (`time` too) |
| `uv` | the canvas UV (centred, aspect-corrected) |
| `res` | the canvas size in pixels; `mouse` the mouse in 0..1 |
| the card's other float inputs | by socket key, as they arrive (before their own expressions) |
| the card's float sliders | by param key |
| the input's knobs | by the names you gave them (below) |

plus GLSL's built-in functions (`sin`, `cos`, `fract`, `floor`, `abs`, `pow`,
`mix`, `clamp`, `smoothstep`, `step`, `mod`, `min`, `max`, `length`…),
`PI`, `TAU`, and the ternary. Not allowed: `;`, braces, assignment, unknown
names (the editor says which), and functions the check doesn't know (the
compiler would reject them with the line marked anyway).

## Knobs

A knob is a name of the expression's own that is a slider: `wob` in
`input * (1.0 + wob * sin(t * 6.0))`. Two ways to make one in the editor:

- Type a name that isn't known yet. Instead of an error, the check line says
  "`wob` is new here" with a **Make wob a knob** button (one per new name).
- **Add a knob** (the dashed chip after the names) makes `k` (then `k2`, `k3`…)
  and puts it in at the cursor; after a value (`input`, `2.0`, a `)`) it goes
  in as `* k`, so the line stays valid.

A new knob starts at 1 with a range of 0 to 2. The editor lists the knobs
under the names, each with a value slider, **Min** and **Max** fields and a ×
that removes it (and takes it out of the line where it stands alone as a
factor). A knob the expression no longer mentions is dimmed and is dropped on
**Done**. Dragging an applied knob's slider in the editor moves it live.

On the card each knob is a slider right under its expression's row, named in
purple. It behaves like any float slider: dragging is a uniform write (no
recompile); right-click it for **Add to Play controls** (the control reads
"Radius · wob"), so Play mappings (MIDI, LFOs, the mouse…) drive it; the ◆
button keys it, and a keyed knob shows its curve on the ruler. On a phone the
knobs are also in the node view's value list, as "Radius · wob".

Knob names follow the same rules as any name here: a letter, then letters,
digits or single underscores, up to 16 characters. Reserved, and so never
offered: `input`, `t`/`time`, `uv`, `res`/`resolution`, `mouse`, `PI`, `TAU`,
GLSL keywords, types and the functions above, anything starting `gl_`, `u_`
or `kf_`, and names the card already has (its inputs and sliders).

Stored as: `params["__inKnobs_<inputKey>"] = [{ name, min, max }]` and each
value in `params["knob_<inputKey>_<name>"]` (underscores in the input key
become `x`, so the uniform name never holds `__`). `getNodeDefinitionFor`
declares each value param as a float paramDef (`knobParamDefs`), which is all
the uniform patcher, keyframes, Play candidates and group overrides need; the
binder reads what the patcher left in the param (a uniform name, a keyframe
call, or a number on a card that stays baked). Removing the expression, or a
knob, clears its value and keyframes. Removing a knob in the editor freezes it
first: the line keeps the value the knob had right then (its slider, keyframes
or Play mapping) as a number, so the input doesn't change. A Play control on a knob that was
removed shows as missing, like any control whose param went away. Old
expressions have no knob list and compile exactly as before.

Try the Play example **Expression knobs**: Circle SDF's Radius wobbles by
`wob * sin(t * speed)`, with an LFO on Wobble and Speed left free.

## How it works

An expression is a param on the card: `params["__inExpr_<inputKey>"]`.
Nothing about the socket, the wire or the slider changes, which is what keeps
keyframes, Play controls and wired-slider display working unmodified.

Compilation happens in one place, `src/glsl/inputExpr.ts`, by wrapping every
node definition's `generateGLSL` (in `getNodeDefinition`): before a card's own
GLSL runs, each expression is bound and substituted into the input variables
it reads. `input` becomes the resolved raw value in parentheses, `t`/`res`/
`mouse`/`uv` become the shader's uniforms and `g_uv`, a sibling input becomes
its resolved variable, a slider becomes its patched param (a uniform name, a
keyframe call, or a literal). Because the assembler builds input variables at
twelve different sites (top level, groups, iterated groups, accumulators…),
wrapping the definition is the one seam that reaches all of them; a definition
never knows the layer exists. An input with no resolved variable (Mix's `t`
slider, which the definition reads from params) takes its param as `input`.

The wrapper is memoised per definition, so `getNodeDefinition` keeps returning
one object per type, and `getNodeDefinitionFor` (per-instance defs, Constants
and the like) spreads the wrapped one.

## With the optimiser and the converter

The optimiser's second strategy, *absorb into input expressions*, writes these
for you: a short run of float math before a float socket becomes an expression
on that socket, wired to what fed the run (`docs/glsl-to-nodes.md`, "The
optimise-graph pass"). The Convert page's *Optimised* form applies it, so
`float r = length(p) * 2.0 + 0.1;` feeding a smoothstep arrives as an
expression on the smoothstep's socket rather than as Multiply and Add cards.
The dialog's before/after render proves the picture is unchanged; the harness
is at 17 of 17 identical.

## Limits, and what's next

- Float sockets only. A vec2 or colour input has no `input` scalar to root
  in; a vectorised math card (Add set to vec2) accepts an expression on its
  float-declared sockets and GLSL type-checks it, which is right for `input *
  2.0` and wrong for `input + 1.0`.
- A number in an expression is still a number; make it a knob to get a
  slider. The optimiser's absorb pass writes plain numbers (the sliders of the
  cards it absorbs are baked, as before), and when it absorbs a card that had
  knobs of its own, their current values are baked too.
- A knob's name can't be changed in place: edit the line and make the new name
  a knob (its value starts over).
- Wired-slider display and the "Play control from upstream" flow read the raw
  socket, as they should; an expression is visible on the row and in the
  tooltip, not in the slider.
- Next: the same affordance on an Expression Block's input rows is already
  there (blocks are cards).
