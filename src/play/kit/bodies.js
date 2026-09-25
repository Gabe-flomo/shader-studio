/**
 * bodies.js — things that fall and pile up (part of the layer kit, see kit.js).
 *
 * Every body is a circle for collisions (letters and boxes too, which keeps
 * stacking stable and cheap). Positions are in picture heights, x scaled by
 * the aspect, so collisions are round on any canvas. Top-level names start
 * with `bd`.
 */
import { paletteCssAt } from '../particle-sim.js';
import { klFontFor, klCss, KL_BLEND } from './layers.js';
import { geoFieldAt } from './geometry.js';

/** Bodies for a layer: one per letter (spaces skipped), or `count` circles or boxes. */
export function bdCreate(l, aspect, sizeH, rand) {
  const glyphs = l.source === 'letters' ? Array.from(String(l.text || 'PLAY')).filter(c => c.trim()) : null;
  const n = glyphs ? Math.min(400, glyphs.length) : Math.max(1, l.count | 0);
  const bodies = [];
  for (let i = 0; i < n; i++) bodies.push({ x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, r: 0, glyph: glyphs ? glyphs[i] : '', k: i / Math.max(1, n - 1) });
  const st = { bodies, frozen: false };
  bdDrop(st, l, aspect, sizeH, rand);
  return st;
}

/** Put every body back above the top (spread across), to fall in again. */
export function bdDrop(st, l, aspect, sizeH, rand) {
  const n = st.bodies.length;
  st.bodies.forEach((b, i) => {
    b.r = sizeH * (l.source === 'letters' ? 0.36 : 0.5);
    const row = Math.floor(i / 12);
    b.x = (0.08 + 0.84 * (l.source === 'letters' ? (i + 0.5) / n : rand())) * aspect;
    b.y = 1 + b.r + row * b.r * 2.2 + rand() * 0.05;
    b.vx = (rand() - 0.5) * 0.1; b.vy = 0; b.a = (rand() - 0.5) * 0.6; b.va = 0;
  });
}

export function bdScatter(st, strength, rand) {
  for (const b of st.bodies) { const a = rand() * Math.PI * 2, k = 1.2 * (strength || 1) * (0.4 + rand()); b.vx += Math.cos(a) * k; b.vy += Math.sin(a) * k + 0.6; b.va += (rand() - 0.5) * 8; }
}

/**
 * Advance the bodies. `zones` are compiled walls (geometry.js); `solid` is a
 * distance field of the bright parts of the picture, or null.
 */
