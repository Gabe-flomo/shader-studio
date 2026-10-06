/**
 * "How is this used?" for the code editors: opens the Code Explorer on the
 * function at the caret of the field being edited. The button doesn't take
 * focus, so the caret it reads stays where it was.
 */
import { Button } from '../ui/Button';
import { openCodeExplorer, wordAtCaret } from './explorerStore';

export function HowUsedButton() {
  return (
    <Button size="sm" variant="ghost" icon="search" style={{ marginRight: 4 }}
      title="How is this used? Put the caret on a function (smoothstep, mix…) to see how written code across the examples and your graphs uses it"
      onMouseDown={e => e.preventDefault()}
      onClick={() => openCodeExplorer(wordAtCaret(document.activeElement))}>
      How is this used?
    </Button>
  );
}
