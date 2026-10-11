/**
 * One small canvas running one fragment shader on the Convert check's renderer (sideRender: WebGL2,
 * the app preview's prefix), animated. Guided Convert shows the selection's value with it.
 */
import { useEffect, useRef, useState } from 'react';
import { context, draw, program, type Side } from '../sideRender';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';

export function ProbeView({ shader, size = 112 }: { shader: string | null; size?: number }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const side = useRef<Side | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (ref.current && !side.current) side.current = context(ref.current);
    return () => { const s = side.current; if (s) { program(s, null); s.gl.getExtension('WEBGL_lose_context')?.loseContext(); } side.current = null; };
  }, []);
  useEffect(() => {
    const s = side.current;
    if (!s) return;
    program(s, shader);
    setError(s.error);
    if (!s.prog) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => { raf = requestAnimationFrame(tick); draw(s, size, size, (now - t0) / 1000, {}); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shader, size]);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <canvas ref={ref} width={size} height={size} style={{ width: size, height: size, borderRadius: radius.md, background: '#000', display: 'block' }} />
      {(error || !shader) && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, textAlign: 'center', color: tk.text.faint, font: `600 10.5px/1.3 ${fontFamily.ui}` }}>
          {error ? 'No picture for this' : 'Nothing to show'}
        </div>
      )}
    </div>
  );
}
