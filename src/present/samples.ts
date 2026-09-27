/**
 * samples.ts — the presentations the Present page offers ready-made, in two
 * groups. Learn the app (teachingSamples.ts): the Studio, a first Play, field
 * sockets, the Convert page, making a lesson. Topics: the Book of Shaders path
 * (teachingSamples.ts), ray marching (sample.ts), matrices, playing a shader,
 * and sketching over a shader with Script layers. Each is built from bundled
 * examples, so a sample is always in step with the examples it quotes.
 */
import { buildSamplePresentation, SAMPLE_TITLE } from './sample';
import { SKETCH_BUTTONS, SKETCH_FIRST, SKETCH_MOUSE, SKETCH_P5, SKETCH_PARTICLES, SKETCH_PICTURE } from '../store/playSketches';
import { blocks, linesBetween, presentation, sources, step } from './sampleKit';
import { sampleFonts, withTypography } from './sampleStyle';
import { PALETTE_PRESETS, paletteFill } from '../lib/backgroundLibrary';
import type { BlockAspect, Presentation, Step } from '../types/presentation';
import { BOOK_TITLE, CONVERT_TITLE, FIELD_TITLE, FIRST_PLAY_TITLE, MAKING_TITLE, STUDIO_TITLE, buildBookPresentation, buildConvertPresentation, buildFieldSocketsPresentation, buildFirstPlayPresentation, buildMakingPresentation, buildStudioPresentation } from './teachingSamples';

export interface SamplePresentation {
  title: string;
  /** One line for the menu: what it's built from. */
  hint: string;
  /** 'app': how to use Playfield; 'topic': a subject taught with it. */
  group: 'app' | 'topic';
  build: (now?: number) => Promise<Presentation>;
}

// ── Transforms with matrices ────────────────────────────────────────────────

export const MATRICES_TITLE = 'Transforms with matrices';

const ROTATE_GLSL = `// A 2×2 rotation. GLSL fills a mat2 column by column,
// so the first two numbers are where the x axis lands.
mat2 rotate2d(float a) {
  float c = cos(a), s = sin(a);
  return mat2( c, s,    // column 1: x goes to (c, s)
              -s, c);   // column 2: y goes to (-s, c)
}

// Turn the space, and the box turns the other way:
vec2 p = rotate2d(0.4 * u_time) * uv;
float d = sdBox(p, vec2(0.3));`;

