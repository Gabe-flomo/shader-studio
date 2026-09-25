/**
 * layers.js — drawing for each layer kind (part of the layer kit, see kit.js).
 *
 * Plain JS shared by the app and web exports; every kit file shares one scope
 * when inlined, so top-level names here start with `kl` / `KL`. All functions
 * draw into a 2D context W × H device pixels; positions come in 0..1 with y
 * up and are flipped here.
 */
import { paletteCssAt, paletteColour } from '../particle-sim.js';

export const KL_BLEND = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', lighten: 'lighten', darken: 'darken',
  difference: 'difference', exclusion: 'exclusion', add: 'lighter',
};
export const KL_FONTS = { sans: 'Inter, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"JetBrains Mono", Menlo, Consolas, monospace' };

// ── Web fonts ────────────────────────────────────────────────────────────────
// A text layer's fontUrl can be a Google Fonts link (css2?family=…, a
// specimen page, a pasted <link> or @import), a bare family name, or a
// .woff2/.woff/.ttf/.otf file. Only those load: nothing else is fetched.

const klFontSeen = new Map();
let klFontGen = 0;

/** { family, css } for a Google Fonts source, { family, file } for a font file, or null. */
const klDecode = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };

export function klParseFontUrl(input) {
  let u = String(input || '').trim();
  if (!u) return null;
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(u) || /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(u);
  if (href) u = href[1];
  u = u.replace(/&amp;/g, '&');
  if (/^https:\/\/[^\s]+\.(woff2?|ttf|otf)(\?[^\s]*)?$/i.test(u)) {
    const name = klDecode(u.split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '')).replace(/[^\w -]/g, '');
    return { family: 'SS ' + (name || 'Font'), file: u };
  }
  const spec = /^https:\/\/fonts\.google\.com\/specimen\/([^/?#]+)/i.exec(u);
  if (spec) u = klDecode(spec[1].replace(/\+/g, ' '));
  if (/^https:\/\/fonts\.googleapis\.com\/css2?\?/i.test(u)) {
    const fam = /[?&]family=([^&:]+)/.exec(u);
    return fam ? { family: klDecode(fam[1].replace(/\+/g, ' ')).replace(/["\\]/g, ''), css: u } : null;
  }
  if (/^[A-Za-z0-9][A-Za-z0-9 ]{0,60}$/.test(u)) {
    return { family: u.replace(/\s+/g, ' '), css: 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(u.replace(/\s+/g, ' ')).replace(/%20/g, '+') + '&display=swap' };
  }
  return null;
}

/** Bumped whenever a web font finishes loading, so cached text redraws in it. */
export function klFontGeneration() { return klFontGen; }

/** The CSS font-family for a layer: its web font (loading it the first time) with Font as the fallback. */
export function klFontFor(l) {
  const base = KL_FONTS[l.font] || KL_FONTS.sans;
  const f = klParseFontUrl(l.fontUrl);
  if (!f) return base;
  if (!klFontSeen.has(f.family) && typeof document !== 'undefined') {
    klFontSeen.set(f.family, true);
    const done = () => { klFontGen++; };
    if (f.file && typeof FontFace !== 'undefined') {
      new FontFace(f.family, 'url(' + JSON.stringify(f.file) + ')').load().then(face => { document.fonts.add(face); done(); }).catch(() => {});
    } else if (f.css) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = f.css; link.crossOrigin = 'anonymous';
      link.onload = () => {
        // The stylesheet only declares the faces; ask for the weights text uses so they download now.
        if (document.fonts) Promise.all([400, 700, l.weight || 400].map(w => document.fonts.load(w + ' 32px "' + f.family + '"'))).then(done, done);
        else done();
      };
      document.head.appendChild(link);
    }
  }
  return '"' + f.family + '", ' + base;
}
const KL_TAU = Math.PI * 2;

export function klCss(c, a) {
  return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')';
}

/** A reusable offscreen canvas of at least W × H, keyed by name. */
export function klCanvas(pool, name, W, H) {
  let c = pool[name];
  if (!c) { c = document.createElement('canvas'); pool[name] = c; }
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}

// ── Null ─────────────────────────────────────────────────────────────────────

export function klDrawNull(ctx, l, x, y, size, dpr, W, H, zoneR) {
  const px = x * W, py = (1 - y) * H, r = size * dpr;
  if (zoneR > 0) {
    // Its particle role's zone: a dashed ring (outward ticks for an emitter, inward for an absorber).
    ctx.globalAlpha = 0.7; ctx.strokeStyle = l.color; ctx.lineWidth = 1.25 * dpr; ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.arc(px, py, zoneR, 0, KL_TAU); ctx.stroke(); ctx.setLineDash([]);
    if (l.role === 'emitter' || l.role === 'absorber') {
      const out = l.role === 'emitter' ? 1 : -1;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * KL_TAU, r0 = zoneR, r1 = zoneR + out * 6 * dpr; ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0); ctx.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1); ctx.stroke(); }
    }
  }
  if (r <= 0) return;
  ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.arc(px, py, r, 0, KL_TAU);
  ctx.fillStyle = l.color; ctx.fill();
  ctx.lineWidth = 2 * dpr; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(px, py, Math.max(1, r * 0.25), 0, KL_TAU); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.font = '600 ' + 11 * dpr + 'px ' + KL_FONTS.sans; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textBaseline = 'middle';
  ctx.fillText(l.label, px + r + 6 * dpr, py);
  ctx.globalAlpha = 1;
}

