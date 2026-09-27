/**
 * HandsChip.tsx — hand tracking's status and settings (docs/hand-tracking.md).
 *
 *   HandsChip   "Hands: tracking 2 hands", with Enable / Stop and the settings
 *               (smoothing, the skeleton over the picture, selfie mirroring).
 *               Shown wherever hands are used: the mappings drawer, a hand
 *               trigger, a null that follows a hand.
 *   HandsPill   the same Enable, floating on the picture while the setup
 *               reads hands and tracking is off (browsers need a click to
 *               open the camera).
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { handFeed, type HandStatus } from '../../lib/handFeed';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { DEFAULT_HANDS, usesHands, type PlayHands } from '../../types/play';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { usePlayUi } from './playUi';

/** Inside another site's frame the camera is refused without asking (see chips.tsx). */
const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top;

/** Status and hands in view, kept current. */
function useHands(): { status: HandStatus; count: number; paused: boolean } {
  const [s, setS] = useState(() => ({ status: handFeed.getStatus(), count: handFeed.handCount(), paused: handFeed.isPaused() }));
  useEffect(() => handFeed.onStatus(status => setS({ status, count: handFeed.handCount(), paused: handFeed.isPaused() })), []);
  return s;
}

function handsText(status: HandStatus, count: number, paused = false): string {
  switch (status) {
    case 'on': return paused ? 'Hands: resting while a take plays' : count === 0 ? 'Hands: none in view' : count === 1 ? 'Hands: tracking 1 hand' : 'Hands: tracking 2 hands';
    case 'starting': return 'Hands: starting…';
    case 'blocked': return EMBEDDED ? 'Hands: camera blocked by this page' : 'Hands: camera blocked';
    case 'error': return 'Hands: couldn’t start';
    case 'unsupported': return 'Hands: not available here';
    default: return 'Hands: off';
  }
}

export function HandsChip({ settings = true }: { settings?: boolean }) {
  const tk = useTokens();
  const { status, count, paused } = useHands();
  const [open, setOpen] = useState(false);
  const gear = useRef<HTMLSpanElement>(null);
  // The tooltip's frame rate and timings, refreshed while tracking.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'on') return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);
  const colour = status === 'on' ? (paused ? tk.text.disabled : count > 0 ? tk.status.success : tk.status.warning) : status === 'starting' ? tk.status.warning : status === 'blocked' || status === 'error' ? tk.status.danger : tk.text.disabled;
  const s = handFeed.stats;
  const title = status === 'on' ? `${s.fps} frames a second · the model takes ${s.inferMs} ms (${s.delegate || '…'}) · ${s.latencyMs} ms camera to landmarks` : handFeed.getMessage() || undefined;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span title={title} style={{ color: status === 'blocked' || status === 'error' ? tk.status.danger : tk.text.muted, font: `11px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{handsText(status, count, paused)}</span>
      {(status === 'off' || status === 'blocked' || status === 'error') && (
        <Button size="sm" icon="hand" onClick={() => void handFeed.start()}>{status === 'off' ? 'Enable' : 'Try again'}</Button>
      )}
      {status === 'on' && <Button size="sm" variant="ghost" onClick={() => handFeed.stop()}>Stop</Button>}
      {settings && (
        <span ref={gear} style={{ display: 'inline-flex' }}>
          <IconButton icon="sliders" label="Hand tracking settings" size="sm" active={open} onClick={() => setOpen(o => !o)} />
        </span>
      )}
      {open && (
        <Popover anchorRef={gear} onClose={() => setOpen(false)} align="end" width={300} padding={12}>
          <HandsSettings />
        </Popover>
      )}
    </span>
  );
}

/** Smoothing, the skeleton overlay and mirroring, saved with the setup. */
function HandsSettings() {
  const tk = useTokens();
  const hands = useNodeGraphStore(s => s.play.hands) ?? DEFAULT_HANDS;
  const camera = useNodeGraphStore(s => s.play.layers.find(l => l.kind === 'camera'));
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const set = (patch: Partial<PlayHands>) => setPlay(p => ({ ...p, hands: { ...(p.hands ?? DEFAULT_HANDS), ...patch } }));
  const hex = `#${hands.colour.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  const label = { color: tk.text.primary, font: `600 12px ${fontFamily.ui}` };
  const hint = { color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}`, margin: '3px 0 0' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={label}>Smoothing</span>
        </div>
        <RulerSlider ariaLabel="Hand smoothing" value={hands.smoothing} min={0} max={1} step={0.05} defaultValue={DEFAULT_HANDS.smoothing} onChange={v => set({ smoothing: v })} />
        <p style={hint}>Low follows every twitch; high is steady but a little late.</p>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Toggle checked={hands.overlay} onChange={overlay => set({ overlay })} label="Show hands on the picture" />
          <span style={{ flex: 1 }} />
          <label title="Colour of the hands on the picture" style={{ position: 'relative', width: 26, height: 22, borderRadius: radius.sm, background: hex, cursor: 'pointer', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.15)}`, opacity: hands.overlay ? 1 : 0.5 }}>
            <input type="color" aria-label="Colour of the hands on the picture" value={hex} onChange={e => { const h = e.target.value; set({ colour: [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] }); }} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
          </label>
        </div>
        <p style={hint}>Bones and dots over the picture, for setting up. They show with the guides: H hides them.</p>
      </div>
      <div>
        <Toggle checked={camera?.kind === 'camera' ? camera.mirror : hands.mirror} disabled={!!camera} onChange={mirror => set({ mirror })} label="Mirror, like a selfie" />
        <p style={hint}>{camera ? 'The Camera layer’s own Mirror decides this: hands line up with the camera image it shows.' : 'Your right hand moves right on the picture.'}</p>
      </div>
      <p style={{ ...hint, margin: 0, paddingTop: 8, borderTop: `1px solid ${tk.border.default}` }}>
        Everything runs on this computer: camera frames never leave it.
      </p>
    </div>
  );
}

/** Enable, on the picture, while the setup reads hands and tracking is off. */
export function HandsPill() {
  const { status, count } = useHands();
  const performing = usePlayUi(s => s.performing);
  const needs = useNodeGraphStore(s => usesHands(s.play));
  if (!performing || !needs || status === 'on' || status === 'unsupported') return null;
  const busy = status === 'starting';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handFeed.start()}
      title={handFeed.getMessage() || 'This setup follows your hands. Turn on the camera and hand tracking (everything stays on this computer).'}
      style={{
        position: 'absolute', left: 10, bottom: 10, zIndex: 3, display: 'inline-flex', alignItems: 'center', gap: 7,
        height: 30, padding: '0 12px 0 10px', border: 0, borderRadius: 999, cursor: busy ? 'default' : 'pointer',
        background: alpha('#000000', 0.62), color: '#ffffff', font: `600 12px ${fontFamily.ui}`,
        boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.16)}`, backdropFilter: 'blur(6px)',
      }}
    >
      <Icon name="hand" size={15} />
      {busy ? 'Starting hand tracking…' : status === 'blocked' || status === 'error' ? `${handsText(status, count).replace('Hands: ', '')} · Try again` : 'Enable hand tracking'}
    </button>
  );
}