export async function buildMatricesPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['matrixWhatItDoes', 'matrixCombineUndo', 'matrixAnyBasis', 'matrixFoldFractal', 'matrixColor'] as const;
  const src = await sources(keys);
  const { text, render, interactive, nodeCode, glsl } = blocks(src);
  const steps: Step[] = [
    step('Four numbers move all of space', [
      interactive('matrixWhatItDoes', String.raw`A 2×2 matrix takes every point $(x, y)$ of the canvas somewhere new:

$$\begin{pmatrix}x'\\ y'\end{pmatrix} = \begin{pmatrix}a & b\\ c & d\end{pmatrix}\begin{pmatrix}x\\ y\end{pmatrix}$$

Read it by columns: $(a, c)$ is where the $x$ axis lands, $(b, d)$ where the $y$ axis lands. Set [[control:a]] to 2 and the pattern gets *narrower*: the matrix moves the space the pattern is read from, so the picture moves the other way. Set [[control:d]] to 0 and everything collapses onto a line.`, [
        ['a', 'a', 'Where the x axis lands, across'], ['b', 'b', 'Where the y axis lands, across'], ['c', 'c', 'Where the x axis lands, up'], ['d', 'd', 'Where the y axis lands, up'],
      ]),
    ]),
    step('Rotation, in code', [
      text(String.raw`Turning by an angle $\theta$ sends the $x$ axis to $(\cos\theta, \sin\theta)$ and the $y$ axis a quarter turn further on:

$$R(\theta) = \begin{pmatrix}\cos\theta & -\sin\theta\\ \sin\theta & \cos\theta\end{pmatrix}$$

In GLSL that's one small function. Watch the order: a mat2 is written column by column, so the numbers look transposed next to the maths.`),
      glsl(ROTATE_GLSL, 'Rotation as a GLSL function', [[5, 6]]),
    ], 2),
    step('Combine, then undo', [
      interactive('matrixCombineUndo', String.raw`Matrices multiply into one: $M = R\,K\,S$ turns, stretches and scales in a single step (the rightmost acts first).

To **draw a shape moved by** $M$, read the space through the inverse: $d(M^{-1}\mathbf{p})$. The determinant says how much $M$ scales area, and $\sqrt{\det M}$ puts the distance back in canvas units so the outline keeps its width.

Try [[control:amt]] and [[control:dir]], then [[control:w]] against [[control:h]].`, [
        ['amt', 'Stretch'], ['dir', 'Stretch angle'], ['w', 'Width'], ['h', 'Height'],
      ]),
      ...nodeCode('matrixCombineUndo', 'inv', 'The Mat2 Inverse node in the generated shader'),
    ]),
    step('A grid is a basis', [
      interactive('matrixAnyBasis', String.raw`A lattice is two steps: from each cell centre to its neighbours. Those two steps are the columns of a matrix $B$, and the cell a point is in is

$$\text{cell} \approx \operatorname{round}(B^{-1}\mathbf{p})$$

So the same grid code draws squares, bricks and diamonds. An LFO sweeps [[control:shear]] so you can watch one turn into the next; set [[control:h]] to 0.87 with Shear at 0.5 for hexagons.`, [
        ['shear', 'Shear'], ['w', 'Step across'], ['h', 'Step up'], ['spin', 'Turn speed'],
      ]),
    ]),
    step('Fold, turn, scale, repeat', [
      render('matrixFoldFractal', 'Seven passes of one fold, one rotation, one scale', { aspect: '1:1', pointer: false }),
      text(String.raw`Repeat three steps and a fractal appears. Each pass mirrors the plane into one quadrant, shifts it, turns it with $R(\theta)$ and zooms by $s$:

$$\mathbf{p}_{k+1} = s\,R(\theta)\,\big(|\mathbf{p}_k| - \mathbf{o}\big)$$

and adds a thin ring of light where $|\mathbf{p}_{k+1}| = 0.4$. Seven passes, one angle: change $\theta$ and the whole figure rearranges. Open it in the Studio: the loop is an iterated group.`),
    ], 2),
    step('Colour is a vector too', [
      interactive('matrixColor', String.raw`A colour is three numbers, so a $3\times 3$ matrix can grade it: each output channel is a weighted sum of R, G and B. The classic sepia:

$$\begin{pmatrix}R'\\ G'\\ B'\end{pmatrix} = \begin{pmatrix}0.393 & 0.769 & 0.189\\ 0.349 & 0.686 & 0.168\\ 0.272 & 0.534 & 0.131\end{pmatrix}\begin{pmatrix}R\\ G\\ B\end{pmatrix}$$

Blend toward it with [[control:sepia]]; [[control:hue]] turns every colour around the grey axis, which is a rotation matrix in colour space.`, [
        ['sepia', 'Sepia'], ['sat', 'Saturation'], ['hue', 'Hue turn', 'Driven by an LFO; drag to take over'],
      ]),
    ]),
  ];
  // A dark gradient with a vignette behind the first step, and a grotesque with Plex for the text and code.
  const ink = PALETTE_PRESETS.find(x => x.id === 'preset:ink');
  const first = ink ? { ...steps[0], background: { kind: 'fill' as const, fill: paletteFill(ink), vignette: 0.45 } } : steps[0];
  const doc = presentation(MATRICES_TITLE, keys, src, [first, ...steps.slice(1)], now);
  return withTypography(doc, await sampleFonts({ heading: { family: 'Space Grotesk', weight: 600 }, body: { family: 'IBM Plex Sans' }, code: { family: 'IBM Plex Mono' } }));
}

// ── Playing a shader ────────────────────────────────────────────────────────

