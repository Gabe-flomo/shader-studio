/**
 * The Script layer's built-in reference: what a sketch can call, grouped, with
 * one line each and the text the editor inserts. Kept as data so the same
 * list can feed autocomplete later.
 */
export interface RefItem { name: string; doc: string; insert?: string }
export interface RefGroup { title: string; items: RefItem[] }

export const SCRIPT_REFERENCE: RefGroup[] = [
  { title: 'Sketch', items: [
    { name: 'setup(s)', doc: 'Runs once, and again when the picture is resized. Make your arrays here.', insert: 'function setup(s) {\n  \n}\n' },
    { name: 'draw(s)', doc: 'Runs every frame. Draw here.', insert: 'function draw(s) {\n  \n}\n' },
    { name: 'params', doc: 'Sliders you declare: params = { speed: { value: 1, min: 0, max: 4, step: 0.1, label: "Speed" } }. Read them as s.params.speed, or name a top-level let the same and it is driven.', insert: 'const params = {\n  speed: { value: 1, min: 0, max: 4, step: 0.05, label: \'Speed\' },\n};\n' },
  ] },
  { title: 'The frame (s)', items: [
    { name: 's.ctx', doc: 'The 2D canvas context, s.width × s.height pixels, y down.' },
    { name: 's.width', doc: 'Picture width in pixels (also plain width).' },
    { name: 's.height', doc: 'Picture height in pixels (also plain height).' },
    { name: 's.time', doc: 'The Play clock in seconds.' },
    { name: 's.dt', doc: 'Seconds since the last frame, capped at 0.1.' },
    { name: 's.frame', doc: 'Frames since setup.' },
    { name: 's.params', doc: 'Current slider values by key.' },
    { name: 's.state', doc: 'An object kept between frames, reset on setup.' },
    { name: 's.mouse', doc: '{ x, y, over, down } in pixels.' },
    { name: 's.picture.brightness(x, y)', doc: '0–1 brightness of the shader at a pixel. Turn Picture on.', insert: 's.picture.brightness(x, y)' },
    { name: 's.null(name)', doc: 'A Null layer’s position { x, y } in pixels, by label, or null.', insert: "s.null('Sun')" },
    { name: 's.random()', doc: 'Math.random.' },
  ] },
  { title: 'Colour and style', items: [
    { name: 'background(c)', doc: 'Fill the whole canvas. Colours: gray, gray+alpha, r,g,b, r,g,b,a (0–255), or any CSS string.', insert: 'background(20)' },
    { name: 'fill(c)', doc: 'Fill colour for the shapes that follow.', insert: 'fill(255)' },
    { name: 'noFill()', doc: 'Shapes are outlines only.' },
    { name: 'stroke(c)', doc: 'Outline colour.', insert: 'stroke(255)' },
    { name: 'noStroke()', doc: 'No outline.' },
    { name: 'strokeWeight(w)', doc: 'Outline width in pixels.', insert: 'strokeWeight(2)' },
    { name: 'color(r, g, b, a)', doc: 'A colour string you can keep in a variable.', insert: 'color(255, 120, 40)' },
    { name: 'hsl(h, s, l, a)', doc: 'A colour from hue 0–360, saturation and lightness 0–100.', insert: 'hsl(200, 80, 60)' },
    { name: 'lerpColor(a, b, t)', doc: 'Between two colours.' },
    { name: 'clear()', doc: 'Erase the canvas (useful with Clear off).' },
  ] },
  { title: 'Shapes', items: [
    { name: 'circle(x, y, d)', doc: 'A circle of diameter d.', insert: 'circle(x, y, 20)' },
    { name: 'ellipse(x, y, w, h)', doc: 'An ellipse.', insert: 'ellipse(x, y, 40, 20)' },
    { name: 'rect(x, y, w, h, r)', doc: 'A rectangle from its top-left corner; r rounds the corners.', insert: 'rect(x, y, 40, 40)' },
    { name: 'square(x, y, s)', doc: 'A square.' },
    { name: 'line(x1, y1, x2, y2)', doc: 'A line in the stroke colour.', insert: 'line(0, 0, width, height)' },
    { name: 'point(x, y)', doc: 'A dot of strokeWeight size.' },
    { name: 'triangle(x1, y1, x2, y2, x3, y3)', doc: 'A triangle.' },
    { name: 'quad(…)', doc: 'Four corners.', insert: 'quad(x1, y1, x2, y2, x3, y3, x4, y4)' },
    { name: 'arc(x, y, w, h, a0, a1)', doc: 'An arc of an ellipse, angles in radians.', insert: 'arc(x, y, 60, 60, 0, PI)' },
    { name: 'beginShape() … vertex(x, y) … endShape(close)', doc: 'A polygon from points; endShape(true) closes it.', insert: 'beginShape();\nvertex(x, y);\nendShape(true);' },
    { name: 'text(str, x, y)', doc: 'Draw text in the fill colour.', insert: "text('hello', x, y)" },
    { name: 'textSize(n)', doc: 'Font size in pixels.', insert: 'textSize(24)' },
    { name: 'textAlign(h, v)', doc: '"left" | "center" | "right", and "top" | "middle" | "bottom".', insert: "textAlign('center', 'middle')" },
    { name: 'textFont(f)', doc: 'A CSS font family.', insert: "textFont('monospace')" },
  ] },
  { title: 'Transform', items: [
    { name: 'push() / pop()', doc: 'Save and restore the transform and style.', insert: 'push();\n\npop();' },
    { name: 'translate(x, y)', doc: 'Move the origin.' },
    { name: 'rotate(a)', doc: 'Turn by a radians.' },
    { name: 'scale(x, y)', doc: 'Scale from the origin.' },
  ] },
  { title: 'Maths and random', items: [
    { name: 'map(v, a, b, c, d)', doc: 'v from range a–b to range c–d; a sixth argument true clamps.', insert: 'map(v, 0, 1, 0, width)' },
    { name: 'lerp(a, b, t)', doc: 'Between a and b.' },
    { name: 'constrain(v, lo, hi)', doc: 'Clamp.' },
    { name: 'dist(x1, y1, x2, y2)', doc: 'Distance between two points.' },
    { name: 'mag(x, y)', doc: 'Length of a vector.' },
    { name: 'norm(v, a, b)', doc: 'v as 0–1 within a–b.' },
    { name: 'radians(d) / degrees(r)', doc: 'Convert angles.', insert: 'radians(45)' },
    { name: 'random(a, b)', doc: 'random() 0–1, random(n) 0–n, random(a, b), or random(array).', insert: 'random(0, 1)' },
    { name: 'noise(x, y, z)', doc: 'Smooth value noise 0–1; noiseSeed(n) changes the pattern.', insert: 'noise(x * 0.01, y * 0.01, s.time)' },
    { name: 'PI, TWO_PI, HALF_PI', doc: 'Constants.', insert: 'TWO_PI' },
    { name: 'floor, ceil, round, abs, min, max, sqrt, pow, sin, cos, tan, atan2', doc: 'Math shortcuts.', insert: 'floor(x)' },
    { name: 'width, height, mouseX, mouseY, mouseIsPressed, frameCount, deltaTime, millis()', doc: 'p5 names for the frame values.', insert: 'mouseX' },
  ] },
];
