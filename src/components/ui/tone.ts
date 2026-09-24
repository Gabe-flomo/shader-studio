import type { Tokens } from '../../theme/tokens';
import type { IconName } from './iconPaths';

export type Tone = 'danger' | 'warning' | 'info' | 'success';

export function toneStyle(tk: Tokens, tone: Tone): { color: string; icon: IconName } {
  switch (tone) {
    case 'danger': return { color: tk.status.danger, icon: 'alert' };
    case 'warning': return { color: tk.status.warning, icon: 'warning' };
    case 'success': return { color: tk.status.success, icon: 'check' };
    default: return { color: tk.accent.base, icon: 'info' };
  }
}
