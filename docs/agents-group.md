# The Agents group: slime mold and particles built from nodes

A million tiny walkers on the GPU. Each one sniffs the trail ahead of it, turns toward the strongest smell, takes a step and leaves a little more trail. The trail spreads and fades. Veins, networks and rivers grow by themselves.

Or a million particles: forces push them (gravity, wind, curl noise, the mouse, a vortex, a field, the sound), Integrate moves them, and they live, fade and are born again. The Particles node's look, built from nodes you can open and rewire.

For a few thousand agents with flocking rules and predators on the Play page, use the **Agents layer** instead (docs/agents-layer.md). This is the Studio's node-built version, for a million.

## Start here

1. In the node browser, open **Generators → Simulation** and add a preset. It builds the whole setup next to your Output and wires it in.
   - **Slime mold**: walkers burst out of the middle as a fan of branching veins, then join up into a network that keeps reorganising.
   - **Particles**: the Particles node's embers, built from nodes: a ring streaming into curl currents, lit by four orbiting lights. The mouse pulls and stirs them.
   - **Curl smoke**: ink-like smoke rising from a small source and breaking into wisps.
   - **Sound burst**: a disc of glowing streaks that a shockwave blasts out on every beat (a silent stand-in beat until you give it real sound).
   - **Multi-species slime**: three colonies (coral, teal, violet) grow toward each other; each follows its own kind's trail and avoids the others', so they carve the picture into territories.
   - **Ants**: ants leave a nest, find three food piles, carry food home and lay a smell as they go; roads form from the nest to the food and bend round the rocks. Each ant remembers whether it carries food.
   - **Boids**: flocking through a field: every bird leaves its velocity in a blurred trail and steers to match the flow around it; flocks gather, wheel and stream past each other.
   - **Strands**: slime combed into long flowing filaments, drawn as ink on paper.
   - **Grow toward a picture**: slime feeds on a picture's bright parts and draws it in veins. A built-in moonlit picture; load your own into its Texture Input and set Yours to 1.
2. Press play. Double-click the Agents group to see the rule inside.
3. Every node a preset adds has a note (the speech-bubble tab on the card) saying what it does and what to try.

## The nodes

**Outside** (the top level of the graph):

| Node | What it does |
|---|---|
| **Agents** | The group. Its inside is the rule one walker follows every step. Count (64k to 4M), Species, Steps per frame, Seed, Pre-roll. Double-click it or press **Open rule ↗** to edit the rule. **↺ Start over** starts the simulation again. |
| **Emit** | Where walkers are born. **Fill** gives everyone a place at once (slime); **Rate** gives birth to a stream of them a second, each living for Life; **Keep full** gives everyone a place at once, at a random age, and each a new life the moment it dies (particles). Shapes: point, ring, disc, box, whole picture, **Picture** (where a texture wired into Picture is bright) and **Field** (where a chain wired into Where ƒ is above Threshold). Facing: random, inward, outward. **Speed ±** and **Spread** vary how they set off; **Burst** (a trigger) gives everyone a new life at once. **Species** says which kind they are (chain one Emit per species to give each colony its own place). |
| **Deposit** | Every walker leaves Amount of trail on the pixel it stands on, every step, into the Trail field it's wired to: in its own species' channel, or what Agent Output's Deposit says. **What: Velocity** leaves its velocity and a count instead, so the trail becomes a field of how the crowd moves (flocking). |
| **Trail field** | The trail. Each step it spreads (Diffuse) and fades (Half-life). **Amount** (0–1) goes into a palette or the Output; **Texture** goes back into the group for Sense, or into Glow, Blur or Sample (texture). Resolution: ½, ¼ or the full picture, or a fixed 512 / 1024 / 2048 rows for a look that doesn't change with the window. **Spread** 3×3 (the slime paper's) or a softer 5×5 blur. **Add** paints anything into the trail every step (food from a picture, a shape, noise); **Block** wipes it where it is 1 (walls nothing can smell through). |
| **Draw agents** | Draws the walkers themselves over the picture wired into Over, with the Particles node's looks: soft dots (**Points**), dots with its glow (**Glow**), short lines along their motion (**Streaks**), or dark ink on paper (**Ink**). Colour by species, speed, heading, age or **Agent** (the Colour its rule set), between Colour A and B or along one of the Particles palettes; **Lights** (up to four, orbiting or still) brighten the walkers near them and add halos. **Brightness of The crowd** keeps the cloud as bright at any count, as the Particles node does. |

**Inside the group** (only here):

| Node | What it does |
|---|---|
| **Agent Inputs** / **Agent Output** | This walker at the start and the end of the step. They're always there. Anything left unwired on Agent Output keeps the walker's value, so an empty group stands still. **+ Add Input** on Agent Inputs adds a port to the group (a number, a vector, or a texture such as the Trail). **Memory** (two numbers it keeps from step to step: an ant's "carrying food"), **Deposit** (how much trail it leaves in each channel) and **Colour** (its own colour, for Draw's Colour by Agent) give every walker state of its own. |
| **Sense** | Reads the trail (Texture) and/or any chain of nodes (Field ƒ) at three points: Distance ahead, Angle to the left, straight on and Angle to the right. |
| **Steer** | Turns by the readings. **Jones** is the slime-mold paper's rule; **Smooth** turns in proportion; **Away** runs from the strongest. Turn and Jitter. |
| **Move** | One step along the heading at Speed. At the edges: Wrap, Bounce or Slide. **Obstacle ƒ** takes a shape's distance: walkers turn back (or slide along it) instead of stepping in. |
| **By species** | One of four numbers by the walker's species. |

**Particles inside the group.** Forces each have an **Also** input: wire them in a row and they add up (Curl → Vortex → Attract), then into **Integrate**.

