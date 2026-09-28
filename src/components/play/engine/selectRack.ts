/**
 * selectRack.ts — selecting a rack (its card, or its lane on the tape) makes
 * it the lead unless one is locked (docs/audio-engine.md, "The lead rack"),
 * and the computer keyboard, when a rack has it, follows the lead.
 */
import { useEngineSelection } from '../../../lib/audioEngineHost';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { keyboardRack, leadRackId, setLeadLock, setRackKeyboard } from '../../../types/playAudioEngine';

/** The computer keyboard (if a rack has it) moves to the lead. Not an undo step (a rack taking the keyboard never is). */
export function keyboardFollowsLead(): void {
  const st = useNodeGraphStore.getState();
  const ae = st.play.audioEngine;
  const lead = leadRackId(ae, useEngineSelection.getState().selected);
  const kb = keyboardRack(ae);
  if (kb && lead && kb.id !== lead) st.setPlay(p => ({ ...p, audioEngine: setRackKeyboard(p.audioEngine, lead, true) }));
}

export function selectRack(id: string): void {
  if (useEngineSelection.getState().selected === id) return;
  useEngineSelection.getState().select(id);
  keyboardFollowsLead();
}

/** Lock (or unlock) a rack as the lead: kept in the record. */
export function lockLead(id: string, on: boolean): void {
  useNodeGraphStore.getState().setPlay(p => ({ ...p, audioEngine: setLeadLock(p.audioEngine, on ? id : '') }), { label: on ? 'Locked the lead rack' : 'Unlocked the lead rack' });
  keyboardFollowsLead();
}
