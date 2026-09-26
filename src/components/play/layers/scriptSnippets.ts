/**
 * Patterns for the Script editor: the pieces creative-coding sketches are
 * made of, ready to insert. Each says where it goes (the top of the file, or
 * inside draw / setup) and what it does, and carries a small complete sketch
 * using it (`example`), which the Patterns tab runs and can load. Names of
 * sliders it expects are plain variables, so Make a slider works on them
 * afterwards.
 */
export interface ScriptSnippet {
  group: string;
  name: string;
  doc: string;
  where: 'top' | 'setup' | 'draw';
  code: string;
  /** A whole sketch with the pattern in use. */
  example: string;
  /** Layer settings the example needs (Clear off for trails, Picture on to read it). */
  settings?: { clear?: boolean; readPicture?: boolean };
}

export const SNIPPET_GROUPS = ['Sketch', 'Motion', 'Drawing', 'Interaction', 'Picture and nulls'] as const;

const PATTERNS: Array<Omit<ScriptSnippet, 'example' | 'settings'>> = [
  { group: 'Sketch', name: 'Params: every kind', where: 'top', doc: 'A slider, a toggle and a button declared in one params object. Buttons are actions Play can press from a key or a beat.',
    code: `const params = {
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Speed' },
  size: 0.5,                                   // a bare number is a 0–1 slider
  glow: { kind: 'toggle', value: true, label: 'Glow' },
  reset(s) { s.state.items = []; },            // a function is a button
};
` },
  { group: 'Sketch', name: 'Keep things between frames', where: 'setup', doc: 'Put arrays and counters in s.state (reset on setup) and read them in draw.',
    code: `s.state.items = [];
s.state.t = 0;
` },
  { group: 'Sketch', name: 'Every N seconds', where: 'draw', doc: 'A timer in s.state that fires on a beat you choose.',
    code: `s.state.timer = (s.state.timer || 0) + s.dt;
if (s.state.timer > 1.0) {
  s.state.timer = 0;
  // happens once a second
}
` },
  { group: 'Sketch', name: 'Palette by index', where: 'top', doc: 'A small function that returns a colour for the i-th thing, evenly spaced around the hue wheel.',
    code: `function palette(i, n, light = 60) { return hsl((i / n) * 360, 80, light); }
` },

  { group: 'Motion', name: 'Particles: spawn, move, draw', where: 'top', doc: 'The core of a particle system in three functions: spawn at a point with a random velocity, move with drag, draw. Call them from setup and draw.',
    code: `// Particles: call spawnParticle(s, x, y) to add one; moveParticles(s) and drawParticles(s) in draw.
let count = 200;
let drag = 0.99;
function spawnParticle(s, x, y) {
  const a = random(TWO_PI), sp = random(20, 120);
  (s.state.ps ||= []).push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: random(360) });
}
function moveParticles(s) {
  const ps = s.state.ps || [];
  for (const p of ps) { p.x += p.vx * s.dt; p.y += p.vy * s.dt; p.vx *= drag; p.vy *= drag; p.life -= s.dt * 0.4; }
  s.state.ps = ps.filter(p => p.life > 0);
  while (s.state.ps.length < count) spawnParticle(s, width / 2, height / 2);
}
function drawParticles(s) {
  noStroke();
  for (const p of s.state.ps || []) { fill(hsl(p.hue, 80, 60, p.life)); circle(p.x, p.y, 4 + 8 * p.life); }
}
` },
  { group: 'Motion', name: 'Bounce off the edges', where: 'draw', doc: 'For an object p with x, y, vx, vy: reverse the velocity at the picture’s edges.',
    code: `if (p.x < 0 || p.x > width) p.vx *= -1;
if (p.y < 0 || p.y > height) p.vy *= -1;
p.x = constrain(p.x, 0, width); p.y = constrain(p.y, 0, height);
` },
  { group: 'Motion', name: 'Wrap around the edges', where: 'draw', doc: 'For an object p: leave on one side, come back on the other.',
    code: `p.x = (p.x + width) % width;
p.y = (p.y + height) % height;
` },
  { group: 'Motion', name: 'Ease toward a target', where: 'draw', doc: 'Smooth following: move a fraction of the way each frame. Smaller ease is lazier.',
    code: `let ease = 0.08;
s.state.x = lerp(s.state.x ?? mouseX, mouseX, ease);
s.state.y = lerp(s.state.y ?? mouseY, mouseY, ease);
` },
  { group: 'Motion', name: 'Spring to a target', where: 'draw', doc: 'A bouncy follow: acceleration toward the target, with damping.',
    code: `let stiffness = 40, damping = 6;
const st = s.state.spring ||= { x: mouseX, y: mouseY, vx: 0, vy: 0 };
st.vx += (mouseX - st.x) * stiffness * s.dt; st.vy += (mouseY - st.y) * stiffness * s.dt;
st.vx *= Math.exp(-damping * s.dt); st.vy *= Math.exp(-damping * s.dt);
st.x += st.vx * s.dt; st.y += st.vy * s.dt;
` },
  { group: 'Motion', name: 'Orbit a point', where: 'draw', doc: 'A point going round a centre at a radius and speed, with time from s.time.',
    code: `let radius = 120, speed = 1;
const cx = width / 2, cy = height / 2;
const ox = cx + Math.cos(s.time * speed) * radius;
const oy = cy + Math.sin(s.time * speed) * radius;
circle(ox, oy, 12);
` },
  { group: 'Motion', name: 'Noise flow field', where: 'draw', doc: 'Each object turns to the angle the noise field gives at its position, so many of them stream in lanes.',
    code: `let scale = 0.004, strength = 80;
for (const p of s.state.ps || []) {
  const a = noise(p.x * scale, p.y * scale, s.time * 0.2) * TWO_PI * 2;
  p.vx += Math.cos(a) * strength * s.dt; p.vy += Math.sin(a) * strength * s.dt;
}
` },
  { group: 'Motion', name: 'Flock: separate and cohere', where: 'draw', doc: 'Boids in two rules: steer away from close neighbours, drift toward the group’s centre. Feed it your particle array.',
    code: `let separate = 30, cohere = 0.5;
const ps = s.state.ps || [];
for (const p of ps) {
  let cx = 0, cy = 0, n = 0;
  for (const q of ps) {
    if (q === p) continue;
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (d < separate) { p.vx -= (dx / d) * 200 * s.dt; p.vy -= (dy / d) * 200 * s.dt; }
    if (d < 120) { cx += q.x; cy += q.y; n++; }
  }
  if (n) { p.vx += (cx / n - p.x) * cohere * s.dt; p.vy += (cy / n - p.y) * cohere * s.dt; }
}
` },

  { group: 'Drawing', name: 'Grid of cells', where: 'draw', doc: 'Nested loops over a grid, with the centre of each cell and its 0–1 position for varying things across the picture.',
    code: `let cols = 16, rows = 9;
const cw = width / cols, ch = height / rows;
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
  const x = (i + 0.5) * cw, y = (j + 0.5) * ch, u = i / (cols - 1), v = j / (rows - 1);
  circle(x, y, cw * 0.3 * (0.5 + 0.5 * Math.sin(s.time + u * 6 + v * 3)));
}
` },
  { group: 'Drawing', name: 'Polygon or star', where: 'draw', doc: 'A regular polygon with beginShape/vertex; alternate two radii for a star.',
    code: `let sides = 5, outer = 80, inner = 35;
beginShape();
for (let i = 0; i < sides * 2; i++) {
  const a = (i / (sides * 2)) * TWO_PI - HALF_PI, r = i % 2 ? inner : outer;
  vertex(width / 2 + Math.cos(a) * r, height / 2 + Math.sin(a) * r);
}
endShape(true);
` },
  { group: 'Drawing', name: 'Trail: fade instead of clear', where: 'draw', doc: 'With the layer’s Clear off, fade what is there a little each frame, then draw the new bit on top.',
    code: `let fade = 0.06;
s.ctx.globalCompositeOperation = 'destination-out';
s.ctx.fillStyle = 'rgba(0,0,0,' + fade + ')';
s.ctx.fillRect(0, 0, width, height);
s.ctx.globalCompositeOperation = 'source-over';
` },
  { group: 'Drawing', name: 'Text label', where: 'draw', doc: 'A line of text with size and alignment set.',
    code: `fill(255); textSize(16); textAlign('left', 'top');
text('frame ' + frameCount, 12, 12);
` },
  { group: 'Drawing', name: 'Gradient fill', where: 'draw', doc: 'A linear gradient on the raw canvas context, then a rectangle filled with it.',
    code: `const g = s.ctx.createLinearGradient(0, 0, width, height);
g.addColorStop(0, 'hsl(200 80% 60%)'); g.addColorStop(1, 'hsl(320 80% 60%)');
s.ctx.fillStyle = g; s.ctx.fillRect(0, 0, width, height);
` },
  { group: 'Drawing', name: 'Rotate around a point', where: 'draw', doc: 'push / translate / rotate / pop: draw something turned about a centre.',
    code: `push();
translate(width / 2, height / 2);
rotate(s.time);
rect(-40, -40, 80, 80);
pop();
` },

  { group: 'Interaction', name: 'Follow the mouse', where: 'draw', doc: 'mouseX and mouseY in pixels; mouseIsPressed while the button is down.',
    code: `if (mouseIsPressed) fill(255, 120, 80); else fill(255);
circle(mouseX, mouseY, 24);
` },
  { group: 'Interaction', name: 'Spawn on click', where: 'draw', doc: 'Adds an item where the mouse is pressed, once per press (a rising edge on s.mouse.down).',
    code: `if (s.mouse.down && !s.state.wasDown) (s.state.items ||= []).push({ x: mouseX, y: mouseY, born: s.time });
s.state.wasDown = s.mouse.down;
` },
  { group: 'Interaction', name: 'React to a button press', where: 'draw', doc: 'A button declared in params without a handler: s.pressed(key) is true on the frame it was pressed.',
    code: `if (s.pressed('burst')) { /* do it once */ }
` },

  { group: 'Picture and nulls', name: 'Read the picture', where: 'draw', doc: 'Brightness of the shader at a point, 0–1 (turn Picture on in the Canvas section).',
    code: `const b = s.picture.brightness(mouseX, mouseY);
circle(mouseX, mouseY, 10 + b * 60);
` },
  { group: 'Picture and nulls', name: 'Attach to a null', where: 'draw', doc: 'A Null layer’s position in pixels, by its label; falls back to the centre.',
    code: `const c = s.null('Sun') || { x: width / 2, y: height / 2 };
circle(c.x, c.y, 30);
` },
  { group: 'Picture and nulls', name: 'Sample the picture on a grid', where: 'draw', doc: 'Dots sized by the picture’s brightness, a halftone made in JavaScript.',
    code: `let cells = 32;
const cell = width / cells;
for (let y = cell / 2; y < height; y += cell) for (let x = cell / 2; x < width; x += cell) {
  const b = s.picture.brightness(x, y);
  circle(x, y, b * cell);
}
` },
];

