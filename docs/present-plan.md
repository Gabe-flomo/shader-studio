# Present: a page for teaching with Plays

Written so a later session can pick it up without the conversation that
led to it. Status: **milestones 1–5 built** (26 Sep 2026), with the
sandboxed frames from milestone 6; live script blocks, Stage from a step
and the pop-out window are left. Section 7 says what shipped and where it
differs from the plan below.

## 1. The idea

A new **Present** page for teaching a concept step by step, instead of
pointing someone at the Book of Shaders. You build graphs and their Play
setups as usual, then compose them into a **presentation**: a sequence of
steps, each made of blocks. The blocks are:

- **Text**: Markdown with LaTeX maths.
- **Render**: a Play's picture on its own, no controls. You choose the size
  and shape of the canvas.
- **Interactive**: text next to a Play's picture, with a hand-picked subset
  of its controls, relabelled for the lesson ("notice how, when you drag
  *Frequency*, the rings…"). If a control has mappings in that Play, the
  block shows them ("press K", "move the mouse", "an LFO drives this").
- **Code**: a GLSL or JavaScript snippet, typed in or taken from a Play (its
  shader, one node's slice of it, or a Script layer's code).

A presentation is built from **Plays, not graphs**. It never edits the
graphs it uses. Finished presentations can be exported as a single web page
or as a file other people can open, remix and pass around.

## 2. What exists today (what to build on)

From a survey of the code on `main` at `a1eea06`.

| Piece | Where | What it gives us |
|---|---|---|
| **Present mode** (not a page; now the **Stage**) | `components/play/Stage.tsx`, `stageStore.ts` (were `PresentStage.tsx`, `presentStore.ts`); entered via an early return in `App.tsx` | Shows the *current* graph fullscreen, in a screen or phone frame, with an optional controls panel and Record. **Exact** mode runs the exported page in an iframe. No steps, no text. |
| **Pages** | `components/page.ts` (a union type), `TABS` in `shell/DesktopTopNav.tsx`, `shell/MobileTopBar.tsx`, the three layouts in `App.tsx` | No router. Adding a page means extending the union, adding a tab, and adding a lazy branch in each layout. |
| **Play records** | `types/play.ts` (`PlayRecord`, `parsePlayRecord`) | Controls, mappings, layers, actions, notes, display. Stored **inside** a saved graph under its `play` key (`saveGraph` → localStorage `shader-studio:<name>`), never on their own. `OpenPlayable.tsx` already lists every saved graph and example that has a Play setup without loading it. |
| **The editor canvas** | `ShaderCanvas.tsx` | One WebGL renderer bound to the one global graph and the singleton `playEngine` / `inputBus`. **Cannot show a second graph.** |
| **The standalone player** | `play/runtime/play-runtime.js`, `play/kit/*.js`, `play/exportHtml.ts` | `ShaderStudioPlay.mount(el, bundle)` runs a compiled graph + Play (controls, mappings, layers) in its own WebGL context. **Several can share a page.** It is what "Put it on a website" exports. It runs feedback, echo, GPU particles and image, video and audio inputs (their files carried in the bundle); it cannot run MIDI node outputs (`unsupportedFeatures`). |
| **Compiler** | `compiler/graphCompiler.ts` | `compileGraph` is pure: any saved graph can be compiled off-screen into a bundle without touching the store. |
| **Notes rendering** | `components/play/NotesCard.tsx` | A tiny hand-written parser: paragraphs, bullets, `**bold**`, and `[[control:id]]` / `[[layer:id]]` chips. No Markdown or maths library in `package.json`. |
| **Code display** | `components/code/GlslEditor.tsx`, `glslSyntax.ts`, `CodePanel.tsx` | A custom textarea-over-spans editor and a GLSL-only tokenizer. `nodeSlugMap` maps a node to its lines of the shader. |
| **Script layers** | `ScriptLayer` in `types/playLayers.ts`; runs in `play/kit/kit.js` (`drawScript`) | JavaScript `setup(s)` / `draw(s)` on a 2D canvas over the picture, compiled with `new Function` on the main thread, **no sandbox**. Ships inside web exports. |
| **Export** | `buildPlayHtml` / `buildPlaySnippet` in `play/exportHtml.ts`, `EmbedDialog.tsx` | One self-contained file (~65 KB) per Play. No share links, no hosting. |
| **Related plan** | `docs/play-v1-plan.md` ("Set lists and the pop-out window") | Several Plays switched live, for performing. Present is the teaching counterpart; they can share the "list of Plays" idea. |

The key decision falls out of this table: **every canvas on the Present page
is a `ShaderStudioPlay.mount`**, not a `ShaderCanvas`. The runtime already
runs one graph per mount, several per page, with controls and mappings, and
it is exactly what the web export ships. What you see while authoring is
what the exported page shows.

## 3. Design

### 3.1 Words

- **Presentation**: the document. A title, an ordered list of steps, and the
  Play snapshots its blocks use.
- **Step**: one screen of the walkthrough (a slide or a section, depending on
  the view).
- **Block**: one box inside a step: text, render, interactive or code.
- **Source**: a Play snapshot a canvas or code block reads from.

The existing fullscreen Present mode stays as it is, but should be renamed
(**Stage**, or "Fullscreen") so the page can own the word *Present*. A step
can open its canvas on the Stage.

### 3.2 Sources: snapshots, with a way back

A presentation must not break when you later edit the graph it came from.
So each source is a **snapshot**:

```ts
interface PresentSource {
  id: string;
  from: { kind: 'saved'; name: string; savedAt: number } | { kind: 'example'; key: string };
  title: string;
  /** What ShaderStudioPlay.mount takes: compiled shader, uniform values, param bindings, the Play record, aspect. */
  bundle: PlayBundle;
  /** The generated GLSL with the node → line map, for code blocks that quote a node. */
  shader: { code: string; nodeSlugMap: Record<string, string> };
  capturedAt: number;
  /** From unsupportedFeatures(): what this Play uses that the runtime can't run. */
  limits: string[];
}
```

The editor shows each source's origin and offers **Refresh from graph**
(recompile the saved graph and replace the bundle, keeping the blocks'
choices of controls where the control ids still exist). Opening the source
graph in Studio or Play is one click, for editing it.

Picking a source reuses `OpenPlayable`'s listing: every saved graph and
example with a Play setup. A Play's own **notes** can seed a text block.

### 3.3 Blocks

```ts
type Block = TextBlock | RenderBlock | InteractiveBlock | CodeBlock;

interface TextBlock { type: 'text'; id: string; markdown: string }

interface RenderBlock {
  type: 'render'; id: string; source: string;
  aspect: '16:9' | '4:3' | '1:1' | '9:16' | { w: number; h: number };
  width: 'full' | 'half' | 'third';
  pointer: boolean;      // let the mouse reach the shader (u_mouse, mouse mappings)
  caption?: string;
  startTime?: number;    // freeze or start the clock somewhere interesting
}

interface InteractiveBlock {
  type: 'interactive'; id: string; source: string;
  markdown: string;                 // shown beside or above the canvas
  controls: Array<{ controlId: string; label?: string; hint?: string; showMappings: boolean }>;
  layout: 'side' | 'stacked';
  aspect: RenderBlock['aspect'];
  pointer: boolean;
}

interface CodeBlock {
  type: 'code'; id: string;
  language: 'glsl' | 'js';
  code?: string;                                        // typed in
  from?: { source: string; node?: string }             // the shader, or one node's slice
       | { source: string; layerId: string };          // a Script layer's code
  highlightLines?: [number, number][];
  caption?: string;
}
```

**Text.** Markdown plus maths: `$…$` inline and `$$…$$` display, rendered
with KaTeX. The Play notes' chips carry over: `[[control:freq]]` in an
interactive block's text becomes a chip that highlights (and on click nudges)
that slider, so the text can point at the control it's talking about.

**Render.** The runtime mount with its controls panel hidden. Canvas shape
from the existing aspect list (`PREVIEW_ASPECTS`), width relative to the
step. Mouse interaction is a per-block switch, because a hover-driven shader
is the point in some lessons and a distraction in others.

**Interactive.** The runtime mount plus a controls panel the block draws
itself, showing only the chosen controls, in the chosen order, with the
lesson's labels. Values write to the mount through the runtime's control API
(the same one its own panel uses). Where a chosen control has mappings in
the Play, a badge names the source in words ("Mouse X", "Key K", "LFO 0.2 Hz",
"MIDI CC 1"); keys and MIDI sit behind the runtime's existing Enable buttons.
Action controls (Burst, Drop again) become buttons.

**Code.** Read-only, highlighted, with a copy button. GLSL uses the existing
tokenizer; JavaScript needs one (a small hand-written tokenizer in the same
style, to keep the app free of a highlighter dependency). A node's slice
comes from the source's `nodeSlugMap`, the same lookup the code panel uses to
highlight a selected node.

### 3.4 Layers and scripting

Layers come for free: they are part of each source's Play record, and the
runtime draws them. Two things are worth adding on top:

1. **Quote a Script layer** in a code block (the `from.layerId` form above),
   so a lesson can show the JavaScript that draws what's on the canvas.
2. **Live script block** (later milestone): a code block linked to a Script
   layer in an adjacent canvas, where editing the code re-runs that layer.
   This is the "change this line and watch" moment for the scripting side.

**Safety.** Script layers run with `new Function` and no sandbox. Inside the
editor that's your own code. A presentation file from someone else is not:
opening it would run their JavaScript in the app. So canvases that contain
Script layers, from any presentation not authored on this machine, should run
in a **sandboxed iframe** (`sandbox="allow-scripts"`, no same-origin), which
the Stage's Exact mode already does with `srcDoc`. The exported web page is a
separate origin anyway.

### 3.5 The page

- **Author view**: steps listed on the left (add, reorder, duplicate); the
  step being edited in the middle, blocks in a single column or two columns;
  the selected block's settings on the right (source, controls, labels,
  canvas shape). Adding a block offers the four types and a source picker.
