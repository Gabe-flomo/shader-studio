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

function loadImage(file: File, maxSide: number, upscaleSvg: boolean, png: boolean, onDone: (src: string) => void): void {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // SVGs without a size report 0 (or 150): draw them at the target size.
    const w0 = img.naturalWidth || maxSide, h0 = img.naturalHeight || maxSide;
    const isSvg = file.type === 'image/svg+xml';
    const k = isSvg && upscaleSvg ? maxSide / Math.max(w0, h0) : Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    onDone(png || file.type === 'image/png' || file.type === 'image/webp' || isSvg ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9));
    URL.revokeObjectURL(url);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

export function ImagePicker({ src, onPick }: { src: string; onPick: (src: string) => void }) {
  const tk = useTokens();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*,.svg" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) loadImage(f, 1024, false, false, onPick); e.target.value = ''; }} />
      {src && <img src={src} alt="" style={{ width: 44, height: 26, objectFit: 'cover', borderRadius: 6, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}` }} />}
      <Button size="sm" icon="import" onClick={() => inputRef.current?.click()}>{src ? 'Replace' : 'Choose image'}</Button>
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
      {sprite && <Toggle checked={crop} onChange={onCrop} label="Square crop" />}
    </>
  );
}
