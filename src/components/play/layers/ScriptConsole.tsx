/**
 * ScriptConsole — the Sketch editor's console: what the layer's sketch prints
 * (console.log / warn / error / table, print), its errors with file:line links
 * to the right tab, and the values it watches, each on one live line with a
 * small graph. Repeats fold into one line with a count; Pause freezes what
 * shows; Keep old output keeps the lines when the sketch starts over.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { toast } from '../../ui/toastStore';
import { clearScriptConsole, consoleCopyText, keepOldOutput, setKeepOldOutput, useScriptConsole, type ConsoleLine, type ConsoleValue, type LayerConsole } from '../../../play/scriptConsole';

/** A logged value: numbers, strings and the like inline; objects and arrays open as trees; vectors and colours compact. */
function ValueView({ v, top = false }: { v: ConsoleValue; top?: boolean }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const mono = { fontFamily: fontFamily.mono };
  switch (v.t) {
    case 'num': return <span style={{ ...mono, color: tk.syntax.number }}>{String(Math.round(v.v * 1e6) / 1e6)}</span>;
    case 'str': return <span style={{ ...mono, color: top ? tk.text.primary : tk.syntax.number, whiteSpace: 'pre-wrap' }}>{top ? v.v : JSON.stringify(v.v)}</span>;
    case 'bool': return <span style={{ ...mono, color: tk.accent.base }}>{String(v.v)}</span>;
    case 'null': case 'undef': return <span style={{ ...mono, color: tk.text.faint }}>{v.t === 'null' ? 'null' : 'undefined'}</span>;
    case 'fn': return <span style={{ ...mono, color: tk.text.muted, fontStyle: 'italic' }}>ƒ {v.name}()</span>;
    case 'err': return <span style={{ ...mono, color: tk.status.danger }}>{v.message}</span>;
    case 'more': return <span style={{ color: tk.text.faint }}>…</span>;
    case 'vec': return <span style={{ ...mono, color: tk.text.primary }}><span style={{ color: tk.text.faint }}>vec</span>({[v.x, v.y, v.z].map(n => Math.round(n * 1000) / 1000).join(', ')})</span>;
    case 'colour': return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...mono }}>
        <span style={{ width: 11, height: 11, borderRadius: 3, background: v.css, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />
        <span style={{ color: tk.text.secondary }}>{v.levels.join(', ')}</span>
      </span>
    );
    case 'arr': case 'obj': {
      const entries: Array<[string, ConsoleValue]> = v.t === 'arr' ? v.items.map((x, i) => [String(i), x]) : v.entries;
      const head = v.t === 'arr' ? `${v.name ?? ''}[${v.items.length + v.more}]` : `${v.name ? `${v.name} ` : ''}{${v.entries.length + v.more}}`;
      return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', verticalAlign: 'top', ...mono }}>
          <button type="button" onClick={() => setOpen(o => !o)} style={{ all: 'unset', cursor: 'pointer', color: tk.text.secondary }}>{open ? '▾' : '▸'} {head}</button>
          {open && (
            <span style={{ display: 'flex', flexDirection: 'column', paddingLeft: 14 }}>
              {entries.map(([k, x]) => <span key={k}><span style={{ color: tk.text.faint }}>{k}: </span><ValueView v={x} /></span>)}
              {v.more > 0 && <span style={{ color: tk.text.faint }}>… {v.more} more</span>}
            </span>
          )}
        </span>
      );
    }
  }
}

/** console.table's rows as a small table. */
function TableView({ v }: { v: ConsoleValue }) {
  const tk = useTokens();
  const rows: Array<[string, ConsoleValue]> = v.t === 'arr' ? v.items.map((x, i) => [String(i), x]) : v.t === 'obj' ? v.entries : [];
  const cols = [...new Set(rows.flatMap(([, r]) => (r.t === 'obj' ? r.entries.map(e => e[0]) : ['value'])))].slice(0, 8);
  const cell = { padding: '1px 6px', borderBottom: `1px solid ${tk.border.subtle}`, textAlign: 'left' as const };
  return (
    <table style={{ borderCollapse: 'collapse', font: `11px ${fontFamily.mono}`, margin: '2px 0' }}>
      <thead><tr><th style={cell}>(index)</th>{cols.map(c => <th key={c} style={cell}>{c}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 50).map(([k, r]) => (
        <tr key={k}><td style={{ ...cell, color: tk.text.faint }}>{k}</td>{cols.map(c => { const x = r.t === 'obj' ? r.entries.find(e => e[0] === c)?.[1] : c === 'value' ? r : undefined; return <td key={c} style={cell}>{x ? <ValueView v={x} /> : ''}</td>; })}</tr>
      ))}</tbody>
    </table>
  );
}

