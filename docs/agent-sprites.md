# Sprites: pictures as agents and particles

Draw agents has a **Sprite** input. Wire a Pass's **Texture** into it and every walker is drawn as that
picture instead of a soft dot, in 2D and in 3D (Points style). Anything that is a Pass works: a picture
or video through a Pass, a Shader Texture (a shader as the sprite), a Feedback (texture), a Data Texture,
a Render Targets target.

- **Size** sets how big each sprite is, in pixels (points top out at 64 px).
- **Sprite colours:** **Own colours** keeps the picture's colours, brightened by Brightness; **Tinted**
  multiplies it by each walker's colour (Colour by, the palette), like the dots.
- Transparent parts of the picture (alpha 0) are cut out.
- Sprites add up like the dots' light, so many overlapping sprites brighten toward white; use fewer
  walkers or lower Brightness for a picture-like look.

A texture straight from a Texture Input or Video Input isn't enough on its own: the compiler asks for a
Pass in between ("Draw agents' Sprite takes a Pass's Texture"). The Pass keeps the picture on the GPU
for the agents engine, and it is drawn even when nothing else reads it.

## How it works

- `compiler/passGraph.ts`: the Sprite's Pass joins the live set when its Draw agents is live, and its
  slug is written on the draw (`AgentDrawProgram.sprite`).
- `lib/agentRunner.ts` `bindSprite`: each draw hands the Pass's current texture (`u_pass_<slug>`) to
  the point shader.
- The point shader (`play/kit/gpuParticles.js` `GP_DRAW_FRAG`, shared with the Particles node) samples
  `u_sprite` at `gl_PointCoord` when `u_useSprite` is 1, otherwise draws the soft dot as before.

Not yet: exported web pages draw dots (the page doesn't bind the sprite), the Agents builder has no
Sprite control (wire it on the Draw agents card), and the Particles node has no Sprite input.
