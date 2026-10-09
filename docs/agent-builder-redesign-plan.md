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