// ── Text, image and camera: paint the shape, then matte it ──────────────────

/**
 * Paint a text / image / camera layer's shape into `s` (cleared first): text
 * in its colour (white for mattes), an image or video frame as is. `v(key)`
 * reads a driven number. `text` is the line(s) to show; `anim` is the text
 * sequence's transition state ({ alpha, dy, chars }).
 */
export function klPaintShape(s, l, v, W, H, src, text, anim) {
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1;
  s.clearRect(0, 0, W, H);
  const x = v('x') * W, y = (1 - v('y')) * H;
  s.save(); s.translate(x, y + (anim ? anim.dy * H : 0)); s.rotate(v('rotation') * Math.PI / 180);
  if (l.kind === 'text') {
    const size = Math.max(1, v('size') * H);
    s.font = l.weight + ' ' + size + 'px ' + klFontFor(l);
    s.textAlign = 'center'; s.textBaseline = 'middle';
    s.fillStyle = l.matte === 'over' ? klCss(l.color) : '#fff';
    if (anim) s.globalAlpha = anim.alpha;
    const lines = String(text).split('\n');
    lines.forEach((line, i) => s.fillText(anim && anim.chars >= 0 ? line.slice(0, anim.chars) : line, 0, (i - (lines.length - 1) / 2) * size * 1.15));
  } else if (src) {
    const iw = src.videoWidth || src.naturalWidth || src.width, ih = src.videoHeight || src.naturalHeight || src.height;
    if (iw > 0 && ih > 0) {
      const h = v('scale') * H, w = h * iw / ih;
      if (l.mirror) s.scale(-1, 1);
      s.drawImage(src, -w / 2, -h / 2, w, h);
    }
  }
  s.restore();
}

/**
 * Matte the painted shape (in `s`) against the picture and composite it.
 *   over    as painted, with the blend mode
 *   reveal  the picture inside the shape and the layer's colour around it;
 *           with the picture hidden, the picture inside and nothing around
 *   luma    the shape's alpha times the picture's brightness (lumaCanvas)
 */
export function klMatte(ctx, s, scratch, l, gl, W, H, opacity, hidden, lumaCanvas) {
  if (l.matte === 'reveal' && hidden) {
    s.globalCompositeOperation = 'source-in';
    s.drawImage(gl, 0, 0, W, H);
  } else if (l.matte === 'reveal') {
    s.globalCompositeOperation = 'source-out';
    s.fillStyle = klCss(l.color); s.fillRect(0, 0, W, H);
  } else if (l.matte === 'luma' && lumaCanvas) {
    s.globalCompositeOperation = 'destination-in';
    s.drawImage(lumaCanvas, 0, 0, W, H);
  }
  s.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = l.matte === 'over' ? KL_BLEND[l.blend] || 'source-over' : 'source-over';
  ctx.drawImage(scratch, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

/** Quarter-res copy of the picture turned into an alpha matte: alpha = luminance. */
export function klBuildLuma(c, gl) {
  const x = c.getContext('2d', { willReadFrequently: true });
  try {
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(gl, 0, 0, c.width, c.height);
    const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i + 3] = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114); d[i] = d[i + 1] = d[i + 2] = 255; }
    x.putImageData(img, 0, 0);
    return true;
  } catch (e) { return false; }
}

// ── Shape ────────────────────────────────────────────────────────────────────

/**
 * A shape's outline as a path in device pixels, plus its length (for trim).
 * Box, circle, line and polygon only; layer and picture shapes are masks.
 */
