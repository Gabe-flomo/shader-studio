# Agent Builder redesign and the shared builder layout: plan

The user's verdict (2026-10-09) on the current builders:

- They have too many words and too few pictures.
- They aren't clear about what a setting does.
- They aren't helpful even to people who already know the ideas.

For the Agent Rules window in particular:

- the Species / Rules / Trails / Look / Recipe tabs confuse;
- When / Do with only "always" makes no sense;
- "Mask: a number or a texture" and a free-text "trail channel" box explain nothing;
- "sensors ahead" and "sensor angle" mean nothing without a picture.

The user approved a mockup:

- a **start page** that picks the kind of walker, each with a small picture;
- a **shared layout** with:
  - the live viewport in the middle;
  - walker kinds and behaviour sections on the left;
  - illustrated settings on the right;
  - presets as picture cards along the bottom;
- **behaviour cards** instead of When / Do rules.

They also want **memory you can work with**: common ways to change a walker's memory (counters, timers, states…) and expressions.

Done already (#735):

- The Expression Builder is hidden.
- Agent Rules and the 3D Agent Builder are one **Agent Builder** (2D / 3D by its Space switch).

## The model to follow: the user's field guide

`Playfield-Field-Guide.pdf`, Part 2 (Agents), explains agents the way the builder should:

- **One step, in order:** Sense → Steer → Move → Deposit. There is also birth (Emit), life (Age / Life), forces (Integrate), species, memory and drawing.
- **One figure and two lines for each part.** Figure 2.4 is the walker with three sensors, *Distance* ahead at ±*Angle*, labelled. The caption: "the left sensor reads most, so Steer turns it left by Turn".
- **Its key ideas:**
  - "unwired means this walker": nodes inside the rule are read where the walker stands;
  - "many small rules, one big pattern".

The builder's sections, words and diagrams come from there. The diagrams are drawn in the app, not copied from the PDF. Readable text of Part 2 is in the session scratchpad (`pdf/agents-part2.txt`); regenerate it with PDFKit if needed.

## 1. The shared layout (every builder, specialised per builder)

```
┌ Back · name · kind ───────────────── 2D │ 3D ─ Add to graph ┐
│ Kinds        │                              │ Settings of   │
│ ● Green      │                              │ the selected  │
│ + Add a kind │       live viewport          │ section, with │
│ ──────────── │   (the real picture, plus a  │ plain names   │
│ Sections     │    diagram of the selected   │ and sliders   │
│ Born         │    setting drawn over it)    │               │
│ Senses  ◀    │                              │               │
│ Turning ...  │                              │               │
├──────────────┴──────────────────────────────┴───────────────┤
│ Presets: picture cards                                       │
└──────────────────────────────────────────────────────────────┘
```

- **Viewport first:**
  - it is always visible and live;
  - it holds the main canvas, as the explain view does (`lib/previewHold.ts`);
  - the side panels collapse;
  - on narrow windows the panels become drawers.
- **Diagrams in the viewport:**
  - Selecting a section, or hovering or dragging a setting, draws its diagram over the picture on one walker shown up close:
    - sensors as feelers, with distance and angle;
    - view radius as a ring;
    - max neighbours as the ones it counts, lit;
    - wander as a wobble;
    - turn as an arc;
    - speed as a step length.
  - Diagrams follow the slider as it moves.
- **Few words:** each setting has a plain name, a one-line hint on hover, and a "Learn more" that opens the field guide's paragraph.
- **In the app's style:** theme tokens, the app's controls (RulerSlider, Toggle, Select), its type and spacing. The mockup's look was only a sketch.
- **Built once** as a builder shell (`components/builders/studio/`): top bar, left nav, viewport slot, inspector, presets strip. Each builder fills the slots.

## 2. Agent Builder

### Start page: what are you making?

Cards with a small animated picture, each opening the builder with the sections and presets for that kind:

| Kind | Picture | Sections it shows |
|---|---|---|
| Trail followers (slime, ants, veins) | a walker sniffing a trail | Born, Senses, Turning, Moving, Trail, Life, Memory, Look |
| Particles (sparks, smoke, dust) | dots pushed by forces | Born, Forces, Moving, Life, Look |
| Flocks (boids, crowds, swarms) | arrows keeping together | Born, Neighbours, Turning, Moving, Look |
| Orbiters (galaxies, vortices) | dots circling a centre | Born, Orbit, Moving, Look |

The existing Kinds in `src/agentRules/spec.ts` map onto these, with Ants / carriers as a preset of Trail followers. Picking a kind also offers 2D / 3D.

### Kinds of walker (species)

The left panel lists walker kinds as colour chips ("Green", "Red"; rename inline; up to 4). Each has its own behaviours. Selecting a chip shows its sections, and the viewport lights its walkers.

### Behaviours, not rules

Each section holds **behaviour cards**:

- a picture;
- a name ("Turn toward its trail", "Wander", "Avoid each other", "Follow a flow", "Leave trail", "Bounce off edges");
- an on / off switch;
- two or three sliders.

The cards run top to bottom, and you drag to reorder.

- **"Only when…"** is an optional line on a card, e.g. "only when carrying food", "only when a neighbour is near", "only inside a shape", "only after 2 s". It replaces When / Do: most behaviours are simply on.
- **Under the hood** it is the same rule set (`agentRules/spec.ts`), generated into the same nodes, so Open as nodes, Play and web export keep working and old setups load. A card is a rule with one action. Its conditions are the "only when".

### Senses, Turning, Moving

These are the field guide's Sense / Steer / Move:

- **Senses:** "How far ahead" (distance), "How wide" (angle), and "Smells", chips for the trails it reads.
- **Turning:** "How sharply" (turn) and "Wobble" (jitter / wander).
- **Moving:** "Speed" and "At the edges" (wrap, bounce, slide).

### Trail

Trail channels are **coloured swatches you name** ("its trail · green", "food · yellow"). There are up to 4, there is no free-text box, and the viewport tints by channel. Settings are "Fades" and "Spreads", with a before/after strip.

### Where (masks)

"Where" is a picker of things in your graph: shapes, textures and node outputs, each with a **thumbnail**. You can also make a new shape (circle, box, text) on the spot. The viewport shows the region over the picture. It feeds Born ("born inside"), "only when inside" and obstacles.

### Memory (new)

Each walker carries numbers from step to step. Today there are two slots, both taken by the rules system (states and one Memory number). Ride a curve also needs one. Plan:

- **More slots:** grow per-walker memory to at least 4 named numbers, by widening the state-C texture or adding a state D. Find the cleanest way in the agent compiler (`compiler/agentGraph.ts`, AGENT_STATE_C_GLOBALS).
- **Named memories** with a type picture: counter, timer, on/off, a remembered value or position, a level that fades.
- **Common operations** as one-click cards:
  - count up when …;
  - start a timer, and "after N s";
  - toggle on …;
  - remember where it was when …;
  - add up what it smells;
  - decay over time;
  - reset when ….
- **Expressions** for anything else: a small line editor (`memory.food = memory.food * 0.98 + here.food`) with names autocompleted from the walker's senses and memories.
- **Use memory anywhere:** in "only when" (memory.food > 0.5), in Look (colour by a memory), and in other cards' sliders (speed × memory.energy).
- **Viewport:** walkers can be coloured by a memory while you edit it, so you see it change.

### Look

How walkers and trails are drawn:

- dots, streaks or glow;
- colour by kind, speed, a memory, or age;
- the trail's palette;
- in 3D, the camera.

The settings show their effect on the viewport directly.

### Presets

The bottom strip holds picture cards per kind (Slime, Ants + food, Two species, Veins, Predator…). They come from the existing templates (`agentRules/templates.ts`), and their thumbnails are rendered once and cached.

## Phases

| Phase | What | Done when |
|---|---|---|
| 1 | Builder shell (layout, collapsible panels, viewport slot with the hold, presets strip) + Agent Builder start page + Trail followers: Born, Senses, Turning, Moving, Trail sections as behaviour cards with viewport diagrams (sensors, turn, wander, speed) | A slime builds from the start page; the viewport diagram follows the Senses sliders; old rule sets open in it |
| 2 | Particles, Flocks, Orbiters sections (forces, neighbours with view radius / max neighbours diagrams, orbit); kinds of walker (chips); "only when" lines | Each kind's presets build; Open as nodes matches |
| 3 | Where (masks) picker with thumbnails; trail swatches; Look | A mask from a shape in the graph works |
| 4 | Memory: more slots, named memories, operation cards, expressions, memory in conditions / Look / sliders | An ants preset rebuilt with named memories (food, timer) |
| 5 | Move the 2D / 3D Scene Builders and Grid Rules onto the shell | |

Each phase is one PR with tests, checked in the browser (screenshots), in the app's style.

## Phase 1 status (2026-10-09)

Built (docs/agent-builder.md):

- **The shared shell** (`components/builders/studio/StudioShell.tsx`):
  - top bar (Back, name, kind, 2D | 3D, Add to graph / Done);
  - left nav with summaries;
  - live viewport;
  - right inspector;
  - presets strip.

  The panels fold (remembered, ⌘[ / ⌘]) and are drawers under 1100 px.
- **The live viewport** shows the main preview's own frames (`lib/previewMirror.ts`, sent by ShaderCanvas after each frame). The builder doesn't pause the main preview as the explain view does, because the agents' simulation only runs in the main pipeline: the main canvas keeps drawing under the window, and the builder copies its frames.
- **The start page:** Trail followers, Particles, Flocks and Orbiters, each with a moving picture (a small CPU simulation), and 2D / 3D. Trail followers is built. The other three make their template's setup and open the rules editor.
- **Trail followers' cards:**
  - Born: the Emit and the Count.
  - Senses: switch, How far ahead, How wide, Smells chips, Avoid it.
  - Turning: How sharply; Wobble with its own switch.
  - Moving: Speed, At the edges.
  - Trail: switch, Leaves, Fades, Spreads; Lays chips.
  - Advanced rules: everything else, opening the rules editor.

  The cards are the same rule set (`src/agentBuilder/cards.ts`). Old sets open as they are, and reading and writing back is lossless for every template.
- **Viewport diagrams** for every section: the feelers (figure 2.4) in a lens over the dimmed picture, the turn arc and wobble fan, the steps, the edges, the trail's fading dots, and the birth shape at true size. They follow the slider as it moves.
- **Presets:** 8 picture cards (the trail templates plus four slime variants from the field guide's table). Thumbnails are rendered once per session. A preset is one undo step.
- **Entry points:**
  - Builders → Agent Builder and "new agent rules" open the start page.
  - Edit rules and a title double-click open the builder for trail followers and ants, and the rules editor for other kinds.
  - "new 3d agents" opens the builder.

Not done yet, for phase 2 and later:

- Particles, Flocks and Orbiters sections (forces, neighbours with view radius and max neighbours diagrams, orbit), and a Crowd place on the start page.
- Kinds of walker as editable chips (add, rename, up to 4). Phase 1 only switches between existing species.
- "Only when…" lines on cards. Conditional rules are Advanced rules for now.
- Drag to reorder cards.
- Ants are mostly Advanced rules until Memory (phase 4) and "only when" exist.
- In the Born diagram, a 3D Emit's ball or shell is drawn flat.
- The lens shows the walker over the dimmed live picture, not a magnified crop. A crop of the middle was tried, but the middle is often the bright birth disc, which hid the diagram.
- Thumbnails are a CPU simulation of the cards, not GPU renders of each preset.

## Phase 2 status (2026-10-09)

Built (docs/agent-builder.md):

- **Every kind is a builder.** These open in the builder from the start page and from Edit rules, and their 2D groups are their example's own setup (Emit, Draw agents, palette):
  - Particles: Born, Forces, Moving, Life, Look.
  - Flocks and Crowds: Born, Neighbours, Turning, Moving.
  - Orbiters: Born, Orbit, Neighbours, Moving.
- **Crowds** has its own start card, built with the Flocks sections plus Head for and Slow in a crowd. It is a flock with a goal, but what you make looks different and starts from a different setup (two kinds walking opposite ways), so it gets its own picture and presets.
- **One card model for every kind** (`agentBuilder/behaviours.ts`): a card is an action of a rule with at most one plain condition. Every template of the new kinds (2D and 3D) and every new preset round-trips unchanged, with identical generated nodes.
- **Kinds of walker as chips:**
  - add (a copy, up to 4), rename in place, colour, remove; each kind has its own cards;
  - picking one lights its walkers in the viewport: the picture dims and the agent runner draws only that species, in 2D and through the 3D camera;
  - adding or removing a kind restarts the walkers, so births share them out.
- **"Only when…" lines** on every card, trail followers included: a neighbour is near, it smells …, inside / outside a shape, older than, by chance, in state.
  - "Inside a shape" is a new `shape` rule condition, also in the rules editor, the language and the Do… bar.
  - A shape is drawn on the picture; other conditions are a badge.
- **Drag to reorder** cards in Forces, Turning, Orbit and Orbiters' Neighbours (or ↑ / ↓ on the grip); a shared rule is split there. Switching a card off now splits its rule in place too, so the order is kept.
- **Diagrams:**
  - force arrows and their sum, the curl field, the attract point;
  - the view radius ring with the counted neighbours lit;
  - separation, alignment and cohesion, and the avoid-edges band;
  - the orbit circle with its direction;
  - brightness by age.
- **Phase 1 follow-ups:**
  - making a setup is an undo step of its own, and setup edits have their own steps per burst;
  - a 3D Born ball, shell or box is drawn through Draw agents' camera.
- **Presets** for each kind (5 particles, 5 flocks, 3 crowds, 5 orbiters), with thumbnails from a small CPU dot simulation of their cards.

Not done yet, for phase 3 and later:

- The Where picker (masks with thumbnails). "Inside a shape" is a circle or a box typed in; phase 3 should let you pick a shape from the graph and drag it on the picture.
- Look for the other kinds (only particles have it), and trail swatches.
- An "only when" holds one condition. Two (a state and a smell, as the ants have) are still Advanced rules, as are Memory conditions (phase 4).
- The 3D Born diagram is drawn through the camera as it starts. An orbiting camera moves on, so the outline drifts from the picture.
- The view ring's lens re-fits when the radius jumps to more than about twice or less than half the size it was fitted for, so after a big jump the ring is the same size again.
- The species spotlight draws each walker as a sharp 2 px dot without depth of field, so thousands of walkers of one kind become a cloud.
- A crowd in 3D is the flock's setup with the crowd's rules, and its goal points are on the picture's plane.

## Under the hood status (2026-10-09)

The user asked to see what the walkers look like and do in their textures. Built (docs/agent-builder.md "Under the hood"):

- **A panel under the live picture** (the layers button; remembered, closed by default) showing each state texture channel by channel, labelled with what it holds and colour-mapped by meaning: position as a gradient, heading as a hue wheel, speed and age as ramps, life with dead walkers black, kinds in their chip colours, memory as a heat map, deposits in the trail channels' colours. Each has a legend and its range. C and D only when the group keeps them; 3D shows x, y, z and the velocity.
- **The trail field's channels** as swatches, named and coloured as the Smells / Lays chips, with what reads and writes each.
- **Linking:** point at a texel and the walker is ringed on the picture with its numbers; click the picture and the nearest walker within 8 px is picked and its texel lit in every texture; Follow keeps the ring and the numbers on it; the selected section (or a kind chip) lights the channels it uses.
- **Cheap:** GPU-drawn thumbnails read back a few times a second without a stall, a 5-texel read for one walker, a one-texel GPU pick; nothing runs while the panel is closed. The runner has a read-only `stateView` for this.
- **The phase 2 loose end:** "Maximum update depth exceeded" after 60–80 quick key presses on a builder slider. Found and fixed: `NumberInput` (the ruler's number box) copied each new value into its text in an effect, one extra render per value. Key repeats, which the browser runs ahead of React's queued renders, piled those renders up past React's limit of 50. The text is now derived (typed text only while focused). Reproduced in the browser with real key repeats before the fix (the error at about the 50th press) and not after (100 presses each way); a test hammers the sliders and checks NumberInput renders once a value.

Not done yet:

- The memory heat maps are fixed at 0–1, and the deposit maps too: a memory that counts past 1 saturates. An automatic range (a GPU min / max) would fix it.
- The thumbnails sample every side ÷ 128-th walker; there is no zoom into a region of the texture.
- A 3D group without a live 3D Draw agents is placed as if seen from the front.
- The panel takes up to about half the viewport's height; it scrolls rather than resizes.

## Viewport legend and focus status (2026-10-09)

The user's feedback on a particles preset (gravity, curl and drag): the viewport is better, but its labels were spread all over the picture. They asked for a main viewport with clean panels, explanatory words worded from the values, hover linking to the controls, and a focus view that shows a behaviour in motion. Built (docs/agent-builder.md "Legend, tags and focus"):

- **One legend** in the viewport's corner (folds, remembered) listing what is drawn: a colour dot matching the drawing, the key numbers, and one plain line from the live values ("Gravity 0.25, pointing up: each particle is pulled upward; its speed that way grows by 0.25 a second."). The phrase generators are pure, one per behaviour, for every kind (trail followers, particles, flocks, crowds, orbiters).
- **Small tags** on the picture instead of the free-floating labels: a coloured dot and a number, laid out so they don't overlap each other or the legend. A tall legend moves the lens right.
- **Linking**: hovering a legend entry or a tag lights its drawing (the others dim) and scrolls to and pulses its control; pointing at a control lights its entry.
- **Focus**: clicking an entry or a tag fades the other drawings, shows only that card in the inspector with a little more about it, and plays a small looping CPU demo from the live values (gravity with and without, the curl field moving with a rider, drag side by side, attract paths, boids, the view ring, feelers on a trail, an orbit…). Esc or × leaves.
- **Light**: the demos run only in focus; the legend is rebuilt only when its values change.

Not done yet:

- The curl phrase doesn't give the eddies' size in picture units: the GPU Curl noise's scale isn't the diagram's field, so "eddies 1.4" stays the Eddies setting with "bigger: smaller, busier swirls".
- The demos are pictures of the rule, not the GPU result, and their scale is the demo's own (the view ring is not drawn at the live radius).
- The focus demo panel can cover the lens's bottom-right in a short viewport.
- Look has no legend (it draws nothing on the picture).
- **For the field builder** (pick, combine or write vector fields), the seams: the curl demo (`makeDemo`, demos.ts) rides particles through a field given as a function of position and time (`curlAt`), so a field builder can add a `field` demo kind that rides particles through the composed field; a legend entry is a plain object (`LegendEntry`) with a colour, numbers, a line and a demo, so a composed field can be one entry per layer; `curlArrows` (diagram.ts) draws the curl field over the picture; taking a field function instead of calling `curlAt` would let it draw any field.
