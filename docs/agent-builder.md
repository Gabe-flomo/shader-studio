# Agent Builder

The Agent Builder makes and edits an Agents group's walkers with pictures instead of When … Do … lines. It follows the field guide's Part 2: one step is **Sense → Steer → Move → Deposit**, after the walkers are **born**. The plan and its phases are in `docs/agent-builder-redesign-plan.md`. The rules underneath are in `docs/agent-rules.md`.

## Ways in

- **Builders → Agent Builder**, the canvas menu's Builders, or the Do… bar's "new agent rules": the start page. Nothing is added until you pick a kind.
- **Edit rules ↗** on a rules group's card, or a double-click on its title, opens the builder on that group, for every kind (trail followers, ants, particles, flocks, crowds, orbiters).
- **"new 3d agents"** adds the 3D slime setup and opens it in the builder.
- The rules editor (`AgentRulesModal`) is still there, for advanced rules. It opens from the builder's top bar (`{}`, "All rules") and from the Advanced rules card.

## Start page: what are you making?

The start page shows five cards, each with a small moving picture: **Trail followers** (slime, ants, veins), **Particles**, **Flocks**, **Crowds** and **Orbiters**. **Make it in 2D | 3D** sits above them. A card adds its setup to the graph, wired to the Output, as an undo step of its own (the first undo after an edit takes back only that edit):