export function klShapePath(l, v, W, H) {
  const path = new Path2D();
  const cx = v('x') * W, cy = (1 - v('y')) * H, rot = v('rotation') * Math.PI / 180;
  const w = v('w') * H, h = v('h') * H;
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (px, py) => [cx + px * c - py * s, cy + px * s + py * c];
  let len = 0;
  if (l.shape === 'circle') {
    const a = w / 2, b = h / 2;
    const n = 64;
    for (let i = 0; i <= n; i++) { const t = (i / n) * KL_TAU; const p = P(Math.cos(t) * a, Math.sin(t) * b); if (i) path.lineTo(p[0], p[1]); else path.moveTo(p[0], p[1]); }
    len = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  } else if (l.shape === 'line') {
    const a = P(-w / 2, 0), b = P(w / 2, 0);
    path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]);
    len = w;
  } else if (l.shape === 'polygon') {
    const pts = l.points || [];
    for (let i = 0; i < pts.length; i += 2) { const p = P(pts[i] * H, -pts[i + 1] * H); if (i) path.lineTo(p[0], p[1]); else path.moveTo(p[0], p[1]); if (i) len += Math.hypot((pts[i] - pts[i - 2]) * H, (pts[i + 1] - pts[i - 1]) * H); }
    if (pts.length >= 6) { path.closePath(); len += Math.hypot((pts[0] - pts[pts.length - 2]) * H, (pts[1] - pts[pts.length - 1]) * H); }
  } else {
    const r = Math.max(0, Math.min(0.5, v('round'))) * Math.min(w, h);
    const hw = w / 2, hh = h / 2;
    const corners = [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
    const start = P(-hw + r, -hh);
    path.moveTo(start[0], start[1]);
    for (let k = 0; k < 4; k++) {
      const cur = corners[k], nxt = corners[(k + 1) % 4];
      const a = P(cur[0], cur[1]), b = P(nxt[0], nxt[1]);
      if (r > 0) path.arcTo(a[0], a[1], b[0], b[1], r); else path.lineTo(a[0], a[1]);
    }
    path.closePath();
    len = 2 * (w + h) - (8 - 2 * Math.PI) * r;
  }
  return { path, len };
}

