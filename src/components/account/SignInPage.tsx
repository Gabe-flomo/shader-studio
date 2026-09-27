/**
 * The sign-in page the gate shows before the app mounts (src/auth/gate.ts,
 * docs/sign-in-gate.md). Username + password, Enter submits, "Stay signed in".
 */
import { useState, type FormEvent } from 'react';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { GateUser } from '../../auth/gate';

export function SignInPage({ onSignIn }: {
  /** Checks the credentials; resolves with the user, or null for a wrong login. */
  onSignIn: (username: string, password: string, stay: boolean) => Promise<GateUser | null>;
}) {
  const tk = useTokens();
  const mode = useThemeStore(s => s.mode);
  const toggleTheme = useThemeStore(s => s.toggle);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [stay, setStay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    setError(null);
    try {
      const user = await onSignIn(username, password, stay);
      if (!user) { setError('That username and password don’t match. Check both and try again.'); setPassword(''); }
    } catch {
      setError('Couldn’t check that sign-in in this browser. Try another browser.');
    } finally {
      setBusy(false);
    }
  };

  const label = (text: string, htmlFor: string) => (
    <label htmlFor={htmlFor} style={{ color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}` }}>{text}</label>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto', background: tk.bg.app, color: tk.text.primary, font: `13px ${fontFamily.ui}`,
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
        <IconButton icon={mode === 'light' ? 'moon' : 'sun'} label={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} onClick={toggleTheme} />
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 16px 48px' }}>
        <form
          onSubmit={submit}
          aria-label="Sign in"
          style={{
            width: '100%', maxWidth: 380, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14,
            padding: '28px 24px 24px', borderRadius: radius.modal, background: tk.bg.panel, boxShadow: tk.shadow.card,
            border: `1px solid ${tk.border.default}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ width: 32, height: 32, borderRadius: radius.md, background: tk.ink.base, color: tk.ink.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="presets" size={16} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>Playfield</span>
          </div>
          <div>
            <h1 style={{ margin: 0, font: `650 20px/1.25 ${fontFamily.ui}`, letterSpacing: '-0.015em' }}>Sign in</h1>
            <p style={{ margin: '4px 0 0', color: tk.text.muted, font: `12.5px/1.5 ${fontFamily.ui}` }}>Playfield is invite-only for now. Use the username and password you were given.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {label('Username', 'gate-username')}
            <Field
              id="gate-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              height={40}
              value={username}
              invalid={!!error}
              onChange={e => { setUsername(e.target.value); setError(null); }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {label('Password', 'gate-password')}
            <Field
              id="gate-password"
              name="password"
              type="password"
              autoComplete="current-password"
              height={40}
              value={password}
              invalid={!!error}
              onChange={e => { setPassword(e.target.value); setError(null); }}
            />
          </div>

          {error && (
            <div role="alert" style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: radius.md,
              background: alpha(tk.status.danger, 0.1), color: tk.text.primary, font: `12.5px/1.45 ${fontFamily.ui}`,
            }}>
              <Icon name="alert" size={15} style={{ color: tk.status.danger, flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <Toggle checked={stay} onChange={setStay} label="Stay signed in on this device" />

          <Button type="submit" variant="primary" disabled={busy} style={{ height: 40, width: '100%', fontSize: 13.5 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
