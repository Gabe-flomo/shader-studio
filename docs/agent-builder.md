# Agent Builder

The Agent Builder makes and edits an Agents group's walkers with pictures instead of When … Do … lines. It follows the field guide's Part 2: one step is **Sense → Steer → Move → Deposit**, after the walkers are **born**. The plan and its phases are in `docs/agent-builder-redesign-plan.md`. The rules underneath are in `docs/agent-rules.md`.

## Ways in

- **Builders → Scene builder → Agent scene** ([scene-builder.md](scene-builder.md)), the canvas menu's Builders, or the Do… bar's "new agent rules": the start page. From the Scene builder the start page doesn't ask about clearing the graph or about groups already there (the kind page asked); its header reads **Scene builder › Agent scene**, and **‹** goes back to the kinds. Nothing is added until you pick a kind. When the graph already has an Agents group the builder made (a rules group on the top level), it asks first (see "Opening with a group already there").
- **Edit rules ↗** on a rules group's card, or a double-click on its title, opens the builder on that group, for every kind (trail followers, ants, particles, flocks, crowds, orbiters).
- **"new 3d agents"** adds the 3D slime setup and opens it in the builder.
- A rules group's Recipe chip (**Open rules**) opens the builder too.
- The builder never sends you to the old rules editor (`AgentRulesModal`): its Advanced rules edit every rule as When … Do … lines, in the builder. The old editor is still in the code but nothing in the builder opens it.

## Start page: what are you making?

The start page shows five cards, each with a small moving picture: **Trail followers** (slime, ants, veins), **Particles**, **Flocks**, **Crowds** and **Orbiters**. **Make it in 2D | 3D** sits above them. A card adds its setup to the graph, wired to the Output, as an undo step of its own (the first undo after an edit takes back only that edit):

