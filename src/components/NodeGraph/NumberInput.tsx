import { useState } from 'react';

/**
 * A numeric <input> that can actually be cleared.
 *
 * The naive pattern this replaces — `<input type="number" value={n}
 * onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v))
 * commit(v); }} />` — binds the input's displayed text directly to the
 * last successfully-parsed number. Deleting all the digits produces ''`,
 * `parseFloat('')` is NaN, the handler bails without committing, and React
 * immediately redraws the (unchanged) controlled value back over whatever
 * was just deleted — so backspacing to retype a value is impossible; the
 * old digits reappear the instant the field goes empty.
 *
 * This component keeps its own local text state, decoupled from the
 * committed number, and only re-syncs that text from `value` when the
 * field isn't focused — so an in-progress empty/partial edit ("", "-",
 * "1.") is left alone instead of being stomped every render. A valid
 * parse commits immediately (unchanged live-update behavior); leaving the
 * field on an unparseable value reverts it to the last committed one on
 * blur, the same as the browser's own type="number" does today.
 */
export function NumberInput({
  value, onCommit, format = String, style, ...rest
}: {
  value: number;
  onCommit: (n: number) => void;
  /** How the value is shown while not being edited (e.g. fixed decimals). Defaults to String. */
  format?: (n: number) => string;
  step?: number;
  min?: number;
  max?: number;
  style?: React.CSSProperties;
  title?: string;
  disabled?: boolean;
}) {
  // The text being typed, only while the field has focus; otherwise the field shows `value` as is.
  // (Derived, not synced in an effect: an effect that set the text on every new value scheduled an
  // extra render per change, and a burst of key repeats on a slider beside it, which the browser
  // runs ahead of React's queued renders, piled them up into "Maximum update depth exceeded".)
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? format(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => setDraft(format(value))}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        // Mid-edit states (empty, a lone sign, a trailing decimal point)
        // parse to a stale/wrong number or NaN — leave them displayed
        // as-is without committing anything until they resolve into a
        // real number.
        if (/^-?\.?$/.test(raw.trim())) return;
        const n = parseFloat(raw);
        if (!isNaN(n)) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      style={style}
      {...rest}
    />
  );
}