export const PLAYING_TITLE = 'Playing a shader';

export async function buildPlayingPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['playControls', 'playMouse', 'playLfo', 'playKeys', 'playNull', 'playGlowText', 'playTake'] as const;
  const src = await sources(keys);
  const { text, render, interactive, nodeCode } = blocks(src);
  const steps: Step[] = [
    step('A control is a live number', [
      interactive('playControls', `A shader compiles once. Its numbers don't have to: a **control** is a slider for one of them (a *uniform*), so moving it changes the picture on the next frame with no recompile.

Drag [[control:radius]], [[control:falloff]] and pick a [[control:tint]]. The rest of this lesson is ways to move sliders like these without touching them.`, [
        ['radius', 'Radius'], ['falloff', 'Falloff'], ['tint', 'Tint'],
      ]),
    ]),
    step('Mappings: a source drives a control', [
      interactive('playMouse', String.raw`A **mapping** reads a source as a number $s$ from 0 to 1 and writes it into a control's range through a curve $f$:

$$v = v_{\text{lo}} + (v_{\text{hi}} - v_{\text{lo}})\, f(s)$$

Here mouse $x$ drives [[control:x]] and mouse $y$ drives [[control:falloff]], upside down (the range runs from 24 to 3) through an Exp curve, with a little smoothing. The badge under each slider names what drives it.`, [
        ['x', 'Position X'], ['falloff', 'Falloff'],
      ]),
    ]),
    step('Oscillators and the clock', [
      interactive('playLfo', String.raw`An **LFO** is a source that moves on its own. A sine at $f$ Hz with phase $\varphi$:

$$s(t) = \tfrac12 + \tfrac12 \sin\!\big(2\pi (f t + \varphi)\big)$$

A **clock** is the same wave locked to a tempo, one cycle every few beats:

$$f = \frac{\text{BPM}}{60 \cdot \text{beats}}$$

[[control:radius]] breathes at 0.25 Hz, [[control:x]] sways on a triangle, and a 120 BPM saw pulses the [[control:tint]].`, [
        ['radius', 'Radius'], ['x', 'Sway'], ['tint', 'Tint'],
      ]),
    ]),
    step('Keys and envelopes', [
      interactive('playKeys', `A **key** is 1 while held. A **trigger** plays an envelope each time it fires: **A**ttack up to the peak, **D**ecay to the **S**ustain level while held, **R**elease after you let go.

Click the picture, then hold **A** to grow [[control:radius]] and tap **Space** to make [[control:y]] jump. The same trigger can be a beat, a MIDI note, an audio hit or a click on a shape.`, [
        ['radius', 'Radius (hold A)'], ['y', 'Jump (Space)'],
      ]),
    ]),
    step('Nulls: a point you can drag', [
      interactive('playNull', `A **null** is a point on the picture. Its X and Y are sources, so dragging it can move anything; it can also follow the mouse or another null on a spring.

Drag the blue marker: [[control:x]] and [[control:y]] follow it, over ranges chosen so the glow sits right under it.`, [
        ['x', 'Circle X'], ['y', 'Circle Y'],
      ]),
    ]),
    step('Layers back into the shader', [
      render('playGlowText', 'Text and pen strokes glowing through the Layers node (drag to write)'),
      text(String.raw`Layers (text, shapes, particles, sketches) draw over the picture, and the **Layers** node hands what they drew back to the graph as a signed distance $d$. SDF Glow turns that into light:

$$L = e^{-k\,d}$$

so anything a layer draws can glow, warp or mask the shader.`),
      ...nodeCode('playGlowText', 'glow', 'SDF Glow reading the Layers node’s distance'),
    ], 2),
    step('Record it, render it', [
      render('playTake', 'Live: the comet and the glow follow the mouse; Space sparkles'),
      text(`Playing live is real time: a screen recording is only as smooth as the machine was. A **take** keeps the performance as keyframes instead (every control, null, the pointer and each action), so it can be watched back and then **rendered** frame by frame at any size.

Open this example on the Play page: it ships with an 8-second take. **Record → Performance → Takes**, press ▶ to watch it, then **Render…**.`),
    ], 2),
  ];
  return presentation(PLAYING_TITLE, keys, src, steps, now);
}

