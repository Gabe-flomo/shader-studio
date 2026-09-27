# Presentations: a user guide

A presentation is a lesson in steps: text with maths, pictures your graphs
make, sliders to try, and the code behind them. It is its own kind of file,
like a GLSL shader: it doesn't belong to a graph. One graph can be the basis
of many presentations, and each presentation carries **copies** (snapshots)
of the Plays it shows, so it keeps working when a graph changes, is renamed
or is deleted.

## Getting to it

- **Computer**: the **Present** tab in the top bar.
- **Phone**: the **Studio · Play · Present** switch at the top left, the
  same place as Play.

## Make one

- With nothing saved yet, the page offers **Open the sample**, **New
  presentation** and **Import a file**, with **More samples** under them.
- Otherwise click the presentation's title (top left of the page) for the
  file menu: **New presentation…**, **Import a .present.json file…**, the
  samples, and the actions for the one that's open.
- The samples come in two groups. **Learn the app** teaches Playfield
  itself: *Getting started in the Studio*, *From shader to instrument: your
  first Play*, *Field sockets: one shape, many copies*, *Bring your own
  GLSL* (the Convert page) and *Making a lesson with Present*. **Topics**
  teach shaders: *Shaders from zero* (The Book of Shaders through the Learn
  folder), ray marching, matrices, playing a shader and sketching over one.
  Opening a sample builds it fresh from the bundled examples.
- Add blocks to a step (Text, Render, Interactive, Code; see Code blocks below). The first time a
  block needs a picture it asks you to choose a Play: a saved graph or an
  example with a Play setup. That takes a snapshot into the presentation.

## Code blocks

**Code** in the add bar (or, on an empty step, the links under *Or start
with code*) opens **Add code**. Nothing goes in until you press **Insert**.
Four ways in, one kind of block out:

- **Write your own**: an editor with GLSL highlighting and completion, a few
  starting points (a curve, a shape, colour from position, Book of Shaders
  style) and the preview as you type. JavaScript can be typed too (shown as
  code, no preview).
- **Functions**: your Functions library (with its thumbnails) and every
  function Function Discovery finds in your saved GLSL shaders. Search, filter
  by where it's from and what it returns. It comes with the helpers it needs,
  and the block says where it was found.
- **A node’s code**: search any node type by name or browse by category. You
  see its helper functions, its lines in `main()` with its default settings
  (UV and Time wired, so they read as they do in a graph), its inputs and
  outputs with their types and hints, its settings, and a short *how it
  works*. Insert all of it or parts: the helpers, the lines, the inputs and
  outputs as a comment; *how it works* can become the caption.
- **From a shader**: a Play in this presentation (or **+ Play** to add one, or
  the graph open in the Studio). Pick the whole shader, its declarations,
  `main()`, one node's lines (a loop comes whole), or one function (with the
  functions it calls). A Play's Script layers are listed too.

Picked code names where it came from in the block's header, with a line of
credit under it (and a Book of Shaders link when its Play has one). The
settings panel's **Replace…** opens the same chooser for a block you have.

### Live previews

A GLSL block can show what it does beside it, like The Book of Shaders
(settings panel → **Preview**, on by default for picked code that can draw):

- **Plot**: a float function of x (`float f(float x)`, or `f(x, t)` with the
  time), or a float variable, drawn as a graph with axes. Set the axes in the
  settings. It moves when the code reads the time.
- **Field**: the result as colour. Floats are grey (negative values blue, like
  a distance), `vec3`/`vec4` are themselves, and a `vec2` is red/green, a
  warped **Grid** or **Arrows**.
- **Show** picks what to draw: any function returning a float or a vector,
  or any variable the lines declare. `uv` runs −1 to 1 like the Studio, or 0
  to 1 like The Book of Shaders.
- Any snippet runs: lines from `main()`, functions, a node's code, or a whole
  shader (Shadertoy's `mainImage` too). The names lessons use are given when
  the code doesn't declare them (`uv`, `st`, `g_uv`, `x`, `t`, `time`,
  `fragCoord`, `mouse`); the app's helpers (`valueNoise`, `rotate`…) and a
  source shader's own functions are brought in; a variable from lines not
  shown gets a stand-in, and the preview says which.
- **Sliders** appear for the numbers worth moving: uniforms, float `const`s and
  `#define`s, a function's extra float parameters, and names nothing
  declares. The author's slider values are kept with the block.
- Readers can edit the code in the block (**TRY IT**; **Reset** goes back) and
  the preview follows a moment after they stop typing. Their edits and slider
  moves aren't saved. Compile errors show in the preview's place, with the
  block's own line numbers.
- **Exported pages** show each preview as a still picture beside the code (the
  export notes say so); editing and sliders work in Playfield.

## Full screen

