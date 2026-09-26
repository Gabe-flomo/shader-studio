/**
 * DiscoverFunctionsModal — find reusable functions in the saved shaders and
 * keep the good ones in the Functions library.
 *
 * Left: the scope (every saved shader, some folders, or shaders matching
 * search terms) and the filters (dependency level, return type, parameter
 * count and types, whether a function may read its shader's globals).
 * Right: the matches, one line each (signature, return type, level, where
 * it came from), a preview of the chosen one with everything it needs, a
 * name and comment for saving, and Show in file. Tick the ones to keep and
 * Save writes them as Custom Function presets, dependencies included as
 * helpers, so each appears in the palette's Functions section.
 */
import { useMemo, useState } from 'react';
import { discoverFunctions, toCustomFnPreset, bundleText, type DiscoveredFn, type DiscoverFilter } from '../../glsl/discover';
import { saveCustomFnPreset } from '../../store/useNodeGraphStore';
import { tokenizeLine, C, C_LIGHT } from '../glslSyntax';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toastStore';

export interface DiscoverSourceShader { id: string; name: string; code: string; group?: string; note?: string }

type ScopeMode = 'all' | 'folders' | 'search';
type LevelMode = 'self' | 'one' | 'any';
const RETURN_TYPES = ['float', 'vec2', 'vec3', 'vec4'] as const;
const PARAM_TYPES = ['float', 'vec2', 'vec3', 'vec4', 'int', 'bool', 'mat2', 'mat3'] as const;

const toggleIn = <T,>(set: Set<T>, v: T): Set<T> => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

