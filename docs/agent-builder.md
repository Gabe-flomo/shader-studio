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

## Presets

Each kind has its own strip:

- Particles: Spark fountain, Smoke, Snow, Drain, Burst.
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

## Files

- `src/agentBuilder/`: `behaviours.ts` (cards ↔ rules for every kind, only when, reorder, kinds), `cards.ts` (trail followers), `sections.ts`, `onlyWhen.ts`, `kinds.ts`, `presets.ts`, `words.ts`, `diagram.ts`, `miniSim.ts`, `dotSim.ts`, `actions.ts` (the store side: make, Back, setup params with their own undo steps, presets).
- `src/components/builders/studio/`: `StudioShell.tsx`, `LiveViewport.tsx`.
- `src/components/agentBuilder/`: `AgentBuilder.tsx`, `BehaviourCard.tsx`, `SectionCards.tsx`, `OnlyWhenLine.tsx`, `KindChips.tsx`, `SpeciesSpotlight.tsx`, `WalkerDiagram.tsx`, `KindDiagram.tsx`, `pictures.tsx`, `presetThumbs.ts`, `useLensRef.ts`, `useRuleSetEditing.ts`. They are loaded lazily by `BuilderWindowsHost`.
- `src/lib/previewMirror.ts`.
- The window state: `builders/windows.ts` (`agentBuilder`).
