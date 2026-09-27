/**
 * queue.js — the Background layer's queue (types/playLayers.ts
 * BackgroundLayer): which source shows, the Change background actions, the
 * crossfade, and the background painted with its transform. Plain JS, shared
 * by the app (overlay.ts) and exported pages (runtime/play-runtime.js).
 *
 * The state per layer is small and lives in the kit, so a take's actions and
 * a render starting from a fresh kit reproduce every change frame for frame:
 *   step    what Next / Previous / Random / Go to added to the index
 *   toId    the source showing (or fading in)
 *   fromId  the source fading out ('' when none)
 *   at      when the change started, on the graph clock
 * Names start with `bq` so the file can share the exported page's scope with
 * the kit's other files.
 */
import { klCss, klFitRect } from './layers.js';

/** A queue position: index + actions' steps + offset, wrapped into the queue (-1 when it is empty). As types/playLayers.ts queueSlot. */
export function bqSlot(index, step, offset, n) {
  if (!(n > 0)) return -1;
  const k = Math.round(isFinite(index) ? index : 0) + Math.round(step) + Math.round(isFinite(offset) ? offset : 0);
  return ((k % n) + n) % n;
}

export function bqState() { return { step: 0, toId: '', fromId: '', at: 0, started: false }; }

/**
 * A Change background action. `value(key)` reads the layer's live values (a
 * mapping may drive the index). Returns false for actions it doesn't handle
 * (show, hide, toggle), which the kit carries out as for any layer.
 */
export function bqAct(st, layer, value, a, rand) {
  const n = layer.sources.length;
  const cur = () => bqSlot(value('index'), st.step, value('offset'), n);
  switch (a.do) {
    case 'next': st.step += 1; break;
    case 'prev': st.step -= 1; break;
    case 'shuffle': {
      if (n < 2) break;
      const c = cur();
      let k = Math.floor(rand() * (n - 1));
      if (k >= c) k++;
      st.step += k - c;
      break;
    }
    case 'goto': {
      if (!n) break;
      const want = Math.max(0, Math.min(n - 1, Math.round(a.amount || 1) - 1));
      st.step += want - cur();
      break;
    }
    case 'reset': st.step = 0; break;
    default: return false;
  }
  if (n > 0) st.step = ((st.step % n) + n) % n;
  return true;
}

const near = (a, b) => Math.abs(a - b) < 1e-4;

/**
 * What shows at `time`: `items` bottom to top, each with its alpha (the
 * outgoing source at 1 under the incoming one fading in), the transform, and
 * `direct` when the host can skip painting it (one graph, untransformed,
 * already on the GL canvas; only with `allowDirect`). A change of the showing
 * source starts a crossfade (or cuts). Calling it twice at one time gives the
 * same answer, so a host may ask before drawing and the kit again while it draws.
 */
export function bqPlan(st, layer, value, time, visible, allowDirect) {
  const sources = layer.sources || [];
  const n = sources.length;
  const slot = bqSlot(value('index'), st.step, value('offset'), n);
  const to = slot >= 0 ? sources[slot] : null;
  const toId = to ? to.id : '';
  const find = id => (id ? sources.find(s => s.id === id) || null : null);
  const duration = Math.max(0, value('duration'));
  if (toId !== st.toId) {
    const fade = layer.transition === 'fade' && duration > 0 && st.started && !!find(st.toId) && !!to;
    st.fromId = fade ? st.toId : '';
    st.toId = toId;
    st.at = time;
    st.started = true;
  }
  let mix = 1;
  let from = find(st.fromId);
  if (from) {
    // The clock went back (↺, a take scrubbed back): the change is over.
    mix = time < st.at ? 1 : Math.min(1, (time - st.at) / Math.max(1e-3, duration));
    if (mix >= 1) { st.fromId = ''; from = null; }
  } else st.fromId = '';
  const items = [];
  if (visible) {
    if (from) items.push({ item: from, alpha: 1 });
    if (to) items.push({ item: to, alpha: from ? mix : 1 });
  }
  const transform = { x: value('x'), y: value('y'), scale: value('scale'), rotation: value('rotation') };
  const identity = near(transform.x, 0.5) && near(transform.y, 0.5) && near(transform.scale, 1) && near(((transform.rotation % 360) + 360) % 360, 0);
  return {
    layerId: layer.id, slot, items, mix, fading: !!from, transform, identity,
    fit: layer.fit || 'cover', colour: layer.colour || [0, 0, 0],
    direct: !!allowDirect && items.length === 1 && items[0].item.kind === 'graph' && identity,
  };
}

/**
 * Paint the background into canvas `c` (W×H): the layer's colour, then each
 * showing source with its alpha, fitted (images, videos) or filling the
 * picture (graphs, sketches), moved, scaled and turned about its centre.
 * `frameOf(item)` gives { el, w, h, full } for a source, or null while it has
 * nothing to show. A colour source is a flat fill (it has no shape to move).
 */
export function bqCompose(c, plan, W, H, frameOf) {
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  x.fillStyle = klCss(plan.colour); x.fillRect(0, 0, W, H);
  const t = plan.transform;
  for (const { item, alpha } of plan.items) {
    if (!(alpha > 0)) continue;
    x.globalAlpha = Math.min(1, alpha);
    if (item.kind === 'colour') { x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = klCss(item.colour || [0, 0, 0]); x.fillRect(0, 0, W, H); continue; }
    const f = frameOf(item);
    if (!f || !f.el) continue;
    const r = f.full ? { x: 0, y: 0, w: W, h: H } : klFitRect(plan.fit, f.w, f.h, W, H);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.translate(t.x * W, (1 - t.y) * H);
    x.rotate((t.rotation * Math.PI) / 180);
    x.scale(t.scale, t.scale);
    x.imageSmoothingQuality = 'high';
    try { x.drawImage(f.el, r.x - W / 2, r.y - H / 2, r.w, r.h); } catch (e) { /* a frame that isn't decodable yet */ }
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  return c;
}
