/**
 * Blocks — the four kinds of block, as the reader sees them and (with
 * `editing`) as the author edits them in place:
 *
 *   Text         Markdown with maths. Selected in Edit, it becomes a text box
 *                with the result right under it.
 *   Render       a source's picture: its shape, width, caption, clock.
 *   Interactive  text, the picture and the chosen controls, relabelled, with
 *                what drives each one; chips in the text point at a slider.
 *   Code         highlighted GLSL or JavaScript, typed or quoted from a source.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Block, CodeBlock, InteractiveBlock, PresentSource, RenderBlock, TextBlock } from '../../types/presentation';
import { baseValue, mappingsByControl } from '../../present/controls';
import { resolveCode } from '../../present/code';
import { playRuntime, type PlayMount } from '../../present/runtimeHost';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { ColourPad } from '../play/ColourPad';
import { CodeView } from './CodeView';
import { Markdown } from './Markdown';
import { PlayCanvas } from './PlayCanvas';
import { usePresentation } from './presentationStore';

export interface BlockContext {
  sources: ReadonlyMap<string, PresentSource>;
  /** Author view: blocks can be selected and edited. */
  editing: boolean;
  /** Canvases on this step may run. */
  active: boolean;
  /** Script layers are someone else's code: sandbox them. */
  sandbox: boolean;
  compact: boolean;
  /** Slides: bigger text. */
  large: boolean;
}

export const BLOCK_META: Record<Block['type'], { label: string; icon: 'text' | 'layoutCanvas' | 'sliders' | 'code'; hint: string }> = {
  text: { label: 'Text', icon: 'text', hint: 'Markdown with $maths$' },
  render: { label: 'Render', icon: 'layoutCanvas', hint: 'A Play’s picture, no controls' },
  interactive: { label: 'Interactive', icon: 'sliders', hint: 'Text, a picture and some of its controls' },
  code: { label: 'Code', icon: 'code', hint: 'GLSL or JavaScript, typed or from a Play' },
};

// ── The frame an author clicks ──────────────────────────────────────────────

function BlockFrame({ block, selected, editing, children }: { block: Block; selected: boolean; editing: boolean; children: ReactNode }) {
  const tk = useTokens();
  const select = usePresentation(s => s.select);
  const moveBlock = usePresentation(s => s.moveBlock);
  const duplicateBlock = usePresentation(s => s.duplicateBlock);
  const deleteBlock = usePresentation(s => s.deleteBlock);
  const [hover, setHover] = useState(false);
  if (!editing) return <div className="pp-block">{children}</div>;
  return (
    <div
      className="pp-block"
      data-block={block.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={e => { e.stopPropagation(); if (!selected) select(block.id); }}
      style={{
        borderRadius: radius.lg, outlineOffset: 8, cursor: selected ? 'default' : 'pointer',
        outline: selected ? `2px solid ${tk.accent.base}` : hover ? `1px dashed ${tk.border.strong}` : '1px solid transparent',
      }}
    >
      {(selected || hover) && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: -38, right: -8, zIndex: 4, display: 'flex', alignItems: 'center', gap: 1, padding: 2,
            borderRadius: radius.md, background: tk.bg.panel, boxShadow: tk.shadow.float, border: `1px solid ${tk.border.default}`,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 8px 0 6px', color: tk.text.muted, font: `600 11px ${fontFamily.ui}` }}>
            <Icon name={BLOCK_META[block.type].icon} size={13} />{BLOCK_META[block.type].label}
          </span>
          <IconButton size="sm" icon="chevU" label="Move up" onClick={() => moveBlock(block.id, -1)} />
          <IconButton size="sm" icon="chevD" label="Move down" onClick={() => moveBlock(block.id, 1)} />
          <IconButton size="sm" icon="copy" label="Duplicate" onClick={() => duplicateBlock(block.id)} />
          <IconButton size="sm" icon="trash" label="Delete" tone="danger" onClick={() => deleteBlock(block.id)} />
        </div>
      )}
      {children}
    </div>
  );
}

