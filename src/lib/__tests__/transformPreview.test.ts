/**
 * A Transform's card follows its Dimension (docs/transform-node.md): its preview (2D space diagram, 3D / 4D
 * settings list) and its colour (2D Space, 3D Transforms, 4D).
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { PARAM_LIST_TYPES, previewPlan, previewTypeOf } from '../nodePreview/previewPlan';
import { hasRealDiagram, INLINE_VIZ_TYPES } from '../../components/NodeGraph/NodeInlineViz';
import { GENERIC_VIZ_TYPES } from '../../components/NodeGraph/vizGeneric';
import { nodeCategory } from '../../nodes/nodeCategory';
import { categoryColor } from '../../theme/categories';
import { n } from '../../store/graphBuilder';

const t = (dim: string) => n('transform', 't', 0, 0, { dim });

describe('the Transform card follows its Dimension', () => {
  it('preview: 2D draws its space, 3D and 4D list their settings, like the nodes they replace', () => {
    expect([previewTypeOf(t('2')), previewTypeOf(t('3')), previewTypeOf(t('4'))]).toEqual(['transform', 'transform3D', 'transform4D']);
    expect(GENERIC_VIZ_TYPES.has('transform')).toBe(true);
    expect(hasRealDiagram('transform')).toBe(true);
    expect(PARAM_LIST_TYPES.has('transform3D') && INLINE_VIZ_TYPES.has('transform3D')).toBe(true);
    expect(hasRealDiagram('transform3D')).toBe(hasRealDiagram('translate3D'));
    // Inside a Scene Group a 3D Transform shows what Translate 3D shows there; at the top level its value.
    expect(previewPlan(t('3'), hasRealDiagram, 'sceneGroup')).toEqual(previewPlan(n('translate3D', 'x', 0, 0), hasRealDiagram, 'sceneGroup'));
    expect(previewPlan(t('2'), hasRealDiagram).body).toBe('field');
    expect(previewPlan(t('2'), hasRealDiagram).diagram).toBe(true);
  });
  it('colour: the category of its Dimension', () => {
    expect([nodeCategory(t('2')), nodeCategory(t('3')), nodeCategory(t('4'))]).toEqual(['2D Space', '3D Transforms', '4D']);
    const c = (dim: string) => categoryColor(nodeCategory(t(dim))!, 'dark');
    expect(c('3')).toBe(categoryColor('3D Transforms', 'dark'));
    expect(c('4')).toBe(categoryColor('4D', 'dark'));
    expect(new Set([c('2'), c('3'), c('4')]).size).toBe(3);
  });
});
