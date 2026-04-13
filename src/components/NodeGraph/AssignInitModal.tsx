/**
 * AssignInitModal — expression editor for the assignInit field.
 *
 * Opens when the user clicks the "init" chip on a node with assignOp != '='.
 * Provides a textarea + operator buttons + GLSL helpers + a Variables section
 * showing every GLSL variable computed before this node, grouped by type.
 */
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode, DataType, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

// ─── Palette ──────────────────────────────────────────────────────────────────

interface PaletteEntry { label: string; insert: string; group: string; }

const INIT_PALETTE: PaletteEntry[] = [
  { group: 'Trig',     label: 'sin(f)',       insert: 'sin()'          },
  { group: 'Trig',     label: 'cos(f)',       insert: 'cos()'          },
  { group: 'Trig',     label: 'tan(f)',       insert: 'tan()'          },
  { group: 'Trig',     label: 'atan(f,f)',    insert: 'atan(, )'       },
  { group: 'Exp/Log',  label: 'sqrt(f)',      insert: 'sqrt()'         },
  { group: 'Exp/Log',  label: 'pow(f,f)',     insert: 'pow(, )'        },
  { group: 'Math',     label: 'abs(f)',       insert: 'abs()'          },
  { group: 'Math',     label: 'mod(f,f)',     insert: 'mod(, )'        },
  { group: 'Math',     label: 'min(f,f)',     insert: 'min(, )'        },
  { group: 'Math',     label: 'max(f,f)',     insert: 'max(, )'        },
  { group: 'Math',     label: 'clamp(f,f,f)', insert: 'clamp(, , )'   },
  { group: 'Math',     label: 'mix(f,f,f)',   insert: 'mix(, , )'     },
  { group: 'Rounding', label: 'floor(f)',     insert: 'floor()'       },
  { group: 'Rounding', label: 'ceil(f)',      insert: 'ceil()'        },
  { group: 'Rounding', label: 'fract(f)',     insert: 'fract()'       },
  { group: 'Vector',   label: 'length(v2)',   insert: 'length()'      },
  { group: 'Vector',   label: 'normalize(v2)',insert: 'normalize()'   },
  { group: 'Vector',   label: 'dot(v2,v2)',   insert: 'dot(, )'       },
  { group: 'Vector',   label: 'vec2(f,f)',    insert: 'vec2(, )'      },
  { group: 'Vector',   label: 'vec3(f,f,f)',  insert: 'vec3(, , )'   },
  { group: 'Constants',label: 'PI',           insert: 'PI'            },
  { group: 'Constants',label: 'TAU',          insert: 'TAU'           },
  { group: 'Constants',label: 'u_time',       insert: 'u_time'        },
];

const PALETTE_GROUPS = Array.from(new Set(INIT_PALETTE.map(e => e.group)));

// Type display order + colours (match socket colours)
const TYPE_ORDER: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];
const TYPE_COLOR: Record<DataType, string> = {
  float: '#f0a0c0',
  vec2:  '#00aaff',
  vec3:  '#00ffaa',
  vec4:  '#ffaa00',
};

// ─── Styles ───────────────────────────────────────────────────────────────────

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

