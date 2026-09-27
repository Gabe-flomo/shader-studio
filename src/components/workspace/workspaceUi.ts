/**
 * workspaceUi.ts — small shared bits of the workspace UI: asking the Files
 * page for its Workspace view, and the one-line status.
 */
import { whenSaved } from '../../store/graphVersions';
import type { WorkspaceStatus } from '../../workspace/workspace';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ask the Files page to show the Workspace view (read when it opens, or heard when it's open). */
export const OPEN_WORKSPACE_VIEW = 'open-workspace-view';
let wanted = false;
export function openWorkspaceView(): void {
  wanted = true;
  window.dispatchEvent(new Event('open-files-page'));
  window.dispatchEvent(new Event(OPEN_WORKSPACE_VIEW));
}
export function takeWorkspaceViewRequest(): boolean { const w = wanted; wanted = false; return w; }

export type Tone = 'ok' | 'busy' | 'warn' | 'bad' | 'off';

/** One line about the workspace, and how it's doing. */
export function summary(st: WorkspaceStatus): { tone: Tone; short: string; line: string } {
  const waiting = st.pending.length ? ` · ${plural(st.pending.length, 'change')} waiting to sync` : '';
  const conflicts = st.conflicts.length ? ` · ${plural(st.conflicts.length, 'conflict')} to decide` : '';
  switch (st.state) {
    case 'off': return { tone: 'off', short: 'No workspace', line: st.support === 'none' ? 'Not available in this browser' : 'No workspace folder' };
    case 'connecting': return { tone: 'busy', short: 'Connecting…', line: 'Connecting…' };
    case 'syncing': return { tone: 'busy', short: 'Syncing…', line: `Syncing…${conflicts}` };
    case 'synced': return { tone: st.conflicts.length ? 'warn' : 'ok', short: st.conflicts.length ? plural(st.conflicts.length, 'conflict') : st.pending.length ? `${st.pending.length} waiting` : 'Synced', line: `${st.lastSyncAt ? `Synced ${whenSaved(st.lastSyncAt)}` : 'Synced'}${waiting}${conflicts}` };
    case 'offline': return { tone: 'warn', short: 'Not connected', line: `Not connected${waiting}` };
    case 'needs-permission': return { tone: 'warn', short: 'Reconnect', line: `Needs your OK to use the folder again${waiting}` };
    case 'not-workspace': return { tone: 'warn', short: 'Not connected', line: 'This folder isn’t the workspace' };
    case 'held': return { tone: 'warn', short: 'Waiting for you', line: `${plural(st.held, 'thing')} gone from the folder: waiting for your OK` };
    case 'error': return { tone: 'bad', short: 'Sync problem', line: `Sync problem${waiting}` };
  }
}

