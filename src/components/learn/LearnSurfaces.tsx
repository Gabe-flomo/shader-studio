/**
 * The Start sheet and the Learn dialog, wherever the app is (learnStore.ts), and the first-run
 * offer: once per device on a desktop or tablet, on the Studio, once nothing else is asking
 * (the Recover dialog comes first).
 */
import { useEffect } from 'react';
import { LearnDialog } from './LearnDialog';
import { StartSheet } from './StartSheet';
import { markStartSheetShown, shouldShowStartSheet, useLearnUi } from './learnStore';

/** How long after launch to look (the Recover offer starts a second in), and how long to keep waiting for a free moment. */
const FIRST_LOOK_MS = 1800;
const GIVE_UP_MS = 15000;

export function LearnSurfaces({ phone, page }: { phone: boolean; page: string }) {
  const startOpen = useLearnUi(s => s.startOpen);
  const learnOpen = useLearnUi(s => s.learnOpen);
  useFirstRunStart(phone, page);
  return (
    <>
      {startOpen && <StartSheet />}
      {learnOpen && <LearnDialog />}
    </>
  );
}

function useFirstRunStart(phone: boolean, page: string) {
  useEffect(() => {
    if (!shouldShowStartSheet({ phone, page })) return;
    // Not when a link opened something (a query or hash): that is what the visitor came for.
    if (window.location.search || window.location.hash) return;
    const began = Date.now();
    let timer = 0;
    const look = () => {
      if (!shouldShowStartSheet({ phone, page })) return;
      // Something else is up (Recover, a builder): wait for it, then offer.
      if (document.querySelector('[role="dialog"]')) {
        if (Date.now() - began < GIVE_UP_MS) timer = window.setTimeout(look, 1000);
        return;
      }
      markStartSheetShown();
      useLearnUi.getState().openStart();
    };
    timer = window.setTimeout(look, FIRST_LOOK_MS);
    return () => window.clearTimeout(timer);
  }, [phone, page]);
}
