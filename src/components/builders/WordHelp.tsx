/**
 * WordHelp — help that comes from the word (docs/playfield-language.md, "Help in the app"): rest
 * the pointer on a keyword, a setting or a value of a recipe for a moment and its help opens
 * right there, anchored at the word. The pointer can move into it, scroll it and pick from it:
 * another mode, another of the setting's choices, another colour. lang/help.ts says what the word
 * is (helpAt) and when the help opens and closes (hoverIntent).
 *
 *  - useWordHelp({ dialect, onReplace }): feed it `hover(text, offset, rect)` as the pointer moves
 *    over a text (and `leave()`), and `tap(...)` the same on a touch tap or caret placement (it
 *    opens at once, and a tap elsewhere closes it); render its `popover`.
 *  - <HelpCard>: the help itself (an entry, a setting or a value), also used by the Language guide.
 *  - inputOffsetAt: the character under the pointer in a one-line input (the Do… bar).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { portalGuard } from '../ui/portalGuard';
import { helpAt, helpSections, hoverIntent, type Alternative, type HelpAt, type HelpEntry, type HelpParam } from '../../lang/help';
import type { Dialect } from '../../lang/registry';
import { RecipeCode } from '../sceneBuilder/RecipeCode';
import { wordKindFor } from '../../lang/highlight';

/** Where a word is on screen. */
export interface WordRect { left: number; top: number; bottom: number }

const WIDTH = 380;

/** A value of the right kind, as a chip. */
function Chip({ a, onPick, current }: { a: Alternative; onPick?: (text: string) => void; current?: boolean }) {
  const tk = useTokens();
  const style: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 11, border: `1px solid ${current ? tk.accent.base : tk.border.subtle}`,
    background: current ? alpha(tk.accent.base, 0.12) : tk.bg.subtle, color: tk.text.primary, font: `11.5px ${fontFamily.mono}`, cursor: onPick ? 'pointer' : 'default',
  };
  const dot = a.swatch && <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: `rgb(${a.swatch.map(x => Math.round(x * 255)).join(',')})`, boxShadow: `inset 0 0 0 1px ${tk.border.strong}` }} />;
  return onPick
    ? <button type="button" data-help-alt={a.text} style={style} title={`Use ${a.text}`} onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }} onClick={e => { e.stopPropagation(); onPick(a.text); }}>{dot}{a.text}</button>
    : <span style={style}>{dot}{a.text}</span>;
}

/** One setting: key, type, range and default, and what it does. */
export function ParamRow({ p, active }: { p: HelpParam; active?: boolean }) {
  const tk = useTokens();
  return (
    <div data-help-param={p.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(64px, auto) 1fr', gap: '1px 10px', padding: '4px 6px', borderRadius: radius.sm, background: active ? alpha(tk.accent.base, 0.1) : 'transparent' }}>
      <code style={{ font: `600 12px ${fontFamily.mono}`, color: tk.accent.text }}>{p.primary ? `[${p.key}]` : `${p.key}=`}</code>
      <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted }}>
        <b style={{ fontWeight: 600, color: tk.text.secondary }}>{p.type}</b>
        {p.range && <> · {p.range}</>}
        {p.def !== undefined && <> · default {p.def}</>}
      </span>
      <span />
      <span style={{ font: `12px/1.4 ${fontFamily.ui}`, color: tk.text.secondary }}>{p.hint}{p.aliases.length > 0 && <span style={{ color: tk.text.faint }}> (also {p.aliases.join(', ')})</span>}</span>
    </div>
  );
}

const sectionTitle = (d: Dialect, id: string) => helpSections(d).find(s => s.id === id)?.title ?? id;