| Card | Rule set kind | 2D setup | 3D template |
|---|---|---|---|
| Trail followers | trail | the rules starter with the Slime mold (the example's Emit, Deposit 4 and 1024-row trail) | 3D slime |
| Particles | particles | the Spark fountain example's own setup (its Emit, Draw agents and palette) | 3D curl smoke |
| Flocks | flock | the Boids example's setup | 3D flock |
| Crowds | crowd | the Crowd example's setup (two kinds walking opposite ways) | the 3D flock's setup with the crowd's rules, rescaled |
| Orbiters | swarm | the Swarm example's setup | Orbiters in 3D |

Crowds have a card of their own but the Flocks sections. A crowd is a flock with somewhere to go (Head for) that slows in a jam. What you make looks different (people in lanes, not birds) and starts from a different setup, so it gets its own picture and presets.

**Back** (top left) on a group made from the start page takes it away again and returns to the start page. Undo brings it back. **Add to graph** keeps it: it is already live in the graph. On a group that was already there, the button reads **Done**.

## The layout (shared builder shell)

`components/builders/studio/StudioShell.tsx` is the layout every builder will share:

- **Top bar:** Back, name, kind, panel toggles, **2D | 3D**, the builder's own buttons, and Add to graph / Done.
- **Left nav:** the kinds of walker as chips, and the sections. Each section shows a one-line summary.
- **Centre:** the live viewport.
- **Right inspector:** the selected section's card.
- **Bottom:** the presets strip.

The side panels and the strip fold from the top bar (⌘[ and ⌘] fold the side panels), and the choice is remembered (`builder:agent-builder:studio:*`). Under 1100 px the side panels are drawers over the viewport that start closed. On a phone the window fills the screen. Esc closes the builder when it is the top dialog.

### The live viewport

`LiveViewport.tsx` shows the main preview's own frames: the real result, with the simulation, trail and palette. `lib/previewMirror.ts` passes each frame from ShaderCanvas while it is still in the drawing buffer, and nothing is copied while no builder is open.

The builder doesn't pause the main preview (`previewHold.ts`) as the explain view does, because the agents' simulation only runs in the main preview's pipeline. The main canvas keeps drawing under the window, and the builder copies its frames.

If no frame arrives (the preview is hidden in this layout), the viewport says so.

## Sections and cards (Trail followers)

Only the selected section's card is open. The others are their summaries in the nav, and Senses is selected first. Each card has:

- a picture;
- a plain name, with a hint when you hover over it;
- an on/off switch where the behaviour can be off;
- two or three sliders (the app's RulerSlider);
- a folded **More**;
- **Learn more**, the field guide's paragraph in short.

| Section | Settings | Writes |
|---|---|---|
| Born | Where (shape), Size, How many; More: Facing, Births | the group's Emit (shape, size, heading, mode) and the group's Count |
| Senses (switch) | How far ahead, How wide, Smells (chips), Avoid it | the rule set's sensors; a Turn toward a trail (its channel, `away`) |
| Turning | How sharply; Wobble (its own switch) | that Turn's degrees; a Wander |
| Moving | Speed, At the edges (Wrap / Bounce / Slide) | the species' speed; the rule set's edges |
| Trail (switch) | Leaves, Fades, Spreads; More: Lays (chips) | a Leave trail's amount and channel; the Trail field's Half-life and Diffuse |
| Advanced rules | each rule the cards can't show, as a sentence | opens the rules editor |

Born, Turning and Moving have no on/off switch, because a walker is always born, turns and moves.

### Cards are the same rule set

`src/agentBuilder/cards.ts` reads the cards from the group's rule set and writes them back. So `generate.ts` makes the same nodes, and **Open as nodes**, Play and web export work as before.

- A card is the first matching action in an "always" rule: no conditions, no Stop after this rule.
- Anything else is an **Advanced rule**: conditions, states, memory, a second Turn, a trail that fades with Memory, and so on.
- An old rule set opens as it is. Editing a card changes its action in place.
- Only switching a card off or on moves that action into a rule of its own, so that the rule's `off` carries the switch.
- Reading the cards and writing back the same values leaves every template's rule set, and its generated nodes, unchanged (tested).

Edits apply live, a quarter of a second after you stop, as one undo step per burst, as in the rules editor.

## Kinds of walker

The left panel starts with the **kinds** as colour chips, up to four. Each kind is a species of the rule set, with its own cards:

- **Pick** a chip to edit its cards. The viewport lights that kind: the picture dims and only its walkers are drawn over it, as bright dots in its colour (`SpeciesSpotlight.tsx`). The runner draws them every other frame and reads them back without a stall (`lib/agentRunner.ts drawSpotlights`); in 3D it draws them through the group's Draw agents camera. "Showing … only ×" switches it off, as does picking a section.
- **+ Add a kind** copies the picked kind (its cards and speed) with the next name and a colour of its own. The walkers start over, so the births share them out among the kinds.
- **Rename** in place: double-click the chip, or use the pencil under the chips.
- **Colour:** the swatch under the chips (the kind's first state colour, which Colour by State draws).
- **Remove:** the bin (one kind always stays). Conditions that name a later kind ("near Predators' trail") follow it.

The model is in `src/agentBuilder/behaviours.ts` (`addSpecies`, `renameSpecies`, `setSpeciesColour`, `removeSpecies`).

## Sections for each kind

| Kind | Sections |
|---|---|
| Trail followers, Ants | Born · Senses · Turning · Moving · Trail |
| Particles | Born · Forces · Moving · Life · Look |
| Flocks, Crowds | Born · Neighbours · Turning · Moving |
| Orbiters | Born · Orbit · Neighbours · Moving |

Advanced rules is added under them when a kind has rules the cards can't show.

### Particles (field guide 2.9)

- **Forces:**
  - Gravity: Strength, Direction.
  - Wind: Strength, Direction, in gusts.
  - Curl flow: Strength, Eddies; More: Changes.
  - Attract / repel: Pull (negative pushes), toward A point or The mouse, Across, Up.
  - Follow a field: a vector field you pick, combine or write (below).
  - Drag.

  They run in order: drag the handle to reorder.
- **Moving:** Speed, At the edges.
- **Life:** Lives for (the Emit's Life), Fade with age, and Dies, whose slider is its "only when: older than".
- **Look:** Draw agents' Style (Dots, Glow, Streaks, Ink), Size, Brightness, and the kind's colour.
- **Born** has More → Shot out at (the Emit's Speed).

### Flocks and crowds (Reynolds' boids, 2.2)

- **Neighbours:** View radius and Max neighbours (the rule set's `neighbours`).
- **Turning:**
  - Keep apart (separation), Match heading (alignment), Stay together (cohesion), Avoid edges, Wander.
  - Crowds also have Head for (a point, the centre or the mouse) and Slow in a crowd.
  - Each has How hard (° a step). The neighbour ones have More → Reads (any kind, its kind, others) and Reach.
  - They run in order: drag to reorder.
- **Moving:** Speed, At the edges.

### Orbiters

- **Orbit:** Round (Centre, A point, Mouse), Radius, Way round, How hard; Wander.
- **Neighbours:** View radius, Max neighbours, and Keep apart / Stay together / Match heading. It is dimmed while they are unused.
- **Moving.** The swarm's packed / circling state rules are Advanced rules.

## Cards: the rule set underneath

`src/agentBuilder/behaviours.ts` maps cards to rules for every kind; `cards.ts` keeps the trail followers' phase-1 view on top of it.

- A card is one action of a rule the cards can read: no Stop after this rule, and at most one condition, one that an "only when" can say. Anything else is an Advanced rule.
- Cards of the same kind can repeat where it makes sense (two gravities, the crowd's two Keep aparts). Elsewhere the first is the card and the rest are Advanced.
- Editing a card changes its action in place.
- Switching a card off, giving it an "only when", or dragging it moves its action into a rule of its own. Its rule is split round it, and each piece keeps the conditions and the switch, so everything still runs in the same order.
- Reading the cards and writing back the same values leaves every template of every kind (2D and 3D) and every preset unchanged, and its generated nodes identical (tested).

## "Only when…"

Each card has an optional **Only when…** line. "+ Only when…" opens a picker:

- a neighbour is near (more than N within its view; any kind, its kind, others);
- it smells … above / below …;
- inside / outside a shape: a circle or a box (Across, Up, Radius). This is a new rule condition, `shape`, until phase 3's Where picker;
- older / younger than … s;
- by chance … % a second;
- in / not in state ….

Once picked, it is a small chip ("only when · older than 2 s") with its settings folded under it, and × makes the card always act again. It is the card's rule's condition. Pointing at a card with an "only when" draws where it applies: a shape is drawn on the picture with the rest shaded, and other conditions are a badge at the top of the viewport.

## Dragging cards

In sections where order matters (Forces, Turning, Orbit, Orbiters' Neighbours) each card has a grip. Drag it to another place, or press ↑ / ↓ on it. The card's action moves into a rule of its own just before (or after) the card it is dropped on, and a rule shared with other cards is split there (`moveCard`, `reorderCards`).

## Viewport diagrams

Selecting a section draws its diagram over the live picture. Pointing at or dragging a setting lights its part, and the diagram moves with the slider.

- **Senses:** one walker up close, in a lens over the dimmed picture, with its three feelers. "How far ahead" is the centre feeler; "How wide" is the angle on the left and right. The feelers are labelled L, C and R, as in the field guide's figure 2.4. The lens keeps its magnification while you drag (`diagram.ts keepRef`), so the feelers grow and shrink. It only re-fits when the value moves far.
- **Turning:** the turn arc to the new heading ("turns 45° toward the smell") and the wobble's fan.
- **Moving:** the last steps behind the walker ("one step 0.0037") and how many steps it takes to reach its feelers. Pointing at **At the edges** draws the picture's edge with what happens there.
- **Trail:** the dots it left, fading by the half-life and spreading by Diffuse.
- **Born:** the birth shape at its true size on the picture, with the count. In 3D the ball, shell or box is drawn through Draw agents' camera as it starts: the sphere's silhouette with its equator and a meridian (the far halves dashed), or a box's twelve edges.
- **Forces:**
  - one particle with each force as an arrow (Gravity and Wind along their Direction, Attract toward its point), and all of them added up in orange;
  - the curl flow as a field of arrows over the picture;
  - the attract point with arrows in (pull) or out (push);
  - drag as its speed now and a second later.
- **Neighbours:** one walker up close in a lens, with its view radius as a ring that follows the slider. Made-up neighbours stand round it, and the ones it counts (at most Max neighbours, in the grid's order) are lit.
- **Turning (flocks):** the same walker, with Keep apart's push away from the close ones, Match heading's average heading, Stay together's pull to their middle, Head for's direction and the wander fan. Pointing at a card shows only its part. Avoid edges draws the band along the picture's edge where it turns back.
- **Orbit:** the circle on the picture at its radius round its centre, arrowheads going its way round, and how hard it turns.
- **Life:** brightness by age, with the line where it dies.

The geometry is in `src/agentBuilder/diagram.ts`, and the drawing is `components/agentBuilder/WalkerDiagram.tsx`.

The diagrams carry no sentences: each drawing has a small coloured tag with its number, and the words are in the legend (below). Older notes above that quote labels ("turns 45° toward the smell") describe what the legend now says.

## Legend, tags and focus

The user's feedback (2026-10-09) on a particles preset: the labels ("curl flow ×0.9 · eddies 1.4", "gravity 0.25", "one particle · all together (orange)", "its speed now", "a second later: 45%") were spread all over the picture. The viewport is now a main picture with clean panels, as in tool UIs.

### One legend

**On the picture**, a compact panel in the viewport's top-left corner, lists what is drawn now. It folds (remembered, `builder:agent-builder:studio:legend`) to a row of colour dots. Each entry has:

- a colour dot, the same colour as its drawing and its tags;
- its name and key numbers ("Drag 0.8 · keeps 45%");
- one plain line on what it does to the walkers, worded from the live values and directions: "Gravity 0.25, pointing up: each particle is pulled upward; its speed that way grows by 0.25 a second." "Drag 0.8: after a second a particle keeps 45% of its speed." "View radius 0.12: each bird looks this far around it, and only knows the ones inside."

A short note under the title says what a lens shows ("One walker, up close.") or how a 3D birth shape is drawn.

| Section | Entries |
|---|---|
| Forces | Curl flow, Gravity, Wind, Attract / Repel, Drag (each card, on or off), and All together when the forces don't cancel |
| Neighbours | View radius, Max neighbours (orbiters add Keep apart, Stay together, Match heading) |
| Turning (flocks, crowds) | View radius, Max neighbours, then Head for, Keep apart, Match heading, Stay together, Slow in a crowd, Avoid edges, Wander |
| Orbit | each Orbit |
| Life | Lives for (the Emit's Life), Fade with age, Dies |
| Moving | Speed (for trail followers, with the steps to reach its feelers), At the edges |
| Senses · Turning · Trail · Born (trail followers) | Sensors · Turn, Wobble · Trail · Born |

Look draws nothing, so it has no legend. The phrases are pure functions, one per behaviour (`agentBuilder/legend.ts`, `phrase`): directions in words (the nearest of eight: up, up and to the right…), a negative force turned round ("pointing up (negative: turned round)"), 0 said plainly ("Drag 0: nothing slows particles"), and the walker's noun per kind (walker, ant, particle, bird, person, orbiter). The entries are rebuilt only when the values they read change.

### Tags on the picture

Each drawing has a small tag: a dot in its colour and a number ("0.25", "×0.9", "≤ 12°", "1 s · 45%", "36 / 36"), never a sentence. They are placed so they don't overlap each other, the legend or the focus demo (`layoutTags`: each tag at its point if free, else the nearest free spot tried round it, kept inside the viewport).

When the legend is tall it takes the left of the viewport, so the lens (Senses, Turning, Neighbours…) is centred in the rest. The Forces diagram's particle stands right of the middle, clear of the legend.

### Linking

- Hovering a legend entry or a tag lights its drawing and its tag, dims the other drawings, and lights its control in the inspector: the card (or the setting, for View radius, Max neighbours, Turn, Speed…) is scrolled into view and pulses.
- The reverse: pointing at a card or a setting in the inspector lights its legend entry (`entryForFocus`).

### Focus

Clicking a legend entry or a tag focuses that behaviour:

- the other drawings fade;
- the inspector shows only that card's controls, under a short head: its plain line and a little more about it, from the field guide in our own words (`moreAbout`);
- a small **moving demo** plays in the viewport's bottom-right corner, from the live values (`agentBuilder/demos.ts`), with a key under it:
  - Gravity and Wind: a particle thrown with it and a ghost without it, the paths drawn over three seconds with a mark each second;
  - Curl flow: the field in motion (its dashes march, and it drifts with Changes) with particles riding it;
  - Drag: two particles thrown side by side, one with drag, its half-second marks bunching up as it slows;
  - Attract / Repel: paths bending to (or from) the point, with the straight ones they would have taken;
  - All together: particles under every force at once;
  - Fade, Dies, Lives for: one particle ageing, its brightness its colour, and where it dies;
  - Keep apart, Match heading, Stay together: sixteen boids with the live turn rates, one with its view ring, its neighbours and the focused rule's arrow;
  - View radius, Max neighbours: the ring moving through others, the ones inside lit up to Max;
  - Head for, Slow in a crowd, Avoid edges, Wander, Orbit, Speed, At the edges: walkers doing just that;
  - Sensors, Turn: three feelers reading a trail (a wave) and the walker turning toward (or away from) the strongest;
  - Trail: what a walker leaves, halving every half-life and spreading;
  - Born: walkers appearing in the shape.
- **Esc** or **×** leaves focus (a second Esc closes the builder, as before). Picking a section leaves it too.

### What it costs

The demos are a few CPU walkers simulated once per change of value (30 steps a second over their loop) and drawn on a 320 × 200 canvas each animation frame, only while a focus view is open: nothing is scheduled otherwise (tested). The legend and the tags are plain React from memoised entries; the tag layout is a few rectangle tests.

## Follow a field

The user asked (2026-10-09) for a field builder for curl-like forces: known fields to pick from, a way to write your own, and the field shown in motion. **Follow a field** is a Forces card (particles). Several can be there.

### The card

- **Strength:** the field's velocity times this.
- **How it moves them:**
  - **Ride it** (the default): the velocity eases toward strength × the field at **Grip** a second (1 − e^(−grip·dt) a step), so particles trace the field's lines;
  - **Push (a force):** strength × the field is added to the velocity as a force, so they overshoot and swing.
- **Layers**, which add up. Each has a weight (negative turns it round), an on / off switch, its own sliders, and a folded **Turn, mask, animate**:
  - **Turn its flow:** every arrow turned by so many degrees (a vortex turned 60° spirals in);
  - **Where:** everywhere, only inside or only outside a circle or a box (with a soft edge);
  - **Animate:** still, drift (the layer slides along a direction, wrapping round the picture), or spin (it turns round its centre, degrees a second).
- **Add a layer** opens the gallery, eleven moving tiles (a few particles riding each field):

| Layer | Sliders | Which way |
|---|---|---|
| Curl noise | Eddy size | |
| Vortex | Core, Across, Up | ↺ / ↻ |
| Source / sink | Core, Across, Up | out / in |
| Saddle | Scale, Across, Up, Direction | |
| Dipole | Spread, Across, Up, Direction | left → right / right → left |
| Waves | Wavelength, Direction | |
| Uniform wind | Direction | |
| Spiral (vortex + sink) | Core, Across, Up | ↺ / ↻ |
| Shear | Band, Across, Up, Direction | |
| Slope of a picture | Along the slope / round its contours | downhill / uphill |
| Your own | vx, vy (and vz in 3D) | |

**Your own** is `vx = …` and `vy = …` (and `vz` in 3D), in x, y (from the layer's centre, picture units), t (seconds) and z (3D), with PI and TAU. Each part is checked as you type, as the GPU will check it (`agentRules/fields.ts checkOwn`, glslPatterns' parse and typecheck): it must parse, use only those names and the GLSL built-ins (sin, cos, length, atan, mix…), and be one float with no ints (`x * 2` is an error: "write 2.0, not 2"). The error shows under the box. A part that doesn't check leaves its layer out of the shader; the rest runs. Six examples insert in one click (Whirlpool, Drain, Ripples, Four eddies, Rings, Pulse).

**Slope of a picture** reads the group's new **Field ƒ** socket (it appears when a slope layer is on): wire a picture's brightness, a shape's distance, any chain of nodes. Its layer is a Flow node inside (Slope or Around mode). It can't be drawn on the CPU, so the overlay leaves it out, and its legend line says so.

### How it becomes nodes

The card is one rule action, `{ kind: 'field', strength, grip?, spec: { layers } }` (`agentRules/spec.ts`), so the rule set stays the one source of truth and the cards read back from it. `generate.ts` makes:

- **one Expression Block per field**, `Field: vortex + curl noise × 0.5, inside a circle`. It reads the walker's position (`pos`, from Agent Inputs) and returns the field's velocity (vec2, or `vec3(f, fz)` in 3D). Its lines are the layers, written by `fieldLines` (one variable per layer: centre, local point, frame, velocity, mask, `f +=` weight × velocity), each line explained in the node's note. It keeps the layers on its params (`fieldSpec`, with `fieldOf`: which rule, strength and grip), so Open as nodes keeps them;
- **one Flow node per slope layer**, its Field ƒ wired to the group's Field ƒ socket, its Force wired into the Field block;
- in the **rule's own block**, the push or the ride: `vel = heading × speed`, then `vel = mix(vel, fld × strength, go × (1 − e^(−grip·dt)))` (ride) or `vel += go × strength × fld × dt` (push), and the speed and heading from `vel`, as the Gravity force does.

Why this mapping: the rule blocks already integrate forces (Gravity, Curl, Attract are lines in the rule's block, Curl noise a node beside it). A field is the same shape, a vector at the walker, so it needs no new force node: the Expression Block is the field (readable, editable after Open as nodes) and the rule block is the force. Flow with a vector input or Gravity's Direction wired would have needed a new socket and would push only as a force, not ride.

**One source of truth for the maths:** the CPU never re-implements a field. `fieldFunction` parses the same `fieldLines` with glslPatterns and runs them (compiled once per field, cached), so the arrows, the focus demo, the gallery tiles, the preset thumbnails (dotSim) and the GPU agree. A test runs the generated shader on the CPU (cpuSim, through the nodes' own GLSL) and checks the velocity equals `fieldFunction`'s.

**Curl noise** here is the curl of four crossing sine waves of a stream function (not the Curl noise node's gradient noise): exactly divergence-free, the same on the CPU and the GPU, eddies about Eddy size across. The Curl flow card is unchanged.

**3D:** the known fields lie in the picture's plane (vz 0); your own can push in z.

**Text:** in the agents language a field is `field 1 grip=3 layers="{'layers':[…]}"` (JSON with ' for "), so the rules editor's text view round-trips it. The rules editor shows a field action as "follow a field (vortex + …) × 1, riding it", with Strength and Ride / Push; the layers are edited in the builder.

### On the picture

- The Forces diagram draws the field as arrows over the picture (18 across, at time 0, brightness by speed), the masks as dashed circles or boxes, each centred layer's centre as a dot, and a tag `×weight` per layer. The arrows are cached per field and picture size.
- **The legend has one entry per layer**, in its colour: "Vortex at the centre, strength 0.6: particles circle anticlockwise, faster near the middle (fastest 0.35 out). Each particle rides the field × 1: its velocity eases toward the field's, at 3 a second." Masks, turns, drift and spin are added to the line ("…; only inside a circle radius 0.7 round (0, 0), drifting up and to the right at 0.08 a second."). An own layer that doesn't check says "not running yet; fix vx in its card".
- Hovering an entry (or its tag, or its row in the card) draws **that layer alone**, the others' marks faded.
- **Focus** plays the field in motion: its arrows at the demo's clock (a drifting or spinning layer moves, the dashes march), its masks, and fourteen particles riding the whole field the way the card does (ride or push).

### Preset

**Whirlpool** (particles): a vortex plus curl noise × 0.5 inside a circle, drifting, ridden; they fade over 6 s.

## Memory: named numbers a walker keeps

The **Memory** section (Trail followers and the other kinds) holds up to four numbers each walker
carries from step to step, with names you choose.

- **Kinds:** Counter, Timer (counts seconds by itself), On / off, A value, A place (two numbers),
  A level that fades (drains by itself, like energy). Each has a *Starts at* (and a *Fades* for a
  level), and its live range shows on the card.
- **Operation cards** change a memory, each with its own "only when…":
  - Count up / down;
  - Set to, set on / off, toggle;
  - Remember what it smells;
  - Add up what it smells;
  - Decay over time;
  - Reset.
- **Write it as an expression** for anything else (`energy = energy * 0.98 + here.food`), checked
  as you type.
- **Used everywhere:**
  - in any card's "only when" (`carrying is on`, `energy > 0.5`, a timer's "after 2 s"), with up
    to two conditions on a card;
  - as a slider multiplier ("× a memory");
  - in **Colour by a memory**, which colours the walkers by it while you edit.
- **Ants with food** is built from memories now (carrying, away) instead of Advanced rules.
- **Under the hood:** the memories live in a fifth state texture, **E (More memory)**, four numbers
  per walker. Under the hood shows it with each channel named. Only groups that use memories get it,
  so every other graph compiles as before. It costs 8 MB more at 256k walkers and 32 MB more at 1M
  (both copies, float32).

## Presets

Each kind has its own strip:

- Particles: Spark fountain, Smoke, Snow, Drain, Burst, Whirlpool.
- Flocks: Boids, Glassy streams, Bait balls, Gnats, Murmuration.
- Crowds: Two-way lanes, One door, Crossing.
- Orbiters: Swarm, Two arms, Tight ring, Opposite ways, Moths.

Their thumbnails are a small CPU picture of the dots, run from the preset's cards (`src/agentBuilder/dotSim.ts`) and rendered once per session.

The Trail followers' strip holds the trail templates and four slime variants from the field guide's table "What each setting does to the look":

- Slime mold;
- Long veins (turn 20°);
- Round cells (feelers 45° apart);
- Busy mesh (turn 90°);
- Clumps (feelers 90° apart, turn 12°);
- Ants with food;
- Predator & prey;
- Frost (DLA).

Clicking a card replaces the rule set as one undo step. In 3D the set is rescaled, and a shape's Collide is kept.

The thumbnails are rendered once per session, one at a time, by a small CPU simulation (`src/agentBuilder/miniSim.ts`). It runs the same rule at the trail's pixel scale, so a thumbnail is a close-up of the pattern. The start page's moving pictures use the same code. They are pictures of the motion, not the GPU simulation, which only the viewport shows.

## Under the hood: the walkers in their textures

The **layers** button in the top bar (Under the hood) opens a panel under the live picture. It shows the walkers as the GPU keeps them (field guide 2.5): each group's walkers live in square RGBA32F textures, one texel a walker, walker *i* at (*i* mod side, *i* ÷ side). The panel's header gives the side and the count ("512 × 512 texels = 262,144 walkers"), from the runner. The choice is remembered (`builder:agent-builder:studio:hood`); the panel closes from its × or the button.

While it is open the picture shows no section diagram, so the rings sit on the plain picture.

### The textures, channel by channel

Each texture is a group of four small pictures (R, G, B, A), one pixel a walker, each with its name, a legend bar and its range, and a line on what the texture is for. Dead walkers (life 0 or less, or not born yet) are black in every channel.

| Texture | R | G | B | A |
|---|---|---|---|---|
| A (2D) | position x: gradient, left −aspect → right +aspect | position y: gradient, bottom −1 → top 1 | heading: a hue wheel, one turn | age: a ramp up to the Emit's life; for walkers that live for ever a soft ramp (half way at about 21 s) |
| B (2D) | velocity x: blue one way, orange the other | velocity y: the same | speed: a ramp, 0 → 1.5 × the fastest kind's speed | life: a ramp, green for ever, black dead |
| A (3D) | position x | position y | position z (back → front) | age |
| B (3D) | velocity x | velocity y | velocity z | life |
| C | kind: each walker in its kind's chip colour | memory x: a heat map, 0–1 | memory y: a heat map, 0–1 | its own colour, unpacked |
| D | deposit in channel 1 … 4, each in that trail channel's colour, 0–1 |

C and D are shown only when the group keeps them (more than one kind, Memory, Colour or its own Deposit). In 3D the heading is the velocity's direction, so it has no channel of its own.

The **trail field** follows: its four channels as swatches in the picture's shape, named and coloured as the builder's Smells / Lays chips, each with what reads it ("read by Senses", "only when it smells") and what writes it ("written by Trail (Deposit)", birth marks). A velocity trail (Deposit What: Velocity) shows velocity x, velocity y and the count.

### Linking a walker to the picture

- **Point at a pixel** of any texture: that walker's numbers are read (one texel of each texture), a white ring marks it on the live picture, a dot marks it on the trail swatches, its texel is marked in every texture, and a card at the top right shows walker no., texel, position, heading (degrees), speed, age, life, kind, and memory and deposit when it has them.
- **Click the picture**: the nearest live walker within 8 pixels is picked (the GPU finds it). Its texel lights up in every texture and the ring turns solid blue. A click on a texel picks that walker too. A click where nobody is lets go.
- **Follow** (on the card) keeps reading the picked walker every frame, so the ring and the numbers move with it. Off, the card keeps the numbers from when it was picked, and the dashed ring stays where it was then.
- **The selected section lights the channels it uses**, and dims the others: Senses → the trail channels it smells and the heading; Turning and Steering → the heading; Moving and Forces → velocity, speed and heading; Born → position, age and life; Life → age and life; Trail → its deposit (D) and the channel it lays; Neighbours → position and velocity; Orbit → position and heading; Look → kind, colour and age; a kind chip → the kind. In 3D the heading and speed are the velocity channels.

On the picture a walker is placed as Draw agents places it: in 2D at (x ÷ aspect, y); in 3D through the group's first live Draw agents camera (its orbit at the last frame's time, or a scene's camera when its probe has run), the projection the species spotlight uses, computed on the GPU. A 3D group without a live 3D Draw agents is placed as if seen from the front (best effort).

### What it costs

- Nothing runs while the panel is closed: ShaderCanvas calls the runner's `drawHood` only while a request is open (`lib/agentHood.ts`), and the GPU part (`lib/agentHoodGpu.ts`) is loaded the first time one opens.
- The thumbnails are drawn on the GPU into one small 8-bit atlas (128 × 128 pixels a channel: every side ÷ 128-th walker each way), at most four times a second and only when the walkers have stepped, and read back without a stall (a pixel buffer and a fence). There is no readback of the state itself.
- A walker's numbers are one texel of each texture (5 × 1 floats), read the same way, each frame the walker is hovered or followed, else once.
- A pick draws every live walker as a point into one float texel, the nearest winning the depth test, and reads that texel back.
- The runner's `stateView(targets, groupId)` is the only way in: a frozen, read-only view (side, count, kinds, C and D, aspect, step, the current copy of A–D, the trail its Deposit fills, the 3D camera). It doesn't expose the targets or the ping-pong.

## Files

- `src/agentBuilder/`: `behaviours.ts` (cards ↔ rules for every kind, only when, reorder, kinds), `cards.ts` (trail followers), `sections.ts`, `onlyWhen.ts`, `kinds.ts`, `presets.ts`, `words.ts`, `diagram.ts`, `miniSim.ts`, `dotSim.ts`, `actions.ts` (the store side: make, Back, setup params with their own undo steps, presets).
- `src/components/builders/studio/`: `StudioShell.tsx`, `LiveViewport.tsx`.
- Under the hood: `src/agentBuilder/hood.ts` (channels, maps, highlights, texel ↔ walker ↔ picture), `src/components/agentBuilder/HoodView.tsx` (the panel, the ring and the card), `hoodStore.ts`, `src/lib/agentHood.ts` (requests), `src/lib/agentHoodGpu.ts` (thumbnails, one walker's read, picking), `AgentRunner.stateView` / `drawHood`.
- Legend, tags and focus: `src/agentBuilder/legend.ts` (the phrases, the entries, linking, the tag layout, the focus words), `src/agentBuilder/demos.ts` (the focus demos), `src/components/agentBuilder/ViewportLegend.tsx` (the legend, the tags, the demo panel).
- Follow a field: `src/agentRules/fields.ts` (the layers, their GLSL lines, the CPU function, own-expression checks, text), `generate.ts` (the Field block, slope Flow nodes, the rule's push or ride), `src/components/agentBuilder/FieldCard.tsx` (the card, the layers, the gallery tiles, your own), `KindDiagram.tsx` (the arrows), `legend.ts` (`fieldEntries`, `phrase.fieldLayer`), `demos.ts` (the `field` demo).
- `src/components/agentBuilder/`: `AgentBuilder.tsx`, `BehaviourCard.tsx`, `SectionCards.tsx`, `OnlyWhenLine.tsx`, `KindChips.tsx`, `SpeciesSpotlight.tsx`, `WalkerDiagram.tsx`, `KindDiagram.tsx`, `pictures.tsx`, `presetThumbs.ts`, `useLensRef.ts`, `useRuleSetEditing.ts`. They are loaded lazily by `BuilderWindowsHost`.
- `src/lib/previewMirror.ts`.
- The window state: `builders/windows.ts` (`agentBuilder`).