export function DiscoverFunctionsModal({ sources, onClose, onShowInFile }: {
  sources: DiscoverSourceShader[];
  onClose: () => void;
  /** Open the shader in the editor with the function selected. */
  onShowInFile?: (sourceId: string, fn: DiscoveredFn) => void;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const pal = mode === 'light' ? C_LIGHT : C;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 760;

  // ── Scope ──
  const folders = useMemo(() => [...new Set(sources.map(s => s.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)), [sources]);
  const [scope, setScope] = useState<ScopeMode>('all');
  const [pickedFolders, setPickedFolders] = useState<Set<string>>(new Set());
  const [terms, setTerms] = useState('');
  const scoped = useMemo(() => {
    if (scope === 'folders') return sources.filter(s => s.group && pickedFolders.has(s.group));
    if (scope === 'search') {
      const words = terms.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
      if (!words.length) return sources;
      return sources.filter(s => words.some(w => s.name.toLowerCase().includes(w) || (s.note ?? '').toLowerCase().includes(w) || (s.group ?? '').toLowerCase().includes(w) || s.code.toLowerCase().includes(w)));
    }
    return sources;
  }, [sources, scope, pickedFolders, terms]);

  // ── Filters ──
  const [level, setLevel] = useState<LevelMode>('one');
  const [returns, setReturns] = useState<Set<string>>(new Set());
  const [paramTypes, setParamTypes] = useState<Set<string>>(new Set());
  const [minParams, setMinParams] = useState('');
  const [maxParams, setMaxParams] = useState('');
  const [allowGlobals, setAllowGlobals] = useState(false);
  const [nameContains, setNameContains] = useState('');
  const filter = useMemo<DiscoverFilter>(() => ({
    maxLevel: level === 'self' ? 0 : level === 'one' ? 1 : undefined,
    returnTypes: [...returns], paramTypes: [...paramTypes],
    minParams: minParams.trim() ? Number(minParams) : undefined,
    maxParams: maxParams.trim() ? Number(maxParams) : undefined,
    allowGlobals, nameContains: nameContains.trim() || undefined,
  }), [level, returns, paramTypes, minParams, maxParams, allowGlobals, nameContains]);
  const result = useMemo(() => discoverFunctions(scoped, filter), [scoped, filter]);
  const repeats = useMemo(() => [...result.duplicates.values()].reduce((a, b) => a + b, 0), [result]);

  // ── Selection and preview ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const active = result.matches.find(f => f.id === activeId) ?? result.matches[0] ?? null;
  const shownSelected = result.matches.filter(f => selected.has(f.id));
  const defaultComment = (f: DiscoveredFn) => `Found in “${f.sourceName}”, lines ${f.startLine}–${f.endLine}${f.dependencies.length ? ` · with ${f.dependencies.map(d => d.name).join(', ')}` : ''}`;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!shownSelected.length || saving) return;
    setSaving(true);
    const failed: string[] = []; let saved = 0;
    for (const f of shownSelected) {
      const prep = toCustomFnPreset(f, (names[f.id] ?? f.name).trim() || f.name, (comments[f.id] ?? defaultComment(f)).trim() || undefined);
      if (!prep.ok) { failed.push(`${f.name}: ${prep.error}`); continue; }
      const r = await saveCustomFnPreset(prep.data);
      if (r.ok) saved++; else failed.push(`${f.name}: ${('message' in r && typeof r.message === 'string') ? r.message : 'could not save'}`);
    }
    setSaving(false);
    if (saved) toast.success(saved === 1 ? 'Saved 1 function to Functions' : `Saved ${saved} functions to Functions`, { message: failed.length ? `${failed.length} skipped: ${failed.join(' · ')}` : 'Find them in the palette under Functions, or in a Custom Function node’s presets.' });
    else if (failed.length) toast.error('Nothing saved', { message: failed.join(' · ') });
    if (saved) onClose();
  };

  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, margin: '12px 0 6px' };
  const badge = (text: string, color = tk.text.muted, bg = tk.bg.field): React.ReactNode => (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 5px', borderRadius: radius.sm, font: `700 10px ${fontFamily.mono}`, color, background: bg, flexShrink: 0 }}>{text}</span>
  );
  const levelLabel = (f: DiscoveredFn) => f.level < 0 ? 'recursive' : f.level === 0 ? 'self-contained' : f.level === 1 ? 'calls 1 level' : `calls ${f.level} levels`;

  const previewCode = active ? bundleText(active) : '';

  return (
    <Modal
      title="Discover functions"
      subtitle={`${result.matches.length} ${result.matches.length === 1 ? 'function' : 'functions'} in ${scoped.length} ${scoped.length === 1 ? 'shader' : 'shaders'}${repeats ? ` · ${repeats} identical ${repeats === 1 ? 'repeat' : 'repeats'} hidden` : ''}`}
      icon="fn" iconColor={tk.kind.expr}
      width={Math.min(1000, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 24)}
      height={Math.min(760, (typeof window !== 'undefined' ? window.innerHeight : 760) - 32)}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span style={{ flex: 1, color: tk.text.muted, fontSize: 12 }}>{shownSelected.length ? `${shownSelected.length} selected` : 'Tick the functions to keep'}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" icon="save" disabled={!shownSelected.length || saving} onClick={save}>{`Save ${shownSelected.length || ''} to Functions`.replace('  ', ' ')}</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 0, height: '100%', minHeight: 0 }}>
        {/* ── Scope and filters ── */}
        <div style={{ width: narrow ? 'auto' : 236, flexShrink: 0, overflowY: 'auto', padding: '4px 14px 14px', borderRight: narrow ? 'none' : `1px solid ${tk.border.subtle}`, borderBottom: narrow ? `1px solid ${tk.border.subtle}` : 'none', maxHeight: narrow ? '45%' : 'none' }}>
          <div style={caps}>Scope</div>
          <Segmented fill size="sm" ariaLabel="Scope" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All' }, { value: 'folders', label: 'Folders' }, { value: 'search', label: 'Search' }]} />
          {scope === 'folders' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {folders.length === 0 && <span style={{ fontSize: 11.5, color: tk.text.faint }}>No folders yet: group shaders in the list to make some.</span>}
              {folders.map(g => <Chip key={g} mono={false} active={pickedFolders.has(g)} onClick={() => setPickedFolders(s => toggleIn(s, g))}>{g}</Chip>)}
            </div>
          )}
          {scope === 'search' && (
            <Field aria-label="Search terms" placeholder="noise, palette, sdf…" height={28} value={terms} onChange={e => setTerms(e.target.value)} style={{ marginTop: 8 }} leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />} />
          )}
          {scope === 'search' && <div style={{ fontSize: 10.5, color: tk.text.faint, marginTop: 4, lineHeight: 1.4 }}>Comma-separated. Matches a shader’s name, note, folder or code.</div>}

          <div style={caps}>Depends on</div>
          <Segmented fill size="sm" ariaLabel="Dependency level" value={level} onChange={setLevel} options={[{ value: 'self', label: 'Nothing' }, { value: 'one', label: '1 level' }, { value: 'any', label: 'Any' }]} />
          <div style={{ fontSize: 10.5, color: tk.text.faint, marginTop: 4, lineHeight: 1.4 }}>Nothing: the function calls no other. 1 level: it may call self-contained helpers, which come along.</div>

          <div style={caps}>Returns</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {RETURN_TYPES.map(t => <Chip key={t} active={returns.has(t)} onClick={() => setReturns(s => toggleIn(s, t))}>{t}</Chip>)}
          </div>

          <div style={caps}>Parameters</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Field aria-label="Minimum parameters" placeholder="min" height={26} mono value={minParams} onChange={e => setMinParams(e.target.value.replace(/[^\d]/g, ''))} style={{ width: 62 }} />
            <span style={{ color: tk.text.faint, fontSize: 11 }}>to</span>
            <Field aria-label="Maximum parameters" placeholder="max" height={26} mono value={maxParams} onChange={e => setMaxParams(e.target.value.replace(/[^\d]/g, ''))} style={{ width: 62 }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {PARAM_TYPES.map(t => <Chip key={t} active={paramTypes.has(t)} onClick={() => setParamTypes(s => toggleIn(s, t))}>{t}</Chip>)}
          </div>
          <div style={{ fontSize: 10.5, color: tk.text.faint, marginTop: 4, lineHeight: 1.4 }}>{paramTypes.size ? 'Only functions whose parameters are all of these types.' : 'Pick types to allow; none picked means any.'}</div>

          <div style={caps}>Name</div>
          <Field aria-label="Name contains" placeholder="contains…" height={26} mono value={nameContains} onChange={e => setNameContains(e.target.value)} />

          <div style={{ marginTop: 12 }}>
            <Toggle checked={allowGlobals} onChange={setAllowGlobals} label="Allow shader globals" />
            <div style={{ fontSize: 10.5, color: tk.text.faint, marginTop: 4, lineHeight: 1.4 }}>Functions that read a uniform or variable their shader declares can’t be saved on their own; show them anyway.</div>
          </div>
        </div>

        {/* ── Matches and preview ── */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 6px', borderBottom: `1px solid ${tk.border.subtle}` }}>
            <span style={{ ...caps, margin: 0, flex: 1 }}>Matches</span>
            <Button size="sm" variant="ghost" disabled={!result.matches.length} onClick={() => setSelected(new Set(result.matches.map(f => f.id)))}>Select all</Button>
            <Button size="sm" variant="ghost" disabled={!shownSelected.length} onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px' }} role="listbox" aria-label="Discovered functions">
            {scoped.length === 0 && <div style={{ padding: 12, fontSize: 12, color: tk.text.faint }}>Nothing in scope. {scope === 'folders' ? 'Pick a folder.' : 'Save a shader first, or widen the search.'}</div>}
            {scoped.length > 0 && result.matches.length === 0 && <div style={{ padding: 12, fontSize: 12, color: tk.text.faint }}>{result.total ? `${result.total} functions found, none pass the filters.` : 'No functions in these shaders besides main.'}</div>}
            {result.matches.map(f => {
              const isActive = active?.id === f.id;
              return (
                <div
                  key={f.id} role="option" aria-selected={isActive}
                  onClick={() => setActiveId(f.id)}
                  onDoubleClick={() => setSelected(s => toggleIn(s, f.id))}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: radius.md, cursor: 'pointer', background: isActive ? alpha(tk.accent.base, 0.1) : 'transparent', boxShadow: isActive ? `inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}` : 'none' }}
                >
                  <input type="checkbox" aria-label={`Keep ${f.name}`} checked={selected.has(f.id)} onChange={() => setSelected(s => toggleIn(s, f.id))} onClick={e => e.stopPropagation()} style={{ margin: 0, accentColor: tk.accent.base }} />
                  <span style={{ flex: 1, minWidth: 0, font: `500 12px ${fontFamily.mono}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.signature}>
                    <span style={{ color: tk.text.muted }}>{f.returnType} </span><span style={{ fontWeight: 700 }}>{f.name}</span><span style={{ color: tk.text.secondary }}>({f.params.map(p => `${p.type} ${p.name}`).join(', ')})</span>
                  </span>
                  {badge(f.level < 0 ? 'rec' : `L${f.level}`, f.level === 0 ? tk.status.success : f.level < 0 ? tk.status.danger : tk.text.muted, f.level === 0 ? alpha(tk.status.success, 0.14) : tk.bg.field)}
                  {!f.selfContained && badge('globals', tk.status.warning, alpha(tk.status.warning, 0.14))}
                  {!narrow && <span style={{ color: tk.text.faint, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.sourceName}>{f.sourceName}</span>}
                </div>
              );
            })}
          </div>

          {active && (
            <div style={{ flexShrink: 0, height: narrow ? '45%' : '44%', minHeight: 160, borderTop: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 4px', flexWrap: 'wrap' }}>
                <Field aria-label="Name in the library" value={names[active.id] ?? active.name} height={26} mono onChange={e => setNames(m => ({ ...m, [active.id]: e.target.value }))} style={{ width: 180 }} />
                {badge(active.returnType, tk.text.muted)}
                <span style={{ fontSize: 11, color: tk.text.faint, flex: 1, minWidth: 120 }}>{levelLabel(active)}{active.dependencies.length ? ` · brings ${active.dependencies.map(d => d.name).join(', ')}` : ''}{active.defines.length ? ` · ${active.defines.length} #define${active.defines.length > 1 ? 's' : ''}` : ''} · {active.sourceName}, lines {active.startLine}–{active.endLine}</span>
                {onShowInFile && <Button size="sm" variant="ghost" icon="code" onClick={() => onShowInFile(active.sourceId, active)}>Show in file</Button>}
                <Button size="sm" variant={selected.has(active.id) ? 'ghost' : undefined} icon={selected.has(active.id) ? 'check' : 'plus'} onClick={() => setSelected(s => toggleIn(s, active.id))}>{selected.has(active.id) ? 'Kept' : 'Keep'}</Button>
              </div>
              <div style={{ padding: '0 12px 6px' }}>
                <Field aria-label="Comment" placeholder={defaultComment(active)} value={comments[active.id] ?? ''} height={26} onChange={e => setComments(m => ({ ...m, [active.id]: e.target.value }))} />
              </div>
              {!active.selfContained && <div style={{ margin: '0 12px 6px', fontSize: 11, color: tk.status.warning }}>Reads {active.globals.join(', ')} from its shader, so it can’t be saved as a library function as it is.</div>}
              <pre style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: '8px 12px', background: tk.bg.field, font: `12px/1.55 ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'pre', tabSize: 4 }}>
                {previewCode.split('\n').map((line, i) => (
                  <div key={i} style={{ minHeight: '1.55em' }}>{tokenizeLine(line, pal).map((t, j) => <span key={j} style={{ color: t.color }}>{t.text}</span>)}</div>
                ))}
              </pre>
            </div>
          )}
          {!active && result.matches.length === 0 && <div style={{ flexShrink: 0, padding: 12, fontSize: 11.5, color: tk.text.faint, borderTop: `1px solid ${tk.border.subtle}`, lineHeight: 1.5 }}>Self-contained functions (level 0) are the safest to keep: a hash, a rotation, a palette. A level-1 function brings its helpers with it, so noise() arrives together with the hash() it calls.</div>}
        </div>
      </div>
    </Modal>
  );
}
