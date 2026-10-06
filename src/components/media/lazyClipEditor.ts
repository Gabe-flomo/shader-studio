/**
 * The clip editor window (ClipEditorModal.tsx), loaded on demand in its own
 * chunk: every host opens it through this, so the editor stays one component
 * and costs nothing until a video is opened.
 */
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { ClipEditorModal as ClipEditorModalT } from './ClipEditorModal';

export const LazyClipEditorModal = lazyWithSuspense<PropsOf<typeof ClipEditorModalT>>(() => import('./ClipEditorModal').then(m => ({ default: m.ClipEditorModal })));
