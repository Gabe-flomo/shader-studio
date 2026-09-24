import type { ReactNode } from 'react';
import { useBreakpoint, isMobile } from '../hooks/useBreakpoint';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { ctp } from '../theme/palette';

export type Page = 'studio' | 'shortcuts' | 'glsl' | 'fn';

interface TopNavProps {
  page: Page;
  onPageChange: (page: Page) => void;
  /** On mobile the nav floats over the canvas — pass true to use transparent bg + blur */
  floating?: boolean;
  /** Mobile-only Save/Load graph buttons, right after Undo/Redo — desktop
   *  reaches the same save/load-by-name panels from the node graph's own
   *  toolbar instead, so these are only drawn when both a click handler is
   *  given (i.e. by the mobile call site). */
  onSaveClick?: () => void;
  onLoadClick?: () => void;
  saveActive?: boolean;
  loadActive?: boolean;
}

export function TopNav({ page, onPageChange, floating = false, onSaveClick, onLoadClick, saveActive, loadActive }: TopNavProps) {
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const undo = useNodeGraphStore(s => s.undo);
  const redo = useNodeGraphStore(s => s.redo);

  return (
    <div
      style={{
        // Grows by the status-bar/notch inset (0 on a browser tab, real on
        // an installed/full-screen mobile app) so the bar's own 44px of
        // content sits below it instead of the notch overlapping the icons.
        height: mobile ? 'calc(44px + env(safe-area-inset-top, 0px))' : '44px',
        flexShrink: 0,
        background: floating
          ? 'rgba(24, 24, 37, 0.85)'
          : ctp.mantle,
        backdropFilter: floating ? 'blur(12px)' : undefined,
        WebkitBackdropFilter: floating ? 'blur(12px)' : undefined,
        borderBottom: `1px solid ${ctp.surface0}`,
        display: 'flex',
        alignItems: mobile ? 'flex-end' : 'center',
        paddingLeft: mobile ? 'max(10px, env(safe-area-inset-left, 0px))' : '12px',
        paddingRight: mobile ? 'max(10px, env(safe-area-inset-right, 0px))' : '0px',
        paddingBottom: mobile ? '8px' : 0,
        gap: '4px',
        userSelect: 'none',
        boxSizing: 'border-box',
        // When floating on mobile, position absolute at top
        ...(floating ? {
          position: 'absolute' as const,
          top: 0,
          left: 0,
          right: 0,
          zIndex: 30,
        } : {}),
      }}
    >
      {/* Logo / title — hide on mobile to save space */}
      {!mobile && (
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: ctp.surface2,
            letterSpacing: '0.08em',
            marginRight: '12px',
            fontFamily: 'monospace',
          }}
        >
          SHADER STUDIO
        </span>
      )}

      {/* Mobile: show short brand mark */}
      {mobile && (
        <span
          style={{
            fontSize: '13px',
            color: ctp.surface2,
            marginRight: '8px',
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: '0.05em',
          }}
        >
          ⬡ SS
        </span>
      )}

      {/* Studio tab */}
      <TabButton
        active={page === 'studio'}
        onClick={() => onPageChange('studio')}
        label={mobile ? '⬡' : '⬡ Studio'}
        title="Node Graph Studio"
      />

      {/* Function Builder / GLSL editor tabs — desktop only. Mobile has no
          keyboard shortcut to reach either, and screen space is tight, so
          they're swapped for Undo/Redo below instead. */}
      {!mobile && (
        <>
          <TabButton
            active={page === 'fn'}
            onClick={() => onPageChange('fn')}
            label="ƒ( ) Builder"
            title="Function Builder — write and plot named GLSL functions"
          />
          <TabButton
            active={page === 'glsl'}
            onClick={() => onPageChange('glsl')}
            label="</> GLSL"
            title="Raw GLSL Editor"
          />
        </>
      )}

      {/* Mobile: no Cmd+Z here, so undo/redo need an explicit button. Drawn
          as SVG rather than a Unicode arrow glyph (↶/↷) — those render
          inconsistently thin/cramped across fonts, unlike the rest of this
          bar's crisp text labels. */}
      {mobile && (
        <>
          <TabButton active={false} onClick={undo} label={<IconUndo />} title="Undo" />
          <TabButton active={false} onClick={redo} label={<IconRedo />} title="Redo" />
        </>
      )}

      {/* Save/load the whole graph by name — mobile-only entry point, right
          after Undo/Redo. Just the graph: not expr-block or custom-fn
          presets, which have their own separate save flows elsewhere. */}
      {mobile && onSaveClick && (
        <TabButton active={!!saveActive} onClick={onSaveClick} label="💾" title="Save graph" />
      )}
      {mobile && onLoadClick && (
        <TabButton active={!!loadActive} onClick={onLoadClick} label="📂" title="Load graph" />
      )}

      {/* Shortcuts tab */}
      <TabButton
        active={page === 'shortcuts'}
        onClick={() => onPageChange('shortcuts')}
        label={mobile ? '⌨' : '⌨ Keys'}
        title="Keyboard Shortcuts"
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: active ? ctp.surface0 : 'none',
        border: active ? `1px solid ${ctp.surface1}` : '1px solid transparent',
        color: active ? ctp.text : ctp.surface2,
        borderRadius: '5px',
        padding: '4px 14px',
        fontSize: '12px',
        cursor: 'pointer',
        fontFamily: 'system-ui, sans-serif',
        letterSpacing: '0.02em',
        transition: 'color 0.15s, background 0.15s',
        minWidth: '36px',
        touchAction: 'manipulation',
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = ctp.text;
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = ctp.surface2;
      }}
    >
      {label}
    </button>
  );
}

// Same currentColor-stroke, 16x16-viewBox style NodePalette.tsx uses for its
// own icons — crisp at any zoom and immune to the font-rendering quirks a
// Unicode glyph is exposed to (e.g. an emoji-presentation fallback).
function IconUndo() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <polyline points="7,10 3,6.5 7,3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 6.5 H9 a3 3 0 0 1 3 3 V13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconRedo() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <polyline points="9,10 13,6.5 9,3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6.5 H7 a3 3 0 0 0 -3 3 V13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
