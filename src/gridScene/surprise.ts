/**
 * surprise.ts — the Grid builder's Surprise me (docs/grid-builder.md): a whole grid scene from a
 * seed. The same seed always gives the same scene. Pure.
 *
 *   - a grid of 6–14 cells, one to three shapes in one harmonious palette on a dark ground;
 *   - cells drawn as a motif: a mirrored pixel sprite, a ring, a diagonal, a border or a scatter;
 *   - motion for most shapes (paths and reaches that stay readable), a pattern most of the time
 *     (sometimes filling the empty cells), now and then a warp from the 2D builder's library and a
 *     rule between two shapes.
 */
import { darkBackground, harmoniousPalette, makeRng, type Rng } from '../lib/surprise';
import { BLOCK_BY_ID, blockFromEntry } from '../sceneBuilder2d/blockLibrary';
import {
  PATTERN_KINDS, SHAPE_IDS, emptyGridScene, newShape, placeCell, warpOf,
  type GridSceneSpec, type MotionPath, type PatternTarget, type ShapeKind, type Vec3,
} from './spec';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Warps that bend a grid without tearing it apart (the rest of the library is one click away in Patterns & warps). */
const GENTLE = ['sine-shift', 'sine-weave', 'cross-sines', 'ripple-rings', 'water', 'standing-waves', 'twirl', 'spiral', 'mirror-both', 'kaleidoscope', 'eight-fold', 'wavy-mirror', 'noise-push', 'exp-bulge', 'soft-squash'];
const KINDS: Array<readonly [ShapeKind, number]> = [['circle', 4], ['square', 2], ['ring', 2], ['diamond', 2], ['star', 2], ['heart', 1], ['hexagon', 1], ['triangle', 1], ['plus', 1], ['cross', 1]];
const PATHS: Array<readonly [MotionPath, number]> = [['still', 3], ['updown', 3], ['sideways', 2], ['circle', 3], ['eight', 1], ['bounce', 1], ['both', 1], ['travel', 1], ['hop', 1]];
type Motif = 'sprite' | 'ring' | 'diagonal' | 'border' | 'scatter';

function draw(rng: Rng, s: GridSceneSpec, id: string, motif: Motif): void {
  const { cols, rows } = s;
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const put = (x: number, y: number) => { placeCell(s, x, y, id); };
  switch (motif) {
    case 'sprite': {
      // A mirrored pixel sprite in the middle (invaders, masks).
      const w = Math.min(cols - 2, rng.int(5, 8)), h = Math.min(rows - 2, rng.int(5, 8));
      const x0 = Math.floor((cols - w) / 2), y0 = Math.floor((rows - h) / 2);
      for (let j = 0; j < h; j++) for (let i = 0; i < Math.ceil(w / 2); i++) {
        if (!rng.chance(0.55)) continue;
        put(x0 + i, y0 + j);
        put(x0 + w - 1 - i, y0 + j);
      }
      break;
    }
    case 'ring': {
      const r = rng.float(0.3, 0.45) * Math.min(cols, rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.abs(Math.hypot(x - cx, y - cy) - r) < 0.6) put(x, y);
      break;
    }
    case 'diagonal': {
      const flip = rng.chance(0.5);
      for (let i = 0; i < Math.min(cols, rows); i++) { put(flip ? cols - 1 - i : i, i); if (rng.chance(0.4)) put(flip ? cols - 1 - i : i, rows - 1 - i); }
      break;
    }
    case 'border':
      for (let x = 0; x < cols; x++) { put(x, 0); put(x, rows - 1); }
      for (let y = 1; y < rows - 1; y++) { put(0, y); put(cols - 1, y); }
      break;
    default:
      for (let k = 0; k < Math.round(cols * rows * rng.float(0.12, 0.25)); k++) put(rng.int(0, cols - 1), rng.int(0, rows - 1));
  }
}