const SECTION: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: '#585b70',
  margin: '10px 0 4px',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function AssignInitModal({ node, onClose }: Props) {
  const setNodeAssignInit = useNodeGraphStore(s => s.setNodeAssignInit);
  const nodeOutputVarMap  = useNodeGraphStore(s => s.nodeOutputVarMap);
  const topNodes          = useNodeGraphStore(s => s.nodes);
  const activeGroupId     = useNodeGraphStore(s => s.activeGroupId);

  const [expr, setExpr]   = useState(node.assignInit ?? '');
  const taRef             = useRef<HTMLTextAreaElement | null>(null);

  // ── Build a flat list of all nodes we might need to look up ────────────────
  const allKnownNodes: GraphNode[] = [...topNodes];
  if (activeGroupId) {
    const grp = topNodes.find(n => n.id === activeGroupId);
    const sg = grp?.params.subgraph as SubgraphData | undefined;
    if (sg) allKnownNodes.push(...sg.nodes);
  }

  // ── Collect available variables ─────────────────────────────────────────────
  // Walk the map in execution order, stop when we reach the current node.

  type VarEntry = {
    varName: string;   // actual GLSL identifier to insert
    displayKey: string;// short human name (outputKey)
    nodeLabel: string; // source node label (for disambiguation)
    type: DataType;    // GLSL type (for grouping)
  };
  const availableVars: VarEntry[] = [];

  for (const [mapKey, outVars] of nodeOutputVarMap) {
    // Stop when we reach THIS node's map entry
    if (mapKey === node.id || mapKey.endsWith(`_${node.id}`)) break;

    // Find the source GraphNode for this map key
    let sourceNode: GraphNode | undefined;
    for (const n of allKnownNodes) {
      if (mapKey === n.id || mapKey.endsWith(`_${n.id}`)) {
        sourceNode = n;
        break;
      }
    }

    const def       = sourceNode ? getNodeDefinition(sourceNode.type) : undefined;
    const nodeLabel = sourceNode
      ? (typeof sourceNode.params.label === 'string' ? sourceNode.params.label : (def?.label ?? sourceNode.type))
      : mapKey.split('_').pop() ?? mapKey; // fallback: last segment of prefixed key

    for (const [outputKey, varName] of Object.entries(outVars)) {
      // Resolve GLSL type: check runtime outputs first (group nodes have dynamic sockets)
      const runtimeType = sourceNode?.outputs?.[outputKey]?.type;
      const defType     = def?.outputs?.[outputKey]?.type;
      const type        = (runtimeType ?? defType ?? 'float') as DataType;

      availableVars.push({ varName, displayKey: outputKey, nodeLabel, type });
    }
  }

  // ── Disambiguate display names ──────────────────────────────────────────────
  // If two vars share the same outputKey, prefix with a short node label.
  const keyCount = new Map<string, number>();
  for (const v of availableVars) keyCount.set(v.displayKey, (keyCount.get(v.displayKey) ?? 0) + 1);

  const buttonLabel = (v: VarEntry): string => {
    if ((keyCount.get(v.displayKey) ?? 1) > 1) {
      const short = v.nodeLabel.length > 10 ? v.nodeLabel.slice(0, 10) + '…' : v.nodeLabel;
      return `${short} · ${v.displayKey}`;
    }
    return v.displayKey;
  };

  // ── Group by type ───────────────────────────────────────────────────────────
  const typeGroups = new Map<DataType, VarEntry[]>();
  for (const t of TYPE_ORDER) typeGroups.set(t, []);
  for (const v of availableVars) typeGroups.get(v.type)?.push(v);

  // ── Cursor-aware insert ─────────────────────────────────────────────────────
  const insertAtCursor = (text: string) => {
    const ta = taRef.current;
    if (!ta) { setExpr(prev => prev + text); return; }

    const start    = ta.selectionStart ?? expr.length;
    const end      = ta.selectionEnd   ?? expr.length;
    const selected = expr.slice(start, end);
    const hasParen = text.includes('(');

    let next: string;
    let cursor: number;

    if (selected && hasParen) {
      const parenIdx = text.indexOf('(');
      const wrapped  = text.slice(0, parenIdx + 1) + selected + text.slice(parenIdx + 1);
      next   = expr.slice(0, start) + wrapped + expr.slice(end);
      cursor = start + wrapped.length;
    } else if (!selected && hasParen) {
      const parenIdx = text.indexOf('()');
      next   = expr.slice(0, start) + text + expr.slice(end);
      cursor = start + (parenIdx >= 0 ? parenIdx + 1 : text.length);
    } else {
      next   = expr.slice(0, start) + text + expr.slice(end);
      cursor = start + text.length;
    }

    setExpr(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  };

  const handleApply = () => {
    setNodeAssignInit(node.id, expr.trim());
    onClose();
  };

  const nodeDef   = getNodeDefinition(node.type);
  const nodeLabel = typeof node.params.label === 'string'
    ? node.params.label
    : (nodeDef?.label ?? node.type);

  const hasAnyVars = availableVars.length > 0;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) handleApply(); }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          background: '#1e1e2e',
          border: '1px solid #45475a',
          borderRadius: '10px',
          width: 'min(580px, calc(100vw - 32px))',
          maxHeight: '82vh',
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#cdd6f4',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              init expression
            </span>
            <span style={{ fontSize: '12px', color: '#89b4fa', fontFamily: 'monospace' }}>
              {nodeLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px' }}
          >
            ✕
          </button>
        </div>

        {/* Expression textarea */}
        <textarea
          ref={taRef}
          value={expr}
          onChange={e => setExpr(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleApply(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          placeholder="Leave blank for neutral element (0.0 or 1.0)"
          spellCheck={false}
          autoFocus
          style={{
            background: '#11111b',
            border: '1px solid #45475a',
            borderRadius: '6px',
            color: '#cdd6f4',
            fontFamily: 'monospace',
            fontSize: '13px',
            padding: '10px 12px',
            resize: 'vertical',
            minHeight: '52px',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: '10px', color: '#45475a', marginTop: '4px', marginBottom: '4px' }}>
          ⌘ Enter to apply · Esc to cancel · Click a variable or function to insert
        </div>

        {/* Operators */}
        <div style={SECTION}>Operators</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {['+', '-', '*', '/', '()', '.', ','].map(op => (
            <button key={op} style={BTN} onClick={() => insertAtCursor(op)}>{op}</button>
          ))}
        </div>

        {/* Variables — grouped by GLSL type */}
        {hasAnyVars && (
          <>
            <div style={SECTION}>Variables</div>
            {TYPE_ORDER.map(t => {
              const vars = typeGroups.get(t) ?? [];
              if (vars.length === 0) return null;
              const color = TYPE_COLOR[t];
              return (
                <div key={t} style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color,
                      textTransform: 'uppercase',
                      minWidth: '34px',
                    }}>
                      {t}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: `${color}22` }} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {vars.map(v => (
                      <button
                        key={v.varName}
                        title={v.varName}
                        onClick={() => insertAtCursor(v.varName)}
                        style={{
                          ...BTN,
                          background: '#1e1e2e',
                          border: `1px solid ${color}44`,
                          color,
                        }}
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
              {INIT_PALETTE.filter(e => e.group === group).map(e => (
                <button key={e.label} style={BTN} onClick={() => insertAtCursor(e.insert)}>
                  {e.label}
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}

        {/* Footer */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ ...BTN, color: '#6c7086', background: 'none', border: '1px solid #313244' }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            style={{ ...BTN, background: '#89b4fa22', border: '1px solid #89b4fa88', color: '#89b4fa' }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
