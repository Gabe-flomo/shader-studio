/**
 * The Grid Rules builder's Smooth section, in plain words (gridRules/smoothWords.ts):
 *
 *  - the template as a choice of what it makes (Heat · Ripples · Growing patterns · Your own);
 *  - a tiny before/after: the template's demo start and the board N steps later with these settings,
 *    run on the CPU, so moving a slider shows what it does;
 *  - each setting with its plain name, one line, and a feel for the number ("half gone after about
 *    170 steps");
 *  - Growing patterns: a map of food added × cleared away, with the presets as dots (click to go
 *    there), since those two pick the pattern.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { BuilderSlider } from '../builders/BuilderSlider';
import { BuilderFold, HintLabel } from '../builders/BuilderWindow';
import { cpuColours, type CpuBoard } from '../../gridRules/cpu';
import { GRID_DEFAULTS, LOOKS, gridShape, type SmoothTemplate } from '../../gridRules/spec';
import { REACTION_MAP, REACTION_SPOTS, SMOOTH_WORDS, smoothDemo, type SmoothSetting } from '../../gridRules/smoothWords';

type P = Record<string, unknown>;
type Setter = (patch: P, immediate?: boolean) => void;

/** A template's look, when the template is picked without a preset. */
export const SMOOTH_LOOKS: Record<SmoothTemplate, P> = { diffusion: LOOKS.heat, waves: LOOKS.ripples, reaction: LOOKS.reaction, custom: LOOKS.heat };

const TEMPLATE_ORDER: SmoothTemplate[] = ['diffusion', 'waves', 'reaction', 'custom'];

/** A CPU board drawn in the rule's colours, scaled up. */
export function BoardPicture({ p, board, size = 96, label }: { p: P; board: CpuBoard; size?: number; label: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(board.w, board.h);
    cpuColours(p, board, img.data);
    ctx.putImageData(img, 0, 0);
  });
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <canvas ref={ref} width={board.w} height={board.h} aria-label={label} style={{ width: size, height: size * (board.h / board.w), imageRendering: 'pixelated', borderRadius: radius.sm, background: tk.bg.render, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }} />
      <span style={{ font: `600 10.5px ${fontFamily.ui}`, color: tk.text.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
    </span>
  );
}

/** The template's demo: its start, and N steps later with these settings (recomputed a moment after a change). */
function SmoothDemo({ p, template }: { p: P; template: SmoothTemplate }) {
  const tk = useTokens();
  const key = SMOOTH_WORDS[template].settings.map(x => Number(p[x.key])).join(',');
  const [demo, setDemo] = useState(() => smoothDemo(p, template));
  const live = useRef(p);
  useEffect(() => { live.current = p; });
  useEffect(() => {
    const id = window.setTimeout(() => setDemo(smoothDemo(live.current, template)), template === 'reaction' ? 120 : 30);
    return () => window.clearTimeout(id);
  }, [key, template]);
  return (
    <div data-smooth-demo={template} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.card, background: tk.bg.field }}>
      <BoardPicture p={p} board={demo.before} label="Start" size={88} />
      <span style={{ font: `600 18px ${fontFamily.ui}`, color: tk.text.faint }}>→</span>
      <BoardPicture p={p} board={demo.after} label={`${demo.steps} steps later`} size={88} />
      <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45, flex: 1, minWidth: 0 }}>Move a slider: the second picture follows.</span>
    </div>
  );
}

function SettingRow({ p, set, x, nodeId }: { p: P; set: Setter; x: SmoothSetting; nodeId?: string }) {
  const tk = useTokens();
  const feel = x.feel?.(p) ?? null;
  return (
    <div data-smooth-setting={x.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '108px 1fr', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, display: 'flex' }}><HintLabel hint={x.line}>{x.label}</HintLabel></span>
        <BuilderSlider ariaLabel={x.label} value={Number(p[x.key] ?? GRID_DEFAULTS[x.key])} min={x.min} max={x.max} step={x.step} defaultValue={GRID_DEFAULTS[x.key] as number}
          onChange={v => set({ [x.key]: v })} rangeKey={`grid:${x.key}`} param={nodeId ? { nodeId, key: x.key } : undefined} />
      </div>
      <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.4, paddingLeft: 118 }}>{x.line}{feel ? <b style={{ color: tk.text.secondary, fontWeight: 600 }}> · {feel}</b> : null}</span>
    </div>
  );
}