- **Viewer view**: the same steps, read-only, with ← / → and a progress bar.
  Two layouts: **slides** (one step fills the screen, for teaching in the
  room) and **scroll** (all steps in one page, for reading alone).
- **Mobile**: single column; interactive blocks stack the canvas above the
  controls.

### 3.6 Performance

Browsers cap live WebGL contexts (around 16 per page) and every running
canvas costs a frame. So:

- only the current step's canvases are mounted in slides view;
- in scroll view, canvases mount and unmount as they enter and leave the
  screen (an IntersectionObserver), and pause when hidden (the runtime
  already pauses off-screen and in hidden tabs);
- a hard cap on simultaneous mounts, with a still frame for the rest.

### 3.7 Storage and files

- Saved like graphs: localStorage `shader-studio-presentation:<name>`,
  listed in the library panel, mirrored to the backup folder.
- **Presentation file** (`.present.json`, a `kind` field like the Play file
  format): the steps and all snapshots, so it opens anywhere with no need
  for the original graphs. Importing validates it through one
  `parsePresentation` gate, the way `parsePlayRecord` does for Plays.

### 3.8 Export

- **Web page**: one self-contained HTML file. The runtime and kit once, every
  source bundle, the steps as HTML (Markdown already rendered), the step
  navigation, and the chosen layout (slides or scroll). It extends
  `buildPlayHtml` rather than starting over.
  - **Maths**: KaTeX's MathML output needs no fonts and modern browsers
    render MathML natively, which keeps the file small; HTML output with the
    KaTeX fonts looks more consistent but adds a few hundred KB. Offer both,
    default to MathML.
