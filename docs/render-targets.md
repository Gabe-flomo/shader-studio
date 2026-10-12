# Render Targets (MRT)

Several textures from **one draw**. A Render Targets node has up to four targets, each with:

- an **input**: float, vec2, vec3 or vec4 (the channels it leaves are 0, alpha 1);
- a **precision**: full float, half or 8-bit;
- a **read**: exact (one texel, never blended: data) or smooth (blended: pictures).

All targets share one size (**Size**) and edge rule (**Edges**).

Each target has two outputs: its **texture**, and the texture **as it was last frame**. Read them with
Read channels, Sample (texture), or any texture node.

## Why one draw

Everything wired into the node is worked out once per pixel and written to every target at once.
With separate Passes or Data Textures, the shared work (reading last frame, a simulation step) runs
once per texture. The node counts as **one Pass** toward the 8-Pass limit.

The classic use is a simulation that keeps more than four numbers per texel: position and velocity in
one target, a colour or an age in another, each worked out from the others' last frame.

## Keeping state

A read of a target's last-frame output in something that feeds the node is a frame delay, not a loop
(`compiler/graphLoops.ts`). Reading a target's *this-frame* texture in what feeds the node is a loop
and is refused.

The targets start at 0 and ↺ clears them, so a step can tell an empty texel from a stored one.

**Example: Texture tools 12 · Render Targets: motion and paint in one draw.** Target 1, `state`, is a
vec4 of position and velocity at full float, read exactly. Target 2, `paint`, is a colour at half
float, read smoothly. Step works out the new motion from last frame's state; Paint colours it by
direction from Step's result, in the same draw, and fades last frame's paint. A Pull control moves
the swirl.

## How it compiles

`compiler/renderTargetsExpand.ts` opens each node into

```
renderTargetsPack (<id>__pack) ──▶ Pass (the node's id, __extra: targets 2…4)
```

- The pack turns each target's input into a vec4: target 1 as the Pass's Color and Alpha, the rest as
  `mrt<k>`.
- The Pass's sink writes target 1 to `gl_FragColor` (three.js's location 0) and target k + 1 to
  `layout(location = k) out highp vec4 pc_mrt<k>`.
- The Pass keeps the node's id and output keys: `texture` / `previous` for target 1, `texture<k>` /
  `previous<k>` for the others, sampled as `u_pass_<slug>_<k>` / `u_passprev_<slug>_<k>`.

Any Pass can carry extra targets (`__extra` on its params, `extra` on its PassProgram); only this node
makes them.

**Runner** (`lib/passRunner.ts`): a `WebGLRenderTarget` with `count` = 1 + extras, each texture with
its own type and filter. three.js sets the draw buffers. Binding (`bindCur` / `bindPrev`) sets every
target's sampler, and ping-pong swaps whole targets.

**Exported pages** (`play/kit/passHost.js`): one framebuffer with a colour attachment per target and
`gl.drawBuffers`. `webPasses` gives each extra target's settings and sampler names.

**Builder previews** draw only target 1.

## Not done

- The card's picture shows target 1 only.
- No pop-out window or view modes like the Data Texture's yet.
