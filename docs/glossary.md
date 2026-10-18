# Glossary: one word per idea

The app's chrome (page tabs, rail names, shortcut labels, menu rows, toolbar tooltips, lessons)
uses one name for each idea below. `src/lib/glossary.ts` holds the same list as data, and
`src/lib/__tests__/glossary.test.ts` fails when a retired word comes back into the chrome.

Node labels and node categories live in the node definitions and are **not** covered here yet.
They get their own pass later (so the `Color` node, `Color Ramp` and the category ids stay as they
are for now).

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
| **Finish** | Play's stack of effects over the whole picture: grade, lens, film, time. Its effects are *Finish effects* | Look (for the rail, the stack or its effects) |
| **Look** | Only a section inside one builder or layer editor: how that one thing is drawn | |
| **Controls** | Play's section of sliders, buttons and pads people play, beside what drives them | Inputs, Mappings (as a section) |
| **Sources** | What drives a control: a key, a knob, the mouse, a hand, an LFO. The list of them is titled *Sources*. A *mapping* is one source → control row | Inputs, Mappings (as a title) |
| **Inputs & media** | The node library row of UV, Time, Mouse, Texture, MIDI and data nodes (category `Sources` in the definitions) | Sources (as a node row) |
| **Sound** | Play's section for the Audio engine (racks, the arrangement) and the effects on the sound | Engine (as a section) |
| **Rules** | Play's When/Do section. A *signal* is one event a rule listens for | Signals (as the section) |
| **Next** | The one suggestion surface: next moves for the selected node, learned from your graphs | |
| **App settings** | The app's own preferences, in the top bar's ⋯ menu | |
| **Library** | Everything you save, in one place, with type filters: the sidebar entry, Files → Library, the top bar's folder button (`docs/library.md`) | Saved Graphs, Saved Keyframes |
| **Storage** | How much is saved and where: the workspace folder, backups, export and import of everything (under the Library; the Files page) | Library (for the space meter) |
| **Nodes reference** | Every node type with its sockets, a live picture and its GLSL, under Help | |
| **colour** | UI copy spells it the British way | color |

## Decisions and why

- **Builder → Functions, inside Code.** "Builder" meant three things (a top tab, the palette's
  Scene builders, the rail's Node Builder). It now means only the Scene builders. The function
  plotter and the node packs join the shader editor and Convert as tabs of one **Code** page.
- **Node Builder → Publish node.** The panel publishes the graph (or GLSL) as a node type; "My
  nodes" is already the palette's row of the results, so the panel is named for the action.
- **Look → Finish.** The rail said *Look*, its title, the ⌘3 label and the code all said
  *Finish*, and "Look" is also a section in every builder. Finish wins because the codebase, the
  shortcut and the docs (`docs/finish-stack.md`) already use it. The two Finish systems (Play's
  stack and the builder's Look → Finish section) merge in a later round; this round only names
  them the same. Saved *Looks* presets keep their name for now: they are Finish presets.
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
- **Engine → Sound.** ⌘4 and the tab strip now say Sound, like the rail. "Audio engine" is still
  the name of the rack system inside it.
- **Signals → Rules.** Only the shortcut id said Signals (its label already read "Go to Rules").
  "Signal" stays as the word for one event (a layer's *Signals out*, the built-in signals).
- **colour.** The app's prose already leans British. Chrome strings say colour; node labels are a
  later pass, so "Add Color node" (the node's own name) is allowed.

## Page ids

Old page ids still work (deep links, `requestPage`, saved state): `glsl`, `convert` and `fn` open
the Code page on the matching tab, `code` opens it on the last tab used, and `shortcuts` is the
keyboard shortcuts page reached from Help.
