import React, { Suspense } from 'react';
import { isChunkLoadError, reportStaleBuild } from '../lib/staleBuild';

/**
 * React.lazy plus its own Suspense boundary, so a chunk loading never blanks
 * anything but the component itself. Used for the pages, modals and editors
 * that only appear on demand; the caller passes the props type explicitly
 * (usually via a type-only import of the real component, which is erased at
 * build time and so doesn't pull the chunk into the caller's bundle).
 */
export function lazyWithSuspense<P extends object>(loader: () => Promise<{ default: React.ComponentType<P> }>) {
  // A chunk from a version that was redeployed under this tab is gone: explain and render nothing,
  // rather than crash the page.
  const Lazy = React.lazy(() => loader().catch(err => {
    if (!isChunkLoadError(err)) throw err;
    reportStaleBuild();
    return { default: (() => null) as React.ComponentType<P> };
  }));
  return function LazyBoundary(props: P) {
    return <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  };
}

/** Props of a function component; `{}` for one that takes none. */
export type PropsOf<T> = T extends () => unknown ? Record<never, never> : T extends (props: infer P) => unknown ? P : never;
