import { useState, useRef } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import type { FnDef } from './useFunctionBuilder';
import { FunctionEditor } from './FunctionEditor';
import { ctp } from '../../theme/palette';

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar() {
  const { tabs, activeTabId, addTab, closeTab, switchTab, renameTab } = useFunctionBuilder();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      overflowX: 'auto',
      flexShrink: 0,
      borderBottom: `1px solid ${ctp.surface0}`,
      background: ctp.mantle,
      scrollbarWidth: 'none',
    }}>
      {tabs.map(tab => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRight: `1px solid ${ctp.surface0}`,
              background: active ? ctp.base : 'transparent',
              borderBottom: active ? `2px solid ${ctp.blue}` : '2px solid transparent',
              cursor: 'pointer',
              flexShrink: 0,
              minWidth: 0,
            }}
          >
            {editingId === tab.id ? (
              <input
                autoFocus
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onBlur={() => { renameTab(tab.id, editVal || tab.label); setEditingId(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameTab(tab.id, editVal || tab.label); setEditingId(null); }
                  if (e.key === 'Escape') setEditingId(null);
                  e.stopPropagation();
                }}
                onClick={e => e.stopPropagation()}
                style={{
                  background: 'none', border: 'none', outline: 'none',
                  color: ctp.text, fontSize: '11px', fontFamily: 'monospace',
                  width: '64px', padding: 0,
                }}
              />
            ) : (
              <span
                onDoubleClick={e => { e.stopPropagation(); setEditingId(tab.id); setEditVal(tab.label); }}
                style={{ fontSize: '11px', color: active ? ctp.text : ctp.surface2, fontFamily: 'monospace', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {tab.label}
              </span>
            )}
            {tabs.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                style={{ background: 'none', border: 'none', color: ctp.surface1, cursor: 'pointer', fontSize: '10px', padding: '0 1px', lineHeight: 1, flexShrink: 0 }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = ctp.red)}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = ctp.surface1)}
              >×</button>
            )}
          </div>
        );
      })}
      <button
        onClick={addTab}
        title="New tab"
        style={{ background: 'none', border: 'none', color: ctp.surface1, cursor: 'pointer', fontSize: '14px', padding: '4px 8px', lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = ctp.blue)}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = ctp.surface1)}
      >+</button>
    </div>
  );
}

interface Props {
  glslErrors: string[];
}

// ── GLSL palette ──────────────────────────────────────────────────────────────

interface PaletteEntry { label: string; insert: string; group: string; floatOk: boolean; }

