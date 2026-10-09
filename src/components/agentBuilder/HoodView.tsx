/**
 * Under the hood (docs/agent-builder.md): the walkers as the GPU keeps them. A panel under the live
 * picture shows each state texture's channels (A, B, and C and D when the group has them) as small
 * colour-mapped pictures, one pixel a walker, each labelled with what it holds and its range, and
 * the trail field's channels with what reads and writes them. Over the picture, a ring marks the
 * walker under the pointer (in any texture) or the one picked (click the picture: the nearest within
 * a few pixels), with its numbers; Follow keeps them on it as it moves.
 *
 * The pictures are drawn on the GPU from the runner's live state and read back a few times a second
 * (lib/agentHood.ts, lib/agentHoodGpu.ts); a walker's numbers are one texel of each texture. Nothing
 * runs while the panel is closed.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { openHood, type HoodRequest } from '../../lib/agentHood';
import {
  type HoodAtlas, type HoodChannel, type HoodKey, type HoodTexture, type HoodTrailChannel, type Rgb,
  hoodAtlas, hoodTextures, hoodTileSpecs, legendCss, ndcToView, readoutLines, texelAt, texelCentre, trailFit, viewToNdc, indexOf, TRAIL_RGB,
} from '../../agentBuilder/hood';
import type { ViewRect } from '../builders/studio/LiveViewport';
import { hood, ringWalker, useHoodStore } from './hoodStore';

/** A thumbnail's size on screen (its canvas is HOOD_TILE pixels: sharp on a 2× screen). */
const TILE_PX = 68;
/** A click on the picture finds the nearest walker within this many pixels. */
export const PICK_PX = 8;

const css = (c: Rgb) => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

export interface HoodPanelProps {
  groupId: string;
  species: Array<{ name: string; colour: Rgb }>;
  /** Fastest a walker goes, about (the speed ramp's top). */
  speedMax: number;
  /** Seconds a walker lives (0: for ever). */
  lifeMax: number;
  /** The trail channels, named and with their readers and writers (hood.ts hoodTrailChannels). */
  trails: HoodTrailChannel[];
  /** Channels the selected section uses. */
  highlight: ReadonlySet<HoodKey>;
  onClose: () => void;
}

