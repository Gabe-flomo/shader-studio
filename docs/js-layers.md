# JavaScript in Playfield: the Script layer, and the road to plugins

Two questions, answered in order: how JavaScript and the shader already talk
to each other, and what it takes to let people (and companies) add their own
nodes, layers and feeds. The first half describes the **Script layer**, which
is built. The second half is the plan for everything past it.

## 1. Why JavaScript at all

The graph compiles to one fragment shader: a program the GPU runs once per
pixel with no memory between pixels or frames. That is what makes it fast,
and what makes some things awkward or impossible there: keeping a list of
things and moving them over time, reading a file or a network feed, laying
out text, running a physics step, calling an API. JavaScript on the CPU does
all of that trivially, and it is what most creative coders already write
(p5, canvas, three).

Play's layers are already that JavaScript side. Particles, shapes, brush,
text, bodies and the rest are plain JS drawn each frame in the **layer kit**
(`src/play/kit/kit.js`, with `layers.js`), a self-contained script that also
ships inside exported websites. Layers talk to the shader through three
channels that exist today:

- **Uniforms**: a layer writes numbers the shader reads (a null's position,
  a sensor value). Controls and mappings ride the same path.
- **Textures**: a layer or feed hands over pixels (an image, the camera, a
  video) that Texture Input and Video Input sample.
- **The Layers node**: the graph reads the layers' colour, alpha and
  distance field back, so a shader can glow around whatever JavaScript drew.

A "JavaScript node" in Studio would be a fourth shape of the same idea: a
script that runs per frame and publishes values or a texture into the
shader. Per-pixel JavaScript is not a thing; per-frame JavaScript feeding
the pixel program is.

## 2. The Script layer (built)

Add a **Script** layer in Play. It holds a sketch: a `setup(s)` that runs
once and a `draw(s)` that runs every frame, drawing on a 2D canvas the size
of the picture. Apply runs it (or ⌘/Ctrl+Enter); errors show under the code
and the other layers carry on. Five starters load with one click: Dots, p5
sketch, Trail (with a Wipe button), Picture grid (with an Invert toggle),
Orbit a null. **Open editor** opens the big window described below.

```js
const params = {
  count: { value: 24, min: 1, max: 200, step: 1, label: 'Dots' },
  speed: { value: 1, min: 0, max: 4, step: 0.05 },
};
let dots = [];
function setup(s) { /* runs once, and again when the picture is resized */ }
function draw(s) {
  const { ctx, width, height, dt, params, mouse } = s;
  // ordinary canvas code
}
```

### The `s` object

| Field | What it is |
|---|---|
| `ctx` | A `CanvasRenderingContext2D`, `width × height` pixels, y down like every canvas. Cleared each frame unless **Clear** is off. |
| `width`, `height`, `dpr` | The picture's size in pixels and the device pixel ratio. |
| `time`, `dt`, `frame` | The Play clock in seconds, the frame's delta (capped at 0.1), and the frame count since setup. |
| `params` | The current value of every slider the script declared, by key. Sliders, keyframes, mappings and Play controls all land here. |
| `state` | An object kept between frames (and reset on setup). Put your arrays here, or in module-level `let`s; both work. |
| `mouse` | `{ x, y, over, down }` in pixels. |
| `picture.brightness(x, y)` | 0–1 brightness of the shader at a pixel, when **Picture** is on (it samples the shader at 64×36 each frame). |
| `null(name)` | A Null layer's position in pixels, by label or id, or `null`. The cheap way to give a script a handle you can drag or map. |
| `pressed(key)` | True on the frame a button param was pressed (its amount is in `params[key]`). |
| `random()` | `Math.random`. |

### p5-style helpers

The sketch's top level runs inside a `with` scope over a helper object, so
the p5 vocabulary works as plain names: `background`, `fill`, `noFill`,
`stroke`, `noStroke`, `strokeWeight`, `circle`, `ellipse`, `rect`,
`square`, `line`, `point`, `triangle`, `quad`, `arc`, `beginShape` /
`vertex` / `endShape`, `text`, `textSize`, `textAlign`, `textFont`,
`push`, `pop`, `translate`, `rotate`, `scale`, `color`, `hsl`,
`lerpColor`, `map`, `lerp`, `constrain`, `dist`, `mag`, `norm`,
`radians`, `degrees`, `random`, `noise`, `noiseSeed`, the `Math`
shortcuts, `PI` / `TWO_PI` / `HALF_PI`, and the live values `width`,
`height`, `mouseX`, `mouseY`, `mouseIsPressed`, `frameCount`, `deltaTime`,
`millis()`. Colours take p5's forms (gray, gray + alpha, r g b, r g b a in
0–255, or any CSS string). A function you define with the same name wins.
The editor's **Reference** section lists all of it with one line each and
inserts a name at the caret when clicked. (`src/play/kit/layers.js`,
`klSketchHelpers`; the list in `scriptReference.ts`.)

