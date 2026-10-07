/**
 * The Grid Rules editor's live preview: the rule run on the CPU (gridRules/cpu.ts) on a small
 * board, a few steps a second, so a change to the rule shows at once. The node itself runs on the
 * GPU at the board size it is set to; this is a sketch of the same rule.
 *
 * MiniBoard is the same CPU run on a small patch that starts from a test pattern (Glider, Blinker,
 * R-pentomino, a random blob), beside the Born / Survive switches, to see what the rule does to it.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { cpuColours, cpuSeed, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { gridShape } from '../../gridRules/spec';
import { TEST_PATTERNS, liveCount, patternBoard, type TestPattern } from '../../gridRules/explain';

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

const MW = 26, MH = 26;

/** A small live board for the Born & Survive tab: pick a test pattern and watch the rule run on it. */
export function MiniBoard({ params }: { params: Record<string, unknown> }) {
  const tk = useTokens();
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(params);
  const [pattern, setPattern] = useState<TestPattern>('glider');
  const [deal, setDeal] = useState(0);
  const [running, setRunning] = useState(true);
  const [stats, setStats] = useState({ gen: 0, alive: 5 });
  // The board lives outside React (a ref), stepped by the animation frame or the One step button.
  const board = useRef<CpuBoard | null>(null);
  useEffect(() => { live.current = params; });
  const step = () => {
    if (!board.current) return;
    board.current = cpuStep(live.current, board.current);
    const alive = liveCount(board.current);
    setStats(s => ({ gen: s.gen + 1, alive }));
  };
  useEffect(() => {
    board.current = patternBoard(pattern, MW, MH);
    const alive = liveCount(board.current);
    queueMicrotask(() => setStats({ gen: 0, alive }));
  }, [pattern, deal]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(MW, MH);
    let raf = 0, last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (!board.current) return;
      // About 8 steps a second: slow enough to follow a glider.
      if (running && t - last > 125) {
        last = t;
        board.current = cpuStep(live.current, board.current);
        const alive = liveCount(board.current);
        setStats(s => ({ gen: s.gen + 1, alive }));
      }
      cpuColours(live.current, board.current, img.data);
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return (
    <div data-mini-board style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 212, flexShrink: 0 }}>
      <canvas ref={canvas} width={MW} height={MH} aria-label="Mini-board: the rule on a test pattern"
        style={{ width: 212, height: 212, imageRendering: 'pixelated', borderRadius: radius.md, background: tk.bg.render, display: 'block', boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }} role="group" aria-label="Test pattern">
        {TEST_PATTERNS.map(t => {
          const on = t.key === pattern;
          return (
            <button key={t.key} type="button" title={t.hint} aria-pressed={on} data-pattern={t.key}
              onClick={() => { setPattern(t.key); setDeal(d => d + 1); setRunning(true); }}
              style={{
                border: 0, cursor: 'pointer', padding: '4px 8px', borderRadius: radius.md, font: `500 11.5px ${fontFamily.ui}`,
                background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.primary,
                boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.subtle}`,
              }}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconButton size="sm" icon={running ? 'pause' : 'play'} label={running ? 'Pause the mini-board' : 'Run the mini-board'} onClick={() => setRunning(r => !r)} />
        <IconButton size="sm" icon="chevR" label="One step" disabled={running} onClick={step} />
        <IconButton size="sm" icon="reset" label="Start the pattern again" onClick={() => setDeal(d => d + 1)} />
        <span data-mini-count title="Steps since the pattern started · cells alive" style={{ font: `11px ${fontFamily.mono}`, color: tk.text.muted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>step {stats.gen} · {stats.alive} live</span>
      </div>
    </div>
  );
}
