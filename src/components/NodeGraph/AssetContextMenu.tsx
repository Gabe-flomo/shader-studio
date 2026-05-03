import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  destructive?: boolean;
  disabled?: boolean;
  separator?: boolean; // render a divider above this item
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
}

export function AssetContextMenu({ x, y, items, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Clamp to viewport
  const clampedX = Math.min(x, window.innerWidth  - 180);
  const clampedY = Math.min(y, window.innerHeight - items.length * 28 - 16);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    // Use capture so we catch clicks before anything else
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onDismiss]);

  // Also dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return ReactDOM.createPortal(
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: clampedX,
        top: clampedY,
        zIndex: 99999,
        background: '#1e1e2e',
        border: '1px solid #45475a',
        borderRadius: '6px',
        padding: '4px 0',
        minWidth: '170px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.7)',
        userSelect: 'none',
      }}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.separator && i > 0 && (
            <div style={{ borderTop: '1px solid #313244', margin: '3px 0' }} />
          )}
          <button
            disabled={item.disabled}
            onClick={() => { onDismiss(); item.action(); }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              padding: '5px 14px',
              fontSize: '11px',
              color: item.disabled ? '#45475a' : item.destructive ? '#f38ba8' : '#cdd6f4',
              cursor: item.disabled ? 'default' : 'pointer',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={e => {
              if (!item.disabled)
                (e.currentTarget as HTMLButtonElement).style.background = item.destructive ? '#f38ba811' : '#313244';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>,
    document.body,
  );
}
