import type { Tokens } from '../../theme/tokens';
import { alpha, fontFamily, radius } from '../../theme/tokens';

/** The Present page's stylesheet: text, maths, chips, code. Built from the theme tokens. */
export function presentCss(tk: Tokens): string {
  return `
.pp-md{color:${tk.text.secondary};font:15px/1.62 ${fontFamily.ui};overflow-wrap:break-word;min-width:0}
.pp-md.pp-lg{font-size:17px}
.pp-md>:first-child{margin-top:0}.pp-md>:last-child{margin-bottom:0}
.pp-md p,.pp-md ul,.pp-md ol,.pp-md blockquote,.pp-md table,.pp-md pre{margin:0 0 .8em}
.pp-md h1,.pp-md h2,.pp-md h3,.pp-md h4{color:${tk.text.primary};line-height:1.25;margin:1.1em 0 .45em;letter-spacing:-0.01em}
.pp-md h1{font-size:1.75em;font-weight:720}.pp-md h2{font-size:1.35em;font-weight:680}.pp-md h3{font-size:1.12em;font-weight:650}
.pp-md strong{color:${tk.text.primary};font-weight:650}
.pp-md a{color:${tk.accent.text};text-decoration:underline;text-underline-offset:2px}
.pp-md ul,.pp-md ol{padding-left:1.3em}.pp-md li{margin:.2em 0}
.pp-md blockquote{border-left:3px solid ${tk.border.strong};padding:.1em 0 .1em .9em;color:${tk.text.muted}}
.pp-md code{font:0.88em ${fontFamily.mono};background:${tk.bg.field};padding:.1em .35em;border-radius:5px;color:${tk.text.primary}}
.pp-md pre{background:${tk.bg.field};padding:10px 12px;border-radius:${radius.md}px;overflow:auto}
.pp-md pre code{background:none;padding:0;font-size:12.5px;line-height:1.55}
.pp-md table{border-collapse:collapse}.pp-md th,.pp-md td{border:1px solid ${tk.border.default};padding:4px 9px}
.pp-md img{max-width:100%;border-radius:${radius.md}px}
.pp-md hr{border:0;border-top:1px solid ${tk.border.default};margin:1.4em 0}
.pp-md .katex{font-size:1.08em;color:${tk.text.primary}}
.pp-md .pp-math-display{display:block;margin:.9em 0;overflow-x:auto;overflow-y:hidden;padding:2px 0}
.pp-md .pp-math-display .katex-display{margin:0}
.pp-md .pp-math-error{color:${tk.status.danger}}
.pp-md .pp-chip{display:inline-flex;align-items:center;gap:4px;vertical-align:baseline;margin:0 1px;padding:1px 8px;border-radius:10px;border:0;
  font:600 0.84em ${fontFamily.ui};line-height:1.5;background:${alpha(tk.accent.base, 0.14)};color:${tk.accent.text};cursor:pointer;transition:background .15s,box-shadow .15s}
.pp-md .pp-chip::before{content:'';width:10px;height:3px;border-radius:2px;background:currentColor;opacity:.75}
.pp-md .pp-chip:hover,.pp-md .pp-chip.pp-on{background:${alpha(tk.accent.base, 0.26)};box-shadow:0 0 0 2px ${alpha(tk.accent.base, 0.25)}}
.pp-md .pp-chip-gone{background:${tk.bg.field};color:${tk.text.faint};cursor:default;text-decoration:line-through}
.pp-md .pp-chip-gone::before{display:none}
.pp-md .pp-ref{font-weight:600;color:${tk.text.primary}}
.pp-md.pp-placeholder{color:${tk.text.faint};font-style:italic}
.pp-md.pp-loading{white-space:pre-wrap;color:${tk.text.faint}}
.pp-step-grid{display:grid;gap:28px 32px;align-items:start}
.pp-block{position:relative;min-width:0}
@keyframes pp-in{from{transform:translateY(10px)}to{transform:none}}
@media (prefers-reduced-motion:reduce){@keyframes pp-in{from{transform:none}to{transform:none}}}
`;
}
