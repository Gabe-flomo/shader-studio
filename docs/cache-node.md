# Cache and Cache Read

**Cache** (Texture tools) keeps the last frames of any texture on the GPU and reads them back by how long
ago. It does what TouchDesigner's Cache TOP does; **Cache Read** is its Cache Select TOP, and a **Delay map**
makes it a Time Machine TOP.

Wire anything with a Texture output into **Texture**: a Video Input (or the camera), Texture Input, Baked, a
Pass, a Shader Texture or a Data Texture.

## Uses

- **Time delay:** Delay 30 shows the picture half a second late (at 60 fps).
- **Freeze:** turn **Record** off; the frames it has stay.
- **Loop / scrub:** Record off, then wire an LFO or a Time (through Modulo) into **Delay** to play through
  the frozen frames, forwards, backwards or bouncing.
- **Staggered copies:** several **Cache Read** nodes off one Cache's **Cache** output, each at its own Delay:
  red now, green and blue from the past (example 15), trails of frames, a grid of moments.
- **Time Machine:** wire a 0–1 picture into **Delay map**. Each pixel is read `Delay + map × Map reach ×
  (Frames − 1)` frames back: a radial map bends motion outwards (example 16), a horizontal gradient is a
  slit-scan sweep, noise melts time.

## Settings

| Setting | What it does |
|---|---|
| Frames | 8, 16, 32 (default), 64 or 128 kept: the longest delay. |
| Frame size | Each frame's width: 128–512 px (256 by default). The height follows the source's shape. Lowered if the frames wouldn't fit a 4096 px texture. |
| Record | Off holds what is recorded. |
| Every | Records one frame every this many: a longer, steppier history in the same frames. |
| Delay | Frames back to read: 0 is the newest; past what is recorded it reads the oldest. A live slider and a socket. |
| Map reach | With a Delay map: how much of the cache a map value of 1 reaches back. |
| Smooth | Blends the two frames a fractional delay falls between. |

The card shows whether it is recording or held, the frames filled, the frame size and the memory, and
**Clear** forgets the frames.

## How it works

`lib/cache/engine.ts` records outside the shader:

1. After the Passes draw and before the picture, while the clock runs (Record on, every Every frames), the
   source is drawn into the next tile of the node's atlas: `Frames` tiles in an about-square grid, one
   8-bit sRGB render target (`u_cache_<node>`, bound through the store's node textures). Only that tile is
   drawn: no clear, a scissor to its rectangle. Paused, an empty cache still takes one frame.
2. The newest tile (`head`) and the number filled go to two floats on the material, `u_cache_<node>_head`
   and `_filled`, registered as live uniforms. The grid and frame count are defines (`_grid`, `_frames`),
   so a Cache Read finds them from the sampler's name.
3. `cache_read` (nodes/definitions/cache.ts) picks the tile `delay` back from head, wrapping round the ring,
   clamped to what is filled, read inside its tile so blending never bleeds into the next.

## Limits (v1)

- Web pages and video exports don't record yet (the export sees an empty cache).
- A Cache read inside a Pass program isn't fed its head; read it in the main picture.
- The source must be a texture: to cache the whole picture, draw it into a Pass first.

Code: `src/nodes/definitions/cache.ts`, `src/lib/cache/engine.ts`, `src/components/cache/CacheCardBody.tsx`.
Tests: `src/lib/cache/__tests__/cache.test.ts`.
