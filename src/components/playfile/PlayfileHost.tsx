/**
 * PlayfileHost — the .playfile dialogs, mounted once beside the app:
 *
 *   Open (preview → import → result): what's inside, who signed it, what's
 *     sealed, what clashes (keep both or replace), then the import.
 *   Node pack: export node types as a signed pack, optionally sealed.
 *   The export format menu: ".playfile" or the readable format, at a button.
 *
 * It also opens .playfile files dropped anywhere on the window, and (desktop)
 * files opened with the app (the file association) or dropped on it.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Toggle, Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { useFormatMenu } from './formatMenu';
import { toast } from '../ui/toastStore';
import { reportFileResult } from '../shell/reportFileResult';
import { Check } from '../files/fileUi';
import { formatSize } from '../../utils/library';
import { errorMessage } from '../../utils/fileIO';
import { isStorageLimitError } from '../../files/storageLimit';
import { useBreakpoint, isMobile } from '../../hooks/useBreakpoint';
import { isContainerName, KIND_LAYOUT, PLAYFILE_EXT, type ItemKind } from '../../playfile/format';
import type { Choice, ImportRow, ImportSummary, Pick } from '../../playfile/importer';
import { currentAuthorName, exportNodePack, openPlayfileBytes, runImport, usePlayfileUi, type OpenImport } from '../../playfile/app';
import { existingAuthorKey, setAuthorName, trustedFor } from '../../playfile/signing';
import { getUserNode } from '../../nodes/userNodes/userNodeRegistry';
import type { IconName } from '../ui/iconPaths';
import type { PackInfo } from '../../nodePacks/types';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const KIND_ICONS: Record<ItemKind, IconName> = {
  graph: 'graphs', play: 'play', presentation: 'slides', nodes: 'nodes', glsl: 'code', background: 'overlay', library: 'presets', profile: 'folder', video: 'camera',
};
const KIND_ORDER: ItemKind[] = ['graph', 'play', 'presentation', 'nodes', 'glsl', 'background', 'video', 'library', 'profile'];
/** A node pack leads with its nodes; its graphs are the examples. */
const PACK_ORDER: ItemKind[] = ['nodes', 'graph', 'play', 'presentation', 'glsl', 'background', 'video', 'library', 'profile'];

function FormatMenu() {
  const { at, items, title } = useFormatMenu();
  if (!at) return null;
  return <Menu x={at.x} y={at.y} minWidth={270} title={title} items={items} onClose={() => useFormatMenu.setState({ at: null })} />;
}

// ── Host ────────────────────────────────────────────────────────────────────

export function PlayfileHost() {
  const importing = usePlayfileUi(s => s.importing);
  const pack = usePlayfileUi(s => s.pack);

  // A .playfile dropped anywhere opens its preview (pages with their own drop handling call preventDefault first).
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (e.defaultPrevented) return;
      const f = [...(e.dataTransfer?.files ?? [])].find(x => isContainerName(x.name));
      if (!f) return;
      e.preventDefault();
      void f.arrayBuffer().then(b => openPlayfileBytes(f.name, new Uint8Array(b)));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  // Desktop: files opened with the app (Finder, the Dock) and files dropped on the window.
  useEffect(() => {
    if (!isTauri()) return;
    let off: Array<() => void> = [];
    let cancelled = false;
    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const openPath = async (path: string) => {
        try {
          const bytes = new Uint8Array(await invoke<ArrayBuffer>('open_file_read', { path }));
          await openPlayfileBytes(path.split(/[\\/]/).pop() ?? path, bytes);
        } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); }
      };
      // The same file can arrive twice at launch (the event and the take): once is enough.
      const recent = new Map<string, number>();
      const openAll = (paths: string[]) => {
        for (const p of paths.filter(isContainerName)) {
          if (Date.now() - (recent.get(p) ?? 0) < 3000) continue;
          recent.set(p, Date.now());
          void openPath(p);
        }
      };
      const u1 = await listen<string[]>('open-files', e => openAll(e.payload));
      const u2 = await getCurrentWebview().onDragDropEvent(e => { if (e.payload.type === 'drop') openAll(e.payload.paths); });
      off = [u1, u2];
      if (cancelled) { off.forEach(f => f()); return; }
      // Files the app was launched with, before this listened.
      openAll(await invoke<string[]>('opened_files_take').catch(() => []));
    })().catch(e => console.warn('[playfile] desktop file hooks', e));
    return () => { cancelled = true; off.forEach(f => f()); };
  }, []);

  return <>
    <FormatMenu />
    {importing && <ImportDialog key={importing.fileName + importing.contents.manifest.created} open={importing} onClose={() => usePlayfileUi.setState({ importing: null })} />}
    {pack && <NodePackDialog ids={pack.ids} onClose={() => usePlayfileUi.setState({ pack: null })} />}
  </>;
}

