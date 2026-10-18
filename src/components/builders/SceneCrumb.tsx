/**
 * SceneCrumb — the header of a Scene builder kind (docs/scene-builder.md, "Finding your way"):
 * "Scene builder › 3D scene" (› the thing being built, when it has a name), in place of the
 * window's title. "Scene builder" goes back to the kind page; the kind's own sections are the
 * window's tabs (2D, 3D, Grid) or its left nav (Agents).
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { usePhoneDialog } from '../ui/phoneDialog';
import { backToSceneKinds, sceneKindInfo, type SceneKind } from '../../builders/sceneKinds';

/** Every kind's window is the kind page's size (StudioShell's 1440 × 900), so picking a kind doesn't jump. */
export const SCENE_WINDOW = { width: 1440, height: 900 } as const;

export function SceneCrumb({ kind, leaf, onBack = backToSceneKinds }: { kind: SceneKind; leaf?: ReactNode; onBack?: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const sep = <Icon name="chevR" size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />;
  // A phone: no room for the whole path (it was cut mid-word, "2D s"): one back link, "‹ 2D scene".
  const phone = usePhoneDialog();
  if (phone) {
    return (
      <span data-scene-crumb={kind} data-scene-crumb-compact style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: '100%' }}>
        <button type="button" data-scene-crumb-back onClick={onBack} aria-label={`Back to the Scene builder’s kinds (from ${sceneKindInfo(kind).title})`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, maxWidth: '100%', border: 0, background: 'none', padding: '0 4px 0 0', margin: 0, cursor: 'pointer',
            font: 'inherit', fontWeight: 600, color: tk.accent.text, whiteSpace: 'nowrap',
          }}>
          <Icon name="chevL" size={12} style={{ flexShrink: 0 }} />
          <span data-scene-crumb-kind style={{ flexShrink: 0 }}>{sceneKindInfo(kind).title}</span>
          {leaf && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, color: tk.text.muted, fontWeight: 500 }}>&nbsp;· {leaf}</span>}
        </button>
      </span>
    );
  }
  return (
    <span data-scene-crumb={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%' }}>
      <button type="button" data-scene-crumb-back onClick={onBack} title="Back to “What kind of scene?” (what you built stays in the graph)"
        style={{
          border: 0, background: 'none', padding: '1px 4px', margin: '0 -4px', borderRadius: radius.sm, cursor: 'pointer', flexShrink: 0,
          font: 'inherit', fontWeight: 550, color: hover ? tk.accent.text : tk.text.muted, textDecoration: 'underline', textDecorationColor: tk.border.default, textUnderlineOffset: 3,
        }}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        Scene builder
      </button>
      {sep}
      <span data-scene-crumb-kind style={{ flexShrink: 0 }}>{sceneKindInfo(kind).title}</span>
      {leaf && <>{sep}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{leaf}</span></>}
    </span>
  );
}
