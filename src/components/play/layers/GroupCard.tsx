/**
 * GroupCard — a layer group in the Layers list (types/layerGroups.ts).
 *
 * Collapsed (the default): the name, its colour, how many layers and which
 * kinds are inside, and a switch and an S for all of them. Open it (the
 * chevron) for the group's live parameters only: numbers that are controls,
 * buttons a control presses, nulls that drive mappings, settings that follow
 * a null. Enter it (the arrow, or a double-click) to see its layers as full
 * cards.
 */
import { useMemo, useRef, useState } from 'react';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { accentColor } from '../../../theme/categories';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { GROUP_COLOURS, groupLayerIds, type GroupColour, type LayerGroup } from '../../../types/layerGroups';
import type { PlayRecord } from '../../../types/play';
import { playEngine } from '../../../lib/playEngine';
import { groupKinds, liveParams, patchGroup, type LiveParam } from '../groupOps';
import { useLiveValues } from '../useLiveValues';
import { GroupSoloButton } from '../Solo';
import { layerLook } from './layerLook';
import { Button, IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Popover } from '../../ui/Popover';
import { RulerSlider } from '../../ui/RulerSlider';
import { Tooltip } from '../../ui/Tooltip';

const COLOUR_NAMES: Record<GroupColour, string> = {
  blue: 'Blue', sky: 'Sky', teal: 'Teal', green: 'Green', yellow: 'Yellow', peach: 'Peach', red: 'Red', pink: 'Pink', mauve: 'Mauve', lavender: 'Lavender',
};

/** At most this many kind icons; the rest are counted. */
const KIND_ICONS = 7;

export function GroupCard({ group, play, touch, hiddenAbove, onChange, onEnter, menuItems }: {
  group: LayerGroup;
  play: PlayRecord;
  touch: boolean;
  /** A group around this one is hidden. */
  hiddenAbove: boolean;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  onEnter: () => void;
  /** Duplicate, ungroup, move, delete. */
  menuItems: MenuItem[];
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const colour = accentColor(group.colour, mode);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.label);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const ids = useMemo(() => groupLayerIds(play, group.id), [play, group.id]);
  const kinds = useMemo(() => groupKinds(play, group.id), [play, group.id]);
  const params = useMemo(() => liveParams(play, group.id), [play, group.id]);
  const soloIds = useMemo(() => ids.filter(id => play.layers.find(l => l.id === id)?.kind !== 'null'), [ids, play.layers]);
  const set = (patch: Parameters<typeof patchGroup>[2]) => onChange(p => patchGroup(p, group.id, patch));
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== group.label) set({ label: t.slice(0, 80) }); else setDraft(group.label); };
  const shown = !group.hidden;

  return (
    <div
      data-group-id={group.id}
      onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button, input, [data-ruler-track], [data-no-enter]')) onEnter(); }}
      style={{
        position: 'relative', marginTop: 6, padding: '8px 10px 9px 13px', borderRadius: radius.card, overflow: 'hidden',
        background: `linear-gradient(${alpha(colour, 0.06)}, ${alpha(colour, 0.06)}), ${tk.bg.panel}`,
        boxShadow: `inset 0 0 0 1px ${alpha(colour, 0.32)}`,
        opacity: shown && !hiddenAbove ? 1 : 0.6,
      }}
    >
      {/* The group's colour, down the left edge (its layers carry it too). */}
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: colour }} />
      <div draggable={!editing} title="Drag to move the whole group" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Hide live parameters' : 'Show live parameters'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />
        <Tooltip label="Colour" description="Shown on the group and on its layers.">
          <button
            ref={swatchRef}
            type="button"
            aria-label={`Colour: ${COLOUR_NAMES[group.colour]}`}
            onClick={() => setPicker(o => !o)}
            style={{ width: 22, height: 22, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, padding: 0, borderRadius: 6, cursor: 'pointer', background: picker ? alpha(colour, 0.18) : 'transparent', color: colour }}
          >
            <Icon name="folder" size={15} />
          </button>
        </Tooltip>
        {picker && (
          <Popover anchorRef={swatchRef} onClose={() => setPicker(false)} padding={8}>
            <div role="radiogroup" aria-label="Group colour" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 26px)', gap: 6 }}>
              {GROUP_COLOURS.map(c => {
                const on = group.colour === c, hex = accentColor(c, mode);
                return (
                  <button key={c} type="button" role="radio" aria-checked={on} aria-label={COLOUR_NAMES[c]} title={COLOUR_NAMES[c]}
                    onClick={() => { set({ colour: c }); setPicker(false); }}
                    style={{ width: 26, height: 26, borderRadius: 13, border: 0, padding: 0, cursor: 'pointer', background: hex, boxShadow: on ? `0 0 0 2px ${tk.bg.panel}, 0 0 0 3.5px ${hex}` : 'none' }} />
                );
              })}
            </div>
          </Popover>
        )}
        {editing ? (
          <Field autoFocus value={draft} onFocus={e => e.currentTarget.select()} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(group.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
        ) : (
          <button type="button" title="Rename" onClick={() => { setDraft(group.label); setEditing(true); }} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'text', color: tk.text.primary, font: `650 13px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.label}</button>
        )}
        {soloIds.length > 0 && <GroupSoloButton ids={soloIds} />}
        <span title={shown ? 'Hide every layer in the group (their own switches stay as they are)' : 'Show the group’s layers again'} style={{ display: 'inline-flex' }}>
          <Toggle checked={shown} onChange={v => set({ hidden: !v })} />
        </span>
        <span ref={moreRef} style={{ display: 'inline-flex' }}>
          <IconButton icon="more" label="More: duplicate, ungroup, delete" size="sm" tooltip={false} onClick={() => { const r = moreRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 240, y: r.bottom + 4 } : null); }} />
        </span>
        {menu && <Menu x={menu.x} y={menu.y} minWidth={240} onClose={() => setMenu(null)} items={[{ label: 'Rename', onSelect: () => { setDraft(group.label); setEditing(true); } }, ...menuItems]} />}
      </div>

      {/* What's inside: how many, which kinds; and the way in. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 0 20px', minHeight: 26 }}>
        <span style={{ color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{ids.length} layer{ids.length === 1 ? '' : 's'}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' }}>
          {kinds.slice(0, KIND_ICONS).map(({ layer, count }) => {
            const look = layerLook(layer, play.layerKinds, mode, tk.text.muted);
            return (
              <Tooltip key={layer.id} label={count > 1 ? `${look.label} × ${count}` : look.label}>
                <span style={{ display: 'inline-flex', color: look.color }}><Icon name={look.icon} size={13} /></span>
              </Tooltip>
            );
          })}
          {kinds.length > KIND_ICONS && <span style={{ color: tk.text.faint, font: `600 11px ${fontFamily.ui}` }}>+{kinds.length - KIND_ICONS}</span>}
        </span>
        <span style={{ flex: 1 }} />
        {params.length > 0 && !open && (
          <button type="button" onClick={() => setOpen(true)} style={{ border: 0, background: 'none', padding: '2px 0', cursor: 'pointer', color: tk.text.faint, font: `600 11px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
            {params.length} live
          </button>
        )}
        <Button size="sm" variant="ghost" onClick={onEnter} title="Show the group’s layers (or double-click the card)" style={{ height: 26, padding: '0 6px 0 8px', gap: 2, color: tk.text.secondary }}>
          Open<Icon name="chevR" size={14} />
        </Button>
      </div>

      {open && <GroupParams play={play} params={params} touch={touch} onChange={onChange} />}
    </div>
  );
}