// ── Open: preview, import, result ───────────────────────────────────────────

function Pill({ children, tone }: { children: ReactNode; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'accent' }) {
  const tk = useTokens();
  const c = tone === 'ok' ? tk.status.success : tone === 'warn' ? tk.status.warningText : tone === 'danger' ? tk.status.danger : tone === 'accent' ? tk.accent.text : tk.text.faint;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: `600 10.5px ${fontFamily.ui}`, color: c, background: alpha(c, 0.12), padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap' }}>{children}</span>;
}

const STATUS: Record<ImportRow['status'], { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  new: { label: 'New', tone: 'ok' },
  same: { label: 'Already here', tone: 'muted' },
  conflict: { label: 'Name taken', tone: 'warn' },
  'needs-pro': { label: 'Needs Pro', tone: 'muted' },
  unreadable: { label: 'Can’t read', tone: 'danger' },
};

function ImportDialog({ open, onClose }: { open: OpenImport; onClose: () => void }) {
  const tk = useTokens();
  const compact = isMobile(useBreakpoint());
  const { plan, contents, fileName } = open;
  const m = contents.manifest;
  const sig = contents.signature;
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(plan.rows.map(r => [r.id, { include: r.include, choice: r.choice }])));
  const trusted = sig.state === 'signed' ? trustedFor(sig.publicKey) : null;
  const [trust, setTrust] = useState(sig.state === 'signed' && !trusted);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const sealedCount = plan.rows.filter(r => r.sealed).length;
  const byKind = useMemo(() => (plan.packs?.length ? PACK_ORDER : KIND_ORDER).map(k => [k, plan.rows.filter(r => r.kind === k)] as const).filter(([, rows]) => rows.length), [plan.rows, plan.packs]);
  const chosen = plan.rows.filter(r => picks[r.id]?.include && r.status !== 'unreadable' && r.status !== 'needs-pro' && r.status !== 'same');
  const setPick = (id: string, p: Partial<Pick>) => setPicks(s => ({ ...s, [id]: { ...s[id], ...p } }));

  const go = async () => {
    setBusy(true);
    try {
      const r = await runImport(plan, picks, { trust });
      setDone(r);
      if (r.open && !r.failed.length) { onClose(); toast.success(`Imported ${plural(r.added.length + r.replaced.length + r.renamed.length, 'item')} from “${fileName}”`, { message: summaryLine(r) }); }
    } catch (e) { if (!isStorageLimitError(e)) toast.error('Couldn’t import that', { message: errorMessage(e) }); }
    setBusy(false);
  };

  if (done) {
    return (
      <Modal title="Imported" subtitle={fileName} icon="check" iconColor={tk.status.success} onClose={onClose} width={460}
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5, color: tk.text.secondary, lineHeight: 1.5 }}>
          <span>{summaryLine(done)}</span>
          {done.packs?.map(p => (
            <span key={p.id}>Node pack “{p.name}” v{p.version}: its {plural(p.nodeIds.length, 'node')} {p.nodeIds.length === 1 ? 'is' : 'are'} in the node list under “{p.category}”{p.examples?.length ? `, with ${plural(p.examples.length, 'example graph')} to open from there` : ''}.</span>
          ))}
          {done.renamed.length > 0 && <span>Came in under a new name: {done.renamed.map(r => `${r.from} → ${r.to}`).join(', ')}.</span>}
          {done.failed.map(f => <span key={f.name} style={{ color: tk.status.danger }}>“{f.name}” didn’t come in: {f.error}</span>)}
        </div>
      </Modal>
    );
  }

  const signatureBox = (() => {
    if (sig.state === 'signed') return (
      <Banner tone="ok" icon="check" title={<>Signed by {sig.name}{trusted ? <Pill tone="ok">Trusted</Pill> : <Pill tone="muted">New author</Pill>}</>}>
        Key <code style={{ font: `500 11.5px ${fontFamily.mono}` }}>{sig.fingerprint}</code>
        {trusted && trusted.name !== sig.name ? ` · you trusted this key as “${trusted.name}”` : ''}. The file hasn’t changed since they signed it. The name is theirs to choose: the key is what identifies them.
      </Banner>
    );
    if (sig.state === 'modified') return (
      <Banner tone="danger" icon="alert" title="Signature doesn’t match: modified">
        It was signed{sig.name ? ` as “${sig.name}”` : ''}, but something in it changed afterwards. Its node types aren’t ticked; only bring in what you trust.
      </Banner>
    );
    return <Banner tone="muted" icon="info" title={`Unsigned${sig.name ? ` · by “${sig.name}”` : ''}`}>Nothing says who made it or whether it changed on the way. Graphs and presentations are data; node types are GLSL that runs on your GPU.</Banner>;
  })();

  return (
    <Modal title={compact ? 'Open' : `Open “${fileName}”`}
      subtitle={<span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{compact ? fileName : `Playfield ${m.appVersion}${m.created ? ` · ${new Date(m.created).toLocaleDateString()}` : ''} · ${plural(plan.rows.length, 'item')}`}</span>}
      icon="import" onClose={onClose} width={600}
      footer={<>
        {!compact && <span style={{ flex: 1, font: `500 12px ${fontFamily.mono}`, color: tk.text.muted }}>{formatSize(chosen.reduce((n, r) => n + r.bytes, 0))}</span>}
        {compact && <span style={{ flex: 1 }} />}
        {!compact && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
        <Button variant="primary" icon="import" disabled={busy || !chosen.length} onClick={() => { void go(); }}>{busy ? 'Importing…' : chosen.length ? `Import ${plural(chosen.length, 'item')}` : 'Nothing to import'}</Button>
      </>}>
      <div style={{ padding: compact ? '12px 14px 16px' : '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {signatureBox}
        {sig.state === 'signed' && !trusted && <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: tk.text.secondary, cursor: 'pointer' }}><Toggle checked={trust} onChange={setTrust} />Remember this author’s key as trusted</label>}
        {plan.packs?.map(p => <PackBanner key={p.path} info={p.info} />)}
        {sealedCount > 0 && <Banner tone="accent" icon="lock" title={`Sealed node pack · ${plural(sealedCount, 'node type')}`}>They run as nodes; their code stays encrypted and isn’t shown, and they can only be shared sealed.</Banner>}
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
          {byKind.map(([kind, rows], gi) => (
            <div key={kind} style={{ borderTop: gi ? `1px solid ${tk.border.subtle}` : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: tk.bg.subtle, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>
                <Icon name={KIND_ICONS[kind]} size={14} style={{ color: tk.text.muted }} />
                {kind === 'nodes' ? (rows.length === 1 ? 'Node type' : 'Node types') : rows.length === 1 ? KIND_LAYOUT[kind].label : KIND_LAYOUT[kind].plural}
                <span style={{ fontWeight: 400, color: tk.text.muted }}>· {rows.length}</span>
              </div>
              {rows.map(r => {
                const p = picks[r.id];
                const disabled = r.status === 'unreadable' || r.status === 'needs-pro' || r.status === 'same';
                return (
                  <div key={r.id} style={{ display: 'flex', flexWrap: compact ? 'wrap' : 'nowrap', alignItems: 'center', gap: 8, padding: '7px 12px', borderTop: `1px solid ${tk.border.subtle}`, fontSize: 12.5, opacity: disabled && r.status !== 'same' ? 0.7 : 1 }}>
                    <Check checked={!!p?.include && !disabled} disabled={disabled} label={`Import ${r.name}`} onChange={v => setPick(r.id, { include: v })} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.primary }}>{r.name}</span>
                        {r.sealed && <Icon name="lock" size={12} style={{ color: tk.accent.text, flexShrink: 0 }} />}
                      </span>
                      <span style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[r.dependency ? 'Used by another item' : '', r.reason ?? r.detail].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {r.status === 'conflict' && p?.include
                      ? <Segmented<Choice> size="sm" ariaLabel={`What to do with ${r.name}`} value={p.choice} onChange={v => setPick(r.id, { choice: v })}
                          options={[{ value: 'keep-both', label: 'Keep both' }, { value: 'replace', label: 'Replace' }]} />
                      : <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>}
                    {!compact && <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, width: 56, textAlign: 'right' }}>{formatSize(r.bytes)}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {!plan.rows.length && <div style={{ padding: 16, color: tk.text.faint, fontSize: 12.5 }}>Nothing in this file that this version of Playfield can import.</div>}
        </div>
        {plan.rows.some(r => r.status === 'conflict') && <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>Keep both brings it in as “Name (2)”. Replace puts it in place of yours (a replaced graph keeps yours as an earlier version).</span>}
        {[...contents.notes, ...contents.skipped.filter(s => !s.reason.includes('isn’t something')).map(s => `“${s.item.name}” was left out: ${s.reason}.`)].map(n => <span key={n} style={{ fontSize: 12, color: tk.status.warningText, lineHeight: 1.45 }}>{n}</span>)}
      </div>
    </Modal>
  );
}

/** A node pack's own description: name, version, author, what it's for, its licence and notes. */
function PackBanner({ info }: { info: PackInfo }) {
  const tk = useTokens();
  const [more, setMore] = useState(false);
  const c = info.color ?? tk.kind.fn;
  const extra = [info.licence ? 'licence' : '', info.notes?.length ? plural(info.notes.length, 'note') : ''].filter(Boolean);
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: radius.md, background: alpha(c, 0.08), boxShadow: `inset 0 0 0 1px ${alpha(c, 0.25)}` }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c, color: '#fff', font: `700 14px ${fontFamily.ui}` }}>{info.icon || info.name.slice(0, 1).toUpperCase()}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>
          Node pack “{info.name}”<Pill tone="muted">v{info.version}</Pill>
        </span>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.secondary, overflowWrap: 'anywhere' }}>
          {info.description || 'Its nodes are listed under its name in the node list.'}
          {info.examples?.length ? ` Examples: ${info.examples.join(', ')}.` : ''}
        </span>
        {extra.length > 0 && (
          <button type="button" onClick={() => setMore(m => !m)} style={{ alignSelf: 'flex-start', border: 0, padding: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `500 11.5px ${fontFamily.ui}` }}>
            {more ? 'Hide' : 'Show'} the {extra.join(' and ')}
          </button>
        )}
        {more && info.licence && <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', font: `11px/1.45 ${fontFamily.mono}`, color: tk.text.secondary, background: tk.bg.field, borderRadius: 6, padding: '6px 8px' }}>{info.licence}</pre>}
        {more && info.notes?.map(n => <pre key={n.name} style={{ margin: 0, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', font: `11.5px/1.45 ${fontFamily.ui}`, color: tk.text.secondary, background: tk.bg.field, borderRadius: 6, padding: '6px 8px' }}><b>{n.name}</b>{'\n'}{n.text}</pre>)}
      </span>
    </div>
  );
}

function summaryLine(r: ImportSummary): string {
  return [
    r.added.length ? `${r.added.length} added` : '',
    r.replaced.length ? `${r.replaced.length} replaced` : '',
    r.renamed.length ? `${r.renamed.length} kept both` : '',
    r.same ? `${r.same} already here` : '',
  ].filter(Boolean).join(' · ') || 'Nothing new';
}

function Banner({ tone, icon, title, children }: { tone: 'ok' | 'danger' | 'muted' | 'accent'; icon: IconName; title: ReactNode; children: ReactNode }) {
  const tk = useTokens();
  const c = tone === 'ok' ? tk.status.success : tone === 'danger' ? tk.status.danger : tone === 'accent' ? tk.accent.base : tk.text.muted;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: radius.md, background: alpha(c, 0.08), boxShadow: `inset 0 0 0 1px ${alpha(c, 0.22)}` }}>
      <Icon name={icon} size={16} style={{ color: tone === 'muted' ? tk.text.muted : c, flexShrink: 0, marginTop: 1 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{title}</span>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.secondary, overflowWrap: 'anywhere' }}>{children}</span>
      </span>
    </div>
  );
}

// ── Node pack ───────────────────────────────────────────────────────────────

function NodePackDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const tk = useTokens();
  const defs = ids.map(getUserNode).filter((d): d is NonNullable<typeof d> => !!d);
  const anySealed = defs.some(d => !!d.sealed);
  const [sealed, setSealed] = useState(anySealed);
  const [author, setAuthor] = useState(currentAuthorName);
  const [name, setName] = useState(defs.length === 1 ? defs[0].label : 'My nodes');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void existingAuthorKey().then(k => setKey(k?.fingerprint ?? '')); }, []);
  const go = async () => {
    setBusy(true);
    setAuthorName(author);
    const r = await exportNodePack(defs.map(d => d.id), { sealed: sealed || anySealed, author, name });
    setBusy(false);
    if (reportFileResult(r, { failTitle: 'Couldn’t export the node pack' })) onClose();
  };
  return (
    <Modal title="Export a node pack" subtitle={`${plural(defs.length, 'node type')} as one ${PLAYFILE_EXT} file, signed by you`} icon="nodes" onClose={onClose} width={480}
      footer={<><span style={{ flex: 1 }} /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="export" disabled={busy || !defs.length} onClick={() => { void go(); }}>{busy ? 'Exporting…' : `Export ${PLAYFILE_EXT}`}</Button></>}>
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {defs.map(d => <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 7, background: tk.bg.field, font: `500 12px ${fontFamily.ui}`, color: tk.text.secondary }}>{d.sealed && <Icon name="lock" size={11} />}{d.label}</span>)}
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>
          Pack name
          <Field value={name} onChange={e => setName(e.target.value)} aria-label="Pack name" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>
          Your name, as the author
          <Field value={author} placeholder="Shown to whoever opens it" onChange={e => setAuthor(e.target.value)} aria-label="Author name" />
          <span style={{ fontWeight: 400, fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>
            {key ? <>Signed with your key <code style={{ font: `500 11px ${fontFamily.mono}` }}>{key}</code>, kept on this {isTauri() ? 'Mac (in the keychain)' : 'browser'}.</> : key === '' ? 'A signing key is made on this device the first time you export a pack, and kept here.' : ' '}
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={13} />Sealed</span>
            <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>
              {anySealed ? 'Some of these came from a sealed pack, so the pack is sealed.' : 'The GLSL is encrypted in the file and hidden in the app: people can use the nodes but not read or edit them.'} It stops casual copying, not a determined person: a shader reaches the GPU as text.
            </span>
          </span>
          <Toggle checked={sealed || anySealed} disabled={anySealed} onChange={setSealed} />
        </div>
      </div>
    </Modal>
  );
}