export function bdStep(st, l, v, dt, aspect, sizeH, zones, solid) {
  if (st.frozen) return;
  const bodies = st.bodies, n = bodies.length;
  const g = v('gravity') * 1.6, ang = (v('angle') * Math.PI) / 180;
  const gx = -Math.sin(ang) * g, gy = -Math.cos(ang) * g;
  const bounce = v('bounce'), fric = v('friction');
  const r0 = sizeH * (l.source === 'letters' ? 0.36 : 0.5);
  // Enough substeps that nothing moves more than half its radius in one: fast letters can't tunnel through thin walls.
  const step = Math.min(0.05, dt);
  let vmax = 0;
  for (const b of bodies) vmax = Math.max(vmax, Math.hypot(b.vx, b.vy));
  vmax += Math.abs(g) * step;
  const SUB = Math.max(3, Math.min(24, Math.ceil((vmax * step) / Math.max(1e-4, r0 * 0.5)))), h = step / SUB;
  for (let s = 0; s < SUB; s++) {
    for (const b of bodies) {
      b.r = r0;
      b.vx += gx * h; b.vy += gy * h;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 4) { b.vx *= 4 / sp; b.vy *= 4 / sp; }
      b.x += b.vx * h; b.y += b.vy * h; b.a += b.va * h;
      b.va *= Math.exp(-h * 1.5);
      // Picture edges: floor, walls and a ceiling well above the top (so drops can fall in).
      const contact = (nx, ny) => {
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + bounce) * vn * nx; b.vy -= (1 + bounce) * vn * ny; }
        const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
        b.vx -= tx * vt * fric * 0.2; b.vy -= ty * vt * fric * 0.2;
        b.va = b.va * 0.8 + (-vt / Math.max(1e-3, b.r)) * 0.2;
      };
      if (b.x < b.r) { b.x = b.r; contact(1, 0); }
      if (b.x > aspect - b.r) { b.x = aspect - b.r; contact(-1, 0); }
      if (b.y < b.r) { b.y = b.r; contact(0, 1); }
      if (b.y > 3) { b.y = 3; contact(0, -1); }
      for (const z of zones) {
        if (z.action !== 'wall' && z.action !== 'container') continue;
        const px = b.x / aspect;
        let d = z.dist(px, b.y);
        if (z.action === 'container') d = -d;
        d -= b.r;
        if (d < 0) {
          const nn = z.normal(px, b.y), sgn = z.action === 'container' ? -1 : 1;
          b.x -= nn[0] * sgn * d; b.y -= nn[1] * sgn * d;
          contact(nn[0] * sgn, nn[1] * sgn);
        }
      }
      if (solid) {
        const px = b.x / aspect, d = geoFieldAt(solid, px, b.y) - b.r;
        if (d < 0) {
          const e = 0.004, nx = geoFieldAt(solid, px + e / aspect, b.y) - geoFieldAt(solid, px - e / aspect, b.y), ny = geoFieldAt(solid, px, b.y + e) - geoFieldAt(solid, px, b.y - e);
          const m = Math.hypot(nx, ny) || 1;
          b.x -= (nx / m) * d; b.y -= (ny / m) * d;
          contact(nx / m, ny / m);
        }
      }
    }
    // Body against body: push apart and trade velocity along the contact.
    const cell = r0 * 2.2, cols = Math.max(1, Math.ceil(aspect / cell) + 1), rows = Math.max(1, Math.ceil(3.2 / cell) + 1);
    const head = new Int32Array(cols * rows).fill(-1), next = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const b = bodies[i], cx = Math.max(0, Math.min(cols - 1, Math.floor(b.x / cell))), cy = Math.max(0, Math.min(rows - 1, Math.floor(b.y / cell)));
      next[i] = head[cy * cols + cx]; head[cy * cols + cx] = i;
    }
    for (let i = 0; i < n; i++) {
      const a = bodies[i], cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx2 = cx + ox, gy2 = cy + oy;
        if (gx2 < 0 || gy2 < 0 || gx2 >= cols || gy2 >= rows) continue;
        for (let j = head[gy2 * cols + gx2]; j >= 0; j = next[j]) {
          if (j <= i) continue;
          const b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), minD = a.r + b.r;
          if (d >= minD || d < 1e-6) continue;
          const nx = dx / d, ny = dy / d, push = (minD - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const imp = -(1 + bounce) * rv / 2;
            a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
            const tx = -ny, ty = nx, vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
            a.va += vt / Math.max(1e-3, a.r) * 0.05; b.va -= vt / Math.max(1e-3, b.r) * 0.05;
          }
        }
      }
    }
  }
}

export function bdDraw(ctx, st, l, v, W, H, dpr, aspect) {
  const size = v('size') * dpr;
  ctx.globalAlpha = v('opacity');
  ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 ' + size + 'px ' + klFontFor(l);
  const fixed = klCss(l.color);
  for (const b of st.bodies) {
    const px = (b.x / aspect) * W, py = (1 - b.y) * H;
    if (py < -size * 2) continue;
    ctx.fillStyle = l.colour === 'palette' ? paletteCssAt(l.palette, b.k) : fixed;
    ctx.setTransform(1, 0, 0, 1, px, py);
    ctx.rotate(-b.a);
    if (l.source === 'letters') ctx.fillText(b.glyph, 0, size * 0.04);
    else if (l.source === 'boxes') { const s = size * 0.9; ctx.fillRect(-s / 2, -s / 2, s, s); }
    else { ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