/** Draw a shape layer: fill and trimmed outline, or a dashed guide when it is an invisible zone and you are editing. */
export function klDrawShape(ctx, l, v, W, H, dpr, maskCanvas, editing, selected) {
  const isMask = l.shape === 'layer' || l.shape === 'picture';
  const opacity = 1;
  if (l.show) {
    ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
    if (isMask) {
      if (maskCanvas && v('fillOpacity') > 0) { ctx.globalAlpha = v('fillOpacity') * opacity; ctx.drawImage(maskCanvas, 0, 0, W, H); }
    } else {
      const sp = klShapePath(l, v, W, H);
      const fillA = v('fillOpacity');
      if (fillA > 0 && l.shape !== 'line') { ctx.globalAlpha = fillA; ctx.fillStyle = klCss(l.fill); ctx.fill(sp.path, 'evenodd'); }
      const sw = v('strokeWidth') * dpr, trim = Math.max(0, Math.min(1, v('trim')));
      const lineW = l.shape === 'line' ? Math.max(sw, v('h') * H) : sw;
      if (lineW > 0 && trim > 0) {
        ctx.globalAlpha = l.shape === 'line' && sw <= 0 ? fillA : 1;
        ctx.strokeStyle = klCss(l.shape === 'line' && sw <= 0 ? l.fill : l.stroke);
        ctx.lineWidth = lineW; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (trim < 1) ctx.setLineDash([sp.len * trim, sp.len * 2]);
        ctx.stroke(sp.path);
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  if (editing && (!l.show || selected)) klDrawGuide(ctx, l, v, W, H, dpr, maskCanvas, selected);
}

/** An invisible zone's outline while editing: dashed, with its name and action. */
function klDrawGuide(ctx, l, v, W, H, dpr, maskCanvas, selected) {
  ctx.save();
  ctx.globalAlpha = selected ? 0.95 : 0.6;
  const col = selected ? '#5b8cff' : 'rgba(255,255,255,0.85)';
  if (l.shape === 'layer' || l.shape === 'picture') {
    if (maskCanvas) { ctx.globalAlpha = 0.25; ctx.drawImage(maskCanvas, 0, 0, W, H); }
  } else {
    const sp = klShapePath(l, v, W, H);
    ctx.strokeStyle = col; ctx.lineWidth = 1.25 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.stroke(sp.path);
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 0.9;
  ctx.font = '600 ' + 10.5 * dpr + 'px ' + KL_FONTS.sans; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const label = l.label + (l.action && l.action !== 'none' ? ' · ' + l.action : '');
  const tx = v('x') * W, ty = (1 - v('y')) * H;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const tw = ctx.measureText(label).width + 10 * dpr;
  ctx.fillRect(tx - tw / 2, ty - 8 * dpr, tw, 16 * dpr);
  ctx.fillStyle = col; ctx.fillText(label, tx, ty);
  ctx.restore();
}

// ── Audio ────────────────────────────────────────────────────────────────────

const klDbUnit = db => Math.max(0, Math.min(1, (db + 90) / 75));

/**
 * Live audio as a picture. `audio` is { wave, freq, sampleRate } from the
 * host (null while the input is off: a flat line). `st` keeps the smoothed
 * values between frames.
 */
export function klDrawAudio(ctx, l, v, W, H, dpr, audio, st, time) {
  const n = l.style === 'wave' ? 128 : Math.max(4, l.bars | 0);
  if (!st.vals || st.vals.length !== n) st.vals = new Float32Array(n);
  const vals = st.vals, gain = v('gain'), sm = Math.max(0, Math.min(0.95, v('smooth')));
  if (audio && l.style === 'wave' && audio.wave) {
    const wv = audio.wave, step = wv.length / n;
    for (let i = 0; i < n; i++) vals[i] = vals[i] * sm + wv[Math.floor(i * step)] * gain * (1 - sm);
  } else if (audio && audio.freq) {
    // Log-spaced bands from 40 Hz to 12 kHz.
    const f = audio.freq, binHz = (audio.sampleRate || 48000) / 2 / f.length;
    for (let i = 0; i < n; i++) {
      const lo = 40 * Math.pow(300, i / n), hi = 40 * Math.pow(300, (i + 1) / n);
      const a = Math.max(1, Math.floor(lo / binHz)), z = Math.max(a, Math.min(f.length - 1, Math.ceil(hi / binHz)));
      let s = 0; for (let k = a; k <= z; k++) s += Math.max(-110, f[k]);
      vals[i] = vals[i] * sm + Math.min(1.5, klDbUnit(s / (z - a + 1)) * gain) * (1 - sm);
    }
  } else for (let i = 0; i < n; i++) vals[i] *= sm;
  const cx = v('x') * W, cy = (1 - v('y')) * H, w = v('w') * H, h = v('h') * H;
  const colour = t => l.colour === 'palette' ? paletteCssAt(l.palette, t) : klCss(l.color);
  // With no input it is a faint resting line, so the layer is findable but quiet.
  ctx.globalAlpha = v('opacity') * (audio ? 1 : 0.3);
  ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
  ctx.lineWidth = Math.max(0.5, v('thickness') * dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (l.style === 'spectrogram') {
    // Time runs left to right: each new column is the spectrum now, low notes at the bottom, loud is bright.
    const cols = 256;
    let sc = st.spec;
    if (!sc || sc.height !== n) { sc = st.spec = document.createElement('canvas'); sc.width = cols; sc.height = n; st.acc = 0; }
    const dt = st.lastT == null ? 0 : Math.max(0, Math.min(0.1, time - st.lastT));
    st.lastT = time;
    st.acc = (st.acc || 0) + dt * Math.max(0, v('scroll')) * cols / 4;
    const steps = Math.min(cols, Math.floor(st.acc));
    st.acc -= steps;
    if (steps > 0) {
      const sx = sc.getContext('2d');
      sx.globalCompositeOperation = 'copy'; sx.drawImage(sc, -steps, 0); sx.globalCompositeOperation = 'source-over';
      const img = sx.createImageData(steps, n), d = img.data, tint = l.color || [1, 1, 1];
      for (let i = 0; i < n; i++) {
        const val = Math.max(0, Math.min(1, vals[i])), rgb = l.colour === 'palette' ? paletteColour(l.palette, val) : tint, row = n - 1 - i;
        for (let k = 0; k < steps; k++) {
          const o = (row * steps + k) * 4;
          d[o] = rgb[0] * 255; d[o + 1] = rgb[1] * 255; d[o + 2] = rgb[2] * 255; d[o + 3] = val * 255;
        }
      }
      sx.putImageData(img, cols - steps, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sc, cx - w / 2, cy - h / 2, w, h);
  } else if (l.style === 'wave') {
    const draw = sign => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const px = cx - w / 2 + (i / (n - 1)) * w, py = cy - sign * vals[i] * h / 2; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
    };
    if (l.colour === 'palette') { const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0); for (let k = 0; k <= 4; k++) g.addColorStop(k / 4, paletteCssAt(l.palette, k / 4)); ctx.strokeStyle = g; }
    else ctx.strokeStyle = colour(0);
    draw(1); if (l.mirror) draw(-1);
  } else if (l.style === 'bars') {
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const bh = Math.max(dpr, vals[i] * h);
      ctx.fillStyle = colour(l.colour === 'palette' ? i / n : 0);
      const x = cx - w / 2 + i * bw + bw * 0.15;
      if (l.mirror) ctx.fillRect(x, cy - bh / 2, bw * 0.7, bh); else ctx.fillRect(x, cy + h / 2 - bh, bw * 0.7, bh);
    }
  } else {
    const R = Math.min(w, h) / 2, base = R * 0.45;
    if (l.style === 'ring') {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * KL_TAU - Math.PI / 2, len = vals[i] * (R - base);
        ctx.strokeStyle = colour(l.colour === 'palette' ? i / n : 0);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * base, cy + Math.sin(a) * base); ctx.lineTo(cx + Math.cos(a) * (base + len), cy + Math.sin(a) * (base + len)); ctx.stroke();
        if (l.mirror) { ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * base, cy + Math.sin(a) * base); ctx.lineTo(cx + Math.cos(a) * (base - len * 0.5), cy + Math.sin(a) * (base - len * 0.5)); ctx.stroke(); }
      }
    } else {
      // Blob: a closed curve whose radius follows the bands (mirrored so it closes smoothly), slowly turning.
      ctx.beginPath();
      const pts = 96, spin = time * 0.2;
      for (let k = 0; k <= pts; k++) {
        const t = k / pts, u = t < 0.5 ? t * 2 : (1 - t) * 2;
        const val = vals[Math.min(n - 1, Math.floor(u * (n - 1)))];
        const r = base + val * (R - base);
        const a = t * KL_TAU + spin;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      if (l.colour === 'palette') { const g = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, R); g.addColorStop(0, paletteCssAt(l.palette, 0)); g.addColorStop(1, paletteCssAt(l.palette, 0.8)); ctx.fillStyle = g; }
      else ctx.fillStyle = colour(0);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ── Glyphs ───────────────────────────────────────────────────────────────────

/**
 * The ramp split into what reads as one character each: emoji (flags, skin
 * tones, ZWJ families) stay whole instead of splitting into halves.
 */
export function klGlyphList(chars) {
  const text = String(chars || '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), x => x.segment);
  return Array.from(text);
}

/** A strip of the ramp's characters, white (emoji keep their colours), one cell each. Cached per ramp and size. */
function klGlyphAtlas(pool, glyphs, cellPx) {
  const key = glyphs.join('\u0000') + '|' + cellPx;
  if (pool.glyphKey === key && pool.glyphAtlas) return pool.glyphAtlas;
  const n = Math.max(1, glyphs.length);
  // One row at most 16384 px wide (a canvas limit): long ramps wrap onto more rows.
  const perRow = Math.max(1, Math.min(n, Math.floor(16384 / Math.max(1, cellPx))));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(cellPx * perRow)); c.height = Math.max(1, Math.ceil(cellPx * Math.ceil(n / perRow)));
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 ' + Math.max(4, cellPx * 1.05) + 'px ' + KL_FONTS.mono + ', "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
  for (let i = 0; i < n; i++) {
    const gx = (i % perRow) * cellPx, gy = Math.floor(i / perRow) * cellPx;
    // Wide glyphs (emoji, CJK) are squeezed to fit their cell.
    const w = x.measureText(glyphs[i]).width, k = w > cellPx * 1.05 ? (cellPx * 1.05) / w : 1;
    x.save(); x.translate(gx + cellPx / 2, gy + cellPx * 0.54); x.scale(k, k); x.fillText(glyphs[i], 0, 0); x.restore();
  }
  pool.glyphAtlas = c; pool.glyphKey = key; pool.glyphPerRow = perRow;
  return c;
}

/**
 * The picture as a grid of glyphs. `grid` is the picture (or camera) at one
 * pixel per cell (RGBA, cols × rows). Glyphs are drawn white, then coloured:
 * tint and palette per brightness level, picture by the picture itself.
 */
export function klDrawGlyphs(ctx, l, v, W, H, dpr, grid, cols, rows, pool, gl, useAlpha) {
  const cell = Math.max(3, v('cell') * dpr), contrast = v('contrast');
  const s = klCanvas(pool, 'glyphs', W, H).getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1;
  s.clearRect(0, 0, W, H);
  const LEVELS = 16;
  const levelOf = (k) => {
    // Read from a layer, transparent is dark: faint trails count for little.
    let b = (grid[k] * 0.299 + grid[k + 1] * 0.587 + grid[k + 2] * 0.114) / 255 * (useAlpha ? grid[k + 3] / 255 : 1);
    b = Math.max(0, Math.min(1, (b - 0.5) * contrast + 0.5));
    return l.invert ? 1 - b : b;
  };
  const colourFor = t => l.colour === 'palette' ? paletteCssAt(l.palette, t) : l.colour === 'tint' ? klCss(l.color) : '#fff';
  if (l.style === 'ascii') {
    let glyphs = klGlyphList(l.chars);
    if (!glyphs.length) glyphs = klGlyphList(' .:-=+*#%@');
    const ac = Math.max(1, Math.round(cell));
    const atlas = klGlyphAtlas(pool, glyphs, ac), perRow = pool.glyphPerRow || glyphs.length;
    const n = glyphs.length, shift = v('shift') || 0, spread = Math.max(0, Math.min(1, v('spread') || 0));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const b = levelOf((r * cols + c) * 4);
      let i = Math.min(n - 1, Math.floor(b * n));
      // A blank stays blank (that's what makes the dark areas read), whatever the shift.
      if (glyphs[i] === ' ') continue;
      if (spread > 0) { const h = Math.sin((c * 127.1 + r * 311.7) * 0.0137) * 43758.5453; i += Math.round((h - Math.floor(h) - 0.5) * spread * n); }
      i = (((Math.floor(i + shift)) % n) + n) % n;
      if (glyphs[i] === ' ') continue;
      s.drawImage(atlas, (i % perRow) * ac, Math.floor(i / perRow) * ac, ac, ac, c * cell, r * cell, cell, cell);
    }
  } else {
    const paths = Array.from({ length: LEVELS }, () => new Path2D());
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const b = levelOf((r * cols + c) * 4);
      if (b < 0.02) continue;
      const q = Math.min(LEVELS - 1, Math.floor(b * LEVELS)), p = paths[q];
      const cx = (c + 0.5) * cell, cy = (r + 0.5) * cell, half = cell / 2;
      if (l.style === 'dots') { const rr = b * half; p.moveTo(cx + rr, cy); p.arc(cx, cy, rr, 0, KL_TAU); }
      else if (l.style === 'squares') { const rr = b * half; p.rect(cx - rr, cy - rr, rr * 2, rr * 2); }
      else if (l.style === 'lines') { const a = b * Math.PI; const dx = Math.cos(a) * half, dy = Math.sin(a) * half; p.moveTo(cx - dx, cy - dy); p.lineTo(cx + dx, cy + dy); }
      else { const rr = b * half; p.moveTo(cx - rr, cy); p.lineTo(cx + rr, cy); p.moveTo(cx, cy - rr); p.lineTo(cx, cy + rr); }
    }
    s.lineWidth = Math.max(1, cell * 0.14); s.lineCap = 'round';
    for (let q = 0; q < LEVELS; q++) {
      const col = colourFor((q + 0.5) / LEVELS);
      if (l.style === 'lines' || l.style === 'cross') { s.strokeStyle = col; s.stroke(paths[q]); }
      else { s.fillStyle = col; s.fill(paths[q]); }
    }
  }
  if (l.style === 'ascii' && l.colour !== 'picture' && l.colour !== 'own') {
    // Colour the white glyphs: one tint, or a palette by brightness level.
    s.globalCompositeOperation = 'source-in';
    if (l.colour === 'tint') { s.fillStyle = klCss(l.color); s.fillRect(0, 0, W, H); }
    else {
      const small = klCanvas(pool, 'glyphLevels', cols, rows).getContext('2d');
      const img = small.createImageData(cols, rows);
      for (let k = 0; k < cols * rows; k++) {
        const t = levelOf(k * 4), m = /rgb\((\d+),(\d+),(\d+)\)/.exec(paletteCssAt(l.palette, t));
        img.data[k * 4] = +m[1]; img.data[k * 4 + 1] = +m[2]; img.data[k * 4 + 2] = +m[3]; img.data[k * 4 + 3] = 255;
      }
      small.putImageData(img, 0, 0);
      s.imageSmoothingEnabled = false;
      s.drawImage(pool.glyphLevels, 0, 0, cols * cell, rows * cell);
      s.imageSmoothingEnabled = true;
    }
  }
  if (l.colour === 'picture' && gl) { s.globalCompositeOperation = 'source-in'; s.drawImage(gl, 0, 0, W, H); }
  s.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = v('opacity');
  if (l.cover) { ctx.fillStyle = klCss(l.background); ctx.fillRect(0, 0, W, H); }
  ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
  ctx.drawImage(pool.glyphs, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ── Contours ─────────────────────────────────────────────────────────────────

/** Topographic lines by marching squares over a brightness grid (sw × sh RGBA). */
export function klDrawContours(ctx, l, v, W, H, dpr, sample, sw, sh, time) {
  const levels = Math.max(1, Math.round(v('levels'))), offset = time * v('flow');
  let lum = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) lum[i] = (sample[i * 4] * 0.299 + sample[i * 4 + 1] * 0.587 + sample[i * 4 + 2] * 0.114) / 255;
  // Two box-blur passes: hard edges in the picture become slopes the lines can follow smoothly instead of stepping pixel by pixel.
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let sum = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue; sum += lum[yy * sw + xx]; n++; }
      out[y * sw + x] = sum / n;
    }
    lum = out;
  }
  const cw = W / (sw - 1), ch = H / (sh - 1);
  ctx.globalAlpha = v('opacity');
  ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
  ctx.lineWidth = Math.max(0.5, v('width') * dpr); ctx.lineCap = 'round';
  for (let k = 0; k < levels; k++) {
    let t = (k + 0.5 + offset) / levels; t -= Math.floor(t);
    const path = new Path2D();
    for (let y = 0; y < sh - 1; y++) for (let x = 0; x < sw - 1; x++) {
      const a = lum[y * sw + x], b = lum[y * sw + x + 1], c = lum[(y + 1) * sw + x + 1], d = lum[(y + 1) * sw + x];
      const idx = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const px = x * cw, py = y * ch;
      const lerp = (p, q) => (t - p) / ((q - p) || 1e-6);
      const top = [px + lerp(a, b) * cw, py], right = [px + cw, py + lerp(b, c) * ch], bottom = [px + lerp(d, c) * cw, py + ch], left = [px, py + lerp(a, d) * ch];
      const seg = (p, q) => { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); };
      switch (idx) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(left, top); break;
        case 5: seg(left, top); seg(bottom, right); break;
        case 10: seg(top, right); seg(left, bottom); break;
      }
    }
    ctx.strokeStyle = l.colour === 'palette' ? paletteCssAt(l.palette, t) : klCss(l.color);
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ── Lens ─────────────────────────────────────────────────────────────────────

