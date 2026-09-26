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

Names an expression may use:

| name | what it is |
| --- | --- |
| `input` | the raw value at this input: wire, slider or keyframes. Required: an expression that doesn't mention it isn't modifying anything. |
| `t` | time in seconds (`time` too) |
| `uv` | the canvas UV (centred, aspect-corrected) |
| `res` | the canvas size in pixels; `mouse` the mouse in 0..1 |
| the card's other float inputs | by socket key, as they arrive (before their own expressions) |
| the card's float sliders | by param key |

plus GLSL's built-in functions (`sin`, `cos`, `fract`, `floor`, `abs`, `pow`,
`mix`, `clamp`, `smoothstep`, `step`, `mod`, `min`, `max`, `length`…),
`PI`, `TAU`, and the ternary. Not allowed: `;`, braces, assignment, unknown
names (the editor says which), and functions the check doesn't know (the
compiler would reject them with the line marked anyway).

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
- No sliders of its own: a number in an expression is a number. To keep a knob,
  keep the card (turn the absorb strategy off) or reference one of the card's
  sliders by name.
- Wired-slider display and the "Play control from upstream" flow read the raw
  socket, as they should; an expression is visible on the row and in the
  tooltip, not in the slider.
- Next: the same affordance on an Expression Block's input rows is already
  there (blocks are cards); a per-expression slider (`k` in `input * k`) would
  need a param slot per expression, which is the natural next step if the
  no-knob limit bites.