/** A random, good-looking grid scene from `seed`. */
export function surpriseGridScene(seed: number | string): GridSceneSpec {
  const rng = makeRng(seed);
  const s = emptyGridScene();
  const g = rng.fork('grid');
  s.cols = g.int(6, 14);
  s.rows = g.chance(0.7) ? s.cols : g.int(6, 14);
  s.span = r3(g.float(0.8, 0.95));

  const lk = rng.fork('look');
  const n = lk.weighted([[1, 3], [2, 4], [3, 2]] as const);
  const cols = harmoniousPalette(lk, n, { light: [0.55, 0.72], sat: [0.65, 0.95] });
  s.look.bg = darkBackground(lk) as Vec3;
  s.look.lines = lk.chance(0.6);
  s.look.lineWidth = r3(lk.float(0.02, 0.05));
  s.look.glowAmount = r3(lk.float(0.003, 0.009));
  s.look.glowFalloff = r3(lk.float(1.2, 1.6));

  const sh = rng.fork('shapes');
  s.shapes = [];
  const motifs: Motif[] = ['sprite', 'ring', 'diagonal', 'border', 'scatter'];
  for (let i = 0; i < n; i++) {
    const id = SHAPE_IDS[i];
    const shape = newShape(id, { kind: sh.weighted(KINDS), color: cols[i] as Vec3, size: r3(sh.float(0.45, 0.85)) });
    if (sh.chance(0.25)) shape.outline = r3(sh.float(0.06, 0.15));
    if (sh.chance(0.25)) shape.spin = r3(sh.float(0.1, 0.5) * sh.sign());
    if (sh.chance(0.25)) shape.pulse = r3(sh.float(0.2, 0.6));
    const path = i === 0 && sh.chance(0.3) ? 'still' : sh.weighted(PATHS);
    const travel = path === 'travel' || path === 'hop';
    shape.motion = {
      path,
      xy: travel ? (sh.chance(0.5) ? [sh.chance(0.5) ? 1 : -1, 0] : [0, sh.chance(0.5) ? 1 : -1]) : [r3(sh.float(0.15, 0.45)), r3(sh.float(0.15, 0.45))],
      speed: r3(sh.float(0.2, 0.6) * (travel ? 1 : sh.sign())),
      lag: sh.chance(0.6) ? r3(sh.float(0.03, 0.12)) : 0,
    };
    s.shapes.push(shape);
    draw(sh.fork(`cells${i}`), s, id, i === 0 ? sh.pick(motifs) : sh.pick(['scatter', 'diagonal', 'border', 'ring'] as Motif[]));
  }

  const pt = rng.fork('pattern');
  if (pt.chance(0.7)) {
    s.pattern.kind = pt.pick(PATTERN_KINDS.filter(k => k !== 'none'));
    s.pattern.target = pt.weighted<PatternTarget>([['size', 4], ['turn', 2], ['hue', 2], ['bright', 2], ['push', 1]]);
    s.pattern.amount = r3(pt.float(0.3, 0.8));
    s.pattern.freq = r3(pt.float(2, 6));
    s.pattern.speed = r3(pt.float(0.15, 0.5));
    s.pattern.arms = pt.int(2, 5);
    if (pt.chance(0.45)) s.pattern.fill = pt.pick(s.shapes).id;
  }
  const wp = rng.fork('warp');
  if (wp.chance(0.35)) {
    const b = blockFromEntry(BLOCK_BY_ID[wp.pick(GENTLE)]);
    // Gently: its strength somewhere up to its default, so the cells stay readable.
    for (const p of b.params) if (/amp|amount|strength|twist|power/i.test(p.name)) p.value = r3(p.min + (p.value - p.min) * wp.float(0.4, 1));
    s.warps.push(warpOf(b));
  }
  const ru = rng.fork('rules');
  if (s.shapes.length > 1 && ru.chance(0.4)) {
    const [a, b] = s.shapes;
    s.rules.push(ru.chance(0.5)
      ? { id: 'r1', on: true, when: { kind: 'sameCell', a: b.id, b: a.id }, do: { kind: 'swap' } }
      : { id: 'r1', on: true, when: { kind: 'column', a: b.id, x: ru.int(0, s.cols - 1) }, do: { kind: 'become', shape: a.id } });
  }
  return s;
}
