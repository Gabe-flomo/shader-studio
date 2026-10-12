/**
 * The Data Texture card's editor (nodes/definitions/dataTexture.ts, docs/data-texture.md): what goes
 * in (up to four inputs, each a type and the channels it writes) and what comes out (up to four
 * reads, each the channels it returns: one is a float, two a vec2…). Precision, Read, Values, Size
 * and Edges are ordinary settings below it.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import {
  CHANNELS, FIELD_TYPES, MAX_FIELDS, WIDTH, fieldsOf, readsOf, typeForWidth,
  type DataField, type DataRead, type FieldType,
} from '../../nodes/definitions/dataTexture';

const CH_COLOR: Record<string, string> = { r: '#e5534b', g: '#3fb950', b: '#4c8dff', a: '#9a9da8' };

export function DataTextureCardBody({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const fields = fieldsOf(node);
  const reads = readsOf(node);
  const setFields = (f: DataField[]) => updateNodeParams(node.id, { fields: f });
  const setReads = (r: DataRead[]) => updateNodeParams(node.id, { reads: r });

  const usedBy = new Map<string, number>();
  fields.forEach((f, i) => { for (const c of f.channels) usedBy.set(c, i); });
  const free = [...CHANNELS].filter(c => !usedBy.has(c));

  const label = { font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint } as const;
  const field = {
    padding: touch ? '6px 7px' : '3px 6px', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm,
    background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`, minWidth: 0,
  } as const;
  const add = {
    padding: touch ? '7px 9px' : '3px 8px', border: `1px dashed ${tk.border.strong}`, borderRadius: radius.sm,
    background: 'transparent', color: tk.text.muted, font: `600 11px ${fontFamily.ui}`, cursor: 'pointer', alignSelf: 'flex-start',
  } as const;
  const x = { border: 0, background: 'transparent', color: tk.text.faint, cursor: 'pointer', font: `600 13px ${fontFamily.ui}`, padding: '0 2px' } as const;
  const chip = (c: string, on: boolean, enabled: boolean) => ({
    width: touch ? 26 : 20, height: touch ? 26 : 20, borderRadius: 5, border: `1px solid ${on ? CH_COLOR[c] : tk.border.default}`,
    background: on ? alpha(CH_COLOR[c], 0.18) : 'transparent', color: on ? CH_COLOR[c] : enabled ? tk.text.muted : tk.text.disabled,
    font: `700 11px ${fontFamily.mono ?? fontFamily.ui}`, cursor: enabled ? 'pointer' : 'default', padding: 0,
  });

  /** Click a channel on input i: take it (dropping the oldest if the input is full), or give it back. */
  const toggleIn = (i: number, c: string) => {
    const f = fields[i];
    const owner = usedBy.get(c);
    if (owner !== undefined && owner !== i) return;
    let ch = f.channels.includes(c) ? f.channels.replace(c, '') : f.channels + c;
    if (ch.length > WIDTH[f.type]) ch = ch.slice(ch.length - WIDTH[f.type]);
    // Kept in r g b a order so a vec2 in g and r reads as .rg.
    ch = [...CHANNELS].filter(k => ch.includes(k)).join('');
    setFields(fields.map((g, j) => (j === i ? { ...g, channels: ch } : g)));
  };
  /** Click a channel on output i: add it at the end (order matters: .gr swaps), or take it out. */
  const toggleOut = (i: number, c: string) => {
    const r = reads[i];
    const ch = r.channels.includes(c) ? r.channels.replace(c, '') : (r.channels + c).slice(0, 4);
    if (!ch) return;
    setReads(reads.map((g, j) => (j === i ? { ...g, channels: ch } : g)));
  };

  return (
    <div style={{ padding: '4px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} title="Which input each channel holds">
        {[...CHANNELS].map(c => {
          const i = usedBy.get(c);
          const f = i === undefined ? null : fields[i];
          const part = f ? (f.type === 'float' ? '' : `.${'xyzw'[f.channels.indexOf(c)]}`) : '';
          return (
            <span key={c} style={{ flex: 1, minWidth: 0, padding: '2px 4px', borderRadius: 4, background: alpha(CH_COLOR[c], f ? 0.14 : 0.05), font: `600 10.5px ${fontFamily.ui}`, color: f ? tk.text.primary : tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b style={{ color: CH_COLOR[c] }}>{c}</b> {f ? `${f.name}${part}` : 'free'}
            </span>
          );
        })}
      </div>

      <span style={label}>In: what is stored</span>
      {fields.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input aria-label={`Input ${i + 1} name`} value={f.name} style={{ ...field, flex: 1 }}
            onChange={e => setFields(fields.map((g, j) => (j === i ? { ...g, name: e.target.value } : g)))} />
          <select aria-label={`Input ${i + 1} type`} value={f.type} style={field}
            onChange={e => setFields(fields.map((g, j) => (j === i ? { ...g, type: e.target.value as FieldType, channels: g.channels.slice(0, WIDTH[e.target.value as FieldType]) } : g)))}>
            {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {[...CHANNELS].map(c => {
            const owner = usedBy.get(c);
            return <button key={c} type="button" aria-label={`Input ${i + 1} channel ${c}`} style={chip(c, owner === i, owner === undefined || owner === i)}
              title={owner !== undefined && owner !== i ? `${c} holds ${fields[owner].name}` : `Write into ${c}`} onClick={() => toggleIn(i, c)}>{c}</button>;
          })}
          <button type="button" aria-label={`Remove input ${i + 1}`} style={x} onClick={() => setFields(fields.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {fields.length < MAX_FIELDS && free.length > 0 && (
        <button type="button" style={add} onClick={() => setFields([...fields, { name: `input ${fields.length + 1}`, type: typeForWidth(free.length), channels: free.join('') }])}>
          + Input ({free.length} channel{free.length === 1 ? '' : 's'} free)
        </button>
      )}

      <span style={label}>Out: what is read back</span>
      {reads.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input aria-label={`Output ${i + 1} name`} value={r.name} style={{ ...field, flex: 1 }}
            onChange={e => setReads(reads.map((g, j) => (j === i ? { ...g, name: e.target.value } : g)))} />
          <span style={{ font: `600 10.5px ${fontFamily.ui}`, color: tk.text.muted, width: 34, textAlign: 'right' }}>{typeForWidth(r.channels.length)}</span>
          {[...CHANNELS].map(c => (
            <button key={c} type="button" aria-label={`Output ${i + 1} channel ${c}`} style={chip(c, r.channels.includes(c), true)}
              title={r.channels.includes(c) ? `Position ${r.channels.indexOf(c) + 1} of .${r.channels}` : `Add ${c}`} onClick={() => toggleOut(i, c)}>{c}</button>
          ))}
          <button type="button" aria-label={`Remove output ${i + 1}`} style={x} onClick={() => setReads(reads.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {reads.length < MAX_FIELDS && (
        <button type="button" style={add} onClick={() => setReads([...reads, { name: `output ${reads.length + 1}`, channels: 'rgba' }])}>+ Output</button>
      )}
      <span style={{ fontSize: 11, lineHeight: 1.4, color: tk.text.muted }}>
        Outputs read at this pixel (or Read at). A read that feeds this node sees last frame.
      </span>
    </div>
  );
}
