/**
 * tasteUi.tsx — small shared pieces of the Taste page (docs/taste.md "The Taste page"): a collapsible
 * section with a summary (folded by default except the primary one, remembered per section), a signed bar,
 * a sureness pill, and words for signal kinds and times.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { Sureness } from '../../taste/summary';

const OPEN_KEY = 'shader-studio:taste-page:open';
const readOpen = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; } };
const writeOpen = (v: Record<string, boolean>) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)); } catch { /* this visit only */ } };

/** A section that folds: title, a one-line summary, remembered open or closed. */
export function Section({ id, title, summary, primary = false, children, icon }: { id: string; title: string; summary: ReactNode; primary?: boolean; children: ReactNode; icon?: Parameters<typeof Icon>[0]['name'] }) {
  const tk = useTokens();
  const [open, setOpen] = useState(() => readOpen()[id] ?? primary);
  const toggle = () => setOpen(o => { const next = !o; writeOpen({ ...readOpen(), [id]: next }); return next; });
  return (
    <section aria-label={title} data-taste-section={id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" aria-expanded={open} onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 30, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
        {icon && <Icon name={icon} size={14} style={{ color: tk.text.muted }} />}
        <span style={{ font: `650 13.5px ${fontFamily.ui}` }}>{title}</span>
        <span style={{ fontSize: 12, color: tk.text.faint, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
      </button>
      {open && children}
    </section>
  );
}

export function Card({ children, pad = 14, style }: { children: ReactNode; pad?: number; style?: React.CSSProperties }) {
  const tk = useTokens();
  return <div style={{ background: tk.bg.panel, borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, padding: pad, ...style }}>{children}</div>;
}

/** A small bar from the middle: right and green for a like, left and red for a dislike. Segments stack (profile, here, steering). */
export function SignedBar({ parts, max = 1.5, width = 120 }: { parts: Array<{ v: number; tone: 'profile' | 'local' | 'steer' }>; max?: number; width?: number }) {
  const tk = useTokens();
  const colour = { profile: tk.accent.base, local: tk.status.success, steer: tk.status.warning };
  const half = width / 2;
  // Where each segment starts: likes stack rightwards from the middle, dislikes leftwards.
  const segs: Array<{ left: number; len: number; v: number; tone: 'profile' | 'local' | 'steer' }> = [];
  let pos = 0, neg = 0;
  for (const p of parts) {
    const len = Math.min(half, (Math.abs(p.v) / max) * half);
    if (len < 0.5) continue;
    segs.push({ left: p.v >= 0 ? half + pos : half - neg - len, len, v: p.v, tone: p.tone });
    if (p.v >= 0) pos += len; else neg += len;
  }
  return (
    <span aria-hidden style={{ position: 'relative', width, height: 8, borderRadius: 4, background: tk.bg.field, flexShrink: 0, overflow: 'hidden' }}>
      <span style={{ position: 'absolute', left: half - 0.5, top: 0, bottom: 0, width: 1, background: tk.border.strong }} />
      {segs.map((p, i) => <span key={i} style={{ position: 'absolute', top: 1, bottom: 1, left: Math.max(0, p.left), width: p.len, background: p.tone === 'local' ? (p.v >= 0 ? colour.local : tk.status.danger) : colour[p.tone], borderRadius: 2, opacity: p.tone === 'local' ? 1 : 0.8 }} />)}
    </span>
  );
}

export function SurePill({ sure }: { sure: Sureness }) {
  const tk = useTokens();
  const c = sure === 'sure' ? tk.status.success : sure === 'fairly sure' ? tk.accent.base : tk.text.faint;
  return <span data-sure={sure} style={{ font: `600 10.5px ${fontFamily.ui}`, padding: '1px 7px', borderRadius: 999, background: alpha(c, 0.13), color: c, whiteSpace: 'nowrap' }}>{sure}</span>;
}

/** A tiny pill. */
export function Pill({ children, tone = 'muted', onClick, title, active }: { children: ReactNode; tone?: 'muted' | 'good' | 'bad' | 'accent' | 'warn'; onClick?: () => void; title?: string; active?: boolean }) {
  const tk = useTokens();
  const c = tone === 'good' ? tk.status.success : tone === 'bad' ? tk.status.danger : tone === 'accent' ? tk.accent.base : tone === 'warn' ? tk.status.warning : tk.text.muted;
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, font: `500 11px ${fontFamily.ui}`, padding: '2px 8px', borderRadius: 999, border: 0,
    background: active ? alpha(c, 0.22) : alpha(c, 0.1), color: c, whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default',
    boxShadow: active ? `inset 0 0 0 1px ${alpha(c, 0.6)}` : 'none',
  };
  return onClick ? <button type="button" title={title} onClick={onClick} style={style} aria-pressed={active}>{children}</button> : <span title={title} style={style}>{children}</span>;
}
