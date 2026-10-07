/**
 * SurpriseBar — the builders' "Surprise me" control (docs/surprise.md): the button, the seed it
 * used (shown and editable: type a seed and press Enter to rebuild that result, or share it), and
 * Reroll (a new seed). The toast every surprise shows is in announce.ts.
 */
import { useState } from 'react';
import { newSeed, seedFrom } from '../../lib/surprise';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';

export function SurpriseBar({ seed, onSurprise, label = 'Surprise me', title, busy = false }: {
  /** The seed of the last surprise (null: none yet). */
  seed: number | null;
  /** Make a surprise from this seed. */
  onSurprise: (seed: number) => void;
  label?: string;
  title?: string;
  busy?: boolean;
}) {
  // What is typed, until the next surprise shows its own seed.
  const [typing, setTyping] = useState<{ for: number | null; text: string } | null>(null);
  const text = typing && typing.for === seed ? typing.text : seed === null ? '' : String(seed);
  const setText = (t: string) => setTyping({ for: seed, text: t });
  const typed = seedFrom(text);
  const apply = () => { if (typed !== null) onSurprise(typed); };
  return (
    <span data-surprise-bar style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Button size="sm" icon="dice" disabled={busy} title={title ?? 'A random result from a new seed (one undo step)'} onClick={() => onSurprise(newSeed())} data-surprise-me>{label}</Button>
      <Field value={text} placeholder="seed" aria-label="Seed" title="The seed of the last surprise. Type one (a number or a word) and press Enter to make that result again." mono height={28}
        style={{ width: 84 }} data-surprise-seed
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }} />
      <IconButton icon="rebuild" size="sm" label="Reroll: another seed" disabled={busy} onClick={() => onSurprise(newSeed())} data-surprise-reroll />
    </span>
  );
}
