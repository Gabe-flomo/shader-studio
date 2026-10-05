/**
 * playSketches.ts — the Script layers' code for the Play folder's Scripts
 * topic (playExamples.ts) and the recorded-take example. Each sketch teaches
 * one idea and says so in its first lines, since the code is what a reader
 * opens first. Sizes are fractions of the picture's height, so a sketch looks
 * the same at any resolution and pixel ratio.
 */

/** 1 · setup/draw, params as sliders, s.state. Plain canvas calls. */
export const SKETCH_FIRST = `// A first sketch. setup(s) runs once; draw(s) runs every frame.
// s.ctx is a 2D canvas the size of the picture. Sizes here are fractions
// of its height, so the sketch looks the same at any resolution.
// Every entry in params is a slider on the layer (and can be a Play control).
const params = {
  count:  { value: 14, min: 3, max: 60, step: 1, label: 'Dots' },
  radius: { value: 0.32, min: 0.05, max: 0.48, step: 0.01, label: 'Ring size' },
  spin:   { value: 0.4, min: -2, max: 2, step: 0.05, label: 'Spin' },
  hue:    { value: 200, min: 0, max: 360, step: 1, label: 'Hue' },
};

function setup(s) {
  s.state.angle = 0; // s.state keeps values from one frame to the next
}

function draw(s) {
  const { ctx, width, height, dt, time, params } = s;
  s.state.angle += params.spin * dt; // dt: seconds since the last frame
  const cx = width / 2, cy = height / 2, R = params.radius * height;
  for (let i = 0; i < params.count; i++) {
    const a = s.state.angle + (i / params.count) * Math.PI * 2;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2 - i * 0.5);
    ctx.fillStyle = 'hsl(' + (params.hue + i * 6) + ' 85% ' + (50 + pulse * 25) + '%)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, height * (0.012 + 0.022 * pulse), 0, Math.PI * 2);
    ctx.fill();
  }
}
`;

/** 2 · s.mouse: position, over, down. */
export const SKETCH_MOUSE = `// The mouse: s.mouse is { x, y, over, down } in pixels (y down, like any canvas).
// A chain of beads chases it; hold the button to swell them.
const params = {
  length: { value: 48, min: 5, max: 120, step: 1, label: 'Length' },
  follow: { value: 0.18, min: 0.02, max: 0.6, step: 0.01, label: 'Follow' },
};

function setup(s) {
  s.state.head = { x: s.width / 2, y: s.height / 2 };
  s.state.trail = []; // where the head has been, newest first
  s.state.press = 0;
}

// Move a fraction k of the way per 60th of a second, whatever the frame rate.
const ease = (k, dt) => 1 - Math.pow(1 - k, dt * 60);

function draw(s) {
  const { ctx, width, height, mouse, time, dt, params } = s;
  // Over the picture, chase the mouse; away from it, wander on a slow figure of eight.
  const target = mouse.over ? mouse : { x: width * (0.5 + 0.3 * Math.sin(time * 0.6)), y: height * (0.5 + 0.22 * Math.sin(time * 1.2)) };
  const head = s.state.head;
  head.x += (target.x - head.x) * ease(params.follow, dt);
  head.y += (target.y - head.y) * ease(params.follow, dt);
  // Remember the head's path; bead i sits where the head was 3 × i frames ago.
  const trail = s.state.trail;
  trail.unshift({ x: head.x, y: head.y });
  if (trail.length > 400) trail.pop();
  // mouse.down is true while the button is held: ease a 0–1 "press" toward it.
  s.state.press += ((mouse.down ? 1 : 0) - s.state.press) * ease(0.15, dt);
  const n = Math.min(params.length, Math.ceil(trail.length / 3));
  for (let i = n - 1; i >= 0; i--) {
    const t = i / n, p = trail[i * 3];
    const r = height * (0.028 - 0.02 * t) * (1 + s.state.press * 1.2);
    ctx.fillStyle = 'hsl(' + (170 + t * 140) + ' 90% ' + (68 - t * 30) + '%)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
  if (mouse.over) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = height * 0.003;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, height * 0.05, 0, Math.PI * 2); ctx.stroke();
  }
}
`;

