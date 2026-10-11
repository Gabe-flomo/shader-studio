/**
 * TryBoard — the Grid Rules builder's viewport (docs/grid-rules.md, "The builder"): a small board
 * you draw on and step through before building, run on the CPU with the node's own rule
 * (gridRules/cpu.ts; it matches the GPU step, gridRulesCpuGpu.test.ts).
 *
 *  - Draw: click or drag to place cells of the picked state; a cell already that state is erased
 *    (drag on to keep erasing). Smooth: a drop of value.
 *  - Step: ⏮ back to the start, ◀ one generation back, ▶ play / pause, ▶| one forward (← → and
 *    Space when the board has focus). Slow · Medium · As built.
 *  - Pictures over the board, for the section being edited: what the next step does (born, dies),
 *    the cells a hovered cell counts and what they make of it, the cells a hovered count switch
 *    stands for, the cells a stencil matches, the 2×2 blocks of the next step.
 *  - Under the hood: every cell's numbers.
 *  - Use as the start: the cells on the board become the node's start (stamped in the middle).
 *  - Text stamp: words in the stroke font (gridRules/textCells.ts), stamped where you click, in the
 *    picked state; the cells it will cover are outlined under the pointer.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { cpuColours, cpuStep, cpuStepUpTo } from '../../gridRules/cpu';
import { GRID_DEFAULTS, countsAsRanges, gridShape, maxCount, countsOf } from '../../gridRules/spec';
import { TEST_PATTERNS, countLabel, rangeCounts, type TestPattern } from '../../gridRules/explain';
import { blockRects, boardLife, canBack, changesBetween, liveNeighbours, neighbourCells, patternMatches, tryGeneration } from '../../gridRules/tryRun';
import { TRY_SPEEDS, drawingOf, useTryRun, type TrySpeed } from './useTryRun';
import { drawnCount } from '../../gridRules/startCells';
import { DEFAULT_START_TEXT, MAX_TEXT_CHARS, cleanStartText, readStartText, textStampCells } from '../../gridRules/textCells';
import { Field } from '../ui/Field';

type P = Record<string, unknown>;

/** What the inspector points at: the board draws its part. */
export interface TryFocus {
  section: string;
  /** A Stencils rule hovered (its index). */
  rule?: number | null;
  /** A Born / Survive count switch hovered. */
  count?: { row: 'born' | 'survive'; k: number } | null;
  /** A stacked rule card hovered (its index): the cells it changes next step. */
  card?: number | null;
}

const rgbCss = (c: unknown, fallback: number[]) => {
  const v = (Array.isArray(c) ? c : fallback) as number[];
  return `rgb(${v.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(',')})`;
};

export function stateColour(p: P, k: number): string {
  const key = k === 0 ? 'color0' : `color${Math.min(7, k)}`;
  return rgbCss(p[key], GRID_DEFAULTS[key] as number[]);
}

