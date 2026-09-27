/**
 * teachingSamples.ts — sample presentations that teach Playfield itself,
 * hand in hand with the Learn folder: the Studio, a first Play, field
 * sockets, the Convert page, making a lesson with Present, and the Book of
 * Shaders path through Learn. Built from bundled examples like the others
 * (samples.ts), so what they show is always what the app does.
 *
 * Where the reader has to click something, the text names the button or tab
 * as the app labels it.
 */
import { blocks, presentation, sources, step } from './sampleKit';
import { EXAMPLE_INDEX } from '../store/exampleIndex';
import { CONVERT_EXAMPLES } from '../glslToGraph/examples';
import { SKETCH_FIRST } from '../store/playSketches';
import { SOFT_CIRCLE_AS_WRITTEN, SOFT_CIRCLE_OPTIMISED } from '../store/convertExampleNodes';
import { linesBetween } from './sampleKit';
import type { Presentation, Step } from '../types/presentation';

/** An example's name as the Examples list shows it, in bold. */
const ex = (key: string): string => {
  const label = EXAMPLE_INDEX[key]?.label;
  if (!label) throw new Error(`samples: no example ${key}`);
  return `**${label}**`;
};

/** Where to find a Learn lesson in the Studio. */
const inLearn = (key: string): string => `In the Studio: **Examples → Learn →** ${ex(key)}.`;

/** One GLSL function of a shader, from its signature to its closing brace. */
export function glslFunction(code: string, name: string): string {
  const lines = code.split('\n');
  const a = lines.findIndex(l => new RegExp(`^\\w+\\s+${name}\\(`).test(l));
  if (a < 0) throw new Error(`samples: no function ${name}`);
  const b = lines.findIndex((l, i) => i > a && l === '}');
  if (b < 0) throw new Error(`samples: ${name} doesn’t close`);
  return lines.slice(a, b + 1).join('\n');
}

// ── Getting started in the Studio ───────────────────────────────────────────

export const STUDIO_TITLE = 'Getting started in the Studio';

