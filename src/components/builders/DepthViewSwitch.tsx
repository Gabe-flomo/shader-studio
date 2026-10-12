/**
 * DepthViewSwitch — the preview switch of a picture with depth (builders/depthPreview.ts, docs/depth-mix.md "Seeing
 * the depth"): Result | Picture | Depth | Shaped depth (and the depth-only effects that are on), a heat-map toggle
 * for the depth views, and an optional side-by-side strip of every view, small. It drives the builder's own preview
 * (the 2D Scene Builder's Preview, the 3D Scene Builder's viewport), which compiles the same graph with the view in
 * front of its Output, so the same depth texture as the build, live while a slider moves. Leaving the tab (or
 * closing the card) goes back to the result.
 */
import { useEffect, useMemo, useRef } from 'react';
import { DEPTH_VIEW_LABELS, useDepthView, type DepthView } from '../../builders/depthPreview';
import type { Compiled } from '../sceneBuilder/previewGl';
import { useBuilderPreview, useThrottled } from './useBuilderPreview';
import { Segmented, Toggle } from '../ui/Choice';
import { BuilderNote } from './BuilderWindow';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

const TONED: readonly DepthView[] = ['depth', 'shaped', 'size'];

export function DepthViewSwitch<S>({ views, source, compile, notes = {} }: {
  /** The views this scene offers (depthViewsFor). */
  views: DepthView[];
  /** A builder's own words for a view (the 3D one's Shaped depth is through Nearest / Farthest). */
  notes?: Partial<Record<DepthView, string>>;
  /** The scene (or spec) the strip's small previews draw. */
  source: S;
  compile: (source: S, ask: { view: DepthView; heat: boolean }) => Compiled;
}) {
  const tk = useTokens();
  const picked = useDepthView(s => s.view);
  const view = views.includes(picked) ? picked : 'result';
  const heat = useDepthView(s => s.heat);
  const strip = useDepthView(s => s.strip);
  const { setView, setHeat, setStrip } = useDepthView.getState();
  // An effect switched off while its view shows: back to the result.
  useEffect(() => { if (picked !== view) setView(view); }, [picked, view, setView]);
  // Leaving the tab (or the card going away): the preview shows the result again.
  useEffect(() => () => useDepthView.getState().setView('result'), []);
  return (
    <div data-depth-view-switch style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Segmented<DepthView> size="sm" wrap ariaLabel="What the preview shows" value={view} onChange={setView}
        options={views.map(v => ({ value: v, label: DEPTH_VIEW_LABELS[v].label }))} />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span data-depth-heat style={{ display: 'inline-flex', opacity: TONED.includes(view) || strip ? 1 : 0.5 }}><Toggle checked={heat} onChange={setHeat} label="Heat map" /></span>
        <span data-depth-strip-toggle style={{ display: 'inline-flex' }}><Toggle checked={strip} onChange={setStrip} label="Side by side" /></span>
      </div>
      <BuilderNote>{notes[view] ?? DEPTH_VIEW_LABELS[view].blurb}{view !== 'result' ? ' Only the preview: Build makes the result.' : ''}</BuilderNote>
      {strip && (
        <div data-depth-strip style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
          {views.map(v => <StripTile key={v} view={v} heat={heat} picked={v === view} source={source} compile={compile} onPick={() => setView(v)} />)}
        </div>
      )}
      <span style={{ fontSize: 11, color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>
        {heat ? 'Heat map: red near, blue far.' : 'Greyscale: white near, black far.'}
      </span>
    </div>
  );
}

function StripTile<S>({ view, heat, picked, source, compile, onPick }: {
  view: DepthView; heat: boolean; picked: boolean; source: S;
  compile: (source: S, ask: { view: DepthView; heat: boolean }) => Compiled;
  onPick: () => void;
}) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Small and a little behind the big preview: a compile every 150 ms at most while a slider moves.
  const shown = useThrottled(source, 150);
  const compiled = useMemo(() => compile(shown, { view, heat }), [compile, shown, view, heat]);
  const error = useBuilderPreview(canvasRef, compiled, false);
  return (
    <button type="button" data-depth-tile={view} aria-pressed={picked} onClick={onPick} title={DEPTH_VIEW_LABELS[view].blurb}
      style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 0, border: 0, background: 'none', cursor: 'pointer', minWidth: 0, textAlign: 'left' }}>
      <span style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', borderRadius: radius.sm, overflow: 'hidden', background: tk.bg.render, boxShadow: picked ? `0 0 0 2px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}` }}>
        <canvas ref={canvasRef} aria-label={`${DEPTH_VIEW_LABELS[view].label} preview`} style={{ width: '100%', height: '100%', display: 'block' }} />
        {error && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#f38ba8', background: 'rgba(13,13,18,0.8)' }}>error</span>}
      </span>
      <span style={{ fontSize: 11, color: picked ? tk.text.primary : tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{DEPTH_VIEW_LABELS[view].label}</span>
    </button>
  );
}
