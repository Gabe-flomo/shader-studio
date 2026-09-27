/**
 * DiscoverResults — the matches of a function discovery, the chosen one's
 * preview, and saving the ticked ones to the Functions library. Shared by
 * the GLSL page's Discover functions modal (with its scope and filters
 * beside it) and the Convert page's Functions pane (one pasted shader).
 *
 * Each parameter shows the role the app guessed for it. Changing a role
 * re-feeds the preview and is remembered (glsl/roleMemory.ts): the next
 * function with a parameter of that name used that way starts from the
 * choice, marked "learned from your choice", and can be forgotten.
 *
 * `useDiscoverPicks` (useDiscoverPicks.ts) holds the state (what is ticked, names, comments,
 * bindings) so the owner can put the Save button in its own footer.
 */
import { useMemo, useState } from 'react';
import { bundleText, type DiscoveredFn } from '../../glsl/discover';
import { inferParamRoles, inferReturnRole, rolesFor, ROLE_INFO, type ParamRole, type ValueRole } from '../../glsl/roles';
import { previewShaderFor, defaultBinding, bindingsFor, BINDING_LABEL, type Binding, type BindingKind } from '../../glsl/previewShader';
import { forgetLearnedRole, rememberRole } from '../../glsl/roleMemory';
import { bindingsOf, defaultComment, type DiscoverPicks } from './useDiscoverPicks';
import { MiniShader } from './MiniShader';
import { tokenizeLine, C, C_LIGHT } from '../glslSyntax';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';

