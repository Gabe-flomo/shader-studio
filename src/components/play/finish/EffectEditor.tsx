/**
 * EffectEditor — the Look effect editor: build an effect from nodes or write
 * it as GLSL, watch it on the picture, then "Use as effect".
 *
 *   Nodes   EffectGraphEditor: Effect inputs (Picture colour, UV, Centred UV,
 *           Time) → any nodes → Effect output (Colour). Compiled by the
 *           Studio's compiler into effect code (play/lookGraph.ts).
 *   Code    `vec3 effect(vec2 uv, vec3 color)` and `uniform` settings
 *           (play/kit/finish.js fnParseCustom), in the GLSL editor.
 *
 * While it is open the effect being made is live in the stack (onDraft), so
 * the preview here (a copy of the finished picture) and the page's own
 * preview both show it exactly as it will be, Where and all. Cancel puts the
 * stack back as it was.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { RulerSlider } from '../../ui/RulerSlider';
import { ColorSwatch } from '../../ui/ColorPicker';
import { toast } from '../../ui/toastStore';
import { GlslEditor } from '../../code/GlslEditor';
import { playOverlay } from '../../../play/overlay';
import { EFFECT_TEMPLATE, loadSavedEffects, saveEffect } from '../../../play/finishLibrary';
import { compileEffectGraph, effectFromGraph, emptyEffectGraph, graphWithEffectValues, type EffectGraph } from '../../../play/lookGraph';
import { finishCustomCode, finishEffectId, newCustomEffect, withCustomCode, type FinishEffect } from '../../../types/playFinish';
import { fnCheckCustom, fnParseCustom } from '../../../play/kit/finish.js';
import { EffectGraphEditor } from './EffectGraphEditor';

type Mode = 'nodes' | 'code';

export function EffectEditor({ initial, finishOn, touch, onDraft, onDone }: {
  /** The effect being edited, or null for a new one. */
  initial: FinishEffect | null;
  /** Is the stack on (else nothing shows on the picture)? */
  finishOn: boolean;
  touch: boolean;
  /** The effect as it is now: put it in the stack (live). */
  onDraft: (e: FinishEffect) => void;
  /** Use (the effect) or Cancel (null). */
  onDone: (e: FinishEffect | null) => void;
}) {
  const tk = useTokens();
  const [id] = useState(() => initial?.id ?? finishEffectId('custom'));
  const [mode, setMode] = useState<Mode>(initial && !initial.graph ? 'code' : 'nodes');
  const [name, setName] = useState(initial?.name ?? 'My effect');
  const [graph, setGraph] = useState<EffectGraph>(() => (initial?.graph ? graphWithEffectValues(initial.graph, initial) : emptyEffectGraph()));
  const [code, setCode] = useState(() => (initial && !initial.graph ? finishCustomCode(initial) : EFFECT_TEMPLATE));
  const [draft, setDraft] = useState<FinishEffect | null>(initial);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [error, setError] = useState('');
  const [before, setBefore] = useState(false);
  const [showCode, setShowCode] = useState(false);

  // Build the effect a moment after an edit stops (a slider drag on a node is many edits).
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === 'nodes') {
        const r = effectFromGraph(graph, { name, id, ...(initial ? { prev: { ...initial, defId: draftRef.current?.defId ?? initial.defId } } : {}) });
        setError(r.error);
        if (r.effect) {
          if (!initial && draftRef.current?.defId) r.effect.defId = draftRef.current.defId;
          setDraft(r.effect);
        }
      } else {
        setError(fnCheckCustom(code));
        const base = draftRef.current && !draftRef.current.graph ? draftRef.current : { ...newCustomEffect({ name, code }, id), ...(initial ? { enabled: initial.enabled, where: initial.where, whereLayer: initial.whereLayer, whereInvert: initial.whereInvert } : {}), ...(draftRef.current?.defId ? { defId: draftRef.current.defId } : {}) };
        setDraft({ ...withCustomCode(base, code), name });
      }
    }, 220);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, graph, code, name]);

  // Live in the stack (off while "Before" is held).
  useEffect(() => { if (draft) onDraft(before ? { ...draft, enabled: false } : draft); }, [draft, before]); // eslint-disable-line react-hooks/exhaustive-deps

  const compiled = useMemo(() => (mode === 'nodes' && showCode ? compileEffectGraph(graph) : null), [mode, showCode, graph]);
  const parsed = useMemo(() => fnParseCustom(draft ? finishCustomCode(draft) : ''), [draft]);
  const save = () => {
    if (!draft) return;
    const sameId = draft.defId && loadSavedEffects().some(x => x.id === draft.defId && !x.sealed) ? draft.defId : undefined;
    const { result, saved } = saveEffect({ name, code: draft.code ?? '', ...(sameId ? { id: sameId } : {}), ...(mode === 'nodes' ? { graph } : {}) });
    if (!result.ok || !saved) { toast.error('Couldn’t save the effect', { message: result.ok ? undefined : result.error }); return; }
    setDraft({ ...draft, defId: saved.id });
    toast.success(`Saved “${saved.name}”`, { message: 'It is under + Add effect → Your effects in every Play, and in library exports.' });
  };

  const ready = !!draft && !(mode === 'nodes' && error);
  return (
    <Modal
      title={initial ? `Edit “${initial.name ?? 'effect'}”` : 'New Look effect'}
      subtitle="Build it from nodes or write it in GLSL; it runs on every pixel of the finished picture"
      icon={mode === 'nodes' ? 'nodes' : 'code'}
      width={1180}
      height={780}
      closeOnScrim={false}
      onClose={() => onDone(null)}
      footer={(
        <>
          <Button icon="save" disabled={!ready} onClick={save}>{draft?.defId ? 'Save to Your effects (update)' : 'Save to Your effects'}</Button>
          <span style={{ flex: 1 }} />
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" icon={initial ? 'check' : 'plus'} disabled={!ready} onClick={() => draft && onDone({ ...draft, name: name.trim().slice(0, 60) || draft.name })}>{initial ? 'Update effect' : 'Use as effect'}</Button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: 14, height: '100%', boxSizing: 'border-box', minHeight: 0 }}>
        <div style={{ flex: '1 1 560px', minWidth: 0, minHeight: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ width: 200 }}>
              <Segmented size="sm" fill ariaLabel="Build from nodes or write code" value={mode} onChange={v => setMode(v as Mode)}
                options={[{ value: 'nodes', label: 'Nodes', title: 'Build it from Studio nodes' }, { value: 'code', label: 'Code', title: 'Write it in GLSL' }]} />
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 320 }}>
              <Field value={name} onChange={ev => setName(ev.target.value)} aria-label="Effect name" placeholder="Name" height={30} />
            </div>
          </div>
          {mode === 'nodes' ? (
            <>
              <EffectGraphEditor graph={graph} onChange={setGraph} touch={touch} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button size="sm" variant="ghost" icon={showCode ? 'chevD' : 'chevR'} onClick={() => setShowCode(!showCode)}>The code it makes</Button>
                <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Each node’s sliders become the effect’s settings (and control targets) in the stack.</span>
              </div>
              {showCode && compiled && (
                <pre style={{ margin: 0, maxHeight: 180, overflow: 'auto', padding: '8px 10px', borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, font: `11px/1.45 ${fontFamily.mono}` }}>{compiled.code || compiled.error}</pre>
              )}
            </>
          ) : (
            <>
              <div style={{ flex: 1, minHeight: 300, display: 'flex', borderRadius: radius.sm, overflow: 'hidden', border: `1px solid ${error ? tk.status.danger : tk.border.default}` }}>
                <GlslEditor value={code} onChange={setCode} ariaLabel="Effect code" errorLines={errorLinesOf(error)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>
                  Write <code>vec3 effect(vec2 uv, vec3 color)</code>: <code>uv</code> is the point (0..1), <code>color</code> the colour so far. <code>picture(uv)</code> reads the picture as it came in, <code>px</code> is one pixel, <code>time</code> the clock. Each <code>uniform float name; // 0..1 = 0.5 Label | hint</code> is a slider; <code>uniform vec3 name; // color = #ff8800</code> a colour.
                </div>
                {graph.nodes.length > 1 && <Button size="sm" icon="import" onClick={() => { const r = compileEffectGraph(graph); if (r.code) setCode(r.code); }}>Start from the nodes’ code</Button>}
              </div>
            </>
          )}
        </div>
        <div style={{ flex: '0 1 320px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflowY: 'auto' }}>
          <Preview />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button size="sm" variant={before ? 'primary' : 'secondary'} icon="layoutSplit" onClick={() => setBefore(!before)}>{before ? 'Showing before' : 'Before'}</Button>
            <span style={{ flex: 1, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{finishOn ? 'The finished picture, with this effect at its place in the stack.' : 'The Look stack is off: turn it on to see the effect.'}</span>
          </div>
          {error
            ? <pre style={{ margin: 0, padding: '6px 8px', borderRadius: radius.sm, background: alpha(tk.status.danger, 0.1), color: tk.status.danger, font: `11px/1.45 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflow: 'auto' }}>{error}</pre>
            : <div style={{ color: tk.status.success, font: `600 11px ${fontFamily.ui}` }}>{draft ? `Compiles · ${parsed.params.filter(p => !p.colour).length} slider${parsed.params.filter(p => !p.colour).length === 1 ? '' : 's'}${parsed.colours.length ? ` · ${parsed.colours.length} colour${parsed.colours.length === 1 ? '' : 's'}` : ''}` : 'Building…'}</div>}
          {mode === 'code' && draft && (parsed.params.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Settings</div>
              {parsed.params.filter(p => !p.colour).map(p => (
                <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span title={p.hint || undefined} style={{ width: 78, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, textTransform: 'uppercase' }}>{p.label}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <RulerSlider value={typeof draft[p.key] === 'number' ? draft[p.key] as number : p.value} min={p.min} max={p.max} step={p.step} defaultValue={p.value} hard onChange={v => setDraft(d => (d ? { ...d, [p.key]: v } : d))} ariaLabel={p.label} touch={touch} />
                  </div>
                </div>
              ))}
              {parsed.colours.map(c => (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 78, flexShrink: 0, color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, textTransform: 'uppercase' }}>{c.label}</span>
                  <ColorSwatch label={c.label} size="sm" value={c.keys.map(k => (typeof draft[k] === 'number' ? draft[k] as number : 1)) as [number, number, number]} onChange={rgb => setDraft(d => (d ? { ...d, [c.keys[0]]: rgb[0], [c.keys[1]]: rgb[1], [c.keys[2]]: rgb[2] } : d))} />
                </div>
              ))}
            </div>
          )}
          <div style={{ color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>
            {mode === 'nodes'
              ? <>Wire <b>Picture colour</b> through nodes into <b>Colour</b>. <b>UV</b> is where the point is, <b>Time</b> the clock; <b>Picture at</b> reads the picture somewhere else. The effect is saved as GLSL, so it runs in exported websites and renders like any other.</>
              : <>The code is compiled with the rest of the stack. A broken effect is skipped; the picture never goes blank.</>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function errorLinesOf(err: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const l of err.split('\n')) { const m = /^Line (\d+): (.*)$/.exec(l); if (m && !out.has(+m[1])) out.set(+m[1], m[2]); }
  return out;
}

/** The finished picture as the page draws it, copied every frame (contain-fit). */
function Preview() {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const { canvas: src, release } = playOverlay.acquirePicture();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = ref.current;
      if (!c || !src.width || !src.height) return;
      const w = c.clientWidth * Math.min(2, window.devicePixelRatio || 1), h = c.clientHeight * Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w) || c.height !== Math.round(h)) { c.width = Math.round(w); c.height = Math.round(h); }
      const g = c.getContext('2d');
      if (!g) return;
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / src.width, c.height / src.height);
      g.drawImage(src, (c.width - src.width * s) / 2, (c.height - src.height * s) / 2, src.width * s, src.height * s);
    };
    tick();
    return () => { cancelAnimationFrame(raf); release(); };
  }, []);
  return <canvas ref={ref} aria-label="Preview of the finished picture" style={{ width: '100%', aspectRatio: '16 / 10', borderRadius: radius.md, background: tk.bg.render, display: 'block' }} />;
}
