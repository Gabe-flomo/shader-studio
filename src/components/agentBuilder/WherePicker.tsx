/**
 * The Where picker (docs/agent-builder.md "Where"): what a card reads as "here". Its row shows the
 * region picked (a thumbnail, its name, its kind, inside / outside); "Change" opens the list of
 * things in your graph that can be a region, each with a thumbnail drawn on the GPU from the node's
 * own chain (lib/regionValues.ts), and "Make one here": a circle, box, ring, polygon or text, drawn
 * by dragging on the live picture. Pointing at the row shows the region over the picture
 * (RegionOverlay); a shape made here keeps its handles there.
 *
 * The viewport side is shared through `WhereFocusContext`: the picker says which region to show,
 * and asks the viewport to draw a new shape.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { type Region, type WhereUse, REGION_WORDS, USE_WORDS, listRegions, regionsFor, takesTexture } from '../../agentBuilder/where';
import { type MadeShape, type MadeShapeKind, MADE_SHAPES, MAX_TEXT, cleanText } from '../../agentBuilder/madeShapes';
import { DEFAULT_WEIGHT } from '../../agentBuilder/strokeFont';
import { SliderSetting } from './BehaviourCard';
import type { WhereEdit, WherePick } from '../../agentBuilder/whereActions';
import { setMadeShape, whereNow } from '../../agentBuilder/whereActions';
import { regionField, regionImage } from '../../lib/regionValues';
import { PictureWays } from '../builders/TexturePicker';
import { clampLines } from '../ui/textFit';

/** What the viewport shows for the Where row pointed at, and a shape being drawn. */
export interface WhereShown { key: string; use: WhereUse; region: Region | null; outside: boolean }
export interface WhereDrawing { kind: MadeShapeKind; onDone: (s: MadeShape) => void; onCancel: () => void }
export interface WhereFocus {
  groupId: string;
  d3: boolean;
  shown: WhereShown | null;
  show: (w: WhereShown | null) => void;
  drawing: WhereDrawing | null;
  draw: (d: WhereDrawing | null) => void;
  /** Pick for a use (whereActions.setWhere, after the pending rule edits). */
  apply: (use: WhereUse, pick: WherePick | null, edit?: WhereEdit) => void;
  /** Open a group or a Shader Texture to edit what it holds (the builder closes; a toast brings it back). */
  openInside?: (nodeId: string) => void;
}
export const WhereFocusContext = createContext<WhereFocus | null>(null);

const TW = 96, TH = 54;
const thumbCache = new Map<string, string>();

