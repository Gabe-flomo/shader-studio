import { useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_ACTIONS,
  type ShortcutMap,
  loadShortcutMap,
  saveShortcutMap,
  resetShortcutMap,
  displayCombo,
  normaliseCombo,
  comboFromEvent,
} from '../hooks/useShortcuts';
import { useTokens } from '../theme/themeStore';
import { alpha, fontFamily, radius } from '../theme/tokens';
import { Button } from './ui/Button';

export function ShortcutsPage() {
  const tk = useTokens();
  const [map, setMap]         = useState<ShortcutMap>(loadShortcutMap);
  const [binding, setBinding] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saved, setSaved]     = useState<string | null>(null); // flash "saved" on action label

  // Capture a new key combo when in binding mode
  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setBinding(null); return; }
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;

      const combo = normaliseCombo(comboFromEvent(e));
      const conflictId = Object.entries(map).find(
        ([id, c]) => id !== binding && normaliseCombo(c) === combo,
      )?.[0];

      if (conflictId) {
        setConflict(conflictId);
        setTimeout(() => setConflict(null), 1500);
        setBinding(null);
        return;
      }

      const next = { ...map, [binding]: combo };
      setMap(next);
      saveShortcutMap(next);
      setSaved(binding);
      setTimeout(() => setSaved(null), 1000);
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [binding, map]);

  const handleReset = useCallback(() => {
    const fresh = resetShortcutMap();
    setMap(fresh);
  }, []);

  // Group actions
  const groups = DEFAULT_ACTIONS.reduce<Record<string, typeof DEFAULT_ACTIONS>>((acc, a) => {
    (acc[a.group] ??= []).push(a);
    return acc;
  }, {});

  // Split the groups into two columns of roughly equal height.
  const columns: [string, typeof DEFAULT_ACTIONS][][] = [[], []];
  const heights = [0, 0];
  for (const entry of Object.entries(groups)) {
    const col = heights[0] <= heights[1] ? 0 : 1;
    columns[col].push(entry);
    heights[col] += entry[1].length + 1.5;
  }

  const groupColor = (g: string) =>
    ({ Graph: tk.accent.base, View: tk.status.success, 'Add Nodes': tk.kind.expr, Filter: tk.status.warning }[g] ?? tk.text.faint);

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: tk.bg.app, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '44px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>Keyboard shortcuts</div>
            <div style={{ color: tk.text.muted, marginTop: 6 }}>Click any binding to rebind it, then press the new key combo. Changes save automatically.</div>
          </div>
          <Button size="sm" icon="reset" onClick={handleReset}>Reset all to defaults</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {col.map(([group, actions]) => (
                <div key={group} style={{ background: tk.bg.panel, borderRadius: radius.card, boxShadow: tk.shadow.card, padding: '6px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: groupColor(group) }} />{group}
                  </div>
                  {actions.map(action => (
                    <ShortcutRow
                      key={action.id}
                      label={action.label}
                      description={action.description}
                      combo={map[action.id] ?? action.defaultCombo}
                      binding={binding === action.id}
                      conflict={conflict === action.id}
                      saved={saved === action.id}
                      onClick={() => setBinding(binding === action.id ? null : action.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ color: tk.text.faint, fontSize: 12 }}>Shortcuts are stored locally in your browser. They survive page refreshes.</div>
      </div>
    </div>
  );
}

function ShortcutRow({ label, description, combo, binding, conflict, saved, onClick }: {
  label: string; description?: string; combo: string;
  binding: boolean; conflict: boolean; saved: boolean; onClick: () => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px', border: 0, cursor: 'pointer', textAlign: 'left',
        background: binding ? tk.bg.selected : conflict ? alpha(tk.status.danger, 0.1) : hover ? tk.bg.hover : 'transparent',
        font: `12.5px ${fontFamily.ui}`, color: tk.text.primary,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {saved && <span style={{ fontSize: 11, fontWeight: 600, color: tk.status.success }}>Saved</span>}
          {conflict && <span style={{ fontSize: 11, fontWeight: 600, color: tk.status.danger }}>Already uses that key</span>}
        </span>
        {description && <span style={{ fontSize: 12, color: tk.text.muted }}>{description}</span>}
      </span>
      {binding ? (
        <span style={{ height: 28, display: 'flex', alignItems: 'center', padding: '0 10px', borderRadius: 7, background: tk.bg.panel, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.accent.text, fontSize: 12, fontWeight: 600 }}>
          Press new keys…
        </span>
      ) : (
        <span style={{ display: 'flex', gap: 4 }}>
          {combo.split('+').map((part, i) => (
            <span key={i} style={{
              minWidth: 26, height: 28, boxSizing: 'border-box', padding: '0 7px', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: tk.bg.field, boxShadow: `inset 0 -1.5px 0 ${tk.border.strong}`, font: `600 12px ${fontFamily.mono}`, color: tk.text.primary,
            }}>{displayCombo(part)}</span>
          ))}
        </span>
      )}
    </button>
  );
}