export function TryBoard({ params, nodeParams, focus, hood, onUseAsStart }: {
  params: P; nodeParams: P; focus: TryFocus; hood: boolean;
  onUseAsStart: (cells: ReturnType<typeof drawingOf>) => void;
}) {
  const tk = useTokens();
  const s = gridShape(params);
  const t = useTryRun(nodeParams);
  const { board: B } = t;
  const smooth = s.type === 'smooth';
  const top = s.type === 'count' ? 1 : smooth ? 1 : Math.max(2, Math.round(Number(params.states))) - 1;
  const [brush, setBrush] = useState(1);
  useEffect(() => { if (brush > top) setBrush(1); }, [brush, top]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [showNext, setShowNext] = useState(true);
  // The Text stamp: words (the node's text start's to begin with) and their height in cells.
  const [stamp, setStamp] = useState<{ on: boolean; text: string; size: number }>(() => {
    const st = readStartText(params.startText);
    return { on: false, text: st.text || DEFAULT_START_TEXT.text, size: Math.min(st.size, 12) };
  });
  const stampWeight = readStartText(params.startText).weight;
  const stampCells = (at: [number, number]) => textStampCells(stamp.text, stamp.size, stampWeight, at[0], at[1]);

  // Fit: whole pixels a cell, centred.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); setStage(b => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height })); };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cell = Math.max(2, Math.floor(Math.min((stage.w - 24) / B.w, (stage.h - 24) / B.h)));
  const W = B.w * cell, H = B.h * cell;

  // The picture.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(B.w, B.h);
    cpuColours(params, B, img.data);
    ctx.putImageData(img, 0, 0);
  });

  // What the next step does (not while playing: it would flicker).
  const next = useMemo(() => (t.run.at < t.run.frames.length - 1 ? t.run.frames[t.run.at + 1] : cpuStep(params, B)), [t.run, params, B]);
  const changes = useMemo(() => (!smooth && !t.playing ? changesBetween(B, next) : null), [B, next, smooth, t.playing]);

  // Drawing: a stroke paints the picked state, or erases when it starts on a cell of that state.
  const stroke = useRef<{ state: number; last: string } | null>(null);
  const cellAt = (e: React.PointerEvent): [number, number] | null => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / cell), row = Math.floor((e.clientY - r.top) / cell);
    if (x < 0 || row < 0 || x >= B.w || row >= B.h) return null;
    return [x, B.h - 1 - row];
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const c = cellAt(e);
    if (!c) return;
    if (stamp.on && !smooth) {
      // The Text stamp: the letters' cells in the picked state (state 1 when the eraser is picked; Shift erases).
      t.paint(stampCells(c), e.shiftKey ? 0 : brush || 1);
      return;
    }
    if (stamp.on && smooth) { t.paint(stampCells(c), e.shiftKey ? 0 : 1); return; }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const here = smooth ? (B.a[c[1] * B.w + c[0]] > 0.5 ? 1 : 0) : Math.round(B.a[c[1] * B.w + c[0]]);
    const state = e.shiftKey || (here === brush && brush !== 0) ? 0 : brush;
    stroke.current = { state, last: c.join() };
    t.paint([c], state);
  };
  const onMove = (e: React.PointerEvent) => {
    const c = cellAt(e);
    setHover(c);
    if (!stroke.current || !c || c.join() === stroke.current.last) return;
    stroke.current.last = c.join();
    t.paint([c], stroke.current.state);
  };
  const onUp = () => { stroke.current = null; };

  // Keys: ← → step, Space plays.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); t.forward(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); t.back(); } else if (e.key === ' ') { e.preventDefault(); t.setPlaying(!t.playing); }
  };

  const life = boardLife(params, B);
  const gen = tryGeneration(t.run);
  const px = (x: number) => x * cell, py = (y: number) => (B.h - 1 - y) * cell;
  const overlay: ReactNode[] = [];
  const ink = (c: string, a = 1) => alpha(c, a);

  // Grid lines where cells are big enough to see.
  if (cell >= 9) {
    let d = '';
    for (let x = 1; x < B.w; x++) d += `M${x * cell} 0V${H}`;
    for (let y = 1; y < B.h; y++) d += `M0 ${y * cell}H${W}`;
    overlay.push(<path key="lines" d={d} stroke="rgba(255,255,255,0.07)" strokeWidth={1} fill="none" />);
  }
  const counting = s.type === 'count' || s.type === 'stages';
  let matchNoteStack: string | null = null;
  // The cells a hovered count switch stands for: empty cells with that many (Born), live ones (Survive).
  if (counting && focus.count && !t.playing) {
    const { row, k } = focus.count;
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
      const st = Math.round(B.a[y * B.w + x]);
      if ((row === 'born' ? st !== 0 : st !== 1) || liveNeighbours(params, B, x, y) !== k) continue;
      overlay.push(<rect key={`c${x},${y}`} x={px(x) + 1} y={py(y) + 1} width={cell - 2} height={cell - 2} rx={2} fill="none" stroke={row === 'born' ? '#3fbf7f' : tk.accent.base} strokeWidth={2} />);
    }
  } else if (focus.section === 'stack' && focus.card != null && !t.playing) {
    // A stacked card: the board as the base and the cards before it leave it, and what this card does to it.
    const before = cpuStepUpTo(params, B, focus.card), after = cpuStepUpTo(params, B, focus.card + 1);
    const ch = changesBetween(before, after);
    matchNoteStack = `Card ${focus.card + 1} changes ${ch.size} cell${ch.size === 1 ? '' : 's'} next step`;
    for (const [i, kind] of ch) {
      const x = i % B.w, y = Math.floor(i / B.w);
      overlay.push(<rect key={`k${i}`} x={px(x) + 1} y={py(y) + 1} width={cell - 2} height={cell - 2} rx={2} fill={ink(kind === 'born' ? '#3fbf7f' : kind === 'dies' ? '#ff5a5a' : '#f0b43c', 0.3)} stroke={kind === 'born' ? '#3fbf7f' : kind === 'dies' ? '#ff5a5a' : '#f0b43c'} strokeWidth={2} />);
    }
  } else if (showNext && changes && cell >= 6 && (focus.section === 'rule' || focus.section === 'neighbourhood' || focus.section === 'stack')) {
    // What the next step does: a green ring where a cell is born, a red cross where one dies.
    for (const [i, kind] of changes) {
      const x = i % B.w, y = Math.floor(i / B.w);
      const cx = px(x) + cell / 2, cy = py(y) + cell / 2, r = cell * 0.3;
      if (kind === 'born') overlay.push(<circle key={`n${i}`} cx={cx} cy={cy} r={r} fill="none" stroke="#3fbf7f" strokeWidth={Math.max(1.2, cell / 9)} />);
      else if (kind === 'dies') overlay.push(<path key={`n${i}`} d={`M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}`} stroke="#ff5a5a" strokeWidth={Math.max(1.2, cell / 9)} />);
      else overlay.push(<circle key={`n${i}`} cx={cx} cy={cy} r={r * 0.6} fill="#f0b43c" />);
    }
  }
  // Stencils: the cells a hovered rule matches now.
  let matchNote: string | null = matchNoteStack;
  if (s.type === 'patterns' && focus.rule != null && focus.section === 'rule') {
    const m = patternMatches(params, B, focus.rule);
    matchNote = `Rule ${focus.rule + 1} matches ${m.size} cell${m.size === 1 ? '' : 's'} here`;
    for (const i of m) overlay.push(<rect key={`m${i}`} x={px(i % B.w) + 1} y={py(Math.floor(i / B.w)) + 1} width={cell - 2} height={cell - 2} rx={2} fill={ink(tk.accent.base, 0.25)} stroke={tk.accent.base} strokeWidth={2} />);
  }
  // Blocks: the 2×2 blocks of the next step.
  if (s.type === 'blocks' && focus.section === 'rule' && cell >= 5) {
    let d = '';
    for (const [ox, oy] of blockRects(params, B)) d += `M${px(ox)} ${py(oy + 1)}h${2 * cell}v${2 * cell}h${-2 * cell}Z`;
    overlay.push(<path key="blocks" d={d} fill="none" stroke={ink(tk.accent.base, 0.55)} strokeWidth={1.5} />);
  }
  // The hovered cell: its neighbourhood, and what the rule makes of it.
  let hoverNote: string | null = null;
  if (hover) {
    const [x, y] = hover;
    const i = y * B.w + x;
    if (counting) {
      for (const [nx, ny] of neighbourCells(params, B, x, y)) overlay.push(<rect key={`h${nx},${ny}`} x={px(nx) + 0.5} y={py(ny) + 0.5} width={cell - 1} height={cell - 1} fill={ink('#ffffff', 0.08)} stroke={ink('#9cc1ff', 0.9)} strokeWidth={1} />);
      const st = Math.round(B.a[i]);
      const k = liveNeighbours(params, B, x, y);
      const max = maxCount(s.neighbourhood, s.radius, s.shape, s.stencil);
      const radiusMode = countsAsRanges(s);
      const born = radiusMode ? rangeCounts(Number(params.bornLo), Number(params.bornHi)) : countsOf(Number(params.bornMask), max);
      const survive = radiusMode ? rangeCounts(Number(params.surviveLo), Number(params.surviveHi)) : countsOf(Number(params.surviveMask), max);
      hoverNote = st >= 2 ? `A dying cell (stage ${st - 1}): it fades on, whatever is round it.` : countLabel(st === 1 ? 'survive' : 'born', k, born, survive, s.type === 'stages');
    } else if (smooth) {
      hoverNote = s.template === 'reaction' ? `food ${(B.a[i]).toFixed(3)} · B ${B.b[i].toFixed(3)}` : `value ${B.a[i].toFixed(3)}${s.template === 'waves' ? ` · a step ago ${B.b[i].toFixed(3)}` : ''}`;
    } else hoverNote = `State ${Math.round(B.a[i])}${changes?.has(i) ? ` → ${Math.round(next.a[i])} next step` : ''}`;
    overlay.push(<rect key="hover" x={px(x) + 0.5} y={py(y) + 0.5} width={cell - 1} height={cell - 1} fill="none" stroke="#fff" strokeWidth={1.5} />);
  }
  // The Text stamp: the cells it will cover.
  if (stamp.on && hover) {
    let d = '';
    for (const [x, y] of stampCells(hover)) if (x >= 0 && y >= 0 && x < B.w && y < B.h) d += `M${px(x) + 1} ${py(y) + 1}h${cell - 2}v${cell - 2}h${-(cell - 2)}Z`;
    overlay.push(<path key="stamp" d={d} fill={ink(tk.accent.base, 0.35)} stroke={tk.accent.base} strokeWidth={1} data-stamp-preview />);
  }
  // Under the hood: each cell's numbers.
  if (hood && cell >= 9) {
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
      const i = y * B.w + x;
      const v = smooth ? (s.template === 'reaction' ? B.b[i] : B.a[i]).toFixed(1).replace(/^0\./, '.') : counting ? String(liveNeighbours(params, B, x, y)) : String(Math.round(B.a[i]));
      // Zeros left out: the numbers that matter stand out.
      if (v === '0' || v === '.0') continue;
      overlay.push(<text key={`t${i}`} x={px(x) + cell / 2} y={py(y) + cell / 2 + 3.5} textAnchor="middle" fontSize={Math.min(11, cell * 0.8)} fill={!smooth && Math.round(B.a[i]) > 0 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.8)'} style={{ font: `600 ${Math.min(11, cell * 0.8)}px ${fontFamily.mono}` }}>{v}</text>);
    }
  }

  const sep = <span style={{ width: 1, height: 22, background: tk.border.subtle, flexShrink: 0 }} />;
  const drawn = drawingOf(params, B);
  return (
    <div data-try-board style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: tk.bg.render }}>
      <div ref={stageRef} tabIndex={0} onKeyDown={onKey} aria-label="Try board: draw cells, then step through" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}>
        <div data-try-surface style={{ position: 'relative', width: W, height: H, cursor: stamp.on ? 'copy' : 'crosshair', touchAction: 'none', boxShadow: `0 0 0 1px ${tk.border.default}` }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}>
          <canvas ref={canvasRef} width={B.w} height={B.h} aria-label="The try board" style={{ width: W, height: H, imageRendering: 'pixelated', display: 'block' }} />
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{overlay}</svg>
        </div>
        {/* Top left: what this is, and the generation. */}
        <div style={{ position: 'absolute', left: 12, top: 10, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none', maxWidth: '60%' }}>
          <span data-try-gen style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary, background: alpha(tk.bg.panel, 0.85), padding: '3px 8px', borderRadius: radius.sm, alignSelf: 'flex-start' }}>
            {gen === 0 ? 'Start' : `Step ${gen}`}{smooth ? '' : ` · ${life.live} live`}
          </span>
          {(hoverNote || matchNote) && <span data-try-note style={{ fontSize: 12, color: tk.text.primary, background: alpha(tk.bg.panel, 0.85), padding: '4px 8px', borderRadius: radius.sm, alignSelf: 'flex-start', lineHeight: 1.4 }}>{hoverNote ?? matchNote}</span>}
        </div>
        {/* Top right: the legend of the marks. */}
        {!smooth && (focus.section === 'rule' || focus.section === 'neighbourhood' || focus.section === 'stack') && !focus.count && (
          <label style={{ position: 'absolute', right: 12, top: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: tk.text.secondary, background: alpha(tk.bg.panel, 0.85), padding: '4px 8px', borderRadius: radius.sm }}>
            <input type="checkbox" checked={showNext} onChange={e => setShowNext(e.target.checked)} data-try-show-next />
            Next step:
            <svg width={12} height={12}><circle cx={6} cy={6} r={4} fill="none" stroke="#3fbf7f" strokeWidth={1.6} /></svg> born
            <svg width={12} height={12}><path d="M2 2L10 10M10 2L2 10" stroke="#ff5a5a" strokeWidth={1.6} /></svg> dies
            {s.type !== 'count' && <><svg width={12} height={12}><circle cx={6} cy={6} r={3} fill="#f0b43c" /></svg> changes</>}
          </label>
        )}
        {hood && (
          <div data-try-hood style={{ position: 'absolute', right: 12, bottom: 12, width: 270, padding: 12, borderRadius: radius.card, background: alpha(tk.bg.panel, 0.95), boxShadow: `inset 0 0 0 1px ${tk.border.default}`, fontSize: 12, lineHeight: 1.5, color: tk.text.secondary, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b style={{ color: tk.text.primary, fontSize: 13 }}>Under the hood</b>
            <span>{counting ? 'Each number is how many live cells the rule counts round that cell.' : smooth ? (s.template === 'reaction' ? 'Each number is how much of B the cell holds (0 to 1).' : 'Each number is the cell\'s value.') : 'Each number is the cell\'s state.'}</span>
            <span>On the GPU the board is a texture the size of the board: red holds the {smooth ? 'value' : 'state'}, green {smooth ? 'the second value' : 'the age or afterglow'}, blue the step clock, alpha the rule’s signature (a new one deals a new board).</span>
            {cell < 9 && <span style={{ color: tk.text.faint }}>Cells are too small for numbers: make the window bigger.</span>}
          </div>
        )}
      </div>
      {/* The toolbar: draw · step · deal · use as the start. */}
      <div data-try-toolbar style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, flexWrap: 'wrap', rowGap: 6 }}>
        <span style={{ fontSize: 11.5, color: tk.text.muted }}>{smooth ? 'Drop' : 'Draw'}</span>
        {!smooth && (
          <span role="radiogroup" aria-label="State to draw" style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: top + 1 }, (_, k) => k).map(k => (
              <button key={k} type="button" role="radio" aria-checked={brush === k} data-try-brush={k} title={k === 0 ? 'Erase (or Shift-drag)' : `Draw state ${k}`} onClick={() => setBrush(k)}
                style={{
                  width: 24, height: 24, padding: 0, border: 0, borderRadius: 6, cursor: 'pointer', background: stateColour(params, k),
                  boxShadow: brush === k ? `0 0 0 2px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`,
                  color: '#888', font: `600 10px ${fontFamily.mono}`,
                }}>{k === 0 ? '⌫' : top > 1 ? k : ''}</button>
            ))}
          </span>
        )}
        <IconButton icon="text" size="sm" label={stamp.on ? 'Stop stamping text (draw cells again)' : 'Text stamp: click the board to stamp words there, in the picked state'} active={stamp.on}
          onClick={() => setStamp(x => ({ ...x, on: !x.on }))} data-try-stamp />
        {stamp.on && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 92 }}>
              <Field aria-label="Words to stamp" height={28} value={stamp.text} maxLength={MAX_TEXT_CHARS} data-try-stamp-words
                onChange={e => setStamp(x => ({ ...x, text: cleanStartText(e.target.value) }))} />
            </span>
            <span style={{ width: 58 }}>
              <Select ariaLabel="Letter height (cells)" height={28} value={String(stamp.size)} onChange={v => setStamp(x => ({ ...x, size: Number(v) }))}
                options={[5, 6, 7, 8, 10, 12, 16, 20].map(n => ({ value: String(n), label: `${n}` }))} />
            </span>
          </span>
        )}
        <IconButton icon="trash" size="sm" label="Clear the board" onClick={t.clear} data-try-clear />
        <IconButton icon="dice" size="sm" label="Deal again (as the Start deals it)" onClick={t.deal} data-try-deal />
        {counting && (
          <span style={{ width: 128 }}>
            <Select ariaLabel="Test pattern" height={28} value="" onChange={v => v && t.pattern(v as TestPattern)}
              options={[{ value: '', label: 'Test pattern…' }, ...TEST_PATTERNS.map(p => ({ value: p.key, label: p.label }))]} />
          </span>
        )}
        {sep}
        <IconButton icon="reset" size="sm" label="Back to the first step kept" onClick={t.rewind} disabled={!canBack(t.run)} data-try-rewind />
        <IconButton icon="chevL" size="sm" label="One step back (←)" onClick={t.back} disabled={!canBack(t.run)} data-try-back />
        <IconButton icon={t.playing ? 'pause' : 'play'} size="sm" label={t.playing ? 'Pause (Space)' : 'Play (Space)'} active={t.playing} onClick={() => t.setPlaying(!t.playing)} data-try-play />
        <IconButton icon="chevR" size="sm" label="One step forward (→)" onClick={t.forward} data-try-forward />
        <Segmented<TrySpeed> size="sm" ariaLabel="Try speed" value={t.speed} onChange={t.setSpeed} options={TRY_SPEEDS.map(x => ({ value: x.value, label: x.label }))} />
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="check" disabled={!drawn} data-try-use-start
          title={drawn ? `Start the node's board from the ${drawnCount(drawn)} cells here, in the middle of the board (one undo step)` : 'Draw some cells first'}
          onClick={() => onUseAsStart(drawn)}>
          Use as the start
        </Button>
      </div>
    </div>
  );
}