/** A circle that changes the picture under it (the picture only: layers below are not affected). */
export function klDrawLens(ctx, l, v, W, H, dpr, gl, px, py, pool) {
  const R = v('radius') * H, amt = v('amount');
  if (R <= 1) return;
  const cx = px * W, cy = (1 - py) * H;
  ctx.save();
  ctx.globalAlpha = v('opacity');
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, KL_TAU); ctx.clip();
  switch (l.effect) {
    case 'magnify': {
      const z = Math.max(1, amt), r = R / z;
      ctx.drawImage(gl, (cx - r) * gl.width / W, (cy - r) * gl.height / H, 2 * r * gl.width / W, 2 * r * gl.height / H, cx - R, cy - R, 2 * R, 2 * R);
      break;
    }
    case 'pixelate': {
      const block = Math.max(2, amt * 4 * dpr), n = Math.max(1, Math.round((2 * R) / block));
      const tiny = klCanvas(pool, 'lensTiny', n, n);
      const t = tiny.getContext('2d');
      t.drawImage(gl, (cx - R) * gl.width / W, (cy - R) * gl.height / H, 2 * R * gl.width / W, 2 * R * gl.height / H, 0, 0, n, n);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tiny, cx - R, cy - R, 2 * R, 2 * R);
      ctx.imageSmoothingEnabled = true;
      break;
    }
    case 'blur': {
      if ('filter' in ctx) { ctx.filter = 'blur(' + Math.max(0, amt * 3 * dpr) + 'px)'; ctx.drawImage(gl, 0, 0, W, H); ctx.filter = 'none'; }
      else { const n = Math.max(4, Math.round((2 * R) / Math.max(2, amt * 4 * dpr))); const tiny = klCanvas(pool, 'lensTiny', n, n); tiny.getContext('2d').drawImage(gl, (cx - R) * gl.width / W, (cy - R) * gl.height / H, 2 * R * gl.width / W, 2 * R * gl.height / H, 0, 0, n, n); ctx.drawImage(tiny, cx - R, cy - R, 2 * R, 2 * R); }
      break;
    }
    case 'invert':
      ctx.drawImage(gl, 0, 0, W, H);
      ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      break;
    case 'mono':
      ctx.drawImage(gl, 0, 0, W, H);
      ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      break;
    case 'mirror':
      ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0);
      ctx.drawImage(gl, 0, 0, W, H);
      break;
  }
  ctx.restore();
  const ring = v('ring') * dpr;
  if (ring > 0) { ctx.globalAlpha = v('opacity'); ctx.beginPath(); ctx.arc(cx, cy, R, 0, KL_TAU); ctx.lineWidth = ring; ctx.strokeStyle = klCss(l.ringColor); ctx.stroke(); ctx.globalAlpha = 1; }
}

