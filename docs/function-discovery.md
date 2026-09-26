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
  globals don't count.
- **#defines**: object-like macros a function uses (`PI`, a tuning constant,
  and any macro those mention) are collected and prepended when it is saved.
  Function-like macros are left where they are.

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
from. Click a row to preview it: the code with its `#define`s and helpers
in file order, a name for the library, a comment (by default where it was
found and what it brings), **Show in file** (opens that shader in the editor
with the function selected) and **Keep**. Tick the ones to keep, or Select
all, then **Save N to Functions**.

Saving makes one Custom Function preset per function
(`saveCustomFnPreset` in the store): the node's inputs are the parameters,
its output the return type, its body the call, and its helper block the
defines, dependencies and the function itself. They appear in the palette's
Functions section and in a Custom Function node's presets, like any preset
saved from a node. A function can't be saved when it returns something other
than float/vec2/vec3/vec4, takes a parameter type that can't be a socket
(int, bool, samplers, arrays), has `out` parameters (publish it as a Code
node instead), recurses, or reads globals.