/** A region's thumbnail (a data URL; '' while it renders, or when it can't: a texture). */
export function useRegionThumb(region: Region | null, w = TW, h = TH): string {
  const key = region ? `${region.nodeId}:${region.outputKey}:${w}` : '';
  const nodeKey = useNodeGraphStore(s => {
    if (!region) return '';
    const nd = s.nodes.find(x => x.id === region.nodeId);
    return nd ? `${JSON.stringify(nd.params)}|${s.nodes.length}` : '';
  });
  const [url, setUrl] = useState(() => thumbCache.get(`${key}|${nodeKey}`) ?? '');
  useEffect(() => {
    if (!region) { setUrl(''); return; }
    const k = `${key}|${nodeKey}`;
    if (thumbCache.has(k)) { setUrl(thumbCache.get(k)!); return; }
    const nd = useNodeGraphStore.getState().nodes.find(x => x.id === region.nodeId);
    if (region.kind === 'texture' || region.kind === 'scene') {
      const t = typeof nd?.params._thumbnailUrl === 'string' ? nd.params._thumbnailUrl : '';
      setUrl(t);
      return;
    }
    let alive = true;
    // Wait a moment: a dragged slider changes the chain every frame.
    const t = setTimeout(() => {
      regionField(useNodeGraphStore.getState().nodes, region.nodeId, region.outputKey, w * 2, h * 2).then(f => {
        const u = f ? regionImage(f, region.kind as 'shape' | 'mask', 'thumb') : '';
        thumbCache.set(k, u);
        if (thumbCache.size > 200) thumbCache.delete(thumbCache.keys().next().value!);
        if (alive) setUrl(u);
      }, () => {});
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [key, nodeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

function Thumb({ region, w = TW, h = TH }: { region: Region | null; w?: number; h?: number }) {
  const tk = useTokens();
  const url = useRegionThumb(region, w, h);
  const glyph = !region ? 'target' : region.kind === 'texture' ? 'layers' : region.kind === 'scene' ? 'cube' : region.made ? 'edit' : 'mask';
  return (
    <span data-where-thumb={url ? 'image' : 'glyph'} style={{ width: w, height: h, flexShrink: 0, borderRadius: 7, overflow: 'hidden', background: tk.bg.render, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} /> : <Icon name={glyph} size={Math.min(18, h * 0.5)} />}
    </span>
  );
}

function KindBadge({ region }: { region: Region }) {
  const tk = useTokens();
  return (
    <span data-where-kind={region.kind} title={REGION_WORDS[region.kind].hint}
      style={{ padding: '1px 6px', borderRadius: 999, background: tk.bg.field, color: tk.text.muted, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
      {region.made ? 'made here' : REGION_WORDS[region.kind].label}
    </span>
  );
}

export function WherePicker({ id, use, region, outside, onPick, allowOutside = true, clearable = true, onFocus, startOpen = false }: {
  id: string;
  use: WhereUse;
  region: Region | null;
  outside: boolean;
  /** A region of the graph, a shape made here, or null (none). */
  onPick: (pick: WherePick | null) => void;
  allowOutside?: boolean;
  clearable?: boolean;
  onFocus?: (setting: string | undefined) => void;
  /** Open its list at once (an only when just asked for a region). */
  startOpen?: boolean;
}) {
  const tk = useTokens();
  const ctx = useContext(WhereFocusContext);
  const [open, setOpen] = useState(startOpen);
  const [picture, setPicture] = useState(false);
  const groupId = ctx?.groupId ?? '';
  const regionsKey = useNodeGraphStore(s => (open ? JSON.stringify(regionsFor(use, listRegions(s.nodes, groupId, ctx?.d3 ?? false))) : ''));
  const regions = useMemo(() => (regionsKey ? JSON.parse(regionsKey) as Region[] : []), [regionsKey]);
  const showKey = `${id}:${region?.nodeId ?? ''}:${region?.outputKey ?? ''}:${outside}`;
  const show = () => ctx?.show({ key: showKey, use, region, outside });
  // Keep the shown region current while it is shown (a pick, inside ↔ outside).
  useEffect(() => {
    if (ctx?.shown && ctx.shown.key.startsWith(`${id}:`) && ctx.shown.key !== showKey) show();
  }, [showKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const draw = (kind: MadeShapeKind) => {
    setOpen(false);
    show();
    ctx?.draw({ kind, onDone: s => { ctx.draw(null); onPick({ make: s, outside }); }, onCancel: () => ctx.draw(null) });
  };
  const drawingHere = ctx?.drawing;
  const inGraph = regions.filter(r => !r.from), fromGroups = regions.filter(r => r.from);
  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` };
  const regionTiles = (list: Region[]) => list.length ? (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${TW + 8}px, 1fr))`, gap: 8 }}>
      {list.map(r => {
        const on = !!region && r.nodeId === region.nodeId && r.outputKey === region.outputKey;
        return (
          <button key={`${r.nodeId}:${r.outputKey}`} type="button" data-where-tile={`${r.nodeId}:${r.outputKey}`} data-where-tile-kind={r.kind} data-where-tile-from={r.from ?? ''} aria-pressed={on}
            title={`${r.label}${r.from ? ` (from ${r.from})` : ''}: ${REGION_WORDS[r.kind].hint}`}
            onPointerEnter={() => ctx?.show({ key: `${id}:preview`, use, region: r, outside })}
            onPointerLeave={() => show()}
            onClick={() => { setOpen(false); onPick({ region: { nodeId: r.nodeId, outputKey: r.outputKey }, outside }); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 4, border: 0, borderRadius: 9, cursor: 'pointer', textAlign: 'left', minWidth: 0,
              background: on ? tk.bg.selected : tk.bg.panel, boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary }}>
            <Thumb region={r} />
            <span data-where-option-name title={r.label} style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, ...clampLines(2) }}>{r.label}</span>
            <KindBadge region={r} />
          </button>
        );
      })}
    </div>
  ) : null;
  return (
    <div data-where={id} data-where-use={use} data-where-region={region ? `${region.nodeId}:${region.outputKey}` : ''}
      onPointerEnter={() => { show(); onFocus?.(id); }} onFocus={() => show()}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Thumb region={region} w={64} h={36} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
          <span data-where-name title={region?.label} style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, color: region ? tk.text.primary : tk.text.muted, ...clampLines(2) }}>
            {region ? region.label : USE_WORDS[use].none}
          </span>
          {region && <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}><KindBadge region={region} />{region.from && <span style={{ fontSize: 10.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>from {region.from}</span>}</span>}
        </span>
        {region?.inside && ctx?.openInside && (
          <button type="button" data-where-inside={region.inside} title={`Open ${region.from ?? 'it'} to edit what it draws (the builder closes; the toast brings you back)`} onClick={() => ctx.openInside!(region.inside!)}
            style={{ height: 26, padding: '0 8px', border: 0, borderRadius: radius.control, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
            Edit inside ↗
          </button>
        )}
        <button type="button" data-where-open={id} aria-expanded={open} onClick={() => { setOpen(v => !v); show(); }}
          style={{ height: 26, padding: '0 10px', border: 0, borderRadius: radius.control, background: open ? tk.bg.selected : tk.bg.field, color: open ? tk.accent.text : tk.text.secondary, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
          {region ? 'Change' : 'Pick…'}
        </button>
        {region && clearable && (
          <button type="button" data-where-clear={id} aria-label="None" title="Take it away" onClick={() => onPick(null)}
            style={{ width: 22, height: 22, padding: 0, border: 0, borderRadius: 6, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {region && allowOutside && region.kind !== 'scene' && (
        <Segmented size="sm" fill ariaLabel="Inside or outside" value={outside ? 'out' : 'in'} onChange={v => onPick({ region, outside: v === 'out' })}
          options={[{ value: 'in' as const, label: 'Inside it' }, { value: 'out' as const, label: 'Outside it' }]} />
      )}
      {region?.made?.shape === 'text' && <TextOf region={region} />}
      {drawingHere && (
        <span data-where-drawing={drawingHere.kind} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: tk.accent.text, padding: '6px 8px', borderRadius: radius.control, background: alpha(tk.accent.base, 0.1) }}>
          <Icon name="edit" size={13} />
          <span style={{ flex: 1 }}>{drawingHere.kind === 'polygon' ? 'Click its corners on the picture; click the first again (or Enter) to close it.' : `Drag on the picture to draw the ${drawingHere.kind}.`} Esc stops.</span>
        </span>
      )}
      {open && (
        <div data-where-panel={id} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, borderRadius: radius.card, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
          {/* Wiring three ways: an output of the graph, an output from a group, or something new. */}
          <WaysHead n={1} title="Wire from the graph" hint="An output already in your graph, wired in as it is." />
          {inGraph.length === 0 && <span style={{ fontSize: 12, color: tk.text.muted }}>Nothing in your graph can be read here yet: a shape (an SDF), a mask (any number that changes across the picture){takesTexture(use) ? ' or a texture' : ''}. Create one below.</span>}
          {regionTiles(inGraph)}
          <WaysHead n={2} title="From a group" hint="An output of another group: a plain group, a Shader Texture, another Agents group's trail." />
          {fromGroups.length === 0 && <span data-where-no-groups style={{ fontSize: 12, color: tk.text.muted }}>No group in your graph has an output this can read. Create a new one below.</span>}
          {regionTiles(fromGroups)}
          <WaysHead n={3} title="Create new" hint="A new top-level source, wired in: a shape drawn on the picture, a Shader Texture or a group, opened ready to edit." />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {MADE_SHAPES.map(m => (
              <button key={m.kind} type="button" data-where-make={m.kind} title={`Draw on the picture. ${m.hint}`} onClick={() => draw(m.kind)} style={chip}>
                <ShapeGlyph kind={m.kind} />{m.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {takesTexture(use) && (
              <button type="button" data-where-create="picture" aria-expanded={picture} title="A picture (upload, paste, a link or the image library) on a new Texture node, wired in: the scene builders' shared picture picker" onClick={() => setPicture(v => !v)} style={chip}>
                <Icon name="camera" size={13} />A picture…
              </button>
            )}
            {takesTexture(use) && (
              <button type="button" data-where-create="shaderTexture" title="A new Shader Texture (its own little shader graph drawn into a texture), wired in, and opened so you can edit what it draws" onClick={() => { setOpen(false); onPick({ create: 'shaderTexture', outside }); }} style={chip}>
                <Icon name="layers" size={13} />New Shader Texture
              </button>
            )}
            <button type="button" data-where-create="group" title="A new group whose Distance output is wired in (a circle to start), opened so you can build the shape inside" onClick={() => { setOpen(false); onPick({ create: 'group', outside }); }} style={chip}>
              <Icon name="nodes" size={13} />New group
            </button>
          </div>
          {picture && takesTexture(use) && (
            <PictureWays graph={false} shader={false} onPicked={p => { setPicture(false); setOpen(false); onPick({ region: { nodeId: p.nodeId, outputKey: 'texture' }, outside }); }} />
          )}
        </div>
      )}
    </div>
  );
}

/** A heading of the picker's three ways in. */
function WaysHead({ n, title, hint }: { n: number; title: string; hint: string }) {
  const tk = useTokens();
  return (
    <span data-where-way={n} title={hint} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 650, color: tk.text.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      <span aria-hidden style={{ width: 16, height: 16, borderRadius: 8, background: tk.bg.field, color: tk.text.secondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{n}</span>
      {title}
    </span>
  );
}

/** A text shape's words, size and weight, and its font (the smooth stroke font, or the blocky one text made before it had). */
function TextOf({ region }: { region: Region }) {
  const tk = useTokens();
  const made = region.made!;
  const font = made.font === 'stroke' ? 'stroke' : 'blocky';
  const [text, setText] = useState(made.text ?? '');
  useEffect(() => setText(made.text ?? ''), [made.text]);
  const commit = () => { const t = cleanText(text, font); if (t !== made.text) setMadeShape(region.nodeId, { ...made, text: t }); };
  return (
    <div data-where-text-editor style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', borderRadius: radius.card, background: tk.bg.subtle }}>
      <Field data-where-text value={text} maxLength={MAX_TEXT} placeholder="Its words" aria-label="Its words" height={28}
        onChange={e => setText(e.currentTarget.value.toUpperCase())} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
      <SliderSetting id="textSize" label="Size" hint="Half the letters' height, in picture units (the picture is 2 tall). Their corner handle on the picture does the same." value={made.size} min={0.02} max={1} step={0.005}
        onChange={v => setMadeShape(region.nodeId, { ...made, size: Math.max(0.01, v) })} />
      {font === 'stroke' && (
        <SliderSetting id="textWeight" label="Weight" hint="How thick the strokes are (their half-width, in the letters' units: they are 2 tall)." value={made.weight ?? DEFAULT_WEIGHT} min={0.02} max={0.5} step={0.005}
          onChange={v => setMadeShape(region.nodeId, { ...made, weight: Math.max(0.01, v) })} />
      )}
      <Segmented size="sm" fill ariaLabel="Font" value={font} onChange={v => setMadeShape(region.nodeId, { ...made, font: v, text: cleanText(made.text ?? 'A', v), ...(v === 'stroke' ? { weight: made.weight ?? DEFAULT_WEIGHT } : {}) })}
        options={[{ value: 'stroke' as const, label: 'Smooth' }, { value: 'blocky' as const, label: 'Blocky (5 × 7)' }]} />
    </div>
  );
}

export function ShapeGlyph({ kind, size = 14 }: { kind: MadeShapeKind; size?: number }) {
  const s = 'currentColor';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      {kind === 'circle' && <circle cx={8} cy={8} r={5.5} fill="none" stroke={s} strokeWidth={1.5} />}
      {kind === 'box' && <rect x={2.5} y={4} width={11} height={8} rx={1} fill="none" stroke={s} strokeWidth={1.5} />}
      {kind === 'ring' && <><circle cx={8} cy={8} r={6} fill="none" stroke={s} strokeWidth={1.2} /><circle cx={8} cy={8} r={3.5} fill="none" stroke={s} strokeWidth={1.2} /></>}
      {kind === 'polygon' && <path d="M8 2 L14 6.5 L11.5 13.5 L4.5 13.5 L2 6.5 Z" fill="none" stroke={s} strokeWidth={1.4} strokeLinejoin="round" />}
      {kind === 'text' && <path d="M3 4 H13 M8 4 V13" stroke={s} strokeWidth={1.8} strokeLinecap="round" />}
    </svg>
  );
}

/** A Where row for a use that needs nothing but the pick (born inside, walls, Field ƒ): what it reads now, and the picker. */
export function WhereRow({ id, use, allowOutside = true, onFocus }: { id: string; use: WhereUse; allowOutside?: boolean; onFocus?: (s: string | undefined) => void }) {
  const ctx = useContext(WhereFocusContext);
  const key = useNodeGraphStore(s => JSON.stringify(whereNow(s.nodes, ctx?.groupId ?? '', use)));
  const now = JSON.parse(key) as ReturnType<typeof whereNow>;
  if (!ctx) return null;
  return <WherePicker id={id} use={use} region={now.region} outside={now.outside} allowOutside={allowOutside} onFocus={onFocus} onPick={p => ctx.apply(use, p)} />;
}
