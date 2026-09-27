/**
 * The right side of the Files page: where you are (breadcrumbs), what it is
 * (size, when, where it's stored, what uses it and what it uses), and what is
 * inside it, as a list to open, tick and act on.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { formatSize } from '../../utils/library';
import { countLeaves, type FileNode, type Inventory } from '../../files/inventory';
import { ownerId as ownerOf } from '../../files/cleanup';
import { Check, IconTile, Size, SizeBar } from './fileUi';
import { capsLabel, KIND_LABELS, when } from './fileUiShared';


export type CheckState = 'on' | 'off' | 'mixed' | 'inherited';

/** Parts of an item that only hold other parts: their page is their list. */
const PART_GROUPS = new Set(['play', 'takes', 'datasets', 'versions', 'layerKinds']);

export function Breadcrumbs({ path, onOpen, compact }: { path: FileNode[]; onOpen: (id: string | null) => void; compact?: boolean }) {
  const tk = useTokens();
  const crumb = (label: string, onClick: (() => void) | null, key: string, last: boolean) => (
    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, flexShrink: last ? 1 : 0 }}>
      {onClick ? (
        <button type="button" onClick={onClick} style={{ border: 0, background: 'none', padding: '2px 4px', borderRadius: 5, cursor: 'pointer', color: tk.text.muted, font: `500 12px ${fontFamily.ui}`, whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</button>
      ) : (
        <span aria-current="page" style={{ padding: '2px 4px', color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{label}</span>
      )}
      {!last && <Icon name="chevR" size={11} style={{ color: tk.text.disabled, flexShrink: 0 }} />}
    </span>
  );
  // On a phone the middle collapses to "…" so the trail stays one line.
  const shown = compact && path.length > 3 ? [path[0], null, ...path.slice(-2)] : path;
  return (
    <nav aria-label="Where you are" style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
      {compact && crumb('Files', path.length ? () => onOpen(null) : null, 'root', path.length === 0)}
      {shown.map((n, i) => n
        ? crumb(n.label, i === shown.length - 1 ? null : () => onOpen(n.id), n.id, i === shown.length - 1)
        : <span key="gap" style={{ color: tk.text.faint, padding: '0 3px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>…<Icon name="chevR" size={11} style={{ color: tk.text.disabled }} /></span>)}
    </nav>
  );
}

export function NodeView({ inv, node, compact, checkState, onCheck, onOpen, onMenu, actions }: {
  inv: Inventory;
  node: FileNode;
  compact: boolean;
  checkState: (id: string) => CheckState;
  onCheck: (id: string, on: boolean) => void;
  onOpen: (id: string) => void;
  onMenu: (node: FileNode, at: { x: number; y: number }) => void;
  /** Buttons for what you'd do with this one thing (open, download, remove). */
  actions?: ReactNode;
}) {
  const tk = useTokens();
  const kids = node.children ?? [];
  const isContainer = node.kind === 'section' || node.kind === 'group' || node.kind === 'folder';
  const max = Math.max(1, ...kids.map(k => k.size));
  const itemCount = countLeaves(kids);
  const allState = kids.length ? (kids.every(k => ['on', 'inherited'].includes(checkState(k.id))) ? 'on' : kids.some(k => checkState(k.id) !== 'off') ? 'mixed' : 'off') : 'off';
  const nodeState = checkState(node.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: compact ? '14px 12px 40px' : '22px 28px 48px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      {/* What it is */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <IconTile node={node} size={compact ? 36 : 42} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</h1>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
            {(isContainer
              ? [node.kind === 'section' || node.kind === 'group' ? '' : KIND_LABELS[node.kind], `${itemCount} item${itemCount === 1 ? '' : 's'}`, formatSize(node.size)]
              : [KIND_LABELS[node.kind], node.detail, formatSize(node.size), when(node.modified) && `saved ${when(node.modified)}`]
            ).filter(Boolean).join(' · ')}
          </span>
        </div>
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <IconButton icon="more" label={`More for ${node.label}`} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu(node, { x: r.right - 240, y: r.bottom + 4 }); }} />
        </span>
      </div>

      {actions && !isContainer && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: compact ? -4 : -6, paddingLeft: compact ? 0 : 54 }}>{actions}</div>}

      {node.unused && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.1), color: tk.status.warningText, font: `12px/1.45 ${fontFamily.ui}` }}>
          <Icon name="warning" size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span><b>Not used.</b> {node.unused}.</span>
        </div>
      )}

      {!isContainer && !PART_GROUPS.has(node.kind) && <Relations inv={inv} node={node} onOpen={onOpen} compact={compact} />}

      {/* What's inside */}
      {kids.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '0 2px' : '0 8px 0 4px' }}>
            <Check checked={allState === 'on' || nodeState === 'on' || nodeState === 'inherited'} mixed={allState === 'mixed'} disabled={nodeState === 'inherited'} label="Select all" onChange={on => { for (const k of kids) onCheck(k.id, on); }} />
            <span style={{ ...capsLabel(tk), flex: 1 }}>{isContainer ? 'Contents' : 'Inside'} · {kids.length}</span>
            {!compact && <span style={{ ...capsLabel(tk), width: 88, textAlign: 'right' }}>Size</span>}
            {!compact && <span style={{ ...capsLabel(tk), width: 104, textAlign: 'right' }}>Saved</span>}
            {!compact && <span style={{ width: 32 }} />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, background: tk.bg.panel, overflow: 'hidden' }}>
            {kids.map((k, i) => (
              <ItemRow key={k.id} node={k} max={max} first={i === 0} compact={compact} state={checkState(k.id)} onCheck={on => onCheck(k.id, on)} onOpen={() => onOpen(k.id)} onMenu={at => onMenu(k, at)} />
            ))}
          </div>
        </section>
      )}
      {kids.length === 0 && isContainer && (
        <div style={{ padding: '36px 16px', textAlign: 'center', color: tk.text.faint, fontSize: 12.5, borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
          {node.kind === 'folder' ? 'This folder is empty.' : 'Nothing saved here yet.'}
        </div>
      )}
    </div>
  );
}