- **Present**: the full screen button in Slides (the bar under the slide) and
  Scroll (the floating bar), **F**, or **⌘⇧F** (Ctrl+Shift+F), which from Edit
  opens Slides first. Only the presentation shows; its controls fade after a
  moment without the mouse. The arrow keys still step; **Esc** leaves.
- **The picture**: the full screen button beside the canvas shapes in the
  preview's header (Studio and Play) and in the Play page's Canvas row. **F**
  on the Play page, **⌘⇧F** anywhere (in the Studio F still fits the graph).
  **Esc** leaves.
- In the desktop app, where the web view can't make one element full screen,
  the window goes full screen with the picture or presentation filling it, and
  comes back on Esc.

## Saving

There's no Save button to forget: every change saves itself in this browser
about half a second later. Beside the title it says **Saving…**, then
**✓ Saved** (on a phone, a small tick). **Not saved** in red means the
browser's storage is full: see Library (below) for what takes the room.

- **Rename…** (title menu): the name is the title.
- **Save a copy…** (title menu): the same presentation under a new name; the
  copy opens. **Make a copy** in the list does the same without asking for
  a name.

## Opening, finding, tidying

**Open** (a folder button in the page's header; on a phone the folder icon
beside the title) lists every presentation saved here, with a still from its
first Play, how many steps and Plays it has, and when it last changed.

- Search appears once there are a few.
- **Folder** makes a folder; drag presentations into it on a computer, or use
  **⋯ → Move to a folder…** (works on phones too).
- **⋯** on a row: Open, Download, Make a copy, Rename…, Move to a folder…,
  Delete. Delete has **Undo** in the notice that follows.
- The five most recent are also at the top of the title menu.

## Linking a presentation and a graph

A presentation and a graph (or Play) stay separate things: a presentation
carries its own copies of the Plays it shows, and a graph works without any
presentation. A **link** only says they go together, so opening one can
bring the other along.

- **From the Studio or Play**: the save popover (the save button in the top
  bar, with a saved graph open) has a line *Presentation: none · Link…*.
  **Link…** offers **New presentation from this graph** (a first step
  showing the graph, with its first controls when it has a Play setup; it
  opens on Present) or any presentation saved here. A linked one has
  **Open** and **Unlink**.
- **From Present**: with no block selected, the settings panel's *This
  step* tab ends with **Linked graphs**: each with **Load** (makes it the
  open graph in the Studio and on Play, asking first if that would replace
  unsaved changes) and unlink, and **Link…** for any saved graph. When the
  presentation's Plays were copied from saved graphs that aren't linked yet,
  **Link the graphs used here** links them in one go.
- A graph can have several presentations and a presentation several graphs;
  usually it's one.
- A small link mark shows on linked graphs (the Studio's saved graphs, the
  Open menu, Play's Open list, the Files page) and presentations (Open, the
  Files page); hovering it names the other side.

**When you open one.** The **Linked presentations** setting (Library panel)
decides what happens when you load a graph that has a linked presentation,
and when you open a presentation that has a linked graph:

| Setting | Graph loaded | Presentation opened |
|---|---|---|
| **Ask** (the default) | a notice “Has a presentation · Open” | a notice “This presentation has a graph · Load it” |
| **Always** | it opens on Present too; you stay where you are (the notice has **Go to Present**) | its graph loads, unless the open graph has unsaved changes: then it only offers |
| **Never** | nothing | nothing |

Nothing happens when the other side is already the one open. Opening a
presentation's graph never replaces unsaved changes without the usual
“Open this graph?” question.

**Examples** come linked to the sample presentation that teaches them (the
Matrices examples → *Transforms with matrices*, the Learn 3D lessons → *Ray
marching, step by step*, the Play course → *Playing a shader*, and so on).
Opening such an example offers its sample: the one saved here under that
name, or a fresh one built like the Present page's sample cards.

**Where links live.** Both sides: a saved graph's record has
`linkedPresentations` (presentation names), a presentation has
`linkedGraphs` (saved graph names); `src/present/links.ts` keeps them in
step. So they travel with the workspace folder, Export everything, library
and profile ZIPs; an import that brings things in under new names (“Rings
(imported)”, “Lesson (2)”) keeps them linked to each other.

- **Deleting** one side (Present, the Studio, the Files page) keeps the other
  and only removes the link; Undo puts it back.
