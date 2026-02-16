import { useBreakpoint, isMobile } from '../hooks/useBreakpoint';

type Page = 'studio' | 'learn' | 'shortcuts';

interface TopNavProps {
  page: Page;
  onPageChange: (page: Page) => void;
  /** On mobile the nav floats over the canvas — pass true to use transparent bg + blur */
  floating?: boolean;
}

export function TopNav({ page, onPageChange, floating = false }: TopNavProps) {
  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  return (
    <div
      style={{
        height: '44px',
        flexShrink: 0,
        background: floating
          ? 'rgba(24, 24, 37, 0.85)'
          : '#181825',
        backdropFilter: floating ? 'blur(12px)' : undefined,
        WebkitBackdropFilter: floating ? 'blur(12px)' : undefined,
        borderBottom: '1px solid #313244',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: mobile ? '10px' : '12px',
        paddingRight: mobile ? '10px' : '0px',
        gap: '4px',
        userSelect: 'none',
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
            color: '#585b70',
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
            color: '#585b70',
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

      {/* Learn tab */}
      <TabButton
        active={page === 'learn'}
        onClick={() => onPageChange('learn')}
        label={mobile ? '📖' : '📖 Learn'}
        title="Learn GLSL"
      />

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
  label: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? '#313244' : 'none',
        border: active ? '1px solid #45475a' : '1px solid transparent',
        color: active ? '#cdd6f4' : '#585b70',
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
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4';
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#585b70';
      }}
    >
      {label}
    </button>
  );
}
