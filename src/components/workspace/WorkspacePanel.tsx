/**
 * The workspace folder in the UI (workspace/workspace.ts is the logic):
 *
 *   WorkspaceView     the Files page's Workspace view (and the Settings section):
 *                     where, status, Change / Open in Finder / Disconnect, the
 *                     conflicts to decide, what's waiting to sync, problems
 *   WorkspaceBanner   a strip on the Files page when it needs something (not
 *                     connected, allow again, conflicts…), never blocking
 *   WorkspaceEntry    the Files sidebar's row for it
 *   WorkspaceChip     the top bar's small indicator
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { whenSaved } from '../../store/graphVersions';
import {
  chooseWorkspaceFolder, confirmDeletions, disconnectWorkspace, reconnectWorkspace, resolveConflict, restoreFromWorkspace, revealWorkspace, syncWorkspaceNow,
  adoptFolderAnyway, connectLegacyFolder, connectSuggestedFolder, useWorkspaceStatus, type WorkspaceStatus,
} from '../../workspace/workspace';
import type { ConflictRecord } from '../../workspace/engine';
import { openWorkspaceView, summary, type Tone } from './workspaceUi';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Dot({ tone, size = 8 }: { tone: Tone; size?: number }) {
  const tk = useTokens();
  const c = tone === 'ok' ? tk.status.success : tone === 'warn' ? tk.status.warning : tone === 'bad' ? tk.status.danger : tone === 'busy' ? tk.accent.base : tk.text.disabled;
  return <span aria-hidden style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', flexShrink: 0, background: c, boxShadow: tone === 'busy' ? `0 0 0 3px ${alpha(c, 0.2)}` : 'none' }} />;
}

/** Re-render every so often so "2 min ago" stays true. */
function useTick(ms = 20_000): void {
  const [, set] = useState(0);
  useEffect(() => { const id = window.setInterval(() => set(n => n + 1), ms); return () => window.clearInterval(id); }, [ms]);
}

/** The main action when the workspace needs something, or null. */
function attention(st: WorkspaceStatus): { title: string; message: string; action?: { label: string; run: () => void }; second?: { label: string; run: () => void }; tone: Tone } | null {
  switch (st.state) {
    case 'offline': return { tone: 'warn', title: 'Workspace not connected', message: `${st.message ?? ''}${st.pending.length ? ` ${plural(st.pending.length, 'change')} waiting to sync.` : ''}`, action: { label: 'Try again', run: () => { void syncWorkspaceNow(); } } };
    case 'needs-permission': return { tone: 'warn', title: 'Reconnect the workspace', message: `The browser asks once per visit before Shader Studio may use “${st.folder}”. Everything works meanwhile; changes wait.`, action: { label: 'Reconnect workspace', run: () => { void reconnectWorkspace(); } } };
    case 'not-workspace': return { tone: 'warn', title: 'This isn’t the workspace folder', message: st.message ?? '', action: { label: 'Use this folder anyway', run: () => { void adoptFolderAnyway(); } } };
    case 'held': return st.heldWhere === 'here'
      ? { tone: 'warn', title: `${plural(st.held, 'thing')} gone from this app’s storage`, message: 'So many at once can mean the browser cleared its storage. Nothing was removed from the folder.', action: { label: 'Bring them back', run: () => { void restoreFromWorkspace(); } }, second: { label: 'Remove them from the folder too', run: () => { void confirmDeletions(); } } }
      : { tone: 'warn', title: `${plural(st.held, 'thing')} gone from the workspace folder`, message: 'So many at once can mean the wrong folder or drive. Nothing was removed here yet.', action: { label: 'Remove them here too', run: () => { void confirmDeletions(); } } };
    case 'error': return { tone: 'bad', title: 'Workspace sync problem', message: st.message ?? '', action: { label: 'Try again', run: () => { void syncWorkspaceNow(); } } };
    default:
      return st.conflicts.length ? { tone: 'warn', title: `${plural(st.conflicts.length, 'thing')} changed here and in the folder`, message: 'Both versions are kept. Choose which to keep.' } : null;
  }
}

