/**
 * Trail channels as named colour swatches (docs/agent-builder.md "Trail channels"): each channel a
 * colour chip and a name (click the name to rename it in place), with what reads it (Senses, an
 * only when) and what writes it (Trail); "+ Channel" adds the next free one, up to four. "Tint the
 * picture" lays the trail's channels in their colours over the live picture (TrailTint, from the
 * runner's live trail, a few times a second). Fades and Spreads get a before / after strip.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Toggle } from '../ui/Choice';
import type { AgentRuleSet } from '../../agentRules/spec';
import { CHANNEL_PALETTE, addChannel, channelSwatches, fadeStrip, recolourChannel, renameChannel, type ChannelSwatch } from '../../agentBuilder/trailChannels';
import { openHood, type HoodRequest } from '../../lib/agentHood';
import { type HoodTrailChannel, HOOD_TRAIL_GAIN, hoodAtlas, hoodTileSpecs, hoodTrailChannels } from '../../agentBuilder/hood';
import type { ViewRect } from '../builders/studio/LiveViewport';
import { BehaviourCard } from './BehaviourCard';

export function TrailChannelsCard({ set, update, velocity = false, tint, onTint }: {
  set: AgentRuleSet; update: (s: AgentRuleSet) => void; velocity?: boolean;
  tint: boolean; onTint: (v: boolean) => void;
}) {
  const tk = useTokens();
  const list = channelSwatches(set, { velocity });
  const add = addChannel(set);
  return (
    <BehaviourCard id="channels" picture="trail" title="Channels" hint="The trail's four channels, each a smell with its own name and colour: what reads and writes each."
      summary={list.map(c => `${c.label} · ${c.word}`).join(', ') || 'none'}>
      <div data-trail-channels style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(c => <ChannelRow key={c.index} c={c} set={set} update={update} />)}
      </div>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {add && (
          <button type="button" data-channel-add onClick={() => update(add.set)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px 0 8px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` }}>
            <Icon name="plus" size={12} />Channel
          </button>
        )}
        <span style={{ flex: 1 }} />
        <span data-trail-tint-toggle title="Lay each channel over the picture in its colour (from the live trail)"><Toggle checked={tint} onChange={onTint} label="Tint the picture" /></span>
      </span>
    </BehaviourCard>
  );
}

function ChannelRow({ c, set, update }: { c: ChannelSwatch; set: AgentRuleSet; update: (s: AgentRuleSet) => void }) {
  const tk = useTokens();
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState(false);
  const [text, setText] = useState(c.name);
  useEffect(() => setText(c.name), [c.name]);
  const commit = () => { setEditing(false); if (text.trim() !== c.name) update(renameChannel(set, c.index, text)); };
  const users = (label: string, l: string[]) => (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: 10.5, color: tk.text.faint, width: 46 }}>{label}</span>
      {l.length ? l.map(u => <span key={u} data-channel-user={u} style={{ padding: '1px 7px', borderRadius: 999, background: tk.bg.field, color: tk.text.secondary, fontSize: 10.5 }}>{u}</span>)
        : <span style={{ fontSize: 10.5, color: tk.text.faint }}>nothing</span>}
    </span>
  );
  return (
    <div data-channel={c.index} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px', borderRadius: radius.control, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" data-channel-colour={c.index} aria-label={`${c.label}'s colour: ${c.word}`} title="Its colour" onClick={() => setPick(v => !v)}
          style={{ width: 18, height: 18, padding: 0, border: 0, borderRadius: '50%', background: c.colour, cursor: 'pointer', boxShadow: `0 0 0 2px ${tk.bg.panel}, 0 0 0 3px ${alpha(c.colour, 0.7)}`, flexShrink: 0 }} />
        {editing ? (
          <input data-channel-name-input={c.index} autoFocus onFocus={e => e.currentTarget.select()} value={text} maxLength={24} aria-label="Channel name"
            onChange={e => setText(e.currentTarget.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(c.name); setEditing(false); } }}
            style={{ flex: 1, minWidth: 0, height: 22, padding: '0 6px', border: 0, outline: 'none', borderRadius: 6, background: tk.bg.panel, color: tk.text.primary, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, font: `600 12.5px ${fontFamily.ui}` }} />
        ) : (
          <button type="button" data-channel-name={c.index} title="Rename" onClick={() => setEditing(true)}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: 0, border: 0, background: 'none', cursor: 'text', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.label} <span style={{ fontWeight: 500, color: tk.text.muted }}>· {c.word}</span>
          </button>
        )}
        <span style={{ font: `600 10px ${fontFamily.mono}`, color: tk.text.faint }}>ch {c.index + 1}</span>
      </span>
      {pick && (
        <span role="radiogroup" aria-label="Colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 0' }}>
          {CHANNEL_PALETTE.map(p => (
            <button key={p.hex} type="button" role="radio" aria-checked={p.hex === c.colour} data-channel-swatch={p.word} title={p.word} onClick={() => { setPick(false); update(recolourChannel(set, c.index, p.hex)); }}
              style={{ width: 18, height: 18, padding: 0, border: 0, borderRadius: '50%', background: p.hex, cursor: 'pointer', boxShadow: p.hex === c.colour ? `0 0 0 2px ${tk.bg.panel}, 0 0 0 3.5px ${tk.accent.base}` : 'none' }} />
          ))}
        </span>
      )}
      {users('read by', c.readBy)}
      {users('written by', c.writtenBy)}
    </div>
  );
}

/** Before / after: a line of trail now, after one half-life and after three, from Fades and Spreads. */
export function FadeStrip({ halfLife, diffuse, colour = '#e8a33a' }: { halfLife: number; diffuse: number; colour?: string }) {
  const tk = useTokens();
  // Now, one half-life later and three: what Fades and Spreads leave of a line of trail.
  const at = useMemo(() => [0, Math.max(halfLife, 1 / 60), Math.max(halfLife, 1 / 60) * 3], [halfLife]);
  const strips = useMemo(() => fadeStrip(halfLife, diffuse, at), [halfLife, diffuse, at]);
  const secs = (t: number) => `${t < 1 ? Math.round(t * 1000) / 1000 : Math.round(t * 100) / 100} s`;
  return (
    <div data-fade-strip style={{ display: 'flex', gap: 6 }}>
      {strips.map((v, k) => {
        const peak = Math.max(...v);
        return (
          <span key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ height: 22, borderRadius: 5, background: tk.bg.render, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, overflow: 'hidden', display: 'flex' }}>
              {v.map((x, i) => <span key={i} style={{ flex: 1, background: colour, opacity: Math.min(1, Math.sqrt(Math.max(0, x)) * 1.2) }} />)}
            </span>
            <span style={{ fontSize: 10, color: tk.text.faint, textAlign: 'center' }}>{k === 0 ? 'now' : `${secs(at[k])} · ${Math.round(peak * 100)}%`}</span>
          </span>
        );
      })}
    </div>
  );
}

