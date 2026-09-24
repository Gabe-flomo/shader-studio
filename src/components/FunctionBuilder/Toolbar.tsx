import { useRef, useState } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import { normalizeBodyExpr, emitFunction, curveColor } from './glslCompiler';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toastStore';

interface Props {
  onNavigateToStudio?: () => void;
}

const fmt = (v: number) => String(parseFloat(v.toPrecision(3)));

/** Range bound. Shows the live value (it follows pan and zoom) until focused; commits on blur or Enter. */
function RangeInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const n = parseFloat(draft ?? '');
    if (!isNaN(n)) onChange(n);
    setDraft(null);
  };
  return (
    <Field
      mono
      height={32}
      aria-label={label}
      value={draft ?? fmt(value)}
      onFocus={e => { setDraft(fmt(value)); e.currentTarget.select(); }}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
      }}
      style={{ width: 58, padding: '0 8px' }}
    />
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

export function Toolbar({ onNavigateToStudio }: Props) {
  const { functions, activeId, xRange, yRange, setActiveId, setXRange, setYRange, linkedBlockId, savedGroups, saveGroup, loadGroup, deleteGroup, savedFunctionDefs } = useFunctionBuilder();
  const addNode = useNodeGraphStore(s => s.addNode);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeSockets = useNodeGraphStore(s => s.updateNodeSockets);
  const nodes = useNodeGraphStore(s => s.nodes);
  const tk = useTokens();
  const mode = useThemeMode();

  const activeFn = functions.find(f => f.id === activeId) ?? functions[0];
  const activeIndex = Math.max(0, functions.findIndex(f => f.id === activeFn?.id));

  // ── Group save / sessions ───────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const sessionsRef = useRef<HTMLSpanElement>(null);

  const handleSaveGroup = () => {
    const name = saveName.trim();
    if (!name) return;
    saveGroup(name);
    toast.success(`Saved group “${name}”`);
    setSaveName('');
    setSaving(false);
  };

  const handleSave = () => {
    if (!activeFn) return;

    const bodyExpr = normalizeBodyExpr(activeFn.body);
    // Only function names are implicit — t is a real free variable the user can wire
    const allFnNames = [
      ...functions.map(f => f.name),
      ...savedFunctionDefs.map(f => f.name),
    ];
    const implicit = new Set([...allFnNames]);
    const freeVars = detectFreeVars(bodyExpr, implicit);

    // Infer GLSL type for well-known variable names; default to float
    const VEC2_NAMES = new Set(['uv', 'st', 'pos', 'coord', 'p2']);
    const VEC3_NAMES = new Set(['col', 'color', 'p3', 'rgb', 'normal']);
    const inferType = (name: string): 'float' | 'vec2' | 'vec3' => {
      if (VEC2_NAMES.has(name)) return 'vec2';
      if (VEC3_NAMES.has(name)) return 'vec3';
      return 'float';
    };
    const inputs = freeVars.map(name => ({ name, type: inferType(name), slider: null }));

    // ── Inline the body directly — no wrapping function call ─────────────────
    // The ExprBlock declares each input as a local variable, so `sin(x + t)` just works.
    // Helper functions used by the body (other session fns, lib fns) go in glslFunctions.
    // The active function itself is NOT emitted — its body IS the expression.
    const sessionNames = new Set(functions.map(f => f.name));
    const libFns = savedFunctionDefs.filter(f => !sessionNames.has(f.name));
    const otherSessionFns = functions.filter(f => f.id !== activeFn.id);
    const glslFunctions = [...libFns.map(emitFunction), ...otherSessionFns.map(emitFunction)].join('\n\n');

    const params = {
      outputType: activeFn.returnType,
      inputs,
      lines: [],
      result: bodyExpr,
      expr: bodyExpr,
      glslFunctions,
      // Raw fn defs — used to re-open this ExprBlock in the Function Builder
      fnBuilderFns: functions.map(({ name, returnType, body }) => ({ name, returnType, body })),
      fnBuilderActiveId: activeFn.id,
    };

    if (linkedBlockId) {
      const node = nodes.find(n => n.id === linkedBlockId);
      if (node) {
        updateNodeParams(linkedBlockId, params);
        updateNodeSockets(linkedBlockId, inputs, activeFn.returnType);
        onNavigateToStudio?.();
        return;
      }
    }

    // Create a new ExprBlock with pre-filled params, then pin linkedBlockId so
    // subsequent saves update this node instead of spawning duplicates.
    const newNodeId = addNode('exprNode', { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 }, params);
    if (newNodeId) useFunctionBuilder.getState().setLinkedBlockId(newNodeId);
    onNavigateToStudio?.();
  };

  const sep = <span style={{ width: 1, height: 20, background: tk.border.default, flexShrink: 0, margin: '0 2px' }} />;
  const axisLabel = (a: string) => <span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.muted, marginRight: 2 }}>{a}</span>;

  return (
    <div style={{
      height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px',
      borderTop: `1px solid ${tk.border.default}`, background: tk.bg.panel, overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: tk.text.muted }}>Visualize</span>
      {/* Native select under a styled face, as in TypeSelect */}
      <span style={{
        position: 'relative', height: 32, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 8px 0 10px', flexShrink: 0,
        borderRadius: radius.control, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, background: tk.bg.panel,
        font: `500 12.5px ${fontFamily.mono}`, color: tk.text.primary,
      }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: curveColor(activeIndex, mode) }} />
        {activeFn ? `${activeFn.name} (${activeFn.returnType})` : '—'}
        <Icon name="chevD" size={14} style={{ color: tk.text.faint }} />
        <select
          aria-label="Function to visualize"
          value={activeId}
          onChange={e => setActiveId(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', font: 'inherit' }}
        >
          {functions.map(f => <option key={f.id} value={f.id}>{f.name} ({f.returnType})</option>)}
        </select>
      </span>

      {activeFn?.returnType === 'float' && (
        <>
          {sep}
          {axisLabel('x')}
          <RangeInput label="x minimum" value={xRange[0]} onChange={v => setXRange([v, xRange[1]])} />
          <RangeInput label="x maximum" value={xRange[1]} onChange={v => setXRange([xRange[0], v])} />
          <span style={{ width: 6 }} />
          {axisLabel('y')}
          <RangeInput label="y minimum" value={yRange[0]} onChange={v => setYRange([v, yRange[1]])} />
          <RangeInput label="y maximum" value={yRange[1]} onChange={v => setYRange([yRange[0], v])} />
          <IconButton icon="fit" label="Reset view" size="sm" onClick={() => { setXRange([-2, 2]); setYRange([-2, 2]); }} />
        </>
      )}

      <span style={{ flex: 1, minWidth: 8 }} />

      {saving ? (
        <>
          <Field
            autoFocus
            height={30}
            placeholder="Group name"
            aria-label="Group name"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveGroup();
              if (e.key === 'Escape') { setSaving(false); setSaveName(''); }
            }}
            style={{ width: 150 }}
          />
          <Button size="sm" disabled={!saveName.trim()} onClick={handleSaveGroup}>Save</Button>
          <IconButton icon="close" label="Cancel" size="sm" tooltip={false} onClick={() => { setSaving(false); setSaveName(''); }} />
        </>
      ) : (
        <Button size="sm" icon="export" title="Save every tab as a named group" onClick={() => { setSaving(true); setShowSessions(false); }}>
          Save group
        </Button>
      )}

      <span ref={sessionsRef} style={{ display: 'inline-flex' }}>
        <Button size="sm" icon="folder" onClick={() => setShowSessions(v => !v)} style={showSessions ? { background: tk.bg.hover } : undefined}>
          Sessions{savedGroups.length > 0 && <span style={{ color: tk.text.faint, fontWeight: 500 }}>{savedGroups.length}</span>}
        </Button>
      </span>
      {showSessions && (
        <Popover anchorRef={sessionsRef} onClose={() => setShowSessions(false)} align="end" width={280} padding={4}>
          {savedGroups.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 12.5, lineHeight: 1.45, color: tk.text.muted }}>
              No saved groups yet. <b style={{ color: tk.text.secondary, fontWeight: 600 }}>Save group</b> keeps every tab together.
            </div>
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {savedGroups.map(g => (
                <SessionRow
                  key={g.id}
                  name={g.name}
                  meta={`${g.tabs.length} tab${g.tabs.length !== 1 ? 's' : ''} · ${new Date(g.savedAt).toLocaleDateString()}`}
                  onLoad={() => { loadGroup(g); setShowSessions(false); }}
                  onDelete={() => deleteGroup(g.id)}
                />
              ))}
            </div>
          )}
        </Popover>
      )}

      <Button size="sm" variant="primary" onClick={handleSave} title={linkedBlockId ? 'Write these functions back to the Expr Block they came from' : 'Add an Expr Block with this function to the graph'}>
        {linkedBlockId ? 'Update Expr Block' : 'Save to Expr Block'}
      </Button>
    </div>
  );
}

function SessionRow({ name, meta, onLoad, onDelete }: { name: string; meta: string; onLoad: () => void; onDelete: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: radius.md, background: hover ? tk.bg.hover : 'transparent' }}
    >
      <button
        type="button"
        onClick={onLoad}
        title="Open this group"
        style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div style={{ font: `500 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 11.5, color: tk.text.faint, marginTop: 1 }}>{meta}</div>
      </button>
      <IconButton icon="trash" label={`Delete ${name}`} size="sm" tone="danger" tooltip={false} onClick={onDelete} style={{ marginRight: 4, visibility: hover ? 'visible' : 'hidden' }} />
    </div>
  );
}
