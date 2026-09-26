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
and the other layers carry on. Four starters load with one click: Dots,
Trail, Picture grid, Orbit a null.

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

### Make a variable a slider

Select a top-level variable set to a number (`let speed = 2;`, or double
click its name) and the editor offers **Make ‘speed’ a slider**. One click
adds `speed: { value: 2, min: 0, max: 8, step: 1 }` to the params object
(creating one if the sketch has none), turns a `const` into a `let`, and
applies. The kit then writes the slider's value into that variable every
frame before `draw`, so the rest of the sketch keeps saying `speed`. The
same variable is now a Play control, a null drive or a keyframe target
like any layer property. (`scriptTools.ts`; the kit's `set(name, value)`
assigns through a direct `eval` inside the sketch's scope.)

### Sliders you declare

`params` is read once when the code is applied. Each entry becomes a slider
on the layer (`p_<key>` in the saved file), a candidate for a Play control,
something a null can drive, and a keyframe target, exactly like a built-in
layer property. A bare number (`speed: 1`) is a 0–1 slider; an object gives
`value`, `min`, `max`, `step`, `label`, `hint`. Values survive code edits:
re-declare a slider and it keeps the value it had.

### How it runs

- The code is compiled once per change into its `setup` and `draw` by the
  kit (`drawScript` in `kit.js`), so it runs in the app and in exported
  websites alike. Compile errors and runtime errors are reported to the
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

- **No imports.** The sketch is one file. Loading a library (three, a font,
  a data file) is the plugin step below.
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
  `src/components/play/layers/editors.tsx`,
  `src/components/play/layers/scriptExamples.ts`.
- Tests: `src/play/__tests__/scriptLayer.test.ts`.