export function BlockView({ block, ctx }: { block: Block; ctx: BlockContext }) {
  const selected = usePresentation(s => s.selected === block.id);
  const content = (() => {
    switch (block.type) {
      case 'text': return <TextBlockView block={block} ctx={ctx} selected={selected} />;
      case 'render': return <RenderBlockView block={block} ctx={ctx} />;
      case 'interactive': return <InteractiveBlockView block={block} ctx={ctx} />;
      case 'code': return <CodeBlockView block={block} ctx={ctx} selected={selected} />;
    }
  })();
  return <BlockFrame block={block} selected={selected} editing={ctx.editing}>{content}</BlockFrame>;
}

// ── Text ────────────────────────────────────────────────────────────────────

/** A textarea that grows with its text. */
function GrowingText({ value, onChange, mono = false, placeholder, autoFocus, minRows = 3 }: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; autoFocus?: boolean; minRows?: number }) {
  const tk = useTokens();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={value}
      rows={minRows}
      spellCheck={!mono}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.blur(); usePresentation.getState().select(null); } e.stopPropagation(); }}
      style={{
        width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden', border: 0, outline: 'none', borderRadius: radius.md,
        padding: '10px 12px', background: tk.bg.field, color: tk.text.primary,
        font: mono ? `12.5px/1.6 ${fontFamily.mono}` : `13.5px/1.55 ${fontFamily.mono}`, boxShadow: `inset 0 0 0 1.5px ${alpha(tk.accent.base, 0.5)}`,
      }}
    />
  );
}

function TextBlockView({ block, ctx, selected }: { block: TextBlock; ctx: BlockContext; selected: boolean }) {
  const tk = useTokens();
  const patchBlock = usePresentation(s => s.patchBlock);
  if (ctx.editing && selected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <GrowingText autoFocus value={block.markdown} onChange={markdown => patchBlock(block.id, { markdown })} placeholder={'Write in Markdown. $x^2$ for maths in a line, $$…$$ on lines of its own for a formula.'} />
        <div style={{ padding: '2px 2px 0', borderTop: `1px dashed ${tk.border.default}` }}>
          <div style={{ margin: '8px 0 6px', color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Preview</div>
          <Markdown text={block.markdown} size={ctx.large ? 'lg' : 'md'} placeholder="Nothing yet." />
        </div>
      </div>
    );
  }
  return <Markdown text={block.markdown} size={ctx.large ? 'lg' : 'md'} placeholder={ctx.editing ? 'An empty text block. Click to write.' : undefined} />;
}

// ── Render ──────────────────────────────────────────────────────────────────

const WIDTH_PCT = { full: 100, half: 50, third: 100 / 3 } as const;

function RenderBlockView({ block, ctx }: { block: RenderBlock; ctx: BlockContext }) {
  const tk = useTokens();
  const pct = ctx.compact ? 100 : WIDTH_PCT[block.width];
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ width: `${pct}%`, minWidth: ctx.compact ? 0 : 200, maxWidth: '100%' }}>
        <PlayCanvas slotId={block.id} source={ctx.sources.get(block.source)} aspect={block.aspect} pointer={block.pointer} startTime={block.startTime} paused={block.paused} active={ctx.active} sandbox={ctx.sandbox} />
      </div>
      {block.caption && <figcaption style={{ width: `${pct}%`, maxWidth: '100%', color: tk.text.muted, font: `500 13px/1.45 ${fontFamily.ui}`, textAlign: 'center' }}>{block.caption}</figcaption>}
    </figure>
  );
}

// ── Interactive ─────────────────────────────────────────────────────────────

type Value = number | number[];

function fmt(v: number, step?: number): string {
  const d = step && step >= 1 ? 0 : step && step >= 0.1 ? 1 : step && step >= 0.01 ? 2 : 3;
  return v.toFixed(d);
}