- **Presentation file**: for sharing and remixing (see 3.7).
- **Later**: a hosted share link (needs a server), and opening a
  presentation in the Tauri pop-out window from the set-list plan.

The export lists what it leaves behind, as the Play export does: sources
whose Plays use something the runtime can't run (images, video, audio input,
feedback, echo, particles) show a still frame with a note.

## 4. Milestones

1. **Shell and text.** Page, types, storage, steps list, text blocks with
   Markdown + KaTeX, viewer navigation. Add `markdown-it` (or `micromark`)
   and `katex`, lazy-loaded with the page.
2. **Canvases.** Source picker (from `OpenPlayable`'s listing), snapshots via
   `compileGraph` + `playWebInput`, render blocks mounted with the runtime,
   mount/unmount by visibility.
3. **Interactive blocks.** Control subset, labels and hints, mapping badges,
   action buttons, `[[control:id]]` chips linking text to sliders.
4. **Code blocks.** GLSL from a source's shader or one node's slice, typed-in
   GLSL/JS, Script layer quotes, a JavaScript tokenizer, copy.
5. **Files and export.** Presentation file import/export with
   `parsePresentation`; single-page HTML export (slides and scroll).
6. **Scripting and polish.** Live script blocks, sandboxed iframes for
   imported presentations with Script layers, Stage from a step, mobile.

A good first real presentation, to test the whole thing: turn the Learn
folder (the Book of Shaders as graphs) or the Matrices folder into one.

## 5. Tests

- `parsePresentation` round-trips a presentation and drops malformed blocks.
- A snapshot's bundle matches what `playWebInput` produces for the same
  graph; Refresh keeps block control choices whose ids survive.
- A code block's node slice equals the lines the code panel highlights for
  that node.
- Markdown + maths render deterministically (snapshot tests on the HTML).
- The exported page contains the runtime once however many canvases it has,
  and lists what it left behind.
- Browser check (as for field sockets): every canvas of a sample
  presentation mounts with no GLSL errors, and only the visible ones hold a
  WebGL context.

## 6. Decisions (settled 26 Sep 2026)

1. **Snapshots.** A presentation is an asset of its own: each source is a
   snapshot, with Refresh to pull the graph's current state on purpose.
2. **What the runtime can't run: extend the runtime, don't settle for stills.**
   The page's canvases are play-runtime mounts (the exported web page's
   runtime), because the app's own canvas can only show the one open graph.
   That runtime can't yet do image, video or audio inputs, previous-frame
   feedback, echo or GPU particles. Those gaps are the same ones the website
   export has, so closing them helps both: textures and video as uploaded
   assets, a ping-pong framebuffer for feedback and echo, the particle
   simulation from the app. Until each lands, that canvas shows a still frame
   and names what's missing.
