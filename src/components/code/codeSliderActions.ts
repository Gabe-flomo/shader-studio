/**
 * Make a slider's state and write (the button is MakeSlider.tsx): which number the caret is on,
 * and writing the made slider to the node as one undo step.
 */
import { useCallback, useState } from 'react';
import type { DataType } from '../../types/nodeGraph';
import { literalAt, type LiteralSpan } from '../../lib/glslPatterns/literalSlider';
import type { CodeSliderResult } from '../../nodes/codeSlider';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { toast } from '../ui/toastStore';

export interface LiteralOffer<W> { where: W; lit: LiteralSpan }

/** Tracks the number under the caret of whichever code field reported last. */
export function useLiteralOffer<W>() {
  const [offer, setOffer] = useState<LiteralOffer<W> | null>(null);
  const track = useCallback((el: HTMLInputElement | HTMLTextAreaElement, where: W) => {
    const lit = literalAt(el.value, el.selectionStart ?? 0, el.selectionEnd ?? el.selectionStart ?? 0);
    setOffer(prev => {
      if (!lit) return null;
      if (prev && prev.lit.start === lit.start && prev.lit.text === lit.text && JSON.stringify(prev.where) === JSON.stringify(where)) return prev;
      return { where, lit };
    });
  }, []);
  const clear = useCallback(() => setOffer(null), []);
  return { offer, track, clear };
}

/** Write a made slider to the node: one undo step, with its sockets. */
export function applyCodeSlider(nodeId: string, r: CodeSliderResult, litText: string, outputType: DataType, extraOutputs: Array<{ name: string; type: DataType }> = []): void {
  const st = useNodeGraphStore.getState();
  undoManager.batch(st.nodes, () => {
    st.updateNodeParams(nodeId, r.params, { immediate: true });
    st.updateNodeSockets(nodeId, r.inputs as Array<{ name: string; type: DataType; slider?: { min: number; max: number } | null }>, outputType, extraOutputs);
  }, { label: `Made ${litText} a slider (${r.name})`, nodeIds: [nodeId] });
  toast.success(`${litText} is now the slider “${r.name}”`, { message: `It starts at ${r.value}, so the picture is unchanged. Typing past the end of its range extends it; undo puts the number back.` });
}