/** Food added × cleared away, with the presets as dots: click anywhere to go there. */
function FeedKillMap({ p, set }: { p: P; set: Setter }) {
  const tk = useTokens();
  const W = 300, H = 150;
  const [f0, f1] = REACTION_MAP.feed, [k0, k1] = REACTION_MAP.kill;
  const x = (k: number) => ((k - k0) / (k1 - k0)) * W, y = (f: number) => H - ((f - f0) / (f1 - f0)) * H;
  const feed = Number(p.feed), kill = Number(p.kill);
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = k0 + ((e.clientX - r.left) / r.width) * (k1 - k0), f = f0 + (1 - (e.clientY - r.top) / r.height) * (f1 - f0);
    set({ feed: Math.round(Math.max(0, f) * 10000) / 10000, kill: Math.round(Math.max(0, k) * 10000) / 10000 });
  };
  return (
    <div data-feed-kill-map style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: tk.text.secondary }}>Where patterns grow: click to try a spot</span>
      <svg width="100%" viewBox={`-30 -6 ${W + 40} ${H + 30}`} style={{ maxWidth: 360, cursor: 'crosshair', display: 'block' }} onPointerDown={pick} role="img" aria-label="Food added against cleared away">
        <rect x={0} y={0} width={W} height={H} rx={6} fill={tk.bg.field} stroke={tk.border.default} />
        {REACTION_SPOTS.map((s, i) => {
          // Labels: left of a dot on the right half; a dot close to an earlier one labels below it.
          const near = REACTION_SPOTS.slice(0, i).some(o => Math.hypot(x(o.kill) - x(s.kill), y(o.feed) - y(s.feed)) < 14);
          const right = x(s.kill) > W * 0.6;
          return (
            <g key={s.key}>
              <circle cx={x(s.kill)} cy={y(s.feed)} r={4} fill={tk.text.muted} />
              <text x={x(s.kill) + (right ? -7 : 7)} y={y(s.feed) + (near ? 15 : 4)} textAnchor={right ? 'end' : 'start'} fontSize={10.5} fill={tk.text.secondary} style={{ font: `500 10.5px ${fontFamily.ui}` }}>{s.label}</text>
            </g>
          );
        })}
        <circle cx={Math.max(0, Math.min(W, x(kill)))} cy={Math.max(0, Math.min(H, y(feed)))} r={6.5} fill="none" stroke={tk.accent.base} strokeWidth={2.5} />
        <text x={W / 2} y={H + 18} textAnchor="middle" fontSize={11} fill={tk.text.muted} style={{ font: `500 11px ${fontFamily.ui}` }}>cleared away →</text>
        <text x={-16} y={H / 2} textAnchor="middle" fontSize={11} fill={tk.text.muted} transform={`rotate(-90 -16 ${H / 2})`} style={{ font: `500 11px ${fontFamily.ui}` }}>food added →</text>
      </svg>
    </div>
  );
}

export function SmoothSection({ p, set, nodeId, custom }: { p: P; set: Setter; nodeId?: string; custom: ReactNode }) {
  const tk = useTokens();
  const s = gridShape(p);
  const words = SMOOTH_WORDS[s.template];
  const main = words.settings.filter(x => !x.more), more = words.settings.filter(x => x.more);
  return (
    <>
      <div role="radiogroup" aria-label="What it makes" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {TEMPLATE_ORDER.map(t => {
          const on = t === s.template;
          return (
            <button key={t} type="button" role="radio" aria-checked={on} data-template={t} onClick={() => !on && set({ template: t, ...SMOOTH_LOOKS[t] }, true)}
              style={{
                textAlign: 'left', border: 0, borderRadius: radius.md, padding: '8px 10px', cursor: 'pointer',
                background: on ? tk.bg.selected : tk.bg.field, boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary,
              }}>
              <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{SMOOTH_WORDS[t].title}</b>
            </button>
          );
        })}
      </div>
      <span data-smooth-line style={{ fontSize: 12.5, lineHeight: 1.5, color: tk.text.secondary }}>{words.line}</span>
      {s.template !== 'custom' && <SmoothDemo p={p} template={s.template} />}
      {main.map(x => <SettingRow key={x.key} p={p} set={set} x={x} nodeId={nodeId} />)}
      {s.template === 'reaction' && <FeedKillMap p={p} set={set} />}
      {more.length > 0 && (
        <BuilderFold foldKey="gridRules:open:smooth-more" title="More" summary={more.map(x => `${x.label.toLowerCase()} ${Number(p[x.key])}`).join(' · ')}>
          {more.map(x => <SettingRow key={x.key} p={p} set={set} x={x} nodeId={nodeId} />)}
        </BuilderFold>
      )}
      {s.template === 'custom' && custom}
    </>
  );
}