// ── Sketching over shaders ──────────────────────────────────────────────────

export const SKETCHING_TITLE = 'Sketching over shaders';

export async function buildSketchingPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['scriptFirst', 'scriptMouse', 'scriptPicture', 'scriptButtons', 'scriptParticles', 'scriptP5', 'scriptGlow'] as const;
  const src = await sources(keys);
  const { text, render, interactive, script, nodeCode } = blocks(src);
  const wide: { aspect: BlockAspect } = { aspect: '16:9' };
  const steps: Step[] = [
    step('Per pixel, per frame', [
      text(`A shader answers one question for every pixel at once, with no memory: *what colour is this pixel?* That makes it fast, and it makes lists of things, physics and text awkward.

A **Script** layer is the other half: a JavaScript sketch that runs once per frame on a 2D canvas over the picture, and remembers whatever it likes. \`setup(s)\` runs once, \`draw(s)\` every frame, and every entry in \`params\` becomes a slider.`),
      interactive('scriptFirst', `The ring is a sketch; the glow under it is the shader. Try [[control:count]], [[control:size]] and [[control:spin]], then edit the code below: change the \`hsl(…)\` line and the ring changes here, on this step only.`, [
        ['count', 'Dots'], ['size', 'Ring size'], ['spin', 'Spin'],
      ]),
      script('scriptFirst', 'ring', 'The Ring layer. Edit it: this step’s canvas runs your version', { live: true, highlightLines: linesBetween(SKETCH_FIRST, 'function draw', 'ctx.fill();') }),
    ]),
    step('The mouse', [
      render('scriptMouse', 'Move over it; hold the button to swell the chain', wide),
      script('scriptMouse', 'chain', 's.mouse is { x, y, over, down } in pixels', { highlightLines: linesBetween(SKETCH_MOUSE, 'const target', 'head.y +=') }),
    ], 2),
    step('Reading the picture', [
      interactive('scriptPicture', `\`s.picture.brightness(x, y)\` reads the shader under a pixel, 0 to 1. Each dot throws darts and keeps a spot with probability $b^{\\gamma}$, where $b$ is the brightness there and $\\gamma$ is [[control:contrast]]: bright parts collect more dots, and the stipple follows the moving FBM. The picture itself is hidden.`, [
        ['dots', 'Dots'], ['contrast', 'Contrast γ'],
      ]),
      script('scriptPicture', 'stipple', 'Throwing darts at the picture', { highlightLines: linesBetween(SKETCH_PICTURE, 'function place', 'd.hit = Math.random()') }),
    ]),
    step('Buttons on keys and beats', [
      interactive('scriptButtons', `A sketch can declare **buttons**: \`{ kind: 'button' }\`, or a function in \`params\`. On the Play panel they are **actions**, so a key, a beat, a MIDI note or a click can press them.

A beat presses Kick every beat (and the same beat swells [[control:radius]]). Click the picture, then press **Space** for a bigger kick and **R** to reverse the spin.`, [
        ['radius', 'Glow on the beat'], ['life', 'Ring life'],
      ]),
      script('scriptButtons', 'rings', 's.pressed(\'kick\') is true on the frame the button fires', { highlightLines: linesBetween(SKETCH_BUTTONS, 'if (s.pressed', 'rings.push') }),
    ]),
    step('A particle system, by hand', [
      text(`A particle system is an array and four steps every frame: **spawn**, **move**, **draw**, **die**. Moving is two additions, with $\\mathbf{g}$ for gravity and $\\Delta t$ for the frame's time:

$$\\mathbf{v} \\mathrel{+}= \\mathbf{g}\\,\\Delta t, \\qquad \\mathbf{p} \\mathrel{+}= \\mathbf{v}\\,\\Delta t$$

The code is live: change the colour line, or add a sideways kick to \`p.vx\`, and the fountain above it runs your version.`),
      render('scriptParticles', 'The Fountain layer (the emitter follows the mouse)', { aspect: { w: 21, h: 9 } }),
      script('scriptParticles', 'sparks', 'Spawn, move, draw, die', { live: true, highlightLines: linesBetween(SKETCH_PARTICLES, '// 2. Move', 'p.age += dt;') }),
    ]),
    step('Pasting a p5 sketch', [
      render('scriptP5', 'A p5 ridge-lines sketch over an FBM shader', { aspect: { w: 21, h: 9 } }),
      text(`Most p5.js sketches run as pasted: \`background\`, \`stroke\`, \`noise\`, \`beginShape\`, \`width\`, \`frameCount\` are plain names. Drop \`createCanvas()\`. Declare a variable in \`params\` and the layer writes the slider into it before each draw, so the p5 code never has to change. The one other change: \`clear()\` instead of \`background(0)\`, so the shader shows around the drawing.`),
      script('scriptP5', 'ridges', 'The Ridges layer: p5 code, with params for its two variables', { highlightLines: linesBetween(SKETCH_P5, 'const params', 'let peak') }),
    ]),
    step('Back into the shader', [
      interactive('scriptGlow', String.raw`What a sketch draws can feed the shader. The **Layers** node gives the graph a signed distance $d$ to everything the layers drew, and SDF Glow turns it into light, $L = e^{-k d}$ with $k$ = [[control:falloff]]. Two-pixel white lines become neon. Try [[control:petals]] and the [[control:tint]].`, [
        ['falloff', 'Glow falloff k'], ['tint', 'Glow tint'], ['petals', 'Petals'], ['depth', 'Depth'],
      ]),
      ...nodeCode('scriptGlow', 'layers', 'The Layers node in the generated shader'),
    ]),
  ];
  return presentation(SKETCHING_TITLE, keys, src, steps, now);
}

