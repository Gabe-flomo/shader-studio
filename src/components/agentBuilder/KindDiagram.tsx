/**
 * KindDiagram — the viewport diagrams of particles, flocks, crowds and orbiters (docs/agent-builder.md),
 * drawn over the live picture for the selected section, lighting the card under the pointer:
 *
 *  - Forces: one particle with each force as an arrow (gravity's way, the wind's, the pull toward
 *    the point), the curl flow as a field of arrows over the picture, drag as its speed before and
 *    after a second, and all of them added up;
 *  - Neighbours: one walker up close with its view radius as a ring; the walkers inside it, the
 *    ones it counts (at most Max neighbours, in the grid's order) lit;
 *  - Turning (flocking): the same walker and neighbours, with separation's push-away arrows,
 *    alignment's matching headings, cohesion's pull to their middle, the wander fan; Avoid edges as
 *    the band along the picture's edge where it turns back;
 *  - Orbit: the circle on the picture, its centre, which way round, and how hard it turns;
 *  - Life: brightness by age, with when it dies.
 *
 * And for any card with an "Only when…", where it applies: the shape on the picture, or a badge.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import type { AgentRuleSet, RuleAction, RuleCondition } from '../../agentRules/spec';
import { DEFAULT_NEIGHBOURS } from '../../agentRules/spec';
import type { CardRead } from '../../agentBuilder/behaviours';
import { CARD_WORDS } from '../../agentBuilder/sections';
import { onlyWhenText } from '../../agentBuilder/onlyWhen';
import {
  type DiagramFocus, type Pt, along, arrowHead, curlArrows, flockForces, forceLength, lifeCurve, neighbourDots,
  orbitArrows, orbitOnPicture, picToView, ringLens, toward, wedgePath,
} from '../../agentBuilder/diagram';
import type { ViewRect } from '../builders/studio/LiveViewport';
import { DiagramTags, type ViewportLink } from './ViewportLegend';
import { FORCE_PARTICLE, LEGEND_COLOURS, dimFor, num, tagCollector } from '../../agentBuilder/legend';

type Act<K extends RuleAction['kind']> = Extract<RuleAction, { kind: K }>;
const fmt = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);
const INK = 'rgba(255,255,255,0.92)';
const FAINT = 'rgba(255,255,255,0.4)';
const WARM = '#ff9a6b';

export function useDiagramLabel() {
  const tk = useTokens();
  return (p: Pt, text: string, opts: { hot?: boolean; anchor?: 'start' | 'middle' | 'end'; key?: string } = {}) => {
    const w = text.length * 6.6 + 14;
    const x = opts.anchor === 'start' ? p.x : opts.anchor === 'end' ? p.x - w : p.x - w / 2;
    return (
      <g key={opts.key ?? text} data-label={text}>
        <rect x={x} y={p.y - 11} width={w} height={22} rx={7} fill="rgba(13,13,18,0.82)" stroke={opts.hot ? tk.accent.base : 'rgba(255,255,255,0.18)'} />
        <text x={x + w / 2} y={p.y + 4} textAnchor="middle" fill={opts.hot ? '#fff' : INK} style={{ font: `600 11.5px ${fontFamily.ui}` }}>{text}</text>
      </g>
    );
  };
}

export function KindDiagram({ focus, cards, set, sp, box, viewRef, life, anchor, link }: {
  focus: DiagramFocus; cards: readonly CardRead[]; set: AgentRuleSet; sp: number;
  box: { w: number; h: number; image: ViewRect };
  /** The view radius the Neighbours lens is magnified for (kept while a slider moves). */
  viewRef: number;
  /** The Emit's Life (0: for ever). */
  life: number;
  /** Where one particle is drawn for the forces (picture units). */
  anchor?: Pt;
  /** The legend's linking: the tags, and the drawings dimmed while another entry is lit. */
  link?: ViewportLink;
}) {
  const { list: tags, tag } = tagCollector();
  const dim = (id: string) => dimFor(link, id);
  const im = box.image;
  const hotKey = focus.card;
  const isHot = (c: CardRead) => hotKey === c.key;
  const op = (c: CardRead) => (!c.on ? 0.3 : hotKey && !isHot(c) ? 0.45 : 1) * dim(c.key);
  const of = (ids: string[]) => cards.filter(c => ids.includes(c.card));
  let body: React.ReactNode = null;
  let lens: { cx: number; cy: number; r: number } | null = null;

  if (focus.section === 'forces') {
    const P = picToView(im, anchor ?? FORCE_PARTICLE);
    let sx = 0, sy = 0;
    const parts: React.ReactNode[] = [];
    for (const c of of(['curl'])) {
      const a = c.action as Act<'force'>;
      const arrows = curlArrows(im, set.flow.size, 16);
      parts.push(
        <g key={c.key} data-force="curl" opacity={op(c) * (isHot(c) ? 1 : 0.65)}>
          {arrows.map((ar, i) => (
            <g key={i} opacity={0.35 + 0.65 * ar.k}>
              <line x1={ar.from.x} y1={ar.from.y} x2={ar.to.x} y2={ar.to.y} stroke={LEGEND_COLOURS.curl} strokeWidth={isHot(c) ? 1.8 : 1.4} />
              <path d={arrowHead(ar.from, ar.to, 5)} fill="none" stroke={LEGEND_COLOURS.curl} strokeWidth={isHot(c) ? 1.8 : 1.4} />
            </g>
          ))}
          {tag(arrows[Math.min(arrows.length - 1, Math.round(arrows.length * 0.3))]?.to ?? { x: im.x + im.w - 40, y: im.y + 30 }, c.key, `×${num(a.strength, 2)}`, `${c.key}-t`)}
        </g>,
      );
    }
    for (const c of of(['gravity', 'wind'])) {
      const a = c.action as Act<'force'>;
      const deg = a.angle ?? (a.field === 'gravity' ? -90 : 0);
      const len = forceLength(a.strength);
      const to = toward(P, len, deg);
      if (c.on) { sx += Math.cos(deg * Math.PI / 180) * a.strength; sy += Math.sin(deg * Math.PI / 180) * a.strength; }
      parts.push(
        <g key={c.key} data-force={a.field} data-angle={fmt(deg, 1)} data-len={fmt(len, 1)} opacity={op(c)}>
          <line x1={P.x} y1={P.y} x2={to.x} y2={to.y} stroke={LEGEND_COLOURS[a.field === 'wind' ? 'wind' : 'gravity']} strokeWidth={isHot(c) ? 3.5 : 2.5} strokeDasharray={a.field === 'wind' ? '9 5' : undefined} />
          <path d={arrowHead(P, to, 11)} fill="none" stroke={LEGEND_COLOURS[a.field === 'wind' ? 'wind' : 'gravity']} strokeWidth={isHot(c) ? 3.5 : 2.5} strokeLinecap="round" />
          {tag(toward(P, len + 20, deg), c.key, num(a.strength, 2), `${c.key}-t`)}
        </g>,
      );
    }
    for (const c of of(['attract'])) {
      const a = c.action as Act<'force'>;
      const T = picToView(im, a.field === 'mouse' ? { x: 0, y: 0 } : { x: a.x ?? 0, y: a.y ?? 0 });
      const pull = a.strength >= 0;
      const d = Math.hypot(T.x - P.x, T.y - P.y) || 1;
      if (c.on) { sx += (T.x - P.x) / d * a.strength; sy += -(T.y - P.y) / d * a.strength; }
      const len = forceLength(a.strength, 90);
      const to = { x: P.x + (T.x - P.x) / d * len * (pull ? 1 : -1), y: P.y + (T.y - P.y) / d * len * (pull ? 1 : -1) };
      parts.push(
        <g key={c.key} data-force="attract" data-pull={pull ? 'in' : 'out'} opacity={op(c)}>
          {Array.from({ length: 8 }, (_, i) => {
            const ang = i * 45 + 22.5;
            const o = toward(T, 74, ang), n = toward(T, 34, ang);
            const [f, t] = pull ? [o, n] : [n, o];
            return <g key={i}><line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={LEGEND_COLOURS.attract} strokeWidth={1.8} /><path d={arrowHead(f, t, 7)} fill="none" stroke={LEGEND_COLOURS.attract} strokeWidth={1.8} /></g>;
          })}
          <circle cx={T.x} cy={T.y} r={7} fill={LEGEND_COLOURS.attract} stroke="#fff" strokeWidth={1.5} />
          <line x1={P.x} y1={P.y} x2={to.x} y2={to.y} stroke={LEGEND_COLOURS.attract} strokeWidth={isHot(c) ? 3.5 : 2.5} />
          <path d={arrowHead(P, to, 11)} fill="none" stroke={LEGEND_COLOURS.attract} strokeWidth={isHot(c) ? 3.5 : 2.5} strokeLinecap="round" />
          {tag({ x: T.x, y: T.y + 88 }, c.key, `${num(a.strength, 2)}${a.field === 'mouse' ? ' · mouse' : ''}`, `${c.key}-t`)}
        </g>,
      );
    }
    for (const c of of(['drag'])) {
      const a = c.action as Act<'drag'>;
      const keep = Math.exp(-Math.max(a.amount, 0));
      const x0 = im.x + 24, y0 = im.y + im.h - 58, L = Math.min(220, im.w * 0.3);
      parts.push(
        <g key={c.key} data-force="drag" data-keep={fmt(keep, 3)} opacity={op(c)}>
          <line x1={x0} y1={y0} x2={x0 + L} y2={y0} stroke={FAINT} strokeWidth={4} strokeLinecap="round" />
          <line x1={x0} y1={y0 + 22} x2={x0 + L * keep} y2={y0 + 22} stroke={LEGEND_COLOURS.drag} strokeWidth={4} strokeLinecap="round" />
          {tag({ x: x0 + L + 34, y: y0 }, c.key, 'now', 'drag-now')}
          {tag({ x: x0 + Math.max(L * keep, 4) + 44, y: y0 + 22 }, c.key, `1 s · ${Math.round(keep * 100)}%`, 'drag-after')}
        </g>,
      );
    }
    const sum = Math.hypot(sx, sy);
    body = (
      <g data-diagram="forces" data-sum={fmt(sum, 3)}>
        {parts}
        {sum > 1e-3 && (() => {
          const deg = Math.atan2(sy, sx) * 180 / Math.PI;
          const to = toward(P, forceLength(sum, 150), deg);
          return <g data-force-sum opacity={(hotKey ? 0.5 : 0.9) * dim('sum')}>
            <line x1={P.x} y1={P.y} x2={to.x} y2={to.y} stroke={LEGEND_COLOURS.sum} strokeWidth={4} strokeLinecap="round" strokeDasharray="2 7" />
            <path d={arrowHead(P, to, 13)} fill="none" stroke={LEGEND_COLOURS.sum} strokeWidth={4} strokeLinecap="round" />
            {tag(toward(P, forceLength(sum, 150) + 22, deg), 'sum', `Σ ${num(sum, 2)}`, 'sum-t')}
          </g>;
        })()}
        <circle cx={P.x} cy={P.y} r={6} fill="#fff" stroke="rgba(0,0,0,0.5)" />
      </g>
    );
  } else if (focus.section === 'neighbours' || focus.section === 'steering') {
    const radius = set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius;
    const max = set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max;
    const edgeCard = cards.find(c => c.card === 'avoidEdges' && isHot(c));
    if (focus.section === 'steering' && edgeCard) {
      const a = edgeCard.action as Act<'avoidEdges'>;
      const m = a.margin * im.h / 2;
      const y = im.y + im.h * 0.55, x1 = im.x + im.w - 2;
      body = (
        <g data-diagram="edges-band" data-margin={fmt(a.margin, 3)}>
          <path d={`M ${im.x} ${im.y} h ${im.w} v ${im.h} h ${-im.w} Z M ${im.x + m} ${im.y + m} v ${im.h - 2 * m} h ${im.w - 2 * m} v ${-(im.h - 2 * m)} Z`} fill="rgba(58,111,247,0.22)" fillRule="evenodd" />
          <rect x={im.x + m} y={im.y + m} width={Math.max(0, im.w - 2 * m)} height={Math.max(0, im.h - 2 * m)} fill="none" stroke={LEGEND_COLOURS.avoidEdges} strokeWidth={2} strokeDasharray="8 6" />
          <path d={`M ${x1 - m - 150} ${y + 70} Q ${x1 - m * 0.4} ${y} ${x1 - m - 120} ${y - 80}`} fill="none" stroke={INK} strokeWidth={2.5} />
          {tag({ x: x1 - m - 60, y: y - 100 }, edgeCard.key, `${num(a.margin, 2)} · ≤ ${num(a.degrees, 1)}°`, 'edges-t')}
        </g>
      );
    } else {
      const L = ringLens(box.w, box.h, viewRef, link?.freeLeft ?? 0);
      lens = L;
      const R = radius * L.scale;
      const dots = neighbourDots(max);
      const P = (d: { x: number; y: number }) => ({ x: L.walker.x + d.x * R, y: L.walker.y - d.y * R });
      const inReach = dots.filter(d => d.inReach).length;
      const counted = dots.filter(d => d.counted).length;
      // Flocks and crowds: the three rules are Turning's; orbiters keep them in Neighbours.
      const showFlock = focus.section === 'steering' || (set.kind === 'swarm' && cards.some(c => ['separate', 'match', 'cohere'].includes(c.card)));
      const ff = flockForces(dots);
      const hotSetting = focus.setting;
      const sep = cards.find(c => c.card === 'separate'), mat = cards.find(c => c.card === 'match'), coh = cards.find(c => c.card === 'cohere'), wan = cards.find(c => c.card === 'wobble'), goal = cards.find(c => c.card === 'goal'), slow = cards.find(c => c.card === 'slow');
      const show = (c: CardRead | undefined) => !!c && (!hotKey || isHot(c));
      const heads = (d: { x: number; y: number; heading: number }, len: number) => { const p = P(d); return { p, to: along(p, len, d.heading) }; };
      body = (
        <g data-diagram={focus.section} data-radius={fmt(radius, 4)} data-max={max} data-in-reach={inReach} data-counted={counted} data-ring-px={fmt(R, 1)}>
          <circle data-view-ring cx={L.walker.x} cy={L.walker.y} r={R} fill="rgba(127,156,255,0.12)" stroke={LEGEND_COLOURS.view} opacity={dim('view')} strokeWidth={hotSetting === 'radius' ? 3 : 2} strokeDasharray={hotSetting === 'radius' ? undefined : '7 5'} />
          {dots.map(d => {
            const p = P(d);
            const lit = d.counted;
            const fill = lit ? (hotSetting === 'max' ? '#fff' : LEGEND_COLOURS.view) : 'none';
            return d.inReach
              ? <circle key={d.index} data-neighbour={lit ? 'counted' : 'ignored'} cx={p.x} cy={p.y} r={lit ? 4.6 : 3.8} fill={fill} stroke={lit ? '#fff' : FAINT} strokeWidth={lit ? 1 : 1.2} />
              : <circle key={d.index} data-neighbour="out" cx={p.x} cy={p.y} r={2.6} fill={FAINT} />;
          })}
          {showFlock && show(mat) && dots.filter(d => d.counted).map(d => { const h = heads(d, 16); return <line key={`h${d.index}`} x1={h.p.x} y1={h.p.y} x2={h.to.x} y2={h.to.y} stroke={isHot(mat!) ? '#fff' : FAINT} strokeWidth={1.5} />; })}
          {showFlock && show(sep) && ff.close.map(d => { const p = P(d); return <line key={`s${d.index}`} data-push-from={d.index} x1={p.x} y1={p.y} x2={L.walker.x} y2={L.walker.y} stroke={WARM} strokeWidth={1.2} strokeDasharray="3 3" />; })}
          {showFlock && show(sep) && ff.close.length > 0 && (() => {
            const m = Math.hypot(ff.push.x, ff.push.y) || 1;
            const to = { x: L.walker.x + ff.push.x / m * R * 0.7, y: L.walker.y - ff.push.y / m * R * 0.7 };
            return <g data-separate opacity={(sep!.on ? 1 : 0.35) * dim(sep!.key)}><line x1={L.walker.x} y1={L.walker.y} x2={to.x} y2={to.y} stroke={WARM} strokeWidth={3} /><path d={arrowHead(L.walker, to, 10)} fill="none" stroke={WARM} strokeWidth={3} />
              {tag({ x: to.x, y: to.y + (to.y > L.walker.y ? 16 : -16) }, sep!.key, `≤ ${num((sep!.action as Act<'separate'>).degrees, 1)}°`, 'sep')}</g>;
          })()}
          {showFlock && show(coh) && (() => {
            const c = P(ff.centre);
            return <g data-cohere opacity={(coh!.on ? 1 : 0.35) * dim(coh!.key)}>
              <path d={`M ${c.x - 6} ${c.y - 6} L ${c.x + 6} ${c.y + 6} M ${c.x + 6} ${c.y - 6} L ${c.x - 6} ${c.y + 6}`} stroke="#7ad38a" strokeWidth={2.5} />
              <line x1={L.walker.x} y1={L.walker.y} x2={c.x} y2={c.y} stroke="#7ad38a" strokeWidth={2.5} />
              <path d={arrowHead(L.walker, c, 10)} fill="none" stroke="#7ad38a" strokeWidth={2.5} />
              {tag({ x: c.x, y: c.y - 18 }, coh!.key, `≤ ${num((coh!.action as Act<'cohere'>).degrees, 1)}°`, 'coh')}
            </g>;
          })()}
          {showFlock && show(mat) && (() => {
            const to = along(L.walker, R * 0.85, ff.heading);
            return <g data-match opacity={(mat!.on ? 1 : 0.35) * dim(mat!.key)}>
              <line x1={L.walker.x} y1={L.walker.y} x2={to.x} y2={to.y} stroke="#57b6ff" strokeWidth={3} />
              <path d={arrowHead(L.walker, to, 10)} fill="none" stroke="#57b6ff" strokeWidth={3} />
              {tag({ x: to.x, y: to.y - 18 }, mat!.key, `≤ ${num((mat!.action as Act<'match'>).degrees, 1)}°`, 'mat')}
            </g>;
          })()}
          {focus.section === 'steering' && show(goal) && (() => {
            const g = goal!.action as Act<'turn'>;
            const deg = g.toward === 'point' ? Math.atan2(g.y ?? 0, g.x ?? 0) * 180 / Math.PI : 0;
            const to = toward(L.walker, R * 1.5, deg);
            return <g data-goal opacity={(goal!.on ? 1 : 0.35) * dim(goal!.key)}><line x1={L.walker.x} y1={L.walker.y} x2={to.x} y2={to.y} stroke="#e8a33a" strokeWidth={2.5} strokeDasharray="6 4" /><path d={arrowHead(L.walker, to, 10)} fill="none" stroke="#e8a33a" strokeWidth={2.5} />
              {tag({ x: to.x, y: to.y - 18 }, goal!.key, `≤ ${num(g.degrees, 1)}°`, 'goal')}</g>;
          })()}
          {focus.section === 'steering' && show(wan) && (wan!.action as Act<'wander'>).degrees > 0 && (
            <path data-wander d={wedgePath(L.walker, R * 0.6, (wan!.action as Act<'wander'>).degrees)} fill="rgba(255,255,255,0.12)" stroke={isHot(wan!) ? LEGEND_COLOURS.wobble : 'rgba(255,255,255,0.3)'} opacity={(wan!.on ? 1 : 0.35) * dim(wan!.key)} />
          )}
          {focus.section === 'steering' && show(wan) && (wan!.action as Act<'wander'>).degrees > 0 && tag(along(L.walker, R * 0.6 + 14, -(wan!.action as Act<'wander'>).degrees - 8), wan!.key, `±${num((wan!.action as Act<'wander'>).degrees, 1)}°`, 'wan')}
          {focus.section === 'steering' && show(slow) && tag({ x: L.walker.x, y: L.walker.y + R + 26 }, slow!.key, `${counted} / ${num((slow!.action as Act<'slow'>).jam, 0)}`, 'slow')}
          <path d={`M ${L.walker.x} ${L.walker.y - 12} L ${L.walker.x + 7.5} ${L.walker.y + 7} L ${L.walker.x} ${L.walker.y + 3} L ${L.walker.x - 7.5} ${L.walker.y + 7} Z`} fill="#fff" />
          {tag({ x: L.walker.x + R * 0.72 + 30, y: L.walker.y - R * 0.72 }, 'view', num(radius, 3), 'sees')}
          {tag({ x: L.walker.x, y: L.walker.y + Math.min(R + 22, L.r - 18) }, 'max', `${counted} / ${max}`, 'counts')}
        </g>
      );
    }
  } else if (focus.section === 'orbit') {
    const orbits = of(['orbit']);
    body = (
      <g data-diagram="orbit">
        {orbits.map(c => {
          const a = c.action as Act<'orbit'>;
          const g = orbitOnPicture(im, a);
          const arrows = orbitArrows(g.c, g.r, !!a.cw, 8);
          const hs = focus.setting;
          return (
            <g key={c.key} data-orbit={c.key} data-orbit-r={fmt(g.r, 1)} data-cw={a.cw ? 'cw' : 'ccw'} opacity={op(c)}>
              <circle cx={g.c.x} cy={g.c.y} r={g.r} fill="none" stroke={LEGEND_COLOURS.orbit} strokeWidth={hs === 'distance' && isHot(c) ? 3.5 : 2.2} strokeDasharray={hs === 'distance' && isHot(c) ? undefined : '10 6'} />
              {arrows.map((ar, i) => <path key={i} d={ar.head} fill="none" stroke={hs === 'way' && isHot(c) ? '#fff' : LEGEND_COLOURS.orbit} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />)}
              <circle cx={g.c.x} cy={g.c.y} r={6} fill={LEGEND_COLOURS.orbit} stroke="#fff" strokeWidth={1.5} />
              <line x1={g.c.x} y1={g.c.y} x2={g.c.x + g.r} y2={g.c.y} stroke={INK} strokeWidth={1.2} strokeDasharray="3 4" />
              {tag({ x: g.c.x + g.r / 2, y: g.c.y + 16 }, c.key, `${num(a.distance, 2)} · ${a.cw ? '↻' : '↺'} ≤ ${num(a.degrees, 1)}°`, `${c.key}-t`)}
            </g>
          );
        })}
        {orbits.length === 0 && tag({ x: im.x + im.w / 2, y: im.y + im.h / 2 }, '', 'no orbit: add one', 'none')}
      </g>
    );
  } else if (focus.section === 'life') {
    const fade = of(['fade']).find(c => c.on)?.action as Act<'fade'> | undefined;
    const die = of(['die']).find(c => c.on);
    const dieAt = die?.when?.kind === 'age' && die.when.cmp === '>' ? die.when.seconds : null;
    const span = Math.max(fade?.seconds ?? 0, dieAt ?? 0, life || 0, 2) * 1.2;
    const W = Math.min(520, im.w * 0.7), H = 150;
    const x0 = im.x + (im.w - W) / 2, y0 = im.y + (im.h - H) / 2;
    const X = (t: number) => x0 + 14 + (t / span) * (W - 28), Y = (v: number) => y0 + 30 + (1 - v) * (H - 60);
    const end = dieAt ?? (life > 0 ? life : null);
    const pts = lifeCurve(fade?.seconds ?? null, end ?? span).map(p => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    body = (
      <g data-diagram="life" data-dies={dieAt ?? ''} data-fade={fade?.seconds ?? ''}>
        <rect x={x0} y={y0} width={W} height={H} rx={12} fill="rgba(13,13,18,0.84)" stroke="rgba(255,255,255,0.18)" />
        <text x={x0 + 14} y={y0 + 20} fill={FAINT} style={{ font: `600 11px ${fontFamily.ui}` }}>BRIGHTNESS BY AGE</text>
        <line x1={X(0)} y1={Y(0)} x2={X(span)} y2={Y(0)} stroke={FAINT} />
        <polyline data-life-curve points={pts} fill="none" stroke={fade ? LEGEND_COLOURS.fade : INK} strokeWidth={2.5} />
        {Array.from({ length: Math.floor(span) + 1 }, (_, i) => <text key={i} x={X(i)} y={Y(0) + 16} textAnchor="middle" fill={FAINT} style={{ font: `500 10px ${fontFamily.ui}` }}>{i}s</text>)}
        {end !== null && <>
          <line x1={X(end)} y1={y0 + 26} x2={X(end)} y2={Y(0)} stroke={LEGEND_COLOURS.die} strokeWidth={2} />
          {tag({ x: X(end), y: y0 + H + 16 }, dieAt !== null ? die!.key : 'lives', `${num(dieAt ?? life, 2)} s`, 'dies')}
        </>}
        {end === null && tag({ x: X(span) - 20, y: y0 + H + 16 }, 'lives', '∞', 'ever')}
      </g>
    );
  }

  const hot = cards.find(c => c.key === hotKey);
  const only = hot?.when ? <OnlyWhenOverlay set={set} sp={sp} c={hot.when} title={CARD_WORDS[hot.card].title} box={box} /> : null;
  return (
    <svg data-kind-diagram={focus.section} data-card-hot={hotKey ?? ''} width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {lens && <>
        <circle data-lens cx={lens.cx} cy={lens.cy} r={lens.r + 1.5} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />
        <circle cx={lens.cx} cy={lens.cy} r={lens.r} fill="rgba(13,13,18,0.74)" />
        <defs><clipPath id="ab-kind-lens"><circle cx={lens.cx} cy={lens.cy} r={lens.r} /></clipPath></defs>
        <g clipPath="url(#ab-kind-lens)">{body}</g>
      </>}
      {!lens && body}
      {only}
      <DiagramTags requests={tags} bounds={{ x: 0, y: 0, w: box.w, h: box.h }} link={link} />
    </svg>
  );
}

/** Where a card's "only when" applies: the shape on the picture (shaded where it doesn't), else a badge. */
export function OnlyWhenOverlay({ set, sp, c, title, box }: { set: AgentRuleSet; sp: number; c: RuleCondition; title: string; box: { w: number; h: number; image: ViewRect } }) {
  const tk = useTokens();
  const label = useDiagramLabel();
  const im = box.image;
  const text = `${title} · only when ${onlyWhenText(set, sp, c)}`;
  if (c.kind === 'shape') {
    const ctr = picToView(im, { x: c.x, y: c.y });
    const r = Math.max(2, c.size * im.h / 2);
    const shape = c.shape === 'circle'
      ? `M ${ctr.x - r} ${ctr.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
      : `M ${ctr.x - r} ${ctr.y - r} h ${2 * r} v ${2 * r} h ${-2 * r} Z`;
    const outside = `M ${im.x} ${im.y} h ${im.w} v ${im.h} h ${-im.w} Z`;
    return (
      <g data-only-when-diagram="shape" data-inside={c.outside ? 'outside' : 'inside'}>
        {/* Shade where the card does nothing. */}
        <path d={c.outside ? shape : `${outside} ${shape}`} fill="rgba(8,8,12,0.55)" fillRule="evenodd" />
        <path d={shape} fill="none" stroke={tk.accent.base} strokeWidth={2.5} strokeDasharray="8 5" />
        {label({ x: ctr.x, y: Math.max(im.y + 18, ctr.y - r - 18) }, `${c.outside ? 'acts outside' : 'acts inside'} · ${title}`, { hot: true, key: 'shape-l' })}
      </g>
    );
  }
  return <g data-only-when-diagram={c.kind}>{label({ x: box.w / 2, y: 26 }, text, { hot: true, key: 'only' })}</g>;
}

