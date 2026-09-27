/**
 * paper.ts — a faint paper grain behind the Present page's reading areas
 * (the step being edited, Slides and Scroll), never behind panels or blocks.
 *
 * The grain is an SVG: fine fibres (high-frequency fractal noise, stretched a
 * little across so it reads as laid paper) over soft mottling (low-frequency
 * noise). It tiles, weighs a couple of KB, stays sharp at any size and needs
 * no image file. Its faintness is baked in: the grey stays in a narrow band
 * and the layer is partly transparent, so blending it onto the page colour
 * only nudges it. PAPER_IMAGE can point at a photographed texture instead.
 */
import type { CSSProperties } from 'react';

/** A photographed paper texture (a URL under public/), or null for the generated grain. */
export const PAPER_IMAGE: string | null = null;

function grain(lo: number, hi: number, alpha: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'>
<filter id='f' x='0' y='0'>
<feTurbulence type='fractalNoise' baseFrequency='0.9 0.55' numOctaves='3' seed='7' stitchTiles='stitch' result='fibre'/>
<feTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='2' seed='3' stitchTiles='stitch' result='mottle'/>
<feBlend in='fibre' in2='mottle' mode='multiply'/>
<feColorMatrix type='saturate' values='0'/>
<feComponentTransfer>
<feFuncR type='table' tableValues='${lo} ${hi}'/><feFuncG type='table' tableValues='${lo} ${hi}'/><feFuncB type='table' tableValues='${lo} ${hi}'/>
<feFuncA type='linear' slope='0' intercept='${alpha}'/>
</feComponentTransfer>
</filter>
<rect width='100%' height='100%' filter='url(#f)'/>
</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Light pages: multiply by near-white grain (a whisper darker in the fibres).
const LIGHT = grain(0.8, 1, 0.9);
// Dark pages: soft light with grain around mid grey (fibres a whisper lighter or darker).
const DARK = grain(0.38, 0.62, 0.7);

/** The style for a reading area: its own background colour with the grain blended in. */
export function paperStyle(bg: string, dark: boolean): CSSProperties {
  if (PAPER_IMAGE) {
    return { backgroundColor: bg, backgroundImage: `url("${PAPER_IMAGE}")`, backgroundSize: '1200px auto', backgroundBlendMode: dark ? 'soft-light' : 'multiply' };
  }
  return { backgroundColor: bg, backgroundImage: dark ? DARK : LIGHT, backgroundSize: '320px 320px', backgroundBlendMode: dark ? 'soft-light' : 'multiply' };
}
