/**
 * The Script layer's built-in reference: what a sketch can call, grouped, the
 * way the p5.js reference reads. Every entry has its parameters (name, type,
 * meaning), what it returns (or a value's type), a line on what it does and a
 * short example. The Reference tab shows it and autocomplete reads it, so
 * the two never disagree. The helpers themselves are `klSketchHelpers` in
 * src/play/kit/layers.js; the parameters here follow that code.
 */
export interface RefArg { name: string; type: string; doc: string; optional?: boolean }
export interface RefItem {
  /** What you type: `circle`, `s.time`, `s.picture.brightness`. */
  name: string;
  /** A function's parameters, in order; absent for a value. */
  args?: RefArg[];
  /** A function's return type ('nothing' when it draws or sets), or a value's type. */
  type: string;
  /** What the return value (or the value) means, when the type does not say it. */
  returns?: string;
  doc: string;
  /** A line or a few showing it in use. */
  example: string;
  /** What Insert puts at the caret; the name with its parameter names by default. */
  insert?: string;
}
export interface RefGroup { title: string; items: RefItem[] }

type A = [name: string, type: string, doc: string];
const arg = ([name, type, doc]: A): RefArg => (name.endsWith('?') ? { name: name.slice(0, -1), type, doc, optional: true } : { name, type, doc });
const fn = (name: string, args: A[], type: string, doc: string, example: string, extra: Partial<RefItem> = {}): RefItem => ({ name, args: args.map(arg), type, doc, example, ...extra });
const val = (name: string, type: string, doc: string, example: string, extra: Partial<RefItem> = {}): RefItem => ({ name, type, doc, example, ...extra });

/** `(x, y, d)`, with optional parameters in brackets like p5's reference: `(x, y, w, [h])`. */
export function refSignature(it: RefItem): string {
  if (!it.args) return '';
  return `(${it.args.map(a => (a.optional ? `[${a.name}]` : a.name)).join(', ')})`;
}

/** The text Insert puts in: `insert`, or the call with its required parameter names. */
export function refInsert(it: RefItem): string {
  if (it.insert) return it.insert;
  if (!it.args) return it.name;
  return `${it.name}(${it.args.filter(a => !a.optional).map(a => a.name).join(', ')})`;
}

const COLOUR = 'colour';
const COLOUR_ARGS = 'One number is a grey 0–255, two are grey and alpha, three are r, g, b, four add alpha (all 0–255); or any CSS colour string.';
const X: A = ['x', 'number', 'Pixels from the left.'];
const Y: A = ['y', 'number', 'Pixels from the top (y goes down).'];