function Sparkline({ values, colour }: { values: number[]; colour: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), w = 64, h = 14;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 1 - ((v - lo) / (hi - lo || 1)) * (h - 2)}`).join(' ');
  return <svg width={w} height={h} style={{ flexShrink: 0 }} aria-hidden><polyline points={pts} fill="none" stroke={colour} strokeWidth={1.2} /></svg>;
}

export function ScriptConsolePane({ layerId, onJump, height = 170 }: { layerId: string; onJump: (file: string, line: number) => void; height?: number }) {
  const tk = useTokens();
  const live = useScriptConsole(layerId);
  const [paused, setPaused] = useState<LayerConsole | null>(null);
  const [keep, setKeep] = useState(keepOldOutput());
  const [open, setOpen] = useState(true);
  const c = paused ?? live;
  const listRef = useRef<HTMLDivElement>(null);
  // Follow the newest line unless scrolled up.
  const stick = useRef(true);
  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [c]);
  const colour = (l: ConsoleLine) => (l.level === 'error' ? tk.status.danger : l.level === 'warn' ? tk.status.warningText : l.level === 'info' ? tk.accent.base : tk.text.primary);
  const errors = c.lines.filter(l => l.level === 'error').length;
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: radius.md, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 10px', borderBottom: open ? `1px solid ${tk.border.subtle}` : 'none', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(o => !o)} style={{ all: 'unset', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>
          {open ? '▾' : '▸'} Console{c.lines.length ? ` · ${c.lines.length}` : ''}{errors ? <span style={{ color: tk.status.danger }}> · {errors} error{errors === 1 ? '' : 's'}</span> : null}
        </button>
        {paused && <span style={{ fontSize: 11, color: tk.status.warningText }}>paused</span>}
        {c.dropped > 0 && <span style={{ fontSize: 11, color: tk.text.faint }}>{c.dropped} older lines dropped</span>}
        <span style={{ flex: 1 }} />
        <Toggle checked={keep} onChange={v => { setKeep(v); setKeepOldOutput(v); }} label={<span style={{ fontSize: 11, color: tk.text.muted }}>Keep old output</span>} />
        <IconButton icon={paused ? 'play' : 'pause'} size="sm" label={paused ? 'Resume the output' : 'Pause the output (the sketch keeps running)'} onClick={() => setPaused(p => (p ? null : live))} />
        <IconButton icon="copy" size="sm" label="Copy the console" onClick={() => { navigator.clipboard?.writeText(consoleCopyText(c)).then(() => toast.success('Copied the console'), () => toast.error('Couldn’t copy')); }} />
        <IconButton icon="trash" size="sm" label="Clear the console" onClick={() => { clearScriptConsole(layerId); setPaused(null); }} />
      </div>
      {open && (
        <div ref={listRef} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8; }}
          style={{ height, overflowY: 'auto', padding: '4px 0', font: `11.5px/1.5 ${fontFamily.mono}` }} aria-label="Console output" role="log">
          {c.watches.map(w => (
            <div key={`w:${w.name}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1px 10px', background: alpha(tk.accent.base, 0.06) }}>
              <span style={{ color: tk.accent.base, flexShrink: 0 }}>◉ {w.name}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}><ValueView v={w.value} top /></span>
              <Sparkline values={w.history} colour={tk.accent.base} />
            </div>
          ))}
          {!c.lines.length && !c.watches.length && <div style={{ padding: '2px 10px', color: tk.text.faint, fontFamily: fontFamily.ui, fontSize: 11.5 }}>Nothing yet. console.log(…) and print(…) show here; watch('name', value) keeps one live line.</div>}
          {c.lines.map(l => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '1px 10px', color: colour(l), background: l.level === 'error' ? alpha(tk.status.danger, 0.07) : l.level === 'warn' ? alpha(tk.status.warning, 0.07) : undefined }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', columnGap: 6 }}>
                {l.level === 'table' ? <TableView v={l.values[0] ?? { t: 'undef' }} /> : l.values.map((v, i) => <ValueView key={i} v={v} top />)}
              </span>
              {l.at && <button type="button" onClick={() => onJump(l.at!.file, l.at!.line)} style={{ all: 'unset', cursor: 'pointer', color: tk.accent.base, textDecoration: 'underline', flexShrink: 0 }} title="Show this line">{l.at.file}:{l.at.line}</button>}
              {l.count > 1 && <span style={{ flexShrink: 0, padding: '0 5px', borderRadius: 999, background: tk.bg.field, color: tk.text.muted, fontSize: 10.5 }}>×{l.count}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