/** 3 · s.picture.brightness: dots placed where the shader is bright. */
export const SKETCH_PICTURE = `// Reading the picture: s.picture.brightness(x, y) is 0–1, how bright the shader
// is at that pixel. The layer's Picture switch must be on (it samples the
// shader at 64 × 36 each frame). Here it decides where dots land: a stipple.
const params = {
  count:    { value: 5000, min: 200, max: 10000, step: 100, label: 'Dots' },
  size:     { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Dot size' },
  contrast: { value: 3, min: 0.5, max: 6, step: 0.1, label: 'Contrast' },
};
let dots = [];

// Throw darts: keep a random spot with a chance equal to its brightness,
// so bright parts of the picture collect more dots than dark ones.
// A dot that misses every throw sits this life out (d.hit is false).
function place(s, d) {
  d.hit = false;
  for (let tries = 0; tries < 30 && !d.hit; tries++) {
    d.x = Math.random() * s.width;
    d.y = Math.random() * s.height;
    d.b = s.picture.brightness(d.x, d.y);
    d.hit = Math.random() < Math.pow(d.b, s.params.contrast);
  }
  d.life = 0.6 + Math.random() * 1.6;
  d.age = 0;
}

function setup(s) { dots = []; }

function draw(s) {
  const { ctx, height, dt, params } = s;
  while (dots.length < params.count) { const d = {}; place(s, d); d.age = Math.random() * d.life; dots.push(d); }
  dots.length = params.count;
  const r0 = height * 0.0026 * params.size;
  for (const d of dots) {
    d.age += dt;
    if (d.age > d.life) place(s, d); // a dot that has lived its life lands somewhere new
    if (!d.hit) continue;
    const fade = Math.sin(Math.PI * d.age / d.life); // in, then out
    const t = constrain(map(d.b, 0.35, 0.85, 0, 1), 0, 1); // blue and small where dim, gold and big where bright
    ctx.fillStyle = 'hsl(' + (225 - t * 185) + ' 90% ' + (55 + t * 30) + '% / ' + fade + ')';
    ctx.beginPath(); ctx.arc(d.x, d.y, r0 * (0.5 + t), 0, Math.PI * 2); ctx.fill();
  }
}
`;

/** 4 · s.null(name): nulls as handles. */
export const SKETCH_NULLS = `// Nulls as handles: s.null('A') is the Null layer labelled A, in pixels
// (or null when there is none). Drag A and B; Pull follows the mouse on a spring.
const params = {
  beads: { value: 28, min: 0, max: 80, step: 1, label: 'Beads' },
  bend:  { value: 1, min: 0, max: 2, step: 0.05, label: 'Bend' },
};

function draw(s) {
  const { ctx, width, height, time, params } = s;
  const a = s.null('A') || { x: width * 0.2, y: height / 2 };
  const b = s.null('B') || { x: width * 0.8, y: height / 2 };
  const p = s.null('Pull') || { x: width / 2, y: height * 0.3 };
  // A curve from A to B that passes through Pull when Bend is 1:
  // the control point is the middle of A–B pushed twice as far toward Pull.
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const cx = mx + (p.x - mx) * 2 * params.bend, cy = my + (p.y - my) * 2 * params.bend;
  const at = t => ({
    x: (1 - t) * (1 - t) * a.x + 2 * t * (1 - t) * cx + t * t * b.x,
    y: (1 - t) * (1 - t) * a.y + 2 * t * (1 - t) * cy + t * t * b.y,
  });
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(160, 200, 255, 0.35)'; ctx.lineWidth = height * 0.012;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
  ctx.strokeStyle = 'rgba(235, 245, 255, 0.95)'; ctx.lineWidth = height * 0.003;
  ctx.stroke();
  // Beads slide along the curve, biggest in the middle.
  for (let i = 0; i < params.beads; i++) {
    const t = (i / params.beads + time * 0.08) % 1;
    const q = at(t), r = height * (0.006 + 0.016 * Math.sin(Math.PI * t));
    ctx.fillStyle = 'hsl(' + (20 + t * 300) + ' 90% 65%)';
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
  }
}
`;

/** 5 · buttons: { kind: 'button' } with s.pressed, and a function button. */
export const SKETCH_BUTTONS = `// Buttons. { kind: 'button' } declares one: s.pressed('kick') is true on the frame
// it fires, and s.params.kick is the amount the action sent. A function in params
// is a button too, and runs when pressed. Both are actions on the Play panel:
// here a Beat presses Kick every beat, Space presses it harder, R presses Reverse.
const params = {
  kick: { kind: 'button', label: 'Kick' },
  reverse(s) { dir = -dir; },
  life: { value: 1.4, min: 0.2, max: 4, step: 0.05, label: 'Ring life (s)' },
};
let rings = [];
let dir = 1;
let kicks = 0;

function draw(s) {
  const { ctx, width, height, dt, time, params } = s;
  if (s.pressed('kick')) {
    kicks++;
    rings.push({ age: 0, amount: params.kick, hue: (190 + kicks * 37) % 360, sides: 3 + Math.floor(Math.random() * 4), turn: Math.random() * Math.PI });
  }
  const cx = width / 2, cy = height / 2;
  ctx.lineJoin = 'round';
  for (const r of rings) {
    r.age += dt;
    r.turn += dir * dt * 0.8;
    const t = r.age / params.life;
    const size = height * (0.08 + 0.5 * Math.sqrt(t)) * r.amount;
    ctx.strokeStyle = 'hsl(' + r.hue + ' 90% 65% / ' + Math.max(0, 1 - t) + ')';
    ctx.lineWidth = height * 0.012 * (1 - t) + 1;
    ctx.beginPath();
    for (let k = 0; k <= r.sides; k++) {
      const a = r.turn + (k / r.sides) * Math.PI * 2;
      const x = cx + Math.cos(a) * size, y = cy + Math.sin(a) * size;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  rings = rings.filter(r => r.age < params.life);
}
`;

