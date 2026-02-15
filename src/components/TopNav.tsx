import React from 'react';

type Page = 'studio' | 'learn';

interface TopNavProps {
  page: Page;
  onPageChange: (page: Page) => void;
}

export function TopNav({ page, onPageChange }: TopNavProps) {
  return (
    <div
      style={{
        height: '36px',
        flexShrink: 0,
        background: '#181825',
        borderBottom: '1px solid #313244',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '12px',
        gap: '4px',
        userSelect: 'none',
      }}
    >
      {/* Logo / title */}
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

      {/* Studio tab */}
      <TabButton
        active={page === 'studio'}
        onClick={() => onPageChange('studio')}
        label="⬡ Studio"
      />

      {/* Learn tab */}
      <TabButton
        active={page === 'learn'}
        onClick={() => onPageChange('learn')}
        label="📖 Learn"
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#313244' : 'none',
        border: active ? '1px solid #45475a' : '1px solid transparent',
        color: active ? '#cdd6f4' : '#585b70',
        borderRadius: '5px',
        padding: '3px 12px',
        fontSize: '11px',
        cursor: 'pointer',
        fontFamily: 'system-ui, sans-serif',
        letterSpacing: '0.02em',
        transition: 'color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.color = '#585b70';
        }
      }}
    >
      {label}
    </button>
  );
}
