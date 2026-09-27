/**
 * The Script editor's side-panel lists: the Reference (every helper with its
 * parameters, return value and an example, one entry open at a time), the
 * Patterns (each with a running example to look at or load), and the
 * control builder on the Controls tab. ScriptModal owns the draft and the
 * edits; these only render and call back.
 */
import { Fragment, useMemo, useState } from 'react';
import { KL_SKETCH_NAMES } from '../../../play/kit/layers.js';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { ScriptParamDef } from '../../../types/playLayers';
import { Button, IconButton } from '../../ui/Button';
import { Segmented, Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { C, C_LIGHT } from '../../glslSyntax';
import { tokenizeJsLine } from '../../code/jsSyntax';
import { ScriptPreview } from './ScriptPreview';
import { extractScriptParams } from './scriptExamples';
import { SCRIPT_REFERENCE, refInsert, refSignature, type RefItem } from './scriptReference';
import { SCRIPT_SNIPPETS, SNIPPET_GROUPS, SNIPPET_GROUP_INTENT, type ScriptSnippet } from './scriptSnippets';
import { addControl, controlKeyProblem, labelFromKey, looksLikeCount, type ControlHelper, type ControlKind } from './scriptTools';

const heading = (t: string, color: string) => <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color, textTransform: 'uppercase' }}>{t}</span>;