export async function buildStudioPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['learnColour', 'learnUV', 'learnCircle', 'learnLoop'] as const;
  const src = await sources(keys);
  const { text, render, interactive, slice } = blocks(src);
  const steps: Step[] = [
    step('The Studio at a glance', [
      text(`A shader in Playfield is a graph: small cards (**nodes**) joined by wires. The picture it makes is always on screen.

- **Top bar**: the pages. **Studio** is where you build; **Play**, **Present** and **Convert** come later.
- **Sidebar**, on the left: the **Nodes** tab lists every node, with **Search nodes…** at the top and **Examples** below.
- **Canvas**, in the middle: your graph.
- **Preview**, on the right: the picture the graph makes, live.

On a phone, the picture is at the top and the graph under it; **Browse** at the bottom opens the nodes and the examples.

Open the first lesson to follow along: ${inLearn('learnColour')}`),
    ]),
    step('Adding a node', [
      interactive('learnColour', `This graph has two cards: a **Color** and the **Output**. Output is the pixel's colour, and every graph ends there.

To add a card:

- Press **A** and type a name, like *circle*.
- Or find it in the **Nodes** tab: click it to preview it, double-click to add it, or drag it onto the canvas.
- On a phone, press the **+** button.

Try the [[control:c]] swatch: every pixel takes the colour you pick.`, [['c', 'Colour', 'The Color card’s swatch']]),
    ]),
    step('Wiring', [
      text(`A wire carries a value from an **output** (the dots on a card's right edge) to an **input** (on the left edge).

- **Drag** from an output to an input. Inputs that can take it light up; the rest fade.
- **Click** a wired input to remove its wire.
- **Click** a socket without dragging for **Smart connect**: a short list of cards that fit.

Here, Pixel Coordinates ÷ Resolution is each pixel's position, 0 to 1 across the screen. **Split Vec2** takes it apart into x and y, and **Make Vec3** builds a colour from them: x is red, y is green. ${inLearn('learnUV')}`),
      render('learnUV', 'Red grows to the right, green grows upward', { pointer: false }),
    ], 2),
    step('Sockets and types', [
      interactive('learnUV', `Every socket has a **type**, shown by its colour:

- **float**, one number: pink
- **vec2**, two numbers (a position): blue
- **vec3**, three numbers (a colour): green
- **vec4**, four numbers: orange

A float wired into a vec3 is copied into all three. A vec2 wired into a vec3 gets a 0 at the end. Other mismatches still connect, but the card shows what it expected, so you can fix it.

Blue has no wire here, so it is a slider: raise [[control:b]] and every pixel gets more blue: black turns blue and yellow turns white.`, [['b', 'Blue', 'Make Vec3’s third input, not wired']]),
    ]),
    step('Sliders', [
      interactive('learnCircle', `An input with no wire shows a **slider** on the card.

- **Drag** it to change the value. Hold **Shift** for fine steps.
- **Click** the number to type one.
- **Double-click** to go back to the default.

This is the circle from distance: each pixel's distance from the centre, compared with a radius. Drag [[control:r]] and [[control:s]]. On the card, right-click a slider and choose **Add to Play controls** to perform it later. ${inLearn('learnCircle')}`, [['r', 'Radius'], ['s', 'Edge blur']]),
    ]),
    step('The generated code', [
      text(`The graph is compiled to one GLSL shader. Open it with the **Generated code** bar under the canvas (or \`⌘\\\`; \`Ctrl+\\\` on Windows).

- **Select a card** and its lines are highlighted.
- **Copy** takes the whole shader.
- On a phone, pick **Generated code** in the layout switch.

Below are the lines marked when the **Length** card is selected: the one it adds (each pixel's distance from the centre), and the ones that read its result. The \`u_p_…\` names are uniforms, one per slider: that is why moving a slider changes the picture without a recompile.`),
      slice('learnCircle', 'dist', 'Select Length and these lines are marked'),
    ]),
    step('Groups', [
      render('learnLoop', 'A group that runs four times, folding the space each time', { pointer: false }),
      text(`A **group** puts several cards inside one, to tidy a graph or to reuse a part.

- Drag a box around cards on an empty part of the canvas to select them.
- Press **Group** in the bar that appears (or **⌘G**).
- **Double-click** the group's header to go inside; **Esc** comes back out.
- On a phone: press **Select**, tap the cards, then **Group**.

A group can also repeat: set its **Iterations** above 1 and it runs like a \`for\` loop. ${inLearn('learnLoop')}`),
    ], 2),
    step('Saving your work', [
      text(`Graphs are saved in this browser.

1. Press the **Save** button (the disk) in the top bar.
2. Type a **Graph name** and press **Save**.
3. Next time, the same button offers **Save new version**, with an optional note on what changed.

Your graphs are in the **Saved Graphs** tab of the sidebar, with the **Library** for backups and moving to another machine.

Note that **⌘S** is **Export**: it saves the graph as a file, which is handy for sharing.

Next: the Learn lessons follow *The Book of Shaders* (the sample **Shaders from zero** walks the path). Or turn a graph into an instrument with **From shader to instrument: your first Play**.`),
    ]),
  ];
  return presentation(STUDIO_TITLE, keys, src, steps, now);
}

// ── Your first Play ─────────────────────────────────────────────────────────

export const FIRST_PLAY_TITLE = 'From shader to instrument: your first Play';

