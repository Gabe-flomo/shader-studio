# The Agents layer

*Stage 1 of a general simulation engine. Built 28 Sep 2026.*

> For a million agents (slime mold, networks), use the Studio's **Agents group** instead: docs/agents-group.md.

An **Agents** layer holds many entities (200 by default, up to 5000 across
all groups) and moves them with a **stack of rules**. Each agent has a
position, a velocity, a heading, an age, an energy, a group and a seed of
its own. Every step, each agent adds up the steering of the rules that apply
to it, weighted, and moves. Flocks, n-body gravity, spring nets, predators
and prey and flow fields are all rule stacks; the **Preset** picker fills one
in.

**Where it lives.** Add layer → Particles & physics → **Agents**.

| Part | File |
|---|---|
| Simulation, rules, presets, drawing | `src/play/kit/agents.js` (prefix `ag`; types in `agents.d.ts`) |
| Stepped and drawn by | `src/play/kit/kit.js` (`drawAgentsLayer`, in draw order like particles) |
| Layer type, defaults, schema, controls | `AgentsLayer` in `src/types/playLayers.ts` |
| Editor | `src/components/play/layers/AgentsEditor.tsx` |
| Web exports | `agents.js` is in `KIT_SOURCES` (`src/play/exportHtml.ts`) |
| Examples | **Agents: boids** (`playBoids`), **Agents: predators and prey** (`playPredatorPrey`) |
| Tests | `src/play/__tests__/agents.test.ts` |

Units are the relationship layer's: positions in picture heights with x
scaled by the aspect (so distances are round on any canvas), speeds in
picture heights per second.

## Rules

Rules are an ordered list in the editor: add one from **+ Add a rule…**,
switch it off with its toggle, move it up or down, or remove it. A rule
folds to a one-line summary (open it to see its settings; the fold is
remembered per rule). Every rule's numbers are ordinary layer properties
(`r3_weight`, `r3_radius`…), so each can be a Play control and be mapped
from the mouse, MIDI, audio readers or anything else.

Every rule has **Applies to** (everyone, or one group) once the layer has
more than one group. Neighbour rules and group targets also have **Counts**
(or **Catches**): any group, their own, other groups, or one group.

| Rule | What it does | Numbers |
|---|---|---|
| **Seek** | Steer toward a target (see Targets) at a wanted speed. | Weight, Speed, Reach (0: any distance) |
| **Flee** | Steer away from a target within reach, harder the closer. | Weight, Speed, Reach |
| **Align** | Match neighbours' velocity (boids). | Weight, Radius |
| **Cohere** | Steer toward neighbours' centre (boids). | Weight, Radius |
| **Separate** | Push away from neighbours closer than the radius (boids). | Weight, Radius |
| **Wander** | A slow random walk: hash noise of the agent's seed and the simulated clock. | Weight, Rate |
| **Orbit** | Circle a target at a distance, clockwise or anticlockwise. | Weight, Distance, Speed |
| **Gravity** | *All pairs*: n-body, softened, with the pull scaled by the count so it doesn't grow with it. *Toward a target*: everyone falls toward one point. | Strength, Softening, Reach (pairs) |
| **Springs** | Links built from where agents are when the rule starts: *Nearest* k within a radius, a *Ring* per group, or a *Grid* (with diagonals, so it doesn't fold flat). Rest length is the built length times Rest. | Stiffness, Damping, Rest, Link within, Anchor |
| **Field** | Follow a vector field: *Curl noise* (swirling lanes), *Vortex* round a target, *Wind* (one direction), or the picture: *Climb* toward bright / *Descend* toward dark in a channel (the relationship layer's 8-sample gradient on the kit's 64 × 36 grid). | Weight, Speed, Swirl size, Evolve, Direction, Looks |
| **Boundary** | At the picture's edge, or a shape's (**Inside**): *Wrap*, *Bounce*, *Die*, or *Steer away* inside a margin. | Weight (bounce: how much speed a bounce keeps), Margin |
| **Drag** | Lose speed every second. | Drag |
| **Max speed** | Cap the speed; an optional minimum nudges slow agents along their heading, so a flock never stalls. | Max, Min |
| **Catch** | Agents of this group catch the nearest live agent of the target group within the radius: the caught one dies, the catcher gains energy, and the layer's **Catch** reading pulses. One catch per catcher per step. | Radius, Energy gain |

Steering is added up as accelerations (behaviour rules steer toward a
wanted velocity, Reynolds-style; physics rules add forces), then integrated
with **semi-implicit Euler**: velocity first (then Drag, then Max speed),
then position with the new velocity. After the move come the position
rules (Boundary), catches, energy and respawns, in that order.

### Targets

Seek, Flee, Orbit, Gravity (toward a target) and Field (vortex) aim at:

- **Point**: a fixed point; its X and Y are rule numbers (`r2_x`, `r2_y`), so they can be mapped or driven by a null.
- **Pointer**: the mouse or a touch, while it is over the picture (otherwise the rule rests).
- **Layer**: another layer. Particles, bodies, another Agents layer and a Relationship's members count one by one (Seek and Flee take the nearest; Orbit and Gravity the nearest too); anything else with a position (a null, a shape, text…) is one point.
- **Group**: in this layer. Seek and Flee take the **nearest agent** of the group within Reach (predators chasing prey); Orbit, Gravity and Vortex take the group's **centre**.

### Groups and energy

One to four groups, each with a **count**, **colour**, **size**, **energy
drain** and **respawn** rate. Energy starts at 1; a group with a drain loses
it every second and an agent dies at 0; a Catch gives some back (capped at
3). **Respawn** brings a group's dead back at that many per second, where
the Start setting puts them (at random along a grid or ring). Changing a
count, the groups, the start, its spread, the start speed, spin or the seed
starts the layer over.

## Presets

The **Preset** picker fills the rule stack (and the groups, start and look);
edit anything afterwards (the picker then says Custom). Picking one starts
over.

| Preset | Setup |
|---|---|
| **Boids** | 300 agents: Align, Cohere, Separate, a little Wander, Max speed with a minimum, Boundary wrap. Arrows coloured by heading, a short trail. |
| **Gravity** | 300 bodies from a spinning disc, all-pairs Gravity (softened), Max speed, Boundary bounce. Dots coloured by speed, long trails. |
| **Spring net** | 400 agents on a grid, grid Springs with an Anchor, Seek the pointer (within 0.2), Drag, Boundary bounce. The springs are drawn. |
| **Predator–prey** | Prey (240, group 1): align and cohere with prey, separate from everyone, flee group 2, wander; respawn 4/s. Predators (6, group 2): seek the nearest prey, keep apart from each other, catch prey (gaining energy), drain 0.08/s, respawn 0.25/s. Max speed per group, Boundary steer. |
| **Flow field** | 1200 agents carried by curl noise, Max speed, Boundary wrap, long trails. |

## Look

- **Draw**: *Dots* (per-group size), *Arrows* (triangles pointing along the heading) or *Goo*: the particles layer's metaballs, reused from `particle-sim.js` (`gooSplat` / `gooBlit`, the same field and cut as particles' Goo), with Goo blend, threshold and edge.
- **Colour**: by group, or the palette along speed, age, energy or heading. Agents are batched by colour (one path per group or per palette band), so a few thousand dots are a handful of fills.
- **Trail**: like particles, faded by time rather than frames.
- **Links**: the Springs rule's links, or lines between neighbours within **Link within** (fading with distance, four bands, at most six per agent).
- Opacity and **Blend** as on every layer; mattes and masks work too.