// ── Brush ────────────────────────────────────────────────────────────────────

/**
 * Strokes: `st.pts` is a flat list of points { x, y, t, css, s (stroke id) }.
 * Consecutive points of one stroke are joined; each fades by its age.
 */
export function klDrawBrush(ctx, l, v, W, H, dpr, st, time) {
  const fadeS = v('fade'), size = Math.max(0.5, v('size') * dpr);
  const pts = st.pts;
  ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = size;
  const op = v('opacity');
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.s !== b.s) continue;
    const age = time - b.t;
    const alpha = fadeS > 0 ? Math.max(0, 1 - age / fadeS) : 1;
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = op * alpha;
    ctx.strokeStyle = b.css;
    ctx.beginPath(); ctx.moveTo(a.x * W, (1 - a.y) * H); ctx.lineTo(b.x * W, (1 - b.y) * H); ctx.stroke();
  }
  // A lone dot where a stroke has one point.
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if ((i > 0 && pts[i - 1].s === p.s) || (i < pts.length - 1 && pts[i + 1].s === p.s)) continue;
    const alpha = fadeS > 0 ? Math.max(0, 1 - (time - p.t) / fadeS) : 1;
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = op * alpha; ctx.fillStyle = p.css;
    ctx.beginPath(); ctx.arc(p.x * W, (1 - p.y) * H, size / 2, 0, KL_TAU); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ── Field preview ────────────────────────────────────────────────────────────