| Node | What it does |
|---|---|
| **Gravity** | A constant pull, down by default; point it up for smoke. |
| **Wind** | A steady wind along Angle, with gusts (the Particles node's). |
| **Curl noise** | Swirling currents that never bunch up (the Particles node's Turbulence): streams, threads and eddies. Size, Evolve. |
| **Attract / Repel** | Pulls toward the mouse, a point, or anything wired into Target (a hand, a null); negative Strength pushes away. Within Reach (like a hand) or Everywhere; Swirl stirs round it. |
| **Vortex** | Swirls round a centre, strongest at Reach (the Particles node's Swirl). |
| **Flow** | Pushes up a field wired into Field ƒ (any chain: noise, a shape's distance, a picture), or round its contours. |
| **Sound kick** | Sound as a force: **Shockwave** (a ring of pressure on every beat), **Wave** (rings as loud as the sound was), **Vibrate**, **Shake**. |
| **Integrate** | The total force becomes motion: velocity, Drag, Max speed, Mass, then the position. Edges: Free, Wrap, Bounce, Slide or Die. |
| **Age / Life** | Alive (0 when its life is up: Emit's Keep full brings it back), Age, Age 0–1 and Fade. |
| **Collide** | After Integrate: keeps walkers out of a shape (its distance into Shape ƒ); they slide round it. Bounce, Friction. |
| **Chladni** | After Integrate (or alone): sand on a vibrating plate gathers on its still lines. Square or round; N and M, or the sound, pick the figure. |

**Sound.** Sound kick and Chladni listen to **Sound from**: the **Level** slider (map Live audio or a track to it in Play), the **Mic**, or the Play page's **Audio engine** (its master or a track). **Beat** is a silent stand-in kick at a tempo while you build: it only moves numbers, and it is part of the simulation, so a recording matches the preview. Set it to 0 when real sound drives Level.

Any ordinary node can join the rule: noise to wobble the turn, a shape's distance into Sense's Field ƒ to avoid it, an Expression Block to reshape the readings (the preset's **Crowding** does this), Time, Audio Input, MIDI. Every unwired socket on the Agents nodes means "this walker", and every node that would read the pixel's position reads the walker's position instead.

What can't go inside, and why (the card says so):

- Nodes that read the previous frame (Echo, Previous Frame, the blurs, Bloom): a walker is not a pixel of the picture.
- Pass, another Agents group, Trail, Deposit, Emit, Draw agents, the Particles node, the Output: they are programs of their own.
- Scene Group, March Loop, GI March, Space Warp: a ray march per walker is too costly for now.
- Any node whose code reads screen derivatives or gl_FragCoord (found by reading the code, so new nodes are covered).

## Seeing inside: the eye and Show passes

- **The eye on a node inside the group** shows what an agent standing at each pixel would see: the node, and the inside nodes it depends on, with the agent at that pixel, facing right, species 1, remembering nothing. On Sense it shows the three sensors' readings (left, centre, right as red, green, blue) on this frame's trail; on Flow or Collide, their field. The simulation keeps running underneath.
- **Show passes** (the layers button on the canvas toolbar, when the graph has Pass nodes or an Agents group) rings every card in the colour of the program it runs in: a Pass (blue, purple…), the Agents group (amber: its inside, what is wired into its ports, Deposit, Trail and Draw) or the picture (green). A card compiled into two programs, such as a shape both the walkers and the picture read, is striped.

## The loop, and the "↺ last step" chip

The Trail's Texture goes back into the group it is filled by. That loop is the whole point: walkers follow the trail other walkers left. Inside the group the trail is always **as it was one step before**, and the wire carries a small **↺ last step** chip to say so. Anywhere else (a palette, a Pass) it is the trail as of this frame.

## Speed, steps and the clock

- One step is 1/60 s of simulated time. **Steps per frame** (default 2) is how many run each frame at 60 fps: the simulation's speed.
- When the GPU can't keep up, fewer steps run and the simulation falls behind the clock (the card says "running at ×0.6"); the number of walkers never changes by itself.
- The simulation depends only on the step number and the Seed. A recording or a rendered video runs exactly the steps up to each frame on its own copy, so it is the same every time on the same machine (and the preview's simulation is left alone). Across different GPUs it can differ by float rounding, which a chaotic system grows over time.
- Rewinding the clock (or ↺ on the Time node) starts the simulation over.

Measured on an M3 Pro (Chrome, ANGLE Metal), one million walkers, 2 steps a frame, after the network has formed: about **5.8 ms a frame** with the trail at half of a 1080p picture, **9.5 ms** with the preset's 1024-row trail at 1080p. Drawing the deposits (one point per walker per step) is most of it.

The P3 presets at one million walkers, 1080p: Multi-species slime 11.8 ms a frame, Grow toward a picture 10.3 ms, Strands 18 ms (ink streaks), Boids 15.7 ms and Ants 14 ms (both ship at 256k: 3.9 and 3.5 ms).

One million particles (the Particles preset), 2 steps a frame at 1080p: about **7 ms a frame**, of which the steps are 1.6 ms and the glowing draw the rest; Streaks (two vertices a particle) about 10 ms.

Steps per frame also sets the pace: one step is 1/60 s of simulated time, so 2 steps a frame runs the particles twice as fast as the Particles node does. Set it to 1 for the Particles node's own pace. Lifetimes, Drag and forces are in simulated seconds; Beat, Evolve and the lights follow the clock.

## Limits for now

- Up to 4 Agents groups and 4 Trail fields per graph; 4 species; 16 textures per program (each group counts its two state textures).
- Exported web pages don't run agents yet: Export warns, and the page draws the picture without them.
- Not yet: Sound from on the group itself, pinned sliders on the group card, 3D. See docs/agents-plan.md for the phases.