const PALETTE: PaletteEntry[] = [
  // Trig
  { group: 'Trig',     label: 'sin(x)',          insert: 'sin()',          floatOk: true  },
  { group: 'Trig',     label: 'cos(x)',          insert: 'cos()',          floatOk: true  },
  { group: 'Trig',     label: 'tan(x)',          insert: 'tan()',          floatOk: true  },
  { group: 'Trig',     label: 'asin(x)',         insert: 'asin()',         floatOk: true  },
  { group: 'Trig',     label: 'acos(x)',         insert: 'acos()',         floatOk: true  },
  { group: 'Trig',     label: 'atan(y,x)',       insert: 'atan(, )',       floatOk: true  },
  // Exp / Log
  { group: 'Exp/Log',  label: 'sqrt(x)',         insert: 'sqrt()',         floatOk: true  },
  { group: 'Exp/Log',  label: 'pow(x,y)',        insert: 'pow(, )',        floatOk: true  },
  { group: 'Exp/Log',  label: 'exp(x)',          insert: 'exp()',          floatOk: true  },
  { group: 'Exp/Log',  label: 'exp2(x)',         insert: 'exp2()',         floatOk: true  },
  { group: 'Exp/Log',  label: 'log(x)',          insert: 'log()',          floatOk: true  },
  { group: 'Exp/Log',  label: 'log2(x)',         insert: 'log2()',         floatOk: true  },
  { group: 'Exp/Log',  label: 'inversesqrt(x)',  insert: 'inversesqrt()', floatOk: true  },
  // Math
  { group: 'Math',     label: 'abs(x)',          insert: 'abs()',          floatOk: true  },
  { group: 'Math',     label: 'sign(x)',         insert: 'sign()',         floatOk: true  },
  { group: 'Math',     label: 'mod(x,y)',        insert: 'mod(, )',        floatOk: true  },
  { group: 'Math',     label: 'floor(x)',        insert: 'floor()',        floatOk: true  },
  { group: 'Math',     label: 'ceil(x)',         insert: 'ceil()',         floatOk: true  },
  { group: 'Math',     label: 'fract(x)',        insert: 'fract()',        floatOk: true  },
  { group: 'Math',     label: 'round(x)',        insert: 'round()',        floatOk: true  },
  // Range
  { group: 'Range',    label: 'min(a,b)',        insert: 'min(, )',        floatOk: true  },
  { group: 'Range',    label: 'max(a,b)',        insert: 'max(, )',        floatOk: true  },
  { group: 'Range',    label: 'clamp(x,a,b)',   insert: 'clamp(, , )',    floatOk: true  },
  { group: 'Range',    label: 'mix(a,b,t)',      insert: 'mix(, , )',      floatOk: true  },
  { group: 'Range',    label: 'smoothstep(e0,e1,x)', insert: 'smoothstep(, , )', floatOk: true },
  { group: 'Range',    label: 'step(e,x)',       insert: 'step(, )',       floatOk: true  },
  // Vector
  { group: 'Vector',   label: 'length(v)',       insert: 'length()',       floatOk: false },
  { group: 'Vector',   label: 'normalize(v)',    insert: 'normalize()',    floatOk: false },
  { group: 'Vector',   label: 'dot(a,b)',        insert: 'dot(, )',        floatOk: false },
  { group: 'Vector',   label: 'cross(a,b)',      insert: 'cross(, )',      floatOk: false },
  { group: 'Vector',   label: 'reflect(i,n)',    insert: 'reflect(, )',    floatOk: false },
  { group: 'Vector',   label: 'distance(a,b)',   insert: 'distance(, )',   floatOk: false },
  { group: 'Vector',   label: 'vec2(x,y)',       insert: 'vec2(, )',       floatOk: false },
  { group: 'Vector',   label: 'vec3(x,y,z)',     insert: 'vec3(, , )',     floatOk: false },
  // Noise / Spatial
  { group: 'Noise',    label: 'valueNoise(p)',   insert: 'valueNoise()',   floatOk: false },
  { group: 'Noise',    label: 'noiseHash2(p)',   insert: 'noiseHash2()',   floatOk: false },
  { group: 'Noise',    label: 'noiseHash1(p)',   insert: 'noiseHash1()',   floatOk: false },
  { group: 'Spatial',  label: 'rotate(v,a)',     insert: 'rotate(, )',     floatOk: false },
  { group: 'Spatial',  label: 'rot2D(a)',        insert: 'rot2D()',        floatOk: true  },
  // SDF
  { group: 'SDF',      label: 'smin(a,b,k)',     insert: 'smin(, , )',     floatOk: true  },
  { group: 'SDF',      label: 'sdBox(p,b)',      insert: 'sdBox(, )',      floatOk: false },
  { group: 'SDF',      label: 'sdSegment(p,a,b)',insert: 'sdSegment(, , )',floatOk: false },
  { group: 'SDF',      label: 'opRepeat(p,s)',   insert: 'opRepeat(, )',   floatOk: false },
  { group: 'SDF',      label: 'opRepeatPolar(p,n)',insert:'opRepeatPolar(, )',floatOk:false},
  // Constants
  { group: 'Constants',label: 'PI',             insert: 'PI',             floatOk: true  },
  { group: 'Constants',label: 'TAU',            insert: 'TAU',            floatOk: true  },
  { group: 'Constants',label: 'u_time',         insert: 'u_time',         floatOk: true  },
  { group: 'Constants',label: 'u_resolution',   insert: 'u_resolution',   floatOk: false },
];

const PALETTE_GROUPS = Array.from(new Set(PALETTE.map(e => e.group)));

// ── Helpers panel ─────────────────────────────────────────────────────────────

interface HelpersPanelProps {
  isFloat: boolean;
  autoWrap: boolean;
  onToggleAutoWrap: () => void;
  onInsert: (text: string) => void;
  onInsertLibraryFn: (fn: FnDef) => void;
}

