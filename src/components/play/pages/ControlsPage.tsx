/**
 * The Controls rail page's own pages besides the controls and sources board:
 * the MIDI file and the pad grid.
 */
import { ProLock } from '../../account/ProSheet';
import { MidiFileCard } from '../MidiFileCard';
import { PadGridCard } from '../PadGridCard';
import { CardPage } from '../FullPages';

/** The MIDI file card, locked on Free (a file made on Pro stays, shown dimmed). */
export function MidiFileSlot() {
  return <ProLock feature="play.midiFile" style={{ display: 'flex', width: '100%', alignItems: 'flex-start' }}><MidiFileCard /></ProLock>;
}

/** The MIDI file page: one card. */
export function MidiFilePage() {
  return (
    <CardPage title="MIDI file" intro="A MIDI file plays into the setup as if from a controller: its notes and CCs drive mappings, triggers and racks, in time with the picture.">
      <MidiFileSlot />
    </CardPage>
  );
}

/** The pad grid page: one card. */
export function PadGridPage() {
  return (
    <CardPage title="Pad grid" intro="A grid of pads from a controller (a Launchpad, an MPC), read as sources: each pad’s press, pressure or toggle can drive a control.">
      <ProLock feature="play.sources" style={{ display: 'block', width: '100%' }}><PadGridCard /></ProLock>
    </CardPage>
  );
}