/** 6 · a particle system in plain JS: spawn, move, draw, die. */
export const SKETCH_PARTICLES = `// A particle system in plain JavaScript: an array of objects, and four steps
// every frame: spawn, move, draw, die. The emitter follows the mouse over
// the picture and sweeps along the bottom when it isn't there.
const params = {
  rate:    { value: 320, min: 0, max: 1500, step: 10, label: 'Per second' },
  gravity: { value: 0.9, min: -1, max: 3, step: 0.05, label: 'Gravity' },
  spread:  { value: 0.35, min: 0, max: 1.5, step: 0.01, label: 'Spread' },
  life:    { value: 2.4, min: 0.3, max: 6, step: 0.1, label: 'Life (s)' },
};
let parts = [];
let owed = 0; // part of a particle carried over to the next frame

function spawn(s, x, y) {
  const a = -Math.PI / 2 + (Math.random() - 0.5) * 2 * s.params.spread;
  const v = s.height * (0.8 + Math.random() * 0.5);
  parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0 });
}

function setup(s) { parts = []; owed = 0; }

function draw(s) {
  const { ctx, width, height, dt, mouse, time, params } = s;
  // 1. Spawn: rate × dt new particles this frame (the fraction waits for the next).
  const ex = mouse.over ? mouse.x : width * (0.5 + 0.3 * Math.sin(time * 0.5));
  const ey = mouse.over ? mouse.y : height * 0.9;
  owed += params.rate * dt;
  while (owed >= 1) { if (parts.length < 5000) spawn(s, ex, ey); owed -= 1; }
  // 2. Move: gravity adds to the velocity, the velocity to the position. The floor bounces.
  const g = params.gravity * height;
  ctx.globalCompositeOperation = 'lighter'; // overlapping sparks add up to white
  for (const p of parts) {
    p.vy += g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.y > height) { p.y = height; p.vy *= -0.45; p.vx *= 0.8; }
    p.age += dt;
    // 3. Draw: colour, size and opacity by age, 0 (born) to 1 (gone).
    const t = p.age / params.life;
    ctx.fillStyle = 'hsl(' + (45 - t * 70) + ' 100% ' + (72 - t * 40) + '% / ' + Math.max(0, 1 - t) + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, height * 0.006 * (1 - 0.6 * t), 0, Math.PI * 2); ctx.fill();
  }
  // 4. Die: keep only the ones still alive.
  parts = parts.filter(p => p.age < params.life);
}
`;

/** 7 · a p5 sketch, pasted in: plain variables driven by params. */
export const SKETCH_P5 = `// A p5.js sketch, pasted in. What changed from p5:
//  • no createCanvas(): the canvas is the picture, width × height;
//  • params turns the two variables below into sliders: the layer writes
//    their values into rows and peak before each draw.
// The rest is p5's own vocabulary: stroke, fill, noise, beginShape…
// One more change: background() would paint over the shader, so the sketch
// starts each frame with clear() and the shader shows around the ridges.
const params = {
  rows: { value: 34, min: 8, max: 80, step: 1, label: 'Rows' },
  peak: { value: 0.13, min: 0, max: 0.4, step: 0.01, label: 'Peak height' },
};
let rows = 34;
let peak = 0.13;

function setup() {
  noiseSeed(7);
}

function draw() {
  clear(); // was background(0)
  const u = height / 400; // one pixel of a 400-pixel-tall p5 canvas
  stroke(255);
  strokeWeight(1.3 * u);
  fill(0);
  const top = height * 0.2, gap = (height * 0.68) / rows;
  const left = width / 2 - height * 0.42, right = width / 2 + height * 0.42;
  for (let i = 0; i < rows; i++) {
    const y0 = top + i * gap;
    beginShape();
    for (let x = left; x <= right; x += 3 * u) {
      const d = abs(x - width / 2) / (right - left) * 2; // 0 in the middle, 1 at the ends
      const bump = pow(max(0, 1 - d * 1.5), 2);
      const n = noise(x / u * 0.02, i * 0.4, frameCount * 0.01);
      vertex(x, y0 - n * n * bump * peak * height * 1.6);
    }
    endShape();
  }
}
`;