## Readings (sources)

Mapped with Map…, listed as **Layer sensor** in the source picker, usable in
conditions through a mapping. All 0..1:

| Reading | What it is |
|---|---|
| **Alive** | The share of the layer's agents alive |
| **Speed** | Mean speed against the first Max speed rule's cap (else 1 picture height per second) |
| **Spread** | How spread out the live agents are (the particles layer's measure) |
| **Centre X**, **Centre Y** | The live agents' centroid |
| **Group 1–4 alive** | The share of each group alive |
| **Catch** | 1 on a catch, fading over a quarter of a second |
| **Catches** | The count so far, 1 at twenty |
| **Distance** | To any other anchor, like every positioned layer |

The layer's anchor (proximity triggers, distances) is its live agents'
centroid.

### Agents as elements

Other layers can follow individual agents:

- A **Null** can follow **an agent**: pick the Agents layer and the agent's number (while it is dead, the live agents' centre).
- A **Cloner** arranged on **Points** can use an Agents layer: one copy per agent (up to 400).
- A Granulator's **Grains from** can read an Agents layer: position, velocity, age (over ten seconds) and energy.
- Another Agents layer's rules can target this one's agents (Layer target), and this layer's rules can target particles, bodies, relationship members and other agents.

## Determinism

- The simulation advances in **fixed steps of 1/60 s** of simulated time. Each frame adds its dt times **Speed** to an accumulator and takes as many whole steps as fit (at most 8 a frame; a stalled frame drops the rest rather than freezing the page). **Substeps** split each step into 2–4 smaller ones for stiff springs and close gravity passes.
- Every random choice (start places and speeds, per-agent seeds, respawns, Scatter) comes from the layer's source in a fixed order. With **Seed** set (the default is 1) that is the layer's own; with Seed 0 it is the kit's session source, which a take seeds, so a take's offline render replays the run.
- Wander is a hash noise of the agent's seed and the simulated clock; neighbour queries list agents in index order (a stable counting sort into the hash), and catches go in index order, so nothing depends on timing or object order.
- So the same seed and frame times give identical frames in the editor, in takes and offline renders, and in website exports. `agents.test.ts` checks two runs against each other, 60/30/120 Hz against each other (the same 60 steps), and the web export's inlined kit against the app's kit frame for frame.

## Limits and cost

