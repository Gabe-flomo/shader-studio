# Agent Builder

The Agent Builder makes and edits an Agents group's walkers with pictures instead of When … Do … lines. It follows the field guide's Part 2: one step is **Sense → Steer → Move → Deposit**, after the walkers are **born**. The plan and its phases are in `docs/agent-builder-redesign-plan.md`. The rules underneath are in `docs/agent-rules.md`.

## Ways in

- **Builders → Agent Builder**, the canvas menu's Builders, or the Do… bar's "new agent rules": the start page. Nothing is added until you pick a kind.
- **Edit rules ↗** on a rules group's card, or a double-click on its title, opens the builder on that group. Trail followers (and Ants, a trail-follower preset) open in the builder. Particles, flocks, orbiters and crowds open the rules editor until their sections are built (phase 2).
- **"new 3d agents"** adds the 3D slime setup and opens it in the builder.
- The rules editor (`AgentRulesModal`) is still there, for advanced rules. It opens from the builder's top bar (`{}`, "All rules") and from the Advanced rules card.

## Start page: what are you making?

The start page shows four cards, each with a small moving picture: **Trail followers** (slime, ants, veins), **Particles**, **Flocks** and **Orbiters**. **Make it in 2D | 3D** sits above them. A card adds its setup to the graph, wired to the Output, as one undo step:

| Card | Rule set kind | 2D template | 3D template | Phase 1 |
|---|---|---|---|---|
| Trail followers | trail | Slime mold (with the example's Emit, Deposit 4 and 1024-row trail) | 3D slime | the builder |
| Particles | particles | Spark fountain | 3D curl smoke | opens the rules editor |
| Flocks | flock | Flock (boids) | 3D flock | opens the rules editor |
| Orbiters | swarm | Swarm: orbiters | Orbiters in 3D | opens the rules editor |

**Back** (top left) on a group made from the start page takes it away again and returns to the start page. Undo brings it back. **Add to graph** keeps it: it is already live in the graph. On a group that was already there, the button reads **Done**.

## The layout (shared builder shell)

`components/builders/studio/StudioShell.tsx` is the layout every builder will share:

- **Top bar:** Back, name, kind, panel toggles, **2D | 3D**, the builder's own buttons, and Add to graph / Done.
- **Left nav:** the walker kinds (when there is more than one species) and the sections. Each section shows a one-line summary.
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

## Viewport diagrams

Selecting a section draws its diagram over the live picture. Pointing at or dragging a setting lights its part, and the diagram moves with the slider.

- **Senses:** one walker up close, in a lens over the dimmed picture, with its three feelers. "How far ahead" is the centre feeler; "How wide" is the angle on the left and right. The feelers are labelled L, C and R, as in the field guide's figure 2.4. The lens keeps its magnification while you drag (`diagram.ts keepRef`), so the feelers grow and shrink. It only re-fits when the value moves far.
- **Turning:** the turn arc to the new heading ("turns 45° toward the smell") and the wobble's fan.
- **Moving:** the last steps behind the walker ("one step 0.0037") and how many steps it takes to reach its feelers. Pointing at **At the edges** draws the picture's edge with what happens there.
- **Trail:** the dots it left, fading by the half-life and spreading by Diffuse.
- **Born:** the birth shape at its true size on the picture, with the count.

The geometry is in `src/agentBuilder/diagram.ts`, and the drawing is `components/agentBuilder/WalkerDiagram.tsx`.

## Presets

The strip holds the trail templates and four slime variants from the field guide's table "What each setting does to the look":

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

- `src/agentBuilder/`: `cards.ts`, `kinds.ts`, `presets.ts`, `words.ts`, `diagram.ts`, `miniSim.ts`, `actions.ts` (the store side: make, Back, setup params, presets).
- `src/components/builders/studio/`: `StudioShell.tsx`, `LiveViewport.tsx`.
- `src/components/agentBuilder/`: `AgentBuilder.tsx`, `BehaviourCard.tsx`, `WalkerDiagram.tsx`, `pictures.tsx`, `presetThumbs.ts`, `useLensRef.ts`. They are loaded lazily by `BuilderWindowsHost`.
- `src/lib/previewMirror.ts`.
- The window state: `builders/windows.ts` (`agentBuilder`).
