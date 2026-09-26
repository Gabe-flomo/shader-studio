/**
 * Putting a script's declared control on the Play panel: a slider or toggle
 * as a float control on `layer:<id>::p_<key>`, a button as an action control
 * on `act:<id>::script:<key>` that keys, clicks, beats and notes can press.
 */
import { playId } from '../../../play/playControls';
import { actionTarget, layerTarget } from '../../../types/play';
import type { ScriptLayer, ScriptParamDef } from '../../../types/playLayers';
import type { FieldKit } from './fields';

export function exposeScriptParam(f: FieldKit, l: ScriptLayer, d: ScriptParamDef) {
  if (d.kind === 'button') {
    f.exposeControl({ id: playId('ctl'), target: actionTarget(l.id, `script:${d.key}`), kind: 'action', label: `${l.label} · ${d.label}`, min: 0, max: 1, amount: 1 });
  } else if (d.kind === 'toggle') {
    f.exposeControl({ id: playId('ctl'), target: layerTarget(l.id, `p_${d.key}`), kind: 'float', label: `${l.label} · ${d.label}`, min: 0, max: 1, step: 1 });
  } else {
    f.exposeControl({ id: playId('ctl'), target: layerTarget(l.id, `p_${d.key}`), kind: 'float', label: `${l.label} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) });
  }
}

export function scriptParamExposed(f: FieldKit, l: ScriptLayer, d: ScriptParamDef): boolean {
  return f.exposedTargets.has(d.kind === 'button' ? actionTarget(l.id, `script:${d.key}`) : layerTarget(l.id, `p_${d.key}`));
}

