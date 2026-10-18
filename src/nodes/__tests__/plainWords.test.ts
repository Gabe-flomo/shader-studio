/**
 * Plain words on first-run surfaces (UX audit §3.6): no "Drive with a null", no "Materialize"
 * button, no raw "Transform Vec" heading in Presets, a plain Expression Block blurb, and the
 * built-in signal rows only once there's a signal.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { nodeBlurb } from '../plainDescriptions';
import { getNodeDefinition } from '../definitions';

const src = (f: string) => readFileSync(f, 'utf8');

describe('plain words', () => {
  it('the Expression Block blurb says what it is without jargon', () => {
    const b = nodeBlurb(getNodeDefinition('exprNode'))!;
    expect(b).not.toMatch(/Generalized|multi-statement/);
    expect(b).toMatch(/GLSL math/);
  });

  it('other nodes keep their own description', () => {
    const def = getNodeDefinition('uv')!;
    expect(nodeBlurb(def)).toBe(Array.isArray(def.description) ? def.description.join('\n') : def.description);
  });

  it('the jargon is gone from the buttons and headings', () => {
    expect(src('src/components/play/PlayPage.tsx')).not.toMatch(/Drive with a null/);
    expect(src('src/components/NodeGraph/NodeGraph.tsx')).not.toMatch(/Drive with a null/);
    expect(src('src/components/convert/ConvertPage.tsx')).not.toMatch(/>Materialize</);
    expect(src('src/components/convert/guided/GuidedConvert.tsx')).not.toMatch(/>Materialize</);
    expect(src('src/components/NodeGraph/NodePalette.tsx')).not.toMatch(/TabSectionHeader label="Transform Vec"/);
  });

  it('the built-in signal rows wait for a signal', () => {
    expect(src('src/components/play/PlayPage.tsx')).toMatch(/!!play\.signals\?\.length && <ProLock feature="play\.sources"[^\n]*<BuiltInSignalsSection/);
  });

  it('the list, the search and the preview card read the plain blurb', () => {
    for (const f of ['src/components/NodeGraph/NodeBrowser.tsx', 'src/components/NodeGraph/NodeSearchPalette.tsx']) expect(src(f)).toMatch(/nodeBlurb\(/);
  });
});
