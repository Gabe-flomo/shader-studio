/**
 * BuilderHelp — the builders' built-in guidance, shared by every BuilderWindow (helpContent.ts
 * holds the words):
 *
 *  - <BuilderHelp id>: a "how this works" card for a section, with worked examples to click.
 *    "Got it" dismisses it; dismissals are remembered per builder.
 *  - <EmptyHelp id>: the same for an empty state (an empty rule list, a scene with no shapes). It
 *    never disappears entirely: with tips off it folds to one line.
 *  - <HintMark text>: the "?" every control's hint hangs on (hover or focus shows it).
 *  - <TipsToggle>: the header's "Tips" switch; turning tips back on brings dismissed cards back.
 *
 * A BuilderWindow tells its children which builder they are in (BuilderHelpContext), so a new
 * builder only has to add its entries to helpContent.ts.
 */
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { helpFor, type HelpExample, type HelpEntry } from './helpContent';

/** Which builder the help belongs to (BuilderWindow's prefsKey). */
export const BuilderHelpContext = createContext<string>('');

// ── Tips state: on/off and dismissals, per builder, in localStorage ─────────────

const listeners = new Set<() => void>();
let version = 0;
const bump = () => { version++; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* kept for this session only */ }
}
const memory = new Map<string, string | null>();
const get = (key: string) => (memory.has(key) ? memory.get(key)! : read(key));
const put = (key: string, v: string | null) => { memory.set(key, v); write(key, v); bump(); };

export function tipsOn(builder: string): boolean { return get(`builder:${builder}:tips`) !== '0'; }
export function setTipsOn(builder: string, on: boolean): void {
  put(`builder:${builder}:tips`, on ? '1' : '0');
  if (on) put(`builder:${builder}:tips:dismissed`, null);
}
export function dismissedTips(builder: string): string[] {
  try { return JSON.parse(get(`builder:${builder}:tips:dismissed`) ?? '[]') as string[]; } catch { return []; }
}
export function dismissTip(builder: string, id: string): void {
  put(`builder:${builder}:tips:dismissed`, JSON.stringify([...new Set([...dismissedTips(builder), id])]));
}

export function useTips(builder?: string) {
  const ctx = useContext(BuilderHelpContext);
  const b = builder ?? ctx;
  useSyncExternalStore(subscribe, () => version, () => version);
  return { builder: b, on: tipsOn(b), dismissed: dismissedTips(b), setOn: (v: boolean) => setTipsOn(b, v), dismiss: (id: string) => dismissTip(b, id) };
}

// ── The pieces ───────────────────────────────────────────────────────────────

/** The consistent "?": hover or focus shows the hint. */
export function HintMark({ text, style }: { text: string; style?: React.CSSProperties }) {
  const tk = useTokens();
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, ...style }}>
      <span role="img" tabIndex={0} aria-label={`Help: ${text}`} title={text} data-hint={text}
        onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)}
        style={{
          width: 14, height: 14, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help',
          font: `700 9.5px ${fontFamily.ui}`, color: tk.text.faint, boxShadow: `inset 0 0 0 1px ${tk.border.strong}`, userSelect: 'none',
        }}>?</span>
      {show && (
        <span role="tooltip" style={{
          position: 'absolute', left: 18, top: -4, zIndex: 20, width: 240, padding: '6px 8px', borderRadius: radius.md, pointerEvents: 'none',
          background: tk.bg.panel, color: tk.text.secondary, boxShadow: tk.shadow.popover, font: `12px/1.4 ${fontFamily.ui}`, whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0, fontWeight: 400,
        }}>{text}</span>
      )}
    </span>
  );
}

/** A label with its "?" (nothing extra when there is no hint). */
export function HintLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {hint && <HintMark text={hint} />}
    </span>
  );
}

