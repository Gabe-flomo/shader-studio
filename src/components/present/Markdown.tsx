/**
 * Markdown — a block's text rendered with present/markdown.ts (loaded with
 * the page, KaTeX and all; see useMarkdown.ts), styled by presentCss.ts.
 *
 * Chips (`[[control:id]]`) are buttons in the HTML; this component turns
 * hovering and clicking them into onChipHover / onChip, so an interactive
 * block can light up and nudge the slider the text is talking about.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { useMarkdownModule } from './useMarkdown';

export const Markdown = memo(function Markdown({ text, controls, layers, hot, onChip, onChipHover, size = 'md', placeholder }: {
  text: string;
  controls?: Readonly<Record<string, string>>;
  layers?: Readonly<Record<string, string>>;
  /** The control whose chips are lit. */
  hot?: string | null;
  onChip?: (id: string) => void;
  onChipHover?: (id: string | null) => void;
  size?: 'md' | 'lg';
  placeholder?: string;
}) {
  const md = useMarkdownModule();
  const html = useMemo(() => (md && text.trim() ? md.renderMarkdown(text, { controls, layers }) : ''), [md, text, controls, layers]);
  const ref = useRef<HTMLDivElement>(null);
  // Light the chips that name the hot control.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('.pp-chip[data-control]').forEach(el => el.classList.toggle('pp-on', !!hot && el.dataset.control === hot));
  }, [hot, html]);
  const chipOf = (e: React.SyntheticEvent) => (e.target as HTMLElement).closest?.('[data-control]')?.getAttribute('data-control') ?? null;
  if (!text.trim()) return placeholder ? <div className="pp-md pp-placeholder">{placeholder}</div> : null;
  if (!md) return <div className="pp-md pp-loading" aria-busy="true">{text.slice(0, 400)}</div>;
  return (
    <div
      ref={ref}
      className={`pp-md${size === 'lg' ? ' pp-lg' : ''}`}
      onClick={e => { const id = chipOf(e); if (id && onChip) { e.stopPropagation(); onChip(id); } }}
      onMouseOver={e => onChipHover?.(chipOf(e))}
      onMouseLeave={() => onChipHover?.(null)}
      // The HTML comes from markdown-it with raw HTML turned off, and KaTeX with trust off.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
