/**
 * AssignInitModal — expression editor for the assignInit field.
 *
 * Opens when the user clicks the "init" chip on a node with assignOp != '='.
 * Provides a textarea + operator buttons + GLSL helpers + a Variables section
 * showing every GLSL variable computed before this node in the current shader.
 */
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
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

const VAR_BTN: React.CSSProperties = {
  ...BTN,
  background: '#1e1e2e',
  border: '1px solid #89b4fa55',
  color: '#89b4fa',
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

  // ── Collect available variables ─────────────────────────────────────────────
  // Walk the map (insertion = execution order) until we hit the current node,
  // collecting every output variable from nodes we pass.
  // The map keys for subgraph nodes are prefixed; we find the current node
  // by checking whether the key ends with the node id (covers both cases).

  type VarEntry = { varName: string; nodeLabel: string; outputKey: string };
  const availableVars: VarEntry[] = [];

  // Build a lookup: nodeId → node label (check top-level + active group's subgraph)
  const nodeLabelMap = new Map<string, string>();
  for (const n of topNodes) {
    const def = getNodeDefinition(n.type);
    const lbl = typeof n.params.label === 'string' ? n.params.label : (def?.label ?? n.type);
    nodeLabelMap.set(n.id, lbl);
  }
  if (activeGroupId) {
    const grp = topNodes.find(n => n.id === activeGroupId);
    const sg = grp?.params.subgraph as SubgraphData | undefined;
    if (sg) {
      for (const n of sg.nodes) {
        const def = getNodeDefinition(n.type);
        const lbl = typeof n.params.label === 'string' ? n.params.label : (def?.label ?? n.type);
        nodeLabelMap.set(n.id, lbl);
      }
    }
  }

  // Derive the map key prefix that corresponds to the current node
  // (top-level: node.id; inside group: ${groupId}_g_${node.id})
  const currentNodeKeySuffix = node.id;

  for (const [mapKey, outVars] of nodeOutputVarMap) {
    // Stop when we reach this node (key equals or ends with the node id)
    if (mapKey === currentNodeKeySuffix || mapKey.endsWith(`_${currentNodeKeySuffix}`)) break;

    // Resolve a human label for this map entry
    // The raw node id may be at the end of a prefixed key like `group_g_nodeId`
    let nodeLabel = mapKey;
    for (const [nId, lbl] of nodeLabelMap) {
      if (mapKey === nId || mapKey.endsWith(`_${nId}`)) {
        nodeLabel = lbl;
        break;
      }
    }

    for (const [outputKey, varName] of Object.entries(outVars)) {
      availableVars.push({ varName, nodeLabel, outputKey });
    }
  }

  // Group available vars by node label for display
  const varGroups = new Map<string, VarEntry[]>();
  for (const v of availableVars) {
    if (!varGroups.has(v.nodeLabel)) varGroups.set(v.nodeLabel, []);
    varGroups.get(v.nodeLabel)!.push(v);
  }

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

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) { handleApply(); } }}
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

        {/* Variables section — only shown when there are prior vars */}
        {varGroups.size > 0 && (
          <>
            <div style={SECTION}>Variables</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {Array.from(varGroups.entries()).map(([label, vars]) => (
                <div key={label} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', color: '#45475a', minWidth: '60px', textAlign: 'right', letterSpacing: '0.04em', flexShrink: 0 }}>
                    {label}
                  </span>
                  {vars.map(v => (
                    <button
                      key={v.varName}
                      style={VAR_BTN}
                      title={`${label} → ${v.outputKey}`}
                      onClick={() => insertAtCursor(v.varName)}
                    >
                      {v.varName}
                    </button>
                  ))}
                </div>
              ))}
            </div>
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