function HelpersPanel({ isFloat, autoWrap, onToggleAutoWrap, onInsert, onInsertLibraryFn }: HelpersPanelProps) {
  const [open, setOpen] = useState(false);
  const { savedFunctionDefs, deleteSavedFunctionDef } = useFunctionBuilder();

  const chipStyle = (active = false): React.CSSProperties => ({
    background: ctp.crust,
    border: `1px solid ${active ? `${ctp.blue}55` : ctp.surface0}`,
    color: active ? ctp.blue : ctp.overlay0,
    borderRadius: '3px',
    padding: '2px 6px',
    fontSize: '10px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  });

  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${ctp.base}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            background: 'none', border: 'none', color: ctp.surface1,
            fontSize: '10px', fontFamily: 'monospace', padding: '5px 4px',
            textAlign: 'left', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px', flex: 1,
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = ctp.overlay0)}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = ctp.surface1)}
        >
          <span style={{ fontSize: '8px' }}>{open ? '▼' : '▶'}</span>
          Helpers
        </button>
        {open && (
          <button
            onClick={onToggleAutoWrap}
            title={autoWrap ? 'Auto-wrap ON — click wraps current expression as first arg' : 'Auto-wrap OFF — click inserts at cursor'}
            style={{
              ...chipStyle(autoWrap),
              fontSize: '9px', padding: '1px 6px',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${ctp.blue}88`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = autoWrap ? `${ctp.blue}55` : ctp.surface0; }}
          >
            ⊂ wrap {autoWrap ? 'ON' : 'OFF'}
          </button>
        )}
      </div>

      {open && (
        <div style={{ padding: '2px 10px 8px', maxHeight: '200px', overflowY: 'auto' }}>
          <p style={{ fontSize: '9px', color: ctp.surface1, margin: '0 0 6px', lineHeight: 1.4 }}>
            Click to insert at cursor · {isFloat ? 'float mode — vec/SDF hidden' : 'vec mode — all shown'}
          </p>

          {savedFunctionDefs.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontSize: '9px', color: ctp.green, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: '3px' }}>
                Custom
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {savedFunctionDefs.map((fn: FnDef) => {
                  const primaryArg = fn.returnType === 'float' ? 'x' : 'uv';
                  const call = `${fn.name}(${primaryArg})`;
                  const sig  = fn.returnType === 'float' ? `(float x)` : fn.returnType === 'vec3' ? `(vec3 uv)` : `(vec2 uv)`;
                  return (
                    <div key={fn.id} style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                      <button
                        onMouseDown={e => { e.preventDefault(); onInsertLibraryFn(fn); }}
                        title={`${fn.returnType} ${fn.name}${sig}\nInserts: ${call}`}
                        style={{
                          background: ctp.crust,
                          border: `1px solid ${ctp.green}44`,
                          color: ctp.green,
                          borderRadius: '3px 0 0 3px',
                          padding: '2px 6px',
                          fontSize: '10px',
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap' as const,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${ctp.green}aa`; (e.currentTarget as HTMLButtonElement).style.color = ctp.text; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${ctp.green}44`; (e.currentTarget as HTMLButtonElement).style.color = ctp.green; }}
                      >
                        {fn.name}
                        <span style={{ color: ctp.surface2, marginLeft: '2px' }}>{fn.returnType}</span>
                      </button>
                      <button
                        onMouseDown={e => { e.preventDefault(); deleteSavedFunctionDef(fn.id); }}
                        title="Remove from library"
                        style={{
                          background: ctp.crust,
                          border: `1px solid ${ctp.green}44`,
                          borderLeft: 'none',
                          color: ctp.surface1,
                          borderRadius: '0 3px 3px 0',
                          padding: '2px 4px',
                          fontSize: '9px',
                          cursor: 'pointer',
                          lineHeight: 1,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = ctp.red; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = ctp.surface1; }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {PALETTE_GROUPS.map(group => {
            const entries = PALETTE.filter(e => e.group === group && (isFloat ? e.floatOk : true));
            if (entries.length === 0) return null;
            return (
              <div key={group} style={{ marginBottom: '6px' }}>
                <div style={{ fontSize: '9px', color: ctp.surface2, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: '3px' }}>
                  {group}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {entries.map(entry => (
                    <button
                      key={entry.label}
                      onMouseDown={e => { e.preventDefault(); onInsert(entry.insert); }}
                      title={`Insert: ${entry.insert}`}
                      style={chipStyle()}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.color = ctp.text;
                        (e.currentTarget as HTMLButtonElement).style.borderColor = ctp.surface1;
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.color = ctp.overlay0;
                        (e.currentTarget as HTMLButtonElement).style.borderColor = ctp.surface0;
                      }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FunctionList({ glslErrors }: Props) {
  const { functions, activeId, addFunction, updateFunction } = useFunctionBuilder();

  // Track the last-focused textarea for click-to-insert
  const lastTA = useRef<HTMLTextAreaElement | null>(null);
  const [autoWrap, setAutoWrap] = useState(false);

  const handleTextareaFocus = (el: HTMLTextAreaElement) => {
    lastTA.current = el;
  };

  const insert = (text: string) => {
    // Fall back to the active function's body end if no textarea was ever focused
    const ta  = lastTA.current;
    const fn  = ta
      ? (functions.find(f => ta.value === f.body) ?? functions.find(f => f.id === activeId))
      : functions.find(f => f.id === activeId);
    if (!fn) return;

    const current = fn.body;
    const start   = ta?.selectionStart ?? current.length;
    const end     = ta?.selectionEnd   ?? current.length;
    const hasParen = text.includes('(');
    let next: string;
    let cursor: number;

    if (autoWrap && hasParen) {
      const idx = text.indexOf('(');
      const wrapped = text.slice(0, idx + 1) + current + text.slice(idx + 1);
      next   = wrapped;
      cursor = wrapped.length;
    } else if (hasParen) {
      const idx      = text.indexOf('(');
      const selected = current.slice(start, end);
      if (selected) {
        const wrapped = text.slice(0, idx + 1) + selected + text.slice(idx + 1);
        next   = current.slice(0, start) + wrapped + current.slice(end);
        cursor = start + wrapped.length;
      } else {
        next         = current.slice(0, start) + text + current.slice(end);
        const empty  = text.indexOf('()');
        cursor       = start + (empty >= 0 ? empty + 1 : text.length);
      }
    } else {
      next   = current.slice(0, start) + text + current.slice(end);
      cursor = start + text.length;
    }

    updateFunction(fn.id, { body: next });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(cursor, cursor);
    });
  };

  const handleLibraryFnInsert = (fn: FnDef) => {
    // Guard: inserting a library function that has the same name as the active
    // session function would make the function call itself — skip to avoid recursion.
    const activeFn = functions.find(f => f.id === activeId);
    if (activeFn?.name === fn.name) return;

    // Load the library function into the session so it compiles (no-op if name already present).
    const { addFunctionFromDef } = useFunctionBuilder.getState();
    addFunctionFromDef(fn);

    const primaryArg = fn.returnType === 'float' ? 'x' : 'uv';
    insert(`${fn.name}(${primaryArg})`);
  };

  const fnErrors = (id: string) => {
    const fn = functions.find(f => f.id === id);
    if (!fn) return [];
    const name = fn.name.toLowerCase();
    return glslErrors.filter(e => {
      const el = e.toLowerCase();
      // Match "fnName(" call sites, "'fnName'" quoted in error messages,
      // or "fnName " at a word boundary (type/var errors)
      return el.includes(`${name}(`) ||
             el.includes(`'${name}'`) ||
             el.includes(`"${name}"`) ||
             new RegExp(`\\b${name}\\b`).test(el);
    });
  };

  const activeFn = functions.find(f => f.id === activeId);
  const isFloat  = activeFn?.returnType === 'float';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TabBar />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {functions.map((fn, i) => (
          <FunctionEditor
            key={fn.id}
            fn={fn}
            index={i}
            isActive={fn.id === activeId}
            errors={fnErrors(fn.id)}
            onTextareaFocus={handleTextareaFocus}
          />
        ))}
      </div>

      <HelpersPanel
        isFloat={isFloat}
        autoWrap={autoWrap}
        onToggleAutoWrap={() => setAutoWrap(v => !v)}
        onInsert={insert}
        onInsertLibraryFn={handleLibraryFnInsert}
      />

      <div style={{ flexShrink: 0, padding: '6px 8px', borderTop: `1px solid ${ctp.surface0}` }}>
        <button
          onClick={addFunction}
          style={{
            width: '100%',
            background: ctp.base,
            border: `1px dashed ${ctp.surface1}`,
            color: ctp.surface2,
            borderRadius: '6px',
            padding: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = ctp.text;
            (e.currentTarget as HTMLButtonElement).style.borderColor = ctp.overlay0;
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = ctp.surface2;
            (e.currentTarget as HTMLButtonElement).style.borderColor = ctp.surface1;
          }}
        >
          + Add Function
        </button>
      </div>
    </div>
  );
}
