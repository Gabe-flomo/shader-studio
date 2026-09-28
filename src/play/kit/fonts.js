/**
 * fonts.js — reading a pasted font source (part of the layer kit, see kit.js;
 * inlined into exported pages with the other kit files, so top-level names
 * start with `kl`). The Text layer's Web font row and the Present page's font
 * picker both read links with it.
 *
 * Accepted: a Google Fonts css2 link (or the <link> tag / @import holding
 * one), a Google Fonts specimen page, a bare family name, or an https
 * .woff2 / .woff / .ttf / .otf file. Anything else is null.
 *
 * In the app, also a font file in a linked folder (`linked:<folder>/<path>.ttf`,
 * docs/linked-folders.md): read from disk through the app's resolver (layers.js
 * klSetLinkedFontReader). An exported page has no linked folders: the preset shows.
 */

const klDecode = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };

/** { family, css } for a Google Fonts source, { family, file } for a font file, or null. */
export function klParseFontUrl(input) {
  let u = String(input || '').trim();
  if (!u) return null;
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(u) || /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(u);
  if (href) u = href[1];
  u = u.replace(/&amp;/g, '&');
  if (/^linked:[A-Za-z0-9_-]+\/[^\n]+\.(woff2?|ttf|otf)$/i.test(u)) {
    const name = u.split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[^\w -]/g, '');
    return { family: 'SS ' + (name || 'Font'), file: u };
  }
  if (/^https:\/\/[^\s]+\.(woff2?|ttf|otf)(\?[^\s]*)?$/i.test(u)) {
    const name = klDecode(u.split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '')).replace(/[^\w -]/g, '');
    return { family: 'SS ' + (name || 'Font'), file: u };
  }
  const spec = /^https:\/\/fonts\.google\.com\/specimen\/([^/?#]+)/i.exec(u);
  if (spec) u = klDecode(spec[1].replace(/\+/g, ' '));
  if (/^https:\/\/fonts\.googleapis\.com\/css2?\?/i.test(u)) {
    const fam = /[?&]family=([^&:]+)/.exec(u);
    return fam ? { family: klDecode(fam[1].replace(/\+/g, ' ')).replace(/["\\]/g, ''), css: u } : null;
  }
  if (/^[A-Za-z0-9][A-Za-z0-9 ]{0,60}$/.test(u)) {
    return { family: u.replace(/\s+/g, ' '), css: 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(u.replace(/\s+/g, ' ')).replace(/%20/g, '+') + '&display=swap' };
  }
  return null;
}