/** 8 · a sketch the graph's Layers node reads back, so the shader glows around it. */
export const SKETCH_GLOW = `// Draw thin lines. The graph's Layers node turns everything the layers draw
// into a distance field, and SDF Glow lights it: a sketch becomes neon.
const params = {
  petals: { value: 5, min: 2, max: 12, step: 1, label: 'Petals' },
  depth:  { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Depth' },
  turn:   { value: 0.25, min: -2, max: 2, step: 0.05, label: 'Turn' },
};

function draw(s) {
  const { ctx, width, height, time, params } = s;
  const cx = width / 2, cy = height / 2, R = height * 0.34;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = Math.max(1, height * 0.0025);
  ctx.lineJoin = 'round';
  // A rose: the radius swings between R(1 - depth) and R, petals times around.
  for (const [k, spin, scale] of [[params.petals, 1, 1], [params.petals * 2, -1.5, 0.55]]) {
    ctx.beginPath();
    for (let i = 0; i <= 600; i++) {
      const t = (i / 600) * Math.PI * 2;
      const r = R * scale * (1 - params.depth * 0.5 * (1 - Math.cos(k * t)));
      const a = t + time * params.turn * spin;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
`;

/** The recorded-take example: a comet on a null, with a sparkle button. */
export const SKETCH_COMET = `// A comet riding the Lead null. It keeps the head's recent path (a second
// of it) and redraws it every frame, thinning and fading toward the tail.
// Sparkle is a button (Space, S, or the recorded take) that throws out sparks.
const params = {
  tail:  { value: 0.8, min: 0.1, max: 2, step: 0.05, label: 'Tail (s)' },
  thick: { value: 0.03, min: 0.005, max: 0.1, step: 0.005, label: 'Width' },
  sparkle(s, amount) {
    const h = s.null('Lead');
    if (!h) return;
    for (let i = 0; i < 40 * amount; i++) {
      const a = Math.random() * Math.PI * 2, v = s.height * (0.2 + Math.random() * 0.6);
      sparks.push({ x: h.x, y: h.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0 });
    }
  },
};
let path = [];   // { x, y, t }, newest last
let sparks = [];

function setup(s) { path = []; sparks = []; }

function draw(s) {
  const { ctx, width, height, dt, time, params } = s;
  const head = s.null('Lead') || { x: width / 2, y: height / 2 };
  path.push({ x: head.x, y: head.y, t: time });
  while (path.length > 2 && time - path[0].t > params.tail) path.shift();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 1; i < path.length; i++) {
    const k = i / path.length; // 0 at the tail, 1 at the head
    ctx.strokeStyle = 'hsl(' + ((20 + time * 25 - (1 - k) * 60) % 360) + ' 95% ' + (40 + k * 25) + '% / ' + k + ')';
    ctx.lineWidth = params.thick * height * (0.2 + 0.8 * k);
    ctx.beginPath(); ctx.moveTo(path[i - 1].x, path[i - 1].y); ctx.lineTo(path[i].x, path[i].y); ctx.stroke();
  }
  // Sparks: short streaks along their velocity, slowing and fading over a second.
  ctx.lineWidth = height * 0.004;
  for (const p of sparks) {
    p.age += dt;
    p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.strokeStyle = 'hsl(45 100% 75% / ' + Math.max(0, 1 - p.age) + ')';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
  }
  sparks = sparks.filter(p => p.age < 1);
}
`;

