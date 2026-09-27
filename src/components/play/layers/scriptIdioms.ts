/**
 * Idioms for the Script editor's Patterns tab: the well-known p5 and canvas
 * moves, grouped by what you want to do (add a shape, react to the beat,
 * follow the mouse…). Each is a pattern like those in scriptSnippets.ts:
 * where it goes, the code, and a sketch that shows it used. Its settings are
 * plain `let name = number;` lines at the top of the snippet, so they land at
 * the top of the sketch and Make a slider turns them into controls.
 *
 * An idiom without an `example` is shown in `base` (a bare draw by default):
 * placed exactly as Insert would place it, so the example is always the
 * pattern as inserted.
 */
import type { ScriptSnippet } from './scriptSnippets';

export interface ScriptIdiom extends Omit<ScriptSnippet, 'example'> {
  /** A whole sketch with the idiom in use; when absent, the idiom placed into `base`. */
  example?: string;
  /** The sketch the idiom is placed into for its example (default: a draw that clears to dark grey). */
  base?: string;
}

export const IDIOM_BASE = 'function draw(s) {\n  background(12);\n}\n';

export const SCRIPT_IDIOMS: ScriptIdiom[] = [
  // ── Add a shape ────────────────────────────────────────────────────────────
  { group: 'Add a shape', name: 'Rounded box', where: 'draw', doc: 'A box of a width, height, corner radius and turn (degrees), centred on the picture.',
    code: `let boxW = 160, boxH = 90, corner = 16, turn = 30;
push();
translate(width / 2, height / 2);
rotate(radians(turn));
noStroke(); fill(255, 200, 80);
rect(-boxW / 2, -boxH / 2, boxW, boxH, corner);
pop();
` },
  { group: 'Add a shape', name: 'Ring', where: 'draw', doc: 'A circle outline of an outer radius and a thickness: a thick stroke, no fill.',
    code: `let outerR = 90, thickness = 20;
noFill(); stroke(120, 200, 255); strokeWeight(thickness);
circle(width / 2, height / 2, Math.max(0, outerR - thickness / 2) * 2);
` },
  { group: 'Add a shape', name: 'Pie slice', where: 'draw', doc: 'A wedge from a start angle through a sweep (degrees, 0 at the top, clockwise), built from vertices.',
    code: `let pieR = 80, startDeg = 45, sweepDeg = 270;
noStroke(); fill(255, 120, 80);
beginShape();
vertex(width / 2, height / 2);
for (let k = 0; k <= 48; k++) {
  const a = radians(startDeg + (sweepDeg * k) / 48) - HALF_PI;
  vertex(width / 2 + Math.cos(a) * pieR, height / 2 + Math.sin(a) * pieR);
}
endShape(true);
` },
  { group: 'Add a shape', name: 'Dashed line', where: 'draw', doc: 'setLineDash on the canvas: dash and gap lengths, and an offset that makes the dashes march.',
    code: `let dash = 12, dashGap = 8;
stroke(255); strokeWeight(3);
s.ctx.setLineDash([dash, dashGap]);
s.ctx.lineDashOffset = -s.time * 30;
line(40, height / 2, width - 40, height / 2);
s.ctx.setLineDash([]);
` },
  { group: 'Add a shape', name: 'Soft glow', where: 'draw', doc: 'A radial gradient from a colour to transparent: a light, a halo, a soft brush. Follows the mouse here.',
    code: `let glowSize = 80;
const glow = s.ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, Math.max(1, glowSize));
glow.addColorStop(0, 'rgba(255, 200, 120, 0.9)');
glow.addColorStop(1, 'rgba(255, 200, 120, 0)');
s.ctx.fillStyle = glow;
s.ctx.fillRect(mouseX - glowSize, mouseY - glowSize, glowSize * 2, glowSize * 2);
` },
  { group: 'Add a shape', name: 'Bezier curve', where: 'draw', doc: 'A cubic curve from corner to corner with two control points; bend pulls them apart.',
    code: `let bend = 120;
s.ctx.beginPath();
s.ctx.moveTo(40, height - 40);
s.ctx.bezierCurveTo(width * 0.33, height - 40 - bend, width * 0.66, 40 + bend, width - 40, 40);
s.ctx.strokeStyle = 'white'; s.ctx.lineWidth = 3;
s.ctx.stroke();
` },

  // ── Follow the mouse ───────────────────────────────────────────────────────
  { group: 'Follow the mouse', name: 'Point at the mouse', where: 'draw', doc: 'atan2 gives the angle from a point to the mouse; rotate by it to aim an arrow, an eye, a turret.',
    code: `let arrowLen = 60;
const aim = Math.atan2(mouseY - height / 2, mouseX - width / 2);
push();
translate(width / 2, height / 2);
rotate(aim);
stroke(255); strokeWeight(4); line(0, 0, arrowLen, 0);
noStroke(); fill(255); triangle(arrowLen + 12, 0, arrowLen, -8, arrowLen, 8);
pop();
` },
  { group: 'Follow the mouse', name: 'Mouse speed', where: 'draw', doc: 'How fast the mouse moves, in pixels a second, smoothed. Bigger when you flick it.',
    code: `let smoothing = 0.2;
const ms = s.state.mouseSpeed ||= { x: mouseX, y: mouseY, v: 0 };
const moved = dist(ms.x, ms.y, mouseX, mouseY) / Math.max(s.dt, 0.001);
ms.v = lerp(ms.v, moved, smoothing); ms.x = mouseX; ms.y = mouseY;
noStroke(); fill(255, 140, 90);
circle(mouseX, mouseY, 10 + Math.min(200, ms.v * 0.1));
` },
  { group: 'Follow the mouse', name: 'Drag a thing', where: 'draw', doc: 'Grab an object when the press starts on it, move it with the mouse, let go on release.',
    code: `let grabR = 40;
const grab = s.state.grab ||= { x: width / 2, y: height / 2, held: false };
if (s.mouse.down && !grab.held && dist(mouseX, mouseY, grab.x, grab.y) < grabR) grab.held = true;
if (!s.mouse.down) grab.held = false;
if (grab.held) { grab.x = mouseX; grab.y = mouseY; }
noStroke(); fill(grab.held ? 255 : 190);
circle(grab.x, grab.y, grabR * 2);
` },
  { group: 'Follow the mouse', name: 'Push away from the mouse', where: 'draw', doc: 'A grid of dots that move out of the mouse’s way within a reach, more the closer they are.',
    code: `let reach = 120, shove = 40;
noStroke(); fill(255);
for (let ry = 15; ry < height; ry += 30) for (let rx = 15; rx < width; rx += 30) {
  const dx = rx - mouseX, dy = ry - mouseY, d = Math.hypot(dx, dy) || 1;
  const k = s.mouse.over ? Math.max(0, 1 - d / Math.max(1, reach)) : 0;
  circle(rx + (dx / d) * k * shove, ry + (dy / d) * k * shove, 6);
}
` },

  // ── React to the beat ──────────────────────────────────────────────────────
  { group: 'React to the beat', name: 'Pulse on a beat', where: 'draw', doc: 'A Beat button: map a beat, a key or a note onto it in Play, and each press kicks a value that decays.',
    code: `const params = {
  beat: { kind: 'button', label: 'Beat' },
};
let decay = 4;
if (s.pressed('beat')) s.state.pulse = 1;
s.state.pulse = (s.state.pulse || 0) * Math.exp(-decay * s.dt);
noStroke(); fill(255, 120, 80);
circle(width / 2, height / 2, 40 + s.state.pulse * height * 0.6);
`,
    example: `const params = {
  beat: { kind: 'button', label: 'Beat' },
};
let decay = 4;

function draw(s) {
  background(12);
  // Here a click presses it too; in Play, map a beat onto the Beat button.
  if (s.pressed('beat') || (s.mouse.down && !s.state.wasDown)) s.state.pulse = 1;
  s.state.wasDown = s.mouse.down;
  s.state.pulse = (s.state.pulse || 0) * Math.exp(-decay * s.dt);
  noStroke(); fill(255, 120, 80);
  circle(width / 2, height / 2, 40 + s.state.pulse * height * 0.6);
  fill(255); textSize(14); text('click to pulse', 12, 22);
}
` },
  { group: 'React to the beat', name: 'Tempo clock', where: 'draw', doc: 'Beats from a tempo: which beat of the bar it is, and how far through the beat (0–1) for things that fall each beat.',
    code: `let bpm = 120;
const beats = (s.time * bpm) / 60, beatNow = Math.floor(beats), phase = beats - beatNow;
noStroke();
for (let k = 0; k < 4; k++) { fill(k === beatNow % 4 ? 255 : 60); rect(width / 2 - 110 + k * 60, height / 2 - 40, 40, 40, 6); }
fill(255, 120, 80);
circle(width / 2, height / 2 + 40, 30 * (1 - phase));
` },
  { group: 'React to the beat', name: 'Follow a level', where: 'draw', doc: 'Make level a slider, then map an audio band (bass, say) onto it in Play; smooth takes the jitter out.',
    code: `let level = 0.5, smooth = 0.15;
s.state.level = lerp(s.state.level ?? level, level, smooth);
noStroke(); fill(120, 200, 255);
rect(width / 2 - 20, height - 20 - s.state.level * (height - 40), 40, s.state.level * (height - 40), 6);
`,
    example: `let level = 0.5;
let smooth = 0.15;

function draw(s) {
  background(12);
  // Here the mouse's height stands in for a mapped audio band.
  level = s.mouse.over ? 1 - mouseY / height : 0.5 + 0.4 * Math.sin(s.time * 3);
  s.state.level = lerp(s.state.level ?? level, level, smooth);
  noStroke(); fill(120, 200, 255);
  rect(width / 2 - 20, height - 20 - s.state.level * (height - 40), 40, s.state.level * (height - 40), 6);
}
` },
  { group: 'React to the beat', name: 'Step on each beat', where: 'draw', doc: 'A Step button that moves through a sequence (four places and colours here) one press at a time.',
    code: `const params = {
  step: { kind: 'button', label: 'Step' },
};
if (s.pressed('step')) s.state.stepAt = ((s.state.stepAt || 0) + 1) % 4;
const stepAt = s.state.stepAt || 0;
noStroke(); fill(hsl(stepAt * 90, 80, 60));
circle((width * (stepAt + 0.5)) / 4, height / 2, 60);
`,
    example: `const params = {
  step: { kind: 'button', label: 'Step' },
};

function draw(s) {
  background(12);
  // Here a click steps too; in Play, map a beat onto the Step button.
  if (s.pressed('step') || (s.mouse.down && !s.state.wasDown)) s.state.stepAt = ((s.state.stepAt || 0) + 1) % 4;
  s.state.wasDown = s.mouse.down;
  const stepAt = s.state.stepAt || 0;
  noStroke(); fill(hsl(stepAt * 90, 80, 60));
  circle((width * (stepAt + 0.5)) / 4, height / 2, 60);
  fill(255); textSize(14); text('click to step', 12, 22);
}
` },

  // ── Trails and fades ───────────────────────────────────────────────────────
  { group: 'Trails and fades', name: 'Keep a history', where: 'draw', doc: 'The last N positions in an array, drawn older-to-newer, fading: a trail that works with Clear on.',
    code: `let trailLength = 40;
const hist = s.state.hist ||= [];
hist.push({ x: mouseX, y: mouseY });
while (hist.length > Math.max(1, trailLength)) hist.shift();
noStroke();
hist.forEach((h, k) => { const t = (k + 1) / hist.length; fill(255, 200, 80, 255 * t); circle(h.x, h.y, 4 + 20 * t); });
` },
  { group: 'Trails and fades', name: 'Fade to a colour', where: 'draw', doc: 'With Clear off, cover the picture with a see-through dark colour each frame: old strokes sink into it.',
    settings: { clear: false },
    code: `let fadeAmt = 0.08;
noStroke(); fill(12, 12, 20, 255 * fadeAmt);
rect(0, 0, width, height);
`,
    example: `let fadeAmt = 0.08;

function draw(s) {
  noStroke(); fill(12, 12, 20, 255 * fadeAmt);
  rect(0, 0, width, height);
  fill(120, 200, 255);
  circle(width / 2 + Math.cos(s.time * 2) * width * 0.35, height / 2 + Math.sin(s.time * 3) * height * 0.35, 24);
}
` },
  { group: 'Trails and fades', name: 'Zoom echo', where: 'draw', doc: 'With Clear off, redraw last frame a little bigger and turned, a little fainter: a feedback tunnel. Put it first in draw.',
    settings: { clear: false },
    code: `let zoom = 1.02, spin = 0.01;
s.ctx.save();
s.ctx.globalCompositeOperation = 'copy';
s.ctx.globalAlpha = 0.92;
s.ctx.translate(width / 2, height / 2); s.ctx.rotate(spin); s.ctx.scale(zoom, zoom); s.ctx.translate(-width / 2, -height / 2);
s.ctx.drawImage(s.ctx.canvas, 0, 0);
s.ctx.restore();
`,
    example: `let zoom = 1.02;
let spin = 0.01;

function draw(s) {
  s.ctx.save();
  s.ctx.globalCompositeOperation = 'copy';
  s.ctx.globalAlpha = 0.92;
  s.ctx.translate(width / 2, height / 2); s.ctx.rotate(spin); s.ctx.scale(zoom, zoom); s.ctx.translate(-width / 2, -height / 2);
  s.ctx.drawImage(s.ctx.canvas, 0, 0);
  s.ctx.restore();
  noStroke(); fill(hsl((s.time * 60) % 360, 80, 60));
  circle(width / 2 + Math.cos(s.time * 3) * 30, height / 2 + Math.sin(s.time * 3) * 30, 14);
}
` },

  // ── Grids and tiling ───────────────────────────────────────────────────────
  { group: 'Grids and tiling', name: 'Truchet tiles', where: 'draw', doc: 'Each square gets one of two quarter-circle tiles, chosen by noise, and the arcs join into winding paths.',
    code: `let tile = 40;
const tsz = Math.max(8, tile);
noFill(); stroke(255); strokeWeight(3);
for (let ty = 0; ty < height; ty += tsz) for (let tx = 0; tx < width; tx += tsz) {
  if (noise(tx * 0.37, ty * 0.37) > 0.5) { arc(tx, ty, tsz, tsz, 0, HALF_PI); arc(tx + tsz, ty + tsz, tsz, tsz, PI, PI + HALF_PI); }
  else { arc(tx + tsz, ty, tsz, tsz, HALF_PI, PI); arc(tx, ty + tsz, tsz, tsz, PI + HALF_PI, TWO_PI); }
}
` },
  { group: 'Grids and tiling', name: 'Checkerboard', where: 'draw', doc: 'Alternate squares by (column + row) % 2, the picture’s height split into a number of rows.',
    code: `let squares = 8;
const sq = height / Math.max(1, Math.round(squares));
noStroke();
for (let row = 0; row * sq < height; row++) for (let col = 0; col * sq < width; col++) {
  fill((row + col) % 2 ? 235 : 30);
  rect(col * sq, row * sq, sq + 0.5, sq + 0.5);
}
` },
  { group: 'Grids and tiling', name: 'Hex grid', where: 'draw', doc: 'Hexagons in offset rows: every other row shifts half a cell, rows are 1.5 radii apart.',
    code: `let hexR = 24;
const hr = Math.max(6, hexR), hw = Math.sqrt(3) * hr;
noFill(); stroke(255, 255, 255, 140); strokeWeight(1.5);
for (let row = 0; row * hr * 1.5 < height + hr; row++) for (let col = -1; col * hw < width + hw; col++) {
  const hx = col * hw + ((row % 2) * hw) / 2, hy = row * hr * 1.5;
  beginShape();
  for (let k = 0; k < 6; k++) { const a = PI / 6 + (k * PI) / 3; vertex(hx + Math.cos(a) * hr, hy + Math.sin(a) * hr); }
  endShape(true);
}
` },
  { group: 'Grids and tiling', name: 'Ripple from the mouse', where: 'draw', doc: 'A grid whose dots swell in waves spreading out from the mouse: size from a sine of the distance minus time.',
    code: `let spacing = 30, rippleSpeed = 4;
const cellGap = Math.max(6, spacing);
noStroke(); fill(255);
for (let gy = cellGap / 2; gy < height; gy += cellGap) for (let gx = cellGap / 2; gx < width; gx += cellGap) {
  const md = dist(gx, gy, mouseX, mouseY);
  circle(gx, gy, cellGap * 0.4 * (1 + 0.6 * Math.sin(md * 0.05 - s.time * rippleSpeed)));
}
` },

  // ── Noise motion ───────────────────────────────────────────────────────────
  { group: 'Noise motion', name: 'Wandering point', where: 'draw', doc: 'Noise over time for x and y (different offsets): smooth, aimless motion that never repeats.',
    code: `let wander = 0.3;
const wx = map(noise(s.time * wander, 0), 0.2, 0.8, 0, width, true);
const wy = map(noise(0, s.time * wander + 100), 0.2, 0.8, 0, height, true);
noStroke(); fill(255, 200, 80);
circle(wx, wy, 24);
` },
  { group: 'Noise motion', name: 'Noise wave', where: 'draw', doc: 'A line across the picture whose height is noise along x, drifting with time: hills, a horizon, a signal.',
    code: `let amplitude = 60, detail = 0.01;
noFill(); stroke(255); strokeWeight(2);
beginShape();
for (let x = 0; x <= width; x += 4) vertex(x, height / 2 + (noise(x * detail, s.time * 0.5) - 0.5) * 2 * amplitude);
endShape();
` },
  { group: 'Noise motion', name: 'Wobbly blob', where: 'draw', doc: 'A circle whose radius is noise read around a loop, so the outline wobbles and still closes.',
    code: `let blobR = 80, wobble = 30;
noStroke(); fill(120, 200, 255);
beginShape();
for (let k = 0; k <= 60; k++) {
  const a = (k / 60) * TWO_PI;
  const r = blobR + (noise(Math.cos(a) + 1, Math.sin(a) + 1, s.time * 0.5) - 0.5) * 2 * wobble;
  vertex(width / 2 + Math.cos(a) * r, height / 2 + Math.sin(a) * r);
}
endShape(true);
` },
  { group: 'Noise motion', name: 'Drifting dots', where: 'draw', doc: 'Many dots, each reading noise at its own offset, so they drift independently without any state.',
    code: `let drift = 0.2;
noStroke(); fill(255);
for (let i = 0; i < 40; i++) {
  const nx = map(noise(i * 7.1, s.time * drift), 0.2, 0.8, 0, width), ny = map(noise(i * 3.3 + 50, s.time * drift), 0.2, 0.8, 0, height);
  circle(nx, ny, 8);
}
` },

  // ── Motion paths ───────────────────────────────────────────────────────────
  { group: 'Motion paths', name: 'Lissajous', where: 'draw', doc: 'Sine on x and y at two frequencies: loops, figure-eights and knots. Whole numbers close the curve.',
    code: `let freqX = 3, freqY = 2;
noFill(); stroke(255, 255, 255, 50);
beginShape();
for (let k = 0; k <= 200; k++) { const t = (k / 200) * TWO_PI; vertex(width / 2 + Math.sin(t * freqX) * width * 0.4, height / 2 + Math.sin(t * freqY + HALF_PI) * height * 0.4); }
endShape();
const lt = s.time * 0.5;
noStroke(); fill(255, 200, 80);
circle(width / 2 + Math.sin(lt * freqX) * width * 0.4, height / 2 + Math.sin(lt * freqY + HALF_PI) * height * 0.4, 18);
` },
  { group: 'Motion paths', name: 'Back and forth, eased', where: 'draw', doc: 'A triangle wave over a period, eased with smoothstep so it slows at each end.',
    code: `let period = 2;
const pp = (s.time % Math.max(0.1, period)) / Math.max(0.1, period), tri = pp < 0.5 ? pp * 2 : 2 - pp * 2;
const eased = tri * tri * (3 - 2 * tri);
noStroke(); fill(120, 200, 255);
circle(lerp(40, width - 40, eased), height / 2, 30);
` },

  // ── Physics-lite ───────────────────────────────────────────────────────────
  { group: 'Physics-lite', name: 'Gravity and a floor', where: 'draw', doc: 'Balls that fall, bounce off the floor losing some speed each time, and bounce off the sides.',
    code: `let gravity = 900, bounciness = 0.7;
const fallers = s.state.fallers ||= Array.from({ length: 12 }, () => ({ x: random(20, width - 20), y: random(height / 2), vx: random(-100, 100), vy: 0 }));
noStroke(); fill(255, 200, 80);
for (const b of fallers) {
  b.vy += gravity * s.dt; b.x += b.vx * s.dt; b.y += b.vy * s.dt;
  if (b.y > height - 10) { b.y = height - 10; b.vy *= -bounciness; }
  if (b.x < 10 || b.x > width - 10) { b.vx *= -1; b.x = constrain(b.x, 10, width - 10); }
  circle(b.x, b.y, 20);
}
` },
  { group: 'Physics-lite', name: 'Pendulum', where: 'draw', doc: 'An angle and its speed: gravity pulls it back by the sine of the angle, damping slows it.',
    code: `let ropeLen = 150, swingDamp = 0.2;
const pend = s.state.pend ||= { a: 1.2, v: 0 };
pend.v += (-588 / Math.max(10, ropeLen)) * Math.sin(pend.a) * s.dt;
pend.v *= Math.exp(-swingDamp * s.dt);
pend.a += pend.v * s.dt;
const pivotX = width / 2, pivotY = 20, bobX = pivotX + Math.sin(pend.a) * ropeLen, bobY = pivotY + Math.cos(pend.a) * ropeLen;
stroke(255); strokeWeight(2); line(pivotX, pivotY, bobX, bobY);
noStroke(); fill(255, 140, 90); circle(bobX, bobY, 30);
` },
  { group: 'Physics-lite', name: 'Rope (Verlet)', where: 'draw', doc: 'Points that remember where they were (Verlet), then a few passes that pull neighbours back to a set distance. The first point follows the mouse.',
    code: `let links = 20, linkLen = 12;
const rope = s.state.rope ||= Array.from({ length: 100 }, () => ({ x: mouseX, y: mouseY, px: mouseX, py: mouseY }));
const ropeN = Math.max(2, Math.min(rope.length, Math.floor(links)));
rope[0].x = mouseX; rope[0].y = mouseY;
for (let i = 1; i < ropeN; i++) {
  const k = rope[i], vx = (k.x - k.px) * 0.98, vy = (k.y - k.py) * 0.98;
  k.px = k.x; k.py = k.y; k.x += vx; k.y += vy + 400 * s.dt * s.dt;
}
for (let pass = 0; pass < 4; pass++) for (let i = 1; i < ropeN; i++) {
  const a = rope[i - 1], b = rope[i], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - linkLen) / d;
  if (i > 1) { a.x += dx * f * 0.5; a.y += dy * f * 0.5; b.x -= dx * f * 0.5; b.y -= dy * f * 0.5; } else { b.x -= dx * f; b.y -= dy * f; }
}
noFill(); stroke(255); strokeWeight(3);
beginShape();
for (let i = 0; i < ropeN; i++) vertex(rope[i].x, rope[i].y);
endShape();
` },
  { group: 'Physics-lite', name: 'Pull toward a centre', where: 'draw', doc: 'Gravity toward the middle, weaker with distance squared: the dots fall in and swing round in orbits.',
    code: `let pull = 50;
const orbs = s.state.orbs ||= Array.from({ length: 60 }, () => ({ x: random(width), y: random(height), vx: random(-80, 80), vy: random(-80, 80) }));
noStroke(); fill(160, 220, 255);
for (const o of orbs) {
  const dx = width / 2 - o.x, dy = height / 2 - o.y, d2 = dx * dx + dy * dy + 400, d = Math.sqrt(d2), acc = (pull * 20000) / d2;
  o.vx += (dx / d) * acc * s.dt; o.vy += (dy / d) * acc * s.dt;
  o.x += o.vx * s.dt; o.y += o.vy * s.dt;
  circle(o.x, o.y, 5);
}
` },

  // ── Text ───────────────────────────────────────────────────────────────────
  { group: 'Text', name: 'Typewriter', where: 'draw', doc: 'Show a line a character at a time with a blinking cursor, then pause and start over.',
    code: `let charsPerSec = 12;
const typed = 'Hello from a sketch.';
const shown = typed.slice(0, Math.floor(s.time * charsPerSec) % (typed.length + 20));
fill(255); textSize(32); textAlign('left', 'middle');
text(shown + (Math.floor(s.time * 2) % 2 ? '_' : ''), 24, height / 2);
` },
  { group: 'Text', name: 'Text round a circle', where: 'draw', doc: 'One letter at a time: translate to its place on the circle, rotate to face along it, draw.',
    code: `let ringR = 100;
const ringText = 'AROUND AND AROUND · ';
fill(255); textSize(18); textAlign('center', 'middle');
for (let i = 0; i < ringText.length; i++) {
  const a = (i / ringText.length) * TWO_PI + s.time * 0.5;
  push(); translate(width / 2 + Math.cos(a) * ringR, height / 2 + Math.sin(a) * ringR); rotate(a + HALF_PI); text(ringText[i], 0, 0); pop();
}
` },
  { group: 'Text', name: 'Wavy letters', where: 'draw', doc: 'Letters placed one by one with measureText, each lifted by a sine that runs along the word.',
    code: `let waveAmp = 10;
const wavy = 'wavy words';
fill(255); textSize(36); textAlign('left', 'middle');
for (let i = 0, penX = 24; i < wavy.length; penX += s.ctx.measureText(wavy[i]).width, i++) {
  text(wavy[i], penX, height / 2 + Math.sin(s.time * 4 + i * 0.6) * waveAmp);
}
` },
  { group: 'Text', name: 'Fit text to the width', where: 'draw', doc: 'Measure at one size, then scale the size so the words span the picture less a margin.',
    code: `let margin = 40;
const title = 'FIT TO WIDTH';
s.ctx.font = '100px sans-serif';
const fitSize = (100 * Math.max(10, width - margin * 2)) / Math.max(1, s.ctx.measureText(title).width);
fill(255); textSize(fitSize); textAlign('center', 'middle');
text(title, width / 2, height / 2);
` },
  { group: 'Text', name: 'Label beside the mouse', where: 'draw', doc: 'A small readout next to a point: its coordinates, a value, a name.',
    code: `let labelSize = 13;
fill(255); textSize(labelSize); textAlign('left', 'bottom');
text(Math.round(mouseX) + ', ' + Math.round(mouseY), mouseX + 10, mouseY - 6);
` },

  // ── Colour palettes ────────────────────────────────────────────────────────
  { group: 'Colour palettes', name: 'Cosine palette', where: 'top', doc: 'Iñigo Quilez’s palette: a cosine per channel turns any number into a colour on a smooth loop. Shift slides along it.',
    code: `let palShift = 0;
function cosPalette(t) {
  const ch = d => Math.round(255 * (0.5 + 0.5 * Math.cos(TWO_PI * (t + d + palShift))));
  return color(ch(0), ch(0.33), ch(0.67));
}
`,
    base: `function draw(s) {
  background(12);
  noStroke();
  for (let i = 0; i < 24; i++) { fill(cosPalette(i / 24 + s.time * 0.1)); rect((i * width) / 24, 0, width / 24 + 1, height); }
}
` },
  { group: 'Colour palettes', name: 'Pick from a list', where: 'top', doc: 'A fixed palette as an array; pickColour(i) wraps any index (negative too) into it.',
    code: `const COLOURS = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];
function pickColour(i) { return COLOURS[((i % COLOURS.length) + COLOURS.length) % COLOURS.length]; }
`,
    base: `function draw(s) {
  background(12);
  noStroke();
  for (let i = 0; i < 10; i++) { fill(pickColour(i + Math.floor(s.time))); circle(((i + 0.5) * width) / 10, height / 2, width / 12); }
}
` },
  { group: 'Colour palettes', name: 'Blend two colours', where: 'draw', doc: 'lerpColor between two colours in a number of steps: a stepped gradient.',
    code: `let steps = 10;
noStroke();
for (let i = 0; i < steps; i++) {
  fill(lerpColor('rgb(40, 90, 220)', 'rgb(250, 120, 80)', i / Math.max(1, steps - 1)));
  rect((i * width) / steps, 0, width / steps + 1, height);
}
` },
  { group: 'Colour palettes', name: 'Hue that cycles', where: 'draw', doc: 'hsl with the hue turning over time, and its opposite (hue + 180) for the thing in front.',
    code: `let hueSpeed = 40;
const hue = (s.time * hueSpeed) % 360;
background(hsl(hue, 60, 20));
noStroke(); fill(hsl((hue + 180) % 360, 80, 60));
circle(width / 2, height / 2, height * 0.5);
` },

  // ── Read the picture ───────────────────────────────────────────────────────
  { group: 'Read the picture', name: 'Brightest spot', where: 'draw', doc: 'Scan the picture on a coarse grid and mark the brightest place: something to chase or aim at.',
    settings: { readPicture: true },
    code: `let scanStep = 16;
let brightest = { b: -1, x: width / 2, y: height / 2 };
for (let by = 0; by < height; by += Math.max(4, scanStep)) for (let bx = 0; bx < width; bx += Math.max(4, scanStep)) {
  const lum = s.picture.brightness(bx, by);
  if (lum > brightest.b) brightest = { b: lum, x: bx, y: by };
}
noFill(); stroke(255, 80, 80); strokeWeight(3);
circle(brightest.x, brightest.y, 40);
` },
  { group: 'Read the picture', name: 'Lines lifted by brightness', where: 'draw', doc: 'Horizontal lines that rise where the picture is bright: the classic scanline landscape.',
    settings: { readPicture: true },
    code: `let rowGap = 12, lift = 20;
noFill(); stroke(255); strokeWeight(1.5);
for (let ly = rowGap; ly < height; ly += Math.max(3, rowGap)) {
  beginShape();
  for (let lx = 0; lx <= width; lx += 6) vertex(lx, ly - s.picture.brightness(lx, ly) * lift);
  endShape();
}
` },
  { group: 'Read the picture', name: 'Climb toward the light', where: 'draw', doc: 'Walkers compare brightness either side of them and step toward the brighter side, with a little jitter.',
    settings: { readPicture: true },
    code: `let climb = 60;
const walkers = s.state.walkers ||= Array.from({ length: 80 }, () => ({ x: random(width), y: random(height) }));
const e = width / 48;
noStroke(); fill(255, 220, 120);
for (const w of walkers) {
  const gx = s.picture.brightness(w.x + e, w.y) - s.picture.brightness(w.x - e, w.y);
  const gy = s.picture.brightness(w.x, w.y + e) - s.picture.brightness(w.x, w.y - e);
  w.x = constrain(w.x + (gx * climb * 20 + random(-20, 20)) * s.dt, 0, width);
  w.y = constrain(w.y + (gy * climb * 20 + random(-20, 20)) * s.dt, 0, height);
  circle(w.x, w.y, 5);
}
` },
];
