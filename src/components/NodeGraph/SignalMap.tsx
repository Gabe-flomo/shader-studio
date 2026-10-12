/**
 * The webcam Texture node's quick map mode (docs/texture-node.md, "Map mode"; lib/texture/signalMap.ts):
 *
 * - **SignalChips** (on the card, while hand tracking is on): the hand signals as chips with their
 *   live values. A click starts map mode with that signal; a second click leaves it.
 * - **SignalMapLayer** (once, in NodeGraph): while map mode is on, the cursor is a crosshair and
 *   every slider row on every card is outlined as a target. A click on one maps the signal onto it
 *   (a Play control first if it isn't one) and says so in a toast. Esc leaves map mode.
 *
 * The layer works on the DOM rows the cards already mark (`data-node-id` › `data-param-key`, the
 * same marks the right-click Play menu reads), with one stylesheet and capture-phase listeners, so
 * no card re-renders when map mode starts or stops.
 */
import { useEffect, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { toast } from '../ui/toastStore';
import { playEngine } from '../../lib/playEngine';
import { handSignalChips, mapSignalOnto, mappedMessage, useSignalMap, type SignalChip } from '../../lib/texture/signalMap';

const BODY_CLASS = 'pf-signal-map';

/** The card's chips. `live`: read the values (off in tests and while tracking is off). */
export function SignalChips({ live = true }: { live?: boolean }) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const active = useSignalMap(s => s.chip?.key ?? null);
  const toggle = useSignalMap(s => s.toggle);
  const chips = handSignalChips(play);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const keys = chips.map(c => c.key).join('|');
  useEffect(() => {
    if (!live) return;
    // Ten readings a second is plenty for a chip, and costs nothing next to the tracker.
    const read = () => setValues(Object.fromEntries(handSignalChips(useNodeGraphStore.getState().play).map(c => [c.key, playEngine.readSource(c.source)])));
    read();
    const id = window.setInterval(read, 100);
    return () => window.clearInterval(id);
  }, [live, keys]);

  return (
    <div data-signal-chips style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {chips.map(c => {
        const on = c.key === active;
        const v = values[c.key];
        return (
          <button key={c.key} type="button" data-signal-chip={c.key} aria-pressed={on}
            title={on ? 'Click a slider on any card to map this onto it · Esc or click again to stop' : `Map ${c.label} onto a slider: click, then click the slider`}
            onClick={() => toggle(c)}
            style={{
              position: 'relative', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 7px',
              borderRadius: radius.md, cursor: 'pointer', font: `500 10.5px ${fontFamily.ui}`,
              border: `1px solid ${on ? tk.accent.base : tk.border.default}`, background: on ? alpha(tk.accent.base, 0.16) : tk.bg.field,
              color: on ? tk.accent.text : tk.text.secondary,
            }}>
            {/* The live value as a fill behind the label. */}
            <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round((v ?? 0) * 100)}%`, background: alpha(tk.accent.base, 0.14), pointerEvents: 'none' }} />
            <span style={{ position: 'relative' }}>{c.label}</span>
            <span style={{ position: 'relative', color: tk.text.faint, font: `500 10px ${fontFamily.mono}` }}>{v == null ? '–' : v.toFixed(2)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The slider row (and its card's node id) under a pointer event, or null. */
function rowAt(target: EventTarget | null): { nodeId: string; paramKey: string } | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest('[data-param-key]') as HTMLElement | null;
  const card = row?.closest('[data-node-id]') as HTMLElement | null;
  const nodeId = card?.dataset.nodeId, paramKey = row?.dataset.paramKey;
  return nodeId && paramKey ? { nodeId, paramKey } : null;
}

/** Map `chip` onto the slider at nodeId/paramKey, write Play, and say what happened. True when mapped. */
export function mapChipOnto(chip: SignalChip, nodeId: string, paramKey: string): boolean {
  const st = useNodeGraphStore.getState();
  const r = mapSignalOnto(st.play, st.nodes, st.paramBindings, chip.source, nodeId, paramKey);
  if (!r.ok) { toast.info('Can’t map onto that slider', { message: r.reason }); return false; }
  st.setPlay(() => r.play);
  toast.success(mappedMessage(chip.label, r.control.label));
  return true;
}

export function SignalMapLayer() {
  const tk = useTokens();
  const chip = useSignalMap(s => s.chip);
  const stop = useSignalMap(s => s.stop);

  useEffect(() => {
    if (!chip) return;
    const style = document.createElement('style');
    style.dataset.signalMapStyle = '';
    style.textContent = `
      body.${BODY_CLASS}, body.${BODY_CLASS} [data-node-id], body.${BODY_CLASS} [data-node-id] * { cursor: crosshair !important; }
      body.${BODY_CLASS} [data-node-id] [data-param-key] { outline: 1px dashed ${tk.accent.base}; outline-offset: -2px; border-radius: 6px; }
      body.${BODY_CLASS} [data-node-id] [data-param-key], body.${BODY_CLASS} [data-node-id] [data-param-key] * { cursor: copy !important; }
      body.${BODY_CLASS} [data-node-id] [data-param-key]:hover { background: ${alpha(tk.accent.base, 0.16)}; outline-style: solid; }
    `;
    document.head.appendChild(style);
    document.body.classList.add(BODY_CLASS);

    // A click on a row maps; the press never reaches the slider (no drag, no edit), nor do the
    // mouse events that follow it on that row, even once map mode has ended.
    let swallowUntil = 0, live = true;
    const onDown = (e: PointerEvent) => {
      const row = rowAt(e.target);
      if (!row) return;
      e.preventDefault(); e.stopPropagation();
      swallowUntil = performance.now() + 800;
      if (mapChipOnto(chip, row.nodeId, row.paramKey)) stop();
    };
    const onMouse = (e: MouseEvent) => {
      if (!rowAt(e.target) || (!live && performance.now() > swallowUntil)) return;
      e.preventDefault(); e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('click', onMouse, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      live = false;
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove(BODY_CLASS);
      style.remove();
      // The mouse events that follow the mapping press still have to be kept from the slider.
      const left = Math.max(0, swallowUntil - performance.now());
      const off = () => { window.removeEventListener('mousedown', onMouse, true); window.removeEventListener('click', onMouse, true); };
      if (left > 0) window.setTimeout(off, left); else off();
    };
  }, [chip, stop, tk.accent.base]);

  if (!chip) return null;
  return (
    <div role="status" data-signal-map-banner style={{
      position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 60, pointerEvents: 'none',
      padding: '6px 12px', borderRadius: radius.md, background: tk.bg.panel, border: `1px solid ${tk.accent.base}`,
      color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    }}>
      Click a slider to map <b>{chip.label}</b> onto it · Esc to stop
    </div>
  );
}
