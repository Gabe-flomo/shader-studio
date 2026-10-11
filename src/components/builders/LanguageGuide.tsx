/**
 * LanguageGuide — a dialect's words as documentation (docs/playfield-language.md, "Help in the
 * app"), from lang/help.ts: sections (for a 3D scene: Modes, Combine, Shapes, Warps, Settings,
 * Camera, Colours, Output), each with a short plain description first. Opening a section lists its
 * words with one line each; clicking a word shows what it is and means, its settings with their
 * types and ranges, and an example line to use or to watch built step by step (Show me how).
 *
 * Sections start folded (each remembered in this browser); a search finds a word in any of them.
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { helpSections, type HelpEntry } from '../../lang/help';
import type { Dialect } from '../../lang/registry';
import { HelpCard } from './WordHelp';
import { openShowHow } from '../../suggestions/showHowStore';

const KEY = (d: Dialect) => `languageGuide.${d}.open`;
const readOpen = (d: Dialect): string[] => { try { return JSON.parse(localStorage.getItem(KEY(d)) ?? '[]') as string[]; } catch { return []; } };
const writeOpen = (d: Dialect, ids: string[]) => { try { localStorage.setItem(KEY(d), JSON.stringify(ids)); } catch { /* this session only */ } };

/** Dialects whose examples can be built and shown step by step. */
const SHOWS_HOW: Dialect[] = ['scene', 'picture', 'edit', 'pass'];

export function LanguageGuide({ dialect, onUse, title = 'The words' }: { dialect: Dialect; onUse?: (example: string) => void; title?: string }) {
  const tk = useTokens();
  const sections = useMemo(() => helpSections(dialect), [dialect]);
  const [open, setOpenState] = useState<string[]>(() => readOpen(dialect));
  const [picked, setPicked] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const toggle = (id: string) => setOpenState(o => { const next = o.includes(id) ? o.filter(x => x !== id) : [...o, id]; writeOpen(dialect, next); return next; });
  const query = q.trim().toLowerCase();
  const matches = (e: HelpEntry) => !query || e.word.includes(query) || e.aliases.some(a => a.includes(query)) || e.summary.toLowerCase().includes(query) || e.params.some(p => p.key === query);
  return (
    <div data-language-guide={dialect} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: radius.control, background: tk.bg.subtle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{title}</b>
        <span style={{ flex: 1, font: `11.5px ${fontFamily.ui}`, color: tk.text.muted }}>Rest the pointer on a word in the recipe to see its help there.</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a word…" aria-label="Find a word" data-language-guide-search
          style={{ width: 150, height: 26, padding: '0 8px', borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />
      </div>
      {sections.map(s => {
        const list = s.entries.filter(matches);
        if (!list.length) return null;
        const isOpen = !!query || open.includes(s.id);
        return (
          <section key={s.id} data-guide-section={s.id} style={{ borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(s.id)} data-guide-section-toggle={s.id}
              style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'flex-start', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', padding: '8px 10px', color: tk.text.primary }}>
              <Icon name={isOpen ? 'chevD' : 'chevR'} size={13} style={{ marginTop: 2, color: tk.text.faint, flexShrink: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ font: `600 13px ${fontFamily.ui}` }}>{s.title} <span style={{ fontWeight: 400, color: tk.text.faint, fontSize: 11.5 }}>{s.entries.length}</span></span>
                <span style={{ font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.muted }}>{s.blurb}</span>
              </span>
            </button>
            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', padding: '0 6px 8px 28px', gap: 1 }}>
                {list.map(e => (
                  <div key={e.id} data-guide-entry={e.id}>
                    <button type="button" aria-expanded={picked === e.id} onClick={() => setPicked(p => (p === e.id ? null : e.id))}
                      style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'baseline', textAlign: 'left', border: 0, cursor: 'pointer', padding: '3px 6px', borderRadius: radius.sm, background: picked === e.id ? alpha(tk.accent.base, 0.1) : 'transparent', color: tk.text.primary }}>
                      <code style={{ font: `600 12px ${fontFamily.mono}`, color: tk.accent.text, minWidth: 110, flexShrink: 0 }}>{e.word}</code>
                      <span style={{ font: `12px ${fontFamily.ui}`, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: picked === e.id ? 'normal' : 'nowrap', minWidth: 0 }}>{e.summary}</span>
                    </button>
                    {picked === e.id && (
                      <div style={{ margin: '4px 0 8px 6px', padding: '10px 12px', borderRadius: radius.md, background: tk.bg.subtle }}>
                        <HelpCard dialect={dialect} entry={e} onExample={onUse} />
                        {SHOWS_HOW.includes(dialect) && (
                          <button type="button" data-guide-show-how onClick={() => openShowHow({ text: e.example, dialect })}
                            style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.md, padding: '4px 10px', cursor: 'pointer', font: `500 12px ${fontFamily.ui}` }}>
                            <Icon name="play" size={12} /> Show me how
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