/** A strip on the Files page when the workspace needs something. */
export function WorkspaceBanner({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  const tk = useTokens();
  const st = useWorkspaceStatus();
  const a = attention(st);
  if (!a) return null;
  const c = a.tone === 'bad' ? tk.status.danger : tk.status.warning;
  return (
    <div role="status" style={{ display: 'flex', alignItems: compact ? 'flex-start' : 'center', flexDirection: compact ? 'column' : 'row', gap: compact ? 8 : 12, padding: compact ? '10px 12px' : '10px 16px 10px 20px', background: alpha(c, 0.1), borderBottom: `1px solid ${alpha(c, 0.35)}` }}>
      <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
        <span style={{ color: a.tone === 'bad' ? tk.status.danger : tk.status.warningText, marginTop: 1 }}><Icon name="warning" size={16} /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{a.title}</span>
          {a.message && <span style={{ font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>{a.message}</span>}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: compact ? 26 : 0 }}>
        {a.action && <Button size="sm" variant="primary" onClick={a.action.run}>{a.action.label}</Button>}
        {a.second && <Button size="sm" onClick={a.second.run}>{a.second.label}</Button>}
        <Button size="sm" variant={a.action ? 'ghost' : 'primary'} onClick={onOpen}>{st.conflicts.length && !a.action ? 'Review' : 'Details'}</Button>
      </span>
    </div>
  );
}

/** The Files sidebar's row: the workspace and how it's doing; opens the Workspace view. */
export function WorkspaceEntry({ active, onClick, dense = true }: { active: boolean; onClick: () => void; dense?: boolean }) {
  const tk = useTokens();
  const st = useWorkspaceStatus();
  useTick();
  const s = summary(st);
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-current={active ? 'page' : undefined} title={st.folder ?? undefined}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: dense ? '7px 8px' : '11px 12px', border: 0, borderRadius: dense ? radius.md : radius.lg, cursor: 'pointer', textAlign: 'left',
        background: active ? tk.bg.selected : dense ? (hover ? tk.bg.hover : 'transparent') : tk.bg.panel, boxShadow: dense ? 'none' : `inset 0 0 0 1px ${tk.border.default}`,
        color: active ? tk.accent.text : tk.text.primary, font: `600 12.5px ${fontFamily.ui}`,
      }}>
      <span style={{ width: dense ? 22 : 32, height: dense ? 22 : 32, borderRadius: dense ? 6 : 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.text, flexShrink: 0, position: 'relative' }}>
        <Icon name="folder" size={dense ? 13 : 16} />
        <span style={{ position: 'absolute', right: -2, bottom: -2, borderRadius: '50%', padding: 1.5, background: tk.bg.subtle, display: 'flex' }}><Dot tone={s.tone} size={7} /></span>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        Workspace folder
        <span style={{ fontWeight: 400, fontSize: 11.5, color: s.tone === 'warn' || s.tone === 'bad' ? tk.status.warningText : tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.state === 'off' ? (st.support === 'none' ? 'Not available in this browser' : 'Keep your work as files in a folder') : s.line}</span>
      </span>
      {!dense && <Icon name="chevR" size={14} style={{ color: tk.text.faint }} />}
    </button>
  );
}

/** The top bar's indicator: quiet when synced, says so when not connected or waiting. */
export function WorkspaceChip({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const st = useWorkspaceStatus();
  useTick();
  if (st.state === 'off') return null;
  const s = summary(st);
  const loud = s.tone === 'warn' || s.tone === 'bad';
  const label = `Workspace: ${st.folder ?? ''} · ${s.line}`;
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={() => { if (st.state === 'needs-permission') void reconnectWorkspace(); openWorkspaceView(); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: loud && !compact ? '0 10px 0 8px' : '0 8px', borderRadius: 14, border: 0, cursor: 'pointer',
          background: loud ? alpha(s.tone === 'bad' ? tk.status.danger : tk.status.warning, 0.14) : 'transparent',
          color: loud ? tk.status.warningText : tk.text.muted, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap',
        }}>
        <Icon name="folder" size={14} />
        <Dot tone={s.tone} size={7} />
        {loud && !compact && <span>{s.short}</span>}
      </button>
    </Tooltip>
  );
}

// ── The view ────────────────────────────────────────────────────────────────

