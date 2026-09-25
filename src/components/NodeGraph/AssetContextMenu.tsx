import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { ctp } from '../../theme/palette';
import { portalGuard } from '../ui/portalGuard';

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
      {...portalGuard}
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: clampedX,
        top: clampedY,
        zIndex: 99999,
        background: ctp.base,
        border: `1px solid ${ctp.surface1}`,
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
            <div style={{ borderTop: `1px solid ${ctp.surface0}`, margin: '3px 0' }} />
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
              color: item.disabled ? ctp.surface1 : item.destructive ? ctp.red : ctp.text,
              cursor: item.disabled ? 'default' : 'pointer',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={e => {
              if (!item.disabled)
                (e.currentTarget as HTMLButtonElement).style.background = item.destructive ? `${ctp.red}11` : ctp.surface0;
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
