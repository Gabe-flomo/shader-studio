/**
 * The mini transfer plot beside an explanation (lib/glslPatterns/plot.ts): x is the one input
 * over a range picked from the literals, y the result, edges marked and labelled. About 120×60
 * inline; a click opens it larger with the axes' numbers.
 */
import { useState } from 'react';
import { fmt, type TransferPlot } from '../../lib/glslPatterns';
import { C, C_LIGHT } from '../glslSyntax';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { typeColor } from './ExplainText';

export function TransferPlotView({ plot, resultName }: { plot: TransferPlot; resultName?: string }) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  const pal = dark ? C : C_LIGHT;
  const [big, setBig] = useState(false);
  const W = big ? 360 : 120, H = big ? 168 : 60;
  const padL = big ? 34 : 4, padR = big ? 10 : 4, padT = big ? 10 : 4, padB = big ? 26 : 12;
  const x = (v: number) => padL + ((v - plot.from) / (plot.to - plot.from)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - plot.yMin) / (plot.yMax - plot.yMin)) * (H - padT - padB);
  const d = plot.points.map(([px, py], i) => `${i ? 'L' : 'M'}${x(px).toFixed(1)},${y(py).toFixed(1)}`).join('');
  const zeroY = plot.yMin < 0 && plot.yMax > 0 ? y(0) : null;
  const curve = typeColor('float', pal);
  const label = `${resultName ?? 'The result'} plotted against ${plot.input} from ${fmt(plot.from)} to ${fmt(plot.to)}${plot.edges.length ? `, with edges at ${plot.edges.map(fmt).join(', ')}` : ''}. ${big ? 'Click to shrink' : 'Click to enlarge'}.`;
  const small = `500 ${big ? 10.5 : 8.5}px ${fontFamily.mono}`;
  return (
    <button type="button" data-transfer-plot={big ? 'big' : 'small'} onClick={() => setBig(b => !b)} aria-label={label} title={big ? 'Click to shrink' : `${resultName ?? 'Result'} against ${plot.input}: click to enlarge`}
      style={{ flexShrink: 0, padding: 0, border: 0, borderRadius: radius.sm, background: tk.bg.field, cursor: 'zoom-in', lineHeight: 0, alignSelf: 'flex-start' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {zeroY !== null && <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke={tk.border.default} strokeWidth={1} />}
        {plot.edges.map(e => (
          <g key={e}>
            <line x1={x(e)} x2={x(e)} y1={padT} y2={H - padB} stroke={alpha(pal.number, 0.75)} strokeWidth={1} strokeDasharray="2 2" />
            <text x={Math.min(Math.max(x(e), padL + 8), W - padR - 8)} y={H - (big ? 14 : 2)} textAnchor="middle" fill={pal.number} style={{ font: small }}>{fmt(e)}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke={curve} strokeWidth={big ? 2 : 1.5} strokeLinejoin="round" />
        {big && (
          <>
            <text x={padL - 4} y={y(plot.yHi) + 4} textAnchor="end" fill={tk.text.faint} style={{ font: small }}>{fmt(Math.round(plot.yHi * 100) / 100)}</text>
            <text x={padL - 4} y={y(plot.yLo) + 4} textAnchor="end" fill={tk.text.faint} style={{ font: small }}>{fmt(Math.round(plot.yLo * 100) / 100)}</text>
            <text x={padL} y={H - 2} fill={tk.text.faint} style={{ font: small }}>{fmt(plot.from)}</text>
            <text x={W - padR} y={H - 2} textAnchor="end" fill={tk.text.faint} style={{ font: small }}>{fmt(plot.to)}</text>
            <text x={(padL + W - padR) / 2} y={H - 2} textAnchor="middle" fill={typeColor(plot.inputType, pal)} style={{ font: small }}>{plot.input} →</text>
          </>
        )}
      </svg>
    </button>
  );
}
