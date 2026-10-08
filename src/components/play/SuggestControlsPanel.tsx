import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toastStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { runControlFinder, useControlFinder } from '../surprise/controlFinderRun';
import type { SampleFrame, Suggestion } from '../../nodes/controlFinder';
import { addSuggestedControls, hasControlNamer, nameContextOf, nameControl, type ControlName } from '../../play/suggestControls';

const PRE_CHECKED = 4;
const THUMB = 40;

/** Frames across the usable range, drawn small (readPixels rows run bottom-up, so they are flipped). */
function Filmstrip({ frames }: { frames: SampleFrame[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext('2d');
    if (!c || !g) return;
    frames.forEach((f, i) => {
      const w = f.w ?? 64, h = f.h ?? 64;
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4;
        for (let x = 0; x < w * 4; x += 4) {
          const d = y * w * 4 + x;
          img.data[d] = f.rgba[src + x]; img.data[d + 1] = f.rgba[src + x + 1]; img.data[d + 2] = f.rgba[src + x + 2]; img.data[d + 3] = 255;
        }
      }
      const t = document.createElement('canvas');
      t.width = w; t.height = h;
      t.getContext('2d')?.putImageData(img, 0, 0);
      g.drawImage(t, i * (THUMB + 2), 0, THUMB, THUMB);
    });
  }, [frames]);
  return <canvas ref={ref} width={frames.length * (THUMB + 2) - 2} height={THUMB} aria-label="The picture across the usable range"
    style={{ width: frames.length * (THUMB + 2) - 2, height: THUMB, borderRadius: 4, flexShrink: 0, imageRendering: 'auto' }} />;
}

const pct = (v: number) => `${Math.round(v * 100)}`;
const num = (v: number) => `${+v.toFixed(3)}`;

/**
 * Suggest controls: measures the open graph (nodes/controlFinder.ts) and lists the settings that change
 * the picture most in useful ways, with a filmstrip across each one's usable range. The top four are
 * ticked; Add to Play makes the controls in one undo step.
 */
