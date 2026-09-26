import React, { Suspense, useState } from 'react';
import { isChunkLoadError, reportStaleBuild } from '../lib/staleBuild';

/**
 * React.lazy plus its own Suspense boundary, so a chunk loading never blanks
 * anything but the component itself. Used for the pages, modals and editors
 * that only appear on demand; the caller passes the props type explicitly
 * (usually via a type-only import of the real component, which is erased at
 * build time and so doesn't pull the chunk into the caller's bundle).
 *
 * Preloaded (see preloadLazyComponents): once its chunk is in, the component
 * renders directly, with no Suspense. That matters on a busy page: React
 * finishes a suspended component with its lowest-priority work, which never
 * runs while something re-renders every frame (a Play panel with a mapping
 * running), so an on-demand dialog would never appear.
 */
export function lazyWithSuspense<P extends object>(loader: () => Promise<{ default: React.ComponentType<P> }>) {
  let loaded: React.ComponentType<P> | null = null;
  let pending: Promise<unknown> | null = null;
  const load = () => loader().then(m => { loaded = m.default; return m; });
  // A chunk from a version that was redeployed under this tab is gone: explain and render nothing,
  // rather than crash the page.
  const Lazy = React.lazy(() => load().catch(err => {
    if (!isChunkLoadError(err)) throw err;
    reportStaleBuild();
    return { default: (() => null) as React.ComponentType<P> };
  }));
  function LazyBoundary(props: P) {
    // Keep one path per mounted instance, so a preload finishing later doesn't remount it.
    const [Loaded] = useState(() => loaded);
    if (Loaded) return <Loaded {...props} />;
    return <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  }
  preloaders.add(() => { pending ??= load().catch(() => { pending = null; }); return pending; });
  return LazyBoundary;
}

const preloaders = new Set<() => Promise<unknown>>();

/** Fetch every on-demand chunk now (quietly; failures are left for when they're opened). */
export function preloadLazyComponents(): Promise<unknown> {
  return Promise.all([...preloaders].map(p => p()));
}

/** Props of a function component; `{}` for one that takes none. */
export type PropsOf<T> = T extends () => unknown ? Record<never, never> : T extends (props: infer P) => unknown ? P : never;
