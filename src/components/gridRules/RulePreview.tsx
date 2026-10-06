/**
 * The Grid Rules editor's live preview: the rule run on the CPU (gridRules/cpu.ts) on a small
 * board, a few steps a second, so a change to the rule shows at once. The node itself runs on the
 * GPU at the board size it is set to; this is a sketch of the same rule.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { cpuColours, cpuSeed, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { gridShape } from '../../gridRules/spec';

const W = 96, H = 64;

export function RulePreview({ params }: { params: Record<string, unknown> }) {
  const tk = useTokens();
  const canvas = useRef<HTMLCanvasElement>(null);
  const board = useRef<CpuBoard | null>(null);
  const live = useRef(params);
  const [running, setRunning] = useState(true);
  const [deal, setDeal] = useState(0);
  const shape = gridShape(params);
  // A new board when the kind of rule or the start changes (as the node's signature does), or on "Deal again".
  const key = `${shape.type}:${shape.template}:${shape.start}:${deal}`;
  useEffect(() => { live.current = params; });
  useEffect(() => { board.current = cpuSeed(live.current, W, H); }, [key]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(W, H);
    let raf = 0, last = 0;
    const smooth = shape.type === 'smooth';
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (!board.current) return;
      // Discrete rules step about 12 times a second (readable); smooth ones run several steps a frame.
      if (running && (smooth || t - last > 80)) {
        last = t;
        for (let k = 0; k < (smooth ? (shape.template === 'reaction' ? 8 : 2) : 1); k++) board.current = cpuStep(live.current, board.current);
      }
      cpuColours(live.current, board.current, img.data);
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, shape.type, shape.template]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <canvas
        ref={canvas} width={W} height={H} aria-label="Preview of the rule"
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, imageRendering: 'pixelated', borderRadius: radius.md, background: tk.bg.render, display: 'block' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton icon={running ? 'pause' : 'play'} label={running ? 'Pause the preview' : 'Run the preview'} onClick={() => setRunning(r => !r)} />
        <IconButton icon="dice" label="Deal a new preview board" onClick={() => setDeal(d => d + 1)} />
        <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted, lineHeight: 1.35 }}>
          A sketch on the CPU ({W} × {H}){shape.type === 'smooth' && shape.template === 'custom' ? '; your update shows on the picture' : ''}.
        </span>
      </div>
    </div>
  );
}
