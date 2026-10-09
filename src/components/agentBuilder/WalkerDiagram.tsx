/**
 * WalkerDiagram — the Agent Builder's viewport diagram (docs/agent-builder.md), drawn over the
 * live picture for the selected section, and for the setting under the pointer or being dragged:
 *
 *  - Senses: one walker up close in a lens (the live picture dimmed behind it), its three
 *    feelers "How far ahead" at ±"How wide", labelled (the field guide's figure 2.4);
 *  - Turning: the turn arc to the new heading (How sharply) and the wobble's fan;
 *  - Moving: the last steps behind it (Speed), or an edge of the picture with what happens there;
 *  - Trail: the dots it left, fading behind it, and how far they spread;
 *  - Born: the shape they are born in, at its true size on the picture.
 *
 * The lens keeps its magnification while a slider moves (diagram.ts keepRef), so the feelers
 * grow and shrink as you drag.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import type { TrailCards } from '../../agentBuilder/cards';
import {
  type DiagramFocus, type Lens, type Pt, along, arcPath, feelers, lensFor, picToView, stepsBehind, stepsToFeelers, usesLens, wedgePath,
} from '../../agentBuilder/diagram';
import type { ViewRect } from '../builders/studio/LiveViewport';
import { sphereOnPicture } from '../../agentBuilder/diagram';
import { agCamera3, agProject3 } from '../../play/kit/agentPlan.js';

const readNum = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

/**
 * A 3D Emit's shape through Draw agents' camera (agentPlan.js agCamera3 at its start, before it
 * orbits): a ball as a shaded sphere with its equator and a meridian (the far halves dashed), a
 * shell as the same lines without the fill, a box and the whole box as their twelve edges.
 */
