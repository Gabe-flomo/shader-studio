# Glossary: one word per idea

The app's chrome (page tabs, rail names, shortcut labels, menu rows, toolbar tooltips, lessons)
uses one name for each idea below. `src/lib/glossary.ts` holds the same list as data, and
`src/lib/__tests__/glossary.test.ts` fails when a retired word comes back into the chrome.

Node labels live in the node definitions; their rules are under "Node labels" below. Node categories are not covered here yet.

## The names

| Say | It means | Don't say |
|---|---|---|
| **Code** | The top-level page for code, with four tabs: Shader · Convert · Functions · Node packs | GLSL (as a page), Builder (as a page) |
| **Shader** | Code page tab: write a fragment shader by hand, run it, explain it, discover functions in it | the GLSL page, the GLSL editor |
| **Convert** | Code page tab: turn GLSL into nodes | |
| **Functions** | Code page tab: plot and compose functions, then send them to the graph | Builder, Function Builder (in navigation) |
| **Node packs** | Code page tab: make and share packs of node types | |
| **Builder** | Only the Scene builders (2D, 3D, Agents, Grid, Splat, Time Cube, Warp) that write a graph for you | |
| **Publish node** | Turn a graph, group or GLSL into your own node type (the sidebar panel) | Node Builder |
| **Import shader** | The top bar button: a `.glsl` file becomes a node in the graph | GLSL (as a button) |
| **Generated code** | The graph's own GLSL, in the drawer under the Studio canvas (⌘\\) | GLSL code, GLSL output |
| **Finish** | The graph's one stack of effects over the whole picture (grade, lens, film, time), after the graph. Play → Finish, the Studio's Finish button (phones: ⋯ → Finish…) and a builder's Look → Finish all edit it. Its effects are *Finish effects*, its presets *Finish presets* (the grade's Looks are built-in Finish presets) | Look (for the rail, the stack or its effects), Finish stack (as a preset kind) |
| **Effects** | Effect nodes in the graph: the node library's Effects, a builder's Effects page, the built-in effect groups in the Library. Also Sound's tab of effects on each sound and the master | |
| **Look** | Only a section inside one builder or layer editor: how that one thing is drawn | |
| **Controls** | Play's section of sliders, buttons and pads people play, beside what drives them | Inputs, Mappings (as a section) |
| **Sources** | What drives a control: a key, a knob, the mouse, a hand, an LFO. The list of them is titled *Sources*. A *mapping* is one source → control row | Inputs, Mappings (as a title) |
| **Inputs & media** | The node library row of UV, Time, Mouse, Texture, MIDI and data nodes (category `Sources` in the definitions) | Sources (as a node row) |
| **Sound** | Play's section for the Audio engine. Its tabs: **Arrangement** (racks, the tape) and **Effects** (the effects on each sound and the master) | Engine (as a section), Sound (as its own tab) |
| **Rules** | Play's When/Do section. A *signal* is one event a rule listens for | Signals (as the section) |
| **Set a control · Nudge a control** | A rule's Do on a control's own value, as if its slider moved: *Set* puts it at a value, *Nudge* adds a step (stopping at the ends, or *wraps round*); a switch flips. They need no layers | Jump a control, Increment (that is a mapping's Step) |
| **arrives** | How a rule with no When of its own reads when other rules send it: "When ‹Reached› arrives · sent by …" | Nothing yet (for a rule that is sent) |
| **MIDI file · Pad grid** | Source kinds in Sources' **+ Map** picker (under MIDI), one of each per setup; their cards sit in the Sources column, folded to one line until opened | MIDI file page, Pad grid page (they are not Controls sub-tabs) |
| **Record video** | The top bar Record's first tab, and Stage's **Record video**: the picture rendered or recorded to a video file, or a Snapshot PNG | Video (as the tab) |
| **Stage** | Play's view of one setup on its own, as people will play it: the picture on the right, **Perform** on its left (Full), or the website player itself (Exact) | Present (for the Stage), Presentation mode |
| **Perform** | The Stage's default view of the controls: big faders, knobs, switches, XY pads, colour swatches and pads in an S / M / L grid, with no edit icons, and a bar with Randomize, Reset, Panic and takes (`docs/perform-mode.md`) | Performance mode, Live mode |
| **Randomize · Reset · Panic** | Perform's bar. *Randomize* moves every control by up to its Strength (one undo step); *Reset* puts them back where they were when the Stage opened; *Panic* stops all sound and lets go of held keys, pads and actions | Shuffle (for Randomize), Stop all (for Panic) |
| **Record performance (take)** | The top bar Record's second tab, and Stage's button: your moves kept as keyframes (a *take*), to watch back and export as a video | Performance (as the tab), Record a performance, Start performance |
| **Takes** | The recorded performances. Their home is **Sound → Arrangement → Takes** (watch it back, rename, delete, **Export video…**, and **From the tape**); Record and Stage list them too | Render… (as a take's button), Make a take (as a transport button) |
| **Arm track** | The ● on a Sound track: the transport's Record records the armed tracks onto the tape | Record enable |
| **Behaviours** | Ready-made rules and sources (pinch to burst, pulse to the beat) in one library: the Rules header, the Rules start pane, and the Controls and Sources empty states | Templates, Recipes (for these) |
| **Next** | The one suggestion surface: next moves for the selected node, learned from your graphs | |
| **App settings** | The app's own preferences, in the top bar's ⋯ menu | |
| **Library** | What you saved that goes on the graph (group presets first, My nodes, functions, Expression Blocks, transforms, palettes) and your media, drawn like the Nodes list: the sidebar entry, Files → Library (`docs/library.md`). Saved graphs are the top bar's **Load** | Saved Graphs, Saved Keyframes |
| **Storage** | How much is saved and where: the workspace folder, backups, export and import of everything (the Files page only) | Library (for the space meter) |
| **Nodes reference** | Every node type with its sockets, a live picture and its GLSL, under Help | |
| **colour** | UI copy spells it the British way | color |

## Decisions and why

- **Builder → Functions, inside Code.** "Builder" meant three things (a top tab, the palette's
  Scene builders, the rail's Node Builder). It now means only the Scene builders. The function
  plotter and the node packs join the shader editor and Convert as tabs of one **Code** page.
- **Node Builder → Publish node.** The panel publishes the graph (or GLSL) as a node type; "My
  nodes" is already the palette's row of the results, so the panel is named for the action.
- **Look → Finish.** The rail said *Look*, its title, the ⌘3 label (now ⌘4) and the code all said
  *Finish*, and "Look" is also a section in every builder. Finish wins because the codebase, the
  shortcut and the docs (`docs/finish-stack.md`) already use it.
- **One Finish, two layers.** *Effects* are nodes in the graph (and a builder's Effects page adds
  them); the *Finish* is one whole-picture stack per graph. Play's rail, the Studio's Finish
  button and the builder's Look → Finish card are one component on that one stack; the builder's
  older Grade cards, vignette and grain move into it on Build (Pro). Looks and the starting
  stacks are built-in *Finish presets*; the effect groups (Long exposure, Trails…) build nodes, so
  they stay *Effects*.
- **Inputs / Mappings → Controls, with Sources inside.** The rail category is **Controls** (⌘1
  "Go to Controls"). Its sources column, the desktop drawer and the phone tab are **Sources**
  (⌘⇧M "Go to Sources": it opens that list directly, so it stays, under its own name). The
  shortcut ids (`railControls`, `gotoMappings`, `railEngine`, `railSignals`) are older than the
  names and stay, so rebindings keep working.
- **Sources (Play) vs Sources (node category).** Play's *Sources* is part of its model (sources
  and routes, `docs/sources-and-routes.md`) and appears all over the Play page, so it keeps the
  word. The node library row is shown as **Inputs & media** (`ROW_LABELS` in
  `components/NodeGraph/libraryRows.ts`); the definitions keep the category id `Sources`.
  "Inputs" alone was avoided for the row because a node's sockets are its inputs.
- **Engine → Sound.** ⌘5 (⌘4 until 2026-10-18) and the tab strip now say Sound, like the rail. "Audio engine" is still
  the name of the rack system inside it.
- **Sound's Sound tab → Effects** (2026-10-18). The section was Sound and its effects tab was
  Sound too. The tab is named for what it holds; in context it can't be mistaken for effect nodes.
- **Looks live in Presets** (2026-10-18, Play audit P17). The Grade card had a Look picker of its
  own beside the Finish's Presets button: two preset systems for one stack. The Presets menu now
  holds them all: *Your looks*, the built-in *Looks* and the *Starting stacks*, with *Save the
  Grade as a look…* beside *Save stack as preset…*. The Grade card only says which look it's on.
- **Set a control / Nudge a control** (2026-10-18, Play audit P11). With no layers a rule could only
  send a signal. "Set" and "Nudge" are what the reaction does to the control, in the words the
  rest of the Do list uses (Burst, Pulse, Set a setting); "Increment" stays the mapping's Step.
- **Three recordings, three names** (2026-10-18, Play audit P8). "Record" meant the top bar's
  dialog, a ⦿ in the Controls toolbar, and the red button in Sound's transport. Now the top bar's
  **Record** opens **Record video** and **Record performance (take)** (Stage has both too), and the
  transport's red button records the tracks you **Arm**. The Controls-toolbar duplicate is gone, and
  so is the transport's "Make a take" ●: it is **From the tape** in the Takes section. A take's
  *Render…* is **Export video…**, since that is what it gives you.
- **MIDI file and Pad grid are sources** (2026-10-18, Play audit P10). They were Controls sub-tabs
  (a whole page for one button, in the MIDI file's case). Now they are kinds in **+ Map** like every
  other source, so Controls has no middle tab level. Saved setups keep `midiFile` and `padGrid` as
  they are; their cards show in Sources.
- **Signals → Rules.** Only the shortcut id said Signals (its label already read "Go to Rules").
  "Signal" stays as the word for one event (a layer's *Signals out*, the built-in signals).
- **colour.** The app's prose already leans British. Chrome strings say colour; node labels are a
  later pass, so "Add Color node" (the node's own name) is allowed.

## Option names (2026-10-19)

A select's options are short plain names: **Glow**, **Haze**, **Bounded**, not *Glow (exp)* or *Haze (1 / (1 + k·d²))*.
The formula goes in the option's hint (its tooltip) and in the setting's **?** help. A qualifier stays only where two
names would clash. The saved `value` ids never change, so graphs keep working.

A choice that is no longer offered is **retired**: it leaves the list, the builders, the Do bar and Randomize (a
ParamDef's `retiredOptions`), but a graph that already uses it still compiles the same and its card reads
**Ring light (retired)**. Say *retired*, not removed or deprecated.

In a gradient, **Wrap** and **Mirror** say how a periodic driver (Angle) goes round: Wrap blends the last stop back
into the first, Mirror runs there and back. **From** and **To** are the driver's values at the bar's two ends; their
sockets are **‹Setting› from** and **‹Setting› to** (Tint from, Tint to).

## Page ids

Old page ids still work (deep links, `requestPage`, saved state): `glsl`, `convert` and `fn` open
the Code page on the matching tab, `code` opens it on the last tab used, and `shortcuts` is the
keyboard shortcuts page reached from Help.

## Node labels (2026-10-17)

Node labels follow these rules now (the catalogue sweep, `docs/node-retirements.md`). Type ids never change, so
saved graphs, the Do bar's type names and code keep working; every renamed node keeps its old label as an alias, so
search and `create …` still find it by the old name.

| Rule | Examples |
|---|---|
| **Colour**, British, in labels too | Colour, Colourize, Colour Ramp, Add Colours, Glow to Colour, Normal to Colour, Float → Colour |
| **Neighbour(s)**, one spelling | Neighbour Distance, Neighbour Offset 2D (beside Neighbours, Read Neighbours (texture)) |
| **Title Case** for every label; a trailing tag stays lower case | Draw Agents, Trail Field, Value at Point, Band Level, Jump Flood (texture), Slime Mold (preset) |
| **2D shapes keep "SDF"** (Circle SDF, Box SDF, Shape SDF…): it is how the Learn chapters introduce distances | Circle SDF, Ring SDF, Line Segment SDF |
| **3D and 4D shapes drop "SDF"** (every one of them is a distance); **"3D"** only where a 2D node has the same name | Sphere, Torus, Capsule, Cylinder, Plane, Box 3D (beside Box SDF), Tesseract, 16-Cell, Quaternion Julia |
| **Plain words first, the jargon as an alias** | Light Scattering (Phase (HG)), Skin Glow (Fake SSS), Fold Fractal (IFS Fractal), Lattice Surface (Schwarz-P Field), Cross (SD Cross 3D), Every Nth (Mod Select) |

Short-word labels that are GLSL itself stay (Sin, Fract, Mix, Smoothstep): they are what a shader writer types.
Every description is at least a full sentence saying what the node is for (the 21 that were a few words were
rewritten); `nodeWording.test.ts` checks they name sockets and settings by their labels.