export const SCRIPT_REFERENCE: RefGroup[] = [
  { title: 'Sketch', items: [
    fn('setup', [['s', 'frame', 'The frame object: s.width, s.state and the rest.']], 'nothing',
      'You write this one. Runs once at the start, and again when the picture is resized. Make your arrays and starting values here.',
      'function setup(s) {\n  s.state.dots = [];\n}', { insert: 'function setup(s) {\n  \n}\n' }),
    fn('draw', [['s', 'frame', 'The frame object: s.ctx, s.time, s.dt, s.mouse and the rest.']], 'nothing',
      'You write this one. Runs every frame; the canvas is cleared first unless the layer’s Clear is off. Every sketch needs it.',
      'function draw(s) {\n  circle(mouseX, mouseY, 40);\n}', { insert: 'function draw(s) {\n  \n}\n' }),
    val('params', 'object',
      'The controls you declare, by key. A number is a 0–1 slider, { value, min, max, step, label } a slider with a range, true/false or { kind: \'toggle\' } a toggle, a function a button. Read them as s.params.key, or declare a top-level let with the same name and the control drives it.',
      'const params = {\n  speed: { value: 1, min: 0, max: 4, step: 0.05, label: \'Speed\' },\n  glow: true,\n  reset(s) { s.state.dots = []; },\n};',
      { insert: 'const params = {\n  speed: { value: 1, min: 0, max: 4, step: 0.05, label: \'Speed\' },\n};\n' }),
  ] },
  { title: 'The frame (s)', items: [
    val('s.ctx', 'CanvasRenderingContext2D', 'The 2D canvas context, s.width × s.height pixels, y down. Everything the helpers draw goes here; use it directly for gradients, composite modes and the rest.', 's.ctx.globalCompositeOperation = \'lighter\';'),
    val('s.width', 'number', 'Picture width in pixels (also plain width).', 'const cx = s.width / 2;'),
    val('s.height', 'number', 'Picture height in pixels (also plain height).', 'const cy = s.height / 2;'),
    val('s.dpr', 'number', 'Device pixel ratio: how many canvas pixels make one screen pixel. Multiply sizes by it to keep them the same on sharp screens.', 'strokeWeight(1 * s.dpr);'),
    val('s.time', 'number', 'The Play clock in seconds. Pauses and scrubs with Play.', 'const x = width / 2 + Math.sin(s.time) * 100;'),
    val('s.dt', 'number', 'Seconds since the last frame, at most 0.1. Multiply speeds by it so motion is the same at any frame rate.', 'p.x += p.vx * s.dt;'),
    val('s.frame', 'number', 'Frames drawn since setup, from 0.', 'if (s.frame % 60 === 0) s.state.hue = random(360);'),
    val('s.params', 'object', 'The current value of every control you declared, by key: sliders as numbers, toggles as 0 or 1, a button as its amount on the frame it was pressed (else 0).', 'circle(mouseX, mouseY, s.params.size);'),
    val('s.state', 'object', 'An object kept between frames and emptied on setup. Put arrays, counters and anything that moves here.', 's.state.count = (s.state.count || 0) + 1;'),
    val('s.mouse', '{ x, y, over, down }', 'The mouse in pixels; over is true while it is over the picture, down while the button is held.', 'if (s.mouse.down) circle(s.mouse.x, s.mouse.y, 20);'),
    fn('s.picture.brightness', [X, Y], 'number', 'Brightness of the shader at a pixel. Turn Picture on in the Canvas settings (it samples the shader at 64 × 36 each frame).',
      'const b = s.picture.brightness(mouseX, mouseY);\ncircle(mouseX, mouseY, 10 + b * 50);', { returns: '0 (black) to 1 (white).' }),
    fn('s.null', [['name', 'string', 'The Null layer’s label (or id).']], '{ x, y } | null', 'Where a Null layer is, in pixels. Nulls are handles you can drag, keyframe or map, so this is how a sketch follows something you move.',
      'const c = s.null(\'Sun\') || { x: width / 2, y: height / 2 };\ncircle(c.x, c.y, 30);', { returns: 'The null’s position, or null when there is no null by that name.', insert: "s.null('Sun')" }),
    fn('s.pressed', [['key', 'string', 'A button’s key in params.']], 'boolean', 'Whether a button was pressed this frame (from the panel, a key, a beat or a note). True for one frame; the amount is in s.params[key].',
      "if (s.pressed('burst')) s.state.dots = [];", { returns: 'true on the frame it was pressed.', insert: "s.pressed('')" }),
    fn('s.random', [], 'number', 'Math.random: a number from 0 up to (not including) 1.', 'const r = s.random();', { returns: '0 ≤ r < 1.' }),
  ] },
  { title: 'Colour and style', items: [
    fn('background', [['c', COLOUR, COLOUR_ARGS]], 'nothing', 'Fills the whole canvas, ignoring transforms. Call it first in draw; with a see-through colour it leaves fading trails.',
      'background(20);\nbackground(0, 0, 0, 40); // faint: trails', { insert: 'background(20)' }),
    fn('clear', [], 'nothing', 'Erases the canvas to transparent, so the picture shows through. Useful with the layer’s Clear off.', 'if (s.pressed(\'wipe\')) clear();'),
    fn('fill', [['c', COLOUR, COLOUR_ARGS]], 'nothing', 'The fill colour for the shapes and text that follow, and turns filling on.',
      'fill(255, 120, 40);\ncircle(100, 100, 50);', { insert: 'fill(255)' }),
    fn('noFill', [], 'nothing', 'Shapes that follow are outlines only (with stroke).', 'noFill();\nstroke(255);\ncircle(100, 100, 50);'),
    fn('stroke', [['c', COLOUR, COLOUR_ARGS]], 'nothing', 'The outline colour for the shapes that follow, and turns outlines on. Lines and points use it too.',
      'stroke(255);\nline(0, 0, width, height);', { insert: 'stroke(255)' }),
    fn('noStroke', [], 'nothing', 'Shapes that follow have no outline.', 'noStroke();\nfill(255);\ncircle(100, 100, 50);'),
    fn('strokeWeight', [['w', 'number', 'Width in pixels.']], 'nothing', 'Outline and line width; also the size of point().', 'strokeWeight(4);\nline(20, 20, 200, 20);', { insert: 'strokeWeight(2)' }),
    fn('color', [['c', COLOUR, COLOUR_ARGS]], 'string', 'A colour you can keep in a variable and pass to fill, stroke or background.',
      'const warm = color(255, 120, 40);\nfill(warm);', { returns: 'A CSS colour string such as rgb(255, 120, 40).', insert: 'color(255, 120, 40)' }),
    fn('hsl', [['h', 'number', 'Hue, 0–360 round the colour wheel (0 red, 120 green, 240 blue).'], ['s', 'number', 'Saturation, 0–100.'], ['l', 'number', 'Lightness, 0–100 (50 is the pure colour).'], ['a?', 'number', 'Alpha, 0–1.']], 'string',
      'A colour by hue, saturation and lightness: the easy way to step through colours.',
      'for (let i = 0; i < 10; i++) {\n  fill(hsl(i * 36, 80, 60));\n  circle(30 + i * 40, 60, 30);\n}', { returns: 'A CSS colour string.', insert: 'hsl(200, 80, 60)' }),
    fn('lerpColor', [['a', COLOUR, 'The colour at t = 0, from color() or an rgb() string.'], ['b', COLOUR, 'The colour at t = 1.'], ['t', 'number', 'How far from a to b, 0–1.']], 'string',
      'A colour between two others. Works on rgb colours (from color()); not on hsl() or hex strings.',
      'const c = lerpColor(color(255, 0, 0), color(0, 0, 255), mouseX / width);\nbackground(c);', { returns: 'An rgb() colour string.' }),
  ] },
  { title: 'Shapes', items: [
    fn('circle', [['x', 'number', 'Centre, pixels from the left.'], ['y', 'number', 'Centre, pixels from the top.'], ['d', 'number', 'Diameter in pixels.']], 'nothing', 'A circle, in the fill and stroke colours.', 'circle(width / 2, height / 2, 80);', { insert: 'circle(x, y, 20)' }),
    fn('ellipse', [['x', 'number', 'Centre x.'], ['y', 'number', 'Centre y.'], ['w', 'number', 'Width in pixels.'], ['h?', 'number', 'Height; the width when left out.']], 'nothing', 'An ellipse around a centre.', 'ellipse(width / 2, height / 2, 120, 60);', { insert: 'ellipse(x, y, 40, 20)' }),
    fn('rect', [['x', 'number', 'Left edge.'], ['y', 'number', 'Top edge.'], ['w', 'number', 'Width in pixels.'], ['h?', 'number', 'Height; the width when left out.'], ['r?', 'number', 'Corner radius in pixels.']], 'nothing', 'A rectangle from its top-left corner, with rounded corners if you give r.', 'rect(20, 20, 120, 60, 8);', { insert: 'rect(x, y, 40, 40)' }),
    fn('square', [['x', 'number', 'Left edge.'], ['y', 'number', 'Top edge.'], ['size', 'number', 'Side in pixels.'], ['r?', 'number', 'Corner radius in pixels.']], 'nothing', 'A square from its top-left corner.', 'square(20, 20, 50);'),
    fn('line', [['x1', 'number', 'Start x.'], ['y1', 'number', 'Start y.'], ['x2', 'number', 'End x.'], ['y2', 'number', 'End y.']], 'nothing', 'A straight line in the stroke colour (the fill colour when stroke is off) and strokeWeight.', 'stroke(255);\nline(0, 0, width, height);', { insert: 'line(0, 0, width, height)' }),
    fn('point', [X, Y], 'nothing', 'A dot as wide as strokeWeight, in the stroke colour.', 'strokeWeight(6);\npoint(mouseX, mouseY);'),
    fn('triangle', [['x1', 'number', 'First corner x.'], ['y1', 'number', 'First corner y.'], ['x2', 'number', 'Second corner x.'], ['y2', 'number', 'Second corner y.'], ['x3', 'number', 'Third corner x.'], ['y3', 'number', 'Third corner y.']], 'nothing', 'A triangle from three corners.', 'triangle(100, 20, 40, 140, 160, 140);'),
    fn('quad', [['x1', 'number', 'First corner x.'], ['y1', 'number', 'First corner y.'], ['x2', 'number', 'Second corner x.'], ['y2', 'number', 'Second corner y.'], ['x3', 'number', 'Third corner x.'], ['y3', 'number', 'Third corner y.'], ['x4', 'number', 'Fourth corner x.'], ['y4', 'number', 'Fourth corner y.']], 'nothing', 'A four-cornered shape; the corners go round in order.', 'quad(40, 20, 160, 40, 140, 140, 20, 120);'),
    fn('arc', [['x', 'number', 'Centre x.'], ['y', 'number', 'Centre y.'], ['w', 'number', 'Width of the whole ellipse.'], ['h', 'number', 'Height of the whole ellipse.'], ['start', 'number', 'Start angle in radians (0 points right, angles go clockwise).'], ['stop', 'number', 'End angle in radians.']], 'nothing', 'Part of an ellipse’s outline between two angles; the fill closes it with a straight edge.', 'noFill();\nstroke(255);\narc(100, 100, 80, 80, 0, PI);', { insert: 'arc(x, y, 60, 60, 0, PI)' }),
    fn('beginShape', [], 'nothing', 'Starts a shape made of points: call vertex() for each corner, then endShape().', 'beginShape();\nvertex(20, 20);\nvertex(180, 60);\nvertex(60, 160);\nendShape(true);', { insert: 'beginShape();\nvertex(x, y);\nendShape(true);' }),
    fn('vertex', [X, Y], 'nothing', 'One corner of the shape since beginShape().', 'vertex(mouseX, mouseY);'),
    fn('endShape', [['close?', 'boolean', 'true joins the last corner back to the first.']], 'nothing', 'Draws the shape since beginShape(), in the fill and stroke colours.', 'endShape(true);'),
    fn('text', [['str', 'string | number', 'What to write.'], ['x', 'number', 'Where, by textAlign’s horizontal setting.'], ['y', 'number', 'Where, by textAlign’s vertical setting (the baseline by default).']], 'nothing', 'Writes text in the fill colour at textSize in textFont.', "fill(255);\ntext('frame ' + frameCount, 12, 24);", { insert: "text('hello', x, y)" }),
    fn('textSize', [['n', 'number', 'Font size in pixels.']], 'nothing', 'The size of text that follows (16 to start).', 'textSize(32);', { insert: 'textSize(24)' }),
    fn('textAlign', [['h', 'string', "'left', 'center' or 'right'."], ['v?', 'string', "'top', 'middle' (or 'center'), 'bottom' or 'alphabetic'."]], 'nothing', 'Which point of the text sits at the x, y you give text().', "textAlign('center', 'middle');\ntext('hi', width / 2, height / 2);", { insert: "textAlign('center', 'middle')" }),
    fn('textFont', [['f', 'string', "A CSS font family: 'monospace', 'serif', 'Georgia'…"]], 'nothing', 'The font of text that follows.', "textFont('monospace');", { insert: "textFont('monospace')" }),
  ] },
  { title: 'Transform', items: [
    fn('push', [], 'nothing', 'Saves the transform and the canvas styles, so what follows can move and turn freely until pop().', 'push();\ntranslate(100, 100);\nrotate(s.time);\nrect(-20, -20, 40, 40);\npop();', { insert: 'push();\n\npop();' }),
    fn('pop', [], 'nothing', 'Restores what the matching push() saved.', 'pop();'),
    fn('translate', [['x', 'number', 'Pixels to move right.'], ['y', 'number', 'Pixels to move down.']], 'nothing', 'Moves the origin, so later shapes are drawn relative to it. Adds up until pop().', 'translate(width / 2, height / 2);\ncircle(0, 0, 40); // at the centre'),
    fn('rotate', [['a', 'number', 'Angle in radians, clockwise.']], 'nothing', 'Turns the axes around the origin (move the origin first with translate).', 'translate(width / 2, height / 2);\nrotate(s.time);\nrect(-30, -30, 60, 60);'),
    fn('scale', [['x', 'number', 'Horizontal factor (1 is unchanged).'], ['y?', 'number', 'Vertical factor; x when left out.']], 'nothing', 'Grows or shrinks everything that follows, from the origin.', 'translate(width / 2, height / 2);\nscale(2);\ncircle(0, 0, 20); // 40 across'),
  ] },
  { title: 'Maths and random', items: [
    fn('map', [['v', 'number', 'The value to convert.'], ['a', 'number', 'Low end of its range.'], ['b', 'number', 'High end of its range.'], ['c', 'number', 'Low end of the new range.'], ['d', 'number', 'High end of the new range.'], ['clamp?', 'boolean', 'true keeps the result within c–d.']], 'number',
      'Converts a value from one range to another.', 'const size = map(mouseX, 0, width, 10, 100, true);', { returns: 'v moved into the range c–d.', insert: 'map(v, 0, 1, 0, width)' }),
    fn('lerp', [['a', 'number', 'Value at t = 0.'], ['b', 'number', 'Value at t = 1.'], ['t', 'number', 'How far, usually 0–1.']], 'number', 'A value part of the way from a to b. Called each frame with a small t, it eases toward b.', 's.state.x = lerp(s.state.x || 0, mouseX, 0.1);', { returns: 'a + (b − a) × t.' }),
    fn('constrain', [['v', 'number', 'The value.'], ['lo', 'number', 'Smallest allowed.'], ['hi', 'number', 'Largest allowed.']], 'number', 'Keeps a value within a range.', 'p.x = constrain(p.x, 0, width);', { returns: 'v, or lo / hi when it is outside.' }),
    fn('dist', [['x1', 'number', 'First point x.'], ['y1', 'number', 'First point y.'], ['x2', 'number', 'Second point x.'], ['y2', 'number', 'Second point y.']], 'number', 'The distance between two points.', 'if (dist(p.x, p.y, mouseX, mouseY) < 20) fill(255, 0, 0);', { returns: 'The distance in pixels.' }),
    fn('mag', [['x', 'number', 'Horizontal part.'], ['y', 'number', 'Vertical part.']], 'number', 'The length of a vector, such as a speed from vx and vy.', 'const speed = mag(p.vx, p.vy);', { returns: 'The length, √(x² + y²).' }),
    fn('norm', [['v', 'number', 'The value.'], ['a', 'number', 'Low end of the range.'], ['b', 'number', 'High end of the range.']], 'number', 'Where a value sits in a range, as 0–1.', 'const t = norm(mouseX, 0, width);', { returns: '0 at a, 1 at b (outside 0–1 beyond them).' }),
    fn('radians', [['d', 'number', 'An angle in degrees.']], 'number', 'Degrees to radians, for rotate, sin and cos.', 'rotate(radians(45));', { returns: 'The angle in radians.', insert: 'radians(45)' }),
    fn('degrees', [['r', 'number', 'An angle in radians.']], 'number', 'Radians to degrees.', 'const deg = degrees(atan2(dy, dx));', { returns: 'The angle in degrees.' }),
    fn('random', [['a?', 'number | array', 'Upper limit (with one number), lower limit (with two), or an array to pick from.'], ['b?', 'number', 'Upper limit.']], 'number | item', 'A random number: random() is 0–1, random(n) is 0–n, random(a, b) is a–b; random(array) picks one item.',
      'const x = random(width);\nconst c = random([\'red\', \'gold\', \'white\']);', { returns: 'A number up to (not including) the upper limit, or an item of the array.', insert: 'random(0, 1)' }),
    fn('noise', [['x', 'number', 'Position along the first axis; nearby values give nearby results.'], ['y?', 'number', 'Second axis.'], ['z?', 'number', 'Third axis; s.time here animates it.']], 'number',
      'Smooth random: value noise that changes gradually as the inputs move. Scale positions down (× 0.01) for broad shapes.', 'const n = noise(x * 0.01, y * 0.01, s.time * 0.3);\ncircle(x, y, n * 20);', { returns: '0–1.', insert: 'noise(x * 0.01, y * 0.01, s.time)' }),
    fn('noiseSeed', [['n', 'number', 'Any number; each gives a different pattern.']], 'nothing', 'Changes the pattern noise() gives.', 'function setup(s) {\n  noiseSeed(42);\n}'),
    val('PI', 'number', 'π, half a turn in radians (3.14159…).', 'arc(100, 100, 80, 80, 0, PI);'),
    val('TWO_PI', 'number', 'A whole turn in radians (2π).', 'const a = (i / n) * TWO_PI;'),
    val('HALF_PI', 'number', 'A quarter turn in radians (π/2).', 'rotate(HALF_PI);'),
  ] },
  { title: 'Math shortcuts', items: [
    fn('floor', [['x', 'number', 'A number.']], 'number', 'Rounds down to a whole number.', 'const col = floor(mouseX / cellSize);', { returns: 'The whole number at or below x.' }),
    fn('ceil', [['x', 'number', 'A number.']], 'number', 'Rounds up to a whole number.', 'const rows = ceil(height / cellSize);', { returns: 'The whole number at or above x.' }),
    fn('round', [['x', 'number', 'A number.']], 'number', 'Rounds to the nearest whole number.', "text(round(s.time), 12, 24);", { returns: 'The nearest whole number.' }),
    fn('abs', [['x', 'number', 'A number.']], 'number', 'The value without its sign.', 'const d = abs(mouseX - width / 2);', { returns: 'x, made positive.' }),
    fn('min', [['a', 'number', 'A number.'], ['b', 'number', 'Another; any number of them.']], 'number', 'The smallest of the numbers.', 'const r = min(width, height) / 2;', { returns: 'The smallest.' }),
    fn('max', [['a', 'number', 'A number.'], ['b', 'number', 'Another; any number of them.']], 'number', 'The largest of the numbers.', 'const size = max(4, s.params.size);', { returns: 'The largest.' }),
    fn('sqrt', [['x', 'number', 'A number, 0 or more.']], 'number', 'The square root.', 'const side = sqrt(area);', { returns: '√x.' }),
    fn('pow', [['x', 'number', 'The base.'], ['e', 'number', 'The power.']], 'number', 'x to the power e; pow(t, 2) eases in, pow(t, 0.5) eases out.', 'const eased = pow(t, 3);', { returns: 'xᵉ.' }),
    fn('sin', [['a', 'number', 'An angle in radians.']], 'number', 'The sine: a smooth wave between −1 and 1. Feed it s.time to swing back and forth.', 'const y = height / 2 + sin(s.time * 2) * 80;', { returns: '−1 to 1.' }),
    fn('cos', [['a', 'number', 'An angle in radians.']], 'number', 'The cosine: sin shifted a quarter turn. cos for x and sin for y go round a circle.', 'circle(cx + cos(a) * r, cy + sin(a) * r, 10);', { returns: '−1 to 1.' }),
    fn('tan', [['a', 'number', 'An angle in radians.']], 'number', 'The tangent.', 'const slope = tan(angle);', { returns: 'sin(a) / cos(a).' }),
    fn('atan2', [['y', 'number', 'Vertical difference (y first).'], ['x', 'number', 'Horizontal difference.']], 'number', 'The angle of a direction, such as from a point toward the mouse.', 'const a = atan2(mouseY - p.y, mouseX - p.x);\nrotate(a);', { returns: 'The angle in radians, −π to π.' }),
  ] },
  { title: 'p5 names', items: [
    val('width', 'number', 'Picture width in pixels (s.width).', 'circle(width / 2, height / 2, 50);'),
    val('height', 'number', 'Picture height in pixels (s.height).', 'line(0, height / 2, width, height / 2);'),
    val('mouseX', 'number', 'The mouse’s x in pixels (s.mouse.x).', 'circle(mouseX, mouseY, 20);'),
    val('mouseY', 'number', 'The mouse’s y in pixels (s.mouse.y).', 'circle(mouseX, mouseY, 20);'),
    val('mouseIsPressed', 'boolean', 'Whether the mouse button is down (s.mouse.down).', 'if (mouseIsPressed) fill(255, 0, 0);'),
    val('frameCount', 'number', 'Frames since setup (s.frame).', 'if (frameCount % 30 === 0) s.state.flash = true;'),
    val('deltaTime', 'number', 'Milliseconds since the last frame (s.dt × 1000).', 'x += speed * deltaTime / 1000;'),
    fn('millis', [], 'number', 'The Play clock in milliseconds (s.time × 1000).', 'const blink = floor(millis() / 500) % 2;', { returns: 'Milliseconds.' }),
  ] },
];