/**
 * A particles layer's field and forces, drawn while editing: grey arrows
 * where the field points (dots where particles settle), warm arrows for the
 * pull of the attractor and force zones, and rings on the attractor and on
 * each zone's reach. `samples` come from particleFieldGrid.
 */
export function klDrawFieldPreview(ctx, samples, cols, rows, W, H, dpr, attractor, zones) {
  const cw = W / cols, ch = H / rows, cell = Math.min(cw, ch);
  const arrow = (x, y, dx, dy, len) => {
    const ex = x + dx * len, ey = y - dy * len, hx = dx * len * 0.35, hy = -dy * len * 0.35;
    ctx.moveTo(x - dx * len * 0.5, y + dy * len * 0.5); ctx.lineTo(ex - dx * len * 0.5, ey + dy * len * 0.5);
    ctx.moveTo(ex - dx * len * 0.5 - hx + hy * 0.6, ey + dy * len * 0.5 - hy - hx * 0.6); ctx.lineTo(ex - dx * len * 0.5, ey + dy * len * 0.5);
    ctx.lineTo(ex - dx * len * 0.5 - hx - hy * 0.6, ey + dy * len * 0.5 - hy + hx * 0.6);
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // The field.
  ctx.beginPath();
  const dots = new Path2D();
  for (const s of samples) {
    const x = s.x * W, y = (1 - s.y) * H;
    if (s.settle) { dots.moveTo(x + 1.5 * dpr, y); dots.arc(x, y, 1.5 * dpr, 0, KL_TAU); continue; }
    if (!s.fx && !s.fy) continue;
    arrow(x, y, s.fx, s.fy, cell * 0.55);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3 * dpr; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill(dots);
  // The forces: length grows with strength and levels off, so strong pulls don't swamp the picture.
  ctx.beginPath();
  for (const s of samples) {
    const m = Math.hypot(s.ax, s.ay);
    if (m < 0.02) continue;
    arrow(s.x * W, (1 - s.y) * H, s.ax / m, s.ay / m, cell * 0.85 * (1 - Math.exp(-m * 0.8)));
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3.4 * dpr; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,170,60,0.95)'; ctx.lineWidth = 1.6 * dpr; ctx.stroke();
  // Where the pulls come from.
  ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(255,170,60,0.8)'; ctx.lineWidth = 1.2 * dpr;
  if (attractor) { ctx.beginPath(); ctx.arc(attractor.x * W, (1 - attractor.y) * H, 12 * dpr, 0, KL_TAU); ctx.stroke(); }
  for (const z of zones || []) {
    if (z.action !== 'vortex' && z.action !== 'attract' && z.action !== 'repel' && z.action !== 'emitter' && z.action !== 'absorber') continue;
    const r = z.action === 'emitter' || z.action === 'absorber' ? Math.min(z.reach, 0.5) : z.reach + Math.max(z.w || 0, z.h || 0) / 2;
    ctx.beginPath();
    if (z.action === 'vortex' && z.tilt > 0.01) ctx.ellipse(z.x * W, (1 - z.y) * H, r * H, r * H * Math.cos(z.tilt), z.rot || 0, 0, KL_TAU);
    else ctx.arc(z.x * W, (1 - z.y) * H, r * H, 0, KL_TAU);
    ctx.stroke();
  }
  ctx.restore();
}