/** The help for an entry, a setting or a value. `onPick` replaces the word with an alternative. */
export function HelpCard({ dialect, entry, param, kind = 'entry', alternatives = [], word, onPick, onExample, compact = false }: {
  dialect: Dialect; entry: HelpEntry; param?: HelpParam; kind?: HelpAt['kind']; alternatives?: Alternative[]; word?: string;
  onPick?: (text: string) => void; onExample?: (text: string) => void; compact?: boolean;
}) {
  const tk = useTokens();
  const wordKind = useMemo(() => (dialect === 'scene' ? undefined : wordKindFor(dialect, 'edit')), [dialect]);
  const label = (t: string) => <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>{t}</span>;
  const alts = alternatives.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label(kind === 'entry' ? `Other ${sectionTitle(dialect, entry.section).toLowerCase()}` : param?.type === 'colour' ? 'Other colours' : 'Its choices')}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {word && <Chip a={{ text: word, swatch: alternatives.find(a => a.text === word)?.swatch }} current />}
        {alternatives.map(a => <Chip key={a.text} a={a} onPick={onPick} />)}
      </div>
    </div>
  );
  if (param && kind !== 'entry') {
    return (
      <div data-help-card="param" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <code style={{ font: `700 13px ${fontFamily.mono}`, color: tk.accent.text }}>{param.key}</code>
          <span style={{ font: `12px ${fontFamily.ui}`, color: tk.text.muted }}>a setting of <code style={{ fontFamily: fontFamily.mono }}>{entry.word}</code></span>
        </span>
        <ParamRow p={param} active />
        {alts}
        {!compact && <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.faint }}>{entry.title}: {entry.summary}</span>}
      </div>
    );
  }
  return (
    <div data-help-card="entry" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <code style={{ font: `700 13.5px ${fontFamily.mono}`, color: tk.accent.text }}>{entry.word}</code>
        {entry.title.toLowerCase() !== entry.word.replace(/-/g, ' ') && <b style={{ font: `600 12.5px ${fontFamily.ui}` }}>{entry.title}</b>}
        <span style={{ padding: '1px 7px', borderRadius: 9, background: tk.bg.subtle, font: `500 10.5px ${fontFamily.ui}`, color: tk.text.muted }}>{sectionTitle(dialect, entry.section)}</span>
      </span>
      <span style={{ font: `12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary }}>{entry.more}</span>
      {entry.aliases.length > 0 && <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.faint }}>Also: {entry.aliases.slice(0, 8).join(', ')}</span>}
      {entry.params.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {label('Settings')}
          {entry.params.map(p => <ParamRow key={p.key} p={p} active={p.key === param?.key} />)}
        </div>
      )}
      {entry.example && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {label('Example')}
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code data-help-example style={{ flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: radius.sm, background: tk.bg.subtle, font: `12px/1.5 ${fontFamily.mono}`, overflowWrap: 'anywhere' }}>
              <RecipeCode text={entry.example} errors={[]} wordKind={wordKind} />
            </code>
            {onExample && <button type="button" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }} onClick={e => { e.stopPropagation(); onExample(entry.example); }}
              style={{ border: 0, background: 'transparent', color: tk.accent.text, font: `500 11.5px ${fontFamily.ui}`, cursor: 'pointer', padding: '2px 4px' }}>Use</button>}
          </span>
        </div>
      )}
      {alts}
    </div>
  );
}

/** The help as a popover at a word: below it, or above when there is no room. */
export function HelpPopover({ dialect, at, rect, onPick, onEnter, onLeave, children }: {
  dialect: Dialect; at: HelpAt; rect: WordRect; onPick?: (text: string) => void; onEnter: () => void; onLeave: () => void; children?: ReactNode;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth, vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const below = vh - rect.bottom > 260 || rect.top < vh / 2;
  const maxH = Math.max(160, Math.min(380, below ? vh - rect.bottom - 16 : rect.top - 16));
  const left = Math.max(8, Math.min(rect.left - 10, vw - WIDTH - 8));
  return createPortal(
    <div {...portalGuard} ref={ref} role="tooltip" data-word-help={at.word} onMouseEnter={onEnter} onMouseLeave={onLeave}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, ...(below ? { top: rect.bottom + 6 } : { bottom: vh - rect.top + 6 }), zIndex: 2200, width: WIDTH, maxWidth: 'calc(100vw - 16px)', maxHeight: maxH,
        overflowY: 'auto', overscrollBehavior: 'contain', padding: '10px 12px', borderRadius: radius.md, background: tk.bg.panel, color: tk.text.primary,
        border: `1px solid ${tk.border.default}`, boxShadow: tk.shadow.popover, boxSizing: 'border-box',
      }}>
      <HelpCard dialect={dialect} entry={at.entry} param={at.param} kind={at.kind} alternatives={at.alternatives} word={at.word} onPick={onPick} compact />
      {children}
    </div>,
    document.body,
  );
}

/**
 * Hover help over a text: call `hover(text, offset, rect)` as the pointer moves (rect: where the
 * word under it is), `leave()` when it leaves; render `popover`. `onReplace(from, to, text)` puts
 * an alternative in the word's place (no picking without it).
 */
export function useWordHelp({ dialect, onReplace }: { dialect: Dialect; onReplace?: (from: number, to: number, text: string) => void }) {
  const [open, setOpen] = useState<{ at: HelpAt; rect: WordRect } | null>(null);
  const intent = useMemo(() => hoverIntent<{ at: HelpAt; rect: WordRect }>({ onOpen: t => setOpen(t), onClose: () => setOpen(null) }), []);
  useEffect(() => () => intent.dispose(), [intent]);
  // Escape closes it; so does typing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); intent.close(); } else if (e.key.length === 1) intent.close(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, intent]);
  const hover = (text: string, offset: number | null, rectOf: (from: number, to: number) => WordRect | null) => {
    if (offset === null) { intent.out(); return; }
    const at = helpAt(dialect, text, offset);
    if (!at) { intent.out(); return; }
    const rect = rectOf(at.from, at.to);
    if (!rect) { intent.out(); return; }
    intent.over(`${at.from}:${at.word}:${at.kind}`, { at, rect });
  };
  // A tap, or the caret placed on a word (a touch screen has no hover): its help opens straight away.
  const tap = (text: string, offset: number | null, rectOf: (from: number, to: number) => WordRect | null) => {
    const at = offset === null ? null : helpAt(dialect, text, offset);
    const rect = at && rectOf(at.from, at.to);
    if (!at || !rect) { intent.close(); return; }
    intent.openNow(`${at.from}:${at.word}:${at.kind}`, { at, rect });
  };
  // Opened by a tap, it closes on a tap anywhere else (there is no pointer leaving to close it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (!(e.target as Element | null)?.closest?.('[data-word-help]')) intent.close();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, intent]);
  const popover = open ? (
    <HelpPopover dialect={dialect} at={open.at} rect={open.rect} onEnter={() => intent.enterPopover()} onLeave={() => intent.leavePopover()}
      onPick={onReplace ? text => { onReplace(open.at.from, open.at.to, text); intent.close(); } : undefined} />
  ) : null;
  return { hover, tap, leave: () => intent.out(), close: () => intent.close(), popover, open: !!open };
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** The character under `clientX` in a one-line input (its own font and scroll), or null past the text. */
export function inputOffsetAt(el: HTMLInputElement, clientX: number): { offset: number; rectOf: (from: number, to: number) => WordRect } | null {
  const cs = getComputedStyle(el);
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  if (!ctx) return null;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const r = el.getBoundingClientRect();
  const x0 = r.left + parseFloat(cs.paddingLeft || '0') - el.scrollLeft;
  const x = clientX - x0;
  const text = el.value;
  if (x < 0) return null;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ctx.measureText(text.slice(0, mid + 1)).width <= x) lo = mid + 1; else hi = mid; }
  if (lo >= text.length) return null;
  return {
    offset: lo,
    rectOf: from => ({ left: x0 + ctx.measureText(text.slice(0, from)).width, top: r.top, bottom: r.bottom }),
  };
}