// ── 3D ───────────────────────────────────────────────────────────────────────
// A Script layer in 3D (sketch3d.js): p5's WEBGL names on three.js. The origin
// is the middle of the picture, y goes down, z toward you; units are pixels.

const DETAIL: A = ['detailX?', 'number', 'Segments around (more is smoother, and slower).'];
const DETAIL_Y: A = ['detailY?', 'number', 'Segments from top to bottom.'];
const LIGHT_COLOUR: A = ['c', COLOUR, 'The light’s colour: grey, r g b in 0–255, or a CSS colour. 255 is full strength.'];

export const SCRIPT_REFERENCE_3D: RefGroup[] = [
  { title: '3D shapes', items: [
    fn('box', [['w?', 'number', 'Width in pixels (50).'], ['h?', 'number', 'Height; the width when left out.'], ['d?', 'number', 'Depth; the width when left out.']], 'nothing',
      'A box centred on the origin, in the fill (and stroke, as edges). Move it with translate first.', 'rotateY(s.time);\nbox(80);', { insert: 'box(80)' }),
    fn('sphere', [['r?', 'number', 'Radius in pixels (50).'], DETAIL, DETAIL_Y], 'nothing', 'A sphere centred on the origin.', 'sphere(60);\nsphere(60, 8, 6); // faceted', { insert: 'sphere(50)' }),
    fn('ellipsoid', [['rx?', 'number', 'Radius along x (50).'], ['ry?', 'number', 'Along y; rx when left out.'], ['rz?', 'number', 'Along z; rx when left out.'], DETAIL, DETAIL_Y], 'nothing', 'A squashed or stretched sphere.', 'ellipsoid(80, 30, 50);', { insert: 'ellipsoid(80, 30, 50)' }),
    fn('torus', [['r?', 'number', 'Radius of the ring (50).'], ['tube?', 'number', 'Radius of the tube (10).'], DETAIL, DETAIL_Y], 'nothing', 'A ring, like a doughnut, lying in the picture’s plane.', 'rotateX(s.time);\ntorus(80, 20);', { insert: 'torus(60, 15)' }),
    fn('cylinder', [['r?', 'number', 'Radius (50).'], ['h?', 'number', 'Height along y; r when left out.'], DETAIL, ['detailY?', 'number', 'Segments along its height.'], ['bottomCap?', 'boolean', 'false leaves the ends open.'], ['topCap?', 'boolean', 'false leaves the ends open.']], 'nothing', 'A cylinder standing along y.', 'cylinder(30, 120);', { insert: 'cylinder(30, 100)' }),
    fn('cone', [['r?', 'number', 'Radius of the base (50).'], ['h?', 'number', 'Height along y; r when left out.'], DETAIL, ['detailY?', 'number', 'Segments along its height.'], ['cap?', 'boolean', 'false leaves the base open.']], 'nothing', 'A cone along y.', 'cone(40, 100);', { insert: 'cone(40, 100)' }),
    fn('plane', [['w?', 'number', 'Width in pixels (50).'], ['h?', 'number', 'Height; the width when left out.']], 'nothing', 'A flat rectangle facing you, seen from both sides. A floor after rotateX(HALF_PI), or a screen with texture().', 'rotateX(HALF_PI);\nplane(400, 400);', { insert: 'plane(200, 200)' }),
    fn('line', [['x1', 'number', 'Start x.'], ['y1', 'number', 'Start y.'], ['z1', 'number', 'Start z (with six numbers; with four, the line lies at z = 0).'], ['x2', 'number', 'End x.'], ['y2', 'number', 'End y.'], ['z2', 'number', 'End z.']], 'nothing',
      'A line in the stroke colour (the fill’s without one). WebGL lines are one pixel wide.', 'stroke(255);\nline(-100, 0, 0, 100, 0, 0);', { insert: 'line(0, 0, 0, 100, 100, 100)' }),
  ] },
  { title: '3D transform', items: [
    fn('push', [], 'nothing', 'Saves the transform, fill, stroke and material, so what follows can move freely until pop().', 'push();\ntranslate(100, 0, 0);\nsphere(20);\npop();'),
    fn('pop', [], 'nothing', 'Restores what the matching push() saved.', 'pop();'),
    fn('translate', [['x', 'number', 'Pixels to the right.'], ['y', 'number', 'Pixels down.'], ['z?', 'number', 'Pixels toward you.']], 'nothing', 'Moves the origin; shapes drawn after it are placed there. The transform starts afresh each frame.', 'translate(0, 0, -200);\nbox(50);', { insert: 'translate(0, 0, 0)' }),
    fn('rotateX', [['a', 'number', 'Angle in radians.']], 'nothing', 'Turns what follows about the x axis (tips it toward you).', 'rotateX(s.time);\nbox(60);'),
    fn('rotateY', [['a', 'number', 'Angle in radians.']], 'nothing', 'Turns what follows about the y axis (spins it like a top).', 'rotateY(s.time);\nbox(60);'),
    fn('rotateZ', [['a', 'number', 'Angle in radians.']], 'nothing', 'Turns what follows about the z axis (in the picture’s plane).', 'rotateZ(s.time);\nplane(80);'),
    fn('rotate', [['a', 'number', 'Angle in radians.'], ['axis?', '[x, y, z]', 'The axis to turn about; z when left out.']], 'nothing', 'Turns what follows about any axis.', 'rotate(s.time, [1, 1, 0]);\nbox(60);'),
    fn('scale', [['x', 'number', 'Factor along x (1 is unchanged).'], ['y?', 'number', 'Along y; x when left out.'], ['z?', 'number', 'Along z; x when y is left out, else 1.']], 'nothing', 'Grows or shrinks what follows.', 'scale(2);\nsphere(20);'),
    fn('resetMatrix', [], 'nothing', 'Back to no transform (the origin in the middle).', 'resetMatrix();'),
  ] },
  { title: '3D colour and materials', items: [
    fn('background', [['c', COLOUR, COLOUR_ARGS]], 'nothing', 'Paints the whole layer this frame, hiding the shader under it. Leave it out to draw over the picture: a 3D layer starts clear every frame.', 'background(10, 10, 20);', { insert: 'background(20)' }),
    fn('clear', [], 'nothing', 'Undoes background() for this frame, so the picture shows through again. That is the default.', 'if (s.params.see) clear();'),
    fn('fill', [['c', COLOUR, COLOUR_ARGS]], 'nothing', 'The colour of shapes that follow. Flat without lights; shaded once the frame calls a light.', 'fill(255, 120, 40);\nsphere(50);', { insert: 'fill(255)' }),
    fn('noFill', [], 'nothing', 'Shapes that follow draw only their edges (with stroke).', 'noFill();\nstroke(255);\nbox(100);'),
    fn('stroke', [['c', COLOUR, COLOUR_ARGS]], 'nothing', 'Shapes that follow also draw their edges in this colour; lines use it too.', 'stroke(255);\nbox(100);', { insert: 'stroke(255)' }),
    fn('noStroke', [], 'nothing', 'No edges on the shapes that follow (the default).', 'noStroke();'),
    fn('normalMaterial', [], 'nothing', 'Colours each face by the way it points: a quick look that needs no lights.', 'normalMaterial();\ntorus(80, 25);'),
    fn('ambientMaterial', [['c?', COLOUR, 'The colour the surface reflects; the fill when left out.']], 'nothing', 'A matte surface that lights shade, even in a frame without lights.', 'ambientLight(80);\ndirectionalLight(255, 255, 255, 0, 1, -1);\nambientMaterial(200, 120, 60);\nsphere(60);', { insert: 'ambientMaterial(200)' }),
    fn('specularMaterial', [['c?', COLOUR, 'The colour of the highlight (white when left out).']], 'nothing', 'A shiny surface: the fill colour with a highlight where lights catch it. shininess() sets how tight.', 'pointLight(255, 255, 255, 0, -200, 200);\nfill(40, 90, 200);\nspecularMaterial(255);\nshininess(60);\nsphere(60);', { insert: 'specularMaterial(255)' }),
    fn('emissiveMaterial', [['c', COLOUR, 'The colour it glows with.']], 'nothing', 'A surface that glows in its own colour on top of the fill, lit or not.', 'emissiveMaterial(255, 80, 0);\nsphere(30);', { insert: 'emissiveMaterial(255, 80, 0)' }),
    fn('shininess', [['n', 'number', 'From 1 (broad) up (tight); 32 to start.']], 'nothing', 'How tight the highlight of specularMaterial is.', 'shininess(80);'),
    fn('texture', [['t', 'texture | canvas | image | video', 'What to wrap on the shapes: s.picture.texture for the live shader, a canvas you draw on, an image or a video.']], 'nothing',
      'Wraps the shapes that follow in a picture. fill() turns it off again.', 'texture(s.picture.texture);\nrotateY(s.time);\nbox(160);', { insert: 'texture(s.picture.texture)' }),
  ] },
  { title: 'Lights', items: [
    fn('ambientLight', [LIGHT_COLOUR], 'nothing', 'Light from everywhere, so the dark sides are not black. Lights last for the frame they are called in, so call them in draw.', 'ambientLight(60);', { insert: 'ambientLight(60)' }),
    fn('directionalLight', [LIGHT_COLOUR, ['dx', 'number', 'The way the light travels: x.'], ['dy', 'number', 'y (1 is downward).'], ['dz', 'number', 'z (−1 is away from you).']], 'nothing', 'Light from far away in one direction, like the sun. The colour can be three numbers, so this takes six.', 'directionalLight(255, 255, 255, 0.3, 0.6, -1);', { insert: 'directionalLight(255, 255, 255, 0, 1, -1)' }),
    fn('pointLight', [LIGHT_COLOUR, ['x', 'number', 'Where the light is: x.'], ['y', 'number', 'y.'], ['z', 'number', 'z (positive is in front).']], 'nothing', 'Light from a point, like a bulb, as strong at any distance.', 'pointLight(255, 200, 150, mouseX - width / 2, mouseY - height / 2, 200);', { insert: 'pointLight(255, 255, 255, 0, -200, 200)' }),
  ] },
  { title: 'Camera', items: [
    fn('camera', [['x?', 'number', 'Where the camera is: x.'], ['y?', 'number', 'y.'], ['z?', 'number', 'z (in front of the picture is positive).'], ['cx?', 'number', 'What it looks at: x.'], ['cy?', 'number', 'y.'], ['cz?', 'number', 'z.'], ['ux?', 'number', 'Which way is up: x.'], ['uy?', 'number', 'y (1, as in p5).'], ['uz?', 'number', 'z.']], 'nothing',
      'Places the camera. It stays there until moved, so setup is a good place. With no arguments, back to where it starts.', 'function setup(s) {\n  camera(0, -300, 700, 0, 0, 0, 0, 1, 0);\n}', { insert: 'camera(0, -300, 700, 0, 0, 0, 0, 1, 0)' }),
    fn('perspective', [['fovy?', 'number', 'How tall the view is, in radians (π/3).'], ['aspect?', 'number', 'Ignored: the picture’s shape is used.'], ['near?', 'number', 'Nearest distance drawn.'], ['far?', 'number', 'Farthest distance drawn.']], 'nothing', 'A perspective view (the default): far things look smaller. A wider fovy exaggerates depth.', 'function setup(s) {\n  perspective(PI / 2);\n}'),
    fn('ortho', [['left?', 'number', 'Left edge (−width/2).'], ['right?', 'number', 'Right edge.'], ['bottom?', 'number', 'Bottom edge.'], ['top?', 'number', 'Top edge.'], ['near?', 'number', 'Nearest distance.'], ['far?', 'number', 'Farthest distance.']], 'nothing', 'A flat view with no perspective: sizes stay the same at any depth, for isometric scenes.', 'function setup(s) {\n  ortho();\n}'),
    fn('orbitControl', [['sx?', 'number', 'How fast a sideways drag turns (1).'], ['sy?', 'number', 'How fast an up-and-down drag turns (1).']], 'nothing', 'Drag on the picture (or the Run preview) to turn the camera round what it looks at. Call it in draw.', 'orbitControl();'),
  ] },
  { title: 'three.js', items: [
    val('s.three', '{ THREE, scene, camera, renderer, root }', 'three.js itself, for what the p5 names do not cover. Build objects in setup and add them to scene; change them in draw. The scene keeps three’s usual y-up world, one unit a pixel.',
      'let knot;\nfunction setup(s) {\n  const { THREE, scene } = s.three;\n  knot = new THREE.Mesh(new THREE.TorusKnotGeometry(80, 20), new THREE.MeshNormalMaterial());\n  scene.add(knot);\n}\nfunction draw(s) {\n  knot.rotation.y = s.time;\n}'),
    val('s.three.THREE', 'module', 'The three.js classes: Mesh, the geometries and materials, lights, Vector3, Color, CanvasTexture and more (the set exported pages carry).', 'const { Mesh, IcosahedronGeometry, MeshStandardMaterial } = s.three.THREE;'),
    val('s.three.scene', 'THREE.Scene', 'The scene that is drawn. What setup adds stays until setup runs again (a resize, a code change).', 'const n = s.three.scene.children.length;'),
    val('s.three.camera', 'THREE.Camera', 'The camera the scene is drawn with. Set it to a camera of your own and the p5 camera names stop steering it.', 'const cam = s.three.camera;'),
    val('s.three.renderer', 'THREE.WebGLRenderer', 'The renderer, shared by every 3D layer: read from it, but settings you change reach the others. Set once the first frame has drawn.', 'const gl = s.three.renderer;'),
    val('s.three.root', 'THREE.Group', 'Where the p5-style shapes and lights live, flipped so y goes down. Add objects here to share the p5 coordinates.', 'const p5World = s.three.root;'),
    val('s.picture.texture', 'THREE.Texture', 'The picture under the layer, this frame, as a texture: skin a shape with the live shader. It uploads only on frames that read it.', 'texture(s.picture.texture);\nbox(160);'),
  ] },
];

/** The groups a sketch's mode shows: 2D as ever; 3D the 3D groups, then what still applies (the sketch, the frame, maths, colours). */
export function referenceFor(mode: '2d' | '3d'): RefGroup[] {
  if (mode !== '3d') return SCRIPT_REFERENCE;
  const keep = new Set(['Sketch', 'The frame (s)', 'Maths and random', 'Math shortcuts', 'p5 names']);
  const colours = new Set(['color', 'hsl', 'lerpColor']);
  return [
    ...SCRIPT_REFERENCE_3D,
    ...SCRIPT_REFERENCE.filter(g => keep.has(g.title)).map(g => ({ ...g, items: g.items.filter(it => it.name !== 's.ctx') })),
    { title: 'Colour values', items: SCRIPT_REFERENCE.flatMap(g => g.items).filter(it => colours.has(it.name)) },
  ];
}
