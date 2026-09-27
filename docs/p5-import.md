# Importing p5.js sketches

A p5.js sketch runs on a **Script layer**. You can paste it into the layer's
editor and press Apply, but a real p5 project is usually more than one file:
an index.html, a few scripts, some images, some sliders on the page. The
importer takes the whole project and turns it into one Script layer that
runs it the p5 way.

Open it with **Import p5.js sketch…**. On a Script layer's card the button
is **Import p5.js…**: it replaces that layer's sketch, and undo brings the
old one back.

The code is in `src/play/p5import/` (reading the project, the report, the
controls) and `src/play/kit/p5.js` (p5 itself, on the layer). Three Play
examples come from it: **p5: an imported flow field**, **p5: a sketch in
three files** and **p5: a WEBGL sketch in 3D**. Their original projects are
in `src/store/p5Examples.ts`.

## 1. What it accepts

- **Pasted code.** One sketch, global mode (`function setup()`, `function
  draw()`) or instance mode (`new p5(p => { … })`).
- **.js files.** One or several. Without an index.html the scripts run in
  alphabetical order, with the one that defines setup or draw last.
- **A folder** (Open a folder…) or **a .zip** of one. Junk such as
  `.DS_Store` and `__MACOSX` is ignored, and a single top folder is taken
  off the paths.

With an **index.html**, its `<script src>` tags give the order the scripts
run in. Commented-out tags are ignored. A script written inside the page
becomes a tab of its own (`inline-1.js`). Scripts the page does not load
still come in, after the others, and the report says so.

**p5 itself is left out**: the layer has it built in. So is p5.sound (see
[Sound](#8-sound)). Other p5 libraries and addons (p5.collide2d, ml5 and
the like), and scripts loaded from the web, are skipped and listed as not
supported.

**Assets** keep the path the sketch loads them by (`assets/cat.png`):

| Kind | Files | What happens |
|---|---|---|
| Images | png, jpg, gif, webp, svg | Kept in the layer as data, and also added to your image library. Up to 8 MB each. |
| Fonts | ttf, otf, woff, woff2 | Kept in the layer for `loadFont`. Up to 2 MB. |
| Data | json, txt, csv, tsv | Kept as text for `loadJSON`, `loadStrings`, `loadTable`. Up to 2 MB. |

Sounds, videos, shader files, 3D models and page styles are listed as left
out, with the reason. A file that is too big is listed, not kept. The report
also warns when the sketch loads a file the project does not have, or one
whose name differs only in case.

## 2. The report

Before anything is made, the dialog lists every p5 name the sketch uses,
with the lines it is on:

- **Supported**: runs as in p5.
- **Mapped**: works, but differently. `createCanvas` is fitted into the
  picture; `createSlider` and friends become controls; `WEBGL` runs on the
  3D mode; `loadImage` reads the bundled file; p5.Amplitude and p5.FFT read
  the live audio input.
- **Stubbed**: exists and does nothing (page elements, cursors, saving).
- **Unsupported**: calling it stops the sketch with a clear error.

Syntax errors are shown with their file and line. The sketch can still be
imported and fixed in the editor.

## 3. How a p5 sketch runs on a Script layer

- **Its own canvas.** The sketch draws on a canvas the size `createCanvas`
  asked for. Every frame the layer fits that canvas into the picture,
  centred, keeping its shape. Without `createCanvas` the canvas is the
  picture's size.
- **It keeps what was drawn.** p5 does not clear between frames, so neither
  does the layer's canvas. An imported layer has "Clear each frame" off; the
  sketch's `background()` does the clearing, as in p5.
- **Density.** A small canvas shown large is drawn at a higher pixel density
  (up to 3), so it stays sharp. `pixelDensity(n)` sets it yourself. A sketch
  that reads pixels (`loadPixels`, `get`, `set`) is kept at density 1.
- **The mouse.** `mouseX` and `mouseY` are in the sketch's own pixels, even
  though its canvas is scaled. `mousePressed`, `mouseReleased`,
  `mouseClicked`, `doubleClicked`, `mouseMoved`, `mouseDragged` and
  `mouseWheel` are called as in p5, only while the pointer is over the
  picture. Touch events fall back from the mouse ones.
- **Keys.** `keyPressed`, `keyReleased`, `keyTyped`, `key`, `keyCode` and
  `keyIsDown` work. Typing in a text field does not reach the sketch.
- **Timing.** `frameRate(n)` draws n times a second (it can only go slower
  than the page). `noLoop()` draws once; `redraw()` draws once more;
  `loop()` starts again. `frameCount`, `deltaTime` and `millis()` count from
  the sketch's start.
- **preload.** `preload()` runs first, and setup waits until everything it
  asked to load has loaded.
- **Randomness.** `random`, `noise` and `randomGaussian` follow p5, and
  `randomSeed` / `noiseSeed` make them repeat.

## 4. Several files

A Script layer holds its main file, **sketch.js**, and other files as tabs.
sketch.js is always the first tab and cannot be renamed or removed. The other
tabs run **before** it, in their order, and all of them share **one scope**:
a class in `particle.js` and a function in `forces.js` are plain names in
sketch.js, exactly as when a page loads several scripts.

Whichever file defines setup or draw becomes sketch.js (renamed, if it was
called something else). `import` and `export` lines are taken out when the
sketch runs, keeping line numbers, so a project written as modules still
works. An error names its file and line: `Runtime (particle.js:12): …`.

## 5. DOM controls become the layer's controls

p5's page controls have no page to live on, so each one becomes a
**declared control** of the layer: a slider, toggle, choice, colour or
button on the layer's card, which Play controls, mappings and actions can
drive like any other.

| p5 | Control | Reads as |
|---|---|---|
| `createSlider(min, max, value, step)` | slider (whole steps when the step is 1) | `.value()` |
| `createCheckbox(label, checked)` | toggle | `.checked()` |
| `createSelect()` with `.option()` / `.selected()` | choice | `.value()`, `.selected()` |
| `createRadio()` with `.option()` | choice | `.value()` |
| `createColorPicker(colour)` | colour | `.value()` (hex), `.color()` |
| `createButton(label)` | button | `.mousePressed(fn)` runs when pressed |

The create call is rewritten as `control('key')` and an entry is added to
the `params` object at the top of sketch.js:

```js
// Before
countSlider = createSlider(100, 3000, 1200, 100);
// After
const params = {
  count: { value: 1200, min: 100, max: 3000, step: 100, label: 'Count', restart: true },
};
countSlider = control('count');
```

The key comes from the variable's name without its ending (`countSlider` →
`count`), unless that clashes with something. The rest of the code is left
as it was: `.value()`, `.checked()` and `.color()` answer from the control,
and `.changed(fn)` and `.input(fn)` run when the control moves. A slider
whose range is worked out as the sketch runs (`createSlider(0, width)`) gets
a default range and a note to check it.

