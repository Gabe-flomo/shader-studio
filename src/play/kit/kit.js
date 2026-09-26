/**
 * kit.js — the layer kit: everything Play draws over the picture, in one
 * place for the app (play/overlay.ts) and web exports (play/exportHtml.ts
 * inlines the kit files, imports and exports removed, into one closure).
 *
 * A host (the app or the web runtime) owns the canvases, the inputs and the
 * mapping engine; once a frame it calls
 *
 *   kit.frame(ctx, record, env)
 *
 * right after the shader has drawn, with env:
 *   gl         the picture's canvas (still holding this frame)
 *   W, H, dpr  overlay size in device pixels, and device pixels per CSS pixel
 *   time, dt   graph clock and frame step, seconds
 *   value(layer, key)      a layer property now (a mapping may drive it)
 *   pointer    { x, y, over, down } over the picture, 0..1 with y up
 *   markers    draw null markers · editing: outline invisible zones · selectedId
 *   hidden, backdrop       Picture → Layers only
 *   audio      { wave, freq, sampleRate } from the live input, or null
 *   camera     a playing <video> of the webcam, or null
 *   image(src) a loaded <img> for a data URL, or null while loading
 *   sensor(key, value)     report a sensor reading (`layerId::read`)
 *   override(layerId, key, value|null)  where a following null is now
 *
 * The kit keeps per-layer state (particles, bodies, strokes, springs, text
 * sequences) between frames, keyed by layer id. Actions (burst, next line…)
 * are queued with kit.act() and applied on the next frame.
 */
import { createParticles, resizeParticles, stepParticles, drawParticles, burstParticles, scatterParticles, resetParticles, seededRandom, paletteCssAt, particleFieldGrid } from '../particle-sim.js';
import { geoCompile, geoFieldFromBrightness, geoFieldFromAlpha, geoFieldFromCoverage, sdfSegments } from './geometry.js';
import { KL_BLEND, klCss, klCanvas, klDownscale, klFontGeneration, klDrawFieldPreview, klDrawNull, klPaintShape, klMatte, klBuildLuma, klDrawShape, klDrawAudio, klDrawGlyphs, klDrawContours, klDrawLens, klDrawBrush, klClonerLayout, klClonerCopies, klDrawCopy, klFontFor, klSketchCompile, klSketchStep, klSketchPress } from './layers.js';
import { bdCreate, bdDrop, bdScatter, bdStep, bdDraw } from './bodies.js';

const KIT_COARSE_W = 64, KIT_COARSE_H = 36, KIT_FINE_W = 128, KIT_FINE_H = 72;
const KIT_ANIMATED = { particles: 1, bodies: 1, audio: 1, brush: 1, camera: 1, lens: 1 };

