/**
 * The Time Cube View card's colour-key line (docs/time-cube.md, "Colour key"): how much of the video
 * the key keeps ("Keeps about 4% of the video, 9% of the slice frame"), and swatches of the slice
 * frame's main colours. Clicking one keeps that colour (switching the key on if it is off), so a
 * key on your own video matches something from the first click.
 */
import { useDeferredValue, useMemo, useSyncExternalStore } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { timeCubes, timeCubePlan } from '../../lib/timeCube/volumes';
import { keySettingsOf, keyShare, mainColours, shareText } from '../../lib/timeCube/keyInfo';

/** The atlas scaled down (at most ~256k pixels) with each tile's place in it, read once per built atlas. */
interface Small { px: Uint8ClampedArray; w: number; h: number; s: number }
const cache = new WeakMap<HTMLCanvasElement, Small>();
function smallAtlas(atlas: HTMLCanvasElement): Small | null {
  const hit = cache.get(atlas);
  if (hit) return hit;
  const s = Math.max(1, Math.ceil(Math.sqrt((atlas.width * atlas.height) / 262144)));
  const w = Math.max(1, Math.floor(atlas.width / s)), h = Math.max(1, Math.floor(atlas.height / s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(atlas, 0, 0, w, h);
  const out = { px: g.getImageData(0, 0, w, h).data, w, h, s };
  cache.set(atlas, out);
  return out;
}

/** The RGBA bytes of one tile of the scaled-down atlas. */
function tilePixels(sm: Small, x0: number, y0: number, tw: number, th: number): Uint8ClampedArray {
  const x = Math.floor(x0 / sm.s), y = Math.floor(y0 / sm.s);
  const w = Math.max(1, Math.floor(tw / sm.s)), h = Math.max(1, Math.floor(th / sm.s));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) out.set(sm.px.subarray(((y + j) * sm.w + x) * 4, ((y + j) * sm.w + x + w) * 4), j * w * 4);
  return out;
}

const toHex = (c: readonly number[]) => '#' + c.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

export function TimeCubeViewKeyInfo({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const srcId = node.inputs.volume?.connection?.nodeId;
  const src = useNodeGraphStore(s => (srcId ? s.nodes.find(nd => nd.id === srcId) : undefined));
  // Re-read when the source's volume is (re)built.
  const sub = useMemo(() => (fn: () => void) => timeCubes.onChange(fn), []);
  const ready = useSyncExternalStore(sub, () => (srcId ? timeCubes.status(srcId)?.state === 'ready' : false));
  const plan = src && src.type === 'timeCube' ? timeCubePlan(src) : null;
  const atlas = ready && srcId ? timeCubes.canvas(srcId) : null;
  const sm = useMemo(() => (atlas ? smallAtlas(atlas) : null), [atlas]);

  // The frame at the slice (its slider; a wired Offset reads as the slider's value).
  const slice = typeof node.params.slice === 'number' ? node.params.slice : 0.5;
  const pos = node.params.timeMode === 'flow' ? (typeof node.params.framePos === 'number' ? node.params.framePos : 0.5) : slice;
  // The atlas layout as plain numbers (the plan is worked out afresh each render).
  const cols = plan?.cols ?? 1, tileW = plan?.tileW ?? 1, tileH = plan?.tileH ?? 1, frames = plan?.frames ?? 1;
  const frame = Math.round(Math.min(1, Math.max(0, pos)) * (frames - 1));
  const slicePx = useMemo(() => {
    if (!sm) return null;
    const row = Math.floor(frame / cols), col = frame - row * cols;
    return tilePixels(sm, col * tileW, row * tileH, tileW, tileH);
  }, [sm, frame, cols, tileW, tileH]);
  const swatches = useMemo(() => (slicePx ? mainColours(slicePx, 6) : []), [slicePx]);

  // How much it keeps: the whole stack (only the tiles in use) and the slice frame. Deferred, so dragging How close stays smooth.
  const keyId = useDeferredValue(JSON.stringify(keySettingsOf(node.params)));
  const key = useMemo(() => JSON.parse(keyId) as ReturnType<typeof keySettingsOf>, [keyId]);
  const shares = useMemo(() => {
    if (!sm || key.mode === 'off') return null;
    const usedRows = Math.ceil(frames / cols);
    const all = sm.px.subarray(0, Math.min(sm.px.length, Math.ceil((usedRows * tileH) / sm.s) * sm.w * 4));
    return { all: keyShare(all, key), slice: slicePx ? keyShare(slicePx, key) : 0 };
  }, [sm, key, frames, cols, tileH, slicePx]);

  if (!srcId || !plan) return null;
  const small = { fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted } as const;
  const keyOn = key.mode !== 'off';
  const pick = (c: [number, number, number]) => updateNodeParams(node.id, { keyColor: c.map(v => +v.toFixed(3)), ...(key.mode === 'color' || key.mode === 'hue' ? {} : { keyMode: 'color' }) });
  const size = touch ? 26 : 18;

  return (
    <div style={{ padding: '2px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 5 }} onMouseDown={e => e.stopPropagation()}>
      {keyOn && (
        <span style={{ ...small, color: shares && shares.all <= 0.0005 ? tk.status.warningText : tk.text.muted }} data-testid="time-cube-key-share">
          {!shares ? 'Colour key: reading the frames…'
            : shares.all <= 0.0005 ? 'The key keeps nothing in this video: pick a colour below, or raise How close.'
              : `Keeps ${shareText(shares.all)} of the video (${shareText(shares.slice)} of the slice frame).`}
        </span>
      )}
      {swatches.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={small}>{keyOn ? 'Keep a colour from the slice:' : 'Colour key: keep a colour from the slice'}</span>
          {swatches.map(c => (
            <button key={toHex(c)} type="button" title={`Keep ${toHex(c)}`} aria-label={`Keep the colour ${toHex(c)}`} onClick={() => pick(c)}
              style={{ width: size, height: size, padding: 0, borderRadius: radius.sm, cursor: 'pointer', background: toHex(c), border: `1px solid ${tk.border.subtle}`, font: `600 10px ${fontFamily.ui}` }} />
          ))}
        </div>
      )}
    </div>
  );
}
