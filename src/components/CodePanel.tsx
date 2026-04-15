import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  code: string;
  onClose: () => void;
  highlightNodeId?: string | null;
  nodeSlugMap?: Map<string, string>;
}

export function CodePanel({ code, onClose, highlightNodeId, nodeSlugMap }: Props) {
  const [copied, setCopied] = useState(false);
  const firstMatchRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write failed silently
    }
  };

  // Scroll to first highlighted line when selection changes
  useEffect(() => {
    if (!highlightNodeId) return;
    // Small delay so the DOM has rendered the highlighted lines
    const t = setTimeout(() => {
      firstMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 40);
    return () => clearTimeout(t);
  }, [highlightNodeId]);

  const setFirstMatch = useCallback((el: HTMLDivElement | null) => {
    firstMatchRef.current = el;
  }, []);

  // Split code into annotated lines
  // Use the slug for the selected node so the prefix matches the GLSL variable names
  const highlightSlug = highlightNodeId
    ? (nodeSlugMap?.get(highlightNodeId) ?? highlightNodeId)
    : null;
  const prefix = highlightSlug ? `${highlightSlug}_` : null;
  const lines = code ? code.split('\n') : ['// No shader compiled yet'];

  // Pre-compute preferred scroll target: first match inside void main, fallback to first match anywhere
  const scrollToLineIdx = (() => {
    if (!prefix) return -1;
    let firstAny = -1;
    let inMain = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith('void main')) inMain = true;
      if (lines[i].includes(prefix)) {
        if (firstAny === -1) firstAny = i;
        if (inMain) return i; // first match inside main — use this
      }
    }
    return firstAny; // fallback: first match anywhere
  })();

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#89b4fa', letterSpacing: '0.04em' }}>
            Fragment Shader
          </span>
          {highlightSlug && (
            <span style={{ fontSize: '10px', color: '#f9e2af', fontFamily: 'monospace', opacity: 0.8 }}>
              ↳ {highlightSlug}
            </span>
          )}
        </div>
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
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          padding: '6px 0',
          fontFamily: 'monospace',
          fontSize: '11px',
          lineHeight: 1.55,
        }}
      >
        {lines.map((line, i) => {
          const isMatch = !!(prefix && line.includes(prefix));
          let refProp: ((el: HTMLDivElement | null) => void) | undefined;
          if (i === scrollToLineIdx) {
            refProp = setFirstMatch;
          }
          return (
            <div
              key={i}
              ref={refProp}
              style={{
                padding: '0 14px',
                background: isMatch ? '#89b4fa18' : 'transparent',
                borderLeft: isMatch ? '2px solid #89b4fa88' : '2px solid transparent',
                color: isMatch ? '#cdd6f4' : '#585b70',
                whiteSpace: 'pre',
                transition: 'background 0.15s',
              }}
            >
              {line || ' '}
            </div>
          );
        })}
      </div>
    </div>
  );
}