/** A CPU toy: Background → Colour, so no shader runs; ink trails on a flat colour. */
export const SKETCH_INK = `// No shader here: the Play page's Background is Colour, so the graph is
// paused and this sketch is all that runs, on a flat colour. A CPU toy.
// Walkers follow a drifting noise field and leave ink. "Clear each frame"
// is off, so every frame draws over the last; erasing a little of the
// canvas each frame turns the strokes into fading trails.
const params = {
  count:   { value: 1200, min: 50, max: 4000, step: 10, label: 'Walkers' },
  swirl:   { value: 2.4, min: 0.5, max: 8, step: 0.1, label: 'Swirl size' },
  speed:   { value: 0.14, min: 0.02, max: 0.6, step: 0.01, label: 'Speed' },
  fade:    { value: 0.05, min: 0, max: 0.3, step: 0.005, label: 'Fade' },
  hue:     { value: 190, min: 0, max: 360, step: 1, label: 'Hue' },
};
let walkers = [];

function spawn(s) {
  return { x: Math.random() * s.width, y: Math.random() * s.height, life: 2 + Math.random() * 5, age: 0 };
}

function setup(s) { walkers = []; }

function draw(s) {
  const { ctx, width, height, dt, time, params, mouse } = s;
  // 1. Fade: erase a little of every pixel (the same amount a second at any frame rate).
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0, 0, 0, ' + (1 - Math.pow(1 - params.fade, dt * 60)) + ')';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  while (walkers.length < params.count) { const w = spawn(s); w.age = Math.random() * w.life; walkers.push(w); }
  walkers.length = params.count;
  // 2. Move each walker along the field and draw the step it took.
  const k = params.swirl / height, step = params.speed * height * dt;
  ctx.lineWidth = height * 0.0018; ctx.lineCap = 'round';
  for (const w of walkers) {
    let a = noise(w.x * k, w.y * k, time * 0.08) * Math.PI * 4;
    // The mouse pushes walkers away within a fifth of the height.
    if (mouse.over) {
      const dx = w.x - mouse.x, dy = w.y - mouse.y, d = Math.hypot(dx, dy), r = height * 0.2;
      if (d < r) a = lerp(a, Math.atan2(dy, dx), 1 - d / r);
    }
    const nx = w.x + Math.cos(a) * step, ny = w.y + Math.sin(a) * step;
    const t = w.age / w.life;
    ctx.strokeStyle = 'hsl(' + (params.hue + (a * 12) % 60) + ' 80% ' + (58 + 20 * Math.sin(t * Math.PI)) + '% / ' + Math.sin(t * Math.PI) + ')';
    ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(nx, ny); ctx.stroke();
    w.x = nx; w.y = ny; w.age += dt;
    // 3. A walker that is old or off the canvas starts again somewhere new.
    if (w.age > w.life || w.x < 0 || w.y < 0 || w.x > width || w.y > height) Object.assign(w, spawn(s));
  }
}
`;