function InteractiveBlockView({ block, ctx }: { block: InteractiveBlock; ctx: BlockContext }) {
  const tk = useTokens();
  const source = ctx.sources.get(block.source);
  const play = source?.bundle.play;
  const chosen = useMemo(() => {
    if (!play) return [];
    return block.controls.flatMap(ch => { const c = play.controls.find(x => x.id === ch.controlId); return c ? [{ ch, c }] : []; });
  }, [block.controls, play]);
  const maps = useMemo(() => (play ? mappingsByControl(play) : new Map()), [play]);
  const labels = useMemo(() => Object.fromEntries(chosen.map(({ ch, c }) => [c.id, ch.label?.trim() || c.label])), [chosen]);
  const layerLabels = useMemo(() => Object.fromEntries((play?.layers ?? []).map(l => [l.id, l.label])), [play]);

  // What the sliders show: set by hand here, or the live value while a mapping drives it.
  const mount = useRef<PlayMount | null>(null);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [live, setLive] = useState<Record<string, Value>>({});
  const valueOf = (id: string): Value | undefined => {
    if (id in values) return values[id];
    const c = play?.controls.find(x => x.id === id);
    return source && c ? baseValue(source.bundle, c) : undefined;
  };
  const write = (id: string, v: Value) => { setValues(s => ({ ...s, [id]: v })); mount.current?.set?.(id, v); };
  const onMount = (m: PlayMount | null) => {
    mount.current = m;
    // The page keeps what the reader set; a canvas coming back picks it up.
    if (m) for (const [id, v] of Object.entries(values)) m.set?.(id, v);
  };
  useEffect(() => {
    const ids = chosen.map(x => x.c.id);
    const t = window.setInterval(() => {
      const m = mount.current;
      if (!m?.get) return;
      const next: Record<string, Value> = {};
      for (const id of ids) { const g = m.get(id); if (g?.driven && g.value !== undefined) next[id] = g.value; }
      setLive(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, 90);
    return () => window.clearInterval(t);
  }, [chosen]);

  // Chips in the text: hovering lights the control, clicking shows it and gives it a nudge.
  const [hot, setHot] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const nudge = (id: string) => {
    rows.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setFlash(id);
    window.setTimeout(() => setFlash(f => (f === id ? null : f)), 1100);
    const c = play?.controls.find(x => x.id === id);
    const v0 = valueOf(id);
    if (!c || c.kind !== 'float' || typeof v0 !== 'number' || id in live) return;
    const span = c.max - c.min, amp = span * 0.18, dir = v0 + amp > c.max ? -1 : 1;
    const t0 = performance.now();
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / 900);
      const v = v0 + dir * amp * Math.sin(u * Math.PI);
      mount.current?.set?.(id, u >= 1 ? v0 : v);
      setValues(s => ({ ...s, [id]: u >= 1 ? v0 : v }));
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const needs = new Set(chosen.flatMap(({ c }) => [...(maps.get(c.id)?.needs ?? [])]));
  const [midi, setMidi] = useState<'off' | 'on' | 'refused'>('off');
  const [audio, setAudio] = useState<string>('off');

  const stacked = ctx.compact || block.layout === 'stacked';
  const text = <Markdown text={block.markdown} controls={labels} layers={layerLabels} hot={hot ?? flash} onChip={nudge} onChipHover={setHot} size={ctx.large ? 'lg' : 'md'} placeholder={ctx.editing ? 'Add the lesson’s text in the block settings.' : undefined} />;
  const canvas = <PlayCanvas slotId={block.id} source={source} aspect={block.aspect} pointer={block.pointer} active={ctx.active} sandbox={ctx.sandbox} onMount={onMount} />;
  const panel = (
    <div style={{ display: 'grid', gridTemplateColumns: stacked && !ctx.compact ? 'repeat(auto-fill, minmax(220px, 1fr))' : '1fr', gap: 10 }}>
      {chosen.length === 0 && ctx.editing && <div style={{ color: tk.text.faint, font: `500 12.5px ${fontFamily.ui}` }}>No controls chosen. Pick some in the block settings.</div>}
      {chosen.map(({ ch, c }) => {
        const m = maps.get(c.id);
        const driven = c.id in live;
        const v = driven ? live[c.id] : valueOf(c.id);
        const lit = hot === c.id || flash === c.id;
        return (
          <div
            key={c.id}
            ref={el => { if (el) rows.current.set(c.id, el); else rows.current.delete(c.id); }}
            onMouseEnter={() => setHot(c.id)}
            onMouseLeave={() => setHot(h => (h === c.id ? null : h))}
            style={{
              padding: '10px 12px 11px', borderRadius: radius.lg, background: tk.bg.panel, border: `1px solid ${lit ? tk.accent.base : tk.border.default}`,
              boxShadow: lit ? `0 0 0 3px ${alpha(tk.accent.base, 0.18)}` : 'none', transition: 'border-color .15s, box-shadow .15s', minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: c.kind === 'action' ? 0 : 7 }}>
              {c.kind !== 'action' && <span style={{ flex: 1, minWidth: 0, color: tk.text.primary, font: `600 13px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labels[c.id]}</span>}
              {typeof v === 'number' && <span style={{ color: driven ? tk.accent.text : tk.text.muted, font: `500 12px ${fontFamily.mono}` }}>{fmt(v, c.step)}</span>}
            </div>
            {c.kind === 'action' ? (
              <Button size="sm" variant="primary" icon="play" onClick={() => mount.current?.fire?.(c.id)} style={{ width: '100%' }}>{labels[c.id]}</Button>
            ) : c.kind === 'color' ? (
              <ColourPad value={Array.isArray(values[c.id]) ? values[c.id] as number[] : (Array.isArray(baseValue(source!.bundle, c)) ? baseValue(source!.bundle, c) as number[] : [0, 0, 0])} live={driven && Array.isArray(v) ? v : undefined} disabled={false} onChange={nv => write(c.id, nv)} />
            ) : (
              <RulerSlider value={typeof v === 'number' ? v : c.min} min={c.min} max={c.max} step={c.step ?? 0.01} disabled={driven} ariaLabel={labels[c.id]} touch={ctx.compact} onChange={nv => write(c.id, nv)} />
            )}
            {ch.hint && <div style={{ marginTop: 7, color: tk.text.muted, font: `500 12px/1.4 ${fontFamily.ui}` }}>{ch.hint}</div>}
            {ch.showMappings && m && m.words.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                {m.words.map((w: string) => (
                  <span key={w} title="This drives it in the Play" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 6px', borderRadius: 10,
                    background: driven ? alpha(tk.accent.base, 0.14) : tk.bg.field, color: driven ? tk.accent.text : tk.text.secondary, font: `600 11px ${fontFamily.ui}`,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: driven ? tk.accent.base : tk.text.faint }} />{w}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {(needs.has('midi') || needs.has('audio')) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {needs.has('midi') && <Button size="sm" icon="spark" disabled={midi === 'on'} onClick={async () => setMidi(await playRuntime().enableMidi?.() ? 'on' : 'refused')}>{midi === 'on' ? 'MIDI on' : midi === 'refused' ? 'MIDI refused' : 'Enable MIDI'}</Button>}
          {needs.has('audio') && <Button size="sm" icon="wave" disabled={audio === 'on'} onClick={async () => setAudio(await playRuntime().listen?.() ?? 'unsupported')}>{audio === 'on' ? 'Listening' : audio === 'denied' ? 'Audio blocked' : audio === 'off' ? 'Listen' : 'No audio input'}</Button>}
        </div>
      )}
    </div>
  );
  if (!source) return <div style={{ color: tk.status.warningText }}>This block’s source was removed.</div>;
  if (stacked) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {text}
        {canvas}
        {panel}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(260px, 1fr)', gap: 28, alignItems: 'start' }}>
      {canvas}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {text}
        {panel}
      </div>
    </div>
  );
}

// ── Code ────────────────────────────────────────────────────────────────────

function CodeBlockView({ block, ctx, selected }: { block: CodeBlock; ctx: BlockContext; selected: boolean }) {
  const patchBlock = usePresentation(s => s.patchBlock);
  const resolved = useMemo(() => resolveCode(block, ctx.sources), [block, ctx.sources]);
  if (ctx.editing && selected && !block.from) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <GrowingText mono autoFocus value={block.code ?? ''} onChange={code => patchBlock(block.id, { code })} placeholder={block.language === 'js' ? '// JavaScript' : '// GLSL'} minRows={4} />
        <CodeView code={resolved} caption={block.caption} />
      </div>
    );
  }
  return <CodeView code={resolved} caption={block.caption} maxHeight={ctx.large ? 560 : 460} />;
}