3. **Naming.** The fullscreen Present mode becomes **Stage**; the page is
   *Present*.
4. **Dependencies.** KaTeX and a Markdown parser, both loaded only when the
   page opens: approved.
5. **Hosted links.** Out of scope for now. Sending a link to a Play or a
   presentation is where this is heading, and it needs a server and an
   account story first.

## 7. What shipped (26 Sep 2026)

Branch `claude/present-page`, stacked on the milestone branch (#228).

**0. Stage.** The fullscreen Present mode is the **Stage** everywhere a user
sees it (the Play page's button and header, the Stage's own bar) and in the
code (`Stage.tsx`, `stageStore.ts`, `useStage().open(mode)`).

**1. Shell and text.** A `present` page (tab on desktop and tablet, the ⋯
menu on phones), lazy like the others. `types/presentation.ts` has the types
and `parsePresentation`, the one gate for stored and imported JSON: it drops
malformed blocks and steps, blocks whose source is gone, interactive controls
the snapshot no longer has, media that isn't a `data:` URL, and never returns
zero steps. `present/storage.ts` keeps them under
`shader-studio-presentation:<name>` (the name is the title); they save
themselves half a second after each change (no Save button). They are a
library kind (`presentations/` in Export everything and the backup folder,
which picks them up like any `shader-studio*` key). The page: Edit (steps
list with drag to reorder, duplicate, delete with Undo; the step in the
middle; settings on the right), Slides and Scroll. Text blocks are
Markdown (`markdown-it`, raw HTML off) with `$…$` / `$$…$$` KaTeX and
`[[control:id]]` / `[[layer:id]]` refs (`present/markdown.ts`). KaTeX and
markdown-it load with the page, as their own chunk (`markdown-*.js`, ~360 KB,
and KaTeX's CSS); the app's main bundle doesn't carry them, and the idle
preload of page chunks doesn't fetch them either.

**2. Canvases.** Sources are snapshots (`present/snapshot.ts`): the saved
graph or example is read, migrated like a load (`migrateLoadedNodes`),
compiled with `compileGraph`, and turned into the web page's input by
`play/webInput.ts`, which the store's `playWebInput` now also uses, so a
snapshot builds exactly the page "Put it on a website" would (tested).
Refresh takes a new one in place and drops controls whose ids are gone.
Every canvas is a `ShaderStudioPlay.mount` (`present/runtimeHost.ts`
evaluates the runtime once in the app). Render blocks: shape, width (full,
half, third), mouse on or off, caption, start time and "hold it there".
Canvases run only when wanted (the current slide, or on screen with a margin
in Scroll and Edit) and at most 6 at once (3 on phones); the others show their
last frame (or the source's still, made off-screen once per source) with a
Run button.

**3. Interactive blocks.** The chosen controls in the chosen order, with the
lesson's labels and hints, drawn with the app's ruler sliders and colour pads,
writing through the runtime's control API; action controls are buttons.
Mapping badges in words (`present/controls.ts`: "Mouse X", "Key K", "LFO
0.25 Hz", "MIDI CC 1", "Clock 120 BPM"), lit and LIVE while a mapping drives
the control; Enable MIDI and Listen appear when a chosen control needs them.
Chips in the text light their control on hover and, clicked, bring it into
view and give it a nudge.

**4. Code blocks.** Typed GLSL or JavaScript, a source's whole shader, one
node's slice (the lines `components/code/nodeSlice.ts` picks, which the code
panel now uses too: tested equal), or a Script layer's code; highlighted with
the existing GLSL and Script-editor tokenizers, marked lines, gaps between a
slice's runs, Copy.

**5. Files and export.** `.present.json` (with `kind`) out and in; imports
go through `parsePresentation` and are marked `origin: 'imported'`. The web
page (`present/exportPresentation.ts` + `present/present-page.js`) carries
the runtime and kit once, each used source's bundle once, the steps as HTML,
the same visibility and cap rules, the interactive panels and chips, and
Slides (← →, progress, `#step` in the address) or Scroll. Maths is MathML by
default; KaTeX's HTML with its woff2 fonts inlined (~360 KB) is the option.
The dialog lists what the page leaves behind.

**6 (part). Sandboxing.** In an imported presentation, a canvas whose Play has
Script layers runs the exported page in an `<iframe sandbox="allow-scripts">`
(no same origin), marked "Sandboxed"; an interactive block's controls are then
that page's own panel.

**The sample.** "Ray marching, step by step": eight steps from the Learn 3D
lessons plus the Play course's LFO example, with every block type. Offered on
the empty page and in the presentations menu (`present/sample.ts`).

### Where it differs from the plan

- `PresentSource.shader` keeps only `nodes` (id, label, slug); the code is
  `bundle.fragmentShader`, not a second copy. Sources also keep `features`
  (so `limits` are asked of `unsupportedFeatures` again on every load, and a
  source stops being a still as soon as the runtime learns to run it) and a
  `poster`.
- Steps have an optional `title` and `columns: 1 | 2`; render blocks have
  `paused`; the presentation has `origin`.
- The runtime (version 4) gained, for a host that draws its own panel:
  options `panel`, `pointer`, `startTime`, `paused`, `pauseOffscreen`; per
  mount `get`, `set`, `fire`, `still`, `hasSound` / `sound`; and page-wide
  `enableMidi()` and `listen()`. A bare player (no panel) fills its box on
  phones too.
- Images, videos and songs exist only in the open graph (lib/mediaSources),
  so a saved graph's snapshot carries them only when that graph is open in
  the Studio, as saved, when the snapshot is taken. Otherwise the source card
  says which files it lacks and how to bring them (open it, Refresh).

### Finished afterwards (branch `claude/present-finish`)

**Live script blocks** (3.4 item 2). A code block that quotes a Script layer
has a Live switch in its settings. Live, it is an editor (the Script editor's
`CodeField`, highlighting and completions): after a 300 ms pause in typing,
the edit runs in the canvases of that source *on the same step* only (never
the source graph, never other steps), and the canvas reports back under the
code: running, or the compile or runtime error. The edit is saved with the
presentation (`CodeBlock.edited`, `live`; `parsePresentation` keeps them only
on a Script-layer quote), and Reset goes back to the snapshot's code. With no
canvas of that source on the step, the block says so. `present/liveScript.ts`
has the pure part (which edits a step carries, the bundle with them).

The runtime is version 5: every mount copies its layers (so a script edit or
a dragged null never reaches the bundle), and gains `setScript(layerId, code)`,
the `onScript(layerId, error)` option and `usesCamera`, plus page-wide
`enableCamera()` / `stopCamera()`. In an imported presentation, canvases with
Script layers run in the sandboxed frame; the edit crosses by postMessage. A
full-page export built with the `host` option (only the Present page's frames,
never a published page) takes `{ ssp: 'script', layerId, code }` from its
parent and posts `ready` and `scriptStatus` back.

The exported page has live blocks too: a plain text box (no highlighting),
the same pause, status line and Reset, running in that step's canvases.

**Stage from a step.** Render and interactive canvases have a Stage button
over the picture (an icon on phones), and Slides has one in its bar (the
step's first canvas). A snapshot isn't the open graph, so the Stage opens in
Exact with the snapshot's own page: `snapshotStagePage` is exactly the page
the Stage builds for a graph (`stagePageHtml`, the website player with its
panel), from the snapshot's bundle with the step's Script edits (tested equal
to the Stage's page for the same example loaded in the Studio). The bar says
**Snapshot** instead of Full / Exact, there's no Rebuild, and the side panel
says whose snapshot it is, when it was taken, that it isn't the open graph,
and whether a Script layer runs edited code. From an imported presentation
with Script layers it runs sandboxed, and Record is off (it can't reach a
sealed-off frame's canvas). On phone-sized windows the Stage bar keeps only
what fits and its panel goes under the picture.

**Camera layers.** Canvases whose Play reads the camera (a Camera layer, or
particles, glyphs or contours reading from it) show Enable camera over the
picture, in the app and the exported page. The camera is turned on once for
the page and every such canvas sees it; the app turns it off when the Present
page closes. Blocked or missing cameras say so and can be asked again.

**Sound in the exported page.** Each canvas with the graph's own songs has a
Play sound / Mute button over the picture while it runs, as in the app (one
per canvas, since each canvas plays its own songs).

**MathML.** The exported page's MathML is rewritten for MathML Core
(`mathmlForCore` in `present/markdown.ts`): `mathvariant` letters (bold,
bold italic, double-struck, script, fraktur, sans-serif, monospace; Latin,
digits and Greek where Unicode has them) become the Unicode maths letters,
and `\|` / `\lVert` (KaTeX's ∥, a relation with wide spacing) become the
fence ‖ with no spacing; `\parallel` stays a relation. Checked in Chrome on
the sample: 𝐩, 𝐨, 𝐝 upright bold, ‖𝐩‖ tight. MathML stays the default; the
KaTeX HTML option is unchanged.

### Left

- The Tauri pop-out window for a presentation (needs a Rust toolchain, not
  installed where this was built).
- In an imported presentation, a *render* block's sandboxed canvas has no
  Enable camera or Play sound (browsers don't pass the click into the frame,
  and a background page has no buttons of its own); an interactive block's
  sandboxed canvas has them in its own panel.
- The exported page's live blocks aren't highlighted (the app's tokenizer
  isn't carried into the page, to keep it small).
- Hosted links (decision 5).