/** Each pattern's example sketch, by pattern name: the pattern placed where Insert puts it, plus just enough to see it. */
const EXAMPLES: Record<string, Pick<ScriptSnippet, 'example' | 'settings'>> = {
  'Params: every kind': { example: `const params = {
  speed: { value: 1, min: 0, max: 4, step: 0.05, label: 'Speed' },
  size: 0.5,                                   // a bare number is a 0–1 slider
  glow: { kind: 'toggle', value: true, label: 'Glow' },
  reset(s) { s.state.items = []; },            // a function is a button
};

function setup(s) {
  s.state.items = [];
}

function draw(s) {
  background(12);
  if (s.frame % 10 === 0) s.state.items.push({ x: random(width), y: random(height), a: random(TWO_PI) });
  if (s.state.items.length > 40) s.state.items.shift();
  noStroke();
  for (const it of s.state.items) {
    it.a += s.dt * s.params.speed * 3;
    const x = it.x + Math.cos(it.a) * 20, y = it.y + Math.sin(it.a) * 20;
    if (s.params.glow) { fill(255, 180, 80, 50); circle(x, y, 80 * s.params.size + 20); }
    fill(255, 180, 80);
    circle(x, y, 50 * s.params.size);
  }
}
` },
  'Keep things between frames': { example: `function setup(s) {
  s.state.items = [];
  s.state.t = 0;
}

function draw(s) {
  background(12);
  s.state.t += s.dt;
  s.state.items.push({ x: width / 2 + Math.cos(s.state.t * 2) * width * 0.35, y: height / 2 + Math.sin(s.state.t * 3) * height * 0.35 });
  if (s.state.items.length > 90) s.state.items.shift();
  noStroke();
  s.state.items.forEach((p, i) => { fill(hsl(200 + i, 80, 60)); circle(p.x, p.y, i / 3); });
}
` },
  'Every N seconds': { example: `function draw(s) {
  s.state.timer = (s.state.timer || 0) + s.dt;
  if (s.state.timer > 1.0) {
    s.state.timer = 0;
    // happens once a second
    s.state.hue = random(360);
  }
  background(hsl(s.state.hue ?? 200, 60, 25));
  fill(255); textSize(48); textAlign('center', 'middle');
  text(s.state.timer.toFixed(2), width / 2, height / 2);
}
` },
  'Palette by index': { example: `function palette(i, n, light = 60) { return hsl((i / n) * 360, 80, light); }

function draw(s) {
  background(12);
  noStroke();
  const n = 12;
  for (let i = 0; i < n; i++) {
    fill(palette(i + s.time * 2, n));
    circle((i + 0.5) * width / n, height / 2, (width / n) * 0.8);
  }
}
` },
  'Particles: spawn, move, draw': { example: `// Particles: call spawnParticle(s, x, y) to add one; moveParticles(s) and drawParticles(s) in draw.
let count = 200;
let drag = 0.99;
function spawnParticle(s, x, y) {
  const a = random(TWO_PI), sp = random(20, 120);
  (s.state.ps ||= []).push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: random(360) });
}
function moveParticles(s) {
  const ps = s.state.ps || [];
  for (const p of ps) { p.x += p.vx * s.dt; p.y += p.vy * s.dt; p.vx *= drag; p.vy *= drag; p.life -= s.dt * 0.4; }
  s.state.ps = ps.filter(p => p.life > 0);
  while (s.state.ps.length < count) spawnParticle(s, width / 2, height / 2);
}
function drawParticles(s) {
  noStroke();
  for (const p of s.state.ps || []) { fill(hsl(p.hue, 80, 60, p.life)); circle(p.x, p.y, 4 + 8 * p.life); }
}

function draw(s) {
  background(10, 10, 16);
  if (s.mouse.down) for (let i = 0; i < 5; i++) spawnParticle(s, mouseX, mouseY);
  moveParticles(s);
  drawParticles(s);
}
` },
  'Bounce off the edges': { example: `function setup(s) {
  s.state.balls = [];
  for (let i = 0; i < 20; i++) s.state.balls.push({ x: random(width), y: random(height), vx: random(-300, 300), vy: random(-300, 300) });
}

function draw(s) {
  background(12);
  noStroke(); fill(255, 200, 80);
  for (const p of s.state.balls) {
    p.x += p.vx * s.dt; p.y += p.vy * s.dt;
    if (p.x < 0 || p.x > width) p.vx *= -1;
    if (p.y < 0 || p.y > height) p.vy *= -1;
    p.x = constrain(p.x, 0, width); p.y = constrain(p.y, 0, height);
    circle(p.x, p.y, 20);
  }
}
` },
  'Wrap around the edges': { example: `function setup(s) {
  s.state.dots = [];
  for (let i = 0; i < 30; i++) s.state.dots.push({ x: random(width), y: random(height), vx: random(80, 300) });
}

function draw(s) {
  background(12);
  noStroke(); fill(120, 200, 255);
  for (const p of s.state.dots) {
    p.x += p.vx * s.dt;
    p.x = (p.x + width) % width;
    p.y = (p.y + height) % height;
    circle(p.x, p.y, 14);
  }
}
` },
  'Ease toward a target': { example: `let ease = 0.08;

function draw(s) {
  background(12);
  s.state.x = lerp(s.state.x ?? mouseX, mouseX, ease);
  s.state.y = lerp(s.state.y ?? mouseY, mouseY, ease);
  noFill(); stroke(255, 255, 255, 90); strokeWeight(2);
  circle(mouseX, mouseY, 40);
  noStroke(); fill(120, 200, 255);
  circle(s.state.x, s.state.y, 30);
}
` },
  'Spring to a target': { example: `let stiffness = 40;
let damping = 6;

function draw(s) {
  background(12);
  const st = s.state.spring ||= { x: mouseX, y: mouseY, vx: 0, vy: 0 };
  st.vx += (mouseX - st.x) * stiffness * s.dt; st.vy += (mouseY - st.y) * stiffness * s.dt;
  st.vx *= Math.exp(-damping * s.dt); st.vy *= Math.exp(-damping * s.dt);
  st.x += st.vx * s.dt; st.y += st.vy * s.dt;
  stroke(255, 255, 255, 90); strokeWeight(2);
  line(mouseX, mouseY, st.x, st.y);
  noStroke(); fill(255, 140, 90);
  circle(st.x, st.y, 30);
}
` },
  'Orbit a point': { example: `let radius = 120;
let speed = 1;

function draw(s) {
  background(12);
  const cx = width / 2, cy = height / 2;
  const ox = cx + Math.cos(s.time * speed) * radius;
  const oy = cy + Math.sin(s.time * speed) * radius;
  noFill(); stroke(255, 255, 255, 60);
  circle(cx, cy, radius * 2);
  noStroke(); fill(255, 200, 80);
  circle(ox, oy, 24);
}
` },
  'Noise flow field': { example: `let scale = 0.004;
let strength = 80;

function setup(s) {
  s.state.ps = [];
  for (let i = 0; i < 400; i++) s.state.ps.push({ x: random(width), y: random(height), vx: 0, vy: 0 });
}

function draw(s) {
  background(10, 10, 16);
  for (const p of s.state.ps || []) {
    const a = noise(p.x * scale, p.y * scale, s.time * 0.2) * TWO_PI * 2;
    p.vx += Math.cos(a) * strength * s.dt; p.vy += Math.sin(a) * strength * s.dt;
  }
  noStroke(); fill(160, 220, 255);
  for (const p of s.state.ps) {
    p.vx *= 0.96; p.vy *= 0.96;
    p.x = (p.x + p.vx * s.dt + width) % width; p.y = (p.y + p.vy * s.dt + height) % height;
    circle(p.x, p.y, 4);
  }
}
` },
  'Flock: separate and cohere': { example: `let separate = 30;
let cohere = 0.5;

function setup(s) {
  s.state.ps = [];
  for (let i = 0; i < 60; i++) s.state.ps.push({ x: random(width), y: random(height), vx: random(-60, 60), vy: random(-60, 60) });
}

function draw(s) {
  background(12);
  const ps = s.state.ps || [];
  for (const p of ps) {
    let cx = 0, cy = 0, n = 0;
    for (const q of ps) {
      if (q === p) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < separate) { p.vx -= (dx / d) * 200 * s.dt; p.vy -= (dy / d) * 200 * s.dt; }
      if (d < 120) { cx += q.x; cy += q.y; n++; }
    }
    if (n) { p.vx += (cx / n - p.x) * cohere * s.dt; p.vy += (cy / n - p.y) * cohere * s.dt; }
  }
  noStroke(); fill(255, 220, 120);
  for (const p of ps) {
    const sp = Math.hypot(p.vx, p.vy) || 1, k = Math.min(1, 120 / sp);
    p.vx *= k; p.vy *= k;
    p.x = (p.x + p.vx * s.dt + width) % width; p.y = (p.y + p.vy * s.dt + height) % height;
    circle(p.x, p.y, 8);
  }
}
` },
  'Grid of cells': { example: `let cols = 16;
let rows = 9;

function draw(s) {
  background(12);
  noStroke(); fill(255);
  const cw = width / cols, ch = height / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (i + 0.5) * cw, y = (j + 0.5) * ch, u = i / (cols - 1), v = j / (rows - 1);
    circle(x, y, cw * 0.3 * (0.5 + 0.5 * Math.sin(s.time + u * 6 + v * 3)));
  }
}
` },
  'Polygon or star': { example: `let sides = 5;
let outer = 80;
let inner = 35;

function draw(s) {
  background(12);
  noStroke(); fill(255, 200, 80);
  beginShape();
  for (let i = 0; i < sides * 2; i++) {
    const a = (i / (sides * 2)) * TWO_PI - HALF_PI, r = i % 2 ? inner : outer;
    vertex(width / 2 + Math.cos(a) * r, height / 2 + Math.sin(a) * r);
  }
  endShape(true);
}
` },
  'Trail: fade instead of clear': { settings: { clear: false }, example: `let fade = 0.06;

function draw(s) {
  s.ctx.globalCompositeOperation = 'destination-out';
  s.ctx.fillStyle = 'rgba(0,0,0,' + fade + ')';
  s.ctx.fillRect(0, 0, width, height);
  s.ctx.globalCompositeOperation = 'source-over';
  noStroke(); fill(255, 160, 60);
  circle(width / 2 + Math.cos(s.time * 2) * width * 0.35, height / 2 + Math.sin(s.time * 3) * height * 0.35, 30);
}
` },
  'Text label': { example: `function draw(s) {
  background(12);
  fill(255); textSize(16); textAlign('left', 'top');
  text('frame ' + frameCount, 12, 12);
  textSize(56); textAlign('center', 'middle');
  text(s.time.toFixed(1) + ' s', width / 2, height / 2);
}
` },
  'Gradient fill': { example: `function draw(s) {
  const g = s.ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, 'hsl(200 80% 60%)'); g.addColorStop(1, 'hsl(320 80% 60%)');
  s.ctx.fillStyle = g; s.ctx.fillRect(0, 0, width, height);
  noStroke(); fill(255, 255, 255, 180);
  circle(width / 2 + Math.sin(s.time) * width * 0.3, height / 2, height * 0.4);
}
` },
  'Rotate around a point': { example: `function draw(s) {
  background(12);
  noStroke(); fill(120, 200, 255);
  push();
  translate(width / 2, height / 2);
  rotate(s.time);
  rect(-40, -40, 80, 80);
  pop();
}
` },
  'Follow the mouse': { example: `function draw(s) {
  background(12);
  noStroke();
  if (mouseIsPressed) fill(255, 120, 80); else fill(255);
  circle(mouseX, mouseY, 24);
}
` },
  'Spawn on click': { example: `function draw(s) {
  background(12);
  if (s.mouse.down && !s.state.wasDown) (s.state.items ||= []).push({ x: mouseX, y: mouseY, born: s.time });
  s.state.wasDown = s.mouse.down;
  s.state.items = (s.state.items || []).filter(it => s.time - it.born < 2);
  noFill(); strokeWeight(3);
  for (const it of s.state.items) {
    const age = s.time - it.born;
    stroke(255, 200, 80, 255 * (1 - age / 2));
    circle(it.x, it.y, age * 200);
  }
  noStroke(); fill(255); textSize(16);
  text('click here', 12, 24);
}
` },
  'React to a button press': { example: `const params = {
  burst: { kind: 'button', label: 'Burst' },
};

function setup(s) {
  s.state.r = 0;
}

function draw(s) {
  background(12);
  if (s.pressed('burst')) { s.state.r = 1; }
  s.state.r *= 0.95;
  noStroke(); fill(255, 120, 80);
  circle(width / 2, height / 2, 20 + s.state.r * height);
}
` },
  'Read the picture': { settings: { readPicture: true }, example: `function draw(s) {
  background(12);
  noStroke(); fill(255);
  const b = s.picture.brightness(mouseX, mouseY);
  circle(mouseX, mouseY, 10 + b * 60);
  textSize(16); text('move over the picture', 12, 24);
}
` },
  'Attach to a null': { example: `function draw(s) {
  background(12);
  const c = s.null('Sun') || { x: width / 2, y: height / 2 };
  noStroke(); fill(255, 200, 80);
  circle(c.x, c.y, 30);
  // Something that goes with it: a moon round the null.
  fill(200);
  circle(c.x + Math.cos(s.time) * 80, c.y + Math.sin(s.time) * 80, 12);
}
` },
  'Sample the picture on a grid': { settings: { readPicture: true }, example: `let cells = 32;

function draw(s) {
  background(12);
  noStroke(); fill(255);
  const cell = width / cells;
  for (let y = cell / 2; y < height; y += cell) for (let x = cell / 2; x < width; x += cell) {
    const b = s.picture.brightness(x, y);
    circle(x, y, b * cell);
  }
}
` },
};

export const SCRIPT_SNIPPETS: ScriptSnippet[] = PATTERNS.map(p => ({ ...p, ...(EXAMPLES[p.name] ?? { example: '' }) }));
