import React, { Suspense } from 'react';

/**
 * React.lazy plus its own Suspense boundary, so a chunk loading never blanks
 * anything but the component itself. Used for the pages, modals and editors
 * that only appear on demand; the caller passes the props type explicitly
 * (usually via a type-only import of the real component, which is erased at
 * build time and so doesn't pull the chunk into the caller's bundle).
 */
export function lazyWithSuspense<P extends object>(loader: () => Promise<{ default: React.ComponentType<P> }>) {
  const Lazy = React.lazy(loader);
  return function LazyBoundary(props: P) {
    return <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  };
}

/** Props of a function component; `{}` for one that takes none. */
export type PropsOf<T> = T extends () => unknown ? Record<never, never> : T extends (props: infer P) => unknown ? P : never;
