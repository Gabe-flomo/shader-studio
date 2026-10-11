/**
 * NewGraphSheet — the phone's "New graph…" (MobileTopBar's ⋯ menu): a new graph starts from the
 * Scene builder's kind page (builders/newGraph.ts), with "Start from an empty graph" as a small link
 * under it. Either one replaces the graph that is open, so the sheet says so first. Our own sheet
 * rather than window.confirm(), which is unreliable in a Tauri webview.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { startNewGraph } from '../../builders/newGraph';

export function NewGraphSheet({ onClose }: { onClose: () => void }) {
  const tk = useTokens();
  const start = (empty: boolean) => { onClose(); void startNewGraph({ empty }); };
  return (
    <Sheet title="Start a new graph?" onClose={onClose}>
      <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5, color: tk.text.muted }}>
        This replaces the graph that is open, and can’t be undone. Pick what kind of scene to make; once it is built you can change anything.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button variant="primary" icon="presets" data-new-graph="builder" style={{ height: 44 }} onClick={() => start(false)}>Start from a Scene builder</Button>
        <Button style={{ height: 44 }} onClick={onClose}>Cancel</Button>
        <button type="button" data-new-graph="empty" onClick={() => start(true)}
          style={{ alignSelf: 'center', minHeight: 40, padding: '0 12px', border: 0, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `500 13px ${fontFamily.ui}`, textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Start from an empty graph
        </button>
      </div>
    </Sheet>
  );
}