export async function buildFirstPlayPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['learnTime', 'playControls', 'playMouse', 'playLfo', 'playKeys', 'playGlowText', 'playTake'] as const;
  const src = await sources(keys);
  const { text, render, interactive, slice } = blocks(src);
  const steps: Step[] = [
    step('A graph you can perform', [
      text(`A **Play** is a graph set up to be performed: sliders on a panel, driven by the mouse, the keyboard, a beat or a MIDI controller, with drawing layers on top.

Open the **Play** tab in the top bar (on a phone, **Play** at the top left). Every graph can have one, and every Learn lesson already does: ${inLearn('learnTime')} Then press **Play**.`),
      render('learnTime', `${EXAMPLE_INDEX.learnTime.label}: Time, bent by Sin, blends two colours`, { pointer: false }),
    ], 2),
    step('Controls', [
      interactive('playControls', `A **control** is a slider on the Play panel for one input of the graph. Moving it changes the picture on the next frame, with no recompile.

To add one:

- In the Studio, right-click a slider on a card and choose **Add to Play controls**.
- Or on the Play page, press **Add control** and pick it under **From the graph**.
- On a phone, a slider's settings have **Add to controls**, under **Play**.

Try [[control:radius]], [[control:falloff]] and the [[control:tint]].`, [['radius', 'Radius'], ['falloff', 'Falloff'], ['tint', 'Tint']]),
    ]),
    step('The mouse moves a slider', [
      interactive('playMouse', `A **mapping** connects a **source** (the mouse, a key, a knob) to a control.

1. On the Play page, open a control's details (the chevron on its card) and press **Map**. A mapping appears with **Mouse X** as its source.
2. In **Mappings**, set its **Range** and **Curve** (Linear, Exp, Log or Draw). **Smooth** takes the jitter out.

Move over the picture: mouse x drives [[control:x]] and mouse y drives [[control:falloff]]. The badge under each slider says what drives it.`, [['x', 'Position X'], ['falloff', 'Falloff']]),
    ]),
    step('An LFO moves it for you', [
      interactive('playLfo', `An **LFO** is a source that moves on its own: a slow wave.

In **Mappings**, press **Add** and set **Source** to **LFO**. Pick a shape (Sine, Triangle, Saw, Square, Random) and a rate in **Hz**, cycles per second. **Clock (BPM)** is the same idea locked to a tempo.

Here a 0.25 Hz sine breathes [[control:radius]] (one breath every 4 seconds), a triangle sways [[control:x]], and a 120 BPM clock pulses the [[control:tint]].`, [['radius', 'Radius'], ['x', 'Sway'], ['tint', 'Tint']]),
    ]),
    step('A key trigger', [
      interactive('playKeys', `A key can be a switch or a trigger.

- Source **Keyboard key**: 1 while the key is held, 0 when it is up.
- Source **Trigger (envelope, toggle…)**: set **On** to **Key** and **Does** to **Envelope**. Each press rises to a peak (Attack), falls to a level (Decay, Sustain) and fades after you let go (Release).

**Learn** in the Mappings header picks the key for you: press it, then press the key.

Click the picture first. Hold **A** to grow [[control:radius]]; tap **Space** to make [[control:y]] jump.`, [['radius', 'Radius (hold A)'], ['y', 'Jump (Space)']]),
    ]),
    step('A layer on top', [
      render('playGlowText', 'A Text layer and a Brush, glowing through the Layers node. Drag to draw.'),
      text(`**Layers** draw over the picture: text, shapes, particles, a brush, a sketch in code.

On the Play page, open the **Layers** tab and press **Add layer**, then choose **Text**.

To make a layer glow, go back to the Studio, add a **Layers** card and wire its **Distance** into **SDF Glow**. The shader now lights up whatever the layers draw.`),
      slice('playGlowText', 'glow', 'SDF Glow reading the Layers card’s distance'),
    ], 2),
    step('Record a take', [
      render('playTake', 'This example ships with an 8-second take. Move the mouse; press Space.'),
      text(`A **take** records a performance as what you did (every slider, key and mouse move), not as video. So you can watch it back, and render it smoothly at any size.

1. Press **Record a performance** (the ● in the Controls header). The **Record** window opens on **Performance**.
2. Press **Start performance** and play. **Stop** ends it.
3. Press **Render…** to turn the take into a video, frame by frame.

Your takes are in the **Takes** list, saved with the graph. One ships with **Examples → Play →** ${ex('playTake')}: open it, then **Watch it back**.`),
    ], 2),
  ];
  return presentation(FIRST_PLAY_TITLE, keys, src, steps, now);
}

// ── Field sockets ───────────────────────────────────────────────────────────

export const FIELD_TITLE = 'Field sockets: one shape, many copies';