function Section({ title, children, hint }: { title: string; hint?: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, font: `650 11px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.text.secondary }}>{title}</h3>
        {hint && <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.faint }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
  const tk = useTokens();
  return <div style={{ padding: '12px 14px', borderRadius: radius.lg, background: tone === 'warn' ? alpha(tk.status.warning, 0.08) : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tone === 'warn' ? alpha(tk.status.warning, 0.4) : tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>;
}

const nameOf = (path: string) => { const f = path.split('/').pop() ?? path; return f.replace(/(\.graph|\.present|\.fn|\.node|\.sketch|\.kind|\.builder|\.builder-group|\.palette)?\.json$|\.glsl$/, ''); };

function ConflictRow({ c }: { c: ConflictRecord }) {
  const tk = useTokens();
  const [busy, setBusy] = useState(false);
  const act = (choice: 'this' | 'other' | 'both') => { setBusy(true); void resolveConflict(c.id, choice).finally(() => setBusy(false)); };
  const named = c.label, copy = c.copyLabel ?? nameOf(c.copyPath);
  const note = { font: `12px/1.5 ${fontFamily.ui}`, color: tk.text.secondary };
  return (
    <Card tone="warn">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ font: `600 13px ${fontFamily.ui}`, color: tk.text.primary }}>{c.kindLabel} “{named}”</span>
        <span style={note}>Changed here and in the workspace folder before they synced ({whenSaved(c.at)}). Both are kept:</span>
        <span style={note}>
          “<b>{named}</b>” is {c.kept === 'here' ? 'this app’s version' : 'the folder’s version'} (changed last).<br />
          “<b>{copy}</b>” is {c.kept === 'here' ? 'the folder’s version' : 'this app’s version'}.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" disabled={busy} onClick={() => act('this')} title={`Keep “${named}” and remove “${copy}”`}>Keep this</Button>
        <Button size="sm" disabled={busy} onClick={() => act('other')} title={`Put “${copy}” in place of “${named}”, then remove the copy`}>Keep other</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('both')} title="Keep both, under their two names">Keep both</Button>
      </div>
    </Card>
  );
}

/** Everything about the workspace folder (the Files page's Workspace view; Settings shows it too). */
export function WorkspaceView({ compact = false, inSettings = false }: { compact?: boolean; inSettings?: boolean }) {
  const tk = useTokens();
  const st = useWorkspaceStatus();
  useTick();
  const s = summary(st);
  const note = { font: `12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary, margin: 0 };
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' };
  const [showAll, setShowAll] = useState(false);
  const a = attention(st);

  const intro = (
    <p style={note}>
      A folder (on this computer or an external drive) where your graphs, presentations, GLSL shaders, functions, presets, scripts and backgrounds live as real files.
      The desktop app and Chrome/Edge can both use the same folder. Settings stay with each app.
    </p>
  );

  if (st.support === 'none' && st.state === 'off') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: inSettings ? 0 : compact ? '14px 12px 40px' : '24px 28px 48px', maxWidth: 760 }}>
        {!inSettings && <h2 style={{ margin: 0, font: `650 18px ${fontFamily.ui}`, color: tk.text.primary }}>Workspace folder</h2>}
        {intro}
        <Card>
          <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Not available in this browser</span>
          <p style={note}>Safari, Firefox and phones can’t keep a folder in sync. Your work stays in this browser as before; use Download everything (and Install) on the Files page to move it. Chrome, Edge or the desktop app can use a workspace folder.</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: inSettings ? 0 : compact ? '14px 12px 40px' : '24px 28px 48px', maxWidth: 760 }}>
      {!inSettings && <h2 style={{ margin: 0, font: `650 18px ${fontFamily.ui}`, color: tk.text.primary }}>Workspace folder</h2>}
      {st.state === 'off' ? (
        <>
          {intro}
          <Card>
            <p style={note}>
              When you choose one, everything saved here is written into it and what’s already in it comes in; nothing is removed from either.
              From then on, changes go both ways a moment after they happen. If the folder is on a drive you unplug, the app keeps working and catches up when it’s back.
            </p>
            <div style={row}>
              {st.support === 'desktop' && st.suggested && <Button size="sm" variant="primary" icon="folder" onClick={() => { void connectSuggestedFolder(); }} title={st.suggested}>Use Documents/Shader Studio</Button>}
              <Button size="sm" variant={st.support === 'desktop' ? 'secondary' : 'primary'} icon="folder" onClick={() => { void chooseWorkspaceFolder(); }}>Choose a folder…</Button>
            </div>
            {st.support === 'browser' && <p style={{ ...note, color: tk.text.faint, fontSize: 11.5 }}>Chrome and Edge ask for your OK again after the page is reloaded: one click on “Reconnect workspace”.</p>}
          </Card>
          {st.legacy && (
            <Card>
              <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Your backup folder</span>
              <p style={note}>Playfield has been keeping a backup copy in <b style={{ wordBreak: 'break-all' }}>{st.legacy.label}</b>. It can become the workspace: its old backup files (library.json, history/) are left as they are. Until you choose a workspace, the backup copy keeps being updated.</p>
              <div style={row}><Button size="sm" icon="folder" onClick={() => { void connectLegacyFolder(); }}>Use it as the workspace</Button></div>
            </Card>
          )}
        </>
      ) : (
        <>
          {a && !inSettings && a.action && (
            <Card tone="warn">
              <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{a.title}</span>
              {a.message && <p style={note}>{a.message}</p>}
              <div style={row}>
                <Button size="sm" variant="primary" onClick={a.action.run}>{a.action.label}</Button>
                {a.second && <Button size="sm" onClick={a.second.run}>{a.second.label}</Button>}
              </div>
            </Card>
          )}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ marginTop: 5 }}><Dot tone={s.tone} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ font: `600 13px ${fontFamily.mono}`, color: tk.text.primary, wordBreak: 'break-all' }}>{st.folder}</span>
                <span style={{ font: `12px ${fontFamily.ui}`, color: s.tone === 'warn' || s.tone === 'bad' ? tk.status.warningText : tk.text.muted }}>{s.line}</span>
              </span>
            </div>
            <div style={row}>
              {st.state === 'needs-permission'
                ? <Button size="sm" variant="primary" icon="link" onClick={() => { void reconnectWorkspace(); }}>Reconnect workspace</Button>
                : <Button size="sm" icon="rebuild" disabled={st.state === 'syncing' || st.state === 'connecting'} onClick={() => { void syncWorkspaceNow(); }}>Sync now</Button>}
              <Button size="sm" variant="ghost" icon="folder" onClick={() => { void chooseWorkspaceFolder(); }}>Change…</Button>
              {st.support === 'desktop' && <Button size="sm" variant="ghost" icon="popout" onClick={() => { void revealWorkspace(); }}>Open in Finder</Button>}
              <Button size="sm" variant="ghost" icon="unlink" onClick={() => { void disconnectWorkspace(); }} title="Stop syncing. Everything stays here and in the folder.">Disconnect</Button>
            </div>
          </Card>

          {st.conflicts.length > 0 && (
            <Section title="Conflicts" hint={plural(st.conflicts.length, 'to decide')}>
              {st.conflicts.map(c => <ConflictRow key={c.id} c={c} />)}
            </Section>
          )}

          {(!inSettings || st.pending.length > 0) && <Section title="Waiting to sync" hint={st.pending.length ? plural(st.pending.length, 'change') : undefined}>
            {st.pending.length === 0 ? <p style={{ ...note, color: tk.text.faint }}>Nothing: this app and the folder match.</p> : (
              <div style={{ borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
                {(showAll ? st.pending : st.pending.slice(0, 8)).map((p, i) => (
                  <div key={p.path} title={p.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: i ? `1px solid ${tk.border.subtle}` : 0, font: `12px ${fontFamily.ui}` }}>
                    <span style={{ color: p.action === 'delete' ? tk.status.danger : tk.accent.text, width: 52, flexShrink: 0, fontWeight: 600, fontSize: 11 }}>{p.action === 'delete' ? 'Remove' : 'Write'}</span>
                    <span style={{ color: tk.text.muted, width: 150, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.kindLabel}</span>
                    <span style={{ flex: 1, minWidth: 0, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                  </div>
                ))}
                {st.pending.length > 8 && (
                  <button type="button" onClick={() => setShowAll(v => !v)} style={{ width: '100%', padding: '7px 12px', border: 0, borderTop: `1px solid ${tk.border.subtle}`, background: 'none', color: tk.accent.text, font: `500 12px ${fontFamily.ui}`, textAlign: 'left', cursor: 'pointer' }}>
                    {showAll ? 'Show fewer' : `Show all ${st.pending.length}`}
                  </button>
                )}
              </div>
            )}
          </Section>}

          {st.problems.length > 0 && (
            <Section title="Files skipped" hint="Fix or remove them in the folder; they’re tried again when they change">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {st.problems.slice(0, 12).map(p => <code key={p} style={{ font: `11.5px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, wordBreak: 'break-all' }}>{p}</code>)}
              </div>
            </Section>
          )}

          {!inSettings && (
            <Section title="In the folder">
              <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 240px) 1fr', gap: compact ? 2 : '4px 16px', font: `12px/1.5 ${fontFamily.ui}`, color: tk.text.secondary }}>
                {LAYOUT.map(([p, what]) => <FolderLine key={p} path={p} what={what} compact={compact} />)}
              </div>
              <p style={{ ...note, color: tk.text.faint, fontSize: 11.5 }}>Sub-folders are your folders in the app. Theme, camera, learned roles, sign-ins and other settings aren’t in the folder. Files you add in Finder come in; anything else in the folder is left alone.</p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

const LAYOUT: Array<[string, string]> = [
  ['graphs/', 'Graphs with their Play setups, takes and datasets (.graph.json); earlier versions in graphs/.versions/'],
  ['presentations/', 'Presentations (.present.json)'],
  ['glsl/', 'GLSL shaders (.glsl) with their notes beside them'],
  ['functions/', 'Custom functions and the Function Builder’s'],
  ['presets/', 'Group, expression, transform, keyframe and palette presets'],
  ['published-nodes/', 'Node types you published'],
  ['scripts/', 'Saved sketches and layer kinds'],
  ['backgrounds/', 'Background images and palettes'],
];

function FolderLine({ path, what, compact }: { path: string; what: string; compact: boolean }) {
  const tk = useTokens();
  return <>
    <span style={{ font: `12px ${fontFamily.mono}`, color: tk.text.primary, marginTop: compact ? 6 : 0 }}>{path}</span>
    <span>{what}</span>
  </>;
}
