// Strip GLSL comments in one left-to-right pass, the way the compiler reads
// them: a line comment that happens to end in star-slash is still a line
// comment (its two slashes come first), and slash-star-slash closes a block.
// Newlines are kept, so line numbers still map to the source.
export function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}
