/**
 * PlayDriveChip — on a node card slider that the Play page is driving.
 *
 * The slider still sets the control's resting value, but an enabled mapping
 * writes over it every frame, so the chip says who's in charge and offers
 * the way back: pause those mappings (the slider here works again, and the
 * mappings can be switched back on in Play), or take it off the Play panel.
 */
import { useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { pauseDrive, removeFromPlay, type PlayDrive } from '../../play/playDriven';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toastStore';

const openPlay = () => useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 }));

export function PlayDriveChip({ drive }: { drive: PlayDrive }) {
  const tk = useTokens();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const n = drive.sources.length;
  const by = n === 1 ? drive.sources[0] : `${drive.sources.slice(0, -1).join(', ')} and ${drive.sources[n - 1]}`;
  const setPlay = (f: Parameters<ReturnType<typeof useNodeGraphStore.getState>['setPlay']>[0]) => useNodeGraphStore.getState().setPlay(f);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        title={`Driven on the Play page by ${by}: click for options`}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, height: 20, padding: '0 6px', flexShrink: 0, border: 0, borderRadius: radius.sm,
          background: alpha(tk.accent.base, 0.14), color: tk.accent.base, font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.04em', cursor: 'pointer',
        }}
      >
        <Icon name="play" size={10} />PLAY
      </button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={280} padding={12}>
          <div style={{ font: `12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary }}>
            <b style={{ color: tk.text.primary }}>{drive.controlLabel}</b> is driven on the Play page by <b style={{ color: tk.text.primary }}>{by}</b>.
            Moving the slider here only sets its resting value, which the mapping{n === 1 ? '' : 's'} override{n === 1 ? 's' : ''}.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            <Button size="sm" variant="primary" icon="pause" title={`Pause ${n === 1 ? 'its mapping' : `its ${n} mappings`}; switch ${n === 1 ? 'it' : 'them'} back on in Play › Mappings`} onClick={() => {
              setPlay(p => pauseDrive(p, drive.controlId));
              setOpen(false);
              toast.success(`${drive.controlLabel}: back to this slider`, { message: `Paused ${n === 1 ? 'its mapping' : `its ${n} mappings`}. Switch ${n === 1 ? 'it' : 'them'} back on in Play › Mappings.` });
            }}>Control it here</Button>
            <Button size="sm" icon="trash" onClick={() => {
              setPlay(p => removeFromPlay(p, drive.controlId));
              setOpen(false);
              toast.success(`${drive.controlLabel} is off the Play panel`, { message: 'Its mappings went with it.' });
            }}>Remove from Play</Button>
            <Button size="sm" variant="ghost" icon="popout" onClick={() => { setOpen(false); openPlay(); }}>Open Play</Button>
          </div>
        </Popover>
      )}
    </>
  );
}
