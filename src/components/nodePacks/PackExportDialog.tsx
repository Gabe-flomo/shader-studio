/**
 * The export summary: what goes in the .playfile (each item and its size),
 * what's sealed, who signs it and with which key, the version it carries
 * (bumped when this version has gone out already), then the download.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Callout } from '../ui/Callout';
import { toast } from '../ui/toastStore';
import { formatSize } from '../../utils/library';
import { KIND_LAYOUT, PLAYFILE_EXT } from '../../playfile/format';
import { bumpVersion, compareVersions, nextExportVersion, parseVersion, type Validation } from '../../nodePacks/assemble';
import { exportPreparedPack, preparePackExport, type PreparedExport } from '../../nodePacks/app';
import type { PackProject } from '../../nodePacks/types';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function PackExportDialog({ project, validation, onClose, onExported }: {
  project: PackProject;
  validation: Validation;
  onClose: () => void;
  onExported: (p: PackProject) => void;
}) {
  const tk = useTokens();
  const suggested = nextExportVersion(project);
  const [version, setVersion] = useState(suggested);
  const [prep, setPrep] = useState<PreparedExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = project.exports.length ? project.exports[project.exports.length - 1] : null;
  const versionOk = !!parseVersion(version);
  const reused = project.exports.some(e => e.version === version.trim());

  useEffect(() => {
    let live = true;
    setPrep(null);
    setError(null);
    const t = setTimeout(() => {
      preparePackExport(project, versionOk ? version.trim() : suggested)
        .then(p => { if (!live) return; if (p) setPrep(p); else onClose(); })
        .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    }, 150);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-prepare when the version changes
  }, [project, version]);

  const errors = [...validation.pack, ...[...validation.nodes.values()].flat(), ...[...validation.extras.values()].flat()].filter(i => i.level === 'error');
  const go = async () => {
    if (!prep) return;
    setBusy(true);
    const r = await exportPreparedPack(prep);
    setBusy(false);
    if (!r.ok) { if (!r.cancelled) setError(r.error); return; }
    toast.success(`Exported “${project.name}” ${prep.version}`, { message: `${plural(prep.items.length, 'item')}, ${formatSize(prep.totalBytes)}, signed (${r.fingerprint ?? 'your key'})${prep.assembled.sealed ? ', sealed' : ''}.` });
    if (r.project) onExported(r.project);
    onClose();
  };

  return (
    <Modal title="Export the node pack" subtitle={`${project.name} · one ${PLAYFILE_EXT} file, signed by you`} icon="export" onClose={onClose} width={560}
      footer={<>
        <span style={{ flex: 1, font: `500 12px ${fontFamily.mono}`, color: tk.text.muted }}>{prep ? formatSize(prep.totalBytes) : ''}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="export" disabled={!prep || busy || !versionOk || errors.length > 0} onClick={() => { void go(); }}>{busy ? 'Exporting…' : `Download ${PLAYFILE_EXT}`}</Button>
      </>}>
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {errors.length > 0 && (
          <Callout tone="warning" title="Fix these first">
            {errors.map(e => <div key={e.text}>{e.text}</div>)}
          </Callout>
        )}
        {error && <Callout title="Couldn’t export" details={error} onDismiss={() => setError(null)}>Nothing was saved.</Callout>}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>
            Version
            <Field mono aria-label="Version" value={version} invalid={!versionOk} onChange={e => setVersion(e.target.value)} style={{ width: 110 }} />
          </label>
          <span style={{ display: 'flex', gap: 4, paddingBottom: 2 }}>
            {(['patch', 'minor', 'major'] as const).map(part => {
              const base = last && compareVersions(last.version, version) > 0 ? last.version : (versionOk ? version : suggested);
              const next = bumpVersion(base, part);
              return <Button key={part} size="sm" variant="ghost" title={`Bump the ${part} version`} onClick={() => setVersion(next)}>{next}</Button>;
            })}
          </span>
        </div>
        <span style={{ fontSize: 11.5, color: reused ? tk.status.warningText : tk.text.muted, lineHeight: 1.45, marginTop: -6 }}>
          {last ? `Last exported as ${last.version} on ${new Date(last.at).toLocaleDateString()}.` : 'The first export.'}
          {reused ? ' That version has gone out already: whoever has it can’t tell the two apart. Bump it.' : ' Someone who has an earlier version gets these nodes updated in place when they open it.'}
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
          {!prep && !error && <div style={{ padding: 14, fontSize: 12.5, color: tk.text.faint }}>Putting it together…</div>}
          {prep?.rows.map((r, i) => (
            <div key={`${r.kind}:${r.name}:${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: i ? `1px solid ${tk.border.subtle}` : 0, fontSize: 12.5 }}>
              <Icon name={r.kind === 'nodes' ? 'nodes' : r.kind === 'graph' ? 'graphs' : r.kind === 'presentation' ? 'slides' : r.kind === 'glsl' ? 'code' : r.kind === 'video' ? 'camera' : 'overlay'} size={14} style={{ color: tk.text.muted, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ fontSize: 11.5, color: tk.text.muted, whiteSpace: 'nowrap' }}>{[KIND_LAYOUT[r.kind].label, r.note].filter(Boolean).join(' · ')}</span>
              {r.sealed && <span title="Sealed: the code is encrypted in the file" style={{ display: 'inline-flex', color: tk.accent.text }}><Icon name="lock" size={12} /></span>}
              <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, width: 60, textAlign: 'right' }}>{formatSize(r.bytes)}</span>
            </div>
          ))}
        </div>

        {prep && (
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 12, color: tk.text.secondary, lineHeight: 1.45, padding: '10px 12px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.06) }}>
            <b style={{ color: tk.text.primary }}>Sealed</b>
            <span>{prep.assembled.sealed ? 'Yes: every node’s GLSL is encrypted in the file and hidden in the app. It stops casual copying, not a determined person (a shader reaches the GPU as text).' : prep.assembled.defs.some(d => d.sealed) ? 'Some: the nodes that came from a sealed pack stay sealed.' : 'No: the nodes carry their code (and their source, unless it was left out when they were published).'}</span>
            <b style={{ color: tk.text.primary }}>Signed</b>
            <span>By “{project.author.trim() || 'Unnamed author'}” with {prep.signer ? <>your key <code style={{ font: `500 11px ${fontFamily.mono}` }}>{prep.signer}</code></> : 'a key made on this device now'}, kept on this {isTauri() ? 'Mac (in the keychain)' : 'browser'}.</span>
            <b style={{ color: tk.text.primary }}>Inside</b>
            <span>{plural(prep.assembled.defs.length, 'node')}, listed under “{prep.assembled.info.name}”{prep.assembled.info.examples?.length ? `, ${plural(prep.assembled.info.examples.length, 'example graph')}` : ''}{prep.assembled.info.notes?.length ? `, ${plural(prep.assembled.info.notes.length, 'note')}` : ''}{prep.assembled.info.licence ? ', a licence' : ''}.</span>
          </div>
        )}
        {prep?.notes.map(n => <span key={n} style={{ fontSize: 12, color: tk.status.warningText, lineHeight: 1.45 }}>{n}</span>)}
      </div>
    </Modal>
  );
}