export function HoodPanel(p: HoodPanelProps) {
  const tk = useTokens();
  const info = useHoodStore(s => s.info);
  const canvases = useRef(new Map<HoodKey, HTMLCanvasElement>());
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const atlasRef = useRef<HoodAtlas | null>(null);

  // The request, open for as long as the panel is.
  const req = useMemo<HoodRequest>(() => ({
    groupId: p.groupId, atlas: { W: 0, H: 0, tile: 0, tiles: [] }, specs: [], species: [], probe: null, pick: null,
    onAtlas: (px, W, H) => paint(px, W, H),
    onProbe: (f, i) => hood.probed(f, i),
    onPick: i => hood.picked(i),
    onState: s => hood.setInfo(s),
  }), [p.groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    hood.attach(req);
    const close = openHood(req);
    return () => { close(); hood.attach(null); };
  }, [req]);

  const speciesKey = JSON.stringify(p.species);
  const textures = useMemo<HoodTexture[]>(() => (info ? hoodTextures({
    d3: info.d3, stateC: info.stateC, aspect: info.aspect, speedMax: p.speedMax, lifeMax: p.lifeMax, species: p.species, trailColours: TRAIL_RGB,
  }) : []), [info, p.speedMax, p.lifeMax, speciesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const trails = info?.trail ? p.trails : [];
  const atlas = useMemo(() => (info ? hoodAtlas(textures, trails.length, info.aspect) : null), [info, textures, trails.length]);
  const trailKey = JSON.stringify(trails.map(t => t.colour));
  useEffect(() => {
    if (!atlas) return;
    atlasRef.current = atlas;
    req.atlas = atlas;
    req.specs = hoodTileSpecs(textures, trails);
    req.species = p.species.map(s => s.colour);
  }, [atlas, textures, trailKey, speciesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The read-back atlas (bottom row first) into each thumbnail's canvas. */
  function paint(px: Uint8Array, W: number, H: number) {
    const a = atlasRef.current;
    if (!a || a.W !== W || a.H !== H || typeof document === 'undefined') return;
    const sc = scratch.current ?? (scratch.current = document.createElement('canvas'));
    if (sc.width !== W || sc.height !== H) { sc.width = W; sc.height = H; }
    const ctx = sc.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    for (const t of a.tiles) {
      const c = canvases.current.get(t.key);
      const cx = c?.getContext('2d');
      if (!c || !cx) continue;
      if (c.width !== t.w || c.height !== t.h) { c.width = t.w; c.height = t.h; }
      cx.drawImage(sc, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    }
  }
  const bind = (key: HoodKey) => (el: HTMLCanvasElement | null) => { if (el) canvases.current.set(key, el); else canvases.current.delete(key); };

  const lit = p.highlight;
  const n = info ? info.side * info.side : 0;
  return (
    <div data-hood-panel style={{ flexShrink: 0, borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '48%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 4px 14px' }}>
        <Icon name="layers" size={14} />
        <b style={{ fontSize: 13, fontWeight: 650 }}>Under the hood</b>
        <span data-hood-size style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {info ? `${info.side} × ${info.side} texels = ${n.toLocaleString('en-US')} walkers · walker i at (i mod ${info.side}, i ÷ ${info.side})` : 'Waiting for the walkers…'}
        </span>
        <IconButton icon="close" label="Close Under the hood" size="sm" onClick={p.onClose} data-hood-close />
      </div>
      <span style={{ padding: '0 14px 8px', fontSize: 11.5, color: tk.text.faint, lineHeight: 1.45 }}>
        Each pixel is one walker; its colour channels hold numbers, not colours. Every step reads one copy and writes the other (ping-pong). Point at a pixel to find its walker; click the picture to pick one.
      </span>
      <div style={{ display: 'flex', gap: 14, padding: '0 14px 12px', overflowX: 'auto', overflowY: 'auto', alignItems: 'flex-start' }}>
        {textures.map(t => (
          <section key={t.id} data-hood-texture={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, width: 2 * TILE_PX + 8 }}>
            <b style={{ fontSize: 11.5, fontWeight: 650, color: tk.text.secondary }}>{t.title}</b>
            <span data-hood-learn={t.id} title={t.learn} style={{ fontSize: 10.5, color: tk.text.faint, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 28 }}>{t.learn}</span>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(2, ${TILE_PX}px)`, gap: 8 }}>
              {t.channels.map(c => <StateTile key={c.key} ch={c} side={info?.side ?? 1} lit={lit.has(c.key)} dim={lit.size > 0 && !lit.has(c.key)} canvasRef={bind(c.key)} species={p.species.map(s => s.colour)} />)}
            </div>
          </section>
        ))}
        {trails.length > 0 && (
          <section data-hood-trails style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, width: 2 * TILE_PX + 8 }}>
            <b style={{ fontSize: 11.5, fontWeight: 650, color: tk.text.secondary }}>Trail field</b>
            <span title="The picture-sized texture the walkers leave trail in: four channels, read by their senses and written by their deposit." style={{ fontSize: 10.5, color: tk.text.faint, lineHeight: 1.35, minHeight: 28 }}>
              Picture-sized, four channels: what they smell and what they leave.
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(2, ${TILE_PX}px)`, gap: 8 }}>
              {trails.map(t => <TrailTile key={t.index} ch={t} aspect={info?.aspect ?? 16 / 9} lit={lit.has(t.key)} dim={lit.size > 0 && !lit.has(t.key)} canvasRef={bind(t.key)} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Where the hovered and the picked walker are, on a texture's thumbnail. */
function TexelMarks({ side }: { side: number }) {
  const tk = useTokens();
  const hover = useHoodStore(s => s.hover);
  const selected = useHoodStore(s => s.selected);
  const mark = (i: number, kind: 'hover' | 'selected') => {
    const c = texelCentre(i % side, Math.floor(i / side), side);
    const col = kind === 'selected' ? tk.accent.base : '#ffffff';
    return (
      <span key={kind} data-hood-mark={kind} data-u={c.u.toFixed(5)} data-v={c.v.toFixed(5)} style={{ position: 'absolute', left: `${c.u * 100}%`, top: `${c.v * 100}%`, width: 0, height: 0, pointerEvents: 'none' }}>
        <span style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, borderRadius: 3, boxShadow: `0 0 0 1.5px ${col}, 0 0 0 3px rgba(0,0,0,0.55)` }} />
      </span>
    );
  };
  return <>{selected !== null && mark(selected, 'selected')}{hover !== null && hover !== selected && mark(hover, 'hover')}</>;
}

function StateTile({ ch, side, lit, dim, canvasRef, species }: { ch: HoodChannel; side: number; lit: boolean; dim: boolean; canvasRef: (el: HTMLCanvasElement | null) => void; species: Rgb[] }) {
  const tk = useTokens();
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = texelAt((e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height), side);
    return indexOf(t.x, t.y, side);
  };
  return (
    <div data-hood-channel={ch.key} data-hood-map={ch.map} data-hood-lit={lit || undefined} data-hood-dim={dim || undefined} title={`${'RGBA'[ch.comp]} · ${ch.label}: ${ch.note}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'flex', gap: 4, fontSize: 10.5, fontWeight: 600, color: lit ? tk.accent.text : tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ font: `700 9.5px ${fontFamily.mono}`, color: tk.text.faint }}>{'RGBA'[ch.comp]}</span>{ch.label}
      </span>
      <div data-hood-tile={ch.key} onPointerMove={e => hood.hover(at(e))} onPointerLeave={() => hood.hover(null)} onClick={e => hood.select(at(e))}
        style={{ position: 'relative', width: TILE_PX, height: TILE_PX, borderRadius: radius.xs, overflow: 'hidden', background: tk.bg.render, cursor: 'crosshair',
          boxShadow: lit ? `0 0 0 2px ${tk.accent.base}` : `0 0 0 1px ${tk.border.default}` }}>
        <canvas ref={canvasRef} width={128} height={128} style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', filter: dim ? 'brightness(0.5) saturate(0.6)' : undefined, transition: 'filter 0.15s' }} />
        <TexelMarks side={side} />
      </div>
      <span data-hood-legend={ch.key} style={{ height: 5, borderRadius: 3, background: legendCss(ch, species) }} />
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 4, fontSize: 9.5, color: tk.text.faint, whiteSpace: 'nowrap' }}>
        <span data-hood-lo>{ch.lo}</span><span data-hood-hi>{ch.hi}</span>
      </span>
    </div>
  );
}

function TrailTile({ ch, aspect, lit, dim, canvasRef }: { ch: HoodTrailChannel; aspect: number; lit: boolean; dim: boolean; canvasRef: (el: HTMLCanvasElement | null) => void }) {
  const tk = useTokens();
  const where = useHoodStore(s => ringWalker(s)?.read.ndc ?? null);
  const { w, h } = trailFit(aspect, TILE_PX);
  const line = (label: string, l: string[]) => (
    <span style={{ fontSize: 9.5, color: l.length ? tk.text.muted : tk.text.faint, lineHeight: 1.3 }} title={l.join(', ')}>
      {label} {l.length ? l.join(', ') : '—'}
    </span>
  );
  return (
    <div data-hood-channel={ch.key} data-hood-trail={ch.index} data-hood-lit={lit || undefined} data-hood-dim={dim || undefined} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: lit ? tk.accent.text : tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: css(ch.colour) }} />{ch.name}
      </span>
      <div style={{ position: 'relative', width: w, height: h, borderRadius: radius.xs, overflow: 'hidden', background: tk.bg.render, boxShadow: lit ? `0 0 0 2px ${tk.accent.base}` : `0 0 0 1px ${tk.border.default}` }}>
        <canvas ref={canvasRef} width={128} height={72} style={{ width: '100%', height: '100%', display: 'block', filter: dim ? 'brightness(0.5) saturate(0.6)' : undefined, transition: 'filter 0.15s' }} />
        {where && <span data-hood-trail-mark style={{ position: 'absolute', left: `${(where.x * 0.5 + 0.5) * 100}%`, top: `${(0.5 - where.y * 0.5) * 100}%`, width: 8, height: 8, margin: '-4px 0 0 -4px', borderRadius: '50%', boxShadow: '0 0 0 1.5px #fff, 0 0 0 3px rgba(0,0,0,0.5)', pointerEvents: 'none' }} />}
      </div>
      {line('read by', ch.readBy)}
      {line('written by', ch.writtenBy)}
    </div>
  );
}

// ── Over the live picture: the ring and the numbers ─────────────────────────

export function HoodLayer({ box, speciesNames }: { box: { w: number; h: number; image: ViewRect }; speciesNames: string[] }) {
  const tk = useTokens();
  const hoverRead = useHoodStore(s => (s.hover !== null && s.hoverRead?.index === s.hover ? s.hoverRead : null));
  const selectedRead = useHoodStore(s => (s.selected !== null && s.selectedRead?.index === s.selected ? s.selectedRead : null));
  const selected = useHoodStore(s => s.selected);
  const follow = useHoodStore(s => s.follow);
  const { image } = box;
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = viewToNdc({ x: 0, y: 0, w: r.width, h: r.height }, { x: e.clientX - r.left, y: e.clientY - r.top });
    hood.pick({ ...at, rx: (PICK_PX / Math.max(1, r.width)) * 2, ry: (PICK_PX / Math.max(1, r.height)) * 2 });
  };
  const ring = (read: typeof hoverRead, kind: 'hover' | 'selected') => {
    if (!read?.ndc || !read.alive) return null;
    const p = ndcToView(image, read.ndc);
    const col = kind === 'selected' ? tk.accent.base : '#ffffff';
    return (
      <g key={kind} data-hood-ring={kind} data-x={p.x.toFixed(1)} data-y={p.y.toFixed(1)} data-walker={read.index}>
        <circle cx={p.x} cy={p.y} r={11} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={4} />
        <circle cx={p.x} cy={p.y} r={11} fill="none" stroke={col} strokeWidth={1.75} strokeDasharray={kind === 'selected' && !follow ? '4 3' : undefined} />
      </g>
    );
  };
  const shown = hoverRead ?? selectedRead;
  const pinned = !hoverRead && !!selectedRead;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div data-hood-pick onClick={onClick} title="Click a walker to pick it"
        style={{ position: 'absolute', left: image.x, top: image.y, width: image.w, height: image.h, pointerEvents: 'auto', cursor: 'crosshair' }} />
      <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {ring(selectedRead, 'selected')}
        {hoverRead && hoverRead.index !== selected && ring(hoverRead, 'hover')}
      </svg>
      {(shown || selected !== null) && (
        <div data-hood-readout={shown ? shown.index : 'waiting'} style={{
          position: 'absolute', right: 12, top: 12, width: 216, pointerEvents: 'auto', padding: '10px 12px', borderRadius: radius.md,
          background: 'rgba(13,13,18,0.86)', color: '#e8e9ef', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)', font: `11.5px ${fontFamily.ui}`,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontWeight: 650, flex: 1 }}>{shown ? (pinned ? (follow ? 'Following' : 'Picked') : 'Under the pointer') : 'Reading…'}</b>
            {selected !== null && (
              <button type="button" data-hood-unpick aria-label="Let go of this walker" title="Let go of this walker" onClick={() => { hood.setFollow(false); hood.select(null); }}
                style={{ border: 0, background: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
          {shown && (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 2 }}>
              {readoutLines(shown, speciesNames).map(([k, v]) => (
                <span key={k} style={{ display: 'contents' }}>
                  <dt style={{ color: 'rgba(255,255,255,0.55)' }}>{k}</dt>
                  <dd data-hood-value={k} style={{ margin: 0, font: `11px ${fontFamily.mono}`, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</dd>
                </span>
              ))}
            </dl>
          )}
          {selected !== null && (
            <span data-hood-follow style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${alpha('#ffffff', 0.12)}`, paddingTop: 6 }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <b style={{ fontWeight: 600 }}>Follow</b>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.6)' }}>{follow ? 'keeps up as it moves' : 'numbers as it was when picked'}</span>
              </span>
              <Toggle checked={follow} onChange={on => hood.setFollow(on)} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
