# The Agents group: slime mold built from nodes

A million tiny walkers on the GPU. Each one sniffs the trail ahead of it, turns toward the strongest smell, takes a step and leaves a little more trail. The trail spreads and fades. Veins, networks and rivers grow by themselves.

For a few thousand agents with flocking rules and predators on the Play page, use the **Agents layer** instead (docs/agents-layer.md). This is the Studio's node-built version, for a million.

## Start here

1. In the node browser, open **Generators → Simulation** and add **Slime mold (preset)**. It builds the whole setup next to your Output and wires it in.
2. Press play. Walkers burst out of the middle as a fan of branching veins, then join up into a network that keeps reorganising.
3. Every node the preset adds has a note (the speech-bubble tab on the card) saying what it does and what to try.

## The nodes

**Outside** (the top level of the graph):

| Node | What it does |
|---|---|
| **Agents** | The group. Its inside is the rule one walker follows every step. Count (64k to 4M), Species, Steps per frame, Seed, Pre-roll. Double-click it or press **Open rule ↗** to edit the rule. **↺ Start over** starts the simulation again. |
| **Emit** | Where walkers are born. **Fill** gives everyone a place at once (slime); **Rate** gives birth to a stream of them a second, each living for Life. Shapes: point, ring, disc, box, whole picture. Facing: random, inward, outward. |
| **Deposit** | Every walker leaves Amount of trail on the pixel it stands on, every step, into the Trail field it's wired to. |
| **Trail field** | The trail. Each step it spreads (Diffuse) and fades (Half-life). **Amount** (0–1) goes into a palette or the Output; **Texture** goes back into the group for Sense, or into Glow, Blur or Sample (texture). Resolution: ½, ¼ or the full picture, or a fixed 512 / 1024 / 2048 rows for a look that doesn't change with the window. |
| **Draw agents** | Draws the walkers themselves as soft points (Points) or with the Particles node's glow (Glow), coloured by species, speed or heading, over the picture wired into Over. |

**Inside the group** (only here):

| Node | What it does |
|---|---|
| **Agent Inputs** / **Agent Output** | This walker at the start and the end of the step. They're always there. Anything left unwired on Agent Output keeps the walker's value, so an empty group stands still. **+ Add Input** on Agent Inputs adds a port to the group (a number, a vector, or a texture such as the Trail). |
| **Sense** | Reads the trail (Texture) and/or any chain of nodes (Field ƒ) at three points: Distance ahead, Angle to the left, straight on and Angle to the right. |
| **Steer** | Turns by the readings. **Jones** is the slime-mold paper's rule; **Smooth** turns in proportion; **Away** runs from the strongest. Turn and Jitter. |
| **Move** | One step along the heading at Speed. At the edges: Wrap, Bounce or Slide. |
| **By species** | One of four numbers by the walker's species. |

Any ordinary node can join the rule: noise to wobble the turn, a shape's distance into Sense's Field ƒ to avoid it, an Expression Block to reshape the readings (the preset's **Crowding** does this), Time, Audio Input, MIDI. Every unwired socket on the Agents nodes means "this walker", and every node that would read the pixel's position reads the walker's position instead.

What can't go inside, and why (the card says so):

- Nodes that read the previous frame (Echo, Previous Frame, the blurs, Bloom): a walker is not a pixel of the picture.
- Pass, another Agents group, Trail, Deposit, Emit, Draw agents, the Particles node, the Output: they are programs of their own.
- Scene Group, March Loop, GI March, Space Warp: a ray march per walker is too costly for now.
- Any node whose code reads screen derivatives or gl_FragCoord (found by reading the code, so new nodes are covered).

## The loop, and the "↺ last step" chip

The Trail's Texture goes back into the group it is filled by. That loop is the whole point: walkers follow the trail other walkers left. Inside the group the trail is always **as it was one step before**, and the wire carries a small **↺ last step** chip to say so. Anywhere else (a palette, a Pass) it is the trail as of this frame.

## Speed, steps and the clock

- One step is 1/60 s of simulated time. **Steps per frame** (default 2) is how many run each frame at 60 fps: the simulation's speed.
- When the GPU can't keep up, fewer steps run and the simulation falls behind the clock (the card says "running at ×0.6"); the number of walkers never changes by itself.
- The simulation depends only on the step number and the Seed. A recording or a rendered video runs exactly the steps up to each frame on its own copy, so it is the same every time on the same machine (and the preview's simulation is left alone). Across different GPUs it can differ by float rounding, which a chaotic system grows over time.
- Rewinding the clock (or ↺ on the Time node) starts the simulation over.

Measured on an M3 Pro (Chrome, ANGLE Metal), one million walkers, 2 steps a frame, after the network has formed: about **5.8 ms a frame** with the trail at half of a 1080p picture, **9.5 ms** with the preset's 1024-row trail at 1080p. Drawing the deposits (one point per walker per step) is most of it.

## Limits for now

- Up to 4 Agents groups and 4 Trail fields per graph; 4 species; 16 textures per program (each group counts its two state textures).
- Exported web pages don't run agents yet: Export warns, and the page draws the picture without them.
- Not yet: forces and particles (Gravity, Curl, Attract…, Integrate), memory, per-walker deposit amounts and colours, food and walls on the trail (Add ƒ / Block ƒ), obstacles on Move, Emit from a picture, Streaks and Ink in Draw agents, sound, pinned sliders on the group card, the eye preview inside the group, 3D. See docs/agents-plan.md for the phases.
