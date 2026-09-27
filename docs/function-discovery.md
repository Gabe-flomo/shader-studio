# Function discovery

Find the reusable functions hiding in your saved GLSL shaders and keep the
good ones in the Functions library, where they become Custom Function
presets you can drop into any graph.

Open it from the GLSL page: the search icon in the editor header
(**Discover functions in the saved shaders**). If the editor holds something
that isn't saved yet, it is scanned too, listed as *Current editor*.

## What counts as a reusable function

Every function definition in the scope is read (`src/glsl/discover.ts`),
then classified:

- **Level 0**: calls no other function in its file. A hash, a rotation, a
  palette. Self-contained; the safest to keep.
- **Level 1**: calls only level-0 functions. `noise()` that calls `hash()`.
  Saving it brings the helpers along, so the pair travels together.
- **Level n**: calls something of level n−1. `fbm()` over `noise()` over
  `hash()`.
- **Recursive** functions are marked and can't be saved (GLSL forbids
  recursion anyway).
- **Globals**: a function that reads a uniform, varying, sampler or mutable
  global its shader declares (anything other than `u_time`, `u_resolution`
  and `u_mouse`, which every Studio shader has) is not self-contained. It is
  hidden unless *Allow shader globals* is on, and even then it can't be saved
  as it is: a library function has nowhere to get that state from. Const
  globals don't count (they travel with it, below).
- **#defines and consts**: object-like macros and top-level `const`
  declarations a function or its helpers use (`PI`, `const float F3 = …`, a
  rotation matrix), and any macro or const those mention, are collected and
  prepended when it is saved: defines first, then consts, each in file order.
  A statement declaring several consts comes along whole. Function-like
  macros are left where they are.
- **Shadertoy uniforms**: a paste that reads `iTime`, `iResolution`,
  `iMouse`, `iFrame`, `iTimeDelta`, `iDate` or `iGlobalTime` without declaring
  them is still self-contained: the saved text rewrites them to the Studio
  names the same way the Shadertoy import does (`iTime` → `u_time`,
  `iResolution.xy` → `u_resolution`…). `iChannel0–3` and the other texture
  inputs have no Studio counterpart and count as globals. A shader that
  declares its own `uniform float iTime;` gets no rewrite: that is an ordinary
  global.

Byte-identical repeats across shaders (the same `hash()` pasted into ten
files) are shown once; the subtitle says how many were hidden. `main` and
`mainImage` are never offered.

## Scope and filters

- **Scope**: every saved shader, the shaders in chosen folders, or the
  shaders matching comma-separated search terms (name, note, folder or code).
- **Depends on**: Nothing (level 0), 1 level, or Any.
- **Returns**: float, vec2, vec3, vec4, any combination.
- **Parameters**: a count range, and a set of allowed types; a function
  passes when every parameter is one of them.
- **Name contains**.
- **Allow shader globals**, off by default.

## The list, the preview, and saving

Each match shows its signature, a level badge (`L0`, `L1`… or `rec`), a
*globals* badge when it reads its shader's state, and the shader it came
from. Click a row to preview it: the code with its `#define`s, consts and helpers
in file order, a name for the library, a comment (by default where it was
found and what it brings), **Show in file** (opens that shader in the editor
with the function selected) and **Keep**. Tick the ones to keep, or Select
all, then **Save N to Functions**.

Saving makes one Custom Function preset per function
(`saveCustomFnPreset` in the store): the node's inputs are the parameters,
its output the return type, its body the call, and its helper block the
defines, consts, dependencies and the function itself. They appear in the palette's
Functions section and in a Custom Function node's presets, like any preset
saved from a node. A function can't be saved when it returns something other
than float/vec2/vec3/vec4, takes a parameter type that can't be a socket
(int, bool, samplers, arrays), has `out` parameters (publish it as a Code
node instead), recurses, or reads globals.

## Roles and the live preview

Each parameter gets a guessed role (`src/glsl/roles.ts`): position, uv 0–1,
time, distance, colour, direction, normal, seed, angle, amount, number. The
guess comes from the name (`uv`, `t`, `d`…), how the body uses it
(`length(p)`, `sin(t * 3.0 + 1.0)`, `dot(p, vec2(12.9, 78.2))`) and what the
file passes to it at its call sites. The role picks what the preview feeds it
(UV into a position, Time into a time, a circle's distance into a distance, a
spread of colours into a colour, cell ids into a seed) and the return role
picks the paint (a distance as a signed field with rings, a colour as itself).
A guess with little behind it is shown with a `?`. Both the role and what
feeds the parameter can be changed beside the preview.

### Roles learn from your corrections

Changing a parameter's role is remembered (`src/glsl/roleMemory.ts`, this
browser's localStorage, key `shader-studio:discover:learned-roles`). Each
choice is kept by the parameter's type, its name and its *usage pattern*:
how the body uses it with the name taken out (`inside sin/cos with · ;
· × rate + phase`). The next time a function is looked at:

- the same name used the same way takes the choice outright (confidence 1);
- the same use under another name leans the guess towards the choice
  (and away from the role that was turned down) strongly enough to decide a
  close call;
- the same name used differently leans only a little, so a hash's `p` doesn't
  become a colour because a hue rotation's `p` was one.

Where a remembered choice decided the role, the parameter says **Learned from
your choice** with **Forget** beside it; under the roles, **Forget all**
clears every learned role. Roles never learned from a parameter of another
type.

## Thumbnails in the Functions library

Every Custom Function preset in the palette's Functions list has a small
rendered picture, and a larger one in the card that opens when it is
selected. Discovery saves the preview's choices with the preset (`preview`:
the bindings, the roles and the return role), so a saved function looks the
way it did when it was found. A preset saved from a node has none; its roles
are guessed the same way, from the helper its body calls when the body is a
plain call (`fbm(p)`), otherwise from the body. In a still picture time runs
across the square, left to right, so a function of time shows its range.

The pictures are rendered offscreen by the node-preview renderer
(`src/lib/fnThumbnails.ts`, `src/glsl/presetPreview.ts`), only when a row
scrolls into view, one per idle slot, and cached by content
(`thumbnailKey`: inputs, output, body, helpers, bindings, size; not the name,
comment or save time), so renaming keeps the picture and an edit makes a new
one. A preset that doesn't compile on its own keeps the function icon, with a
tooltip saying so.

## Functions on the Convert page

The Convert page lists the pasted shader's helper functions under
**Functions** (beside **Check** under the editor; **Fns** in the phone's pane
switcher), with the same list, preview, roles and saving as the modal. A
function already in the library is marked *saved*.

Converting also looks in the library: a call to a helper whose code (and the
code of everything it calls, spacing, comments and `#define`s aside) is the
same as a saved preset's becomes that preset's node, named and commented as
saved, with its arguments converted to nodes and wired in, instead of a
region that carries the whole call as code. The check lists these under
**From your Functions**. Only presets whose body is a plain call of their
inputs (what discovery saves) are matched.
