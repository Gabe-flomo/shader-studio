/**
 * The web-page export is one file: the shader, the uniforms, the record and
 * the runtime, with nothing that could close the script element early.
 */
import { describe, it, expect } from 'vitest';
import { buildPlayHtml, unsupportedFeatures } from '../exportHtml';
import { emptyPlayRecord } from '../../types/play';

describe('play HTML export', () => {
  it('bundles the shader, the record and the runtime, and escapes script closers', () => {
    const play = { ...emptyPlayRecord(), controls: [{ id: 'c', target: 'n::k', kind: 'float' as const, label: 'A </script> B', min: 0, max: 1 }] };
    const html = buildPlayHtml({
      title: 'My <Piece>', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }',
      uniforms: { u_p_n_k: 0.5 }, paramBindings: { 'n::k': 'u_p_n_k' }, play, aspect: '16:9',
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>My &lt;Piece&gt;</title>');
    expect(html).toContain('window.PLAY_BUNDLE = {');
    expect(html).toContain('"fragmentShader":"precision highp float;');
    expect(html).toContain('"ratio":1.7777777777777777');
    expect(html).toContain('A <\\/script> B'); // the label can't end the script element
    expect(html).toContain('window.PLAY_BUNDLE;'); // the runtime is inlined
    expect(html.match(/<\/script>/g)?.length).toBe(2);
  });

  it('lists what the page cannot run', () => {
    const base = { textureUniforms: {}, videoUniforms: {}, audioUniforms: {}, liveUniforms: {}, isStateful: false, particleSystems: [], usesEcho: false, play: emptyPlayRecord() };
    expect(unsupportedFeatures(base)).toEqual([]);
    expect(unsupportedFeatures({ ...base, textureUniforms: { u_tex: 'n1' }, isStateful: true })).toEqual(['image inputs', 'the previous-frame feedback']);
  });
});