Other DOM calls (`createDiv`, `createP`, `createInput`, `select`,
`.position()`, `.style()` and so on) do nothing.

## 6. Choose what becomes a control

Besides its page controls, a sketch has numbers worth a slider: a
top-level `let speed = 2`, or a literal such as the `0.01` in
`noise(x * 0.01)` or the `255, 120, 40` in `fill(255, 120, 40)`. The dialog
lists these **candidates**, best first, with a few ticked to start:

- **Ranking.** Names like speed, scale, count, size, radius or noise score
  well; so do loop counts and colours given to `fill` or `stroke`. Values
  that are used everywhere or look like layout (0, 1, the canvas size)
  score low.
- **State or parameter.** A variable the sketch changes as it runs (a
  position, a counter, an array it pushes to) is **state**, not a control,
  and is never ticked.
- **Restart.** A value read only before the sketch starts (at the top
  level, in setup or preload) does nothing if it changes later. Its control
  is marked `restart: true`: moving it starts the sketch over. A DOM slider
  that is only read in setup (a particle count) is marked the same way.

Ticking one makes the smallest edit that does it: a literal moves into a
new top-level variable, a `const` becomes `let`, and the variable joins
`params`. The layer then writes the control's value into that variable
before each frame, so the rest of the code does not change.

After the import, the same thing works in the editor: select or
right-click a value and choose **Make it a control…**, or on a control's
entry choose **Turn back into a plain value**, which puts its current value
back in the code and removes the entry.

Instance-mode sketches keep their variables inside the `new p5(…)`
function, so those cannot become controls; their DOM controls still can.

## 7. WEBGL sketches run in 3D

`createCanvas(w, h, WEBGL)` makes the layer a **3D** Script layer, drawn
with three.js. These p5 names work:

`box`, `sphere`, `ellipsoid`, `torus`, `cylinder`, `cone`, `plane`,
`rotateX`, `rotateY`, `rotateZ`, `normalMaterial`, `ambientMaterial`,
`specularMaterial`, `emissiveMaterial`, `shininess`, `texture`,
`ambientLight`, `directionalLight`, `pointLight`, `camera`, `perspective`,
`ortho`, `orbitControl`.

Shapes, `translate`, `rotate`, `scale`, `push` / `pop`, `fill`, `stroke`,
`beginShape` and the maths work as in 2D. Reading pixels, `filter` and
`erase` are 2D only; the report flags them.

## 8. Sound

The layer plays no sound, but it can **listen**. The p5.sound readers read
the app's live audio input (the microphone or a virtual cable, set in Play):