### Controls: sliders, toggles, buttons

Every entry in `params` is a control on the layer, with the + that puts it
on the Play panel. Three kinds:

| Declare | What you get | In the sketch |
|---|---|---|
| `speed: { value: 1, min: 0, max: 4, step: 0.05 }` or a bare number | A slider (a bare number is 0–1) | `s.params.speed`, or a top-level `let speed` the slider drives |
| `glow: true` or `{ kind: 'toggle', value: true, label: 'Glow' }` | A switch; on the Play panel a 0/1 control keys and beats can flip | `s.params.glow` is 0 or 1; a `let glow` is driven as a boolean |
| `wipe(s, amount) { … }` (a function) or `{ kind: 'button' }` | A button on the layer, and an **action** on the Play panel: a key, a click, a beat or a note presses it | The function runs on the next frame with `s` and the amount; `s.pressed('wipe')` is true that frame; `s.params.wipe` is the amount |

Buttons are what "actions" are for the other layers (Burst, Drop again,
Clear strokes): they join the same list in Add control and in the Actions
section, so nothing else is needed to trigger them from a mapping. A toggle
is the right shape for a binary choice like Invert; a slider with two steps
would work but reads badly.

### Make a variable a control

Select a top-level variable set to a number (`let speed = 2;`), to
`true`/`false` (`let invert = false;`), or a function's name (double
click selects a word) and the editor offers **Make it a slider / toggle /
button**, and **…and a Play control** to put it on the Play panel in the
same click. One click adds the entry to the params object (creating one if
the sketch has none), turns a `const` into a `let`, and applies. The kit
then writes the control's value into that variable every frame before
`draw`, so the rest of the sketch keeps saying `speed`. A function goes in
by reference (`wipe: wipe`), so it is unchanged and now presses.
(`scriptTools.ts`: `controlCandidate`, `makeControl`; the kit's `set(name,
value)` assigns through a direct `eval` inside the sketch's scope.)

### The editor

**Open editor** on the layer opens the big window (the Custom Function one,
for JavaScript): syntax colouring, autocomplete (the helpers, `s.` and
`ctx.` members, `Math.`, your own variables and functions, the params'
keys), undo and redo, Tab and auto-indent, bracket wrapping, ⌘/Ctrl+Enter
to apply. Beside it, four tabs:

- **Run**: a scratch run of the draft, as you type, on its own canvas with
  the layer's current control values and the mouse over the box; the
  picture reads as a soft glow and there are no nulls. Buttons the sketch
  declares are pressable under it. Nothing reaches the picture until Apply.
- **Reference**: everything the sketch can call, one line each, inserted at
  the caret on click.
- **Patterns**: the pieces sketches are made of, ready to insert where the
  caret is (or at the top of the file): a params block with every kind, a
  particle system in three functions, bounce and wrap, ease and spring
  follows, orbit, a noise flow field, a flock in two rules, a grid loop,
  polygons, trails, gradients, text, mouse and click handling, reading the
  picture, attaching to a null. Each says whether it belongs at the top or
  inside `draw`, and its numbers are plain variables so Make a slider works
  on them. (`scriptSnippets.ts`.)
- **Controls**: the declared controls as rows (sliders, switches, Press
  buttons) with their + for the Play panel, and the Canvas settings.

The footer holds **Starters** (the built-in sketches, then the ones you
saved), **Import** (another script layer in this file, or a saved sketch:
everything, its functions only, or one function; appended under a
comment), and **Save as starter** (this sketch, by name, in localStorage:
`src/play/savedScripts.ts`). On a phone the panel stacks under the editor.

### Sliders you declare

`params` is read once when the code is applied. Each entry becomes a
control on the layer (`p_<key>` in the saved file for sliders and toggles;
buttons are actions and store nothing), a candidate for a Play control,
something a null can drive, and a keyframe target, exactly like a built-in
layer property. An object gives `value`, `min`, `max`, `step`, `label`,
`hint`, `kind`. Values survive code edits: re-declare a control and it
keeps the value it had; loading a starter resets them.

### How it runs

- The code is compiled once per change into its `setup` and `draw`
  (`klSketchCompile` in `layers.js`) and stepped each frame
  (`klSketchStep`: drives the variables, runs setup on the first frame or a
  resize, clears, delivers presses, draws). The kit (`drawScript` in
  `kit.js`) and the editor's scratch run share those two functions, so a
  sketch runs the same in the app, in the editor and in exported websites. Compile errors and runtime errors are reported to the
  editor through `env.scriptStatus`; a broken script draws nothing until the
  code changes.
- The script draws into its own canvas, which is composited with the
  layer's **Opacity** and **Blend**. **Clear** off keeps the canvas between
  frames for trails; the Trail example fades it itself with
  `destination-out`.
- Because it is a layer, everything else already applies: the Layers node
  sees it, Solo and visibility work, it records and exports, it is in play
  files, and a Cloner can copy it.

### What it does not do yet

- **No imports.** The sketch is one file; the p5 vocabulary is built in
  rather than loaded from a CDN, so exported websites stay self-contained
  and work offline. Loading a library (three, a font, a data file) is the
  plugin step below.
- **No reuse of the built-in layers' code yet.** The particle, bodies and
  flocking code lives in the kit; the Patterns tab carries small
  re-writes of the common behaviours (spawn and move, bounce, flock,
  springs) rather than a way to import the kit's own functions piecemeal.
  That, and saving a sketch as a layer kind of its own, is `defineLayer`
  below.
- **No workers.** The script runs on the main thread inside the frame; an
  infinite loop hangs the page like any script would. Fine for your own
  sketches, not for code from strangers.
- **No sources.** A script cannot yet publish a number as a mapping source
  (a "beat detected" flag, a fetched value). That is `defineMapping` below.

## 3. From one layer to plugins

`docs/playfield-sdk.md` lays out the four definitions an add-on can
register: `defineNode` (GLSL), `defineLayer` (JavaScript drawing, which the
Script layer now prototypes), `defineMapping` (a source of numbers), and
`defineFeed` (media coming in). The Script layer is the cheapest way to get
`defineLayer` right, because its `s` object *is* the capability context a
plugin layer would receive: it exposes what a layer may touch and nothing
else. Turning it into a plugin API means:

1. **Package it.** A plugin is a folder or single file with a manifest
   (`id`, `version`, what it registers). The Script layer's code plus its
   `params` becomes `defineLayer({ params, setup, draw })`; a file-backed
   version can `import` libraries.
2. **Give it a name in the UI.** Registered layers appear in the Layers
   panel's Add list under the plugin's name; nodes in the palette; sources
   in the mapping picker; feeds in Texture/Video Input. Saved graphs store
   the namespaced id, so a missing plugin says what to install.
3. **Add the two missing channels.** `defineMapping` (`open(ctx) → { read(),
   close() }`) turns a script's numbers into sources; `defineFeed`
   publishes a texture with size and timestamp. The YouTube importer is a
   feed (a video element from an embed or a stream) and nothing else; the
   Figma importer is a feed (frames as images) plus a layer that places
   them; a heart-rate monitor or a stock ticker is a mapping.
4. **Harden when strangers arrive.** Validate registrations against a
   schema at install; run third-party layers in a worker with an
   OffscreenCanvas when the plugin is not local; version the SDK and test
   against the built-in layers moved behind the same API.

The order matters: the Script layer proves the shape of `defineLayer` with
zero packaging work, the two channels are small once that exists, and the
packaging and sandboxing are the part that should wait until there is
someone to package for.

## 4. Where things are

- Type, schema, defaults, starter code: `src/types/playLayers.ts`
  (`ScriptLayer`, `DEFAULT_SCRIPT`, `layerNumericProps`).
- Runtime: `drawScript` in `src/play/kit/kit.js`; status back to the app
  through `KitEnv.scriptStatus` and `src/play/scriptStatus.ts`.
- Editor and starters: `ScriptEditor` in
  `src/components/play/layers/editors.tsx`; the big window
  `ScriptModal.tsx` with `ScriptPreview.tsx` (scratch run),
  `ScriptControls.tsx` (rows), `scriptCompletions.ts`, `scriptSnippets.ts`,
  `scriptReference.ts`, `scriptTools.ts`, `scriptExamples.ts`; JavaScript
  colouring in `src/components/code/jsSyntax.ts`; saved sketches in
  `src/play/savedScripts.ts`.
- Script buttons as actions: `ActionKind` includes `script:<key>`
  (`src/types/play.ts`: `actionsForLayer`, `scriptActionKey`), labelled by
  `actionLabel` in `layers/help.ts`; the kit queues a press and delivers it
  on the layer's next frame.
- Tests: `src/play/__tests__/scriptLayer.test.ts`,
  `src/play/__tests__/scriptControls.test.ts`.
