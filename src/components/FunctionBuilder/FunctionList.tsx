import { useState } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import { FunctionEditor } from './FunctionEditor';

interface Props {
  glslErrors: string[];
}

// ── Helper reference panel ────────────────────────────────────────────────────

const HELPERS = [
  { group: 'Trig',      items: ['sin(x)', 'cos(x)', 'tan(x)', 'atan(y,x)'] },
  { group: 'Math',      items: ['abs(x)', 'sign(x)', 'mod(x,y)', 'pow(x,y)', 'sqrt(x)', 'exp(x)', 'log(x)'] },
  { group: 'Range',     items: ['min(a,b)', 'max(a,b)', 'clamp(x,a,b)', 'mix(a,b,t)', 'smoothstep(e0,e1,x)', 'step(e,x)'] },
  { group: 'Rounding',  items: ['floor(x)', 'ceil(x)', 'fract(x)', 'round(x)'] },
  { group: 'Vector',    items: ['length(v)', 'dot(a,b)', 'normalize(v)', 'cross(a,b)', 'reflect(i,n)'] },
  { group: 'SDF',       items: ['smin(a,b,k)', 'sdBox(p,b)', 'sdSegment(p,a,b)', 'opRepeat(p,s)', 'opRepeatPolar(p,n)'] },
  { group: 'Misc',      items: ['PI', 'TAU', 'u_time', 'u_resolution', 'rotate(v,a)', 'rot2D(a)'] },
];

function HelpersPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid #1e1e2e' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: '#45475a',
          fontSize: '10px',
          fontFamily: 'monospace',
          padding: '5px 10px',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#45475a')}
      >
        <span style={{ fontSize: '8px' }}>{open ? '▼' : '▶'}</span>
        Available helpers
      </button>

      {open && (
        <div style={{ padding: '4px 10px 8px', maxHeight: '220px', overflowY: 'auto' }}>
          {HELPERS.map(({ group, items }) => (
            <div key={group} style={{ marginBottom: '6px' }}>
              <div style={{ fontSize: '9px', color: '#585b70', fontFamily: 'monospace', marginBottom: '2px', letterSpacing: '0.06em' }}>
                {group}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {items.map(item => (
                  <code
                    key={item}
                    style={{
                      fontSize: '9px',
                      color: '#89dceb',
                      background: '#1e1e2e',
                      border: '1px solid #313244',
                      borderRadius: '3px',
                      padding: '1px 4px',
                      fontFamily: 'monospace',
                      userSelect: 'all',
                    }}
                  >
                    {item}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FunctionList({ glslErrors }: Props) {
  const { functions, activeId, addFunction } = useFunctionBuilder();

  const fnErrors = (id: string) => {
    const fn = functions.find(f => f.id === id);
    if (!fn) return [];
    return glslErrors.filter(e => e.toLowerCase().includes(fn.name + '('));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {functions.map((fn, i) => (
          <FunctionEditor
            key={fn.id}
            fn={fn}
            index={i}
            isActive={fn.id === activeId}
            errors={fnErrors(fn.id)}
          />
        ))}
      </div>

      <HelpersPanel />

      <div style={{ flexShrink: 0, padding: '6px 8px', borderTop: '1px solid #313244' }}>
        <button
          onClick={addFunction}
          style={{
            width: '100%',
            background: '#1e1e2e',
            border: '1px dashed #45475a',
            color: '#585b70',
            borderRadius: '6px',
            padding: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#6c7086';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = '#585b70';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#45475a';
          }}
        >
          + Add Function
        </button>
      </div>
    </div>
  );
}