const TINT_TILE = 256;

/**
 * The trail's channels in their colours over the live picture (Tint the picture), from the runner's
 * live trail (lib/agentHood.ts: an atlas of the four channels, read back a few times a second).
 * Closed while Under the hood is open (one request per group).
 */
export function TrailTint({ groupId, set, box, velocity = false }: { groupId: string; set: AgentRuleSet; box: { w: number; h: number; image: ViewRect }; velocity?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const trails: HoodTrailChannel[] = useMemo(() => hoodTrailChannels(set, { velocity }), [set, velocity]);
  const aspect = box.image.w / Math.max(1, box.image.h);
  const atlas = useMemo(() => hoodAtlas([], 4, aspect, TINT_TILE), [aspect]);
  const req = useMemo<HoodRequest>(() => ({
    groupId, atlas, specs: [], species: [], probe: null, pick: null,
    onAtlas: (px, W, H) => paint(px, W, H), onProbe: () => {}, onPick: () => {},
  }), [groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => openHood(req), [req]);
  useEffect(() => {
    req.atlas = atlas;
    req.specs = hoodTileSpecs([], trails).map(s => ({ ...s, hi: HOOD_TRAIL_GAIN }));
  }, [req, atlas, trails]);
  function paint(px: Uint8Array, W: number, H: number) {
    const c = canvas.current;
    if (!c || typeof document === 'undefined') return;
    const sc = scratch.current ?? (scratch.current = document.createElement('canvas'));
    if (sc.width !== W || sc.height !== H) { sc.width = W; sc.height = H; }
    const sx = sc.getContext('2d'), cx = c.getContext('2d');
    if (!sx || !cx) return;
    const img = sx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    sx.putImageData(img, 0, 0);
    const t = req.atlas.tiles;
    const w = t[0]?.w ?? 1, h = t[0]?.h ?? 1;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, w, h);
    cx.globalCompositeOperation = 'lighter';
    for (const tile of t) cx.drawImage(sc, tile.x, tile.y, tile.w, tile.h, 0, 0, w, h);
  }
  const im = box.image;
  return (
    <canvas ref={canvas} data-trail-tint style={{ position: 'absolute', left: im.x, top: im.y, width: im.w, height: im.h, pointerEvents: 'none', mixBlendMode: 'screen', opacity: 0.9 }} />
  );
}
