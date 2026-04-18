import React, { useState, useRef, useEffect } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import { normalizeBodyExpr, emitFunction } from './glslCompiler';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

interface Props {
  hasErrors: boolean;
  onNavigateToStudio?: () => void;
}

const inputStyle: React.CSSProperties = {
  background: '#181825',
  border: '1px solid #45475a',
  borderRadius: '4px',
  color: '#cdd6f4',
  fontFamily: 'monospace',
  fontSize: '11px',
  padding: '3px 6px',
  width: '52px',
  outline: 'none',
};

function RangeInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>{label}</span>
      <input
        style={inputStyle}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local);
          if (!isNaN(n)) { onChange(n); } else { setLocal(String(value)); }
        }}
        onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

const GLSL_BUILTINS = new Set([
  'sin','cos','tan','asin','acos','atan','sinh','cosh','tanh',
  'sqrt','pow','exp','exp2','log','log2','abs','sign','floor',
  'ceil','fract','mod','min','max','clamp','mix','smoothstep','step',
  'length','dot','cross','normalize','reflect','refract','round','trunc',
  'radians','degrees','inversesqrt','distance','faceforward',
  'vec2','vec3','vec4','float','int','bool','uint',
  'mat2','mat3','mat4','ivec2','ivec3','ivec4','bvec2','bvec3','bvec4',
  'PI','TAU','u_time','u_resolution','u_xMin','u_xMax','u_yMin','u_yMax',
  'vUv','smin','sdBox','sdSegment','opRepeat','opRepeatPolar',
  // common GLSL identifiers that aren't user vars
  'true','false','void','return','if','else','for','while','break','continue',
]);

function detectFreeVars(expr: string, implicit: Set<string>): string[] {
  const seen = new Set<string>();
  const free: string[] = [];
  const matches = expr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? [];
  for (const id of matches) {
    if (seen.has(id) || GLSL_BUILTINS.has(id) || implicit.has(id)) continue;
    seen.add(id);
    free.push(id);
  }
  return free;
}

