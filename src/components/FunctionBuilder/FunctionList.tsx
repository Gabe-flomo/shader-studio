import { useState, useRef } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import type { FnDef } from './useFunctionBuilder';
import { FunctionEditor } from './FunctionEditor';
import { errorOwner } from './glslCompiler';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar() {
  const { tabs, activeTabId, addTab, closeTab, switchTab, renameTab } = useFunctionBuilder();
  const tk = useTokens();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [hoverId, setHoverId] = useState<string | null>(null);

  const commit = (id: string, fallback: string) => { renameTab(id, editVal.trim() || fallback); setEditingId(null); };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2, padding: '0 12px 0 10px', flexShrink: 0,
      borderBottom: `1px solid ${tk.border.subtle}`, overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      {tabs.map(tab => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            onMouseEnter={() => setHoverId(tab.id)}
            onMouseLeave={() => setHoverId(h => (h === tab.id ? null : h))}
            title="Double-click to rename"
            style={{
              height: 38, display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', flexShrink: 0, cursor: 'pointer',
              boxShadow: active ? `inset 0 -2px 0 ${tk.accent.base}` : 'none',
            }}
          >
            {editingId === tab.id ? (
              <input
                autoFocus
                value={editVal}
                aria-label="Tab name"
                onChange={e => setEditVal(e.target.value)}
                onBlur={() => commit(tab.id, tab.label)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commit(tab.id, tab.label);
                  if (e.key === 'Escape') setEditingId(null);
                  e.stopPropagation();
                }}
                onClick={e => e.stopPropagation()}
                style={{
                  width: 80, height: 24, padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.xs,
                  background: tk.bg.panel, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`,
                  color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`,
                }}
              />
            ) : (
              <span
                onDoubleClick={e => { e.stopPropagation(); setEditingId(tab.id); setEditVal(tab.label); }}
                style={{
                  padding: '0 4px', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  font: `${active ? 600 : 500} 12.5px ${fontFamily.ui}`, color: active ? tk.text.primary : tk.text.muted,
                }}
              >
                {tab.label}
              </span>
            )}
            {tabs.length > 1 && (
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                style={{
                  width: 18, height: 18, padding: 0, border: 0, borderRadius: radius.xs, background: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint,
                  visibility: active || hoverId === tab.id ? 'visible' : 'hidden',
                }}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        );
      })}
      <IconButton icon="plus" label="New tab" size="sm" onClick={addTab} />
    </div>
  );
}

interface Props {
  glslErrors: string[];
  fnLines: Record<string, [number, number]>;
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
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const { savedFunctionDefs, deleteSavedFunctionDef } = useFunctionBuilder();

  const groupLabel = (text: string, color: string = tk.text.faint) => (
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color, marginBottom: 6 }}>{text}</div>
  );

  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px 0 10px', height: 44 }}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          style={{
            flex: 1, height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', border: 0, background: 'none',
            cursor: 'pointer', color: tk.text.muted, font: `600 12.5px ${fontFamily.ui}`, textAlign: 'left',
          }}
        >
          <Icon name={open ? 'chevD' : 'chevR'} size={14} />
          Helpers
        </button>
        {open && <Toggle checked={autoWrap} onChange={onToggleAutoWrap} label="Wrap expression" />}
      </div>

      {open && (
        // preventDefault keeps focus (and the selection to wrap) in the function body
        <div onMouseDown={e => e.preventDefault()} style={{ padding: '0 16px 12px', maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: tk.text.muted }}>
            {autoWrap ? 'Click wraps the whole body as the first argument.' : 'Click inserts at the cursor, wrapping any selection.'}
            {isFloat && ' Vector and SDF helpers are hidden for float functions.'}
          </p>

          {savedFunctionDefs.length > 0 && (
            <div>
              {groupLabel('Library', tk.kind.fn)}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {savedFunctionDefs.map((fn: FnDef) => {
                  const primaryArg = fn.returnType === 'float' ? 'x' : 'uv';
                  return (
                    <span key={fn.id} style={{
                      height: 26, display: 'inline-flex', alignItems: 'center', borderRadius: radius.md - 1,
                      boxShadow: `inset 0 0 0 1px ${alpha(tk.kind.fn, 0.35)}`, background: tk.bg.panel,
                    }}>
                      <button
                        type="button"
                        onClick={() => onInsertLibraryFn(fn)}
                        title={`${fn.returnType} ${fn.name}(${fn.returnType === 'float' ? 'float x' : 'vec2 uv'}) · inserts ${fn.name}(${primaryArg})`}
                        style={{
                          height: '100%', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 4px 0 8px', border: 0,
                          background: 'none', cursor: 'pointer', color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`,
                        }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tk.kind.fn }} />
                        {fn.name}
                        <span style={{ color: tk.text.faint }}>{fn.returnType}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${fn.name} from the library`}
                        title="Remove from library"
                        onClick={() => deleteSavedFunctionDef(fn.id)}
                        style={{
                          width: 22, height: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.faint,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {PALETTE_GROUPS.map(group => {
            const entries = PALETTE.filter(e => e.group === group && (isFloat ? e.floatOk : true));
            if (entries.length === 0) return null;
            return (
              <div key={group}>
                {groupLabel(group)}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {entries.map(entry => (
                    <Chip key={entry.label} title={`Insert ${entry.insert}`} onClick={() => onInsert(entry.insert)}>{entry.label}</Chip>
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

export function FunctionList({ glslErrors, fnLines }: Props) {
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

  // An error belongs to the function whose lines it points into; errors outside every function
  // (e.g. in main, where the curves are called) fall back to matching the function's name.
  const fnErrors = (id: string) => {
    const fn = functions.find(f => f.id === id);
    if (!fn) return [];
    const name = fn.name.toLowerCase();
    return glslErrors.filter(e => {
      const owner = errorOwner(e, fnLines);
      if (owner) return owner === id;
      const el = e.toLowerCase();
      return el.includes(`${name}(`) ||
             el.includes(`'${name}'`) ||
             el.includes(`"${name}"`) ||
             new RegExp(`\\b${name}\\b`).test(el);
    });
  };

  const activeFn = functions.find(f => f.id === activeId);
  const isFloat  = activeFn?.returnType === 'float';

  const tk = useTokens();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 16px 10px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        <span style={{ fontWeight: 650, fontSize: 14, color: tk.text.primary }}>Functions</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['float', 'x, t'], ['vec3', 'uv, t']].map(([type, vars]) => (
            <span key={type} title={`Variables available in a ${type} function`} style={{
              padding: '3px 8px', borderRadius: 7, background: tk.bg.field, color: tk.text.muted, font: `500 11.5px ${fontFamily.mono}`,
            }}>
              <b style={{ color: tk.text.primary, fontWeight: 600 }}>{type}</b> {vars}
            </span>
          ))}
        </div>
      </div>
      <TabBar />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
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

      <div style={{ flexShrink: 0, padding: '4px 16px 16px' }}>
        <AddFunctionButton onClick={addFunction} />
      </div>
    </div>
  );
}

function AddFunctionButton({ onClick }: { onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
        borderRadius: 10, border: `1.5px dashed ${hover ? tk.text.faint : tk.border.strong}`,
        background: hover ? tk.bg.hover : 'none', color: hover ? tk.text.secondary : tk.text.muted, font: `500 13px ${fontFamily.ui}`,
      }}
    >
      <Icon name="plus" size={15} />
      Add function
    </button>
  );
}