// ── The list the Present page offers ────────────────────────────────────────

export const SAMPLE_PRESENTATIONS: SamplePresentation[] = [
  // Learn the app: how to use Playfield itself, alongside the Learn lessons.
  { title: STUDIO_TITLE, group: 'app', hint: 'Nodes, wires, sliders, the code, groups, saving', build: buildStudioPresentation },
  { title: FIRST_PLAY_TITLE, group: 'app', hint: 'Controls, the mouse, an LFO, a key, a layer, a take', build: buildFirstPlayPresentation },
  { title: FIELD_TITLE, group: 'app', hint: 'Grid Pattern and Array with a shape of your own', build: buildFieldSocketsPresentation },
  { title: CONVERT_TITLE, group: 'app', hint: 'The Convert page: paste a shader, get nodes', build: buildConvertPresentation },
  { title: MAKING_TITLE, group: 'app', hint: 'Steps, blocks, snapshots, chips, live code, sharing', build: buildMakingPresentation },
  // Topics: shaders themselves.
  { title: BOOK_TITLE, group: 'topic', hint: 'The Book of Shaders, chapter by chapter through Learn', build: buildBookPresentation },
  { title: SAMPLE_TITLE, group: 'topic', hint: 'Built from the Learn 3D lessons', build: buildSamplePresentation },
  { title: MATRICES_TITLE, group: 'topic', hint: 'Built from the Matrices folder', build: buildMatricesPresentation },
  { title: PLAYING_TITLE, group: 'topic', hint: 'Controls, mappings, LFOs, keys, nulls, layers', build: buildPlayingPresentation },
  { title: SKETCHING_TITLE, group: 'topic', hint: 'Script layers, with live code', build: buildSketchingPresentation },
];

/** The groups the menus show the samples in, in order. */
export const SAMPLE_GROUPS: { id: SamplePresentation['group']; label: string }[] = [
  { id: 'app', label: 'Learn the app' },
  { id: 'topic', label: 'Topics' },
];

/** The sample the empty page offers first. */
export const FIRST_SAMPLE = SAMPLE_PRESENTATIONS.find(s => s.title === SAMPLE_TITLE)!;
