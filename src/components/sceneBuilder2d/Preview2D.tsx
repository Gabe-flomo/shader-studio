/**
 * Preview2D — the 2D Scene Builder's live picture: the scene built into the graph Build makes,
 * compiled, and drawn by a small WebGL2 canvas of its own (the 3D builder's previewGl), so the form
 * can be tried before anything touches the canvas. It follows a slider while it moves
 * (components/builders/useBuilderPreview.ts).
 */
import { useMemo, useRef, useState } from 'react';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import type { Scene2D } from '../../sceneBuilder2d/spec';
import type { Compiled } from '../sceneBuilder/previewGl';
import { useBuilderPreview, useThrottled } from '../builders/useBuilderPreview';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

export function compileScene2D(scene: Scene2D): Compiled {
  const t0 = performance.now();
  try {
    const g = buildStandalone2D(scene, { idFor: role => `pv2_${role.replace(/[^A-Za-z0-9]/g, '_')}` });
    const r = compileGraph({ nodes: g.nodes });
    if (!r.success) return { vs: '', fs: '', uniforms: {}, nodes: g.nodes.length, error: (r.errors ?? []).join('; ') || 'The graph did not compile.', ms: performance.now() - t0 };
    return { vs: r.vertexShader, fs: r.fragmentShader, uniforms: r.paramUniforms as Record<string, number | number[]>, nodes: g.nodes.length, error: null, ms: performance.now() - t0, textures: r.textureUniforms };
  } catch (e) {
    return { vs: '', fs: '', uniforms: {}, nodes: 0, error: e instanceof Error ? e.message : String(e), ms: 0 };
  }
}

export function Preview2D({ scene, compiled: given, height = 260 }: {
  scene: Scene2D;
  /** The scene already compiled (the Preview panel compiles once for the picture and the node count). */
  compiled?: Compiled;
  height?: number;
}) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Follows a drag (a compile every 50 ms at most); a value kept as a uniform only sets it (useBuilderPreview).
  const shown = useThrottled(scene);
  const own = useMemo(() => (given ? null : compileScene2D(shown)), [given, shown]);
  const compiled = given ?? own!;
  const [paused, setPaused] = useState(false);
  const error = useBuilderPreview(canvasRef, compiled, paused);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', height, borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render }}>
        <canvas ref={canvasRef} data-scene2d-preview aria-label="Live preview of the 2D scene" style={{ width: '100%', height: '100%', display: 'block' }} />
        {error && (
          <div style={{ position: 'absolute', inset: 0, padding: 12, overflow: 'auto', color: '#f38ba8', font: `500 11px ${fontFamily.mono}`, background: 'rgba(13,13,18,0.86)' }}>{error}</div>
        )}
        <button type="button" onClick={() => setPaused(p => !p)} title={paused ? 'Play the preview' : 'Pause the preview'}
          style={{ position: 'absolute', right: 6, bottom: 6, height: 24, padding: '0 8px', border: 0, borderRadius: 6, background: 'rgba(0,0,0,0.45)', color: '#fff', font: `600 11px ${fontFamily.ui}`, cursor: 'pointer' }}>
          {paused ? 'Play' : 'Pause'}
        </button>
      </div>
      <span style={{ fontSize: 11.5, color: tk.text.muted }}>{error ? 'The preview could not draw this scene.' : `Live: the graph Build makes (${compiled.nodes} nodes), compiled in ${Math.round(compiled.ms)} ms`}</span>
    </div>
  );
}
