/**
 * GradientColourParam — a node card's colour setting whose ParamDef offers `gradient` drivers:
 * the swatch with a Solid | Gradient switch, and the gradient editor under it when on
 * (ui/GradientSetting.tsx, lib/colourGradient.ts, docs/gradients.md).
 *
 * Writes flat params: a stop or range edit is a uniform write (no recompile); the stop count,
 * the driver and the blend rebuild the shader. Switching to Solid keeps the gradient for later.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { GraphNode, ParamDef } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { ColorSwatch } from '../ui/ColorPicker';
import { ColourModeSwitch, GradientSetting, GradientStrip } from '../ui/GradientSetting';
import { toRgb } from '../../lib/colorMath';
import {
  gradKey, gradientOn, gradientParams, gradientValueParams, readGradient, starterGradient,
  type ColourGradient, type GradientDriver,
} from '../../lib/colourGradient';

export function GradientColourParam({ node, paramKey, paramDef, defaultValue, label, rowStyle, touch = false, swatchSize = 'md' }: {
  node: GraphNode;
  paramKey: string;
  paramDef: ParamDef;
  defaultValue: unknown;
  /** The setting's name, as the card shows it (a ParamLabel). */
  label: ReactNode;
  rowStyle: CSSProperties;
  touch?: boolean;
  swatchSize?: 'sm' | 'md' | 'lg';
}) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const drivers = (paramDef.gradient ?? []) as readonly GradientDriver[];
  const on = gradientOn(node.params, paramKey);
  // A colour the node never had (SDF Fill's Fill) shows its old built-in white.
  const solid = toRgb(node.params[paramKey] ?? defaultValue, [1, 1, 1]);
  const held = readGradient(node.params, paramKey);
  const gradient: ColourGradient | null = held && drivers.includes(held.along) ? held : held ? { ...held, along: drivers[0] } : null;

  const setMode = (mode: 'solid' | 'gradient') => {
    if (mode === 'solid') {
      if (!held) return;
      updateNodeParams(node.id, { [gradKey(paramKey)]: { ...(node.params[gradKey(paramKey)] as object), on: false } }, { immediate: true });
      return;
    }
    const g = gradient ?? starterGradient(solid, drivers[0]);
    // (A Color node gains its Point and Normal sockets from the store: colorPickerSockets.)
    updateNodeParams(node.id, gradientParams(paramKey, g, true), { immediate: true });
  };
  const onChange = (g: ColourGradient, structural: boolean) =>
    updateNodeParams(node.id, structural ? gradientParams(paramKey, g, true) : gradientValueParams(paramKey, g), { immediate: true });

  return (
    <div data-param-key={paramKey} onMouseDown={e => e.stopPropagation()}>
      <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
        {label}
        <ColourModeSwitch mode={on ? 'gradient' : 'solid'} onChange={setMode} label={paramDef.label} />
        {on && gradient
          ? <GradientStrip value={gradient} width={swatchSize === 'lg' ? '100%' : 44} height={swatchSize === 'lg' ? 26 : 22} />
          : (
            <ColorSwatch label={paramDef.label} value={solid} size={swatchSize}
              onChange={rgb => updateNodeParams(node.id, { [paramKey]: rgb }, { immediate: true })}
              style={{ flex: swatchSize === 'lg' ? 1 : undefined }} />
          )}
      </div>
      {on && gradient && (
        <div style={{ padding: '2px 12px 8px 16px' }}>
          <GradientSetting value={gradient} onChange={onChange} drivers={drivers} label={paramDef.label} touch={touch} />
          {node.type === 'colorPicker' && !node.inputs.point?.connection && (
            <div style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.muted, marginTop: 4 }}>Wire a 3D point (a march loop’s Hit Pos) into Point; until then it shows the solid colour.</div>
          )}
        </div>
      )}
    </div>
  );
}