export async function buildFieldSocketsPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['learnShape', 'learnGridPattern', 'comboGridShapeByWire', 'comboArrayStars', 'comboGridGroupFlower', 'comboArrayGroupMoons', 'comboGridPaintShapes'] as const;
  const src = await sources(keys);
  const { text, render, interactive, slice, glsl } = blocks(src);
  const fieldFn = glslFunction(src.comboGridShapeByWire.bundle.fragmentShader, 'fieldfn_circ_0_distance');
  const steps: Step[] = [
    step('A wire carries a value', [
      interactive('learnShape', `A normal wire carries a **value**: one number, worked out for the pixel being drawn.

**Circle SDF** gives each pixel its distance to the circle's edge. The wire into **SDF Fill** carries that one number, and SDF Fill paints the pixel by it. Change [[control:r]] and every pixel's number changes.

One value per pixel is enough for one circle. It is not enough for a circle in every cell of a grid.`, [['r', 'Radius'], ['s', 'Stroke']]),
      slice('learnShape', 'circ', 'Circle SDF’s line: one distance, for this pixel. SDF Fill reads it on the next line.'),
    ]),
    step('Grid Pattern’s own shapes', [
      interactive('learnGridPattern', `**Grid Pattern** cuts the screen into cells and draws a shape in each. Pick the shape from its dropdown, and the pattern of which cells are filled.

It measures each shape from *its own cell's* centre, and can move or grow the shapes near the mouse. Move over the picture; try [[control:s]] and [[control:a]].

For a shape of your own, a value is no use: it was worked out at this pixel, from one centre. Grid Pattern needs the shape's **code**, to run again for each cell.`, [['s', 'Size'], ['r', 'Mouse radius'], ['a', 'Mouse strength']]),
    ]),
    step('A field socket takes the code', [
      text(`Some inputs are **field sockets**. They have a small **ƒ** beside their name. Grid Pattern's **Shape** (a distance) and **Picture** (a colour) are two.

Wire Circle SDF into **Shape** and Grid Pattern does not get Circle SDF's value. It gets Circle SDF, and everything wired into it, as a **function of position**, and calls that function once per cell, in the cell's own coordinates.

Below is that function, from ${ex('comboGridShapeByWire')}. Grid Pattern calls it with each cell's position as \`g_uv\`; the marked line is Circle SDF, measured from there. Leave Circle SDF's position unwired: inside a field, an empty position means the cell's.`),
      glsl(fieldFn, 'The function the compiler makes from the chain wired into Shape', linesBetween(fieldFn, 'circleSDF(g_uv')),
    ]),
    step('Every cell its own: the Cell node', [
      interactive('comboGridShapeByWire', `Inside a field chain, the **Cell** card (in Sources) says which cell is being drawn: its **Cell ID**, and for Array its **Index**.

Here Cell ID goes through **Noise Float** in Hash mode: a random number that is the same every frame for that cell. It sets the circle's radius and, through a **Palette**, its colour. So no two neighbours match.

[[control:s]] is the top of the hash's range: raise it and the biggest circles grow.`, [['s', 'Largest radius'], ['a', 'Pull'], ['r', 'Mouse radius']]),
    ]),
    step('Overflow into neighbours', [
      interactive('comboGridShapeByWire', `Move over the picture: the circles near the mouse are pulled toward it, some past their cell's edge.

A cell normally draws only its own shape, so a shape pulled across the border is cut off. Grid Pattern's **Overflow** fixes that. On **Neighbours (3×3)**, each pixel also draws the shapes of the 8 cells around it; **Far (5×5)** draws 24 more.

It costs 9 or 25 shape evaluations per pixel. Raise [[control:a]], then open this example and set **Overflow** to **Clip at the cell edge** to see the cut edges.`, [['a', 'Pull'], ['r', 'Mouse radius'], ['s', 'Largest radius']]),
    ]),
    step('Array: N copies', [
      interactive('comboArrayStars', `**Array** is the other node with field sockets. It draws N copies of the shape wired into its **Shape**, on a line, a grid or a ring, and joins them into one distance.

The **Cell** card's **Index** is the copy number, 0 to 11 here. It grows the stars around the ring and picks their colour from a Palette.

Lower [[control:w]] to fan the stars over an arc. Try [[control:r]].`, [['w', 'Sweep'], ['r', 'Ring radius'], ['s', 'Start angle']]),
    ]),
    step('A group as the shape', [
      interactive('comboGridGroupFlower', `A **group** can be the shape. The Flower group makes a flower from an Array of petals and a centre. Its **Distance** output goes into Grid Pattern's **Shape**, its **Colour** into **Picture**.

The whole group becomes the function. Inside it a Cell node picks the number of petals (5 to 8) and the colour for each cell.

Raise [[control:j]] to scatter the flowers. Move over them to spin them.`, [['j', 'Jitter'], ['a', 'Spin'], ['r', 'Mouse radius']]),
    ]),
    step('Into a group through a port', [
      interactive('comboArrayGroupMoons', `A field chain can also cross into a group through an **input port**.

The Moon group cuts one circle out of another; its **Cut** port sets the size of the bite. Outside the group, Cell's **Index** goes through a **Remap** into Cut. So each of the 8 copies gets its own bite: nearly full at one end of the ring, a thin crescent at the other.

Raise [[control:t]] until the last moons vanish.`, [['t', 'Largest cut'], ['w', 'Sweep'], ['r', 'Ring radius']]),
    ]),
    step('Three ways to put a shape on a grid', [
      render('comboGridPaintShapes', 'The two-card way: Grid Pattern’s Cell UV → your shape → Grid Paint'),
      text(`| Way | What you do |
|---|---|
| Dropdown | Grid Pattern's own shape, nothing wired. |
| One wire | Your shape into Grid Pattern's **Shape** (ƒ). |
| Two cards | Grid Pattern's **Cell UV** → your shape → **Grid Paint**. |

The first two can **overflow** into neighbours. With Grid Paint, each cell only knows its own shape.

What can't go in a field: anything that reads the last frame (Echo, the blurs), Play layers, particles, and the 3D groups. The card says so when you try.

All four combos are in **Examples → Node Combos**.`),
    ], 2),
  ];
  return presentation(FIELD_TITLE, keys, src, steps, now);
}