export function SuggestControlsPanel({ anchorRef, onClose, offerOpenPlay = false }: { anchorRef: RefObject<HTMLElement | null>; onClose: () => void; offerOpenPlay?: boolean }) {
  const tk = useTokens();
  const fin = useControlFinder();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, ControlName>>({});
  const suggestions = fin.result?.suggestions;

  useEffect(() => { void runControlFinder(); }, []);
  useEffect(() => { setChecked(new Set((suggestions ?? []).slice(0, PRE_CHECKED).map(s => s.target))); }, [suggestions]);
  // A friendlier name from the local explanation model, when one is registered (play/suggestControls.ts).
  useEffect(() => {
    if (!suggestions || !hasControlNamer()) return;
    let live = true;
    for (const s of suggestions) void nameControl(nameContextOf(s)).then(n => { if (live && n) setNames(p => ({ ...p, [s.target]: n })); });
    return () => { live = false; };
  }, [suggestions]);

  const picks = useMemo(() => (suggestions ?? []).filter(s => checked.has(s.target)), [suggestions, checked]);
  const toggle = (t: string) => setChecked(p => { const n = new Set(p); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const add = () => {
    if (!picks.length) return;
    const labels: Record<string, string> = {};
    for (const s of picks) if (names[s.target]) labels[s.target] = names[s.target].label;
    useNodeGraphStore.getState().setPlay(p => addSuggestedControls(p, picks, labels), { label: `Add ${picks.length} suggested Play control${picks.length === 1 ? '' : 's'}` });
    toast.success(`${picks.length} control${picks.length === 1 ? '' : 's'} added to Play`, offerOpenPlay
      ? { action: { label: 'Open Play', onClick: () => useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 })) } }
      : undefined);
    onClose();
  };

  const running = fin.status === 'running';
  const small = { color: tk.text.muted, fontSize: 11.5 } as const;
  const chip = (label: string, v: number, title: string) => (
    <span title={title} style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.secondary, background: tk.bg.panel, borderRadius: 4, padding: '1px 5px', boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>{label} {pct(v)}</span>
  );

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} align="end" width={440} padding={6}>
      <div role="dialog" aria-label="Suggest controls" style={{ color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 2px' }}>
          <Icon name="spark" size={14} style={{ color: tk.accent.text }} />
          <span style={{ flex: 1, fontWeight: 650 }}>Controls that matter</span>
          <button type="button" onClick={() => void runControlFinder(true)} disabled={running} title="Measure again"
            style={{ border: 0, background: 'none', padding: '2px 4px', cursor: running ? 'default' : 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, opacity: running ? 0.5 : 1 }}>Measure again</button>
        </div>
        <div style={{ ...small, padding: '0 6px 6px' }}>
          Each setting is drawn small at five points across its range. These change the picture most, smoothly, without blanking it.
        </div>

        {running && (
          <div style={{ padding: '14px 6px', display: 'flex', flexDirection: 'column', gap: 6 }} role="status">
            <div style={{ height: 4, borderRadius: 2, background: tk.bg.panel, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${fin.total ? Math.round(100 * fin.done / fin.total) : 4}%`, background: tk.accent.base, transition: 'width 120ms' }} />
            </div>
            <span style={small}>{fin.total ? `Trying settings… ${fin.done} of ${fin.total}` : 'Preparing…'}</span>
          </div>
        )}
        {fin.status === 'cannot' && <div style={{ padding: '12px 6px', ...small }}>The graph could not be drawn here, so nothing could be measured. Fix any errors in the graph and try again.</div>}
        {fin.status === 'nothing' && (
          <div style={{ padding: '12px 6px', ...small }}>
            {fin.onPlay > 0 && !(suggestions?.length) ? `Every free setting that matters is already on Play (${fin.onPlay}).` : 'No free setting changes the picture in a useful way.'} Locked settings, wired ones and settings baked into the shader are not offered.
          </div>
        )}

        {fin.status === 'done' && suggestions && (
          <>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {suggestions.map((s: Suggestion) => {
                const on = checked.has(s.target), nm = names[s.target];
                return (
                  <button key={s.target} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(s.target)}
                    onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '6px', border: 0, borderRadius: 8, background: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit' }}>
                    <span style={{ width: 16, height: 16, flexShrink: 0, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? tk.accent.base : 'none', boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${tk.border.strong}`, color: '#ffffff' }}>{on && <Icon name="check" size={12} />}</span>
                    <Filmstrip frames={s.frames} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.label}>{nm?.label ?? s.label}</span>
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {chip('Impact', s.impact, 'How much the picture changes across the range, against the strongest setting')}
                        {chip('Smooth', s.smoothness, 'How gradually it changes: high is good for a knob, low jumps')}
                        {s.motion > 0.05 && chip('Motion', s.motion, 'How much it changes the way the picture moves')}
                      </span>
                      <span style={small}>{nm?.hint ? `${nm.hint} · ` : ''}{num(s.min)} to {num(s.max)}{s.usable < 1 ? ` (${pct(s.usable)}% of the range is usable)` : ''}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px 4px', borderTop: `1px solid ${tk.border.subtle}`, marginTop: 4 }}>
              <span style={{ ...small, flex: 1 }}>
                {fin.result && !fin.result.complete ? `Tried ${fin.result.measured} of ${fin.result.total} settings in the time allowed. ` : ''}
                {fin.onPlay > 0 ? `${fin.onPlay} already on Play. ` : ''}
                {fin.result?.usedEmbedding ? 'Judged with the image model.' : ''}
              </span>
              <Button size="sm" variant="primary" icon="plus" disabled={!picks.length} onClick={add}>{picks.length ? `Add ${picks.length} to Play` : 'Add to Play'}</Button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}

export default SuggestControlsPanel;