export function createLayerKit() {
  const pool = {};
  const parts = new Map(), bodies = new Map(), brushes = new Map(), springs = new Map(), texts = new Map(), audios = new Map(), masks = new Map(), scripts = new Map();
  const scriptPresses = new Map(); // layer id → { key: amount }: script buttons pressed since the layer's last frame
  const frozen = new Set(), shown = new Map(), lastVisible = new Map();
  let queue = [];
  let coarse = null, fine = null, camSample = null, camPrev = null, motion = 0;
  const sensorVals = new Map();

  function sampleInto(name, src, w, h, mirror) {
    const c = klCanvas(pool, name, w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    try {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, w, h);
      if (mirror) { x.translate(w, 0); x.scale(-1, 1); }
      x.drawImage(src, 0, 0, w, h);
      x.setTransform(1, 0, 0, 1, 0, 0);
      return x.getImageData(0, 0, w, h).data;
    } catch (e) { return null; }
  }

  function randFor(id, seed) {
    const s = parts.get(id);
    return s && s.seedUsed === seed ? s.rand : seededRandom(seed);
  }

  function textState(l, time) {
    let t = texts.get(l.id);
    if (!t) { t = { index: 0, changedAt: -1e9, text: l.text }; texts.set(l.id, t); }
    if (t.text !== l.text) { t.text = l.text; t.index = 0; }
    const n = Math.max(1, String(l.text).split('\n').length);
    if (t.index >= n) t.index = 0;
    const interval = l.interval;
    if (l.sequence && interval > 0 && time - t.changedAt >= interval) { t.index = t.changedAt < -1e8 ? 0 : (t.index + 1) % n; t.changedAt = time; }
    return t;
  }
  function stepText(l, dir, time) {
    const t = textState(l, time), n = Math.max(1, String(l.text).split('\n').length);
    if (dir === 'shuffle') { let k = Math.floor(Math.random() * n); if (n > 1 && k === t.index) k = (k + 1) % n; t.index = k; }
    else if (dir === 'reset') t.index = 0;
    else t.index = (t.index + (dir === 'prev' ? n - 1 : 1)) % n;
    t.changedAt = time;
  }

  function brushState(id) { let b = brushes.get(id); if (!b) { b = { pts: [], stroke: 0, was: false }; brushes.set(id, b); } return b; }

  /** The null a layer points at, where it is now. */
  function nullPos(record, env, id) {
    const n = id && record.layers.find(l => l.id === id);
    return n && n.kind === 'null' ? { x: env.value(n, 'x'), y: env.value(n, 'y') } : null;
  }

  /** A text or image layer's shape as a small alpha mask → distance field (for 'layer' shapes). */
  function layerField(shape, record, env, aspect) {
    const src = record.layers.find(l => l.id === shape.sourceId);
    if (!src || (src.kind !== 'text' && src.kind !== 'image' && src.kind !== 'camera')) return null;
    const gh = 90, gw = Math.max(8, Math.round(gh * aspect));
    const v = k => env.value(src, k);
    const key = [src.kind, src.text, src.sequence ? textState(src, env.time).index : -1, src.src ? src.src.length : 0, src.font, src.fontUrl, klFontGeneration(), src.weight, v('x'), v('y'), v(src.kind === 'text' ? 'size' : 'scale'), v('rotation'), gw].join('|');
    let m = masks.get(shape.id);
    if (m && m.key === key && src.kind !== 'camera') return m;
    const c = klCanvas(pool, 'layerMask', gw, gh), s = c.getContext('2d', { willReadFrequently: true });
    const image = src.kind === 'image' ? env.image(src.src) : src.kind === 'camera' ? env.camera : null;
    // Text in a sequence is shaped by the line showing now; otherwise all of it.
    const text = src.kind !== 'text' ? '' : src.sequence ? String(src.text).split('\n')[textState(src, env.time).index] || '' : src.text;
    klPaintShape(s, Object.assign({}, src, { matte: 'reveal' }), v, gw, gh, image, text, null);
    let data;
    try { data = s.getImageData(0, 0, gw, gh).data; } catch (e) { return null; }
    m = { key, field: geoFieldFromAlpha(data, gw, gh), mask: null };
    masks.set(shape.id, m);
    return m;
  }

  /** A canvas showing where a mask shape is inside, in its fill colour. */
  function maskCanvasFor(shape, field) {
    const c = klCanvas(pool, 'maskShow:' + shape.id, field.gw, field.gh), x = c.getContext('2d');
    const img = x.createImageData(field.gw, field.gh), col = shape.fill;
    for (let i = 0; i < field.gw * field.gh; i++) {
      const d = shape.invert ? -field.d[i] : field.d[i];
      const a = Math.max(0, Math.min(1, 0.5 - d * field.gh));
      img.data[i * 4] = col[0] * 255; img.data[i * 4 + 1] = col[1] * 255; img.data[i * 4 + 2] = col[2] * 255; img.data[i * 4 + 3] = a * 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  function frame(ctx, record, env) {
    const W = env.W, H = env.H, dpr = env.dpr || 1, time = env.time, dt = Math.min(0.1, Math.max(0, env.dt));
    const aspect = W / H, gl = env.gl, pointer = env.pointer || { x: 0.5, y: 0.5, over: false, down: false };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    // A transparent export keeps the backdrop out: only the layers, over nothing.
    if (env.hidden && !env.transparent) { ctx.fillStyle = klCss(env.backdrop || [0, 0, 0]); ctx.fillRect(0, 0, W, H); }
    const layers = record.layers;
    const ids = new Set(layers.map(l => l.id));
    for (const m of [parts, bodies, brushes, springs, texts, audios, masks, shown, lastVisible, scripts]) for (const id of [...m.keys()]) if (!ids.has(id)) m.delete(id);
    // A visibility change in the panel wins over an earlier show/hide action.
    for (const l of layers) { if (lastVisible.has(l.id) && lastVisible.get(l.id) !== l.visible) shown.delete(l.id); lastVisible.set(l.id, l.visible); }
    const baseVisible = l => (shown.has(l.id) ? shown.get(l.id) : l.visible);
    // A cloner that hides its source draws the copies only: the source stays out of the picture (its cloner still reads it).
    const hiddenBySource = new Set(layers.filter(l => l.kind === 'cloner' && l.hideSource && l.sourceId && baseVisible(l)).map(l => l.sourceId));
    const isVisible = l => baseVisible(l) && !hiddenBySource.has(l.id);
    const vis = layers.filter(isVisible);

    // 1. Nulls that follow something ride a spring; their position is reported back to the host.
    for (const l of layers) {
      if (l.kind !== 'null') continue;
      if (l.follow === 'none') { if (springs.has(l.id)) { springs.delete(l.id); env.override(l.id, 'x', null); env.override(l.id, 'y', null); } continue; }
      let s = springs.get(l.id);
      if (!s) { s = { x: l.x, y: l.y, vx: 0, vy: 0 }; springs.set(l.id, s); }
      const target = l.follow === 'mouse' ? (pointer.over ? pointer : null) : nullPos(record, { value: (n, k) => (springs.has(n.id) && n.id !== l.id ? springs.get(n.id)[k] : env.value(n, k)) }, l.followId);
      if (target) {
        const k = 4 + Math.pow(env.value(l, 'spring'), 2) * 400, zeta = 1 - Math.min(0.95, env.value(l, 'wobble') * 0.95), c = 2 * zeta * Math.sqrt(k);
        for (let i = 0; i < 4; i++) {
          const h = dt / 4;
          s.vx += (k * (target.x - s.x) - c * s.vx) * h; s.vy += (k * (target.y - s.y) - c * s.vy) * h;
          s.x += s.vx * h; s.y += s.vy * h;
        }
      }
      env.override(l.id, 'x', s.x); env.override(l.id, 'y', s.y);
    }

    // 2. Read the picture (and the camera) at the resolutions anything needs.
    const needs = { coarse: false, fine: false, cam: false, camFine: false };
    for (const l of vis) {
      if (l.kind === 'particles') { if (l.readFrom === 'camera') { needs.cam = true; if (l.detail === 'fine') needs.camFine = true; } else if (l.detail === 'fine') needs.fine = true; else needs.coarse = true; if (l.colour === 'picture') needs.coarse = true; }
      else if (l.kind === 'bodies' && l.solidPicture) needs.coarse = true;
      else if (l.kind === 'shape' && l.shape === 'picture') needs.coarse = true;
      else if (l.kind === 'brush' && l.colour === 'picture') needs.coarse = true;
      else if (l.kind === 'script' && l.readPicture) needs.coarse = true;
      else if (l.kind === 'contours') { if (l.readFrom === 'camera') { needs.cam = true; needs.camFine = needs.camFine || l.detail === 'fine'; } else if (l.detail === 'fine') needs.fine = true; else needs.coarse = true; }
      else if (l.kind === 'camera') needs.cam = true;
    }
    coarse = needs.coarse ? sampleInto('coarse', gl, KIT_COARSE_W, KIT_COARSE_H, false) : null;
    fine = needs.fine ? sampleInto('fine', gl, KIT_FINE_W, KIT_FINE_H, false) : null;
    const cam = env.camera && env.camera.readyState >= 2 ? env.camera : null;
    const camMirror = (layers.find(l => l.kind === 'camera') || { mirror: true }).mirror;
    camSample = cam && needs.cam ? sampleInto('cam', cam, KIT_COARSE_W, KIT_COARSE_H, camMirror) : null;
    const camFine = cam && needs.camFine ? sampleInto('camFine', cam, KIT_FINE_W, KIT_FINE_H, camMirror) : null;
    if (camSample) {
      // Motion: how much the camera image changed since last frame.
      let diff = 0;
      if (camPrev) for (let i = 0; i < camSample.length; i += 4) diff += Math.abs(camSample[i] + camSample[i + 1] - camPrev[i] - camPrev[i + 1]);
      camPrev = new Uint8ClampedArray(camSample);
      const m = Math.min(1, (diff / (camSample.length / 4) / 510) * 12);
      motion = motion * 0.7 + m * 0.3;
    }
    const pictureFor = (from, detail) => from === 'camera'
      ? (detail === 'fine' && camFine ? { s: camFine, w: KIT_FINE_W, h: KIT_FINE_H } : camSample ? { s: camSample, w: KIT_COARSE_W, h: KIT_COARSE_H } : null)
      : (detail === 'fine' && fine ? { s: fine, w: KIT_FINE_W, h: KIT_FINE_H } : coarse ? { s: coarse, w: KIT_COARSE_W, h: KIT_COARSE_H } : null);

    // 3. Zones: every visible shape (it counts what is inside; its action may move things), and brush strokes set as walls.
    const zones = [], zoneById = new Map(), maskShows = new Map();
    for (const l of vis) {
      if (l.kind !== 'shape') continue;
      const v = k => env.value(l, k);
      const spec = { id: l.id, shape: l.shape, x: v('x'), y: v('y'), w: v('w'), h: v('h'), rotation: v('rotation'), round: v('round'), points: l.points, invert: l.invert,
        action: l.action, strength: v('strength'), reach: v('reach'), bounce: v('bounce'), angle: v('angle'), targetId: l.targetId, tint: l.tint, scale: v('scale'), tilt: v('tilt'), affects: l.affects };
      if (l.shape === 'picture' || l.shape === 'layer') {
        let field = null;
        if (l.shape === 'picture') { if (coarse) field = geoFieldFromBrightness(coarse, KIT_COARSE_W, KIT_COARSE_H, v('threshold')); }
        else { const m = layerField(l, record, env, aspect); field = m ? m.field : null; }
        if (!field) continue;
        spec.shape = 'field'; spec.field = field;
        if (l.show || env.editing) maskShows.set(l.id, maskCanvasFor(l, field));
      }
      const z = geoCompile(spec, aspect);
      // Rough share of the picture it covers, for the fill sensor.
      let inside = 0;
      for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 20; gx++) if (z.dist((gx + 0.5) / 20, (gy + 0.5) / 12) < 0) inside++;
      z.area = inside / 240;
      zones.push(z); zoneById.set(l.id, z);
    }
    // Nulls with a particle role are small round zones that move with the null.
    for (const l of vis) {
      if (l.kind !== 'null' || !l.role || l.role === 'none') continue;
      const r = env.value(l, 'radius');
      const far = l.role === 'emitter' || l.role === 'absorber';
      zones.push(geoCompile({ id: l.id, shape: 'circle', x: env.value(l, 'x'), y: env.value(l, 'y'), w: r * 2, h: r * 2, action: l.role, strength: env.value(l, 'strength'), reach: far ? 3 : r * 5, tilt: env.value(l, 'tilt'), affects: '' }, aspect));
    }
    for (const l of vis) {
      if (l.kind !== 'brush' || !l.walls) continue;
      const b = brushes.get(l.id);
      if (!b || b.pts.length < 1) continue;
      const r = (env.value(l, 'size') * dpr) / 2 / H, segs = [];
      for (let i = 0; i < b.pts.length; i++) {
        const a = b.pts[i], c = i + 1 < b.pts.length && b.pts[i + 1].s === a.s ? b.pts[i + 1] : a;
        segs.push(a.x * aspect, a.y, c.x * aspect, c.y, r);
      }
      const z = { id: l.id, action: 'wall', dist: (x, y) => sdfSegments(x * aspect, y, segs), bounce: 0.2, affects: '', inside: 0, total: 0, area: 0 };
      z.normal = (x, y) => { const e = 0.002; const gx = z.dist(x + e / aspect, y) - z.dist(x - e / aspect, y), gy = z.dist(x, y + e) - z.dist(x, y - e); const m = Math.hypot(gx, gy) || 1; return [gx / m, gy / m]; };
      zones.push(z);
    }

    // 4. Actions queued since last frame. Particle ones wait for their layer's step (they need its zones).
    const pending = new Map();
    for (const a of queue) {
      const l = layers.find(x => x.id === a.layerId);
      if (!l) continue;
      switch (a.do) {
        case 'toggle': shown.set(l.id, !isVisible(l)); break;
        case 'show': shown.set(l.id, true); break;
        case 'hide': shown.set(l.id, false); break;
        case 'freeze': if (frozen.has(l.id)) frozen.delete(l.id); else frozen.add(l.id); { const b = bodies.get(l.id); if (b) b.st.frozen = frozen.has(l.id); } break;
        case 'next': case 'prev': case 'shuffle': if (l.kind === 'text') stepText(l, a.do, time); break;
        case 'clear': if (l.kind === 'brush') brushState(l.id).pts = []; break;
        case 'drop': { const b = bodies.get(l.id); if (b) bdDrop(b.st, l, aspect, (env.value(l, 'size') * dpr) / H, Math.random); break; }
        case 'reset':
          if (l.kind === 'text') stepText(l, 'reset', time);
          else if (l.kind === 'brush') brushState(l.id).pts = [];
          else if (l.kind === 'bodies') { const b = bodies.get(l.id); if (b) bdDrop(b.st, l, aspect, (env.value(l, 'size') * dpr) / H, Math.random); }
          else if (l.kind === 'particles') { if (!pending.has(l.id)) pending.set(l.id, []); pending.get(l.id).push(a); }
          break;
        case 'scatter':
          if (l.kind === 'bodies') { const b = bodies.get(l.id); if (b) bdScatter(b.st, (a.amount || 1) * env.value(l, 'scatter'), Math.random); }
          else if (l.kind === 'particles') { if (!pending.has(l.id)) pending.set(l.id, []); pending.get(l.id).push(a); }
          break;
        case 'burst':
          if (l.kind === 'particles') { if (!pending.has(l.id)) pending.set(l.id, []); pending.get(l.id).push(a); }
          break;
        default:
          // A button a script declared: pressed on the layer's next frame.
          if (l.kind === 'script' && typeof a.do === 'string' && a.do.indexOf('script:') === 0) {
            let m = scriptPresses.get(l.id); if (!m) { m = {}; scriptPresses.set(l.id, m); }
            m[a.do.slice(7)] = a.amount == null ? 1 : a.amount;
          }
          break;
      }
    }
    queue = [];
    for (const z of zones) { z.inside = 0; z.total = 0; }

    // 5. Draw, bottom to top.
    let lumaReady = false;
    const luma = () => { if (!lumaReady) { lumaReady = klBuildLuma(klCanvas(pool, 'luma', 320, 180), gl); } return lumaReady ? pool.luma : null; };
    /**
     * Copies of a source layer. The source is drawn once into a scratch canvas
     * (its own driven values, at its own place), then blitted per copy with the
     * copy's transform. Effectors are the nulls and shapes the cloner names.
     */
    /**
     * A Script layer: the user's JavaScript, compiled once per code change into a setup and a draw
     * function, run each frame against a 2D canvas the size of the picture, then composited with
     * the layer's opacity and blend. A broken script reports its error and draws nothing until the
     * code changes; the other layers carry on.
     */
    function drawScript(c, l, v) {
      let st = scripts.get(l.id);
      if (!st || st.code !== l.code) {
        st = klSketchCompile(l.code);
        scripts.set(l.id, st);
        if (env.scriptStatus) env.scriptStatus(l.id, st.error);
      }
      const presses = scriptPresses.get(l.id);
      if (presses) { for (const k in presses) klSketchPress(st, k, presses[k]); scriptPresses.delete(l.id); }
      if (st.error) return;
      const buf = klCanvas(pool, 'script_' + l.id, W, H), bx = buf.getContext('2d');
      const params = {};
      for (const d of l.paramDefs || []) { const val = v('p_' + d.key); params[d.key] = typeof val === 'number' && isFinite(val) ? val : d.value; }
      const s = {
        ctx: bx, width: W, height: H, dpr, time, dt, frame: st.frame, params, state: st.state,
        mouse: { x: pointer.x * W, y: (1 - pointer.y) * H, over: !!pointer.over, down: !!pointer.down },
        picture: {
          brightness: (x, y) => {
            if (!coarse) return 0;
            const cx = Math.max(0, Math.min(KIT_COARSE_W - 1, Math.floor((x / W) * KIT_COARSE_W))), cy = Math.max(0, Math.min(KIT_COARSE_H - 1, Math.floor((y / H) * KIT_COARSE_H)));
            const i = (cy * KIT_COARSE_W + cx) * 4;
            return (coarse[i] + coarse[i + 1] + coarse[i + 2]) / 765;
          },
        },
        null: name => { const n = record.layers.find(x => x.kind === 'null' && (x.id === name || x.label === name)); return n ? { x: env.value(n, 'x') * W, y: (1 - env.value(n, 'y')) * H } : null; },
        random: Math.random,
      };
      const err = klSketchStep(st, s, l.paramDefs || [], l.clear);
      if (err) { if (env.scriptStatus) env.scriptStatus(l.id, err); return; }
      c.globalAlpha = v('opacity'); c.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
      c.drawImage(buf, 0, 0);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }

    function drawCloner(c, l, v) {
      const src = l.sourceId ? layers.find(x => x.id === l.sourceId) : null;
      if (!src || src.id === l.id || src.kind === 'cloner') return;
      const vs = k => env.value(src, k);
      // Where the copies go.
      let path = null, points = null;
      if (l.arrange === 'path') { const b = brushes.get(l.pathId); path = b ? b.pts : null; }
      else if (l.arrange === 'points') {
        const s = parts.get(l.pathId);
        if (s && s.sim) { points = []; const sim = s.sim; for (let i = 0; i < sim.count && points.length < 400; i++) if (sim.alive[i]) points.push({ x: sim.x[i], y: sim.y[i] }); }
      }
      const layout = klClonerLayout(l, v, aspect, path, points);
      if (!layout.length) return;
      // Effectors: a null is a point, a shape counts from its edge.
      const effectors = [];
      for (const id of l.effectors || []) {
        const e = layers.find(x => x.id === id); if (!e) continue;
        if (e.kind === 'null') { const p = nullPos(record, env, e.id); if (p) effectors.push({ x: p.x, y: p.y, rx: 0, ry: 0 }); }
        else if (e.kind === 'shape') effectors.push({ x: env.value(e, 'x'), y: env.value(e, 'y'), rx: (env.value(e, 'w') / 2) / aspect, ry: env.value(e, 'h') / 2 });
      }
      const copies = klClonerCopies(l, v, aspect, layout, effectors);
      const sx = vs('x') * W, sy = (1 - vs('y')) * H;
      c.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
      if (src.kind === 'null') {
        for (const cp of copies) if (!cp.hidden && cp.alpha > 0) { c.globalAlpha = cp.alpha; klDrawNull(c, src, cp.x, cp.y, vs('size') * cp.scale, dpr, W, H, 0); }
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        return;
      }
      // The source, once, at its own place, and the box worth blitting.
      const scratch = klCanvas(pool, 'cloner:' + l.id, W, H), s = scratch.getContext('2d');
      let box = null;
      if (src.kind === 'shape') {
        s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, W, H);
        klDrawShape(s, src, vs, W, H, dpr, maskShows.get(src.id) || null, false, false);
        const ext = (Math.hypot(vs('w'), vs('h')) / 2) * H + vs('strokeWidth') * dpr + 4;
        box = { x: Math.max(0, Math.floor(sx - ext)), y: Math.max(0, Math.floor(sy - ext)), w: 0, h: 0 };
        box.w = Math.min(W, Math.ceil(sx + ext)) - box.x; box.h = Math.min(H, Math.ceil(sy + ext)) - box.y;
      } else if (src.kind === 'text' || src.kind === 'image' || src.kind === 'camera') {
        const img = src.kind === 'image' ? env.image(src.src) : src.kind === 'camera' ? cam : null;
        if (src.kind !== 'text' && !img) return;
        klPaintShape(s, src, vs, W, H, img, src.text, null);
        if (src.kind === 'text') {
          const size = Math.max(1, vs('size') * H); s.font = src.weight + ' ' + size + 'px ' + klFontFor(src);
          const lines = String(src.text).split('\n'); let wmax = 0; for (const ln of lines) wmax = Math.max(wmax, s.measureText(ln).width);
          const ext = Math.hypot(wmax, size * 1.3 * lines.length) / 2 + 4;
          box = { x: Math.max(0, Math.floor(sx - ext)), y: Math.max(0, Math.floor(sy - ext)), w: 0, h: 0 };
          box.w = Math.min(W, Math.ceil(sx + ext)) - box.x; box.h = Math.min(H, Math.ceil(sy + ext)) - box.y;
        }
      } else return;
      if (box && (box.w <= 0 || box.h <= 0)) box = null;
      for (const cp of copies) klDrawCopy(c, cp, sx, sy, W, H, scratch, box);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    const drawOne = (c, l) => {
      const v = k => env.value(l, k);
      c.save();
      try {
        switch (l.kind) {
          case 'null': break; // markers are drawn last, above everything
          case 'text': case 'image': case 'camera': {
            const opacity = v('opacity');
            if (opacity <= 0) break;
            const src = l.kind === 'image' ? env.image(l.src) : l.kind === 'camera' ? cam : null;
            if (l.kind !== 'text' && !src) break;
            let text = l.text, anim = null;
            if (l.kind === 'text' && l.sequence) {
              const t = textState(l, time), lines = String(l.text).split('\n');
              text = lines[t.index] ?? '';
              const age = time - t.changedAt, e = Math.min(1, Math.max(0, age / 0.35));
              if (l.transition === 'fade') anim = { alpha: e, dy: 0, chars: -1 };
              else if (l.transition === 'rise') anim = { alpha: e, dy: (1 - e) * (1 - e) * 0.08, chars: -1 };
              else if (l.transition === 'type') anim = { alpha: 1, dy: 0, chars: Math.floor(Math.max(0, age) * 28) };
            }
            const scratch = klCanvas(pool, 'scratch', W, H), s = scratch.getContext('2d');
            klPaintShape(s, l, v, W, H, src, text, anim);
            klMatte(c, s, scratch, l, gl, W, H, opacity, env.hidden, l.matte === 'luma' ? luma() : null);
            break;
          }
          case 'shape':
            klDrawShape(c, l, v, W, H, dpr, maskShows.get(l.id) || null, env.editing, env.selectedId === l.id);
            break;
          case 'cloner': drawCloner(c, l, v); break;
          case 'script': drawScript(c, l, v); break;
          case 'particles': drawParticleLayer(c, l, v, env, record, zones, zoneById, pictureFor(l.readFrom, l.detail), pending.get(l.id), W, H, dpr, aspect, time, dt, pointer, gl); break;
          case 'bodies': {
            const sizeH = (v('size') * dpr) / H;
            const key = l.source + '|' + l.text + '|' + l.count;
            let b = bodies.get(l.id);
            if (!b || b.key !== key) { b = { key, st: bdCreate(l, aspect, sizeH, Math.random) }; bodies.set(l.id, b); }
            b.st.frozen = frozen.has(l.id);
            const walls = zones.filter(z => !z.affects || z.affects === l.id);
            const solid = l.solidPicture && coarse ? geoFieldFromBrightness(coarse, KIT_COARSE_W, KIT_COARSE_H, v('threshold')) : null;
            bdStep(b.st, l, v, dt, aspect, sizeH, walls, solid);
            bdDraw(c, b.st, l, v, W, H, dpr, aspect);
            break;
          }
          case 'audio': {
            let st = audios.get(l.id);
            if (!st) { st = {}; audios.set(l.id, st); }
            klDrawAudio(c, l, v, W, H, dpr, env.audioFor ? env.audioFor(l) : env.audio, st, time);
            break;
          }
          case 'glyphs': {
            const cell = Math.max(3, v('cell') * dpr), cols = Math.max(1, Math.min(320, Math.ceil(W / cell))), rows = Math.max(1, Math.min(240, Math.ceil(H / cell)));
            const fromLayer = l.readFrom === 'layer';
            const src = fromLayer ? pool['src:' + l.sourceId] || null : l.readFrom === 'camera' ? cam : gl;
            if (!src) break;
            const grid = sampleInto('glyphGrid', src, cols, rows, l.readFrom === 'camera' && camMirror);
            if (grid) klDrawGlyphs(c, l, v, W, H, dpr, grid, cols, rows, pool, l.readFrom === 'camera' ? null : src, fromLayer);
            break;
          }
          case 'contours': {
            const pic = pictureFor(l.readFrom, l.detail);
            if (pic) klDrawContours(c, l, v, W, H, dpr, pic.s, pic.w, pic.h, time);
            break;
          }
          case 'lens': {
            let px = v('x'), py = v('y');
            if (l.follow === 'mouse' && pointer.over) { px = pointer.x; py = pointer.y; }
            else if (l.follow === 'null') { const n = nullPos(record, env, l.nullId); if (n) { px = n.x; py = n.y; } }
            klDrawLens(c, l, v, W, H, dpr, gl, px, py, pool);
            break;
          }
          case 'brush': {
            const b = brushState(l.id);
            let at = null, painting = false;
            if (l.paint === 'drag') { painting = pointer.down && pointer.over; at = pointer; }
            else if (l.paint === 'hover') { painting = pointer.over; at = pointer; }
            else if (l.paint === 'null') { at = nullPos(record, env, l.nullId); painting = !!at; }
            if (painting && at) {
              if (!b.was) b.stroke++;
              const last = b.pts[b.pts.length - 1];
              if (!last || last.s !== b.stroke || Math.hypot((at.x - last.x) * aspect, at.y - last.y) > 0.003) {
                let css = klCss(l.color);
                if (l.colour === 'palette') css = paletteCssAt(l.palette, time * 0.15);
                else if (l.colour === 'picture' && coarse) { const px = Math.max(0, Math.min(KIT_COARSE_W - 1, Math.floor(at.x * KIT_COARSE_W))), py = Math.max(0, Math.min(KIT_COARSE_H - 1, Math.floor((1 - at.y) * KIT_COARSE_H))), k = (py * KIT_COARSE_W + px) * 4; css = 'rgb(' + coarse[k] + ',' + coarse[k + 1] + ',' + coarse[k + 2] + ')'; }
                b.pts.push({ x: at.x, y: at.y, t: time, css, s: b.stroke });
              }
            }
            b.was = painting;
            const fadeS = v('fade');
            if (fadeS > 0) { let cut = 0; while (cut < b.pts.length && time - b.pts[cut].t > fadeS) cut++; if (cut) b.pts.splice(0, cut); }
            if (b.pts.length > 3000) b.pts.splice(0, b.pts.length - 3000);
            klDrawBrush(c, l, v, W, H, dpr, b, time);
            break;
          }
        }
      } finally { c.restore(); }
    };
    // Layers a glyph layer reads are also drawn into a canvas of their own (even while hidden), for it to sample.
    const glyphSources = new Set();
    for (const l of layers) if (l.kind === 'glyphs' && l.readFrom === 'layer' && l.sourceId && l.sourceId !== l.id && isVisible(l)) glyphSources.add(l.sourceId);
    const drawLayer = (c, l) => {
      if (!glyphSources.has(l.id)) { drawOne(c, l); return; }
      const off = klCanvas(pool, 'src:' + l.id, W, H), o = off.getContext('2d');
      o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, W, H);
      drawOne(o, l);
      if (isVisible(l)) c.drawImage(off, 0, 0);
    };
    const drawn = l => isVisible(l) || glyphSources.has(l.id);
    const tap = env.shaderTap;
    if (tap) {
      // The Layers node: draw what it sees into a buffer of its own, hand that over, then lay it on the overlay.
      const buf = klCanvas(pool, 'shaderBuf', W, H), b = buf.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0); b.globalAlpha = 1; b.globalCompositeOperation = 'source-over';
      b.clearRect(0, 0, W, H);
      for (const l of layers) if (drawn(l) && l.toShader !== false) drawLayer(b, l);
      tap(shaderTapOf(buf, W, H, aspect));
      ctx.drawImage(buf, 0, 0);
      for (const l of layers) if (drawn(l) && l.toShader === false) drawLayer(ctx, l);
    } else for (const l of layers) if (drawn(l)) drawLayer(ctx, l);

    // While editing: a particles layer's field and forces, on top (never into the Layers node).
    if (env.editing) for (const l of layers) {
      if (l.kind !== 'particles' || !l.showField || !isVisible(l)) continue;
      const s = parts.get(l.id);
      if (!s || !s.penv) continue;
      const rows = 14, cols = Math.max(4, Math.round(rows * aspect));
      klDrawFieldPreview(ctx, particleFieldGrid(s.p, s.penv, cols, rows, s.sim.seed), cols, rows, W, H, dpr, s.penv.attractorPoint, s.penv.zones);
    }

    // 6. Sensors.
    for (const z of zones) {
      if (!zoneById.has(z.id)) continue;
      const fill = z.total > 0 ? Math.min(1, (z.inside / z.total) / Math.max(0.004, z.area) / 2) : 0;
      report(env, z.id + '::fill', fill);
      report(env, z.id + '::hover', pointer.over && z.dist(pointer.x, pointer.y) < 0 ? 1 : 0);
    }
    for (const l of vis) {
      if (l.kind === 'particles') {
        const p = parts.get(l.id);
        if (!p) continue;
        const sim = p.sim, maxV = Math.max(1e-6, env.value(l, 'speed') * 0.18);
        let sp = 0, n = 0, mx = 0, my = 0, mxx = 0, myy = 0;
        for (let i = 0; i < sim.count; i++) { if (!sim.alive[i]) continue; n++; sp += Math.hypot(sim.vx[i], sim.vy[i]); const X = sim.x[i] * aspect, Y = sim.y[i]; mx += X; my += Y; mxx += X * X; myy += Y * Y; }
        if (n) {
          mx /= n; my /= n;
          report(env, l.id + '::speed', Math.min(1, sp / n / maxV));
          report(env, l.id + '::spread', Math.min(1, Math.sqrt(Math.max(0, mxx / n - mx * mx + myy / n - my * my)) / (0.29 * Math.hypot(aspect, 1))));
        } else { report(env, l.id + '::speed', 0); report(env, l.id + '::spread', 0); }
      } else if (l.kind === 'camera') report(env, l.id + '::motion', cam ? motion : 0);
    }

    // 7. Null markers on top of everything.
    if (env.markers) for (const l of vis) if (l.kind === 'null') klDrawNull(ctx, l, env.value(l, 'x'), env.value(l, 'y'), env.value(l, 'size'), dpr, W, H, l.role && l.role !== 'none' ? env.value(l, 'radius') * H : 0);
  }

  /**
   * What the Layers node reads: the layers at half resolution (colour), and
   * a signed distance to them (graph UV units, a picture height = 2) packed
   * 16-bit into red and green of an RGBA grid, row 0 at the top.
   */
  function shaderTapOf(buf, W, H, aspect) {
    const cw = Math.max(1, Math.round(W / 2)), ch = Math.max(1, Math.round(H / 2));
    const color = klCanvas(pool, 'shaderColor', cw, ch), cx = color.getContext('2d');
    cx.clearRect(0, 0, cw, ch); cx.drawImage(buf, 0, 0, cw, ch);
    const gh = 180, gw = Math.max(8, Math.round(gh * aspect));
    const small = klCanvas(pool, 'shaderMask', gw, gh), sx = small.getContext('2d', { willReadFrequently: true });
    klDownscale(pool, 'shaderHalf', buf, W, H, sx, gw, gh);
    let data;
    try { data = sx.getImageData(0, 0, gw, gh).data; } catch (e) { data = new Uint8ClampedArray(gw * gh * 4); }
    // Coverage, not a yes/no threshold: a particle smaller than a cell counts as a small disc, so it
    // doesn't blink in and out of the field as it crosses cells. Barely-there pixels (faint trails) don't count.
    const cover = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) cover[i] = data[i * 4 + 3] / 255;
    const f = geoFieldFromCoverage(cover, gw, gh, 0.04);
    const field = new Uint8Array(gw * gh * 4);
    for (let i = 0; i < gw * gh; i++) {
      const u = Math.max(0, Math.min(1, f.d[i] * 2 * 0.25 + 0.5)), q = Math.round(u * 65535);
      field[i * 4] = q >> 8; field[i * 4 + 1] = q & 255; field[i * 4 + 3] = 255;
    }
    return { color, field, gw, gh };
  }

  function report(env, key, v) {
    if (sensorVals.get(key) === v) return;
    sensorVals.set(key, v);
    if (env.sensor) env.sensor(key, v);
  }

  function drawParticleLayer(ctx, l, v, env, record, zones, zoneById, pic, actions, W, H, dpr, aspect, time, dt, pointer, gl) {
    const num = key => v(key);
    const p = Object.assign({}, l);
    // Every number can be driven (a control or a mapping), except the ones that rebuild the layer.
    for (const k in l) if (typeof l[k] === 'number' && k !== 'count' && k !== 'seed' && k !== 'palette') p[k] = num(k);
    const nul = l.nullId ? nullPos(record, env, l.nullId) : null;
    const mine = zones.filter(z => !z.affects || z.affects === l.id);
    const penv = {
      dt, time, aspect, sample: pic ? pic.s : null, sw: pic ? pic.w : KIT_COARSE_W, sh: pic ? pic.h : KIT_COARSE_H,
      attractorPoint: l.attractor === 'mouse' ? (pointer.over ? pointer : null) : l.attractor === 'press' ? (pointer.over && pointer.down ? pointer : null) : l.attractor === 'null' ? nul : null,
      spawnPoint: nul, modPoint: nul, zones: mine, emitters: mine.filter(z => z.action === 'emitter'), zoneById,
      W, H, dpr, alpha: 1, sprite: l.shape === 'image' ? env.image(l.sprite) : null,
    };
    let s = parts.get(l.id);
    const dead = l.emit === 'burst';
    if (!s || s.seedUsed !== l.seed || s.emit !== l.emit) {
      const rand = seededRandom(l.seed);
      s = { sim: createParticles(l.count, rand, dead), trail: s ? s.trail : null, rand, seedUsed: l.seed, emit: l.emit };
      parts.set(l.id, s);
    } else if (s.sim.count !== l.count) s.sim = resizeParticles(s.sim, l.count, s.rand, dead);
    const sim = s.sim;
    s.p = p; s.penv = penv;
    if (actions) for (const a of actions) {
      if (a.do === 'burst') burstParticles(sim, p, penv, a.amount || 60, s.rand);
      else if (a.do === 'scatter') scatterParticles(sim, p, (a.amount || 1) * (p.scatter ?? 1), s.rand);
      else if (a.do === 'reset') resetParticles(sim, p, penv, s.rand);
    }
    if (!frozen.has(l.id)) stepParticles(sim, p, penv, s.rand);
    const opacity = p.opacity, trail = p.trail;
    if (!(trail > 0) && !l.reveal) {
      ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
      penv.alpha = opacity;
      drawParticles(ctx, sim, p, penv);
      return;
    }
    // Their own canvas keeps the trail, and lets Mask turn them into a stencil for the picture.
    if (!s.trail) s.trail = document.createElement('canvas');
    if (s.trail.width !== W || s.trail.height !== H) { s.trail.width = W; s.trail.height = H; }
    const t = s.trail.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalAlpha = 1;
    if (trail > 0) {
      // Fade by time, not by frame, so trails are the same length at 60 and 120 Hz.
      const perFrame60 = Math.max(0.02, 1 - Math.pow(trail, 0.6));
      const a = 1 - Math.pow(1 - perFrame60, Math.max(0.25, dt * 60));
      t.globalCompositeOperation = 'destination-out'; t.fillStyle = 'rgba(0,0,0,' + a + ')'; t.fillRect(0, 0, W, H);
      t.globalCompositeOperation = 'source-over';
    } else t.clearRect(0, 0, W, H);
    drawParticles(t, sim, p, penv);
    let out = s.trail;
    if (l.reveal) {
      const scratch = klCanvas(pool, 'scratch', W, H), sc = scratch.getContext('2d');
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalAlpha = 1; sc.globalCompositeOperation = 'source-over'; sc.clearRect(0, 0, W, H);
      sc.drawImage(s.trail, 0, 0); sc.globalCompositeOperation = 'source-in'; sc.drawImage(gl, 0, 0, W, H); sc.globalCompositeOperation = 'source-over';
      out = scratch;
    }
    ctx.globalAlpha = opacity; ctx.globalCompositeOperation = KL_BLEND[l.blend] || 'source-over';
    ctx.drawImage(out, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  return {
    frame,
    /** Queue an action ({ do, layerId, amount }); it happens on the next frame. */
    act(a) { queue.push(a); },
    /** Topmost visible shape under (x, y) (0..1, y up), for clicks and dragging. */
    shapeAt(record, x, y, aspect, value) {
      for (let i = record.layers.length - 1; i >= 0; i--) {
        const l = record.layers[i];
        if (l.kind !== 'shape' || !(shown.has(l.id) ? shown.get(l.id) : l.visible) || l.shape === 'picture') continue;
        const v = k => value(l, k);
        if (l.shape === 'layer') { const m = masks.get(l.id); if (m && geoCompile({ id: l.id, shape: 'field', field: m.field, invert: l.invert, x: 0, y: 0, w: 1, h: 1 }, aspect).dist(x, y) < 0) return l.id; continue; }
        const z = geoCompile({ id: l.id, shape: l.shape, x: v('x'), y: v('y'), w: v('w'), h: v('h'), rotation: v('rotation'), round: v('round'), points: l.points, invert: l.invert }, aspect);
        if (z.dist(x, y) < Math.max(0.01, 0)) return l.id;
      }
      return null;
    },
    /** Does anything need a new frame every tick (particles, bodies, a following null…)? */
    isAnimated(record) {
      return record.layers.some(l => (shown.has(l.id) ? shown.get(l.id) : l.visible) && (KIT_ANIMATED[l.kind] || (l.kind === 'null' && l.follow !== 'none') || (l.kind === 'text' && l.sequence) || (l.kind === 'contours' && l.flow !== 0) || (l.kind === 'glyphs' && l.readFrom === 'camera')));
    },
    /** Forget all state (a new recording starts from scratch). */
    reset() { parts.clear(); scripts.clear(); scriptPresses.clear(); bodies.clear(); brushes.clear(); springs.clear(); texts.clear(); audios.clear(); masks.clear(); frozen.clear(); shown.clear(); queue = []; sensorVals.clear(); },
  };
}