// ── Bring your own GLSL ─────────────────────────────────────────────────────

export const CONVERT_TITLE = 'Bring your own GLSL';

/** A golf-style write the converter refuses, and the fix-up card's rewrite (tested equal to what the card makes, less its trailing blank lines). */
export const FIXUP_BEFORE = `void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float d;
  vec3 col = vec3(0.02 / abs(d = length(uv) - 0.3)) * vec3(0.9, 0.5, 0.2);
  gl_FragColor = vec4(col + 0.1 * d, 1.0);
}`;
export const FIXUP_AFTER = `uniform vec2 u_resolution;

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    float d;
    d = length(uv) - 0.3;
    vec3 col = vec3(0.02 / abs(d )) * vec3(0.9, 0.5, 0.2);
    gl_FragColor = vec4(col + 0.1 * d, 1.0);
}`;

export async function buildConvertPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['convertCircle', 'convertCircleOptimised'] as const;
  const src = await sources(keys);
  const { text, render, interactive, slice, glsl } = blocks(src);
  const circle = CONVERT_EXAMPLES.circle.code;
  const fbm = CONVERT_EXAMPLES.shadertoy.code;
  const helpers = fbm.slice(0, fbm.indexOf('void mainImage')).trim();
  // The optimised graph's Expression Block, as its card lists its lines.
  const block = SOFT_CIRCLE_OPTIMISED.find(n => n.type === 'exprNode');
  const blockLines = (block?.params.lines as Array<{ lhs: string; op: string; rhs: string }> | undefined) ?? [];
  if (!blockLines.length) throw new Error('samples: the optimised Soft circle has no Expression Block');
  const blockCode = blockLines.map(l => `${l.lhs} ${l.op} ${l.rhs};`).join('\n');
  const square = { aspect: '1:1' as const };
  const steps: Step[] = [
    step('Paste, then Convert', [
      text(`The **Convert** page turns a GLSL fragment shader into nodes. Open **Convert** in the top bar (on a phone: **⋯ → Convert GLSL to nodes**).

1. Paste into **Fragment shader**: a plain \`void main()\` with \`gl_FragColor\`, or a Shadertoy \`mainImage()\`.
2. Press **Convert** (**⌘↵**, or Ctrl+Enter).

The nodes appear on the canvas next to it, read-only for now. The page starts with the **Soft circle** from its **Examples…** list, shown here, so you can press Convert straight away.`),
      glsl(circle, 'Examples… → Soft circle', linesBetween(circle, 'smoothstep')),
    ]),
    step('Read the check', [
      render('convertCircle', 'The converted graph’s picture, drawn by the nodes', square),
      text(`Under the editor (on a phone, the **Check** tab), **Check** draws two small pictures on one clock: **Original** (your shader) and **As nodes** (the graph). Then it compares them, pixel by pixel.

- **Same picture** means they match.
- **max 0/255** is the largest difference in any colour channel of any pixel, on the 0 to 255 scale a screen uses.
- **0.00% off** is the share of pixels off by more than 8.

It says **Differs** when max is above 2, or when 0.1% of pixels or more are off. If it does, the list under it says why.`),
    ], 2),
    step('Your numbers became sliders', [
      interactive('convertCircle', `Every number in the shader is now a slider on a card. \`smoothstep(0.31, 0.3, d)\` became a **Smoothstep** card with **Edge 0** = 0.31 and **Edge 1** = 0.3, and \`vec3(1.0, 0.7, 0.3)\` became a **Color** card.

Drag [[control:r]] to resize the circle. Raise [[control:e]] and the hard rim becomes a soft glow. Pick another [[control:c]].

These are ordinary sliders, so they can be Play controls too.`, [['r', 'Radius', 'Smoothstep’s Edge 1'], ['e', 'Soft edge', 'Smoothstep’s Edge 0'], ['c', 'Colour', 'The Color card']], square),
    ]),
    step('As written or Optimised', [
      text(`The switch over the canvas has two settings.

- **As written**: one card per operation, ${SOFT_CIRCLE_AS_WRITTEN.length} cards for this shader. The easiest to read and change.
- **Optimised** (the default): runs of math cards folded into one **Expression Block**, ${SOFT_CIRCLE_OPTIMISED.length} cards here. Fewer cards, the same picture, and the check proves it.

Below, the same step both ways. As written, Smoothstep is its own card; the next line is the card after it. Optimised, the run of cards from Divide to Multiply is ${blockLines.length} lines of one block, one line per card.`),
      slice('convertCircle', 'smoothstep_6', 'As written: the Smoothstep card’s line of the generated shader'),
      glsl(blockCode, 'Optimised: the Expression Block’s lines, as its card shows them', linesBetween(blockCode, 'smoothstep(')),
    ]),
    step('When it won’t convert', [
      text(`Some shaders can't become a graph as they are. Then the check says **Not a graph yet**, with the reason.

This one changes \`d\` in the middle of an expression, golf style: \`abs(d = length(uv) - 0.3)\` works out a distance, stores it in \`d\` and uses it, all at once. Line 5 reads \`d\` again.

A wire carries one value from one card, so a graph can't hold a write hidden inside another line.`),
      glsl(FIXUP_BEFORE, 'A write inside an expression, on line 4', linesBetween(FIXUP_BEFORE, 'vec3 col')),
    ], 2),
    step('Fix-ups', [
      glsl(FIXUP_AFTER, 'After Apply fix: the write has a line of its own', linesBetween(FIXUP_AFTER, 'd = length')),
      text(`Under the reason, **Fix-ups** offers rewrites that remove it. Here the card is **Give each write a line of its own**.

1. Press **Apply fix**. The shader in the editor is rewritten: the write to \`d\` moves to a line of its own, before the line that used it.
2. Press **Convert**.

The picture doesn't change. The fix is undoable in the editor, and the check still compares with your shader from before the fix.`),
    ], 2),
    step('Materialize', [
      render('convertCircleOptimised', 'The same Soft circle, from the optimised graph', square),
      text(`When the check is happy, press **Materialize**. The nodes become your graph and the Studio opens on them. **Undo** brings your old graph back.

Code the converter couldn't turn into nodes is kept as a card marked **FROM CODE**, so the picture is still right.

The new graph isn't saved yet: press **Save** in the top bar and give it a name.`),
    ], 2),
    step('Keep your helper functions', [
      text(`A shader's helper functions can join your library.

1. Open the **Functions** tab under the editor (**Fns** on a phone). It lists every function in the shader.
2. Tick the ones to keep and press **Save to Functions**.
3. They appear in the sidebar's **Functions** tab, ready to add as cards.

Next time you convert a shader that calls one, it becomes your saved card, listed in the check under **From your Functions**. Try it with **Examples… → Shadertoy: fbm**, whose three helpers are below.`),
      glsl(helpers, 'Examples… → Shadertoy: fbm: the helpers above mainImage()'),
    ]),
  ];
  return presentation(CONVERT_TITLE, keys, src, steps, now);
}

