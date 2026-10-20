/**
 * NodeInfoCard — a node's full definition (the card's ⓘ → "Sockets and wiring"): what it does,
 * its inputs, outputs and settings, each described. Long definitions (Segment has 24 entries) are
 * read by progressive disclosure, nothing left out:
 *
 *   - a one- or two-sentence summary leads; the rest of the description sits behind "More";
 *   - Inputs / Outputs / Settings fold, folded ones showing a count and the names. The first one
 *     starts open, the others folded, and what you choose is remembered per section (sectionFold);
 *   - each entry is a compact row: a dot in its wire colour, the name, a type chip (or the range,
 *     or a select's choices), and its description on one line. Click (or Enter) opens the row to
 *     the full text, a select's choices as chips and when the setting shows; hovering shows the
 *     full text too;
 *   - settings keep their card sections (Segment's Find / Mask) as small headings;
 *   - with more than 10 entries a filter box narrows every section at once;
 *   - "Used in" lists a few examples that use the node.
 *
 * The pieces (DocSummary, DocRow) are shared with the node browsers so the docs read the same there.
 */
import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { NodeDefinition, ParamDef, ShowWhen } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { useSectionOpen } from '../../builders/sectionFold';
import { plainLine, splitSummary } from '../../lib/docSummary';
import { examplesForType } from '../../store/exampleNodeIndex';
import { DocText } from '../ui/DocText';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { TYPE_COLORS } from './typeColors';
import { ExamplesStrip } from './ExampleLinks';

/** Above this many entries the card offers a filter box. */
export const FILTER_THRESHOLD = 10;
/** Up to this many entries, every section is shown open (nothing worth folding). */
export const ALWAYS_OPEN_MAX = 6;
/** A select's choices fit in its chip when their labels are this short together. */
const CHOICES_IN_CHIP = 26;

// ── Summary ──────────────────────────────────────────────────────────────────