function ItemRow({ node, max, first, compact, state, onCheck, onOpen, onMenu }: { node: FileNode; max: number; first: boolean; compact: boolean; state: CheckState; onCheck: (on: boolean) => void; onOpen: () => void; onMenu: (at: { x: number; y: number }) => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const used = node.usedBy?.length ?? 0;
  const breaks = node.usedBy?.some(u => u.breaks);
  const hasKids = !!node.children?.length;
  const isContainer = node.kind === 'folder' || node.kind === 'group';
  const detail = node.kind === 'folder' || (isContainer && !node.detail) ? `${countLeaves(node.children)} item${countLeaves(node.children) === 1 ? '' : 's'}` : node.detail;
  const sub = compact ? [detail, formatSize(node.size), isContainer ? '' : when(node.modified)].filter(Boolean).join(' · ') : detail;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: compact ? 56 : 52, padding: compact ? '6px 8px 6px 4px' : '6px 8px 6px 8px',
        borderTop: first ? 0 : `1px solid ${tk.border.subtle}`, cursor: 'pointer', outline: 'none',
        background: state === 'on' || state === 'inherited' ? alpha(tk.accent.base, 0.06) : hover ? tk.bg.hover : 'transparent',
      }}
    >
      <Check checked={state === 'on' || state === 'inherited'} mixed={state === 'mixed'} disabled={state === 'inherited'} label={`Select ${node.label}`} onChange={onCheck} />
      <IconTile node={node} size={compact ? 32 : 30} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ font: `600 13px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{node.label}</span>
          {node.unused && <Tag colour={tk.status.warningText} bg={alpha(tk.status.warning, 0.14)} title={node.unused}>Not used</Tag>}
          {!node.unused && used > 0 && !compact && <Tag colour={breaks ? tk.accent.text : tk.text.muted} bg={breaks ? alpha(tk.accent.base, 0.1) : tk.bg.field} title={node.usedBy!.map(u => `${u.label}${u.where ? ` (${u.where})` : ''}`).join('\n')}>Used by {used}</Tag>}
          {node.private && <Tag colour={tk.text.muted} bg={tk.bg.field}>Never downloaded</Tag>}
        </span>
        {sub && <span style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </div>
      {!compact && (
        <span style={{ width: 88, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <Size n={node.size} />
          <SizeBar value={node.size} max={max} />
        </span>
      )}
      {!compact && <span style={{ width: 104, textAlign: 'right', fontSize: 11.5, color: tk.text.faint, flexShrink: 0, whiteSpace: 'nowrap' }}>{isContainer ? '' : when(node.modified)}</span>}
      {!compact ? (
        <span style={{ width: 32, display: 'flex', justifyContent: 'center', flexShrink: 0, opacity: hover ? 1 : 0.0, transition: 'opacity 0.1s' }} onClick={e => e.stopPropagation()}>
          <IconButton icon="more" size="sm" label={`More for ${node.label}`} tooltip={false} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu({ x: r.right - 240, y: r.bottom + 4 }); }} />
        </span>
      ) : (
        <Icon name="chevR" size={14} style={{ color: hasKids ? tk.text.faint : tk.text.disabled, flexShrink: 0 }} />
      )}
    </div>
  );
}

function Tag({ children, colour, bg, title }: { children: ReactNode; colour: string; bg: string; title?: string }) {
  return <span title={title} style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 5, background: bg, color: colour, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{children}</span>;
}

/** Stored where, used by what, using what. */
function Relations({ inv, node, onOpen, compact }: { inv: Inventory; node: FileNode; onOpen: (id: string) => void; compact: boolean }) {
  const tk = useTokens();
  const where = node.ref?.t === 'key' ? node.ref.key : node.ref?.t === 'part' ? `inside ${node.ref.key}` : node.ref?.t === 'external' ? `${node.ref.source} (IndexedDB)` : null;
  const folder = node.membership ? inv.byId.get(inv.parentOf.get(node.id) ?? '') : undefined;
  const uses = (node.uses ?? []).map(id => inv.byId.get(id)).filter((n): n is FileNode => !!n);
  const owner = node.part ? inv.byId.get(ownerOf(inv, node.id)) : undefined;
  const facts: Array<[string, ReactNode]> = [
    ...(owner ? [['Part of', owner.label] as [string, ReactNode]] : []),
    ...(folder?.kind === 'folder' ? [['Folder', folder.label] as [string, ReactNode]] : []),
    ...(where ? [['Stored as', <code key="k" style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.secondary, overflowWrap: 'anywhere' }}>{where}</code>] as [string, ReactNode]] : []),
  ];
  const card = { borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, background: tk.bg.panel, padding: compact ? '12px 12px' : '14px 16px' };
  // A part nothing points at (a take, a version) has no "used by" worth a card.
  const showUse = !node.part || !!node.usedBy?.length || uses.length > 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: compact || !showUse ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: 7, columnGap: 10, alignContent: 'start', fontSize: 12.5 }}>
        {facts.map(([k, v]) => (
          <span key={k} style={{ display: 'contents' }}>
            <span style={{ color: tk.text.faint }}>{k}</span>
            <span style={{ color: tk.text.secondary, minWidth: 0 }}>{v}</span>
          </span>
        ))}
      </div>
      {showUse && <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={capsLabel(tk)}>Used by</span>
        {node.usedBy?.length ? node.usedBy.map((u, i) => (
          <LinkRow key={i} label={u.label} sub={u.where} tone={u.breaks ? 'needs' : 'copy'} onClick={u.id && u.id !== node.id && inv.byId.has(u.id) ? () => onOpen(u.id!) : undefined} />
        )) : <span style={{ fontSize: 12, color: tk.text.faint }}>{node.unused ? 'Nothing reads it.' : 'Nothing else saved uses it.'}</span>}
        {uses.length > 0 && <>
          <span style={{ ...capsLabel(tk), marginTop: 6 }}>Uses</span>
          {uses.map(u => <LinkRow key={u.id} label={u.label} sub={KIND_LABELS[u.kind]} tone="needs" onClick={() => onOpen(u.id)} />)}
        </>}
      </div>}
    </div>
  );
}

function LinkRow({ label, sub, tone, onClick }: { label: string; sub?: string; tone: 'needs' | 'copy'; onClick?: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const body = (
    <>
      <span title={tone === 'needs' ? 'Needs it: removing it breaks this' : 'Keeps its own copy'} style={{ width: 7, height: 7, borderRadius: 4, flexShrink: 0, background: tone === 'needs' ? tk.accent.base : 'transparent', boxShadow: tone === 'needs' ? 'none' : `inset 0 0 0 1.5px ${tk.text.faint}` }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'left' }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {sub && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{sub}</span>}
      </span>
      {onClick && <Icon name="chevR" size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />}
    </>
  );
  const style = { display: 'flex', alignItems: 'center', gap: 9, padding: '5px 6px', margin: '0 -6px', borderRadius: radius.md, border: 0, background: hover && onClick ? tk.bg.hover : 'transparent', font: 'inherit' } as const;
  return onClick
    ? <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ ...style, cursor: 'pointer' }}>{body}</button>
    : <div style={style}>{body}</div>;
}
