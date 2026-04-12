import { useState, useEffect, useCallback } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

const BOILERPLATE = `precision mediump float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

varying vec2 vUv;

// ── Built-in noise helpers ────────────────────────────────────────────────
vec2 noiseHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noiseHash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float valueNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(noiseHash1(i), noiseHash1(i+vec2(1,0)), u.x),
               mix(noiseHash1(i+vec2(0,1)), noiseHash1(i+vec2(1,1)), u.x), u.y);
}
// ─────────────────────────────────────────────────────────────────────────

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    gl_FragColor = vec4(vec3(0.0), 1.0);
}`;

const STORAGE_KEY = 'shader-studio:glsl-editor';

export function GLSLPage() {
  const setRawGlslShader = useNodeGraphStore(s => s.setRawGlslShader);
  const nodeGraphShader  = useNodeGraphStore(s => s.fragmentShader);
  const glslErrors       = useNodeGraphStore(s => s.glslErrors);

  const [code, setCode] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) ?? BOILERPLATE;
  });

  // Apply the current code on mount and whenever it changes
  useEffect(() => {
    setRawGlslShader(code);
    localStorage.setItem(STORAGE_KEY, code);
  }, [code, setRawGlslShader]);

  // Clear override on unmount so node graph resumes
  useEffect(() => {
    return () => { setRawGlslShader(null); };
  }, [setRawGlslShader]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab → insert 4 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const next  = code.slice(0, start) + '    ' + code.slice(end);
      setCode(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 4;
      });
    }
  }, [code]);

  const lineCount = code.split('\n').length;

  return (
    <div style={{
      display: 'flex', height: '100%', background: '#11111b',
      fontFamily: 'monospace', overflow: 'hidden',
    }}>
      {/* ── Editor pane ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        borderRight: '1px solid #313244', minWidth: 0,
      }}>
        {/* Header bar */}
        <div style={{
          height: '36px', flexShrink: 0,
          background: '#1e1e2e', borderBottom: '1px solid #313244',
          display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px',
        }}>
          <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
            Fragment Shader
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setCode(nodeGraphShader || BOILERPLATE)}
            title="Copy current node graph output into editor"
            style={{
              background: '#313244', border: '1px solid #45475a',
              color: '#89b4fa', borderRadius: '4px',
              padding: '2px 10px', fontSize: '10px', cursor: 'pointer',
            }}
          >
            ← From Graph
          </button>
          <button
            onClick={() => {
              if (window.confirm('Reset to boilerplate?')) setCode(BOILERPLATE);
            }}
            style={{
              background: 'none', border: '1px solid #45475a',
              color: '#585b70', borderRadius: '4px',
              padding: '2px 10px', fontSize: '10px', cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>

        {/* Code editor area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {/* Line numbers */}
          <div style={{
            width: '40px', flexShrink: 0,
            background: '#13131f', borderRight: '1px solid #1e1e2e',
            overflowY: 'hidden', paddingTop: '10px',
            color: '#3d4059', fontSize: '12px', lineHeight: '1.6',
            textAlign: 'right', paddingRight: '6px',
            userSelect: 'none', pointerEvents: 'none',
          }}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Textarea */}
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            style={{
              flex: 1,
              background: '#13131f',
              color: '#cdd6f4',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '10px 12px',
              fontSize: '12px',
              lineHeight: '1.6',
              fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
              tabSize: 4,
            }}
          />
        </div>

        {/* Error bar */}
        {glslErrors.length > 0 && (
          <div style={{
            background: '#2d1b1b', borderTop: '1px solid #f38ba833',
            padding: '6px 12px', maxHeight: '120px', overflowY: 'auto',
          }}>
            {glslErrors.map((err, i) => (
              <div key={i} style={{ fontSize: '11px', color: '#f38ba8', fontFamily: 'monospace', lineHeight: 1.5 }}>
                {err}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
