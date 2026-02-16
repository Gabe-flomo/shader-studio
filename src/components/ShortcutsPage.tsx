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

export function ShortcutsPage() {
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

  const groupColors: Record<string, string> = {
    'Graph':      '#89b4fa',
    'View':       '#a6e3a1',
    'Add Nodes':  '#cba6f7',
    'Filter':     '#f9e2af',
    'Help':       '#74c7ec',
  };

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        background: '#11111b',
        color: '#cdd6f4',
        fontFamily: 'system-ui, sans-serif',
        padding: '32px',
      }}
    >
      {/* Page header */}
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#cdd6f4' }}>
            ⌨ Keyboard Shortcuts
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#585b70' }}>
            Click any binding to rebind it — then press the new key combo. Changes save automatically.
          </p>
        </div>

        {/* Groups in a 2-column grid on wide screens */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '24px',
            alignItems: 'start',
          }}
        >
          {Object.entries(groups).map(([group, actions]) => {
            const accent = groupColors[group] ?? '#585b70';
            return (
              <div
                key={group}
                style={{
                  background: '#1e1e2e',
                  border: '1px solid #313244',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                {/* Group header */}
                <div
                  style={{
                    padding: '10px 14px',
                    background: '#181825',
                    borderBottom: '1px solid #313244',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: accent, flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: '11px', fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      color: accent,
                    }}
                  >
                    {group}
                  </span>
                </div>

                {/* Actions */}
                <div style={{ padding: '6px 8px' }}>
                  {actions.map(action => {
                    const isBinding  = binding === action.id;
                    const isConflict = conflict === action.id;
                    const isSaved    = saved === action.id;
                    const combo      = map[action.id] ?? action.defaultCombo;

                    return (
                      <div
                        key={action.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '7px 6px',
                          borderRadius: '6px',
                          background: isConflict ? '#f38ba822' : isSaved ? '#a6e3a111' : 'transparent',
                          transition: 'background 0.2s',
                          gap: '12px',
                        }}
                      >
                        {/* Label + description */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', color: '#cdd6f4', fontWeight: 500 }}>
                            {action.label}
                            {isSaved && (
                              <span style={{ color: '#a6e3a1', fontSize: '11px', marginLeft: '8px' }}>
                                ✓ saved
                              </span>
                            )}
                            {isConflict && (
                              <span style={{ color: '#f38ba8', fontSize: '11px', marginLeft: '8px' }}>
                                ⚠ conflict!
                              </span>
                            )}
                          </div>
                          {action.description && (
                            <div style={{ fontSize: '11px', color: '#45475a', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {action.description}
                            </div>
                          )}
                        </div>

                        {/* Binding chip */}
                        <button
                          onClick={() => setBinding(isBinding ? null : action.id)}
                          style={{
                            flexShrink: 0,
                            background: isBinding ? '#89b4fa22' : '#313244',
                            border: isBinding ? `1px solid #89b4fa` : `1px solid #45475a`,
                            color: isBinding ? '#89b4fa' : '#cdd6f4',
                            borderRadius: '6px',
                            padding: '4px 12px',
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            cursor: 'pointer',
                            minWidth: '80px',
                            textAlign: 'center',
                            letterSpacing: '0.02em',
                            transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                          }}
                          title={isBinding ? 'Press new key combo (Esc to cancel)' : 'Click to rebind'}
                        >
                          {isBinding ? '● press key…' : displayCombo(combo)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: '32px',
            paddingTop: '20px',
            borderTop: '1px solid #313244',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <p style={{ margin: 0, fontSize: '12px', color: '#45475a' }}>
            Shortcuts are stored locally in your browser. They survive page refreshes.
          </p>
          <button
            onClick={handleReset}
            style={{
              background: 'none',
              border: '1px solid #45475a',
              color: '#a6adc8',
              borderRadius: '6px',
              padding: '6px 16px',
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#f38ba8';
              (e.currentTarget as HTMLButtonElement).style.color = '#f38ba8';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#45475a';
              (e.currentTarget as HTMLButtonElement).style.color = '#a6adc8';
            }}
          >
            Reset all to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