/** 3D on the 2D canvas: rotate, project, sort, shade. No WebGL, no libraries. */
export const SKETCH_3D = `// 3D on a 2D canvas, the way Processing did it before WebGL: rotate each
// point in JavaScript, divide by depth for perspective, then paint the faces
// from the back to the front (the painter's algorithm), each one shaded by
// how much it faces the light. The shader behind shows through the gaps.
// Drag on the picture to turn the shape; let go and it keeps spinning.
const params = {
  shape: { value: 0, min: 0, max: 2, step: 1, label: 'Shape (torus, ball, cube)' },
  size:  { value: 0.27, min: 0.1, max: 0.6, step: 0.01, label: 'Size' },
  spin:  { value: 0.5, min: -2, max: 2, step: 0.05, label: 'Spin' },
  lens:  { value: 2.6, min: 1.4, max: 8, step: 0.1, label: 'Lens (lower = wider)' },
  hue:   { value: 205, min: 0, max: 360, step: 1, label: 'Hue' },
  wire:  { kind: 'toggle', value: false, label: 'Wireframe' },
};

// ── Meshes: a list of points [x, y, z] and faces (indexes into the points) ──
function torus(R, r, nu, nv) {
  const pts = [], faces = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = i / nu * Math.PI * 2, v = j / nv * Math.PI * 2;
    pts.push([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * nv + j, b = ((i + 1) % nu) * nv + j, c = ((i + 1) % nu) * nv + (j + 1) % nv, d = i * nv + (j + 1) % nv;
    faces.push([a, b, c, d]);
  }
  return { pts, faces };
}
function ball(n) { // a sphere in latitude/longitude quads
  const pts = [], faces = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j < n * 2; j++) {
    const th = i / n * Math.PI, ph = j / (n * 2) * Math.PI * 2;
    pts.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n * 2; j++) {
    const w = n * 2, a = i * w + j, b = i * w + (j + 1) % w;
    faces.push([a, b, b + w, a + w]);
  }
  return { pts, faces };
}
function cube() {
  const pts = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p => p.map(c => c * 0.62));
  const faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]];
  return { pts, faces };
}

function setup(s) {
  s.state.meshes = [torus(0.72, 0.3, 36, 16), ball(14), cube()];
  s.state.rx = 0.5; s.state.ry = 0;       // the shape's current turn
  s.state.vx = 0; s.state.vy = 0;         // how fast a drag left it turning
  s.state.last = null;
}

function draw(s) {
  const { ctx, width, height, dt, mouse, params } = s;
  const st = s.state;
  // Drag to turn; the spin (and the drag's leftover speed) keeps it moving.
  if (mouse.down && st.last) { st.vy = (mouse.x - st.last.x) / height * 4 / Math.max(dt, 1e-3) * 0.02; st.vx = (mouse.y - st.last.y) / height * 4 / Math.max(dt, 1e-3) * 0.02; }
  st.last = mouse.down ? { x: mouse.x, y: mouse.y } : null;
  st.vx *= Math.pow(0.05, dt); st.vy *= Math.pow(0.05, dt);
  st.ry += (params.spin + st.vy) * dt; st.rx += (params.spin * 0.37 + st.vx) * dt;

  const mesh = st.meshes[Math.round(params.shape)];
  const cx = Math.cos(st.rx), sx = Math.sin(st.rx), cy = Math.cos(st.ry), sy = Math.sin(st.ry);
  const scale = params.size * height, lens = params.lens;
  // Turn every point (around y, then x) and project it onto the canvas.
  const view = mesh.pts.map(([x, y, z]) => {
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    const k = lens / (lens + z2); // perspective: farther points shrink
    return { x: x1, y: y2, z: z2, px: width / 2 + x1 * k * scale, py: height / 2 - y2 * k * scale };
  });

  // Each face: its normal (for light and for hiding the back) and its depth (for sorting).
  const light = [-0.45, 0.6, -0.66];
  const drawn = [];
  for (const f of mesh.faces) {
    const a = view[f[0]], b = view[f[1]], c = view[f[2]];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    const cam = [-a.x, -a.y, -lens - a.z]; // towards the camera
    if (!params.wire && nx * cam[0] + ny * cam[1] + nz * cam[2] <= 0) continue; // facing away: hidden
    const lit = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
    const depth = f.reduce((sum, i) => sum + view[i].z, 0) / f.length;
    drawn.push({ f, lit, depth });
  }
  drawn.sort((p, q) => q.depth - p.depth); // farthest first, so near faces paint over them

  ctx.lineJoin = 'round';
  for (const { f, lit, depth } of drawn) {
    ctx.beginPath();
    f.forEach((i, n) => (n ? ctx.lineTo(view[i].px, view[i].py) : ctx.moveTo(view[i].px, view[i].py)));
    ctx.closePath();
    if (params.wire) {
      ctx.strokeStyle = 'hsla(' + params.hue + ' 90% 75% / ' + (0.25 + 0.5 * (1 - (depth + 1) / 2)) + ')';
      ctx.lineWidth = height * 0.0022;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'hsl(' + params.hue + ' 70% ' + (14 + lit * 62) + '%)';
      ctx.strokeStyle = 'hsla(' + params.hue + ' 90% 80% / 0.18)'; // a faint edge keeps facets readable
      ctx.lineWidth = 1;
      ctx.fill(); ctx.stroke();
    }
  }
}
`;

/** 3D Script layer: p5's 3D names on WebGL, lit shapes over the glow, orbitControl. */
export const SKETCH_3D_SHAPES = `// A 3D Script layer: the layer's Mode is 3D, so it draws with WebGL (three.js
// underneath) using p5's 3D names: box, sphere, torus, lights, orbitControl.
// Nothing paints a background, so the glow shader shows through around the shapes.
// The origin is the middle of the picture; y goes down, z comes toward you, in pixels.
// Drag on the picture to turn the camera.
const params = {
  count: { value: 7, min: 1, max: 16, step: 1, label: 'Shapes' },
  size:  { value: 0.09, min: 0.03, max: 0.2, step: 0.005, label: 'Size' },
  spin:  { value: 0.4, min: -2, max: 2, step: 0.05, label: 'Spin' },
  shiny: { kind: 'toggle', value: true, label: 'Shiny' },
};

function draw(s) {
  const { params, time } = s;
  orbitControl();
  const u = min(width, height);            // sizes as fractions of the picture
  ambientLight(50, 55, 80);
  directionalLight(255, 245, 230, -0.5, 0.7, -0.6);
  pointLight(90, 140, 255, 0, 0, u * 0.15); // a blue light where the glow is
  noStroke();
  const r = u * 0.36;
  for (let i = 0; i < params.count; i++) {
    const a = (i / params.count) * TWO_PI + time * params.spin;
    push();
    translate(cos(a) * r, sin(a * 2 + time) * u * 0.04, sin(a) * r * 0.55);
    rotateX(time * 0.7 + i);
    rotateY(time * 0.9 + i * 0.5);
    fill(hsl(200 + (i / params.count) * 160, 70, 62));
    if (params.shiny) { specularMaterial(170); shininess(60); }
    const d = u * params.size;
    const k = i % 5;
    if (k === 0) box(d * 1.4);
    else if (k === 1) sphere(d * 0.9, 32, 24);
    else if (k === 2) torus(d * 0.8, d * 0.28, 40, 20);
    else if (k === 3) cone(d * 0.8, d * 1.6, 32);
    else cylinder(d * 0.6, d * 1.5, 32);
    pop();
  }
}
`;

