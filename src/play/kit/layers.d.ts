/** The parts of layers.js the app reads directly (the rest is used by kit.js). */
export function klParseFontUrl(input: string): { family: string; css?: string; file?: string } | null;
export function klGlyphList(chars: string): string[];
export function klFontFor(l: { font?: string; fontUrl?: string; weight?: number }): string;