- **Renaming** a presentation keeps its graphs pointing at it.
- **Copies** start unlinked: Save a copy, Make a copy, Save as a new graph,
  a sample, and a single `.present.json` imported on its own (its graphs
  aren't in the file).
- A link whose other side is gone (deleted in Finder, say) is simply not
  shown.

## Import and download one

- **Download** (title menu or a row's ⋯) saves a `.present.json` file: the
  steps and every Play snapshot, so it opens in Playfield anywhere, with no
  need for the original graphs.
- **Import** it on the Present page (title menu, or **Import…** in the
  list), or with the app's main **Import** button in the top bar (on a
  phone: ⋯ → Import a file): a `.present.json` opens straight on the Present
  page. A graph file imported there opens in the Studio as before.
- If the name is taken, the import is called “Name (2)”, “Name (3)”…
- An imported presentation runs its Script layers in a sandboxed frame,
  since they are someone else's code.

## Export as a web page

**Export** (header, or **Export as a web page…** in the title menu) builds
one HTML file with everything in it: slides or one long page, maths as
MathML or KaTeX. Put it on any website or open it from your computer. The
same window has **Presentation file** for the `.present.json`.

## How it looks: themes, colours and fonts

The settings panel's **Style** tab (with no block selected) decides the look
of the whole presentation: in Edit, Slides and Scroll, and in the exported
web page, which looks the same.

**Theme** comes first. Each is a small live preview; click one to use it.

| Theme | Looks like | What defines it |
| --- | --- | --- |
| **Classic** | The Present page as it always was | The app's colours (light or dark with the app), paper grain, system fonts, "01 / 07" step numbers. Every presentation made before themes is Classic and looks exactly as it did. |
| **Landing** | Play's *Landing page* website | Warm off-white, ink headlines set big, bold and tight, the step number as an eyebrow pill above the title, pill buttons, generous spacing. |
| **Article** | Play's *Blog post* website | Georgia headings and body, a narrow reading column (680 px), relaxed line height, the step number as a byline ("Step 2 of 7"). |
| **Portfolio** | Play's *Portfolio* website | Near-black, clean sans set tight, pictures on rounded tiles, white pill buttons. |

Under the previews, every setting the theme decides can be changed, and each
one changed shows **Reset to theme** to go back:

- **Colours**: Light, Dark, or **Match** (with the app here; in an exported
  page, with the reader's system). Then **Background**, **Cards** (controls,
  code headers, Portfolio's tiles), **Text** (headings and body; captions
  follow it), **Accent** (step numbers, chips, buttons, the progress bar) and
  **Links**.
- **Corner radius** of pictures, cards and code; **Column width** of the
  reading column (Edit, Scroll and exports; slides stay at least as wide as
  they were); **Spacing** between blocks and around steps.
- **Reset all** (beside the section's title) drops every change, including
  the fonts and text size below.
- **Save as my theme** keeps the theme with its changes and fonts under a
  name. Your themes are listed after the built-ins (marked *Yours*), for any
  presentation; the × on one deletes it (with Undo). They're kept with your
  palettes in this browser and travel in library backups.

A step's own background (the **Step** tab), and the presentation's
**Background of every step**, sit on top of the theme, with their legibility
effects: text over a picture or a dark gradient still turns light.

### Fonts

**Typography** has Headings, Body and Code. Until you choose one, each uses
the theme's font (system fonts: nothing is downloaded). To choose:

- Pick from the list (search, or filter by Sans, Serif, Display…), or
- **Paste a Google Fonts link or family name** at the bottom of the picker:
  a font's page (`https://fonts.google.com/specimen/Space+Grotesk`), a
  `https://fonts.googleapis.com/css2?family=…` link (or the whole `<link>`
  tag Google gives you), or just a name like `Bebas Neue`. The weights the
  link names are used; a heading takes the one nearest bold. Typing a name
  that isn't in the list into the search offers the same.

The font is downloaded from Google Fonts once, kept in this browser's font
cache, and embedded only when you export or download the presentation, so it
works offline and anywhere. If Google can't be reached, nothing changes and a
notice says so. **Reset to theme** beside a font goes back to the theme's.
Text size and line height start at the theme's and reset the same way.

## Moving presentations between machines

- **All of them**: in the list, **Download all** saves one ZIP of
  `.present.json` files in their folders, plus a `library.json`. Or use the
  Library (Studio sidebar → Saved Graphs → Library, or on a phone ⋯ →
  Library…): **Download… → Only presentations** is the same ZIP, and
  **Export everything** puts presentations in the full library ZIP with
  graphs, shaders, presets and settings.
- **Bringing them in**: Library → **Import a library…** takes either ZIP (or
  its `library.json`, or a single `.present.json`). Nothing of yours is
  overwritten: a presentation whose name is taken by a different one comes in
  as “Name (2)”; one you already have is skipped; folders come with them.
- **Backup folder** (Chrome, Edge and the desktop app): presentations are
  copied there with everything else, as `presentations/<folder>/<name>.present.json`
  next to the `library.json`; **Restore from it** brings them back.

## Images, videos and songs

A graph's image, video and song files live with the graph while it's open in
the Studio, not in its saved file. A snapshot takes them when the graph is
open in the Studio, with its files loaded and saved; otherwise the source's
card says which ones it's without, and those inputs show blank. To fix it:
open the graph from the card (**Studio**), load its files, save, and press
**Refresh**. If the graph has since been deleted, the card says so: the
snapshot still has everything the presentation needs, but Refresh and Open
are off.
