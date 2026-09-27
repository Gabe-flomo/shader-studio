/**
 * What's new: the release notes (src/changelog/releases.ts), newest first. The newest release
 * (and any this device hadn't seen) starts open, older ones folded. Opening the view marks
 * everything seen, which clears the dot on History.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { RELEASES, type Release, type ReleaseArea, type ReleaseLink } from '../../changelog/releases';
import { sortReleases, unreadReleases, useWhatsNew } from '../../changelog/releaseNotes';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { EXAMPLE_INDEX } from '../../store/exampleIndex';
import { openExternal } from '../../utils/openExternal';
import type { Page } from '../page';

const REPO_DOCS = 'https://github.com/Gabe-flomo/shader-studio/blob/main/';

const PAGE_LABEL: Partial<Record<Page, string>> = { studio: 'Studio', play: 'Play', present: 'Present', files: 'Files', glsl: 'GLSL', fn: 'Function Builder', convert: 'Convert', shortcuts: 'Keys' };

function areaColor(tk: Tokens, area: ReleaseArea): string {
  switch (area) {
    case 'Studio': return tk.accent.text;
    case 'Play': return tk.kind.expr;
    case 'Present': return tk.status.warningText;
    case 'Learn': return tk.kind.fn;
    case 'Files': return tk.status.success;
    case 'Account': return tk.status.danger;
    default: return tk.text.muted;
  }
}

/** Ask App to switch page (and close a phone sheet). */
const goToPage = (page: Page) => window.dispatchEvent(new CustomEvent('open-page', { detail: page }));

function linkLabel(link: ReleaseLink): string {
  if (link.label) return link.label;
  if (link.kind === 'doc') return 'Read more';
  if (link.kind === 'page') return `Open ${PAGE_LABEL[link.page] ?? link.page}`;
  return 'Try the example';
}

function linkTitle(link: ReleaseLink): string | undefined {
  if (link.kind === 'example') return EXAMPLE_INDEX[link.key]?.label ? `Opens “${EXAMPLE_INDEX[link.key].label}” (replaces the open graph)` : undefined;
  if (link.kind === 'doc') return `${link.path} on GitHub`;
  return undefined;
}

async function follow(link: ReleaseLink): Promise<void> {
  if (link.kind === 'page') { goToPage(link.page); return; }
  if (link.kind === 'example') {
    await useNodeGraphStore.getState().loadExampleGraph(link.key);
    goToPage(link.page ?? 'studio');
  }
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function WhatsNewView({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const releases = sortReleases(RELEASES);
  // What was new when the view opened keeps its "New" tag while it's on screen.
  const [fresh] = useState(() => new Set(unreadReleases(useWhatsNew.getState().seen).map(r => r.id)));
  const [open, setOpen] = useState<Set<string>>(() => new Set([releases[0]?.id, ...fresh].filter(Boolean) as string[]));
  useEffect(() => { useWhatsNew.getState().markSeen(); }, []);
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <div style={{ padding: '2px 4px 2px', color: tk.text.faint, fontSize: 11.5, lineHeight: 1.4 }}>
        What changed in each update, newest first.
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {releases.map(r => (
          <ReleaseCard key={r.id} r={r} open={open.has(r.id)} isNew={fresh.has(r.id)} onToggle={() => toggle(r.id)} compact={compact} />
        ))}
      </ol>
    </div>
  );
}

function ReleaseCard({ r, open, isNew, onToggle, compact }: { r: Release; open: boolean; isNew: boolean; onToggle: () => void; compact: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <li style={{ borderRadius: radius.md, border: `1px solid ${open ? tk.border.default : 'transparent'}`, background: open ? tk.bg.panel : 'transparent' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '100%', border: 0, cursor: 'pointer', textAlign: 'left', borderRadius: radius.md,
          background: !open && hover ? tk.bg.hover : 'transparent',
          padding: compact ? '10px 8px' : '8px 8px', display: 'flex', alignItems: 'flex-start', gap: 6,
        }}
      >
        <Icon name={open ? 'chevD' : 'chevR'} size={13} style={{ color: tk.text.faint, marginTop: 2, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: `600 ${compact ? 13.5 : 12.5}px/1.35 ${fontFamily.ui}`, color: tk.text.primary, overflowWrap: 'anywhere' }}>{r.title}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${fontFamily.ui}`, color: tk.text.faint }}>
            {isNew && <span style={{ height: 15, padding: '0 5px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', background: alpha(tk.accent.base, 0.14), color: tk.accent.text, font: `600 10px ${fontFamily.ui}` }}>New</span>}
            <span>{formatDate(r.date)}</span>
            <span aria-hidden>·</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.id}</span>
            {!open && <><span aria-hidden>·</span><span>{r.highlights.length} {r.highlights.length === 1 ? 'change' : 'changes'}</span></>}
          </span>
        </span>
      </button>
      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: `0 10px ${compact ? 12 : 10}px 27px`, display: 'flex', flexDirection: 'column', gap: compact ? 10 : 8 }}>
          {r.highlights.map((h, i) => (
            <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, font: `${compact ? 13 : 12}px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <AreaChip area={h.area} />{' '}{h.text}
              </span>
              {h.link && <HighlightLink link={h.link} compact={compact} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AreaChip({ area }: { area: ReleaseArea }) {
  const tk = useTokens();
  const c = areaColor(tk, area);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 6px', marginRight: 2, borderRadius: 4, verticalAlign: '1px',
      background: alpha(c.startsWith('#') ? c : tk.text.muted, 0.13), color: c, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.02em',
    }}>{area}</span>
  );
}

function HighlightLink({ link, compact }: { link: ReleaseLink; compact: boolean }) {
  const tk = useTokens();
  const style = {
    alignSelf: 'flex-start', border: 0, background: 'none', padding: compact ? '4px 0' : 0, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4, color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, textDecoration: 'none',
  } as const;
  const content: ReactNode = <>{linkLabel(link)}<Icon name={link.kind === 'doc' ? 'popout' : 'chevR'} size={11} /></>;
  if (link.kind === 'doc') {
    const url = REPO_DOCS + link.path;
    return <a href={url} target="_blank" rel="noopener noreferrer" title={linkTitle(link)} style={style} onClick={e => openExternal(url, e)}>{content}</a>;
  }
  return <button type="button" title={linkTitle(link)} style={style} onClick={() => { void follow(link); }}>{content}</button>;
}
