/**
 * ScriptCard — the Script layer's card in the Layers panel keeps to a glimpse:
 * the first lines of draw(), highlighted and fading out, the sketch's files
 * as chips, and its error or last console line. The code itself lives in the
 * Sketch editor (ScriptModal); clicking the glimpse opens it.
 */
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { C, C_LIGHT } from '../../glslSyntax';
import { tokenizeJsLine } from '../../code/jsSyntax';
import { drawPreviewLines } from './scriptTools';
import { lastConsoleLine, useScriptConsole } from '../../../play/scriptConsole';

/** The draw function's first lines; a click (or Enter) opens the editor. */
export function DrawGlimpse({ files, onOpen, error }: { files: ReadonlyArray<{ name: string; code: string }>; onOpen: () => void; error?: boolean }) {
  const tk = useTokens();
  const pal = useThemeMode() === 'dark' ? C : C_LIGHT;
  const g = drawPreviewLines(files, 8);
  return (
    <div role="button" tabIndex={0} aria-label="Open the sketch in the Sketch editor" title="Open in the Sketch editor"
      onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{ position: 'relative', cursor: 'pointer', borderRadius: radius.md, background: tk.bg.field, padding: '6px 10px 8px', overflow: 'hidden', boxShadow: error ? `inset 0 0 0 1.5px ${tk.status.danger}` : 'none' }}>
      <div style={{ font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint, marginBottom: 3 }}>{g.lines.length && g.file ? `draw() · ${g.file}` : g.file}</div>
      <pre style={{ margin: 0, font: `11.5px/1.45 ${fontFamily.mono}`, whiteSpace: 'pre', overflow: 'hidden', color: tk.text.primary, maxHeight: 8 * 16.7 }}>
        {g.lines.map((line, i) => <div key={i}>{line ? tokenizeJsLine(line, pal).map((t, j) => <span key={j} style={{ color: t.color }}>{t.text}</span>) : ' '}</div>)}
      </pre>
      {(g.more || g.lines.length >= 6) && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 44, background: `linear-gradient(to bottom, transparent, ${tk.bg.field})`, pointerEvents: 'none' }} />}
    </div>
  );
}

/** The sketch's files as small chips: sketch.js · particle.js · flow.js. */
export function FileChips({ files }: { files: ReadonlyArray<{ name: string }> }) {
  const tk = useTokens();
  if (files.length < 2) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} aria-label="The sketch's files">
      {files.map((f, i) => (
        <span key={f.name} style={{ padding: '1px 7px', borderRadius: 999, background: i === 0 ? tk.bg.field : 'transparent', boxShadow: `inset 0 0 0 1px ${tk.border.default}`, font: `500 10.5px ${fontFamily.mono}`, color: i === 0 ? tk.text.primary : tk.text.secondary }}>{f.name}</span>
      ))}
    </div>
  );
}

/** The error, else the last thing the sketch printed, else what is running. */
export function ScriptStatusLine({ layerId, error, running }: { layerId: string; error: string | null; running: string }) {
  const tk = useTokens();
  const con = useScriptConsole(layerId);
  const last = error ? null : lastConsoleLine(con);
  const text = error ?? (last ? `${last.level === 'warn' ? '⚠ ' : ''}${last.text}${last.count > 1 ? ` ×${last.count}` : ''}` : running);
  const colour = error || last?.level === 'error' ? tk.status.danger : last?.level === 'warn' ? tk.status.warningText : last ? tk.text.muted : tk.text.faint;
  return (
    <div title={text} style={{ marginTop: 6, fontSize: 11, lineHeight: 1.4, color: colour, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: last && !error ? fontFamily.mono : undefined }}>
      {text}
    </div>
  );
}