/** 3D Script layer: the picture as a texture (s.picture.texture) on a cube. */
export const SKETCH_3D_TEXTURE = `// The shader on a cube. s.picture.texture is the picture under this layer, this
// frame, as a texture; texture() wraps it round the shapes that follow. The cube
// wears the very picture it floats over, live; two lights shade its faces apart.
// Drag on the picture to turn the camera.
const params = {
  size:  { value: 0.42, min: 0.1, max: 0.8, step: 0.01, label: 'Size' },
  spin:  { value: 0.5, min: -2, max: 2, step: 0.05, label: 'Spin' },
  tilt:  { value: 0.45, min: -1.5, max: 1.5, step: 0.05, label: 'Tilt' },
  edges: { kind: 'toggle', value: true, label: 'Edges' },
};

function draw(s) {
  const { params, time } = s;
  orbitControl();
  const u = min(width, height);
  ambientLight(120);
  directionalLight(255, 250, 240, -0.5, 0.6, -0.7);
  push();
  rotateX(params.tilt + sin(time * 0.4) * 0.15);
  rotateY(time * params.spin);
  texture(s.picture.texture);
  if (params.edges) stroke(255); else noStroke();
  box(u * params.size);
  pop();
}
`;

/** Fireflies that climb toward the light of whatever the Background layer shows (the Background queue example). */
export const SKETCH_FIREFLIES = `// Fireflies that read the picture under them: s.picture.brightness(x, y)
// is 0 to 1 (the layer's Picture switch is on). Whatever the background shows,
// a graph or the photo, they drift uphill toward its light and glow there.
const params = {
  count: { value: 140, min: 10, max: 500, step: 10, label: 'Fireflies' },
  size:  { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Size' },
  pull:  { value: 1.2, min: 0, max: 3, step: 0.05, label: 'Pull to light' },
};
let flies = [];

function setup(s) { flies = []; }

function draw(s) {
  const { ctx, width: w, height: h, dt, time, params } = s;
  while (flies.length < params.count) flies.push({ x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, p: Math.random() * 6.28 });
  flies.length = params.count;
  const e = h * 0.05, speed = h * 0.3;
  ctx.globalCompositeOperation = 'lighter';
  for (const f of flies) {
    // Which way the picture gets brighter, from four reads around the fly.
    const gx = s.picture.brightness(f.x + e, f.y) - s.picture.brightness(f.x - e, f.y);
    const gy = s.picture.brightness(f.x, f.y + e) - s.picture.brightness(f.x, f.y - e);
    f.vx += (gx * params.pull * 6 + Math.cos(time * 0.9 + f.p) * 0.35) * speed * dt;
    f.vy += (gy * params.pull * 6 + Math.sin(time * 1.3 + f.p) * 0.35) * speed * dt;
    f.vx *= 0.94; f.vy *= 0.94;
    f.x = (f.x + f.vx * dt + w) % w;
    f.y = (f.y + f.vy * dt + h) % h;
    const b = s.picture.brightness(f.x, f.y);
    const r = h * 0.005 * params.size * (0.7 + b);
    const twinkle = 0.55 + 0.45 * Math.sin(time * 3 + f.p * 5);
    // A soft halo, then a bright core: added together ('lighter'), crowds glow.
    ctx.fillStyle = 'rgba(255, 170, 70, ' + (0.12 * twinkle) + ')';
    ctx.beginPath(); ctx.arc(f.x, f.y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 236, 170, ' + (0.85 * twinkle) + ')';
    ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
`;

/** Finish: time displacement — a comet on a figure of eight and a sweeping bar, moving with the clock (so renders move too). */
export const SKETCH_ORBIT = `// Everything here moves with s.time, so a render of it moves the same way.
const params = {
  speed: { value: 1, min: 0, max: 3, step: 0.01, label: 'Speed' },
  size: { value: 0.07, min: 0.02, max: 0.2, step: 0.005, label: 'Size' },
};

function draw(s) {
  const { ctx, width: W, height: H, time, params } = s;
  const t = time * params.speed;
  // A bar sweeping left to right and back.
  const bx = (0.5 + 0.42 * Math.sin(t * 0.9)) * W;
  ctx.fillStyle = 'rgba(120, 220, 255, 0.9)';
  ctx.fillRect(bx - H * 0.012, H * 0.1, H * 0.024, H * 0.8);
  // A comet on a figure of eight.
  const x = W / 2 + Math.sin(t * 1.3) * W * 0.32, y = H / 2 + Math.sin(t * 2.6) * H * 0.22;
  const r = params.size * H;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,200,120,0.9)');
  g.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
`;

