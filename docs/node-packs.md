# Node packs

A node pack is a set of your node types in one `.playfile`
([playfile-format.md](playfile-format.md)), signed by you and optionally
sealed, with the things that show how to use them alongside: example graphs,
presentations, GLSL shaders, background images and notes. Making one is Pro
(`nodes.pack`); opening one is Free (`nodes.import`).

## Where

**Builder → Node packs.** The Builder page has two tabs, *Functions* (the
Function Builder) and *Node packs* (the pack workspace).

**Pop out.** The Builder page's *Pop out* button moves the whole Builder into a
window that floats over every page, so you can build nodes beside the graph
that uses them. Drag it by its title bar, resize it from any edge or corner,
double-click the title bar (or the panel button) to snap it to the right edge as
a full-height panel, and *Dock* to put it back in the Builder page. Its place
and size are remembered on the device. On phones it's a full-screen sheet
(also in the phone menu: *Builder: functions and node packs*).

It's the same builder in both places, reading the same stores, so nodes
published from the window show up in the node list, the Studio and the Builder
page at once. The desktop app uses the same in-app window: a second macOS
window would be a second webview with its own copy of every store, and edits
wouldn't be shared without a sync layer.

Code: `src/components/nodePacks/` (`BuilderShell`, `BuilderWindowHost`,
`builderWindow.ts`, `PackWorkspace`, `PackExportDialog`, `InstalledPackCard`)
and `src/nodePacks/` (the model, assembly, storage, app wiring).

## Making a pack

*New node pack* makes a pack project. Every edit is saved as you go
(`shader-studio-nodepack:<id>` in localStorage, so projects travel in library
ZIPs and profiles like the rest of the library). A project holds references
(node type ids, graph and presentation names, shader and image ids) plus a copy
of each node type as it was when added, so the pack still exports if a node
type is deleted.

- **About the pack:** name, author (your display name, signed into the file),
  version (`major.minor.patch`), description (markdown), colour and glyph,
  licence text, and *Sealed*. Packs are always signed, with your per-author
  key (made on the device at the first export).
- **Nodes:** *Add node* opens the node builder (the publish dialog):
  - *Write a new node (GLSL)*: from scratch;
  - *From a saved graph*: what's wired into its Output becomes the node (UV
    nodes become a UV input);
  - *A group in a saved graph*: pick the graph, then the group (nested groups
    are listed with their path); its ports become the node's sockets and you
    choose which sliders stay live;
  - *A group preset*, *A Custom Function*, *An Expression Block*: from the
    library;
  - *A node you published*: added as it is.

  Each node is a card with its thumbnail (rendered with its defaults), its
  input and output sockets, where it came from, whether it compiles, and any
  problems. Rename (the name in the pack), reorder, remove (the node type
  stays), or *Edit* (reopens the node builder on its source; publishing again
  updates the node type in place).
- **Extras:** saved graphs (examples), presentations, GLSL shaders from the
  GLSL page, background images, notes (markdown), and **Finish effects** (custom
  effects from Your effects, carried in the nodes item's `finishEffects`,
  sealed when the pack is; see finish-stack.md). A pack can hold only Finish
  effects. The workspace
  **suggests** the graphs the nodes came from (*Include the graphs these nodes
  came from*) and the presentations linked to included or suggested graphs
  (`linkedPresentations`, by id or name).

### Validation

Shown on the pack, each node card and each extra (`validatePack`):

- errors (block the export): no name, a version that isn't three numbers, no
  nodes, a node that doesn't compile (it's compiled into a graph with an Output
  by the real compiler), a node type that's gone with no copy kept, no outputs;
- warnings: an example graph that uses a published node that isn't in the pack
  (with *Add the nodes it uses*), a graph or file that isn't here any more (it
  is left out), a node type deleted here (the kept copy is used), and, in a
  sealed pack, a graph that holds how a node is built (anyone who opens it can
  read that code);
- notes: a name clash inside the pack, a built-in node with the same name.

### Namespacing

Every node in a pack is listed under a node-list category named after the
pack, so nothing outside the pack can clash by name. Inside it, two nodes with
the same name are told apart as "Name 2", "Name 3" in the pack's order
(`namespaceLabels`). Node ids (and so GLSL function names) never change: the
example graphs refer to the nodes by id and keep working.

## Exporting

*Export…* shows a summary before anything is written: each item and its size,
what's sealed, who signs it and with which key, and the version it carries.
The first export keeps the project's version; exporting again suggests the next
patch version (`nextExportVersion`), with buttons for the next patch, minor and
major. Reusing a version that has gone out already is flagged. After the
download the project remembers the export (version, time, signer, sealed, size)
and moves to that version.

The file is written by the one `.playfile` writer:

```
manifest.json
nodes/<Pack>.nodes.json        { "version": 1, "nodes": [UserNodeDefinition…], "pack": PackInfo }
graphs/<Example>.graph.json    meta.example = true
presentations/<Title>.present.json
glsl/<Name>.glsl               meta.group = the pack's name
backgrounds/<Name>.png
videos/<Name>.webm             when an example graph's Video layers use one
```

`pack` in the nodes item is the pack's description: `id`, `name`, `version`,
`author`, `description`, `color`, `icon`, `licence`, `notes` (markdown, by
name) and the names of its `examples` and `presentations`. Readers that don't
know it still import the node types. The item's manifest `meta` carries
`pack: { id, name, version }` too.

Sealing works as for any node pack: in a sealed pack every node's GLSL is
encrypted and no node carries its source; nodes that came from a sealed pack
stay sealed whatever the setting.

## Opening a pack

Opening a pack (Import, drop, double-click on the desktop) shows the usual
import preview, with the pack's name, version, description, licence and notes
at the top and its node types first. On import:

- its node types are registered under the category named after the pack (an
  existing node type with the same id is updated in place: a newer version of
  the pack replaces the older one);
- its graphs and presentations come in as saved graphs and presentations, but
  aren't opened: they're the pack's examples;
- the pack is remembered (`shader-studio-nodepacks:installed`): the node list
  shows the category with the pack's glyph, and at the top of it the pack's
  entry, with who signed it, its description, its example graphs and
  presentations one click away, and its notes and licence.

## Tests

`src/nodePacks/__tests__/nodePacks.test.ts`: nodes from a Custom Function, an
Expression Block and a group in a saved graph; project edits and storage;
namespacing; dependency collection (source graphs, linked presentations,
unresolved nodes); validation; versions and re-export; assembly; a sealed pack
compiling on another machine; the import recording the pack's category and
examples (renamed ones too); a newer version updating in place; and Video
layers' files travelling in `.playfile` exports.
