/**
 * ScenePreview — the Scene Builder's live picture: the spec built into a graph
 * (the same graph Build makes), compiled, and drawn by a small WebGL2 canvas
 * of its own, so the form can be tried before anything touches the canvas.
 * Recompiles while a slider moves (components/builders/useBuilderPreview.ts:
 * uniforms only when the shaders stay the same); animates (the camera's orbit)
 * every frame at the screen's density while it is on screen.
 */
import { useMemo, useRef, useState } from 'react';
import type { SceneSpec } from '../../sceneBuilder/spec';
import { compileSpec } from './previewGl';
import { useBuilderPreview, useThrottled } from '../builders/useBuilderPreview';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

export function ScenePreview({ spec, height = 240 }: { spec: SceneSpec; height?: number }) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Follows a drag (a compile every 50 ms at most); a value kept as a uniform only sets it (useBuilderPreview).
  const shown = useThrottled(spec);
  const compiled = useMemo(() => compileSpec(shown), [shown]);
  const [paused, setPaused] = useState(false);
  const error = useBuilderPreview(canvasRef, compiled, paused);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', height, borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render }}>
        <canvas ref={canvasRef} data-scene-preview aria-label="Live preview of the scene" style={{ width: '100%', height: '100%', display: 'block' }} />
        {error && (
          <div style={{ position: 'absolute', inset: 0, padding: 12, overflow: 'auto', color: '#f38ba8', font: `500 11px ${fontFamily.mono}`, background: 'rgba(13,13,18,0.86)' }}>
            {error}
          </div>
        )}
        <button type="button" onClick={() => setPaused(p => !p)} title={paused ? 'Play the preview' : 'Pause the preview'}
          style={{ position: 'absolute', right: 6, bottom: 6, height: 24, padding: '0 8px', border: 0, borderRadius: 6, background: 'rgba(0,0,0,0.45)', color: '#fff', font: `600 11px ${fontFamily.ui}`, cursor: 'pointer' }}>
          {paused ? 'Play' : 'Pause'}
        </button>
      </div>
      <span style={{ fontSize: 11.5, color: tk.text.muted }}>{error ? 'The preview could not draw this scene.' : `Live: the graph Done adds, compiled in ${Math.round(compiled.ms)} ms`}</span>
    </div>
  );
}
