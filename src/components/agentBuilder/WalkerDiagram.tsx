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
import { DiagramTags, type ViewportLink } from './ViewportLegend';
import { LEGEND_COLOURS, dimFor, num, tagCollector } from '../../agentBuilder/legend';

const readNum = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

/**
 * A 3D Emit's shape through Draw agents' camera (agentPlan.js agCamera3 at its start, before it
 * orbits): a ball as a shaded sphere with its equator and a meridian (the far halves dashed), a
 * shell as the same lines without the fill, a box and the whole box as their twelve edges.
 */
function Born3d({ born, camera, image, hot, tag, accent }: {
  born: BornInfo; camera: { params: Record<string, unknown>; mirror?: boolean }; image: ViewRect; hot: boolean; accent: string;
  tag: (p: Pt, entry: string, text: string, key?: string) => null;
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
      {tag({ x: top.x, y: Math.max(image.y + 18, top.y - 18) }, 'born', born.count.toUpperCase().replace('K', 'k'), 'b3')}
    </g>
  );
}

export interface BornInfo { shape: string; size: number; x: number; y: number; z?: number; count: string }
export interface TrailInfo { halfLife: number; diffuse: number }

const fmt = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);

export function WalkerDiagram({ focus, cards, box, born, trail, lensRef, d3, camera, feelersShown = true, link }: {
  focus: DiagramFocus; cards: TrailCards; box: { w: number; h: number; image: ViewRect };
  born?: BornInfo; trail?: TrailInfo; lensRef: number; d3: boolean;
  /** In 3D: Draw agents' camera settings, to draw the Emit's ball, shell or box through it. */
  camera?: { params: Record<string, unknown>; mirror?: boolean };
  /** Moving: draw its feelers ahead (trail followers only). */
  feelersShown?: boolean;
  /** The legend's linking: the tags, and the drawings dimmed while another entry is lit. */
  link?: ViewportLink;
}) {
  const tk = useTokens();
  const accent = tk.accent.base;
  const ink = 'rgba(255,255,255,0.92)';
  const faint = 'rgba(255,255,255,0.45)';
  const lens = lensFor(box.w, box.h, lensRef, link?.freeLeft ?? 0);
  const { list: tags, tag } = tagCollector();
  const dim = (id: string) => dimFor(link, id);
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
      <g data-diagram="senses" data-distance={fmt(s.distance, 4)} data-angle={fmt(s.angle, 2)} opacity={(s.on ? 1 : 0.4) * dim('senses')}>
        {(['left', 'centre', 'right'] as const).map(k => (
          <g key={k}>
            <line data-feeler={k} x1={lens.walker.x} y1={lens.walker.y} x2={f[k].x} y2={f[k].y} stroke={k === 'centre' && hot('distance') ? accent : ink} strokeWidth={k === 'centre' && hot('distance') ? 2.5 : 1.6} strokeDasharray={k === 'centre' ? undefined : '5 4'} />
            <circle cx={f[k].x} cy={f[k].y} r={9} fill="rgba(13,13,18,0.6)" stroke={LEGEND_COLOURS.senses} strokeWidth={2} />
            <text x={f[k].x} y={f[k].y + 4} textAnchor="middle" fill="#fff" style={{ font: `700 10px ${fontFamily.ui}` }}>{k === 'left' ? 'L' : k === 'centre' ? 'C' : 'R'}</text>
          </g>
        ))}
        <path data-angle-arc d={arcPath(lens.walker, arcR, 0, s.angle)} fill="none" stroke={hot('angle') ? accent : faint} strokeWidth={hot('angle') ? 2.5 : 1.5} />
        {tag(along(lens.walker, f.length * 0.55, Math.min(s.angle + 22, 150)), 'senses', `±${num(s.angle, 1)}°`, 'wide')}
        {tag(along(lens.walker, f.length * 0.55, -Math.min(s.angle + 22, 150)), 'senses', num(s.distance), 'far')}
        {walker(lens)}
      </g>
    );
  } else if (focus.section === 'turning') {
    const t = cards.turning;
    const r = lens.r * 0.72;
    body = (
      <g data-diagram="turning" data-turn={fmt(t.sharp, 2)} data-wobble={fmt(t.wobbleOn ? t.wobble : 0, 2)}>
        {t.wobbleOn && t.wobble > 0 && <path data-wobble-fan d={wedgePath(lens.walker, r * 0.95, t.wobble)} fill={hot('wobble') ? 'rgba(214,214,224,0.3)' : 'rgba(255,255,255,0.12)'} stroke={hot('wobble') ? LEGEND_COLOURS.wobble : 'rgba(255,255,255,0.3)'} opacity={dim('wobble')} />}
        <line x1={lens.walker.x} y1={lens.walker.y} x2={lens.walker.x} y2={lens.walker.y - r} stroke={faint} strokeWidth={1.5} strokeDasharray="5 4" />
        {t.sharpOn && <g opacity={dim('turn')}>
          <line data-new-heading x1={lens.walker.x} y1={lens.walker.y} x2={along(lens.walker, r, t.sharp).x} y2={along(lens.walker, r, t.sharp).y} stroke={ink} strokeWidth={2} />
          <path data-turn-arc d={arcPath(lens.walker, r * 0.55, 0, t.sharp)} fill="none" stroke={LEGEND_COLOURS.turn} strokeWidth={hot('sharp') ? 3 : 2} />
          {tag(along(lens.walker, r + 16, t.sharp / 2), 'turn', `${num(t.sharp, 1)}°`, 'turn')}
        </g>}
        {!t.sharpOn && tag({ x: lens.walker.x, y: lens.walker.y - r - 14 }, 'turn', 'no turn', 'noturn')}
        {t.wobbleOn && t.wobble > 0 && tag(along(lens.walker, r * 0.95 + 16, -t.wobble - 8), 'wobble', `±${num(t.wobble, 1)}°`, 'wob')}
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
        {steps.map((p, i) => <circle key={i} data-step={i} cx={p.x} cy={p.y} r={3.2} fill={hot('speed') ? '#fff' : LEGEND_COLOURS.speed} opacity={1 - i * 0.14} />)}
        {walker(lens)}
        {tag({ x: lens.walker.x + 50, y: lens.walker.y + 20 }, 'speed', `${num(m.speed / 60, 4)} / step`, 'step')}
        {feelersShown && isFinite(n) && tag({ x: f.centre.x + 50, y: f.centre.y }, 'speed', `${Math.round(n)} steps`, 'n')}
        {!feelersShown && tag({ x: lens.walker.x, y: lens.walker.y - 40 }, 'speed', `${num(m.speed, 3)} / s`, 'persec')}
      </g>
    );
  } else if (focus.section === 'moving') {
    const im = box.image;
    const y = im.y + im.h * 0.5, x1 = im.x + im.w - 2;
    const e = cards.moving.edges;
    const inbound = `M ${x1 - 140} ${y + 40} L ${x1} ${y}`;
    body = (
      <g data-diagram="edges" data-edges={e}>
        <rect x={im.x + 1} y={im.y + 1} width={im.w - 2} height={im.h - 2} fill="none" stroke={LEGEND_COLOURS.edges} strokeWidth={2} strokeDasharray="8 6" />
        <path d={inbound} stroke={ink} strokeWidth={2.5} fill="none" />
        {e === 'wrap' && <>
          <path d={`M ${im.x + 2} ${y} L ${im.x + 140} ${y - 40}`} stroke={ink} strokeWidth={2.5} fill="none" />
          <path d={`M ${x1} ${y} C ${x1 - 40} ${y - 120}, ${im.x + 40} ${y - 120}, ${im.x + 2} ${y}`} stroke={faint} strokeWidth={1.5} strokeDasharray="4 6" fill="none" />
          {tag({ x: im.x + im.w / 2, y: y - 100 }, 'edges', 'wrap')}
        </>}
        {e === 'bounce' && <>
          <path d={`M ${x1} ${y} L ${x1 - 140} ${y - 40}`} stroke={ink} strokeWidth={2.5} fill="none" />
          {tag({ x: x1 - 170, y: y - 66 }, 'edges', 'bounce')}
        </>}
        {e === 'slide' && <>
          <path d={`M ${x1} ${y} L ${x1} ${y - 110}`} stroke={ink} strokeWidth={2.5} fill="none" />
          {tag({ x: x1 - 60, y: y - 66 }, 'edges', 'slide')}
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
        {tag({ x: head.x + 44, y: head.y }, 'trail', num(t.amount, 2), 'amount')}
        {tag({ x: head.x + 54, y: dots[3].y }, 'trail', `½ ${num(tr.halfLife, 3)} s`, 'half')}
        {tag({ x: head.x - 50, y: dots[6].y }, 'trail', `${Math.round(tr.diffuse * 100)}%`, 'spread')}
      </g>
    );
  } else if (focus.section === 'born' && born && d3 && camera) {
    body = <Born3d born={born} camera={camera} image={box.image} hot={hot('where') || hot('count') || hot('size')} tag={tag} accent={accent} />;
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
        {(shape === 'picture' || shape === 'field') && tag({ x: c.x, y: c.y + 24 }, 'born', 'bright', 'bright')}
        {tag({ x: c.x, y: Math.max(im.y + 18, c.y - Math.max(rpx, 8) - 16) }, 'born', born.count.toUpperCase().replace('K', 'k'), 'count')}
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
      </>}
      {!lensOn && body}
      <DiagramTags requests={tags} bounds={{ x: 0, y: 0, w: box.w, h: box.h }} link={link} />
    </svg>
  );
}
