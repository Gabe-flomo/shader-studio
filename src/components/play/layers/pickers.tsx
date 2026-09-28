/**
 * pickers.tsx — choosing an image for an image layer or a particle sprite.
 * Files become data URLs so they travel with the play file, downscaled so
 * files stay small: images to 1024 px, sprites (PNG, JPG or SVG) to 256 px.
 */
import { useRef } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily } from '../../../theme/tokens';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { loadImage } from './imageFiles';
import { LinkedPickButton } from '../../linked/LinkedPickButton';
import { linkedFile } from '../../linked/linkedSources';
import { toast } from '../../ui/toastStore';

/** A picture from a linked folder, read from disk and embedded like a picked file (docs/linked-folders.md). */
const fromLinked = (ref: string, side: number, sprite: boolean, onPick: (src: string) => void) => {
  linkedFile(ref).then(f => loadImage(f, side, sprite, sprite, onPick), e => toast.error('Couldn’t use that image', { message: e instanceof Error ? e.message : String(e) }));
};

export function ImagePicker({ src, onPick }: { src: string; onPick: (src: string) => void }) {
  const tk = useTokens();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*,.svg" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) loadImage(f, 1024, false, false, onPick); e.target.value = ''; }} />
      {src && <img src={src} alt="" style={{ width: 44, height: 26, objectFit: 'cover', borderRadius: 6, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}` }} />}
      <Button size="sm" icon="import" onClick={() => inputRef.current?.click()}>{src ? 'Replace' : 'Choose image'}</Button>
      <LinkedPickButton filter="image" label="Linked…" variant="ghost" onPick={ref => fromLinked(ref, 1024, false, onPick)} />
      {!src && <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>PNG with transparency works best for mattes</span>}
    </>
  );
}

export function SpritePicker({ sprite, crop, onPick, onCrop }: { sprite: string; crop: boolean; onPick: (src: string) => void; onCrop: (crop: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) loadImage(f, 256, true, true, onPick); e.target.value = ''; }} />
      {sprite && <img src={sprite} alt="" style={{ width: 26, height: 26, objectFit: crop ? 'cover' : 'contain', borderRadius: 6, background: 'repeating-conic-gradient(#8884 0 25%, transparent 0 50%) 0 0 / 8px 8px' }} />}
      <Button size="sm" icon="import" onClick={() => inputRef.current?.click()}>{sprite ? 'Replace' : 'Upload PNG / SVG'}</Button>
      <LinkedPickButton filter="image" label="Linked…" variant="ghost" onPick={ref => fromLinked(ref, 256, true, onPick)} />
      {sprite && <Toggle checked={crop} onChange={onCrop} label="Square crop" />}
    </>
  );
}
