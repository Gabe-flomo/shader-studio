/**
 * The state behind DiscoverResults: what is ticked, the names, comments and
 * preview bindings, and saving the ticked functions to the Functions library
 * (each with the bindings its preview used, for the library's thumbnail).
 */
import { useState } from 'react';
import { toCustomFnPreset, type DiscoveredFn } from '../../glsl/discover';
import { inferParamRoles, inferReturnRole, type ParamRole } from '../../glsl/roles';
import { defaultBinding, type Binding } from '../../glsl/previewShader';
import { useRoleMemory } from '../../glsl/roleMemory';
import { saveCustomFnPreset } from '../../store/useNodeGraphStore';
import { toast } from '../ui/toastStore';

const toggleIn = <T,>(set: Set<T>, v: T): Set<T> => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
export const defaultComment = (f: DiscoveredFn) => `Found in “${f.sourceName}”, lines ${f.startLine}–${f.endLine}${f.dependencies.length ? ` · with ${f.dependencies.map(d => d.name).join(', ')}` : ''}`;

/** The bindings a function's preview uses: the person's, or each role's default. */
export const bindingsOf = (f: DiscoveredFn, roles: ParamRole[], overrides: Record<string, Binding[]>) => overrides[f.id] ?? roles.map(defaultBinding);

export function useDiscoverPicks(matches: DiscoveredFn[]) {
  const memory = useRoleMemory();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [bindingOverrides, setBindingOverrides] = useState<Record<string, Binding[]>>({});
  const [saving, setSaving] = useState(false);
  const active = matches.find(f => f.id === activeId) ?? matches[0] ?? null;
  const shownSelected = matches.filter(f => selected.has(f.id));

  /** Save the ticked functions as Custom Function presets; true when at least one was saved. */
  const save = async (): Promise<boolean> => {
    if (!shownSelected.length || saving) return false;
    setSaving(true);
    const failed: string[] = []; let saved = 0;
    for (const f of shownSelected) {
      const prep = toCustomFnPreset(f, (names[f.id] ?? f.name).trim() || f.name, (comments[f.id] ?? defaultComment(f)).trim() || undefined);
      if (!prep.ok) { failed.push(`${f.name}: ${prep.error}`); continue; }
      // The thumbnail in the library draws it the way this preview did.
      const roles = inferParamRoles(f, memory);
      const preview = { bindings: bindingsOf(f, roles, bindingOverrides), roles: roles.map(r => r.role), returnRole: inferReturnRole(f).role };
      const r = await saveCustomFnPreset({ ...prep.data, preview });
      if (r.ok) saved++; else failed.push(`${f.name}: ${('message' in r && typeof r.message === 'string') ? r.message : 'could not save'}`);
    }
    setSaving(false);
    if (saved) toast.success(saved === 1 ? 'Saved 1 function to Functions' : `Saved ${saved} functions to Functions`, { message: failed.length ? `${failed.length} skipped: ${failed.join(' · ')}` : 'Find them in the palette under Functions, or in a Custom Function node’s presets.' });
    else if (failed.length) toast.error('Nothing saved', { message: failed.join(' · ') });
    if (saved) setSelected(new Set());
    return saved > 0;
  };

  return {
    memory, matches, selected, setSelected, toggle: (id: string) => setSelected(s => toggleIn(s, id)),
    active, setActiveId, names, setNames, comments, setComments, bindingOverrides, setBindingOverrides,
    shownSelected, saving, save,
  };
}
export type DiscoverPicks = ReturnType<typeof useDiscoverPicks>;

/** The Save button's words: "Save 3 to Functions". */
export const saveLabel = (n: number) => (n ? `Save ${n} to Functions` : 'Save to Functions');