/** The live parameters, each "Layer · Prop", with the panel's sliders. */
function GroupParams({ play, params, touch, onChange }: { play: PlayRecord; params: LiveParam[]; touch: boolean; onChange: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const tk = useTokens();
  const live = useLiveValues(play);
  const labelStyle = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` } as const;
  const chip = (text: string, title?: string) => (
    <span title={title} style={{ flexShrink: 0, height: 18, padding: '0 6px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', gap: 3, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 10px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{text}</span>
  );
  if (!params.length) {
    return (
      <div data-no-enter style={{ margin: '8px 0 0 20px', color: tk.text.faint, font: `11.5px/1.45 ${fontFamily.ui}` }}>
        Nothing live yet. A number shows here once it is a control (the + beside it in a layer).
      </div>
    );
  }
  const setProp = (layerId: string, key: string, v: number) => onChange(p => ({ ...p, layers: p.layers.map(l => (l.id === layerId ? { ...l, [key]: v } as typeof l : l)) }));
  return (
    <div data-no-enter style={{ margin: '8px 0 0 20px', paddingTop: 2, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {params.map(pr => {
        if (pr.kind === 'follow') {
          return (
            <div key={`f:${pr.label}`} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
              <span style={labelStyle}>{pr.label}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: tk.text.muted, font: `11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}><Icon name="target" size={12} />{pr.nullLabel}</span>
            </div>
          );
        }
        if (pr.kind === 'action') {
          return (
            <div key={pr.controlId} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
              <span style={labelStyle}>{pr.label}</span>
              <Button size="sm" icon="play" onClick={() => playEngine.fireControl(pr.controlId)} style={{ height: 26 }}>Press</Button>
            </div>
          );
        }
        const layer = play.layers.find(l => l.id === pr.layerId) as unknown as Record<string, unknown> | undefined;
        const raw = layer?.[pr.key];
        const value = typeof raw === 'number' ? raw : pr.min;
        const mapped = pr.controlId ? play.mappings.filter(m => m.enabled && m.controlId === pr.controlId).length : 0;
        const lv = pr.controlId ? live.get(pr.controlId) : undefined;
        const readsNull = !pr.controlId;
        return (
          <div key={`${pr.layerId}:${pr.key}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={labelStyle}>{pr.label}</span>
              {mapped > 0 && chip('Mapped', 'Driven by a mapping: its live value shows')}
              {readsNull && chip('Drives', 'This null drives a mapping')}
            </div>
            <RulerSlider
              value={mapped && typeof lv === 'number' ? lv : value}
              min={Math.min(pr.min, pr.max)}
              max={Math.max(pr.min, pr.max)}
              step={pr.step ?? 0.01}
              disabled={mapped > 0}
              onChange={v => setProp(pr.layerId, pr.key, v)}
              onType={v => setProp(pr.layerId, pr.key, v)}
              ariaLabel={pr.label}
              touch={touch}
            />
          </div>
        );
      })}
    </div>
  );
}