export function DiscoverResults({ picks, narrow, onShowInFile, empty, listTitle = 'Matches', savedAs }: {
  picks: DiscoverPicks;
  /** One column: the list over the preview, which scrolls as one. */
  narrow: boolean;
  onShowInFile?: (sourceId: string, range: { start: number; end: number }) => void;
  /** Shown instead of the list when there are no matches. */
  empty: React.ReactNode;
  listTitle?: string;
  /** The name a function is already saved under in the Functions library, if it is. */
  savedAs?: (f: DiscoveredFn) => string | undefined;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const pal = mode === 'light' ? C_LIGHT : C;
  const { matches, active, selected, toggle, setSelected, setActiveId, names, setNames, comments, setComments, memory, bindingOverrides, setBindingOverrides } = picks;

  // ── Roles, bindings and the live preview of the chosen function ──
  const roles = useMemo<ParamRole[]>(() => (active ? inferParamRoles(active, memory) : []), [active, memory]);
  const ret = useMemo(() => (active ? inferReturnRole(active) : null), [active]);
  const bindings = useMemo<Binding[]>(() => (active ? bindingsOf(active, roles, bindingOverrides) : []), [active, roles, bindingOverrides]);
  const setBinding = (i: number, b: Binding) => { if (!active) return; const next = [...bindings]; next[i] = b; setBindingOverrides(m => ({ ...m, [active.id]: next })); };
  const setRole = (i: number, role: ValueRole) => {
    if (!active || !roles[i] || roles[i].role === role) return;
    rememberRole(active, i, roles[i].role, role);
    // Feed the parameter the way its new role suggests (a binding the person picked for another parameter stays).
    const over = bindingOverrides[active.id];
    if (over) { const next = [...over]; next[i] = defaultBinding({ ...roles[i], role }); setBindingOverrides(m => ({ ...m, [active.id]: next })); }
  };
  const preview = useMemo(() => (active && ret ? previewShaderFor(active, roles, ret, bindings) : null), [active, roles, ret, bindings]);
  const [showUses, setShowUses] = useState(false);
  const learnedCount = Object.keys(memory).length;

  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, margin: '12px 0 6px' };
  const badge = (text: string, color = tk.text.muted, bg = tk.bg.field): React.ReactNode => (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 5px', borderRadius: radius.sm, font: `700 10px ${fontFamily.mono}`, color, background: bg, flexShrink: 0 }}>{text}</span>
  );
  const levelLabel = (f: DiscoveredFn) => f.level < 0 ? 'recursive' : f.level === 0 ? 'self-contained' : f.level === 1 ? 'calls 1 level' : `calls ${f.level} levels`;
  const previewCode = active ? bundleText(active) : '';
  const linkBtn: React.CSSProperties = { border: 0, padding: 0, background: 'none', color: tk.accent.text, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' };

  const list = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 6px', borderBottom: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
        <span style={{ ...caps, margin: 0, flex: 1 }}>{listTitle}</span>
        <Button size="sm" variant="ghost" disabled={!matches.length} onClick={() => setSelected(new Set(matches.map(f => f.id)))}>Select all</Button>
        <Button size="sm" variant="ghost" disabled={!picks.shownSelected.length} onClick={() => setSelected(new Set())}>Clear</Button>
      </div>
      <div style={{ flex: narrow ? '0 1 auto' : 1, minHeight: narrow ? 64 : 0, maxHeight: narrow ? 188 : undefined, overflowY: 'auto', padding: '4px 8px' }} role="listbox" aria-label="Discovered functions">
        {matches.length === 0 && <div style={{ padding: 12, fontSize: 12, color: tk.text.faint, lineHeight: 1.5 }}>{empty}</div>}
        {matches.map(f => {
          const isActive = active?.id === f.id;
          return (
            <div
              key={f.id} role="option" aria-selected={isActive}
              onClick={() => setActiveId(f.id)}
              onDoubleClick={() => toggle(f.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '7px 6px' : '5px 6px', borderRadius: radius.md, cursor: 'pointer', background: isActive ? alpha(tk.accent.base, 0.1) : 'transparent', boxShadow: isActive ? `inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}` : 'none' }}
            >
              <input type="checkbox" aria-label={`Keep ${f.name}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} onClick={e => e.stopPropagation()} style={{ margin: 0, accentColor: tk.accent.base }} />
              <span style={{ flex: 1, minWidth: 0, font: `500 12px ${fontFamily.mono}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.signature}>
                <span style={{ color: tk.text.muted }}>{f.returnType} </span><span style={{ fontWeight: 700 }}>{f.name}</span><span style={{ color: tk.text.secondary }}>({f.params.map(p => `${p.type} ${p.name}`).join(', ')})</span>
              </span>
              {badge(f.level < 0 ? 'rec' : `L${f.level}`, f.level === 0 ? tk.status.success : f.level < 0 ? tk.status.danger : tk.text.muted, f.level === 0 ? alpha(tk.status.success, 0.14) : tk.bg.field)}
              {!f.selfContained && badge('globals', tk.status.warning, alpha(tk.status.warning, 0.14))}
              {savedAs?.(f) !== undefined && <span title={`Already in your Functions as “${savedAs(f)}”`}>{badge('saved', tk.kind.fn, alpha(tk.kind.fn, 0.14))}</span>}
              {!narrow && <span style={{ color: tk.text.faint, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.sourceName}>{f.sourceName}</span>}
            </div>
          );
        })}
      </div>
    </>
  );

  if (!active) return <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{list}</div>;

  const roleControls = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
      {preview && !preview.ok && <div style={{ fontSize: 10.5, lineHeight: 1.4, color: tk.text.faint }}>{preview.error}</div>}
      {roles.map((r, i) => {
        const unsure = !r.learned && r.confidence <= 0.4;
        return (
          <div key={`${r.name}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, minWidth: 0 }} title={r.because.length ? `${ROLE_INFO[r.role].hint}\n${r.because.join(' · ')}` : ROLE_INFO[r.role].hint}>
              <span style={{ font: `600 11px ${fontFamily.mono}`, color: tk.text.primary, flexShrink: 0 }}>{r.type} {r.name}</span>
              <span style={{ color: tk.text.faint, flexShrink: 0 }}>is</span>
              <Select
                ariaLabel={`Role of ${r.name}`} value={r.role} height={22}
                onChange={v => setRole(i, v as ValueRole)}
                options={rolesFor(r.type).map(k => ({ value: k, label: ROLE_INFO[k].label }))}
                style={{ font: `600 11px ${fontFamily.ui}`, padding: '0 3px 0 7px', color: unsure ? tk.text.muted : tk.kind.expr, background: r.learned ? alpha(tk.kind.expr, 0.12) : tk.bg.field, minWidth: 0, flex: '0 1 auto' }}
              />
              {unsure && <span style={{ color: tk.text.faint }} title="A guess: little in the code says what it stands for">?</span>}
            </div>
            {r.learned && (
              <div style={{ fontSize: 10.5, color: tk.text.muted, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span>Learned from your choice</span>
                <button type="button" style={linkBtn} onClick={() => forgetLearnedRole(r.learned)} title="Guess this parameter’s role from the code again">Forget</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Select
                ariaLabel={`Feed ${r.name} with`} value={bindings[i]?.kind ?? 'const'} height={24}
                onChange={v => setBinding(i, { kind: v as BindingKind, value: bindings[i]?.value?.length ? bindings[i].value : [0.5] })}
                options={bindingsFor(r.type).map(k => ({ value: k, label: BINDING_LABEL[k] }))}
                style={{ flex: 1, minWidth: 0, font: `500 11px ${fontFamily.ui}`, color: tk.text.secondary, padding: '0 4px 0 8px' }}
              />
              {bindings[i]?.kind === 'const' && (
                <input
                  aria-label={`Value for ${r.name}`} value={(bindings[i].value ?? []).join(', ')}
                  onChange={e => setBinding(i, { kind: 'const', value: e.target.value.split(',').map(x => Number(x.trim())).filter(n => Number.isFinite(n)) })}
                  style={{ width: r.type === 'float' ? 52 : 92, height: 24, borderRadius: radius.sm, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, padding: '0 6px' }}
                />
              )}
            </div>
          </div>
        );
      })}
      {active.params.length === 0 && <div style={{ fontSize: 10.5, color: tk.text.faint }}>No parameters: the preview calls it as it is.</div>}
      {learnedCount > 0 && (
        <div style={{ fontSize: 10.5, color: tk.text.faint, lineHeight: 1.4, marginTop: 2 }}>
          {learnedCount === 1 ? '1 role' : `${learnedCount} roles`} learned from your choices. <button type="button" style={linkBtn} onClick={() => forgetLearnedRole()}>Forget all</button>
        </div>
      )}
    </div>
  );

  const uses = showUses && (
    <div style={{ flexShrink: 0, maxHeight: narrow ? undefined : 110, overflowY: narrow ? undefined : 'auto', borderBottom: `1px solid ${tk.border.subtle}`, padding: '4px 12px 6px' }}>
      <div style={{ ...caps, margin: '4px 0 4px' }}>Used in {active.sourceName}</div>
      {active.callSites.slice(0, 12).map((c, i) => (
        <button key={i} type="button" onClick={() => onShowInFile?.(active.sourceId, { start: c.start, end: c.end })} title={onShowInFile ? 'Show this call in the file' : undefined}
          style={{ display: 'flex', gap: 8, width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: onShowInFile ? 'pointer' : 'default', padding: '2px 0', font: `11px ${fontFamily.mono}`, color: tk.text.secondary }}>
          <span style={{ color: tk.text.faint, minWidth: 34 }}>{c.line}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.text}</span>
          <span style={{ color: tk.text.faint, flexShrink: 0 }}>in {c.inFn}</span>
        </button>
      ))}
      {active.callSites.length > 12 && <div style={{ fontSize: 10.5, color: tk.text.faint }}>and {active.callSites.length - 12} more</div>}
    </div>
  );

  const code = (
    <pre style={{ flex: narrow ? 'none' : 1, minHeight: 0, maxHeight: narrow ? 240 : undefined, overflow: 'auto', margin: 0, padding: '8px 12px', background: tk.bg.field, font: `12px/1.55 ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'pre', tabSize: 4 }}>
      {previewCode.split('\n').map((line, i) => (
        <div key={i} style={{ minHeight: '1.55em' }}>{tokenizeLine(line, pal).map((t, j) => <span key={j} style={{ color: t.color }}>{t.text}</span>)}</div>
      ))}
    </pre>
  );

  const head = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 4px', flexWrap: 'wrap' }}>
        <Field aria-label="Name in the library" value={names[active.id] ?? active.name} height={26} mono onChange={e => setNames(m => ({ ...m, [active.id]: e.target.value }))} style={narrow ? { flex: '1 1 96px', minWidth: 0 } : { width: 180 }} />
        {badge(active.returnType, tk.text.muted)}
        <span style={{ fontSize: 11, color: tk.text.faint, flex: 1, minWidth: 120, ...(narrow ? { flexBasis: '100%', order: 10 } : {}) }}>{ret && ret.role !== 'unknown' ? `returns a ${ROLE_INFO[ret.role].label} · ` : ''}{levelLabel(active)}{active.dependencies.length ? ` · brings ${active.dependencies.map(d => d.name).join(', ')}` : ''}{active.defines.length ? ` · ${active.defines.length} #define${active.defines.length > 1 ? 's' : ''}` : ''} · {active.sourceName}, lines {active.startLine}–{active.endLine}</span>
        {active.callSites.length > 0 && <Button size="sm" variant={showUses ? undefined : 'ghost'} icon="search" onClick={() => setShowUses(v => !v)}>{`Used ${active.callSites.length}×`}</Button>}
        {onShowInFile && <Button size="sm" variant="ghost" icon="code" onClick={() => onShowInFile(active.sourceId, { start: active.start, end: active.end })}>Show in file</Button>}
        <Button size="sm" variant={selected.has(active.id) ? 'ghost' : undefined} icon={selected.has(active.id) ? 'check' : 'plus'} onClick={() => toggle(active.id)}>{selected.has(active.id) ? 'Kept' : 'Keep'}</Button>
      </div>
      <div style={{ padding: '0 12px 6px' }}>
        <Field aria-label="Comment" placeholder={defaultComment(active)} value={comments[active.id] ?? ''} height={26} onChange={e => setComments(m => ({ ...m, [active.id]: e.target.value }))} />
      </div>
      {!active.selfContained && <div style={{ margin: '0 12px 6px', fontSize: 11, color: tk.status.warning }}>Reads {active.globals.join(', ')} from its shader, so it can’t be saved as a library function as it is.</div>}
    </>
  );

  if (narrow) {
    // One scroll: the list, then everything about the chosen function, picture and roles before the code.
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {list}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: `1px solid ${tk.border.subtle}` }}>
          {head}
          <div style={{ display: 'flex', gap: 10, padding: '4px 12px 10px', alignItems: 'flex-start' }}>
            <MiniShader source={preview?.ok ? preview.source : null} size={112} />
            {roleControls}
          </div>
          {uses}
          {code}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {list}
      <div style={{ flexShrink: 0, height: '50%', minHeight: 200, borderTop: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column' }}>
        {head}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', gap: 0 }}>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {uses}
            {code}
          </div>
          {/* The picture beside the roles that feed it, so changing one shows at once. */}
          <div style={{ width: 392, flexShrink: 0, borderLeft: `1px solid ${tk.border.subtle}`, padding: '8px 10px', overflowY: 'auto', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <MiniShader source={preview?.ok ? preview.source : null} size={168} />
            {roleControls}
          </div>
        </div>
      </div>
    </div>
  );
}