/** Read-only highlighted JavaScript: examples in the reference and the patterns. */
export function ScriptCodeView({ code, maxHeight }: { code: string; maxHeight?: number }) {
  const tk = useTokens();
  const pal = useThemeMode() === 'dark' ? C : C_LIGHT;
  const lines = code.replace(/\s+$/, '').split('\n');
  return (
    <pre style={{ margin: 0, padding: '7px 9px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, font: `500 11.5px/1.5 ${fontFamily.mono}`, color: tk.text.primary, overflow: 'auto', maxHeight, whiteSpace: 'pre', tabSize: 2 }}>
      {lines.map((line, i) => <span key={i}>{tokenizeJsLine(line, pal).map((t, j) => <span key={j} style={{ color: t.color }}>{t.text}</span>)}{i < lines.length - 1 ? '\n' : ''}</span>)}
    </pre>
  );
}

// ── Reference ────────────────────────────────────────────────────────────────

export function ScriptReferenceList({ query, onInsert }: { query: string; onInsert: (text: string) => void }) {
  const tk = useTokens();
  const [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const groups = SCRIPT_REFERENCE.map(g => ({ ...g, items: q ? g.items.filter(it => `${it.name} ${it.doc} ${(it.args ?? []).map(a => a.name).join(' ')}`.toLowerCase().includes(q)) : g.items })).filter(g => g.items.length);
  if (!groups.length) return <span style={{ fontSize: 12, color: tk.text.muted }}>Nothing matches “{query}”.</span>;
  return (
    <>
      {groups.map(g => (
        <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ padding: '0 0 4px' }}>{heading(g.title, tk.text.faint)}</div>
          {g.items.map(it => <RefEntry key={it.name} it={it} open={open === it.name} onToggle={() => setOpen(o => (o === it.name ? null : it.name))} onInsert={onInsert} />)}
        </div>
      ))}
    </>
  );
}

function RefEntry({ it, open, onToggle, onInsert }: { it: RefItem; open: boolean; onToggle: () => void; onInsert: (text: string) => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const sig = refSignature(it);
  const type = it.args ? (it.type === 'nothing' ? '' : `→ ${it.type}`) : it.type;
  const sub = (t: string) => <div style={{ font: `600 10.5px ${fontFamily.ui}`, color: tk.text.faint, letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 4 }}>{t}</div>;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ borderRadius: radius.md, background: open ? tk.bg.panel : hover ? tk.bg.hover : 'transparent', boxShadow: open ? `inset 0 0 0 1px ${tk.border.subtle}` : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '5px 4px 5px 8px' }}>
        <button type="button" aria-expanded={open} onMouseDown={e => e.preventDefault()} onClick={onToggle} title={open ? 'Hide the details' : 'Parameters, return value and an example'}
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: 0, border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', color: tk.text.primary }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0 }}>
            <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `600 12px ${fontFamily.mono}` }}>
              {it.name}<span style={{ color: tk.text.faint, fontWeight: 500 }}>{sig}</span>
            </span>
            {type && <span style={{ flexShrink: 1, minWidth: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>{type}</span>}
          </span>
          <span style={{ paddingLeft: 18, fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted }}>{it.doc}</span>
        </button>
        <IconButton icon="plus" size="sm" label={`Insert ${refInsert(it).split('\n')[0]} at the caret`} onMouseDown={e => e.preventDefault()} onClick={() => onInsert(refInsert(it))} />
      </div>
      {open && (
        <div style={{ padding: '0 10px 10px 26px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted }}>
          {it.args && it.args.length > 0 && (
            <>
              {sub('Parameters')}
              <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 8, rowGap: 3 }}>
                {it.args.map(a => (
                  <Fragment key={a.name}>
                    <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{a.name}</span>
                    <span><span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{a.type}{a.optional ? ', optional' : ''}</span> · {a.doc}</span>
                  </Fragment>
                ))}
              </div>
            </>
          )}
          {it.args && it.args.length === 0 && <>{sub('Parameters')}<span>None.</span></>}
          {sub(it.args ? 'Returns' : 'Type')}
          {it.type === 'nothing' ? <span>Nothing.</span> : <span><span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.secondary }}>{it.type}</span>{it.returns ? ` · ${it.returns}` : ''}</span>}
          {sub('Example')}
          <ScriptCodeView code={it.example} />
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <Button size="sm" icon="plus" onMouseDown={e => e.preventDefault()} onClick={() => onInsert(refInsert(it))}>Insert</Button>
            <Button size="sm" variant="ghost" onMouseDown={e => e.preventDefault()} onClick={() => onInsert(it.example.endsWith('\n') ? it.example : `${it.example}\n`)}>Insert the example</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Patterns ─────────────────────────────────────────────────────────────────

export function ScriptPatternList({ query, previewWidth, onInsert, onLoad }: {
  query: string;
  previewWidth: number;
  onInsert: (sn: ScriptSnippet) => void;
  onLoad: (sn: ScriptSnippet) => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const where = (sn: ScriptSnippet) => (sn.where === 'top' ? 'top of file' : `in ${sn.where}`);
  return (
    <>
      {SNIPPET_GROUPS.map(g => {
        // The filter matches a pattern's name and doc, or its group's name and what the group is for.
        const groupHit = !!q && `${g} ${SNIPPET_GROUP_INTENT[g]}`.toLowerCase().includes(q);
        const rows = SCRIPT_SNIPPETS.filter(sn => sn.group === g && (!q || groupHit || `${sn.name} ${sn.doc}`.toLowerCase().includes(q)));
        if (!rows.length) return null;
        return (
          <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>{heading(g, tk.text.faint)}<span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>{rows.length}</span></span>
              <span style={{ fontSize: 11.5, lineHeight: 1.35, color: tk.text.muted }}>{SNIPPET_GROUP_INTENT[g]}</span>
            </div>
            {rows.map(sn => {
              const on = open === sn.name;
              return (
                <div key={sn.name} style={{ padding: '8px 10px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${on ? tk.border.default : tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <b style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>{sn.name}</b>
                    <span title={sn.where === 'top' ? 'Goes before setup and draw, after the params and declarations' : `Goes at the end of ${sn.where} (made if the sketch has none)`}
                      style={{ font: `600 10px ${fontFamily.ui}`, color: tk.text.faint, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{where(sn)}</span>
                  </div>
                  <span style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted }}>{sn.doc}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="sm" icon="plus" onMouseDown={e => e.preventDefault()} onClick={() => onInsert(sn)} title={`Insert ${sn.where === 'top' ? 'at the top of the sketch' : `in ${sn.where}`}`}>Insert</Button>
                    <Button size="sm" variant="ghost" icon={on ? 'chevU' : 'eye'} aria-expanded={on} onMouseDown={e => e.preventDefault()} onClick={() => setOpen(on ? null : sn.name)}>{on ? 'Hide example' : 'See it used'}</Button>
                  </div>
                  {on && <PatternExample sn={sn} width={previewWidth} onLoad={() => onLoad(sn)} />}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function PatternExample({ sn, width, onLoad }: { sn: ScriptSnippet; width: number; onLoad: () => void }) {
  const tk = useTokens();
  const defs = useMemo<ScriptParamDef[]>(() => { const r = extractScriptParams(sn.example); return r.ok ? r.defs : []; }, [sn.example]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
      <ScriptPreview code={sn.example} defs={defs} values={{}} clear={sn.settings?.clear !== false} width={width} />
      <ScriptCodeView code={sn.example} maxHeight={240} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Button size="sm" icon="code" onMouseDown={e => e.preventDefault()} onClick={onLoad} title="Replace the sketch with this example (Undo brings yours back)">Load as the sketch</Button>
        <span style={{ fontSize: 11, color: tk.text.faint, lineHeight: 1.35 }}>Replaces your code; Undo brings it back.</span>
      </div>
    </div>
  );
}

// ── Control builder ──────────────────────────────────────────────────────────

const HELPERS: Record<ControlKind, Array<{ value: ControlHelper; label: (key: string) => string; hint: (key: string) => string }>> = {
  slider: [
    { value: 'none', label: () => 'Nothing else', hint: k => `A let ${k} at the top that the slider drives.` },
    { value: 'loop', label: k => `A loop that runs ${k} times`, hint: k => `A for loop in draw, i from 0 up to ${k}, drawing a row of circles to start from.` },
    { value: 'array', label: k => `An array of ${k} things`, hint: k => `An array made in setup and kept at ${k} items in draw (added or dropped as the slider moves), each drawn as a circle.` },
  ],
  toggle: [
    { value: 'none', label: () => 'Nothing else', hint: k => `A let ${k} (true or false) at the top that the toggle drives.` },
    { value: 'if', label: k => `An if (${k}) in draw`, hint: () => 'A block in draw that runs while it is on.' },
  ],
  button: [
    { value: 'none', label: () => 'Nothing else', hint: k => `Read it with s.pressed('${k}') wherever you like.` },
    { value: 'if', label: k => `An if (s.pressed('${k}')) in draw`, hint: () => 'A block in draw that runs once, on the frame it is pressed.' },
  ],
};

export function ScriptControlBuilder({ draft, onAdd }: {
  draft: string;
  /** Put the new code in; `startAt` is the control's starting value, `toPanel` asks for a Play control too. */
  onAdd: (code: string, key: string, startAt: number | undefined, toPanel: boolean) => void;
}) {
  const tk = useTokens();
  const [kind, setKind] = useState<ControlKind>('slider');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [nums, setNums] = useState({ value: '1', min: '0', max: '10', step: '' });
  const [on, setOn] = useState(true);
  const [helper, setHelper] = useState<ControlHelper | null>(null);
  const [toPanel, setToPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const k = key.trim();
  // A slider named like a count offers the array first, until you pick something yourself.
  const chosen: ControlHelper = helper ?? (kind === 'slider' && looksLikeCount(k) ? 'array' : 'none');
  const options = HELPERS[kind];
  const current = options.find(o => o.value === chosen) ?? options[0];
  const problem = k ? controlKeyProblem(draft, k, KL_SKETCH_NAMES) : null;
  const shown = k || 'name';

  const add = () => {
    const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const r = addControl(draft, { key: k, label, kind, helper: current.value, value: kind === 'toggle' ? on : n(nums.value), min: n(nums.min), max: n(nums.max), step: n(nums.step) }, KL_SKETCH_NAMES);
    if ('error' in r) { setError(r.error); return; }
    setError(null);
    onAdd(r.code, k, r.startAt, toPanel);
    setKey(''); setLabel(''); setHelper(null);
  };
  const numField = (name: keyof typeof nums, caption: string) => (
    <Field mono height={30} inputMode="decimal" aria-label={caption} value={nums[name]} placeholder={name === 'step' ? 'auto' : ''}
      leading={<span style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.text.faint }}>{caption}</span>}
      onChange={e => setNums(v => ({ ...v, [name]: e.target.value }))} style={{ padding: '0 6px', gap: 4 }} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      <Segmented size="sm" fill ariaLabel="Kind of control" value={kind} onChange={v => { setKind(v); setHelper(null); }}
        options={[{ value: 'slider', label: 'Slider' }, { value: 'toggle', label: 'Toggle' }, { value: 'button', label: 'Button' }]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6 }}>
        <Field mono height={30} aria-label="Name in the code" placeholder="name, e.g. count" value={key} invalid={!!problem}
          onChange={e => { setKey(e.target.value.replace(/\s+/g, '_')); setError(null); }} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <Field height={30} aria-label="Label" placeholder={k ? labelFromKey(k) : 'Label'} value={label} onChange={e => setLabel(e.target.value)} />
      </div>
      {kind === 'slider' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          {numField('value', 'value')}{numField('step', 'step')}{numField('min', 'min')}{numField('max', 'max')}
        </div>
      )}
      {kind === 'toggle' && <Toggle checked={on} onChange={setOn} label={on ? 'Starts on' : 'Starts off'} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11.5, color: tk.text.secondary, fontWeight: 600 }}>Also add</span>
        <Select ariaLabel="Also add" value={current.value} options={options.map(o => ({ value: o.value, label: o.label(shown) }))} onChange={v => setHelper(v as ControlHelper)} />
        <span style={{ fontSize: 11, lineHeight: 1.4, color: tk.text.faint }}>{current.hint(shown)}</span>
      </div>
      <Toggle checked={toPanel} onChange={setToPanel} label="Put it on the Play panel too" />
      {(error || problem) && <span style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.status.danger }}>{error ?? problem}</span>}
      <Button size="sm" variant="primary" icon="plus" disabled={!k || !!problem} onClick={add} style={{ alignSelf: 'flex-start' }}>Add {kind}</Button>
    </div>
  );
}
