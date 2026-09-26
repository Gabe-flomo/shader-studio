/**
 * ScriptControls — the controls a sketch declares, as rows: sliders like any
 * layer property, toggles as switches, buttons that press the action now.
 * Each has the + that puts it on the Play panel (a slider, a toggle, or an
 * action button that keys, beats and notes can press).
 */
import type { ActionKind } from '../../../types/play';
import type { ScriptLayer } from '../../../types/playLayers';
import { exposeScriptParam, scriptParamExposed } from './scriptExpose';
import { Button, IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import type { FieldKit } from './fields';

export function ScriptControls({ f, l, act }: { f: FieldKit; l: ScriptLayer; act: (kind: ActionKind, amount?: number) => void }) {
  const defs = l.paramDefs ?? [];
  const values = l as unknown as Record<string, unknown>;
  return (
    <>
      {defs.map(d => {
        if (!d.kind || d.kind === 'slider') return <span key={d.key}>{f.prop(`p_${d.key}`)}</span>;
        const exposed = scriptParamExposed(f, l, d);
        const plus = (
          <IconButton icon={exposed ? 'check' : 'plus'} size="sm" active={exposed} disabled={exposed}
            label={exposed ? 'Already on the Play panel' : d.kind === 'button' ? `Put ${d.label} on the Play panel as a button (map a key or a beat onto it)` : `Put ${d.label} on the Play panel as a toggle`}
            onClick={() => exposeScriptParam(f, l, d)} />
        );
        if (d.kind === 'toggle') {
          const on = typeof values[`p_${d.key}`] === 'number' ? (values[`p_${d.key}`] as number) >= 0.5 : d.value >= 0.5;
          return <span key={d.key}>{f.row(d.label, <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><span style={{ flex: 1 }}><Toggle checked={on} onChange={v => f.set({ [`p_${d.key}`]: v ? 1 : 0 })} label={on ? 'On' : 'Off'} /></span>{plus}</span>, d.hint ?? `${d.label}: an on/off toggle the script declares.`)}</span>;
        }
        return <span key={d.key}>{f.row(d.label, <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><Button size="sm" icon="play" onClick={() => act(`script:${d.key}`, 1)} style={{ flex: 1, justifyContent: 'center' }}>Press</Button>{plus}</span>, d.hint ?? `${d.label}: a button the script declares. Pressing it runs its function (or sets s.pressed('${d.key}') for one frame).`)}</span>;
      })}
    </>
  );
}
