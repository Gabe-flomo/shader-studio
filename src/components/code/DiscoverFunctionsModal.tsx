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
import { discoverFunctions, savedLookup, type DiscoverFilter } from '../../glsl/discover';
import { loadCustomFns } from '../../store/useNodeGraphStore';
import { DiscoverResults } from './DiscoverResults';
import { saveLabel, useDiscoverPicks } from './useDiscoverPicks';
import { useTokens } from '../../theme/themeStore';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

export interface DiscoverSourceShader { id: string; name: string; code: string; group?: string; note?: string }

type ScopeMode = 'file' | 'all' | 'folders' | 'search';
type LevelMode = 'self' | 'one' | 'any';
const RETURN_TYPES = ['float', 'vec2', 'vec3', 'vec4'] as const;
const PARAM_TYPES = ['float', 'vec2', 'vec3', 'vec4', 'int', 'bool', 'mat2', 'mat3'] as const;

const toggleIn = <T,>(set: Set<T>, v: T): Set<T> => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

export function DiscoverFunctionsModal({ sources, onClose, onShowInFile, currentId }: {
  sources: DiscoverSourceShader[];
  onClose: () => void;
  /** Open the shader in the editor with a span selected (a function, or one of its call sites). */
  onShowInFile?: (sourceId: string, range: { start: number; end: number }) => void;
  /** The file open in the editor, when there is one: the “This file” scope. */
  currentId?: string;
}) {
  const tk = useTokens();
  const narrow = typeof window !== 'undefined' && window.innerWidth < 760;

  // ── Scope ──
  const folders = useMemo(() => [...new Set(sources.map(s => s.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)), [sources]);
  const [scope, setScope] = useState<ScopeMode>(currentId && sources.some(s => s.id === currentId) ? 'file' : 'all');
  const [pickedFolders, setPickedFolders] = useState<Set<string>>(new Set());
  const [terms, setTerms] = useState('');
  const scoped = useMemo(() => {
    if (scope === 'file') return sources.filter(s => s.id === currentId);
    if (scope === 'folders') return sources.filter(s => s.group && pickedFolders.has(s.group));
    if (scope === 'search') {
      const words = terms.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
      if (!words.length) return sources;
      return sources.filter(s => words.some(w => s.name.toLowerCase().includes(w) || (s.note ?? '').toLowerCase().includes(w) || (s.group ?? '').toLowerCase().includes(w) || s.code.toLowerCase().includes(w)));
    }
    return sources;
  }, [sources, scope, pickedFolders, terms, currentId]);

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

  // ── Selection, preview and saving ──
  const picks = useDiscoverPicks(result.matches);
  const savedAs = useMemo(() => savedLookup(loadCustomFns()), []);
  const save = async () => { if (await picks.save()) onClose(); };

  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, margin: '12px 0 6px' };

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
          <span style={{ flex: 1, color: tk.text.muted, fontSize: 12 }}>{picks.shownSelected.length ? `${picks.shownSelected.length} selected` : 'Tick the functions to keep'}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" icon="save" disabled={!picks.shownSelected.length || picks.saving} onClick={save}>{saveLabel(picks.shownSelected.length)}</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 0, height: '100%', minHeight: 0 }}>
        {/* ── Scope and filters ── */}
        <div style={{ width: narrow ? 'auto' : 236, flexShrink: 0, overflowY: 'auto', padding: '4px 14px 14px', borderRight: narrow ? 'none' : `1px solid ${tk.border.subtle}`, borderBottom: narrow ? `1px solid ${tk.border.subtle}` : 'none', maxHeight: narrow ? '45%' : 'none' }}>
          <div style={caps}>Scope</div>
          <Segmented fill size="sm" ariaLabel="Scope" value={scope} onChange={setScope} options={[...(currentId ? [{ value: 'file' as const, label: 'This file' }] : []), { value: 'all' as const, label: 'All' }, { value: 'folders' as const, label: 'Folders' }, { value: 'search' as const, label: 'Search' }]} />
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
        <DiscoverResults
          picks={picks} narrow={narrow} onShowInFile={onShowInFile} savedAs={savedAs}
          empty={scoped.length === 0
            ? <>Nothing in scope. {scope === 'folders' ? 'Pick a folder.' : 'Save a shader first, or widen the search.'}</>
            : <>{result.total ? `${result.total} functions found, none pass the filters.` : 'No functions in these shaders besides main.'}<div style={{ marginTop: 10, lineHeight: 1.5 }}>Self-contained functions (level 0) are the safest to keep: a hash, a rotation, a palette. A level-1 function brings its helpers with it, so noise() arrives together with the hash() it calls.</div></>}
        />
      </div>
    </Modal>
  );
}