function Examples({ examples, onExample }: { examples: HelpExample[]; onExample?: (ex: HelpExample) => void }) {
  const tk = useTokens();
  if (!examples.length || !onExample) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: tk.text.faint }}>Try:</span>
      {examples.map(ex => (
        <button key={ex.label} type="button" data-help-example={ex.label} onClick={() => onExample(ex)}
          title={'recipe' in ex.insert ? `Adds: ${ex.insert.recipe}` : 'Insert this example'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, cursor: 'pointer', padding: '3px 9px', borderRadius: radius.md,
            background: tk.bg.panel, color: tk.accent.text, font: `500 12px ${fontFamily.ui}`, boxShadow: `inset 0 0 0 1px ${tk.border.default}`,
          }}>
          <Icon name="plus" size={12} />{ex.label}
          {'recipe' in ex.insert && <code style={{ font: `11px ${fontFamily.mono}`, color: tk.text.faint }}>{ex.insert.recipe}</code>}
        </button>
      ))}
    </div>
  );
}

function Card({ entry, id, onExample, onDismiss, compact }: { entry: HelpEntry; id: string; onExample?: (ex: HelpExample) => void; onDismiss?: () => void; compact?: boolean }) {
  const tk = useTokens();
  return (
    <div data-builder-help={id} style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: radius.control, flexShrink: 0,
      background: alpha(tk.accent.base, 0.06), boxShadow: `inset 0 0 0 1px ${alpha(tk.accent.base, 0.18)}`, color: tk.text.secondary,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="info" size={13} style={{ color: tk.accent.base, flexShrink: 0 }} />
        <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, flex: 1 }}>{compact ? entry.title : `How this works: ${entry.title}`}</b>
        {onDismiss && (
          <button type="button" onClick={onDismiss} data-help-dismiss title="Hide this tip (Tips in the header brings it back)"
            style={{ border: 0, background: 'none', cursor: 'pointer', color: tk.text.faint, font: `500 11.5px ${fontFamily.ui}` }}>Got it</button>
        )}
      </div>
      {(compact ? entry.lines.slice(0, 1) : entry.lines).map((l, i) => <span key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>{l}</span>)}
      {entry.examples && <Examples examples={entry.examples} onExample={onExample} />}
    </div>
  );
}

/** A section's "how this works" (hidden once dismissed, or while tips are off). */
export function BuilderHelp({ id, onExample, builder }: { id: string; onExample?: (ex: HelpExample) => void; builder?: string }) {
  const tips = useTips(builder);
  const entry = helpFor(tips.builder, id);
  if (!entry || !tips.on || tips.dismissed.includes(id)) return null;
  return <Card entry={entry} id={id} onExample={onExample} onDismiss={() => tips.dismiss(id)} />;
}

/** An empty state's guidance: the full card with tips on, one line and its examples with tips off. */
export function EmptyHelp({ id, onExample, builder }: { id: string; onExample?: (ex: HelpExample) => void; builder?: string }) {
  const tips = useTips(builder);
  const entry = helpFor(tips.builder, id);
  if (!entry) return null;
  return <Card entry={entry} id={`empty:${id}`} onExample={onExample} compact={!tips.on || tips.dismissed.includes(id)} />;
}

/** The header's Tips switch. */
export function TipsToggle({ builder }: { builder: string }) {
  const tk = useTokens();
  const tips = useTips(builder);
  return (
    <button type="button" aria-pressed={tips.on} data-tips-toggle onClick={() => tips.setOn(!tips.on)}
      title={tips.on ? 'Hide the "how this works" tips' : 'Show tips: brings back every tip you dismissed'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', marginRight: 4, border: 0, borderRadius: radius.md, cursor: 'pointer',
        background: tips.on ? tk.bg.selected : 'none', color: tips.on ? tk.accent.text : tk.text.secondary, font: `600 12.5px ${fontFamily.ui}`,
        boxShadow: tips.on ? `inset 0 0 0 1px ${tk.border.default}` : 'none',
      }}>
      <Icon name="info" size={14} />{tips.on ? 'Tips' : 'Show tips'}
    </button>
  );
}
