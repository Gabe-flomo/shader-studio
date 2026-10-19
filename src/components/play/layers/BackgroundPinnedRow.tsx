/**
 * BackgroundPinnedRow — the Background as the Layers list's pinned first row
 * (Play audit P13). There is one place for it now: not a Layers sub-page, not
 * a bar above the list, not a kind in Add layer.
 *
 * With a Background layer (a queue of graphs, images, videos), the pinned row
 * is that layer's own card (LayersPanel renders it). Without one, it's this
 * row: what the picture is under the layers (the shader, a colour, an image or
 * a video from before the layer), opening the Background's settings
 * (FullPages.BackgroundSettings) like any layer opens its editor — beside the
 * list in a wide panel, under the row otherwise. Its Graph…, Image… and
 * Video… make the Background layer, which then takes this row's place.
 */
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { backgroundSource, DEFAULT_DISPLAY, type PlayRecord } from '../../../types/play';
import { Icon } from '../../ui/Icon';

/** The selection id of the pinned row while there's no Background layer (usePlayUi.selected). */
export const BACKGROUND_ROW = 'play:background';

/** What the picture is under the layers, in a few words (the pinned row's summary). */
export function backgroundSummary(play: Pick<PlayRecord, 'display'>): string {
  const d = play.display ?? DEFAULT_DISPLAY;
  const src = backgroundSource(d);
  const what = src === 'colour'
    ? (d.colourMode === 'palette' ? `Palette${d.fill?.name ? ` · ${d.fill.name}` : ''}` : d.colourMode === 'gradient' ? 'Gradient' : 'Colour')
    : src === 'image' ? `Image${d.image?.name ? ` · ${d.image.name}` : ''}`
      : src === 'video' ? `Video${d.video?.name ? ` · ${d.video.name}` : ''}`
        : 'The shader';
  return src !== 'colour' && d.picture === false ? `${what} · layers only` : what;
}

/** The pinned row with no Background layer: its name and summary; selecting it opens the settings. */
export function BackgroundPinnedRow({ play, selected, open, touch, onSelect }: {
  play: PlayRecord;
  selected: boolean;
  /** Its settings show under it (a stacked list): the chevron points down. */
  open?: boolean;
  touch: boolean;
  onSelect: () => void;
}) {
  const tk = useTokens();
  return (
    <button
      type="button"
      data-background-row=""
      aria-pressed={selected}
      aria-expanded={open}
      onClick={onSelect}
      title="What the picture is under the layers: the shader, a colour, or a graph, an image or a video"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: touch ? 48 : 40, padding: '6px 12px', boxSizing: 'border-box',
        border: 0, borderRadius: radius.card, cursor: 'pointer', textAlign: 'left',
        background: selected ? alpha(tk.accent.base, 0.08) : tk.bg.panel,
        boxShadow: `inset 0 0 0 ${selected ? 1.5 : 1}px ${selected ? tk.accent.base : tk.border.default}`,
        color: tk.text.primary,
      }}
    >
      <Icon name="slides" size={15} style={{ color: selected ? tk.accent.base : tk.text.muted, flexShrink: 0 }} />
      <span style={{ font: `600 12.5px ${fontFamily.ui}`, flexShrink: 0 }}>Background</span>
      <span data-background-summary="" style={{ flex: 1, minWidth: 0, color: tk.text.muted, font: `11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{backgroundSummary(play)}</span>
      {open !== undefined && <Icon name={open ? 'chevD' : 'chevR'} size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />}
    </button>
  );
}
