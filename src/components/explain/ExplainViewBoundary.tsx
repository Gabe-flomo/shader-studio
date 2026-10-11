/**
 * Keeps a failure inside the explain view to the view: a line it can't show says so, with Back to
 * the lines, instead of taking the whole app down (there is no boundary above it). The error is
 * logged for a bug report. Keyed by the line shown, so another line starts fresh.
 */
import React, { type ErrorInfo } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';

interface Props { onBack: () => void; children: React.ReactNode }

export class ExplainViewBoundary extends React.Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The explain view failed on this line; the block is untouched.', error, info.componentStack);
  }
  render() {
    return this.state.error ? <Failed error={this.state.error} onBack={this.props.onBack} /> : this.props.children;
  }
}

function Failed({ error, onBack }: { error: Error; onBack: () => void }) {
  const tk = useTokens();
  return (
    <div role="alert" data-explain-view-failed="" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, maxWidth: 520 }}>
      <span style={{ font: `600 13px ${fontFamily.ui}`, color: tk.text.primary }}>The explain view couldn’t show this line.</span>
      <span style={{ font: `500 12px/1.5 ${fontFamily.ui}`, color: tk.text.muted }}>Nothing in the block was changed. The details: {error.message || String(error)}</span>
      <button type="button" data-explain-action="back" onClick={onBack}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px 0 6px', border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `600 12px ${fontFamily.ui}` }}>
        <Icon name="chevL" size={13} />Lines
      </button>
    </div>
  );
}