/**
 * The halation test scene (Finish: halation): a grey ramp, paper white, a
 * saturated teal patch and a row of small lamps, on a dark wall.
 */
export const SKETCH_HALATION = `// A test scene for film halation. The picture is 8-bit, so "brighter than
// white" can only show as "clipped at 1.0": the lamps clip, the paper doesn't
// (it still bleeds a thin red rim: it is over the threshold, just not over white).
const params = {
  paper: { value: 0.9, min: 0.5, max: 1, step: 0.01, label: 'Paper white' },
  lamps: { value: 1, min: 0, max: 1, step: 0.01, label: 'Lamps' },
};

function draw(s) {
  const { ctx, width: W, height: H, time, params } = s;
  const u = H / 100; // one unit: 1% of the height
  ctx.fillStyle = '#16161b';
  ctx.fillRect(0, 0, W, H);
  const label = (text, x, y) => { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = (2.6 * u) + 'px system-ui, sans-serif'; ctx.fillText(text, x, y); };
  // A grey ramp from black to white: the red bleed fades in from about two thirds along (0.70 on screen).
  const g = ctx.createLinearGradient(8 * u, 0, W - 8 * u, 0);
  g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  ctx.fillStyle = g;
  ctx.fillRect(8 * u, 82 * u, W - 16 * u, 8 * u);
  label('grey ramp 0 to 1', 8 * u, 79 * u);
  // Paper white: a big white card, exposed as a camera would (below clipping).
  const p = Math.round(params.paper * 255);
  ctx.fillStyle = 'rgb(' + p + ',' + p + ',' + p + ')';
  ctx.fillRect(8 * u, 16 * u, 30 * u, 40 * u);
  label('paper ' + params.paper.toFixed(2), 8 * u, 12 * u);
  // A saturated teal patch: no red in it, so no red halo.
  ctx.fillStyle = 'rgb(0,170,160)';
  ctx.fillRect(46 * u, 16 * u, 26 * u, 40 * u);
  label('teal', 46 * u, 12 * u);
  // Small lamps: clipped cores with a soft falloff, like bulbs in a photo.
  const left = 84 * u, right = W - 12 * u;
  for (let i = 0; i < 5; i++) {
    const x = left + (right - left) * (i / 4), y = 36 * u + Math.sin(time * 0.7 + i) * 8 * u;
    const r = (0.8 + 0.35 * i) * u;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    halo.addColorStop(0, 'rgba(255,255,255,' + params.lamps + ')');
    halo.addColorStop(0.33, 'rgba(255,250,240,' + params.lamps + ')');
    halo.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
  }
  label('lamps (clipped)', left - 3 * u, 12 * u);
}
`;

/** The map for the Displacement Map text example: waves of red and alpha (see its own comment). */
export const SKETCH_DISPLACE_WAVES = `// The displacement map for the Title, drawn hidden (its eye is off; the
// Title's Displace reads it anyway, like a matte). Two sets of waves run
// down the picture in rows:
//   red   moves the Title sideways  (its Displace: Horizontal = Red)
//   alpha moves it up and down      (its Displace: Vertical = Alpha)
// Mid-grey red (128) and half alpha leave a row where it is.
const params = {
  waves: { value: 5, min: 1, max: 20, step: 0.5, label: 'Waves' },
  speed: { value: 0.35, min: 0, max: 2, step: 0.01, label: 'Speed' },
};

function draw(s) {
  const { ctx, width, height, time, params } = s;
  // Every row is one colour, so the rows are one vertical gradient with a stop
  // per row, filled once: the same picture as a fillRect per row, without the
  // hundreds of fills a frame.
  const g = ctx.createLinearGradient(0, 0, 0, height);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    const red = 0.5 + 0.5 * Math.sin((v * params.waves + time * params.speed) * Math.PI * 2);
    const alpha = 0.5 + 0.45 * Math.sin((v * params.waves * 0.5 - time * params.speed * 0.7) * Math.PI * 2);
    g.addColorStop((y + 0.5) / height, 'rgba(' + Math.round(red * 255) + ', 128, 128, ' + alpha.toFixed(3) + ')');
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}`;