- The **spatial hash** is a uniform grid (at most 256 cells a side) at the widest neighbour radius in use, rebuilt each step by a counting sort. Neighbour rules cost about (agents × neighbours in reach) per step. In Node, 300 boids take ~0.3 ms a frame and 3000 boids ~7 ms; drawing is separate (dots are batched per colour).
- **Gravity (all pairs)** is O(n²) up to 1200 agents; above that only pairs within 0.4 picture heights pull (through the hash), unless Reach is set.
- Neighbours are not looked for across a wrapped edge (a flock crossing the edge sees fewer neighbours for a moment).
- A rule list holds 24 rules; counts total 5000.
- Springs are built once from where the agents are (when the rule starts, the layer starts over, or its mode/links change); Rest scales those lengths.
- Takes don't record agent positions: they replay by re-simulating from the seed, which is exact as long as the inputs (pointer, controls) are the recorded ones.
- Not a Relationship member itself (a relationship moves layers with an x and a y); a relationship's members can be targets, and a null following an agent can be a member.

## The file

```json
{
  "id": "flock", "kind": "agents", "label": "Flock", "visible": true, "toShader": true,
  "preset": "boids", "groups": 1, "seed": 3, "spawn": "random", "spawnRadius": 0.3, "startSpeed": 0.3, "spin": 0, "speed": 1, "substeps": 1,
  "rules": [
    { "id": "r1", "type": "align", "on": true, "group": 0, "targetGroup": 0, "mode": "", "target": "point", "targetId": "", "channel": "brightness", "k": 3 },
    { "id": "r2", "type": "boundary", "on": true, "group": 0, "targetGroup": 0, "mode": "wrap", "target": "point", "targetId": "", "channel": "brightness", "k": 3 }
  ],
  "r1_weight": 1, "r1_radius": 0.08, "r2_weight": 2, "r2_margin": 0.08, "r2_x": 0.5, "r2_y": 0.5,
  "g1_count": 320, "g1_color": [0.8, 0.95, 1], "g1_size": 3, "g1_drain": 0, "g1_respawn": 0,
  "look": "sprites", "colourBy": "heading", "palette": 1, "colourSpan": 0.6, "trail": 0.4,
  "links": "off", "linkRadius": 0.06, "linkOpacity": 0.35, "linkWidth": 1, "linkColor": [1, 1, 1],
  "gooBlend": 2.5, "gooThreshold": 0.5, "gooSoft": 0.2, "opacity": 1, "blend": "normal"
}
```

Rules with an unknown type or a bad id are dropped on load; a rule's numbers
fall back to its type's defaults. Deleting a layer a rule aims at leaves the
rule idle (no target); deleting an Agents layer stops nulls following it.

## Stage 2 and 3, later

Described here, not built.

### Stage 2: behaviour as a node graph, compiled to JavaScript per entity

The rule stack is a fixed menu of behaviours. Stage 2 lets people build
their own: a **behaviour graph** in the node editor, a second graph kind
next to the shader graph, whose nodes run **per agent per step on the CPU**
instead of per pixel on the GPU.

- **Inputs** are the agent's state (position, velocity, heading, age, energy, group, seed), the step (dt, the simulated clock), queries (neighbours within a radius → count, centroid, mean velocity, nearest; the picture under it; a target's position), and the layer's controls.
- **Nodes** are the math the shader graph already has (vectors, noise, remap, conditions) plus steering blocks (seek, flee, arrive, the boids three) and state blocks (set energy, die, spawn a child, change group, send a signal).
- **Outputs**: an acceleration (added to the rule stack's, or instead of it), and state writes.
- **Compilation**: the graph compiles to one plain JavaScript function `(agent, ctx) → void` (the way the shader graph compiles to GLSL), built once per edit with `new Function`, so the per-agent cost is a normal function call. The compiled source ships in the file and in web exports, so exports run it without the editor.
- **Determinism** carries over: the function sees the same fixed step, the layer's seeded random source and the neighbour lists in index order; writes are double-buffered (read last step's state, write this step's) so order within a step doesn't matter.
- The existing rules become built-in nodes, so a preset opens as a graph you can take apart.

### Stage 3: GPU ping-pong simulations for big counts

For hundreds of thousands of agents the CPU is the wall. Stage 3 moves the
state into **float textures** (position and velocity, a texel per agent)
and steps it with fragment shaders ping-ponging between two render targets
(the runtime already runs ping-pong targets for feedback and echo, and GPU
particle systems):

- Rules compile to GLSL (from the same behaviour graph where the nodes allow it).
- Neighbour queries use a GPU grid: agents sorted into cells each step (a bitonic or counting sort in passes), then each agent scans its cells; or a density texture for cheap cohesion and separation.
- Drawing reads the position texture in the vertex shader (instanced points or sprites), so nothing comes back to the CPU. Readings (count, centroid, spread) come from a small reduction pass read back a frame late.
- Determinism holds on one GPU and driver (the same shaders, the same fixed step), but floating-point results can differ between GPUs, so exports would promise "the same kind of motion", not bit-identical frames; takes would keep recording the CPU layer's frames, or render on the machine that recorded them.
- The layer would pick the backend by count and by what the rules need: CPU for the exact, interactive few thousand; GPU past that.
