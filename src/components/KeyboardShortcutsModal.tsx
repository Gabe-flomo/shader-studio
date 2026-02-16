import React, { useState, useEffect, useCallback } from 'react';
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

interface Props {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: Props) {
  const [map, setMap]       = useState<ShortcutMap>(loadShortcutMap);
  const [binding, setBinding] = useState<string | null>(null); // actionId being rebound
  const [conflict, setConflict] = useState<string | null>(null); // actionId that has a conflict

  // Close on Escape (but not if we're in binding mode)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (binding) return; // let the binding capture handle it
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [binding, onClose]);

  // Capture a new key combo when in binding mode
  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels
      if (e.key === 'Escape') { setBinding(null); return; }
      // Ignore lone modifier keys
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;

      const combo = normaliseCombo(comboFromEvent(e));
      // Check for conflict with another action
      const conflictId = Object.entries(map).find(
        ([id, c]) => id !== binding && normaliseCombo(c) === combo
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

  const backdrop: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: React.CSSProperties = {
    background: '#1e1e2e',
    border: '1px solid #45475a',
    borderRadius: '12px',
    padding: '24px',
    width: '520px',
    maxWidth: '95vw',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
    color: '#cdd6f4',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
  };

  return (
    <div style={backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#cdd6f4' }}>⌨ Keyboard Shortcuts</div>
            <div style={{ fontSize: '11px', color: '#585b70', marginTop: '3px' }}>
              Click a binding to rebind it. Press the new key combo to save.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '18px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
          >
            ✕
          </button>
        </div>

        {/* Shortcut groups */}
        {Object.entries(groups).map(([group, actions]) => (
          <div key={group} style={{ marginBottom: '20px' }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: '#585b70', marginBottom: '8px',
              paddingBottom: '4px', borderBottom: '1px solid #313244',
            }}>
              {group}
            </div>
            {actions.map(action => {
              const isBinding  = binding === action.id;
              const isConflict = conflict === action.id;
              const combo      = map[action.id] ?? action.defaultCombo;

              return (
                <div
                  key={action.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 8px', borderRadius: '6px', marginBottom: '2px',
                    background: isConflict ? '#ff000022' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <div>
                    <span style={{ color: '#cdd6f4' }}>{action.label}</span>
                    {action.description && (
                      <span style={{ color: '#585b70', fontSize: '11px', marginLeft: '8px' }}>
                        {action.description}
                      </span>
                    )}
                    {isConflict && (
                      <span style={{ color: '#f38ba8', fontSize: '11px', marginLeft: '8px' }}>
                        ⚠ Conflict!
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setBinding(isBinding ? null : action.id)}
                    style={{
                      background: isBinding ? '#89b4fa22' : '#313244',
                      border: isBinding ? '1px solid #89b4fa' : '1px solid #45475a',
                      color: isBinding ? '#89b4fa' : '#cdd6f4',
                      borderRadius: '5px',
                      padding: '3px 10px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                      minWidth: '72px',
                      textAlign: 'center',
                      flexShrink: 0,
                      animation: isBinding ? 'pulse 1s ease-in-out infinite' : 'none',
                    }}
                    title={isBinding ? 'Press new key combo…' : 'Click to rebind'}
                  >
                    {isBinding ? '⬤ press key…' : displayCombo(combo)}
                  </button>
                </div>
              );
            })}
          </div>
        ))}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid #313244' }}>
          <button
            onClick={handleReset}
            style={{
              background: 'none', border: '1px solid #45475a', color: '#a6adc8',
              borderRadius: '6px', padding: '5px 14px', fontSize: '12px', cursor: 'pointer',
            }}
          >
            Reset to defaults
          </button>
          <button
            onClick={onClose}
            style={{
              background: '#89b4fa', border: 'none', color: '#1e1e2e',
              borderRadius: '6px', padding: '5px 14px', fontSize: '12px',
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
