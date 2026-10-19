/**
 * Play's audio readers on a Live track (Playfield Send, docs/playfield-send-plan.md phase 5): the
 * input `send:<id>`, its control group "Audio readers · Live · Drums", the Listen to choices (and a
 * send that isn't running), and what the reader bank says about it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { addReader, newReader, readerGroupName, readerSourceName, setReaderInput } from '../readerControls';
import { readerInputOptions } from '../../components/play/readersPanelUi';
import { emptyPlayRecord, type PlayRecord } from '../../types/play';
import { sendReaderInput, setSendLabeller } from '../../lib/liveSendNames';

afterEach(() => setSendLabeller(id => `Send ${id}`));

describe('readers on a Live track', () => {
  it('group their controls under the track’s name, and follow a regroup', () => {
    setSendLabeller(id => (id === 4821 ? 'Drums' : `Send ${id}`));
    let p: PlayRecord = emptyPlayRecord();
    p = addReader(p, newReader('r1', 60, 0, []));
    expect(p.controls[0].group).toBe('Audio readers · Live');
    p = setReaderInput(p, sendReaderInput(4821));
    expect(p.audioReaders?.input).toBe('send:4821');
    expect(readerSourceName(p)).toBe('Live · Drums');
    expect(readerGroupName(p)).toBe('Audio readers · Live · Drums');
    expect(p.controls[0].group).toBe('Audio readers · Live · Drums');
    // Unnamed (no Live connector, no name set): "Send 1207".
    p = setReaderInput(p, sendReaderInput(1207));
    expect(p.controls[0].group).toBe('Audio readers · Live · Send 1207');
  });

  it('are offered each running send, and keep showing one that isn’t running', () => {
    const sends = [{ id: 4821, label: 'Drums' }, { id: 1207, label: 'Bass' }];
    const opts = readerInputOptions('', [], [], [], sends);
    expect(opts).toContainEqual({ value: 'send:4821', label: 'Live · Drums' });
    expect(opts).toContainEqual({ value: 'send:1207', label: 'Live · Bass' });
    const gone = readerInputOptions('send:55', [], [], [], sends);
    expect(gone).toContainEqual({ value: 'send:55', label: 'Live · Send 55 (not running)' });
    // Not mistaken for a deleted song node.
    expect(gone.some(o => o.label.startsWith('Song ·'))).toBe(false);
    // The web build lists none.
    expect(readerInputOptions('', [], []).some(o => o.value.startsWith('send:'))).toBe(false);
  });
});