function Born3d({ born, camera, image, hot, label, accent }: {
  born: BornInfo; camera: { params: Record<string, unknown>; mirror?: boolean }; image: ViewRect; hot: boolean; accent: string;
  label: (p: Pt, text: string, opts?: { hot?: boolean; anchor?: 'start' | 'middle' | 'end'; key?: string }) => React.ReactNode;
}) {
  const cam = agCamera3({ params: camera.params, mirror: camera.mirror }, readNum, 0, image.h);
  const project = (p: [number, number, number]) => agProject3(cam, p);
  const toView = (p: Pt) => picToView(image, p);
  const aspect = image.w / Math.max(image.h, 1);
  const c: [number, number, number] = [born.x, born.y, born.z ?? 0];
  const poly = (pts: Array<Pt & { back: boolean }>, back: boolean) => {
    // Split into runs of front or back points.
    const runs: string[] = [];
    let cur: string[] = [];
    pts.forEach((p, i) => {
      if (p.back === back) cur.push(`${i && cur.length ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
      else if (cur.length) { runs.push(cur.join(' ')); cur = []; }
    });
    if (cur.length) runs.push(cur.join(' '));
    return runs.join(' ');
  };
  const sw = hot ? 3 : 2;
  let shape: React.ReactNode;
  let top: Pt;
  if (born.shape === 'ball' || born.shape === 'sphere') {
    const s = sphereOnPicture(project, toView, c, born.size);
    top = { x: s.centre.x, y: s.centre.y - s.radius };
    shape = (
      <g data-born3d={born.shape} data-born3d-r={s.radius.toFixed(1)}>
        <defs>
          <radialGradient id="ab-ball" cx="38%" cy="34%" r="70%">
            <stop offset="0%" stopColor="rgba(140,170,255,0.45)" /><stop offset="100%" stopColor="rgba(58,111,247,0.08)" />
          </radialGradient>
        </defs>
        <circle cx={s.centre.x} cy={s.centre.y} r={Math.max(s.radius, 2)} fill={born.shape === 'ball' ? 'url(#ab-ball)' : 'none'} stroke={accent} strokeWidth={sw} />
        {[s.equator, s.meridian, s.side].map((ring, i) => <g key={i}>
          <path d={poly(ring, true)} fill="none" stroke={accent} strokeWidth={1.2} strokeDasharray="4 5" opacity={0.6} />
          <path d={poly(ring, false)} fill="none" stroke={accent} strokeWidth={1.6} opacity={i === 2 ? 0.5 : 0.9} />
        </g>)}
      </g>
    );
  } else if (born.shape === 'point') {
    const p = toView(project(c));
    top = { x: p.x, y: p.y - 8 };
    shape = <circle data-born3d="point" cx={p.x} cy={p.y} r={6} fill={accent} />;
  } else {
    const hx = born.shape === 'screen' ? aspect : born.size, hy = born.shape === 'screen' ? 1 : born.size, hz = born.shape === 'screen' ? 1 : born.size;
    const o: [number, number, number] = born.shape === 'screen' ? [0, 0, 0] : c;
    const corner = (i: number): [number, number, number] => [o[0] + (i & 1 ? hx : -hx), o[1] + (i & 2 ? hy : -hy), o[2] + (i & 4 ? hz : -hz)];
    const pts = Array.from({ length: 8 }, (_, i) => toView(project(corner(i))));
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) edges.push([i, i | b]);
    top = pts.reduce((a, p) => (p.y < a.y ? p : a), pts[0]);
    shape = (
      <g data-born3d={born.shape === 'screen' ? 'screen' : 'box'}>
        {edges.map(([a, b], k) => <line key={k} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} stroke={accent} strokeWidth={sw} strokeDasharray={born.shape === 'screen' ? '8 6' : undefined} />)}
      </g>
    );
  }
  return (
    <g data-diagram="born" data-born={born.shape} data-size={String(Math.round(born.size * 1000) / 1000)} data-born-3d="projected">
      {shape}
      {label({ x: top.x, y: Math.max(image.y + 18, top.y - 18) }, `born here · ${born.count.toUpperCase().replace('K', 'k')} walkers`, { hot, key: 'b3' })}
      {label({ x: image.x + image.w / 2, y: image.y + image.h - 18 }, 'through the 3D camera, as it starts (it then circles)', { key: 'b3cam' })}
    </g>
  );
}

export interface BornInfo { shape: string; size: number; x: number; y: number; z?: number; count: string }
export interface TrailInfo { halfLife: number; diffuse: number }

const fmt = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);

export function WalkerDiagram({ focus, cards, box, born, trail, lensRef, d3, camera, feelersShown = true }: {
  focus: DiagramFocus; cards: TrailCards; box: { w: number; h: number; image: ViewRect };
  born?: BornInfo; trail?: TrailInfo; lensRef: number; d3: boolean;
  /** In 3D: Draw agents' camera settings, to draw the Emit's ball, shell or box through it. */
  camera?: { params: Record<string, unknown>; mirror?: boolean };
  /** Moving: draw its feelers ahead (trail followers only). */
  feelersShown?: boolean;
}) {
  const tk = useTokens();
  const accent = tk.accent.base;
  const ink = 'rgba(255,255,255,0.92)';
  const faint = 'rgba(255,255,255,0.45)';
  const lens = lensFor(box.w, box.h, lensRef);
  const label = (p: Pt, text: string, opts: { hot?: boolean; anchor?: 'start' | 'middle' | 'end'; key?: string } = {}) => {
    const w = text.length * 6.6 + 14;
    const x = opts.anchor === 'start' ? p.x : opts.anchor === 'end' ? p.x - w : p.x - w / 2;
    return (
      <g key={opts.key ?? text} data-label={text}>
        <rect x={x} y={p.y - 11} width={w} height={22} rx={7} fill="rgba(13,13,18,0.82)" stroke={opts.hot ? accent : 'rgba(255,255,255,0.18)'} />
        <text x={x + w / 2} y={p.y + 4} textAnchor="middle" fill={opts.hot ? '#fff' : ink} style={{ font: `600 11.5px ${fontFamily.ui}` }}>{text}</text>
      </g>
    );
  };
  const walker = (l: Lens) => (
    <g data-walker>
      <path d={`M ${l.walker.x} ${l.walker.y - 11} L ${l.walker.x + 7} ${l.walker.y + 7} L ${l.walker.x} ${l.walker.y + 3} L ${l.walker.x - 7} ${l.walker.y + 7} Z`} fill={ink} />
    </g>
  );
  const hot = (s: string) => focus.setting === s;

  let body: React.ReactNode = null;
  const s = cards.senses;
  if (focus.section === 'senses') {
    const f = feelers(lens, s.distance, s.angle);
    const arcR = Math.min(f.length * 0.42, lens.r * 0.32);
    body = (
      <g data-diagram="senses" data-distance={fmt(s.distance, 4)} data-angle={fmt(s.angle, 2)} opacity={s.on ? 1 : 0.4}>
        {(['left', 'centre', 'right'] as const).map(k => (
          <g key={k}>
            <line data-feeler={k} x1={lens.walker.x} y1={lens.walker.y} x2={f[k].x} y2={f[k].y} stroke={k === 'centre' && hot('distance') ? accent : ink} strokeWidth={k === 'centre' && hot('distance') ? 2.5 : 1.6} strokeDasharray={k === 'centre' ? undefined : '5 4'} />
            <circle cx={f[k].x} cy={f[k].y} r={9} fill="rgba(13,13,18,0.6)" stroke={accent} strokeWidth={2} />
            <text x={f[k].x} y={f[k].y + 4} textAnchor="middle" fill="#fff" style={{ font: `700 10px ${fontFamily.ui}` }}>{k === 'left' ? 'L' : k === 'centre' ? 'C' : 'R'}</text>
          </g>
        ))}
        <path data-angle-arc d={arcPath(lens.walker, arcR, 0, s.angle)} fill="none" stroke={hot('angle') ? accent : faint} strokeWidth={hot('angle') ? 2.5 : 1.5} />
        {label(along(lens.walker, f.length * 0.55, Math.min(s.angle + 22, 150)), `How wide ${fmt(s.angle, 1)}°`, { hot: hot('angle'), anchor: 'end' })}
        {label(along(lens.walker, f.length * 0.55, -Math.min(s.angle + 22, 150)), `How far ahead ${fmt(s.distance)}`, { hot: hot('distance'), anchor: 'start' })}
        {walker(lens)}
      </g>
    );
  } else if (focus.section === 'turning') {
    const t = cards.turning;
    const r = lens.r * 0.72;
    body = (
      <g data-diagram="turning" data-turn={fmt(t.sharp, 2)} data-wobble={fmt(t.wobbleOn ? t.wobble : 0, 2)}>
        {t.wobbleOn && t.wobble > 0 && <path data-wobble-fan d={wedgePath(lens.walker, r * 0.95, t.wobble)} fill={hot('wobble') ? 'rgba(58,111,247,0.35)' : 'rgba(255,255,255,0.12)'} stroke={hot('wobble') ? accent : 'rgba(255,255,255,0.3)'} />}
        <line x1={lens.walker.x} y1={lens.walker.y} x2={lens.walker.x} y2={lens.walker.y - r} stroke={faint} strokeWidth={1.5} strokeDasharray="5 4" />
        {t.sharpOn && <>
          <line data-new-heading x1={lens.walker.x} y1={lens.walker.y} x2={along(lens.walker, r, t.sharp).x} y2={along(lens.walker, r, t.sharp).y} stroke={ink} strokeWidth={2} />
          <path data-turn-arc d={arcPath(lens.walker, r * 0.55, 0, t.sharp)} fill="none" stroke={hot('sharp') ? accent : ink} strokeWidth={hot('sharp') ? 3 : 2} />
          {label(along(lens.walker, r + 18, t.sharp / 2), `turns ${fmt(t.sharp, 1)}° toward the smell`, { hot: hot('sharp') })}
        </>}
        {!t.sharpOn && label({ x: lens.walker.x, y: lens.walker.y - r - 16 }, 'Senses off: it doesn\'t turn toward a smell')}
        {t.wobbleOn && t.wobble > 0 && label(along(lens.walker, r * 0.95 + 18, -t.wobble - 6), `wobble ±${fmt(t.wobble, 1)}°`, { hot: hot('wobble'), anchor: 'start' })}
        {walker(lens)}
      </g>
    );
  } else if (focus.section === 'moving' && focus.setting !== 'edges') {
    const m = cards.moving;
    const steps = stepsBehind(lens, m.speed, 6);
    const n = stepsToFeelers(s.distance, m.speed);
    const f = feelers(lens, s.distance, s.angle);
    body = (
      <g data-diagram="moving" data-speed={fmt(m.speed, 4)} data-step-px={fmt((m.speed / 60) * lens.scale, 2)}>
        {feelersShown && <>
          <line x1={lens.walker.x} y1={lens.walker.y} x2={f.centre.x} y2={f.centre.y} stroke={faint} strokeWidth={1.2} strokeDasharray="3 5" />
          <circle cx={f.centre.x} cy={f.centre.y} r={5} fill="none" stroke={faint} />
        </>}
        {steps.map((p, i) => <circle key={i} data-step={i} cx={p.x} cy={p.y} r={3.2} fill={hot('speed') ? accent : ink} opacity={1 - i * 0.14} />)}
        {walker(lens)}
        {label({ x: lens.walker.x + 16, y: lens.walker.y + 20 }, `one step ${fmt(m.speed / 60, 4)}`, { hot: hot('speed'), anchor: 'start' })}
        {feelersShown && isFinite(n) && label({ x: f.centre.x + 12, y: f.centre.y }, `${Math.round(n)} steps to its feelers`, { anchor: 'start', key: 'n' })}
        {!feelersShown && label({ x: lens.walker.x, y: lens.walker.y - 40 }, `${fmt(m.speed, 3)} a second`, { hot: hot('speed'), key: 'persec' })}
      </g>
    );
  } else if (focus.section === 'moving') {
    const im = box.image;
    const y = im.y + im.h * 0.5, x1 = im.x + im.w - 2;
    const e = cards.moving.edges;
    const inbound = `M ${x1 - 140} ${y + 40} L ${x1} ${y}`;
    body = (
      <g data-diagram="edges" data-edges={e}>
        <rect x={im.x + 1} y={im.y + 1} width={im.w - 2} height={im.h - 2} fill="none" stroke={accent} strokeWidth={2} strokeDasharray="8 6" />
        <path d={inbound} stroke={ink} strokeWidth={2.5} fill="none" />
        {e === 'wrap' && <>
          <path d={`M ${im.x + 2} ${y} L ${im.x + 140} ${y - 40}`} stroke={ink} strokeWidth={2.5} fill="none" />
          <path d={`M ${x1} ${y} C ${x1 - 40} ${y - 120}, ${im.x + 40} ${y - 120}, ${im.x + 2} ${y}`} stroke={faint} strokeWidth={1.5} strokeDasharray="4 6" fill="none" />
          {label({ x: im.x + im.w / 2, y: y - 110 }, 'Wrap: out one side, in the other')}
        </>}
        {e === 'bounce' && <>
          <path d={`M ${x1} ${y} L ${x1 - 140} ${y - 40}`} stroke={ink} strokeWidth={2.5} fill="none" />
          {label({ x: x1 - 170, y: y - 70 }, 'Bounce: turns back')}
        </>}
        {e === 'slide' && <>
          <path d={`M ${x1} ${y} L ${x1} ${y - 110}`} stroke={ink} strokeWidth={2.5} fill="none" />
          {label({ x: x1 - 120, y: y - 70 }, 'Slide: runs along the edge')}
        </>}
      </g>
    );
  } else if (focus.section === 'trail') {
    const t = cards.trail;
    const tr = trail ?? { halfLife: 0.12, diffuse: 1 };
    const keep = Math.pow(2, -(1 / 60) / Math.max(tr.halfLife, 0.005));
    // Its last steps, drawn evenly (a step is too short to see at this size): each dot as faded as the trail is that many steps on.
    const head = { x: lens.cx, y: lens.cy - lens.r * 0.4 };
    const gap = lens.r * 0.11;
    const dots = Array.from({ length: 10 }, (_, i) => ({ x: head.x, y: head.y + gap * (i + 1) }));
    const fade = (i: number) => Math.pow(keep, (i + 1) * 2);
    body = (
      <g data-diagram="trail" data-amount={fmt(t.amount, 3)} data-half-life={fmt(tr.halfLife, 4)} data-diffuse={fmt(tr.diffuse, 3)} opacity={t.on ? 1 : 0.4}>
        {dots.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={5 + tr.diffuse * (4 + i * 2.6)} fill="#e8a33a" opacity={0.45 * Math.max(fade(i), 0.08)} />
            <circle data-trail-dot={i} cx={p.x} cy={p.y} r={3.5 + Math.min(t.amount, 4) * 1.6} fill="#ffd27a" opacity={Math.max(fade(i), 0.04)} stroke={hot('fades') ? accent : 'none'} />
          </g>
        ))}
        <path d={`M ${head.x} ${head.y - 13} L ${head.x + 8} ${head.y + 8} L ${head.x} ${head.y + 3} L ${head.x - 8} ${head.y + 8} Z`} fill={ink} />
        {label({ x: head.x + 22, y: head.y }, `leaves ${fmt(t.amount, 2)} a step`, { hot: hot('amount'), anchor: 'start' })}
        {label({ x: head.x + 22, y: dots[3].y }, `half gone in ${fmt(tr.halfLife, 3)} s`, { hot: hot('fades'), anchor: 'start' })}
        {label({ x: head.x - 22, y: dots[6].y }, `spreads ${Math.round(tr.diffuse * 100)}% a step`, { hot: hot('spreads'), anchor: 'end' })}
      </g>
    );
  } else if (focus.section === 'born' && born && d3 && camera) {
    body = <Born3d born={born} camera={camera} image={box.image} hot={hot('where') || hot('count') || hot('size')} label={label} accent={accent} />;
  } else if (focus.section === 'born' && born) {
    const im = box.image;
    const c = picToView(im, { x: born.x, y: born.y });
    const rpx = born.size * im.h / 2;
    const shape = born.shape === 'ball' ? 'disc' : born.shape === 'sphere' ? 'ring' : born.shape;
    body = (
      <g data-diagram="born" data-born={born.shape} data-size={fmt(born.size, 3)}>
        {(shape === 'disc' || shape === 'ring') && <circle cx={c.x} cy={c.y} r={Math.max(rpx, 2)} fill={shape === 'disc' ? 'rgba(58,111,247,0.18)' : 'none'} stroke={accent} strokeWidth={2.5} strokeDasharray={hot('size') ? undefined : '8 6'} />}
        {shape === 'box' && <rect x={c.x - rpx} y={c.y - rpx} width={rpx * 2} height={rpx * 2} fill="rgba(58,111,247,0.18)" stroke={accent} strokeWidth={2.5} strokeDasharray="8 6" />}
        {shape === 'line' && <line x1={c.x - rpx} y1={c.y} x2={c.x + rpx} y2={c.y} stroke={accent} strokeWidth={3} />}
        {shape === 'point' && <circle cx={c.x} cy={c.y} r={6} fill={accent} />}
        {shape === 'screen' && <rect x={im.x + 3} y={im.y + 3} width={im.w - 6} height={im.h - 6} fill="none" stroke={accent} strokeWidth={2.5} strokeDasharray="8 6" />}
        {(shape === 'picture' || shape === 'field') && label({ x: c.x, y: c.y }, 'born where the picture is bright')}
        {label({ x: c.x, y: Math.max(im.y + 18, c.y - Math.max(rpx, 8) - 18) }, `born here · ${born.count.toUpperCase().replace('K', 'k')} walkers`, { hot: hot('where') || hot('count') })}
        {d3 && label({ x: c.x, y: Math.min(im.y + im.h - 18, c.y + Math.max(rpx, 8) + 18) }, 'seen from the front (no 3D camera to look through)', { key: '3d' })}
      </g>
    );
  }

  const lensOn = usesLens(focus);
  return (
    <svg data-walker-diagram={focus.section} data-setting={focus.setting ?? ''} width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {lensOn && <>
        <defs><clipPath id="ab-lens"><circle cx={lens.cx} cy={lens.cy} r={lens.r} /></clipPath></defs>
        <circle data-lens cx={lens.cx} cy={lens.cy} r={lens.r + 1.5} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />
        <circle cx={lens.cx} cy={lens.cy} r={lens.r} fill="rgba(13,13,18,0.74)" />
        <g clipPath="url(#ab-lens)">{body}</g>
        {label({ x: lens.cx, y: lens.cy + lens.r + 18 }, `one walker, ${Math.round(lens.scale / (box.image.h / 2))}× closer`, { key: 'zoom' })}
      </>}
      {!lensOn && body}
    </svg>
  );
}
