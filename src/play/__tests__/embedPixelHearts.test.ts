/**
 * The "Pixel hearts" scene (2D Scene Builder template: Pixelate, two hearts, a navy background)
 * exported both ways, as the Put it on a website dialog does: the small page and the full player.
 *
 * The bug: the small page's Download put `background:#000` on <body> while the picture sat behind
 * the page at z-index −1. A body with its own background paints over negative z-index content, so
 * the downloaded page showed only black (for every small export, this one included).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import { parser } from '@shaderfrog/glsl-parser';
import { snapshotFromGraph } from '../../present/snapshot';
import { DEFAULT_EMBED, buildPlayHtml, type PlayHtmlInput } from '../exportHtml';
import { buildLitePage, liteBlockers } from '../embedLite';
import { emptyPlayRecord } from '../../types/play';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { templateScene } from '../../sceneBuilder2d/templates';

/** Run a small page's bootstrap against a recording WebGL2 stand-in; returns the calls it made. */
function runLitePage(page: string): { calls: string[]; fragment: string } {
  const calls: string[] = [];
  const sources: string[] = [];
  let uniforms: { name: string; type: number }[] = [];
  const T: Record<string, number> = { float: 5126, vec2: 35664, vec3: 35665, vec4: 35666, int: 5124, bool: 35670, sampler2D: 35678 };
  const gl = new Proxy({}, {
    get(_t, k: string) {
      if (/^[A-Z0-9_]+$/.test(k)) return k === 'TEXTURE0' ? 33984 : k === 'ACTIVE_UNIFORMS' ? 35718 : 1;
      if (k === 'shaderSource') return (_s: unknown, src: string) => {
        sources.push(src);
        uniforms = [...src.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)/gm)].filter(m => (src.match(new RegExp(`\\b${m[2]}\\b`, 'g')) ?? []).length > 1).map(m => ({ name: m[2], type: T[m[1]] }));
      };
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return (_p: unknown, what: number) => (what === 35718 ? uniforms.length : true);
      if (k === 'getActiveUniform') return (_p: unknown, i: number) => ({ name: uniforms[i].name, type: uniforms[i].type, size: 1 });
      if (k === 'getUniformLocation') return (_p: unknown, name: string) => name;
      if (/^uniform/.test(k)) return (at: string, a: unknown) => calls.push(`${k} ${at} ${String(a)}`);
      if (k === 'drawArrays') return () => calls.push('drawArrays');
      if (k === 'getExtension') return () => null;
      return () => ({});
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => gl };
  const listeners: string[] = [];
  const root = { dataset: {}, textContent: '', querySelector: () => canvas, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }), addEventListener: (e: string) => listeners.push(`root:${e}`) };
  const glsl = page.split('<script type="x-shader/x-fragment">\n')[1].split('\n</script>')[0];
  const call = page.split('<script>\n')[1].split('\n</script>')[0]
    .replace(/\(function \(\) \{ var el = document\.currentScript[^\n]*\n/, 'ROOT,\n')
    .replace('document.currentScript.previousElementSibling.textContent', 'GLSL');
  const raf: ((t: number) => void)[] = [];
  const win = { devicePixelRatio: 1, addEventListener: (e: string) => listeners.push(`window:${e}`), matchMedia: () => ({ matches: false }) };
  new Function('ROOT', 'GLSL', 'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'matchMedia', call)(
    root, glsl, win, { hidden: false }, (f: (t: number) => void) => raf.push(f), () => {},
    class { observe() {} }, class { observe() {} }, class {}, () => ({ matches: false }),
  );
  raf.shift()!(16); raf.shift()!(32);
  calls.push(...listeners);
  return { calls, fragment: sources[1] ?? '' };
}

describe('the Pixel hearts scene, exported for the web', () => {
  let input: PlayHtmlInput;
  beforeAll(() => {
    const { nodes } = buildStandalone2D(templateScene('pixel'));
    const r = snapshotFromGraph(nodes, emptyPlayRecord(), { title: 'Pixel hearts', from: { kind: 'example', key: 'pixel' } });
    if (!r.ok) throw new Error(r.error);
    input = r.source.bundle;
  });

  it('goes to the small page (nothing it uses needs the player)', () => {
    expect(liteBlockers(input)).toEqual([]);
  });

  it('small page: the picture is not hidden behind the page, and it draws', () => {
    const page = buildLitePage(input, { ...DEFAULT_EMBED });
    // Black on <html> only: a <body> background would paint over the z-index −1 picture.
    const css = page.match(/<style>([^<]*)<\/style>/)![1];
    expect(css).toMatch(/html\{[^}]*background:#000/);
    expect(css).not.toMatch(/body\{[^}]*background/);
    expect(css).not.toMatch(/html,\s*body\{[^}]*background/);
    expect(page).toContain('z-index:-1');
    const { calls, fragment } = runLitePage(page);
    expect(fragment).toMatch(/^#version 300 es\n/);
    expect(() => parser.parse(page.split('<script type="x-shader/x-fragment">\n')[1].split('\n</script>')[0], { quiet: true })).not.toThrow();
    expect(calls.filter(c => c === 'drawArrays').length).toBe(2);
    // The hearts' colours and the pixel size reach the shader.
    expect(calls.some(c => /^uniform3fv u_p_colorpicke\w* /.test(c))).toBe(true);
    expect(calls.some(c => c.startsWith('uniform1fv u_p_pxlx1_pixelSize 0.05'))).toBe(true);
    // The pointer is read from the window: the background layer itself ignores pointer events.
    expect(calls).toContain('window:pointermove');
  });

  it('full player page: carries the player and this shader', () => {
    const html = buildPlayHtml(input, DEFAULT_EMBED);
    expect(html).toContain('ShaderStudioPlay');
    expect(html).toContain('sdHeart');
    expect(html).toContain('u_p_pxlx1_pixelSize');
  });
});
