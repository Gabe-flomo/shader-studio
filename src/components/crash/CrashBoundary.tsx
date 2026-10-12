/**
 * CrashBoundary — the app's outermost error boundary (docs/crash-recovery.md
 * "Crash reports"). A render error that would blank the whole page writes a
 * crash report, marks the session as crashed, and shows a plain page with
 * Reload: the reload offers to recover the last autosave. Plain styles only:
 * the theme may be what broke.
 */
import React, { type ErrorInfo } from 'react';
import { useCrashSim } from './crashSim';

function Bomb() {
  const bomb = useCrashSim(s => s.bomb);
  if (bomb) throw new Error('Simulated fatal render error (dev helper: simulateCrash("js-fatal"))');
  return null;
}

interface State { error: Error | null; saved: boolean }

export class CrashBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, saved: false };
  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Playfield stopped: a render error reached the top of the app.', error, info.componentStack);
    void import('../../files/recovery').then(m => m.crashPage('js-fatal', {
      message: `${error.name}: ${error.message}`,
      stack: `${error.stack ?? ''}\n\nComponent stack:${info.componentStack ?? ''}`,
    }, { reload: false })).then(() => this.setState({ saved: true })).catch(() => { /* the page still offers Reload */ });
  }
  render() {
    if (!this.state.error) return <>{this.props.children}<Bomb /></>;
    const dark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
    const fg = dark ? '#eee' : '#222', muted = dark ? '#aaa' : '#666', bg = dark ? '#18181b' : '#fafafa';
    return (
      <div role="alert" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color: fg, font: '14px/1.5 -apple-system, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 460, padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong style={{ fontSize: 17 }}>Playfield hit an error and stopped</strong>
          <span style={{ color: muted }}>
            Reload to carry on: you’ll be offered the last autosave of your project.
            {this.state.saved ? ' A crash report was saved (Files → App settings → Crash reports).' : ''}
          </span>
          <code style={{ fontSize: 12, color: muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{this.state.error.message}</code>
          <button type="button" onClick={() => location.reload()} autoFocus
            style={{ alignSelf: 'flex-start', marginTop: 6, padding: '7px 14px', borderRadius: 8, border: 0, background: '#4f6bed', color: '#fff', font: '600 13px system-ui', cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
