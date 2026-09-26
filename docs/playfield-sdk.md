# Playfield as a platform: an SDK for nodes, layers, mappings and feeds

A note to think with, not a build plan. The question: what would it take for
other people (and other companies) to add to Playfield reliably, the way they
add plugins to a DAW or effects to a video editor, instead of forking it?

## What the product already is, seen as layers

Reading the code top to bottom, Playfield is four things stacked, each with a
clean-ish boundary that an SDK could formalise:

1. **The GLSL layer.** Node definitions are data plus one function:
   `generateGLSL(node, inputVars) → { code, outputVars }`, with sockets,
   params and optional helper functions. The compiler orders nodes, resolves
   wires to variable names, patches sliders into uniforms and assembles one
   fragment shader. A node definition never touches React, the store or
   WebGL. This is already an API; it just isn't published or versioned.
   Published user nodes, Custom Functions and the GLSL importer all go
   through it today.
2. **The card layer.** What wraps a node on the canvas: sliders, keyframes,
   colour pickers, inline previews, bypass, the type pills, group surfacing.
   All of it keys off the definition's `paramDefs` (now per instance too,
   via `paramDefsFor`). A third-party node gets all of this for free by
   describing its params; it can't (and shouldn't) draw its own card.
3. **The Play layer.** Controls (a param or a group of params with a range
   and a name), mappings (a source such as MIDI, audio bands, a null, a
   keyboard, a sensor → a control, through a curve), and layers (JavaScript
   objects drawn over or under the shader, or feeding it: particles, shapes,
   text, audio, camera, bodies). Layers talk to the shader through a small
   set of channels: uniforms they write per frame, textures they hand over,
   and the Layers node that reads their colour/alpha/distance back into the
   graph.
4. **The host layer.** Storage (library, backups), recording, Present mode,
   the desktop shell (Tauri) with its folders and file dialogs, and now the
   Convert page.

The seams between 1–2 and 2–3 are where an SDK lives. The host layer stays
ours.

## The SDK, in four definitions

An add-on is a JavaScript (or TypeScript) module that exports registrations
built with a small typed API. Nothing in it is guessed: each registration is
validated against a schema at install, and the app refuses (with a reason)
anything that doesn't fit.

```ts
import { defineNode, defineLayer, defineMapping, defineFeed } from '@playfield/sdk';

export default definePlugin({
  id: 'com.example.ripples', version: '1.2.0', playfield: '>=1.0 <2',
  nodes:    [defineNode({ … })],
  layers:   [defineLayer({ … })],
  mappings: [defineMapping({ … })],
  feeds:    [defineFeed({ … })],
});
```

- **`defineNode`** is today's `NodeDefinition`, frozen and versioned: type
  id (namespaced by the plugin), sockets, params (`paramDefs`, or
  `paramDefsFor` for per-instance ones), `generateGLSL`, helpers. Contract:
  the function is pure, emits GLSL ES 1.00, names its outputs, and reads
  params through the `p()` helpers so sliders stay live. The compiler's
  existing checks (unknown identifiers, type mismatches, helper collisions,
  the dead-helper pass) become the validator. A node can also be declared as
  *code only*: a GLSL function with a signature, which the importer already
  turns into a node.
- **`defineLayer`** is the JavaScript side. A layer declares its **params**
  (the same `paramDefs` schema, so it gets the same editors, keyframes and
  Play controls), its **channels** (which uniforms it writes, which textures
  it provides, whether it exposes colour/alpha/distance to the Layers node),
  and lifecycle hooks: `create(ctx)`, `update(ctx, dt, inputs)`,
  `draw(ctx, target)`, `dispose()`. `ctx` is a capability object, not the
  app: a 2D or WebGL surface of the right size, a clock, the current param
  values, the mapped inputs, and a way to publish values other layers or
  controls can read. A layer never sees the store or the DOM.
- **`defineMapping`** is a source of numbers over time: `open(ctx) →
  { read(): Record<channel, number>; close() }` plus a description of its
  channels (name, range, kind: continuous / trigger). MIDI, audio bands,
  gamepads, OSC, a web socket, a stock ticker, a heart-rate monitor all fit.
  The Play page shows a new source exactly like MIDI today; the mapping
  curve, smoothing and control binding are the app's.
- **`defineFeed`** is media coming in: a video element, a camera, a texture
  the plugin renders, a frame stream from an API. It publishes a texture and
  optional metadata (size, timestamp); the graph reads it through the
  existing Texture Input / Video Input nodes, layers can composite it.
  "Feed a video in over the network and render on top of it" is a feed plus
  a layer.

Everything a plugin adds shows up where the built-in equivalent shows up
(palette, Play sources, layer picker), tagged with the plugin's name, and is
saved in graphs by namespaced id so a graph that uses a missing plugin says
what to install rather than breaking silently.

## What makes it reliable rather than a guess

- **Schemas, not conventions.** Each definition kind has a JSON schema
  (params, sockets, channels). Validation runs at install and at load; the
  error names the field.
- **Capability contexts.** Layers and mappings get objects that expose only
  what they may do (draw here, read these inputs, publish these values). No
  store, no DOM, no other plugin's state. This is also what makes a plugin
  from another company acceptable to run.
- **Versioned contracts.** The SDK version is in the plugin; the app declares
  what range it supports; the compiler and the layer runtime are tested
  against a corpus of plugins (the built-in layers and nodes are the first
  corpus, moved behind the same API).
- **Pixel proof for nodes.** The converter's render-equivalence harness
  applies to any node: a plugin can ship a reference shader and the test
  says whether the node renders it.
- **Sandbox where it matters.** In the browser build a plugin is a module
  loaded from a URL or a file; on desktop, from a folder in the library.
  Running third-party JavaScript in-process is the DAW model (VSTs run in
  process too); the capability contexts limit what a mistake can reach, and
  a worker-based runtime for layers is the later hardening step if needed.

## Installing

A plugin is a folder or a single-file bundle with a manifest. "Add-ons" in
the Library panel: install from a file, a URL, or (later) a directory the app
lists. Installed plugins are stored with the library, backed up with it, and
listed in the stats. Disabling one removes its registrations; graphs that
used it keep their nodes as placeholders with the plugin id shown.

## The path, if we take it

1. **Freeze what exists.** Publish `NodeDefinition`, `ParamDef` and the
   `p()` helpers as `@playfield/sdk` types, generated from the app's own.
   Move two built-in nodes and one built-in layer behind `defineNode` /
   `defineLayer` to find out what the API is missing. No new surface yet.
2. **Layers as plugins.** Give layers the capability context and the
   channel declarations; port the built-in layers to it one by one. This is
   the largest piece and the one with the most value: it's where video
   feeds, camera effects and custom compositing live.
3. **Mappings and feeds.** Smaller, mostly plumbing onto Play's existing
   source list and the texture inputs.
4. **Install flow and manifest.** Library panel, validation errors, the
   placeholder node for missing plugins.
5. **Docs and a starter repo.** A template plugin with one of each
   definition, the test harness wired up, and the pixel-proof step.

## Open questions

- Is a plugin's JavaScript trusted on the desktop the way a VST is, or does
  it run in a worker with message-passing from day one (safer, harder for
  drawing-heavy layers)?
- Do we let plugins add *cards* with custom UI, or only params (the current
  position: params only, which keeps every card consistent and keeps plugins
  small)?
- Naming: the product is Playfield; the SDK package, the plugin manifest key
  and the file extension should say so from the start.
