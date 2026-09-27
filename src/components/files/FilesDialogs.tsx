/**
 * The Files page's dialogs: confirm a removal (saying what breaks), download
 * a selection (with its versions and what it uses, optionally), and install
 * a profile (preview by section → Merge or Replace everything → result).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { formatSize } from '../../utils/library';
import { SECTIONS, type Inventory, type SectionId } from '../../files/inventory';
import { sectionLabel, type InstallPreview, type InstallRow, type InstallStatus, type InstallSummary, type Profile } from '../../files/profileZip';
import { downloadSelection, runInstall, selectionSummary, type RemoveConfirm, type SaveTarget } from './filesActions';
import { SECTION_ICONS, capsLabel, KIND_LABELS } from './fileUiShared';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Bullets({ items, max = 6 }: { items: string[]; max?: number }) {
  const tk = useTokens();
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3, color: tk.text.secondary, font: `12.5px/1.45 ${fontFamily.ui}` }}>
      {items.slice(0, max).map(t => <li key={t}>{t}</li>)}
      {items.length > max && <li style={{ color: tk.text.faint, listStyle: 'none', marginLeft: -18 }}>and {items.length - max} more</li>}
    </ul>
  );
}

// ── Remove ──────────────────────────────────────────────────────────────────

export function RemoveDialog({ c, onDone }: { c: RemoveConfirm; onDone: (ok: boolean) => void }) {
  const tk = useTokens();
  return (
    <Modal title={c.title} icon="trash" iconColor={tk.status.danger} onClose={() => onDone(false)} width={460}
      footer={<><span style={{ flex: 1, fontSize: 12, color: tk.text.faint }}>{c.size ? `Frees ${formatSize(c.size)} · ` : ''}Undo stays open for a while</span><Button variant="ghost" onClick={() => onDone(false)}>Cancel</Button><Button variant="danger" autoFocus onClick={() => onDone(true)}>Remove</Button></>}>
      <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {c.breaks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: radius.md, background: alpha(tk.status.danger, 0.08), boxShadow: `inset 0 0 0 1px ${alpha(tk.status.danger, 0.2)}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}><Icon name="alert" size={15} style={{ color: tk.status.danger }} />This breaks what needs it</span>
            <Bullets items={c.breaks} />
          </div>
        )}
        {c.copies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Nothing else breaks</span>
            <Bullets items={c.copies} max={4} />
          </div>
        )}
        {!c.breaks.length && !c.copies.length && (
          <span style={{ color: tk.text.secondary, lineHeight: 1.5 }}>
            {c.folders ? 'The folders go with everything in them. To keep what’s inside, use the folder’s ⋯ menu: Remove folder, keep items.' : 'This removes it from this browser.'}
          </span>
        )}
      </div>
    </Modal>
  );
}

// ── Download a selection ────────────────────────────────────────────────────

export function DownloadDialog({ inv, ids, onClose }: { inv: Inventory; ids: string[]; onClose: () => void }) {
  const tk = useTokens();
  const [versions, setVersions] = useState(true);
  const [deps, setDeps] = useState(true);
  const [busy, setBusy] = useState(false);
  const sum = useMemo(() => selectionSummary(inv, ids, { versions, dependencies: deps }), [inv, ids, versions, deps]);
  const plain = useMemo(() => selectionSummary(inv, ids, { versions: false, dependencies: true }), [inv, ids]);
  const hasVersions = sum.items.some(n => n.extraRefs?.length);
  const go = async (target: SaveTarget) => { setBusy(true); await downloadSelection(inv, ids, { versions, dependencies: deps }, target); setBusy(false); onClose(); };
  const bySection = new Map<SectionId, number>();
  for (const n of sum.items) bySection.set(n.section, (bySection.get(n.section) ?? 0) + 1);

  return (
    <Modal title={`Download ${plural(sum.items.length, 'item')}`} subtitle="A ZIP that Install (or the Library’s Import) reads back" icon="export" onClose={onClose} width={480}
      footer={<>
        <span style={{ flex: 1, font: `500 12px ${fontFamily.mono}`, color: tk.text.muted }}>≈ {formatSize(sum.size)}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {isTauri() && <Button disabled={busy || !sum.items.length} icon="folder" onClick={() => { void go('folder'); }}>Save to folder…</Button>}
        <Button variant="primary" disabled={busy || !sum.items.length} icon="export" onClick={() => { void go('download'); }}>{isTauri() ? 'Save ZIP…' : 'Download ZIP'}</Button>
      </>}>
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...bySection].map(([s, n]) => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 7, background: tk.bg.field, font: `500 12px ${fontFamily.ui}`, color: tk.text.secondary }}>
              <Icon name={SECTION_ICONS[s]} size={13} style={{ color: tk.text.muted }} />{sectionLabel(s)} · {n}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, maxHeight: 180, overflow: 'auto' }}>
          {sum.items.map((n, i) => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderTop: i ? `1px solid ${tk.border.subtle}` : 0, fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.primary }}>{n.label}</span>
              <span style={{ color: tk.text.faint, fontSize: 11.5 }}>{KIND_LABELS[n.kind]}</span>
              <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.muted, width: 56, textAlign: 'right' }}>{formatSize(n.size)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <OptionRow label="Earlier versions" hint={hasVersions ? 'Each graph’s saved history, not just its newest version' : 'None of these has earlier versions'}>
            <Toggle checked={versions && hasVersions} disabled={!hasVersions} onChange={setVersions} />
          </OptionRow>
          <OptionRow label="What they use" hint={plain.dependencies.length ? `Adds ${plain.dependencies.map(d => `“${d.label}” (${KIND_LABELS[d.kind].toLowerCase()})`).slice(0, 3).join(', ')}${plain.dependencies.length > 3 ? ` and ${plain.dependencies.length - 3} more` : ''}` : 'Nothing else is needed: graphs carry their datasets, media and layer kinds'}>
            <Toggle checked={deps && plain.dependencies.length > 0} disabled={!plain.dependencies.length} onChange={setDeps} />
          </OptionRow>
        </div>
      </div>
    </Modal>
  );
}

function OptionRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{label}</span>
        <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.4 }}>{hint}</span>
      </span>
      {children}
    </div>
  );
}

// ── Install ─────────────────────────────────────────────────────────────────

const STATUS: Record<InstallStatus, { label: string; tone: 'accent' | 'warn' | 'muted' | 'ok' }> = {
  new: { label: 'New', tone: 'ok' },
  rename: { label: 'Renamed', tone: 'warn' },
  same: { label: 'Already here', tone: 'muted' },
  keep: { label: 'Yours kept', tone: 'muted' },
  merge: { label: 'Merged', tone: 'accent' },
};

export function InstallDialog({ fileName, profile, preview, compact, onClose }: { fileName: string; profile: Profile; preview: InstallPreview; compact: boolean; onClose: () => void }) {
  const tk = useTokens();
  const [stage, setStage] = useState<'preview' | 'replace' | 'done'>('preview');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<InstallSummary | null>(null);
  const [open, setOpen] = useState<SectionId | null>(null);
  const m = preview.manifest;
  const bySection = new Map<SectionId, InstallRow[]>();
  for (const r of preview.rows) { const l = bySection.get(r.section) ?? []; l.push(r); bySection.set(r.section, l); }
  const sections = SECTIONS.filter(s => bySection.has(s.id));
  const sub = m ? `Shader Studio ${m.app.version} · ${new Date(m.createdAt).toLocaleDateString()} · ${m.scope === 'everything' ? 'a whole profile' : 'a selection'} · ${formatSize(m.total.size)}` : 'A library ZIP or file (no manifest: an older export)';
  const run = async (mode: 'merge' | 'replace') => {
    setBusy(true);
    const r = await runInstall(profile, mode);
    setBusy(false);
    if (r) { setSummary(r); setStage('done'); }
  };
  const colour = (t: typeof STATUS[InstallStatus]['tone']) => t === 'ok' ? tk.status.success : t === 'warn' ? tk.status.warningText : t === 'accent' ? tk.accent.text : tk.text.faint;

  if (stage === 'done' && summary) {
    return (
      <Modal title={summary.mode === 'replace' ? 'Replaced everything' : 'Installed'} subtitle={fileName} icon="check" iconColor={tk.status.success} onClose={onClose} width={460}
        footer={<><span style={{ flex: 1, fontSize: 12, color: tk.text.faint }}>Open pages pick most of it up now; reload for nodes and settings.</span><Button variant="ghost" onClick={() => location.reload()}>Reload</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
        <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, borderRadius: radius.md, overflow: 'hidden', background: tk.border.subtle }}>
            {[['Added', summary.added], ['Renamed', summary.renamed.length], [summary.mode === 'replace' ? 'Backup' : 'Already here', summary.mode === 'replace' ? '✓' : summary.same + summary.kept]].map(([l, v]) => (
              <div key={String(l)} style={{ background: tk.bg.panel, padding: '9px 12px' }}>
                <div style={{ fontSize: 11, color: tk.text.muted }}>{l}</div>
                <div style={{ font: `650 18px ${fontFamily.ui}`, color: tk.text.primary }}>{v}</div>
              </div>
            ))}
          </div>
          {summary.renamed.length > 0 && <>
            <span style={capsLabel(tk)}>Came in under a new name</span>
            <Bullets items={summary.renamed.map(r => `${r.from} → ${r.to}`)} />
          </>}
          {summary.mode === 'replace' && <span style={{ fontSize: 12.5, color: tk.text.secondary, lineHeight: 1.5 }}>What was here before is in the backup ZIP that downloaded first: Install it to go back.</span>}
          {summary.kept > 0 && <span style={{ fontSize: 12, color: tk.text.muted }}>{plural(summary.kept, 'setting or node type')} you already had stayed as yours.</span>}
        </div>
      </Modal>
    );
  }

  const replace = stage === 'replace';
  return (
    <Modal title={compact ? 'Install' : `Install “${fileName}”`} subtitle={<span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${fileName} · ${sub}`}>{compact ? fileName : sub}</span>} icon="import" onClose={onClose} width={580}
      footer={replace ? <>
        <Button variant="ghost" onClick={() => setStage('preview')}>Back</Button>
        <span style={{ flex: 1 }} />
        <Button variant="danger" icon="trash" disabled={busy} onClick={() => { void run('replace'); }}>{busy ? 'Replacing…' : compact ? 'Back up and replace' : 'Download a backup, then replace'}</Button>
      </> : <>
        <Button variant="ghost" disabled={busy} onClick={() => setStage('replace')} style={{ color: tk.status.danger }}>Replace everything…</Button>
        <span style={{ flex: 1 }} />
        {!compact && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
        <Button variant="primary" disabled={busy || !preview.rows.length} icon="import" onClick={() => { void run('merge'); }}>{busy ? 'Installing…' : 'Merge'}</Button>
      </>}>
      <div style={{ padding: compact ? '12px 14px 16px' : '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {replace ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: radius.md, background: alpha(tk.status.danger, 0.08), boxShadow: `inset 0 0 0 1px ${alpha(tk.status.danger, 0.22)}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}><Icon name="alert" size={16} style={{ color: tk.status.danger }} />Replace everything in this browser?</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: tk.text.secondary }}>
              Every graph, presentation, shader, preset, setting and folder here is removed, and this file’s {plural(preview.rows.length, 'item')} take their place.
              First a backup ZIP of everything now here downloads; if that doesn’t save, nothing changes. Sign-ins and this computer’s backup folder stay.
            </span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 1, borderRadius: radius.md, overflow: 'hidden', background: tk.border.subtle }}>
            {([['New', preview.counts.new, 'ok'], ['Renamed', preview.counts.rename, 'warn'], ['Already here', preview.counts.same, 'muted'], ['Yours kept', preview.counts.keep + preview.counts.merge, 'muted']] as const).map(([l, v, t]) => (
              <div key={l} style={{ background: tk.bg.panel, padding: '9px 12px' }}>
                <div style={{ fontSize: 11, color: tk.text.muted }}>{l}</div>
                <div style={{ font: `650 18px ${fontFamily.ui}`, color: v ? colour(t) : tk.text.faint }}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {!replace && preview.counts.rename > 0 && <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>Merge adds what’s new and never overwrites yours: a different thing under a name you already use comes in as “Name (2)”.</span>}
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
          {sections.map((s, i) => {
            const rows = bySection.get(s.id)!;
            const isOpen = open === s.id;
            const clashes = rows.filter(r => r.status === 'rename').length;
            return (
              <div key={s.id} style={{ borderTop: i ? `1px solid ${tk.border.subtle}` : 0 }}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', border: 0, background: isOpen ? tk.bg.subtle : 'transparent', cursor: 'pointer', font: `12.5px ${fontFamily.ui}`, color: tk.text.primary, textAlign: 'left' }}>
                  <Icon name={isOpen ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
                  <Icon name={SECTION_ICONS[s.id]} size={14} style={{ color: tk.text.muted }} />
                  <span style={{ fontWeight: 600, flex: 1 }}>{s.label} <span style={{ fontWeight: 400, color: tk.text.muted }}>· {rows.length}</span></span>
                  {clashes > 0 && !replace && <span style={{ font: `600 10.5px ${fontFamily.ui}`, color: tk.status.warningText, background: alpha(tk.status.warning, 0.14), padding: '1px 6px', borderRadius: 5 }}>{plural(clashes, 'clash', 'clashes')}</span>}
                  <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.muted, width: 60, textAlign: 'right' }}>{formatSize(rows.reduce((n, r) => n + r.size, 0))}</span>
                </button>
                {isOpen && rows.map((r, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 45px', borderTop: `1px solid ${tk.border.subtle}`, fontSize: 12.5 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.secondary }}>
                      {r.label}{r.as && !replace && <span style={{ color: tk.text.faint }}> → {r.as}</span>}
                    </span>
                    {!replace && <span style={{ font: `600 10.5px ${fontFamily.ui}`, color: colour(STATUS[r.status].tone), whiteSpace: 'nowrap' }}>{STATUS[r.status].label}</span>}
                    {!compact && <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, width: 60, textAlign: 'right' }}>{formatSize(r.size)}</span>}
                  </div>
                ))}
              </div>
            );
          })}
          {!sections.length && <div style={{ padding: 16, color: tk.text.faint, fontSize: 12.5 }}>Nothing in this file that Shader Studio can install.</div>}
        </div>

      </div>
    </Modal>
  );
}
