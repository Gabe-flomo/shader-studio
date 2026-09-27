/**
 * P5Convert — the Convert page's p5.js tab: paste a p5.js sketch (or open its
 * files, a folder or a .zip), read the report, choose what becomes a control,
 * and make it real as a Script layer on this Play, or as a new Play of its own.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { emptyPlayRecord } from '../../types/play';
import { Button } from '../ui/Button';
import { askConfirm } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { P5ImportPanel, type P5ImportResult } from '../play/layers/P5Import';
import { p5LayerRecord } from '../play/layers/p5Layer';

export function P5Convert({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const [busy, setBusy] = useState(false);
  const openPlay = () => useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 }));
  const create = async (make: () => Promise<P5ImportResult | null>, fresh: boolean) => {
    setBusy(true);
    try {
      const r = await make();
      if (!r) return;
      const id = `layer_${Date.now().toString(36)}`;
      const layer = p5LayerRecord(r.patch, r.startAt, id);
      const { play, setPlay } = useNodeGraphStore.getState();
      if (fresh) {
        if (play.layers.length && !(await askConfirm('Start a new Play with this sketch?', { message: 'This file’s Play setup (its layers, controls and mappings) is replaced by the sketch alone; the graph stays. Undo brings the setup back.', confirmLabel: 'New Play' }))) return;
        setPlay({ ...emptyPlayRecord(), layers: [layer] });
      } else setPlay(p => ({ ...p, layers: [...p.layers, layer] }));
      toast.success(`“${r.title}” is a Script layer`, { message: 'Open the Sketch editor from its card for the code, its files and the console.' });
      openPlay();
    } catch (e) {
      toast.error('Couldn’t make the layer', { message: (e as Error)?.message ?? String(e) });
    } finally { setBusy(false); }
  };
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: compact ? 'auto' : 'hidden', padding: compact ? 12 : 16, boxSizing: 'border-box', background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      <P5ImportPanel narrow={compact} actions={(make, blocked) => (
        <>
          <Button variant="ghost" disabled={!make || busy} title={blocked ?? 'Replace this file’s Play setup with the sketch alone (the graph stays)'} onClick={() => { if (make) void create(make, true); }}>New Play with it</Button>
          <Button variant="primary" icon="plus" disabled={!make || busy} title={blocked ?? 'Add it to this file’s Play as a Script layer'} onClick={() => { if (make) void create(make, false); }}>{busy ? 'Working…' : 'Add to Play'}</Button>
        </>
      )} />
    </div>
  );
}
