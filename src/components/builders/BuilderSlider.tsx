/**
 * BuilderSlider — every builder's number slider (docs/scene-builder.md, "Sliders"), the app's own
 * RulerSlider with the app's habits:
 *
 *  - double-click resets it: to its default when the builder knows one, else to the value it had
 *    when it came into view;
 *  - a range symmetric about zero (−N … N) is shown bipolar: zero marked, the stretch to the
 *    needle tinted;
 *  - typing past the end widens the range (no min/max fields), and the builder remembers the wider
 *    range for as long as the app runs (`rangeKey`);
 *  - where the value is a real node's param (`param`), right-click opens the Play menu the node
 *    card has: Add to (or Remove from) Play controls. A builder that edits a recipe (the 3D Scene
 *    Builder) passes `lazyParam` instead: the node it built, looked up when the menu opens
 *    (sceneBuilder/paramMap.ts), or why there is none yet.
 *  - in a builder that keeps Quick controls (quickPinContext.ts: the 2D Scene Builder), a small pin on hover and
 *    "Add to quick controls" in the right-click menu pin it under the preview.
 *  - in a builder on a phone (PhoneStudio) it takes the touch size: a 40 px track, dragged with a
 *    finger, double tap to reset.
 */
import { useContext, useState, type ReactNode } from 'react';
import { PhoneStudioContext } from './studio/PhoneStudio';
import { RulerSlider } from '../ui/RulerSlider';
import { isSymmetricRange } from '../ui/rulerMath';
import { ContextMenuArea } from '../ui/ContextMenuArea';
import { paramPlayItems } from './paramPlayMenu';
import { widenedRanges as widened } from './builderSliderRanges';
import { QuickPinContext } from './quickPinContext';
import type { MenuItem } from '../ui/Menu';
import { Icon } from '../ui/Icon';


/**
 * The least track a builder slider keeps beside its number chip: in a narrow panel (an X / Y / Z
 * row, a drawer) the track used to shrink to nothing, leaving only the chip ("I can't get into these
 * sliders").
 */
export const TRACK_MIN = 64;

export interface BuilderSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  onChange: (v: number) => void;
  ariaLabel: string;
  /** What double-click goes back to. Without one, the value it had when it came into view. */
  defaultValue?: number;
  disabled?: boolean;
  /** Names the slider for its remembered range ("scene3d:camera:dist"). Without one, the range lasts while it is shown. */
  rangeKey?: string;
  /** A real node param this slider sets: right-click offers the node card's Play menu. */
  param?: { nodeId: string; key: string };
  /** The node param this value builds, found when the menu opens; `missing` says why there is none (shown in the menu). */
  lazyParam?: () => { nodeId: string; key: string } | { missing: string };
  /** Force bipolar on or off (default: on for a range symmetric about zero). */
  bipolar?: boolean;
  hard?: boolean;
  /** The ruler's unit (RulerSlider `unit`). */
  unit?: number | ((min: number, max: number) => number | undefined);
}

export function BuilderSlider({ value, min, max, step, integer, onChange, ariaLabel, defaultValue, disabled, rangeKey, param, lazyParam, bipolar, hard, unit }: BuilderSliderProps) {
  const [mountValue] = useState(value);
  const touch = useContext(PhoneStudioContext);
  const [, bump] = useState(0);
  const kept = rangeKey ? widened.get(rangeKey) : undefined;
  const lo = kept ? Math.min(min, kept.min) : min;
  const hi = kept ? Math.max(max, kept.max) : max;
  const slider: ReactNode = (
    <RulerSlider value={value} min={lo} max={hi} step={integer ? 1 : step} integer={integer} onChange={onChange} ariaLabel={ariaLabel}
      defaultValue={defaultValue ?? mountValue} disabled={disabled} hard={hard} unit={unit} touch={touch}
      bipolar={bipolar ?? isSymmetricRange(lo, hi)} trackMinWidth={TRACK_MIN}
      onRange={rangeKey ? (a, b) => { widened.set(rangeKey, { min: a, max: b }); bump(n => n + 1); } : undefined} />
  );
  const quick = useContext(QuickPinContext);
  const pinIt = quick ? () => quick.pin({ label: ariaLabel, value, min: lo, max: hi, step, integer, onChange, lazyParam }) : null;
  const quickItems: MenuItem[] = pinIt ? ['separator', { label: 'Add to quick controls', icon: 'sliders', hint: 'Under the preview', onSelect: pinIt }] : [];
  const shown: ReactNode = pinIt ? (
    <span data-quick-pin-row style={{ display: 'flex', flex: 1, minWidth: 0, alignItems: 'center', gap: 2 }}>
      {slider}
      <button type="button" data-quick-pin title="Add to quick controls (under the preview)" aria-label={`Add ${ariaLabel} to quick controls`} onClick={pinIt}
        style={{ flexShrink: 0, width: 18, height: 18, padding: 0, border: 0, borderRadius: 4, background: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="sliders" size={12} />
      </button>
    </span>
  ) : slider;
  if (!param && lazyParam) {
    const items = () => {
      const p = lazyParam();
      return [...('missing' in p ? [{ heading: 'Play' }, { label: p.missing, disabled: true, onSelect: () => {} }] as MenuItem[] : paramPlayItems(p.nodeId, p.key)), ...quickItems];
    };
    return (
      <ContextMenuArea items={items} style={{ display: 'flex', flex: 1, minWidth: 0 }}>
        <span data-builder-lazy-param style={{ display: 'flex', flex: 1, minWidth: 0 }}>{shown}</span>
      </ContextMenuArea>
    );
  }
  if (!param) return pinIt ? <ContextMenuArea items={() => quickItems.slice(1)} style={{ display: 'flex', flex: 1, minWidth: 0 }}>{shown}</ContextMenuArea> : <>{slider}</>;
  return (
    <ContextMenuArea items={() => [...paramPlayItems(param.nodeId, param.key), ...quickItems]} style={{ display: 'flex', flex: 1, minWidth: 0 }}>
      <span data-builder-param={`${param.nodeId}::${param.key}`} style={{ display: 'flex', flex: 1, minWidth: 0 }}>{shown}</span>
    </ContextMenuArea>
  );
}