| Card | Rule set kind | 2D setup | 3D template |
|---|---|---|---|
| Trail followers | trail | the rules starter with the Slime mold (the example's Emit, Deposit 4 and 1024-row trail) | 3D slime |
| Particles | particles | the Spark fountain example's own setup (its Emit, Draw agents and palette) | 3D curl smoke |
| Flocks | flock | the Boids example's setup | 3D flock |
| Crowds | crowd | the Crowd example's setup (two kinds walking opposite ways) | the 3D flock's setup with the crowd's rules, rescaled |
| Orbiters | swarm | the Swarm example's setup | Orbiters in 3D |
| Scan to walkers | particles | a splat scan as walkers (Emit: Splat scan, a generated ball), blown apart and flowing back home, drawn as Splats | Scan to walkers in 3D |

Crowds have a card of their own but the Flocks sections. A crowd is a flock with somewhere to go (Head for) that slows in a jam. What you make looks different (people in lanes, not birds) and starts from a different setup, so it gets its own picture and presets.

**Back** (top left) on a group made from the start page takes it away again and returns to the start page. Undo brings it back. **Add to graph** keeps it: it is already live in the graph. On a group that was already there, the button reads **Done**.

### Clear the current graph first?

When the graph has anything besides its Output, the start page asks beside **Make it in**: "Your graph has N nodes: **Clear and start over** | **Keep my graph**". As in the Scene builder, **Clear and start over** is the default on a graph no builder made; on a graph a builder made, or after **Add another**, **Keep my graph** is. Keep adds the new group beside what is there. With clear picked, a line under it says what will happen, and picking a kind first clears everything but the Output (unwired), as an undo step of its own ("Agent Builder: cleared the graph"), then adds the group as its own step. So undo takes back the group, then the clear. **Back** puts the whole graph back as it was before the clear (`agentBuilder/actions.ts clearGraphForBuilder`).

### Opening with a group already there

Opened from the entry, the Do… bar or the canvas menu while the graph has a builder group (a rules Agents group on the top level), the builder asks instead of adding another:

- **Edit this one** (the default): the builder on that group, as **Edit rules ↗** opens it.
- **Start over**: the group and its setup go (the Emit, Deposit, Trail field, palette, Draw agents: every node only it reads from or that reads only from it, `agentSetupIds`), as one undo step ("Agent Builder: started over"); then the start page, with a line saying what went and that undo brings it back.
- **Add another**: the start page; the new group goes beside the others.

With several groups, they are listed (name, kind, 2D or 3D) and you pick one; the selected one on the canvas is picked to start with, and Edit and Start over act on the picked one. A double-click on a group edits it.

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

### Turning the 3D view

In 3D the viewport is a camera you can hold, as the 3D Scene Builder's is: **drag** to turn round the point looked at (Angle sideways, Elevation up and down, ±89°), **right-drag**, **middle-drag**, **Shift+drag** or **two fingers** to pan (the walkers follow the pointer), **scroll** or **pinch** to come closer or go further (Distance, 0.3–40), and **double-click** for the view a new 3D group starts with (3.8 away, 15° round, 15° up, centred; Orbit speed, Zoom and depth of field are left as they are). Each gesture writes Draw agents' own camera settings — Angle, Elevation, Distance and Translate X / Y / Z (the point it looks at and turns round) — the same values the Look section's Camera card shows, so what you see is what the graph draws; a drag is one undo step. With Orbit speed on, a drag turns from wherever the camera has circled to. The gestures sit under the diagrams: their handles keep their own drags. 2D is unchanged (its drags draw regions and move handles). A Draw agents that looks through a wired scene's camera ignores these settings, so the gestures don't move it.

Files: `src/builders/orbitMath.ts` (the gestures' numbers, shared with `SceneViewport.tsx`), `src/components/builders/studio/useOrbitGestures.ts` (pointer, wheel, touch and double-click), `src/agentBuilder/cameraGestures.ts` (gestures → camera params), `src/components/agentBuilder/OrbitPad.tsx`.

### Stepping

A bar under the viewport steps through the simulation, as the Grid Rules try board does: **↺** start over (a true reset, docs/true-reset.md: step 0, the walkers born again, trails and kept steps cleared), **◀** one step back, **▶ / ⏸** play and pause (the preview's own clock, so everything else pauses too), **▶|** one step forward. With the bar focused, ← → and Space do the same; **Shift+→** (or Shift-click ▶|) runs a whole frame's steps at once (the group's Steps a frame). **Step N** is the group's own step count, the number the group card shows.

- A step is one fixed tick of every Agents group in the graph (1/60 s of simulated time: sense, steer, move, deposit, then the trails spread and fade). The live runner runs it at its next frame, the same step the clock would run, and the clock carries on from there when you play again (no catch-up, no wait). Stepping is deterministic: the rule is a function of the state, the step and the seed.
- Pressing ◀ or ▶| while playing pauses first.
- **Respawn** (✦, or **R** with the bar focused) re-seeds the walkers without a reset: every walker of the group is born again from Born (the Emit's shape, size and facing) at the next step, as the Emit's Burst does, while the trail, the step count, the kept steps and the clock carry on. ↺ is still the true reset. Paused, Respawn runs that one step so the new walkers show. (`respawnAgents` in `lib/agentRunner.ts`: the request becomes the group's pending Burst; a trail is emptied only for a group that started over, `trailStartsOver`.)
- **Back is limited.** While the builder is open the runner keeps a copy of the walkers' state textures and every trail's texture (and each group's schedule: births, Burst, what its listeners heard) before every frame that steps: a played frame (a few steps at once) or a step forward. ◀ puts back the newest copy at or before the step wanted and runs the steps between again, so back is always exactly one step, as far back as the oldest copy. The copies are GPU memory, as big as the state (a 256k-walker Slime mold with its 1024-row trail is about 23 MB), so at most 60 are kept and no more than 256 MB together; the bar says how many frames that is ("Keeps the last N frames") and how far back you can go. Nothing is copied while the builder is closed.
- Starting over (↺, the clock reset) drops the copies. A group whose count or 2D/3D changed since a copy keeps its new state; a trail resized with the picture is left as it is. The picture's own feedback (a Feedback node, Echo) isn't part of the copies.

Files: `src/agentBuilder/stepRun.ts` (the ring of copies, a step back's plan, the buttons' queue; tested with a CPU stand-in), `src/lib/agentSnapshots.ts` (the queue, the GPU copies, restoring, re-anchoring the clock; `AgentRunner.run` calls it), `src/components/agentBuilder/AgentTransport.tsx` (the bar).

## Sections and cards (Trail followers)

Only the selected section's card is open. The others are their summaries in the nav, and Senses is selected first. Each card has:

- a picture;
- a plain name, with a hint when you hover over it;
- a mute button where the behaviour can be left out (see Muting);
- two or three sliders (the app's RulerSlider);
- a folded **More**;
- **Learn more**, the field guide's paragraph in short.

| Section | Settings | Writes |
|---|---|---|
| Born | Where (a shape, or External…: a source picked in the Where picker), Size, How many; More: Facing, Births | the group's Emit (shape, size, heading, mode) and the group's Count |
| Senses (switch) | How far ahead, How wide, Smells (chips), Avoid it | the rule set's sensors; a Turn toward a trail (its channel, `away`) |
| Turning | How sharply; Wobble (its own switch) | that Turn's degrees; a Wander |
| Moving | Speed, At the edges (Wrap / Bounce / Slide) | the species' speed; the rule set's edges |
| Trail (switch) | Leaves, Fades, Spreads; More: Lays (chips) | a Leave trail's amount and channel; the Trail field's Half-life and Diffuse |
| Advanced rules | each rule the cards can't show, as a card with its When … Do … lines, edited in place; Every rule shows them all | the rules themselves |

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

Advanced rules is always last. Its summary says how many rules are beyond the cards, or "every rule as lines" (dimmed) when the cards show them all.

### Advanced rules

The rules the cards can't show (two conditions, Stop after this rule, states, masks, memory…) are a list of cards in the builder's style (`components/agentBuilder/AdvancedRules.tsx`). Each card is a rule: its number and its sentence, an on/off switch, move up and down, duplicate and take away, and its **When** and **Do** lines, every condition and action editable as in the old rules editor (the pieces are shared: `components/agentRules/RuleEditors.tsx`), with **+ and…**, **+ do…** and **Stop after this rule**. **Only these | Every rule** switches between the rules the cards can't show and all of the kind's rules, in the order they run. **Add a rule** adds one at the end (and shows every rule). The top bar's `{}` opens Every rule. Edits apply like the cards' (a quarter of a second after you stop, one undo step a burst); a rule the cards can read shows up on its card again.

### Particles (field guide 2.9)

- **Forces:**
  - Gravity: Strength, Direction.
  - Wind: Strength, Direction, in gusts.
  - Curl flow: Strength, Eddies; More: Changes.
  - Attract / repel: Pull (negative pushes), toward A point or The mouse, Across, Up.
  - Follow a field: a vector field you pick, combine or write (below).
  - Drag.
  - Return home: Strength, Damping, After (s): a spring back to the Home memory (where it was born). Without a Home
    memory the card offers to add one; the Emit fills it (Remember home, or a splat scan).

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
- inside / outside a region: picked in the Where picker (a shape, mask or texture of your graph, or one drawn on the picture; see "Where"), a `mask` condition. Older sets' typed-in circle or box (`shape`) still work;
- older / younger than … s;
- by chance … % a second;
- in / not in state ….

Once picked, it is a small chip ("only when · older than 2 s") with its settings folded under it, and × makes the card always act again. It is the card's rule's condition. Pointing at a card with an "only when" draws where it applies: a shape is drawn on the picture with the rest shaded, and other conditions are a badge at the top of the viewport.

## Muting

Every behaviour card that can be left out has a mute button in its header, the same mark as a node's bypass in the graph (the builders' shared `MuteToggle`). This is the old on/off switch with a new look: a muted card is its rule switched off (the rule's `off`), so nothing changes for saved setups.

- **What can be muted:** the behaviour cards (Senses, Trail, every force, flocking, goal, orbit, wobble, memory and Turn round cards), Turning's Wobble, each Advanced rule, and each layer of a Follow a field card. Born, Turning, Moving, Look and the other settings cards are what a walker is, so they have no mute.
- **Left out, not gated:** agents compile through their own path (`agentRules/generate.ts`), which has no live mute gate, so a muted card's action is left out of the generated nodes: the walkers run as if the card were taken away. Toggling rebuilds the group's inside (as any card edit does). Its settings stay on the card.
- A muted card says **Muted** beside its name and its settings dim; they can still be edited.
- **Alt/Option-click** the mute solos the card in its section: the other cards there are muted. Alt-click it again turns them all back on (`soloCard`).
- Each mute (or solo) is one undo step, and it is saved with the group, so it is still muted when the builder is opened again.
- **Text:** a muted rule prints with `@off` in the agents dialect, as before. The builders' word `muted` (a bare `muted` at the end of the rule, or `@muted`) reads as `@off` too, and prints back as `@off`.

## Folding cards

Behaviour cards fold to one line: a chevron, the picture, the name and what it does with its key numbers ("Gravity · 0.4 down", "Drag · 2 /s"), the mute and ×. Collapsed by default, as the app's other editors are: a section's first card starts open and the others folded; in Neighbours and Life the section's own settings card (What it sees, Lives for) is the open one and every behaviour card starts folded; a trail follower's extra cards and Moving's Flow field start folded. **Open all / Fold all** sits over a section with more than one card, and a card just added (+ Gravity) opens. Focus shows its card open. What you open or fold is remembered per section and card (`forces:gravity#0`), between openings and (where the browser allows) between sessions. Folding is UI only: nothing in the rules changes.

Files: `src/agentBuilder/cardFolds.ts` (the start rule, the remembered state, the folded line, `directionWord`), `BehaviourCard.tsx` (`open` / `onOpen`), `SectionCards.tsx` (`cardSummary`).

## Dragging cards

In sections where order matters (Forces, Turning, Orbit, Orbiters' Neighbours) each card has a grip. Drag it to another place, or press ↑ / ↓ on it. The card's action moves into a rule of its own just before (or after) the card it is dropped on, and a rule shared with other cards is split there (`moveCard`, `reorderCards`).

## Viewport diagrams

Selecting a section draws its diagram over the live picture. Pointing at or dragging a setting lights its part, and the diagram moves with the slider.

- **Senses:** one walker up close, in a lens over the dimmed picture, with its three feelers. "How far ahead" is the centre feeler; "How wide" is the angle on the left and right. The feelers are labelled L, C and R, as in the field guide's figure 2.4. The lens keeps its magnification while you drag (`diagram.ts keepRef`), so the feelers grow and shrink. Past 1.8 times (or under 0.3 times) the length they started at, the lens zooms with the value instead: the feelers stay pinned at that length, inside the lens at any angle, and the zoom follows smoothly. (It used to re-fit in one jump at 2.6 times, which made the drawing snap back and jump as you dragged outward.)

**The sliders.** A small range gets a finer ruler (`rulerMath.ts fineUnit`): How far ahead's 0–0.12 is 480 px of drag (0.001 every 4 px) rather than 48 px, and View radius is 0.02 a ruler unit. Typing a number past the end widens the range (the slider conventions), and the builder keeps the wider range for that setting while the app is open, so it is still there when the card comes back.
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

## Dragging the diagrams

Every diagram can be dragged, as well as its sliders moved (wave 3). A drag writes the same values the slider writes, live (the slider moves with it, and the picture follows a few times a second), and the whole drag is **one undo step**, named for what was dragged ("Agent Builder: dragged the feelers").

| Diagram | Handle | Writes |
|---|---|---|
| Senses | each feeler's tip (L, C, R): out or in is How far ahead; the left or right one dragged sideways is How wide | the rule set's `sensor` |
| Turning | the new heading's end; the wobble fan's two edges | Turn's degrees (0–90°); Wander's degrees (0–45°) |
| Born (2D) | the shape's middle moves it; its edge (disc, ring, line) or corner (box) sizes it; a point is moved | the Emit's x, y and size (the walkers start over when the drag ends) |
| Forces | gravity's and the wind's arrow tip: round for the direction, out or in for the strength (the arrow is 18 px + 70 px a unit); the attract point | the force's angle and strength; the attract point's x, y |
| Follow a field | a centred layer's centre, its size (a ring under it), its direction (a short line); an older typed-in mask's middle and edge | the layer's x, y, size, angle, mask |
| Neighbours | the view ring | View radius |
| Orbit | the centre (when it circles a point) and the circle's edge | the orbit's x, y and radius |
| Avoid edges | the band's inner edge | its margin |

Handles are a soft dot (a feeler's tip is its own handle) until the pointer is over one; then a ring, a cursor (move, resize, grab, grabbing) and a hint. While a feeler is dragged the lens holds still, so the tip stays under the pointer; it re-fits when you let go. Handles show in focus too, so the focus demo can be watched while the sensors are dragged.

**How:** `components/agentBuilder/DragHandle.tsx` is the handle; the maths, from the pointer to the value with the slider's step and sensible ends, is `agentBuilder/diagramDrag.ts` (pure). The builder gives each diagram a `DiagramEdit`: `begin` flushes pending edits, marks the undo history and lights the setting; the writes are the cards' own (`update`, `setSetupParam`), with rule edits applied every 140 ms while held (`useRuleSetEditing.hold`); `end` applies the last one and folds every step since the mark into one (`undoManager.collapseSince`), then closes the bursts (`endRulesBurst`, `endSetupBurst`) so the next edit is a step of its own. Not draggable yet: Born in 3D, the curl flow, drag, Life, Speed and the trail.

### The Sensors demo

Its walker (`demos.ts sensesWalk`) starts below a wavy trail heading along it, with feelers How far ahead (scaled into the panel: 0.3 long at the slime's 0.03) at ±How wide, and turns by How sharply (eased for the demo's longer steps) toward the stronger side. It swings onto the trail within a second or two and rides along it (tested), and it follows the values as they are dragged.

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

Look's legend says how they are drawn and what the colour means (see "Look"). The phrases are pure functions, one per behaviour (`agentBuilder/legend.ts`, `phrase`): directions in words (the nearest of eight: up, up and to the right…), a negative force turned round ("pointing up (negative: turned round)"), 0 said plainly ("Drag 0: nothing slows particles"), and the walker's noun per kind (walker, ant, particle, bird, person, orbiter). The entries are rebuilt only when the values they read change.

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
  - Head for, Slow in a crowd, Avoid edges, Wander, Orbit, Speed, At the edges: walkers doing just that (the ones that walk freely, Sensors, Head for, Wander and Orbit, keep to the panel the way the group's At the edges says: they wrap, bounce or slide, `demos.ts keepIn`, so a walker never walks out of the picture);
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
  - **Where:** everywhere, or only in a region picked in the Where picker (inside or outside; older layers' typed-in circle or box, with a soft edge, still work);
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

### Surprise me

**Surprise me** sits at the right of the presets strip (with its seed: type one and press Enter to make that result again, and Reroll), and as the dice in the top bar. It makes a random setup of the group's own kind, so the sections stay the same (`agentBuilder/surprise.ts`):

- Trail followers: half the time one of the hand-written styles of the rules editor's Surprise me (trackers, flow drifters, crowd-shy gatherers, sometimes a second species that follows or avoids the first), else one of the kind's presets with its sensors, speeds and every action's numbers varied inside bands where it still forms patterns;
- Ants / carriers: the pulsers style, or the ants preset varied (memories kept exactly);
- Particles, flocks, crowds, orbiters: one of the kind's presets, every number varied, new colours. Dies rules stay and no trail is added, because the builder's setups are born again and drawn by Draw agents.

The trail's Half-life, Diffuse and palette are new too. In 3D the result is rescaled like a preset (only presets that rescale are used), and a shape's Collide is kept. It is one undo step, the walkers start over, and the toast has the seed, Reroll and Undo (`surpriseActions.ts surpriseBuilderAction`).

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

## Where: regions of your graph, and shapes made on the picture

Wherever a card asks "where", the **Where picker** answers it. It replaced every typed-in circle or box:

| Use | Where it is | What it writes |
|---|---|---|
| Only when inside / outside | a card's "Only when… → inside / outside a region…" | a mask slot of the rule set (up to four), a `mask` condition, and the group's mask socket wired to the region |
| A field layer's region | Follow a field → a layer → Turn, mask, animate → Only in a region | the layer's `mask.region` (the same mask slots); the Field block reads `mask1`… where the walker stands |
| The slope layer's field | Follow a field → Slope of a picture → The slope of | the group's Field ƒ socket |
| Born inside | Born → Where → **External…** (the built-in shapes stay in the same select) | the Emit: Shape Field with Where ƒ (a shape or mask, through a small adapter block), or Picture (a texture); Threshold ½ |
| Walls | Moving → Walls, and At a wall (Turn back / Slide along) | the rule set's `obstacle`, the group's Obstacle ƒ socket into Move's Obstacle ƒ (a mask, or "outside", through an adapter); in 3D a Scene goes to Collide (3D scene) |
| Food (2D) | Trail → Food, with How much and Into (a channel) | the Trail field's Add, through a **Food** Expression Block: `vec4` with the food in one channel × amount (a shape's inside, a mask's or a texture's brightness; a texture is read through a Sample (texture)) |

**The list** (`agentBuilder/where.ts listRegions`) holds everything at the top of the graph that can say "here":

- a **shape**: a float output that is a distance (an SDF node, a "Distance" output, a shape made here): inside where it is below 0;
- a **mask**: any other float output that changes across the picture: inside where it is above ½;
- a **texture** (a Pass, a Trail, a Texture node): inside where it is bright;
- in 3D, a **Scene** (walls only).

Constants, the agents' own nodes and anything downstream of the group (a cycle) are left out; the group's own trail texture is allowed (it is read a step late, as Sense reads it). Each tile has a **thumbnail**: the node's own chain compiled as a node preview and its raw values rendered on the GPU in the picture's shape (`lib/regionValues.ts`, through `nodePreviewRenderer.renderValues`), inside in the accent colour. Thumbnails are cached by shader and uniforms. A texture shows its card's thumbnail when it has one.

**Make one here**: Circle, Box, Ring, Polygon or Text. Pick one and draw it on the live picture: drag from the middle for a circle or ring, corner to corner for a box or a word, click the corners of a polygon (the first again, Enter or a double-click closes it), Esc stops; a click without a drag makes a default one there. It becomes a real node (`agentBuilder/madeShapes.ts`): an Expression Block "Where: circle" returning the shape's signed distance, with a note line by line. Its place and size are the block's **sliders** (cx, cy, r, w, h, t, s, p0x…), so dragging its handles writes uniforms (no recompile, the walkers aren't started over); only a polygon's corner count or a word's letters are in its lines. The spec is kept on the node (`whereShape`), so the builder reads it back and shows its handles; a block whose lines were edited by hand is just a graph output. Text is the stroke font (see "Text as a shape or a wall"; phase 3's 5 × 7 pixel font still loads).

**On the picture** (`RegionOverlay.tsx`): pointing at a Where row (or a tile in its list) draws the region over the live picture, the part where the card does nothing shaded, with a badge ("acts inside · Pond", "a wall · Polygon", "born inside · Circle"). A region of the graph is shaded from its GPU values with a smooth outline (marching squares); a shape made here is its vector outline with handles: the middle moves it, the edge or corner sizes it, a ring's inner handle sets its width, a polygon's corners move and the "+" on each side adds one. **Done** (or Esc) stops showing it. A walls region is tinted red.

Old typed-in shapes (an only when's `shape`, a field layer's circle or box mask) still load and work; their settings offer **Make it a shape you can drag**.

### Choosing a source

Every input the builder can wire (only when, a field layer's region, Field ƒ, born inside, walls, food) opens the same picker. Born has no separate row for it: its **Where** select lists the built-in shapes and **External…**; choosing External shows the picker under the select (open at once when nothing is picked yet), and choosing a built-in shape again unwires it. A scene already born inside a source reopens with Where on External and the source's summary.

The picker first asks **what kind of source**, as a short list:

1. **From the graph:** a shape or mask output already there (in 3D also a Scene).
2. **From a group:** an output of another group: a plain group, or the Trail field another Agents group deposits into ("from Prey"). The row says "from …" and has **Edit inside ↗**.
3. **A picture** (uses that read a texture): the scene builders' shared picture picker ([scene-builder.md](scene-builder.md#textures)), its upload, paste, link and image library ways. The picture lands on a new Texture node (one undo step), which is then wired in as a texture region (a second undo step).
4. **A texture / field** (uses that read a texture): a texture output already there: a Shader Texture, a Trail field, a Pass, a Texture node.
5. **Create new:** a shape drawn on the picture (Circle, Box, Ring, Polygon, Text); **New Shader Texture** (docs/texture-builder.md: white discs to start; for uses that read a texture); **New group** (a plain group whose Distance output is a circle, `length(uv) − r`, with a note). Each is a top-level node wired in, in the same undo step as the wiring. A new Shader Texture or group is **opened ready to edit**: the builder closes, the graph enters it, and a toast offers **Back to the Agent Builder**.

A kind with nothing in it (no group with an output this use can read) is greyed out with a few words why, not a paragraph. Choosing a kind **locks it in**: the others go and only its UI shows (the tiles with thumbnails, the picture picker, or the new things), with **Change** to go back to the kinds. Once picked, the row is a compact summary: thumbnail, name, kind, **Change** (back to the kinds) and **×**. The wiring is the same whichever way it is reached.

`where.ts listRegions` tags group outputs (`from`, `inside`); `whereActions.ts setWhere` takes `create: 'shaderTexture' | 'group'` (`newRegionGroup`) and keeps the new node for `takeCreated`.

### Text as a shape or a wall

Text made here is drawn in a **stroke font in the shader's own style** (`agentBuilder/strokeFont.ts`): each letter a few strokes (segments, arcs, dots) on a grid two units tall, and the words' distance the nearest stroke's less the strokes' half-weight. It is smooth at any size, round at the ends, the same on the CPU and the GPU, and it compiles to one line per stroke of the Expression Block (no texture), so it works wherever a shape does:

- **as the pattern:** Trail → Food → Text: the words are painted into the trail the slime smells, and the veins grow over the letters;
- **as a wall:** Moving → Walls → Text: the distance goes straight into Move's Obstacle ƒ, and walkers turn back (or slide along) at the letters;
- born inside the words, only when inside them, a field layer's region.

Its card row edits **the words** (A–Z, 0–9 and `! ? . , : ' - + * / = #`, up to 16), **Size** (half their height), **Weight** (the strokes' half-width, the `wt` slider) and the **font** (Smooth, or Blocky 5 × 7). Dragging on the picture moves it; its corner sizes it; a word drawn by dragging fits the box. Size and weight are sliders (uniforms, no recompile); new words or a font change rewrite the lines. Text made in phase 3 (no `font` saved) keeps the blocky 5 × 7 font and loads as it was.

## Trail channels

The trail's four channels are **named colour swatches** (Trail → Channels): a colour chip (ten colours, each with its word) and a name you click to rename in place. Each lists what **reads** it (Senses, an only when, Look) and what **writes** it (Trail (Deposit), birth marks). **+ Channel** adds the next free one, named (food, home…), up to four. The names are the rule set's `channels`, the colours its `channelColours`.

- The Smells / Lays chips and the "it smells …" only when read "its trail · amber", "food · yellow" (`agentBuilder/trailChannels.ts channelChips`).
- Under the hood's trail swatches take the same names and colours.
- **Tint the picture** lays each channel in its colour over the live picture, from the runner's live trail (an Under the hood request for just the four channels, read back a few times a second; off while Under the hood is open).
- **Fades** and **Spreads** have a before / after strip: a line of trail now, one half-life later and three, from the trail field's own step (blend toward the neighbours by Diffuse, halve every Half-life).

## Look (every kind)

Every kind has a Look section (`LookSection.tsx`, `agentBuilder/look.ts`):

- **Drawn as**: Dots, Glow, Streaks, Ink or **Splats**, Size, Brightness (and Streak length): Draw agents. Splats has Splat size (or, sized by Its own, the memory scale), Size by (Fixed, Speed, Its own), Stretch and Opacity (docs/splat-scene.md "Agents as splats"). With no Draw agents (trail followers: the trail is the picture), **Draw the walkers too** adds one over what the Output showed.
- **Colour**: by Kind (Draw agents' Colour by State: the kinds' and states' colours, named and coloured here, + State), Speed (with Fast is), Age, Heading, One colour (Draw agents' palette, or Colour A → B), **A trail** (the rules colour each walker from its kind's colour, dimmed, to a channel's colour as that trail is under it: the rule set's `look`, Finish's colour, Draw agents' Colour by Agent), or **A memory** (phase 4's `colourBy`), or **Its own** (the colour it was born with, a splat scan's: the rule set's `look: { by: 'birth' }` leaves Agent Output's Colour unwired).
- **The trail**: what the picture shows (the trail, one channel, walker density) and its palette: five ready-made palettes and each stop's colour (the Stops Palette that shows the trail).
- **3D: Camera**: Distance, Angle, Elevation, Orbit speed, Zoom, **Perspective** (Normal / Orthographic / Reverse, with Reverse strength and Converge at: docs/camera-projections.md), Flatten, Focus, Blur, Max blur (Draw agents' camera; right-click a slider for the Play menu), and Around a shape.
- The legend says what is drawn: "Each walker is a dot with a soft glow, 1.2 pixels across", "Colour: slow particles at the palette's start, fast ones at its end", the trail's palette, the camera. Focus plays a few walkers drawn and coloured that way.

The left nav also has **What they are**: the kind (Trail followers, Particles, Flock, Ants, Swarm, Crowd), which picks the sections. With Walls, the Flow field card (Moving, when a rule follows the flow field), states in Look, Channels and the Where picker, everything the old editor's Species, Trails and Look tabs had is in the builder.

## Files

- `src/agentBuilder/`: `behaviours.ts` (cards ↔ rules for every kind, only when, reorder, kinds), `cards.ts` (trail followers), `sections.ts`, `onlyWhen.ts`, `kinds.ts`, `presets.ts`, `surprise.ts` (Surprise me per kind), `words.ts`, `diagram.ts`, `miniSim.ts`, `dotSim.ts`, `actions.ts` (the store side: make, Back, setup params with their own undo steps, presets, clearing the graph, the builder groups, Start over).
- Advanced rules: `src/components/agentBuilder/AdvancedRules.tsx` (the card list), `src/components/agentRules/RuleEditors.tsx` (the When … Do … pieces, shared with the old rules editor).
- `src/components/builders/studio/`: `StudioShell.tsx`, `LiveViewport.tsx`.
- Under the hood: `src/agentBuilder/hood.ts` (channels, maps, highlights, texel ↔ walker ↔ picture), `src/components/agentBuilder/HoodView.tsx` (the panel, the ring and the card), `hoodStore.ts`, `src/lib/agentHood.ts` (requests), `src/lib/agentHoodGpu.ts` (thumbnails, one walker's read, picking), `AgentRunner.stateView` / `drawHood`.
- Legend, tags and focus: `src/agentBuilder/legend.ts` (the phrases, the entries, linking, the tag layout, the focus words), `src/agentBuilder/demos.ts` (the focus demos), `src/components/agentBuilder/ViewportLegend.tsx` (the legend, the tags, the demo panel).
- Follow a field: `src/agentRules/fields.ts` (the layers, their GLSL lines, the CPU function, own-expression checks, text), `generate.ts` (the Field block, slope Flow nodes, the rule's push or ride), `src/components/agentBuilder/FieldCard.tsx` (the card, the layers, the gallery tiles, your own), `KindDiagram.tsx` (the arrows), `legend.ts` (`fieldEntries`, `phrase.fieldLayer`), `demos.ts` (the `field` demo).
- `src/components/agentBuilder/`: `AgentBuilder.tsx`, `BehaviourCard.tsx`, `SectionCards.tsx`, `OnlyWhenLine.tsx`, `KindChips.tsx`, `SpeciesSpotlight.tsx`, `WalkerDiagram.tsx`, `KindDiagram.tsx`, `pictures.tsx`, `presetThumbs.ts`, `useLensRef.ts`, `useRuleSetEditing.ts`. They are loaded lazily by `BuilderWindowsHost`.
- Dragging: `src/agentBuilder/diagramDrag.ts` (pointer → value), `src/components/agentBuilder/DragHandle.tsx` (the handle, `DiagramEdit`).
- Text: `src/agentBuilder/strokeFont.ts` (glyphs, layout, distance, GLSL, SVG strokes).
- Where: `src/agentBuilder/where.ts` (the list, inside / outside, mask slots, adapters, food), `madeShapes.ts` (shapes as nodes, the stroke and pixel fonts), `whereActions.ts` (the store side: pick, read back, drag), `src/lib/regionValues.ts` (GPU values, thumbnails, the shaded region and its outline, slope arrows), `src/components/agentBuilder/WherePicker.tsx`, `RegionOverlay.tsx`.
- Trail channels: `src/agentBuilder/trailChannels.ts`, `src/components/agentBuilder/TrailChannels.tsx`. Look: `src/agentBuilder/look.ts`, `lookActions.ts`, `src/components/agentBuilder/LookSection.tsx`.
- `src/lib/previewMirror.ts`.
- Stepping: `src/agentBuilder/stepRun.ts`, `src/lib/agentSnapshots.ts`, `src/components/agentBuilder/AgentTransport.tsx`.
- The window state: `builders/windows.ts` (`agentBuilder`).