/** A description's first sentence(s), the rest behind "More". */
export function DocSummary({ text, style, fontSize = 12 }: { text: string; style?: React.CSSProperties; fontSize?: number }) {
  const tk = useTokens();
  const { summary, rest } = useMemo(() => splitSummary(text), [text]);
  const [more, setMore] = useState(false);
  if (!summary) return null;
  return (
    <div data-doc-summary="" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize, color: tk.text.secondary, ...style }}>
      <DocText text={summary} style={{ color: tk.text.primary, fontWeight: 500 }} />
      {rest && more && <DocText text={rest} style={{ color: tk.text.muted }} />}
      {rest && (
        <button type="button" data-doc-more="" aria-expanded={more} onClick={() => setMore(m => !m)}
          style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: '1px 0', cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
          {more ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface DocEntry {
  key: string;
  label: string;
  /** Wire colour of a socket; a setting (no wire) gets a ring instead. */
  dot?: string;
  /** Type, range or choices, as a small chip. */
  chip?: string;
  hint?: string;
  /** A select's choices, shown as chips when the row is open. */
  options?: { label: string; hint?: string }[];
  /** When the setting shows on the card ("Shown when Find is Click"). */
  when?: string;
  /** Live value on the right (an input's wire or value, an output's probe). */
  extra?: ReactNode;
  /** Card section it belongs to (settings only). */
  group?: string;
}

/** One entry: dot, name, chip, its description on one line; opens to the full text. */
export function DocRow({ entry, labelColor }: { entry: DocEntry; labelColor?: string }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const line = plainLine(entry.hint);
  const expandable = !!entry.hint || !!entry.options?.length || !!entry.when;
  const head = (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span aria-hidden style={entry.dot
          ? { width: 7, height: 7, borderRadius: '50%', background: entry.dot, flexShrink: 0 }
          : { width: 7, height: 7, borderRadius: '50%', boxShadow: `inset 0 0 0 1.5px ${tk.text.faint}`, flexShrink: 0, boxSizing: 'border-box' }} />
        <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: labelColor ?? tk.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{entry.label}</span>
        {entry.chip && (
          <span data-doc-chip="" style={{
            font: `500 10px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.field, borderRadius: radius.xs,
            padding: '1px 5px', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{entry.chip}</span>
        )}
        <span style={{ flex: 1 }} />
        {entry.extra && <span style={{ flexShrink: 0, display: 'inline-flex' }}>{entry.extra}</span>}
        {expandable && <Icon name={open ? 'chevU' : 'chevD'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />}
      </span>
      {line && !open && (
        <span data-doc-line="" style={{ display: 'block', paddingLeft: 13, color: tk.text.muted, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</span>
      )}
    </>
  );
  const rowStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 1, width: '100%', boxSizing: 'border-box', textAlign: 'left',
    padding: '4px 6px', border: 0, borderRadius: radius.sm, background: open ? tk.bg.hover : 'transparent', color: 'inherit', font: 'inherit',
  };
  return (
    <div data-doc-row={entry.key} style={{ display: 'flex', flexDirection: 'column' }}>
      {expandable ? (
        <button type="button" aria-expanded={open} title={open ? undefined : line || undefined} onClick={() => setOpen(o => !o)}
          style={{ ...rowStyle, cursor: 'pointer' }}>{head}</button>
      ) : <div style={rowStyle}>{head}</div>}
      {open && (
        <div data-doc-detail="" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 6px 8px 19px', fontSize: 11.5, color: tk.text.secondary }}>
          {entry.hint && <DocText text={entry.hint} />}
          {!!entry.options?.length && (
            <div data-doc-options="" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {entry.options.map(o => (
                <span key={o.label} title={o.hint} style={{
                  font: `500 10.5px ${fontFamily.ui}`, padding: '2px 7px', borderRadius: 999, color: tk.text.secondary,
                  boxShadow: `inset 0 0 0 1px ${tk.border.strong}`, background: tk.bg.panel,
                }}>{o.label}</span>
              ))}
            </div>
          )}
          {entry.when && <span style={{ color: tk.text.faint, fontSize: 11 }}>{entry.when}</span>}
        </div>
      )}
    </div>
  );
}

// ── Building the entries ─────────────────────────────────────────────────────

function rangeOf(pd: ParamDef | undefined): string | undefined {
  if (!pd || pd.min === undefined || pd.max === undefined) return undefined;
  return `${pd.min} – ${pd.max}`;
}

function chipOfParam(pd: ParamDef): string | undefined {
  if (pd.type === 'select' && pd.options?.length) {
    const joined = pd.options.map(o => o.label).join(' · ');
    return joined.length <= CHOICES_IN_CHIP ? joined : `${pd.options.length} choices`;
  }
  if (pd.type === 'bool') return 'on / off';
  if (pd.type === 'vec3color') return 'colour';
  if (pd.trigger) return 'button';
  return rangeOf(pd) ?? (pd.type === 'string' ? 'text' : pd.type === 'vec3' ? 'vec3' : undefined);
}

/** "Shown when Find is Click" from a param's showWhen, in the other param's own words. */
export function whenText(sw: ShowWhen | undefined, paramDefs: Record<string, ParamDef> | undefined): string | undefined {
  if (!sw) return undefined;
  const parts: string[] = [];
  for (let s: ShowWhen | undefined = sw; s; s = s.and) {
    const other = paramDefs?.[s.param];
    const name = other?.label ?? s.param;
    const vals = (Array.isArray(s.value) ? s.value : [s.value]).map(v => other?.options?.find(o => o.value === v)?.label ?? (v === 'true' ? 'on' : v === 'false' ? 'off' : v));
    parts.push(`${name} is ${vals.join(' or ')}`);
  }
  return `Shown when ${parts.join(' and ')}.`;
}

export interface NodeInfoEntries { inputs: DocEntry[]; outputs: DocEntry[]; settings: DocEntry[] }

/** The card's three lists for a definition. Settings are the slider/select params that aren't sockets and are documented. */
export function nodeInfoEntries(
  def: NodeDefinition,
  outputs: NodeDefinition['outputs'] = def.outputs,
  extras: { inputs?: Record<string, ReactNode>; outputs?: Record<string, ReactNode> } = {},
): NodeInfoEntries {
  const pds = def.paramDefs ?? {};
  const onDemand = def.brief && def.socketsOnDemand ? def.socketsOnDemand : undefined;
  const inputs = Object.entries(def.inputs)
    .filter(([k]) => !onDemand || !(k in onDemand))
    .map(([k, s]): DocEntry => {
      const range = rangeOf(pds[k]);
      return { key: k, label: s.label, dot: TYPE_COLORS[s.type] ?? '#888', chip: range ? `${s.type} ${range}` : s.type, hint: s.hint, extra: extras.inputs?.[k] };
    });
  const outs = Object.entries(outputs).map(([k, s]): DocEntry => ({
    key: k, label: s.label, dot: TYPE_COLORS[s.type] ?? '#888', chip: s.type, hint: s.hint, extra: extras.outputs?.[k],
  }));
  const settings = Object.entries(pds)
    .filter(([k, pd]) => !(k in def.inputs) && (pd.hint || (pd.type === 'select' && pd.options?.length)))
    .map(([k, pd]): DocEntry => ({
      key: k, label: pd.label, chip: chipOfParam(pd), hint: pd.hint,
      options: pd.type === 'select' ? pd.options?.map(o => ({ label: o.label, hint: o.hint })) : undefined,
      when: whenText(pd.showWhen, pds), group: pd.section,
    }));
  return { inputs, outputs: outs, settings };
}

function matches(e: DocEntry, q: string): boolean {
  return `${e.label} ${e.key} ${e.chip ?? ''} ${e.hint ?? ''} ${(e.options ?? []).map(o => o.label).join(' ')}`.toLowerCase().includes(q);
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Section({ id, title, count, summary, primary, forceOpen, children }: {
  id: string; title: string; count?: number; summary?: string; primary: boolean; forceOpen?: boolean; children: ReactNode;
}) {
  const tk = useTokens();
  const [stored, setOpen] = useSectionOpen(`node-info:${id}`, primary);
  const open = forceOpen || stored;
  return (
    <section data-info-section={id} data-open={open ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${tk.border.subtle}` }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} disabled={forceOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 4px', border: 0, borderRadius: radius.sm, background: 'none', cursor: forceOpen ? 'default' : 'pointer', color: 'inherit', textAlign: 'left', minWidth: 0 }}>
        {!forceOpen && <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />}
        <span style={{ font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.muted, flexShrink: 0 }}>{title}</span>
        {count !== undefined && (
          <span data-section-count="" style={{ font: `600 10px ${fontFamily.ui}`, color: tk.text.faint, background: tk.bg.field, borderRadius: 999, padding: '0 6px', lineHeight: '16px', flexShrink: 0 }}>{count}</span>
        )}
        {!open && summary && (
          <span style={{ flex: 1, minWidth: 0, color: tk.text.faint, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
        )}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 8 }}>{children}</div>}
    </section>
  );
}

function names(entries: DocEntry[]): string {
  return entries.map(e => e.label).join(', ');
}

// ── The card ─────────────────────────────────────────────────────────────────

export interface NodeInfoBodyProps {
  def: NodeDefinition;
  /** The node's own outputs when they differ from the definition's (a Custom Function's). */
  outputs?: NodeDefinition['outputs'];
  extras?: { inputs?: Record<string, ReactNode>; outputs?: Record<string, ReactNode> };
  /** Title shown in the header (a renamed node's label). */
  title?: string;
  onClose?: () => void;
  /** Called when an example from "Used in" opens. */
  onExampleOpened?: () => void;
}

/** The card's content: sticky header, summary, folding sections, Used in. Bounded height, scrolls inside. */
export function NodeInfoBody({ def, outputs, extras, title, onClose, onExampleOpened }: NodeInfoBodyProps) {
  const tk = useTokens();
  const [query, setQuery] = useState('');
  const { inputs, outputs: outs, settings } = useMemo(() => nodeInfoEntries(def, outputs, extras), [def, outputs, extras]);
  const total = inputs.length + outs.length + settings.length;
  const q = query.trim().toLowerCase();
  const filter = (list: DocEntry[]) => (q ? list.filter(e => matches(e, q)) : list);
  const fIn = filter(inputs), fOut = filter(outs), fSet = filter(settings);
  const description = def.brief ? def.brief.summary : Array.isArray(def.description) ? (def.description as string[]).join('\n') : def.description;
  const hits = useMemo(() => examplesForType(def.type, 6), [def.type]);
  const sectionIds = [def.brief ? 'start' : null, inputs.length ? 'inputs' : null, outs.length ? 'outputs' : null, settings.length ? 'settings' : null].filter(Boolean);
  const primary = sectionIds[0];
  // A small node's few entries are all shown; a long one's sections fold. A filter opens every section.
  const forceOpen = !!q || total <= ALWAYS_OPEN_MAX;

  // Settings in their card sections, in the order they first appear.
  const groups: { name?: string; rows: DocEntry[] }[] = [];
  for (const e of fSet) {
    const g = groups.find(x => x.name === e.group);
    if (g) g.rows.push(e); else groups.push({ name: e.group, rows: [e] });
  }

  return (
    <div role="dialog" aria-label={`${title ?? def.label}: node info`} data-node-info={def.type}
      style={{ display: 'flex', flexDirection: 'column', maxHeight: 'min(560px, calc(100dvh - 16px))', font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.primary }}>
      <div data-node-info-head="" style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 14px', background: tk.bg.panel, borderBottom: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
        <Icon name="info" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title ?? def.label}</span>
        <span style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.text.faint, whiteSpace: 'nowrap', flexShrink: 0 }}>{def.category}</span>
        {onClose && <IconButton icon="close" label="Close node info" size="sm" onClick={onClose} />}
      </div>
      <div data-node-info-body="" style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '10px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {description && <DocSummary text={description} />}
        {total > FILTER_THRESHOLD && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 28, borderRadius: radius.md - 1, background: tk.bg.field }}>
            <Icon name="search" size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <input data-node-info-filter="" type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={`Filter ${total} inputs, outputs and settings`} aria-label="Filter inputs, outputs and settings"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />
          </label>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {def.brief && !q && (
            <Section id="start" title="How to start" primary={primary === 'start'}>
              <DocText text={def.brief.start.map(s => `- ${s}`).join('\n')} style={{ color: tk.text.secondary, fontSize: 11.5, padding: '0 6px' }} />
            </Section>
          )}
          {fIn.length > 0 && (
            <Section id="inputs" title="Inputs" count={q ? fIn.length : inputs.length} summary={names(fIn)} primary={primary === 'inputs'} forceOpen={forceOpen}>
              {fIn.map(e => <DocRow key={e.key} entry={e} />)}
              {def.brief && <span style={{ color: tk.text.faint, fontSize: 11, padding: '4px 6px 0' }}>Right-click a setting → Control from outside to give it a socket too.</span>}
            </Section>
          )}
          {fOut.length > 0 && (
            <Section id="outputs" title="Outputs" count={q ? fOut.length : outs.length} summary={names(fOut)} primary={primary === 'outputs'} forceOpen={forceOpen}>
              {fOut.map(e => <DocRow key={e.key} entry={e} />)}
            </Section>
          )}
          {fSet.length > 0 && (
            <Section id="settings" title="Settings" count={q ? fSet.length : settings.length} summary={names(fSet)} primary={primary === 'settings'} forceOpen={forceOpen}>
              {groups.map((g, i) => (
                <div key={g.name ?? `_${i}`} data-settings-group={g.name ?? ''} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {g.name && groups.length > 1 && (
                    <span style={{ font: `600 11px ${fontFamily.ui}`, color: tk.text.faint, padding: i === 0 ? '0 6px 2px' : '8px 6px 2px' }}>{g.name}</span>
                  )}
                  {g.rows.map(e => <DocRow key={e.key} entry={e} />)}
                </div>
              ))}
            </Section>
          )}
          {q && !fIn.length && !fOut.length && !fSet.length && (
            <span data-node-info-empty="" style={{ color: tk.text.faint, fontSize: 11.5, padding: '6px 2px' }}>Nothing matches “{query.trim()}”.</span>
          )}
          {def.glslFunction && !q && (
            <Section id="glsl" title="GLSL" primary={false}>
              <pre style={{
                background: tk.bg.field, borderRadius: radius.sm, padding: '6px 8px', fontSize: 10.5, color: tk.text.secondary, margin: 0,
                maxHeight: 160, overflow: 'auto', whiteSpace: 'pre', fontFamily: fontFamily.mono,
              }}>{def.glslFunction.slice(0, 500)}</pre>
            </Section>
          )}
          {def.brief && !q && <span style={{ color: tk.text.faint, fontSize: 11, paddingTop: 6 }}>Hover a setting’s ? on the card for what it does.</span>}
        </div>
        {hits.length > 0 && !q && (
          <div style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 2 }}>
            <ExamplesStrip id="node-info-used-in" hits={hits} title="Used in" layout="list" show={3} hideTypes onOpened={onExampleOpened} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The card as a pop-up beside the node (`clearRef`), kept on screen; Esc or a click outside closes it. */
export function NodeInfoCard({ anchorRef, clearRef, onClose, ...body }: NodeInfoBodyProps & {
  anchorRef: RefObject<HTMLElement | null>;
  clearRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const focused = useRef(false);
  return (
    <Popover anchorRef={anchorRef} clearRef={clearRef} onClose={onClose} width={380} padding={0} keepInView>
      <div ref={el => { if (el && !focused.current) { focused.current = true; el.focus({ preventScroll: true }); } }} tabIndex={-1} style={{ outline: 'none' }}
        onKeyDown={e => e.stopPropagation()}>
        <NodeInfoBody {...body} onClose={onClose} />
      </div>
    </Popover>
  );
}