- `new p5.Amplitude()` → `getLevel()`, with `smooth()`.
- `new p5.FFT()` → `analyze()` (0–255 per bin), `waveform()`,
  `getEnergy('bass' | 'lowMid' | 'mid' | 'highMid' | 'treble')` or
  `getEnergy(lowHz, highHz)`, `getCentroid()`, `linAverages()`.
- `new p5.AudioIn()` → `start()`, `getLevel()`.

`loadSound`, sound files and playback (`play`, `loop`, `setVolume`…) are
not supported; the report marks them as errors.

## 9. The Console

The editor's **Console** shows what the sketch prints: `console.log`,
`info`, `warn`, `error` and `table`, p5's `print()`, and runtime errors with
their file and line. Values are copied when logged, and objects, arrays,
vectors and colours can be opened.

`watch(name, value)` keeps one live line per name instead of a new line
every frame, with a small graph for numbers. A line that repeats the one
before it (a log in draw) folds into it with a count. Each layer keeps the
last 1000 lines.

In an exported website there is no Console: the sketch's output goes to the
browser's console.

## 10. What is supported

The lists live in `src/play/kit/p5.js` (`KP5_NAMES`, `KP5_CALLBACKS`,
`KP5_STUBBED`, `KP5_UNSUPPORTED`, `KP5_WEBGL`, `KP5_SOUND`); the importer
and the editor read them from there.

**Supported.** Structure (`createCanvas`, `resizeCanvas`, `pixelDensity`,
`frameRate`, `noLoop`, `loop`, `redraw`, `push`, `pop`), input (mouse, keys,
touches), colour (`background`, `fill`, `stroke`, `colorMode` RGB / HSB /
HSL, `color`, `lerpColor` and the channel readers, `erase`, `blendMode`),
shapes and curves (`ellipse` to `quad`, `arc`, `bezier`, `curve`,
`beginShape` with vertices and contours), transforms, type (`text`,
`textSize`, `textFont`, `textAlign`, `loadFont` and the rest), images and
pixels (`image`, `loadImage`, `tint`, `createImage`, `createGraphics`,
`get`, `set`, `pixels`, `filter`), files (`loadJSON`, `loadStrings`,
`loadTable`), maths (`map`, `constrain`, `lerp`, `dist`, `noise`, `random`,
`createVector` and all of `p5.Vector`), the string and array helpers, and
the constants.

**Stubbed** (run, do nothing): `createDiv`, `createP`, `createSpan`,
`createImg`, `createA`, `createElement`, `createInput`, `createFileInput`,
`select`, `selectAll`, `removeElements`, `noCanvas`, `cursor`, `noCursor`,
`fullscreen`, `textWrap`, `save`, `saveCanvas`, `saveFrames`, `saveJSON`,
`saveStrings`, `describe`, `describeElement`, `gridOutput`, `textOutput`.

**Unsupported** (stop the sketch with an error): `loadShader`,
`createShader`, `shader`, `resetShader`, `loadModel`, `model`,
`createFramebuffer`, `buildGeometry`, `beginGeometry`, `endGeometry`,
`createCapture`, `createVideo`, `createAudio`, `loadSound`, `soundFormats`,
`loadXML`, `loadBytes`, `httpGet`, `httpPost`, `httpDo`,
`requestPointerLock`, `exitPointerLock`, `textToPoints`, `saveGif`,
`setAttributes`, `debugMode`, `noDebugMode`.

## 11. Limits

- **Pixels are slow.** `loadPixels` / `updatePixels` on a big canvas at a
  high density is a lot of work every frame. Pixel sketches run at density
  1; keep their canvas small if they stutter.
- **Canvas size.** Without `createCanvas` the canvas is the picture's size,
  not p5's 100 × 100. A sketch sized with `windowWidth` / `windowHeight`
  gets the picture's size, and `windowResized()` is called when the picture
  changes size.
- **Instance mode.** Its variables cannot become controls (see above).
- **createGraphics** makes 2D buffers only; `createGraphics(w, h, WEBGL)`
  is not supported.
- **Not there:** `textToPoints`, shaders, video and camera capture,
  `loadXML`, sound playback, and p5 libraries.
- **Performance.** Everything runs on the CPU like any Script layer,
  alongside the shader. Thousands of shapes a frame is fine; tens of
  thousands may not be.

## 12. Saving and exporting

The layer record carries everything: sketch.js as `code`, the other tabs as
`files`, the assets as `assets` (images and fonts as data URLs), `p5: true`
and the mode. Saves, play files and shared setups keep the whole project.
Exported websites run the same layer kit, so an imported sketch runs there
as it does in the app, controls included.