// ── Shaders from zero: The Book of Shaders through Learn ────────────────────

export const BOOK_TITLE = 'Shaders from zero';

/** The credit each step carries: the Book's chapter, linked. */
const book = (ch: number, title: string) =>
  `*From The Book of Shaders* by Patricio Gonzalez Vivo and Jen Lowe, chapter ${ch}: [${title}](https://thebookofshaders.com/${String(ch).padStart(2, '0')}/).`;

/** Where the step's lesson is, then the Book chapter it follows, as its own paragraph. */
const lessonAndBook = (key: string, ch: number, title: string) => `${inLearn(key)}\n\n${book(ch, title)}`;

const CIRCLE_GLSL = `float d = distance(st, vec2(0.5));   // how far from the centre
float inside = 1.0 - step(0.3, d);   // 1 nearer than 0.3, else 0`;

export async function buildBookPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['learnUV', 'learnStep', 'learnHSB', 'learnCircle', 'learnRotate', 'learnTiling', 'learnRandomGrid', 'learnNoise', 'learnFBM'] as const;
  const src = await sources(keys);
  const { text, render, interactive, glsl } = blocks(src);
  const steps: Step[] = [
    step('A colour for every pixel', [
      interactive('learnUV', `A fragment shader is one small program the GPU runs for **every pixel at once**. Its one job: say what colour its pixel is.

Pixels differ only in *where* they are. Divide the pixel's position by the canvas size and you get \`st\`, 0 at the bottom left and 1 at the top right. Paint x as red and y as green:

\`\`\`glsl
vec2 st = gl_FragCoord.xy / u_resolution;
gl_FragColor = vec4(st.x, st.y, 0.0, 1.0);
\`\`\`

Raise [[control:b]]: blue is the same everywhere, so every pixel shifts together. This path follows *The Book of Shaders*, one Learn lesson per step.

${lessonAndBook('learnUV', 3, 'Uniforms')}`, [['b', 'Blue']]),
    ]),
    step('Shaping functions', [
      interactive('learnStep', `Shaders decide without \`if\`. They use **shaping functions**: a number from 0 to 1 in, a bent number out.

**Step** jumps from 0 to 1 at a threshold. **Smoothstep** climbs between two edges along the S-curve $t^2(3 - 2t)$, flat at both ends. Move [[control:t]], then [[control:a]] and [[control:b]].

${lessonAndBook('learnStep', 5, 'Shaping functions')}`, [['t', 'Step threshold'], ['a', 'Smooth from'], ['b', 'Smooth to']]),
    ]),
    step('Colour', [
      interactive('learnHSB', `A colour is three numbers: red, green, blue. RGB is how screens work, not how we think.

**HSB** is closer: **hue** walks round the colour wheel, **saturation** goes from grey to vivid, **brightness** from black to full. Here hue runs across the screen and brightness up it.

Lower [[control:s]] toward grey; shift the [[control:h]].

${lessonAndBook('learnHSB', 6, 'Colors')}`, [['s', 'Saturation'], ['h', 'Hue shift']]),
    ]),
    step('Shapes from distance', [
      interactive('learnCircle', `A circle is every point nearer the centre than the radius. So each pixel measures its distance to the centre and compares it with the radius (the code below).

The grey glow is the distance itself. Try [[control:r]] and [[control:s]].

${lessonAndBook('learnCircle', 7, 'Shapes')}`, [['r', 'Radius'], ['s', 'Edge blur']], { aspect: '16:9' }),
      glsl(CIRCLE_GLSL, 'The circle in GLSL: a distance, then a step', linesBetween(CIRCLE_GLSL, 'step(')),
    ]),
    step('Matrices move space', [
      interactive('learnRotate', `A shader can't pick a shape up and turn it. Instead it turns the **space** the shape is measured in, with a rotation matrix:

$$R(a) = \\begin{pmatrix}\\cos a & -\\sin a\\\\ \\sin a & \\cos a\\end{pmatrix}$$

Multiply every pixel's position by it and the cross spins. Change [[control:s]]; lengthen the [[control:l]].

${lessonAndBook('learnRotate', 8, '2D Matrices')}`, [['s', 'Speed'], ['l', 'Arm length']]),
    ]),
    step('Patterns', [
      interactive('learnTiling', `**Fract** keeps what is after the decimal point, so $\\operatorname{fract}(3x)$ runs from 0 to 1 three times. Do that to the position and the screen becomes tiles that all share the same coordinates.

One circle drawn after it appears in every tile, at no extra cost. Change the number of [[control:n]] and the [[control:r]].

${lessonAndBook('learnTiling', 9, 'Patterns')}`, [['n', 'Tiles'], ['r', 'Radius']]),
    ]),
    step('Random', [
      render('learnRandomGrid', 'Every cell hashes its own number into its own shade', { aspect: '1:1', pointer: false }),
      text(`**Random** in a shader is a hash: a number scrambled so hard it looks random. It isn't truly random: the same input always gives the same output, so every frame agrees with the last.

Floor the position to get each cell's number, hash it, and every cell gets its own shade: a mosaic.

${lessonAndBook('learnRandomGrid', 10, 'Random')}`),
    ], 2),
    step('Noise', [
      interactive('learnNoise', `Random jumps; nature doesn't. **Noise** is random with memory: random values on a grid, blended smoothly in between. It drifts like cloud. Try [[control:sc]] and [[control:sp]].

Next in Learn: **cellular noise**, the distance to the nearest of many scattered points (chapter 12).

${lessonAndBook('learnNoise', 11, 'Noise')}`, [['sc', 'Scale'], ['sp', 'Speed']]),
    ]),
    step('Fractal Brownian motion', [
      interactive('learnFBM', `Add noise to itself: each layer (an **octave**) twice as fine, and weaker by the **gain** $g$:

$$\\text{fbm}(p) = \\sum_{i=0}^{n-1} g^{\\,i}\\, \\text{noise}(2^i p)$$

Clouds, terrain, marble. Try [[control:g]] and [[control:sc]]. Then carry on in **Examples → Learn** (warp, fractals) and **Learn 3D**; the Book is free at [thebookofshaders.com](https://thebookofshaders.com/).

${lessonAndBook('learnFBM', 13, 'Fractal Brownian Motion')}`, [['g', 'Gain (roughness)'], ['sc', 'Scale']]),
    ]),
  ];
  return presentation(BOOK_TITLE, keys, src, steps, now);
}