export function Toolbar({ hasErrors, onNavigateToStudio }: Props) {
  const { functions, activeId, xRange, yRange, setActiveId, setXRange, setYRange, linkedBlockId, savedGroups, saveGroup, loadGroup, deleteGroup } = useFunctionBuilder();
  const addNode = useNodeGraphStore(s => s.addNode);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const nodes = useNodeGraphStore(s => s.nodes);

  const activeFn = functions.find(f => f.id === activeId) ?? functions[0];

  // ── Session save / load state ───────────────────────────────────────────────
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const sessionsRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSaveInput) saveInputRef.current?.focus();
  }, [showSaveInput]);

  // Close sessions panel on outside click
  useEffect(() => {
    if (!showSessions) return;
    const handler = (e: MouseEvent) => {
      if (!sessionsRef.current?.contains(e.target as Node)) setShowSessions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSessions]);

  const handleSaveGroup = () => {
    if (!saveName.trim()) return;
    saveGroup(saveName.trim());
    setSaveName('');
    setShowSaveInput(false);
  };

  const handleSave = () => {
    if (!activeFn) return;

    const expr = normalizeBodyExpr(activeFn.body);
    // Only t is auto-injected in ExprBlock scope; x, uv, etc. become sockets
    const implicit = new Set(['t']);
    const freeVars = detectFreeVars(expr, implicit);
    const inputs = freeVars.map(name => ({ name, type: 'float', slider: null }));

    // Emit all user function definitions so they're available as GLSL helpers
    // in the main shader (assembler collects `glslFunctions` from exprNode params)
    const glslFunctions = functions.map(emitFunction).join('\n\n');

    const params = {
      outputType: activeFn.returnType,
      inputs,
      lines: [] as Array<{ lhs: string; op: string; rhs: string }>,
      result: expr,
      expr,
      glslFunctions,
      // Raw fn defs — used to re-open this ExprBlock in the Function Builder
      fnBuilderFns: functions.map(({ name, returnType, body }) => ({ name, returnType, body })),
      fnBuilderActiveId: activeFn.id,
    };

    if (linkedBlockId) {
      const node = nodes.find(n => n.id === linkedBlockId);
      if (node) {
        updateNodeParams(linkedBlockId, params);
        onNavigateToStudio?.();
        return;
      }
    }

    // Create a new ExprBlock with pre-filled params
    addNode('exprNode', { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 }, params);
    onNavigateToStudio?.();
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 10px',
      borderTop: '1px solid #313244',
      background: '#1e1e2e',
      flexShrink: 0,
      flexWrap: 'wrap',
    }}>
      {/* Active function selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>Visualize</span>
        <select
          value={activeId}
          onChange={e => setActiveId(e.target.value)}
          style={{
            background: '#313244', border: '1px solid #45475a', color: '#cdd6f4',
            borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
            padding: '3px 6px', cursor: 'pointer', outline: 'none',
          }}
        >
          {functions.map(f => (
            <option key={f.id} value={f.id}>{f.name} ({f.returnType})</option>
          ))}
        </select>
      </div>

      <div style={{ width: '1px', height: '16px', background: '#313244', flexShrink: 0 }} />

      {/* X / Y range inputs — float mode only */}
      {activeFn?.returnType === 'float' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>x</span>
            <RangeInput label="[" value={xRange[0]} onChange={v => setXRange([v, xRange[1]])} />
            <RangeInput label="," value={xRange[1]} onChange={v => setXRange([xRange[0], v])} />
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>]</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>y</span>
            <RangeInput label="[" value={yRange[0]} onChange={v => setYRange([v, yRange[1]])} />
            <RangeInput label="," value={yRange[1]} onChange={v => setYRange([yRange[0], v])} />
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>]</span>
          </div>
          <div style={{ width: '1px', height: '16px', background: '#313244', flexShrink: 0 }} />
        </>
      )}

      {/* ── Session controls ─────────────────────────────────── */}
      <div style={{ position: 'relative' }} ref={sessionsRef}>
        {/* Save input */}
        {showSaveInput ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              ref={saveInputRef}
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveGroup(); if (e.key === 'Escape') { setShowSaveInput(false); setSaveName(''); } }}
              placeholder="Group name…"
              style={{
                background: '#181825', border: '1px solid #45475a', borderRadius: '4px',
                color: '#cdd6f4', fontSize: '11px', fontFamily: 'monospace',
                padding: '3px 7px', outline: 'none', width: '110px',
              }}
            />
            <button onClick={handleSaveGroup} style={smallBtn('#a6e3a1')}>Save</button>
            <button onClick={() => { setShowSaveInput(false); setSaveName(''); }} style={smallBtn('#585b70')}>✕</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={() => { setShowSaveInput(true); setShowSessions(false); }}
              title="Save current tabs as a named group"
              style={smallBtn('#a6e3a1')}
            >
              ↑ Save Group
            </button>
            <button
              onClick={() => setShowSessions(v => !v)}
              title="Open a saved group"
              style={smallBtn(showSessions ? '#cba6f7' : '#585b70')}
            >
              Sessions {savedGroups.length > 0 ? `(${savedGroups.length})` : ''}
            </button>
          </div>
        )}

        {/* Sessions dropdown */}
        {showSessions && (
          <div style={{
            position: 'absolute', bottom: '100%', right: 0, marginBottom: '4px',
            background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '6px',
            minWidth: '200px', maxHeight: '220px', overflowY: 'auto',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 100,
          }}>
            {savedGroups.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: '11px', color: '#45475a', fontFamily: 'monospace' }}>
                No saved groups yet
              </div>
            ) : savedGroups.map(g => (
              <div
                key={g.id}
                style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #313244', gap: '6px' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', color: '#cdd6f4', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.name}
                  </div>
                  <div style={{ fontSize: '9px', color: '#45475a' }}>
                    {g.tabs.length} tab{g.tabs.length !== 1 ? 's' : ''} · {new Date(g.savedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => { loadGroup(g); setShowSessions(false); }}
                  style={smallBtn('#89b4fa')}
                >Load</button>
                <button
                  onClick={() => deleteGroup(g.id)}
                  style={{ background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#45475a')}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ width: '1px', height: '16px', background: '#313244', flexShrink: 0 }} />
      <div style={{ flex: 1 }} />

      {hasErrors && (
        <span style={{ fontSize: '10px', color: '#f38ba8', fontFamily: 'monospace' }}>⚠ GLSL error</span>
      )}

      <button
        onClick={handleSave}
        style={{
          background: '#89b4fa',
          border: 'none',
          color: '#1e1e2e',
          borderRadius: '5px',
          padding: '4px 12px',
          fontSize: '11px',
          fontWeight: 700,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {linkedBlockId ? 'Update ExprBlock' : 'Save to ExprBlock'}
      </button>
    </div>
  );
}

function smallBtn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${color}44`,
    color,
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '10px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  };
}
