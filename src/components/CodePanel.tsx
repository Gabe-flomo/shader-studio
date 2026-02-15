import { useState } from 'react';

interface Props {
  code: string;
  onClose: () => void;
}

export function CodePanel({ code, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write failed silently
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '240px',
        background: '#181825',
        borderTop: '1px solid #313244',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          background: '#1e1e2e',
          borderBottom: '1px solid #313244',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#89b4fa', letterSpacing: '0.04em' }}>
          Fragment Shader
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={handleCopy}
            title="Copy shader code to clipboard"
            style={{
              background: copied ? '#a6e3a122' : '#313244',
              border: `1px solid ${copied ? '#a6e3a155' : '#45475a'}`,
              color: copied ? '#a6e3a1' : '#cdd6f4',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
          <button
            onClick={onClose}
            title="Close code panel"
            style={{
              background: 'none',
              border: 'none',
              color: '#585b70',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Code content */}
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: '8px 14px',
          overflowY: 'auto',
          overflowX: 'auto',
          color: '#cdd6f4',
          fontSize: '11px',
          fontFamily: 'monospace',
          whiteSpace: 'pre',
          lineHeight: 1.5,
        }}
      >
        {code || '// No shader compiled yet'}
      </pre>
    </div>
  );
}
