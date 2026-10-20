# Simple Expression

**Simple Expression** (Functions; search also finds it as *One-liner*, *Quick expression* or *Formula*) is one line of GLSL right on the card, for when a whole Expression Block is more than you need: `mix(a, b, smoothstep(0.2, 0.8, c))`. There is no editor window; the card is the whole node. Source: `src/nodes/definitions/simpleExpr.ts`, card `src/components/NodeGraph/SimpleExprCard.tsx`, type sync `src/compiler/simpleExprSync.ts`.

## The card

- **Inputs**: one row each, with its socket. A new node has one input, `a`, and returns it. **+ Input** adds the next free name (`a`, `b`, `c` … skipping `t`, which is time). Double-click a name to rename it; the expression follows the new name and the wire stays. The ↑ moves a row up, the bin removes it (and its wire); the row's × (far right) only unwires it.
- **Types come from wires.** An input has no type of its own: it shows **any** (a dashed chip, a grey socket) until something is wired in, then takes the wire's type (float, vec2, vec3, vec4, mat2, mat3) in the wire's colour. Rewire it and it retypes at once. An unwired input is a float 0.0.
- **Output**: float, vec2, vec3 or vec4: what the Result socket gives.
- **The field**: the app's one-line GLSL field (highlighting, completions of the inputs and free names, bracket marks). Typing recompiles after a short pause, as the Expression Block does.
- Under it: what the expression makes (*Makes vec3*), a cast it adds (*Makes float, cast to vec3: the number fills every part of the vec3*), or what's wrong, in red.
- **Convert to Expression Block** (on the card and on the right-click menu).

## Names the expression can use

Its inputs by name; `t` and `time` (seconds), `uv` (the canvas position, centred and aspect-corrected, as the UV node gives it), `res` (canvas size in pixels), `mouse`; `PI`, `TAU`; the shader's `u_…` uniforms; and GLSL's built-in functions. An input with the same name as a free one wins (an input called `t` is that input, not the clock). The free names are declared only when the expression uses them.

## Input names

A name must be a GLSL name (letters, digits and `_`, not starting with a digit, no `__`), not a GLSL word (`float`, `if`, `sin`, `mix`, `PI` …), not start with `gl_`, `u_` or `g_` (the shader's own), and not be another input's name. The card says which rule a name broke and keeps the old one.

## What it compiles to

```glsl
vec3 simpleExpr_4_result;
{
    vec3 a = palette_2_color;
    vec3 b = colorPicker_3_rgb;
    float c = 0.0;            // unwired: float 0.0
    float t = u_time;         // used, so declared
    simpleExpr_4_result = (mix(a, b, smoothstep(0.2, 0.8, c * t)));
}
```

The block scope keeps the input names from clashing with anything else in the shader.

## Output type: casts and refusals

When the card can tell what the expression makes (it reads the line with the same type rules the Do bar uses), a type that isn't the Output type is cast by the graph's own wire rule (`lib/typesCompatible.ts`): a float fills a vector (`vec3(x)`), vec3 → vec2 keeps `.xy`, vec2 → vec3 adds z = 0, vec3 → vec4 adds alpha 1. Anything else (a vec3 into a float Output) is refused with a fix (*Try length(…), or set Output to vec3*).

When it can't tell (a matrix input, a function it doesn't know, `[ ]`), the line goes in as written and the GPU checks it; a GPU error shows on the card like any node's.

**Auto output type: not built.** The card can't always tell the type (matrices, unknown functions), so an Auto choice would sometimes guess; the Output stays an explicit choice, and the status line says what the expression makes when it can.

## Errors

What the card can catch before the GPU (an unknown name, an assignment `=` or `+=`, `;` or braces, unbalanced brackets, a bad swizzle, a type the Output can't take, a texture wired in) is shown under the field, the field's edge turns red, and the node gives zero of its Output type, so the rest of the graph keeps drawing while you fix it.

## Textures are refused

A texture is a sampler's name, not a value, so a Simple Expression can't read one: the socket doesn't light up for a texture wire, and if one gets there anyway the card says *wired to a texture … Sample it first (Sample Texture), or convert to an Expression Block* (the Expression Block takes picture inputs).

## Expression Block ↔ Simple Expression

- **Convert to Expression Block**: the same node id, inputs (by name, typed as they were wired), wires and expression; the block's Result line is the expression. Free names the block doesn't give are written as the shader's own (`uv` → `g_uv`, `res` → `u_resolution`, `mouse` → `u_mouse`, `time` → `u_time`; `t` stays, the block has it).
- **Simplify to Simple Expression** (right-click an Expression Block): offered when the block is just a Result line: no lines before it, no loop, no extra outputs, no helper functions, no slider or carry inputs, no picture inputs, a float/vec2/vec3/vec4 output, and a result that uses only its inputs and the free names (not the block's scratch `p`).

Both are one undo step.

## Type following, like Send

Before every compile (and so when a graph loads, a wire is made, replaced or removed), `syncSimpleExprTypes` sets each input socket's type to its wire's type and rebuilds the sockets from the node's params, the way `syncSendReceiveTypes` retypes a Send. It runs with the Send/Receive sync (each can feed the other), in the store's `compile()` and in `compileGraph`. Socket keys are stable (`in1`, `in2` …) and names are labels, so a rename never loses a wire.

## Saved as

```json
{ "type": "simpleExpr", "params": { "vars": [{ "key": "in1", "name": "a" }], "expr": "a", "outputType": "float" } }
```

## Example

**Simple Expression · rings and a blend** (`simpleExprBlend`, shown under the node in the node list): one expression turns a circle's distance into moving rings, another blends two colours by them with `mix(a, b, smoothstep(0.2, 0.8, c))`, its inputs typed vec3, vec3, float and vec2 by their wires. It isn't in an Examples folder (each holds its curated five); it opens from the node's *Used in*.

## Phone

The phone's node page shows the same card body with the input rows listed in it (name, type, ↑, bin), + Input, the Output type and the field.
