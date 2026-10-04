/**
 * ParticlePresets — one-click looks for the Particles node (Ink in water,
 * Embers, Dust in air, Image dissolve, Sound field, Launch, the Chladni
 * plates: Chladni sand, Singing plate, Cymatics bloom; Hand swirl), as a row of
 * chips at the top of its card. A preset sets every setting (the defaults,
 * then its own: play/kit/gpuParticles.js GP_PRESETS), so it always looks the
 * same; the hand positions and the sound level are inputs and are kept.
 * One undoable change.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { GP_PRESETS, gpPreset } from '../../play/kit/gpuParticles.js';

export function ParticlePresets({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  return (
    <div style={{ padding: '6px 12px 4px 16px', display: 'flex', flexDirection: 'column', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
      <span style={{ fontSize: 12, color: tk.text.secondary }}>Presets</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(GP_PRESETS).map(([name, pr]) => (
          <button
            key={name}
            type="button"
            title={pr.hint}
            onClick={() => { const p = gpPreset(name); if (p) updateNodeParams(node.id, p, { immediate: true }); }}
            style={{
              border: 0, cursor: 'pointer', padding: '4px 9px', borderRadius: radius.md, background: tk.bg.field,
              color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`,
            }}
          >
            {pr.label}
          </button>
        ))}
      </div>
    </div>
  );
}
