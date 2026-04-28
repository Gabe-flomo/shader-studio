import React, { useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { saveTransformPreset } from '../../store/useNodeGraphStore';
import type { GraphNode, DataType, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';

// ── Styles ────────────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  background: '#11111b',
  border: '1px solid #45475a',
  color: '#a6e3a1',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '12px',
  fontFamily: 'monospace',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const INPUT_FOCUSED_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  border: '1px solid #89b4fa88',
  boxShadow: '0 0 0 1px #89b4fa22',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '9px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#45475a',
  margin: '0 0 6px',
};

const SECTION: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: '#585b70',
  margin: '10px 0 4px',
};

const BTN: React.CSSProperties = {
  background: '#313244',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  borderRadius: '4px',
  padding: '3px 8px',
  fontSize: '11px',
  fontFamily: 'monospace',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// ── GLSL helper palette (same as AssignInitModal) ─────────────────────────────

interface PaletteEntry { label: string; insert: string; group: string; }

const PALETTE: PaletteEntry[] = [
  { group: 'Trig',     label: 'sin(f)',       insert: 'sin()'        },
  { group: 'Trig',     label: 'cos(f)',       insert: 'cos()'        },
  { group: 'Trig',     label: 'tan(f)',       insert: 'tan()'        },
  { group: 'Trig',     label: 'atan(f,f)',    insert: 'atan(, )'     },
  { group: 'Exp/Log',  label: 'sqrt(f)',      insert: 'sqrt()'       },
  { group: 'Exp/Log',  label: 'pow(f,f)',     insert: 'pow(, )'      },
  { group: 'Math',     label: 'abs(f)',       insert: 'abs()'        },
  { group: 'Math',     label: 'mod(f,f)',     insert: 'mod(, )'      },
  { group: 'Math',     label: 'min(f,f)',     insert: 'min(, )'      },
  { group: 'Math',     label: 'max(f,f)',     insert: 'max(, )'      },
  { group: 'Math',     label: 'clamp(f,f,f)', insert: 'clamp(, , )' },
  { group: 'Math',     label: 'mix(f,f,f)',   insert: 'mix(, , )'   },
  { group: 'Rounding', label: 'floor(f)',     insert: 'floor()'      },
  { group: 'Rounding', label: 'ceil(f)',      insert: 'ceil()'       },
  { group: 'Rounding', label: 'fract(f)',     insert: 'fract()'      },
  { group: 'Vector',   label: 'length(v2)',   insert: 'length()'     },
  { group: 'Vector',   label: 'normalize(v2)',insert: 'normalize()'  },
  { group: 'Vector',   label: 'dot(v2,v2)',   insert: 'dot(, )'      },
  { group: 'Vector',   label: 'vec2(f,f)',    insert: 'vec2(, )'     },
  { group: 'Vector',   label: 'vec3(f,f,f)',  insert: 'vec3(, , )'  },
  { group: 'Constants',label: 'PI',           insert: 'PI'           },
  { group: 'Constants',label: 'TAU',          insert: 'TAU'          },
  { group: 'Constants',label: 'u_time',       insert: 'u_time'       },
];

const PALETTE_GROUPS = Array.from(new Set(PALETTE.map(e => e.group)));

// ── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_ORDER: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];
const TYPE_COLOR: Record<string, string> = {
  float: '#f0a0c0', vec2: '#00aaff', vec3: '#00ffaa', vec4: '#ffaa00',
};

const COMPS = ['x', 'y', 'z', 'w'] as const;
const COMP_COLORS: Record<string, string> = { x: '#f38ba8', y: '#a6e3a1', z: '#89b4fa', w: '#fab387' };

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { node: GraphNode; onClose: () => void }

export function TransformVecModal({ node, onClose }: Props) {
  const updateNodeParams     = useNodeGraphStore(s => s.updateNodeParams);
  const changeNodeVectorType = useNodeGraphStore(s => s.changeNodeVectorType);
  const nodeOutputVarMap     = useNodeGraphStore(s => s.nodeOutputVarMap);
  const topNodes             = useNodeGraphStore(s => s.nodes);
  const activeGroupId        = useNodeGraphStore(s => s.activeGroupId);

  const type = (node.params.outputType as string) || 'vec2';
  const dims = type === 'vec4' ? 4 : type === 'vec3' ? 3 : 2;
  const activeComps = COMPS.slice(0, dims);

  // Track which input ref is currently focused for cursor-aware insert
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusedComp = useRef<string | null>(null);

  // Save-preset UI state
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetLabel, setPresetLabel]   = useState('');
  const [savedFlash, setSavedFlash]     = useState(false);

  const handleSavePreset = () => {
    const label = presetLabel.trim() || 'Transform Vec';
    saveTransformPreset({
      label,
      outputType: type as 'vec2' | 'vec3' | 'vec4',
      exprX: (node.params.exprX as string) ?? 'x',
      exprY: (node.params.exprY as string) ?? 'y',
      exprZ: (node.params.exprZ as string) ?? 'z',
      exprW: (node.params.exprW as string) ?? 'w',
    });
    setSavingPreset(false);
    setPresetLabel('');
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  // ── Collect upstream GLSL variables (same logic as AssignInitModal) ──────────
  const allKnownNodes: GraphNode[] = [...topNodes];
  if (activeGroupId) {
    const grp = topNodes.find(n => n.id === activeGroupId);
    const sg = grp?.params.subgraph as SubgraphData | undefined;
    if (sg) allKnownNodes.push(...sg.nodes);
  }

  type VarEntry = { varName: string; displayKey: string; nodeLabel: string; type: DataType };
  const availableVars: VarEntry[] = [];

  for (const [mapKey, outVars] of nodeOutputVarMap) {
    if (mapKey === node.id || mapKey.endsWith(`_${node.id}`)) break;

    let sourceNode: GraphNode | undefined;
    for (const n of allKnownNodes) {
      if (mapKey === n.id || mapKey.endsWith(`_${n.id}`)) { sourceNode = n; break; }
    }

    const def       = sourceNode ? getNodeDefinition(sourceNode.type) : undefined;
    const nodeLabel = sourceNode
      ? (typeof sourceNode.params.label === 'string' ? sourceNode.params.label : (def?.label ?? sourceNode.type))
      : mapKey.split('_').pop() ?? mapKey;

    for (const [outputKey, varName] of Object.entries(outVars)) {
      const runtimeType = sourceNode?.outputs?.[outputKey]?.type;
      const defType     = def?.outputs?.[outputKey]?.type;
      const t           = (runtimeType ?? defType ?? 'float') as DataType;
      availableVars.push({ varName, displayKey: outputKey, nodeLabel, type: t });
    }
  }

  // Disambiguate button labels
  const keyCount = new Map<string, number>();
  for (const v of availableVars) keyCount.set(v.displayKey, (keyCount.get(v.displayKey) ?? 0) + 1);
  const buttonLabel = (v: VarEntry) => {
    if ((keyCount.get(v.displayKey) ?? 1) > 1) {
      const short = v.nodeLabel.length > 10 ? v.nodeLabel.slice(0, 10) + '…' : v.nodeLabel;
      return `${short} · ${v.displayKey}`;
    }
    return v.displayKey;
  };

  // Group by type
  const typeGroups = new Map<DataType, VarEntry[]>();
  for (const t of TYPE_ORDER) typeGroups.set(t, []);
  for (const v of availableVars) typeGroups.get(v.type)?.push(v);

  // ── Cursor-aware insert into the focused input ────────────────────────────────
  const insertAtCursor = useCallback((text: string) => {
    const comp = focusedComp.current;
    if (!comp) return;
    const el = inputRefs.current[comp];
    if (!el) return;

    const pk    = `expr${comp.toUpperCase()}`;
    const cur   = typeof node.params[pk] === 'string' ? (node.params[pk] as string) : comp;
    const start = el.selectionStart ?? cur.length;
    const end   = el.selectionEnd   ?? cur.length;

    const hasParen = text.includes('(');
    const selected = cur.slice(start, end);
    let next: string;
    let cursor: number;

    if (selected && hasParen) {
      const pi   = text.indexOf('(');
      const wrapped = text.slice(0, pi + 1) + selected + text.slice(pi + 1);
      next   = cur.slice(0, start) + wrapped + cur.slice(end);
      cursor = start + wrapped.length;
    } else if (!selected && hasParen) {
      const pi = text.indexOf('()');
      next   = cur.slice(0, start) + text + cur.slice(end);
      cursor = start + (pi >= 0 ? pi + 1 : text.length);
    } else {
      next   = cur.slice(0, start) + text + cur.slice(end);
      cursor = start + text.length;
    }

    updateNodeParams(node.id, { [pk]: next }, true);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }, [node, updateNodeParams]);

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '10px',
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: '82vh', overflowY: 'auto',
          padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)', color: '#cdd6f4', fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#89b4fa' }}>⊞ Transform Vec</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {savedFlash && <span style={{ fontSize: '10px', color: '#a6e3a1' }}>✓ Saved</span>}
            <button
              onClick={() => { setSavingPreset(v => !v); setPresetLabel(''); }}
              style={{ background: savingPreset ? '#a6e3a122' : 'none', border: `1px solid ${savingPreset ? '#a6e3a155' : '#45475a55'}`, color: savingPreset ? '#a6e3a1' : '#6c7086', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}
            >↑ Save Preset</button>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #f38ba855', color: '#f38ba8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>✕ Close</button>
          </div>
        </div>

        {/* Inline save preset input */}
        {savingPreset && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              autoFocus
              value={presetLabel}
              onChange={e => setPresetLabel(e.target.value)}
              placeholder="Preset name…"
              onKeyDown={e => {
                if (e.key === 'Enter') handleSavePreset();
                if (e.key === 'Escape') { setSavingPreset(false); setPresetLabel(''); }
                e.stopPropagation();
              }}
              style={{ flex: 1, background: '#11111b', border: '1px solid #a6e3a155', color: '#a6e3a1', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', outline: 'none', fontFamily: 'monospace' }}
            />
            <button
              onClick={handleSavePreset}
              style={{ background: '#a6e3a122', border: '1px solid #a6e3a155', color: '#a6e3a1', cursor: 'pointer', fontSize: '11px', padding: '3px 10px', borderRadius: '4px' }}
            >Save</button>
          </div>
        )}

        {/* Type selector */}
        <div>
          <p style={SECTION_LABEL}>Input / Output Type</p>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['vec2', 'vec3', 'vec4'] as DataType[]).map(t => {
              const active = type === t;
              return (
                <button key={t}
                  onClick={() => changeNodeVectorType(node.id, 'v', 'result', t)}
                  style={{ fontSize: '11px', padding: '3px 12px', borderRadius: '4px', cursor: 'pointer',
                    background: active ? '#89b4fa22' : 'none',
                    border: `1px solid ${active ? '#89b4fa' : '#45475a55'}`,
                    color: active ? '#89b4fa' : '#6c7086',
                  }}
                >{t}</button>
              );
            })}
          </div>
        </div>

        {/* Per-component expression editors */}
        <div>
          <p style={SECTION_LABEL}>Component Expressions</p>
          <p style={{ fontSize: '10px', color: '#45475a', marginBottom: '10px', lineHeight: 1.5 }}>
            Built-in components: {activeComps.map(c => (
              <code key={c} style={{ color: COMP_COLORS[c], marginRight: '6px' }}>{c}</code>
            ))}
            — any GLSL built-in or upstream variable is valid
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activeComps.map(c => {
              const pk  = `expr${c.toUpperCase()}`;
              const val = typeof node.params[pk] === 'string' ? (node.params[pk] as string) : c;
              const isFocused = focusedComp.current === c;
              return (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: COMP_COLORS[c], width: '12px', flexShrink: 0 }}>{c}</span>
                  <span style={{ fontSize: '11px', color: '#45475a', fontFamily: 'monospace', flexShrink: 0 }}>=</span>
                  <input
                    ref={el => { inputRefs.current[c] = el; }}
                    type="text"
                    value={val}
                    spellCheck={false}
                    placeholder={c}
                    onFocus={() => { focusedComp.current = c; }}
                    onChange={e => updateNodeParams(node.id, { [pk]: e.target.value })}
                    style={isFocused ? INPUT_FOCUSED_STYLE : INPUT_STYLE}
                  />
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: '9px', color: '#45475a', marginTop: '6px' }}>
            Click a variable or function below to insert at cursor
          </p>
        </div>

        {/* Outputs hint */}
        <div style={{ background: '#181825', borderRadius: '6px', padding: '10px 12px', border: '1px solid #313244' }}>
          <p style={{ ...SECTION_LABEL, marginBottom: '4px' }}>Outputs</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '10px', fontFamily: 'monospace' }}>
            {activeComps.map(c => (
              <span key={c} style={{ color: COMP_COLORS[c] }}>{c} <span style={{ color: '#45475a' }}>(float)</span></span>
            ))}
            <span style={{ color: '#89b4fa' }}>result <span style={{ color: '#45475a' }}>({type})</span></span>
          </div>
        </div>

        {/* ── Insert panel ── */}
        <div style={{ borderTop: '1px solid #31324466', paddingTop: '12px' }}>
          {/* Operators */}
          <div style={SECTION}>Operators</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {['+', '-', '*', '/', '()', '.', ','].map(op => (
              <button key={op} style={BTN} onMouseDown={e => { e.preventDefault(); insertAtCursor(op === '()' ? '()' : ` ${op} `); }}>{op}</button>
            ))}
          </div>

          {/* Upstream variables grouped by type */}
          {availableVars.length > 0 && (
            <>
              <div style={SECTION}>Variables</div>
              {TYPE_ORDER.map(t => {
                const vars = typeGroups.get(t) ?? [];
                if (vars.length === 0) return null;
                const color = TYPE_COLOR[t] ?? '#cdd6f4';
                return (
                  <div key={t} style={{ marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                      <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color, textTransform: 'uppercase', minWidth: '34px' }}>{t}</span>
                      <div style={{ flex: 1, height: '1px', background: `${color}22` }} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {vars.map(v => (
                        <button
                          key={v.varName}
                          title={v.varName}
                          onMouseDown={e => { e.preventDefault(); insertAtCursor(v.varName); }}
                          style={{ ...BTN, background: '#1e1e2e', border: `1px solid ${color}44`, color }}
                        >
                          {buttonLabel(v)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* GLSL helpers */}
          {PALETTE_GROUPS.map(group => (
            <React.Fragment key={group}>
              <div style={SECTION}>{group}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {PALETTE.filter(e => e.group === group).map(e => (
                  <button key={e.label} style={BTN} onMouseDown={e2 => { e2.preventDefault(); insertAtCursor(e.insert); }}>{e.label}</button>
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
