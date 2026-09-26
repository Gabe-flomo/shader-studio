import { describe, expect, it } from 'vitest';
import { renderMarkdown, notesToMarkdown } from '../markdown';

describe('Present markdown', () => {
  it('renders inline and display maths, and leaves prices alone', () => {
    const html = renderMarkdown('Area is $\\pi r^2$, costs $5 and $6.\n\n$$\n\\int_0^1 x\\,dx\n$$\n');
    expect(html).toContain('class="katex"');
    expect(html).toContain('pp-math-display');
    expect(html).toContain('costs $5 and $6.');
    expect(html).toMatchSnapshot();
  });

  it('is deterministic', () => {
    const src = '# Title\n\nSome **bold**, `code`, and $a^2+b^2=c^2$.\n\n- one\n- two $x$\n\nInline display $$\\sum_i x_i$$ here.\n';
    expect(renderMarkdown(src)).toBe(renderMarkdown(src));
    expect(renderMarkdown(src, { math: 'mathml' })).toMatchSnapshot();
  });

  it('keeps a dollar escaped with a backslash', () => {
    expect(renderMarkdown('It costs \\$5, then $x$.')).toContain('It costs $5');
  });

  it('turns control refs into chips with the block labels', () => {
    const html = renderMarkdown('Drag [[control:freq]] and [[control:gone]].', { controls: { freq: 'Frequency' } });
    expect(html).toContain('<button type="button" class="pp-chip" data-control="freq">Frequency</button>');
    expect(html).toContain('pp-chip-gone');
  });

  it('never passes raw HTML through, and links open in a new tab', () => {
    const html = renderMarkdown('<script>alert(1)</script> [site](https://example.com) [x](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('href="javascript:');
  });

  it('MathML output has no KaTeX HTML spans (no fonts needed)', () => {
    const html = renderMarkdown('$x$', { math: 'mathml' });
    expect(html).toContain('<math');
    expect(html).not.toContain('katex-html');
  });

  it('turns note bullets into Markdown lists', () => {
    expect(notesToMarkdown('Hi\n• one\n• two')).toBe('Hi\n- one\n- two');
  });
});