// ── Making a lesson with Present ────────────────────────────────────────────

export const MAKING_TITLE = 'Making a lesson with Present';

export async function buildMakingPresentation(now = Date.now()): Promise<Presentation> {
  const keys = ['learnPalette', 'scriptFirst'] as const;
  const src = await sources(keys);
  const { text, render, interactive, slice, script } = blocks(src);
  const steps: Step[] = [
    step('Steps and blocks', [
      text(`A presentation is a lesson in **steps**, and each step is a stack of **blocks**. You are reading one.

1. Open **Present** in the top bar. Click the title at the top left, then **New presentation…**
2. The **Steps** list is on the left (on a phone, the numbered strip at the top). **+** adds a step; drag a step to move it.
3. Under a step, add a block: **Text**, **Render**, **Interactive** or **Code**.

Everything saves itself as you go: beside the title it says **Saved** (a tick on a phone).`),
      render('learnPalette', 'A Render block: a picture from a Play, with a caption'),
    ], 2),
    step('Sources are snapshots', [
      text(`The first **Render** or **Interactive** block asks you to choose a Play: a graph you saved, or an example. The presentation takes a **snapshot**: a copy of the shader and its Play setup.

So the lesson keeps working when you change, rename or delete the graph. It also travels in one file.

- Select a step (click beside the blocks) to see its **Sources** on the right.
- **Refresh** takes a new snapshot of the graph as it is now.
- **Studio** and **Play** open the graph to edit it.

On a phone, these are under **Step and sources** at the bottom.`),
    ]),
    step('Text with maths', [
      text(`A Text block is Markdown: \`**bold**\`, \`*italic*\`, \`- lists\`, \`[links](https://…)\`, \`# headings\` and tables.

Maths goes between dollar signs, like \`$x^2$\` for $x^2$. A formula on its own lines goes between double dollars:

\`\`\`
$$d = \\lVert p \\rVert - r$$
\`\`\`

shows as

$$d = \\lVert p \\rVert - r$$

Type \`\\$\` for a real dollar sign. Select a Text block and its settings show this list under **Writing**.`),
    ]),
    step('Interactive blocks', [
      interactive('learnPalette', `An **Interactive** block is text, a picture and some of its sliders.

Select it, and its settings (on the right; on a phone, **Block settings** at the bottom) list every control. Switch on the ones to show, give each a **Label** in your own words and a **Hint** under the slider. These two are relabelled: [[control:sc]] and [[control:sp]].

Write \`[[control:sc]]\` in the text and it becomes a chip that points at that slider. Clicking a control's name in the settings adds its chip for you.`, [['sc', 'How many rings', 'The Palette’s Repeats'], ['sp', 'Drift', 'How fast the colours cycle']]),
    ]),
    step('Code from the graph', [
      text(`A **Code** block shows GLSL or JavaScript. Press **Code** under a step and choose:

- **Type it in**: code of your own.
- **From a source’s shader**: the generated GLSL. Set **Show** to **Shader** for all of it, or **One node** for just that card's lines.

Under **Marks**, **Highlight lines** takes line numbers like \`3-5, 9\`, and **Caption** goes underneath.

The block below is **One node** of the rings from the last step: the Palette card's lines.`),
      slice('learnPalette', 'pal', 'One node: the Palette card’s lines of the generated shader'),
    ]),
    step('Live code', [
      interactive('scriptFirst', `A Play's **Script** layer is JavaScript that draws over the shader. A Code block can quote it, with **Show** set to **Script**.

Switch on **Live** (*Edit it and watch*) and readers can edit the code: the canvases of that Play on the same step run their edit. The graph never changes.

Try it: turn up [[control:count]], then scroll to the marked \`hsl(\` line below and change the numbers.`, [['count', 'Dots'], ['spin', 'Spin']], { aspect: '16:9' }),
      script('scriptFirst', 'ring', 'Live: edit it and the ring above runs your version', { live: true, highlightLines: linesBetween(SKETCH_FIRST, "ctx.fillStyle = 'hsl") }),
    ]),
    step('Slides and Scroll', [
      text(`The switch in the header has three views.

- **Edit**: build the steps.
- **Slides**: one step at a time, for teaching in the room. **←** and **→** move between steps.
- **Scroll**: every step on one long page, for reading alone.

Each canvas has a **Stage** button: that picture fullscreen, in a phone or a screen frame, with its controls, ready to record.`),
    ]),
    step('Share it', [
      text(`Two ways to send a lesson.

- **Export** (in the header) builds **one web page** with everything in it: the steps, the maths, every picture and its sliders. Pick **Slides** or **Scroll**, then **Save the web page**. Put it on any website, or open it from your computer.
- **Download** (in the title menu) saves a **.present.json** file. Anyone can open it in Playfield with **Import**; the graphs come inside it.

**Open** in the header lists every presentation saved here, with folders and search.`),
    ]),
  ];
  return presentation(MAKING_TITLE, keys, src, steps, now);
}
