/**
 * ExplainText draws an explanation's tokens as chips: a variable in its type's colour, a number in
 * the number colour, code highlighted, each with words for screen readers.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { renderToStaticMarkup } from 'react-dom/server';
import { ExplainText, segColor } from '../ExplainText';
import { ExplainView } from '../ExplainView';
import { GlslCode } from '../GlslCode';
import { explainLine } from '../../../lib/glslPatterns';
import { C, C_LIGHT } from '../../glslSyntax';

const line = () => {
  const r = explainLine('float silent = 1.0 - step(0.02, a)', { types: { a: 'float' } });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const chips = (html: string, kind: string) => [...html.matchAll(new RegExp(`data-explain-chip="${kind}"[^>]*>([^<]*)<`, 'g'))].map(m => m[1]);

describe('ExplainText', () => {
  it('renders names and numbers as chips, words as text', () => {
    const html = renderToStaticMarkup(<ExplainText segs={line().leadSegs} />);
    expect(chips(html, 'var')).toEqual(['silent', 'a', 'a']);
    expect(chips(html, 'num')).toEqual(['0.02']);
    expect(html).toContain('stays under ');
  });

  it('chips keep readable words for screen readers', () => {
    const html = renderToStaticMarkup(<ExplainText segs={line().leadSegs} />);
    expect(html).toContain('aria-label="variable a"');
    expect(html).toContain('aria-label="variable silent"');
    expect(html).toContain('aria-label="0.02"');
    expect(html).toContain('title="a · float"');
  });

  it('colours a variable by its type, a number as a number (the highlighter’s colours)', () => {
    const segs = line().leadSegs;
    const a = segs.find(s => s.kind === 'var' && s.name === 'a')!;
    expect(segColor(a, C)).toBe(C.typeFloat);
    expect(segColor({ kind: 'var', text: 'uv', name: 'uv', type: 'vec2' }, C_LIGHT)).toBe(C_LIGHT.typeVec2);
    expect(segColor({ kind: 'num', text: '1' }, C)).toBe(C.number);
    expect(segColor({ kind: 'fn', text: 'foo' }, C)).toBe(C.builtin);
  });

  it('lights the chips of the variable hovered in the code', () => {
    const off = renderToStaticMarkup(<ExplainText segs={line().leadSegs} />);
    const on = renderToStaticMarkup(<ExplainText segs={line().leadSegs} activeVar="a" />);
    expect(on).not.toBe(off);
  });

  it('code chips are syntax-highlighted', () => {
    const html = renderToStaticMarkup(<ExplainText segs={[{ kind: 'code', text: 'step(0.02, a)' }]} />);
    expect(html).toContain('data-explain-chip="code"');
    expect(html).toContain('aria-label="code step(0.02, a)"');
    expect(html).toContain(`color:${C_LIGHT.builtin}`);
    expect(html).toContain(`color:${C_LIGHT.number}`);
  });
});

describe('GlslCode and ExplainView', () => {
  it('highlights the code and lights a variable’s reads', () => {
    const html = renderToStaticMarkup(<GlslCode code="1.0 - step(0.02, a)" spans={[{ start: 17, end: 18, kind: 'var' }]} />);
    expect(html).toContain('data-explain-var-highlight');
    expect(html).toMatch(/data-explain-var-highlight[^>]*><span[^>]*>a<\/span><\/mark>/);
  });

  it('leads with the plain meaning, folds the literal reading, and plots a function of one number', () => {
    const html = renderToStaticMarkup(<ExplainView ex={line()} />);
    expect(html).toContain('data-explain-sentence');
    expect(html).toContain('stays under');
    expect(html).toContain('Literal reading and steps');
    expect(html).not.toContain('data-explain-literal'); // folded by default
    expect(html).toContain('data-transfer-plot="small"');
    expect(html).toContain('a hard on/off mask');
  });

  it('offers a picture instead of a plot for a line that reads space', () => {
    const r = explainLine('float d = length(p) - 0.3', { types: { p: 'vec2' } });
    if (!r.ok) throw new Error(r.error);
    const html = renderToStaticMarkup(<ExplainView ex={r} onShowPicture={() => {}} />);
    expect(html).not.toContain('data-transfer-plot');
    expect(html).toContain('data-explain-action="show-picture"');
  });
});
