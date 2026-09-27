import type { Tokens } from '../../theme/tokens';
import { alpha, fontFamily, radius } from '../../theme/tokens';

/**
 * The Present page's stylesheet: text, maths, chips, code. Built from the app's
 * tokens; a presentation theme (types/presentTheme.ts) sets the --pp-*
 * variables on the page, and the tokens are only the fallbacks (Classic).
 */
export function presentCss(tk: Tokens): string {
  return `
.pp-md{color:var(--pp-body,${tk.text.secondary});font:calc(15px * var(--pp-scale,1))/var(--pp-lh,1.62) var(--pp-font-body,${fontFamily.ui});text-shadow:var(--pp-shadow,none);overflow-wrap:break-word;min-width:0}
.pp-md.pp-lg{font-size:calc(17px * var(--pp-scale,1))}
.pp-md>:first-child{margin-top:0}.pp-md>:last-child{margin-bottom:0}
.pp-md p,.pp-md ul,.pp-md ol,.pp-md blockquote,.pp-md table,.pp-md pre{margin:0 0 .8em}
.pp-md h1,.pp-md h2,.pp-md h3,.pp-md h4{color:var(--pp-heading,${tk.text.primary});font-family:var(--pp-font-heading,inherit);line-height:1.25;margin:1.1em 0 .45em;letter-spacing:var(--pp-track,-0.01em)}
.pp-md h1{font-size:1.75em;font-weight:var(--pp-hw,720)}.pp-md h2{font-size:1.35em;font-weight:var(--pp-hw,680)}.pp-md h3{font-size:1.12em;font-weight:var(--pp-hw,650)}
.pp-md strong{color:var(--pp-heading,${tk.text.primary});font-weight:650}
.pp-md a{color:var(--pp-link,var(--pp-accent,${tk.accent.text}));text-decoration:underline;text-underline-offset:2px}
.pp-md ul,.pp-md ol{padding-left:1.3em}.pp-md li{margin:.2em 0}
.pp-md blockquote{border-left:3px solid var(--pp-rule,${tk.border.strong});padding:.1em 0 .1em .9em;color:var(--pp-muted,${tk.text.muted})}
.pp-md code{font:0.88em var(--pp-font-code,${fontFamily.mono});background:var(--pp-wash,${tk.bg.field});padding:.1em .35em;border-radius:5px;color:var(--pp-heading,${tk.text.primary});text-shadow:none}
.pp-md pre{background:var(--pp-code-bg,var(--pp-wash,${tk.bg.field}));padding:10px 12px;border-radius:calc(var(--pp-radius,${radius.lg}px) * .66);overflow:auto}
.pp-md pre code{background:none;padding:0;font-size:12.5px;line-height:1.55}
.pp-md table{border-collapse:collapse}.pp-md th,.pp-md td{border:1px solid var(--pp-rule,${tk.border.default});padding:4px 9px}
.pp-md img{max-width:100%;border-radius:calc(var(--pp-radius,${radius.lg}px) * .66)}
.pp-md hr{border:0;border-top:1px solid var(--pp-rule,${tk.border.default});margin:1.4em 0}
.pp-md .katex{font-size:1.08em;color:var(--pp-heading,${tk.text.primary})}
.pp-md .pp-math-display{display:block;margin:.9em 0;overflow-x:auto;overflow-y:hidden;padding:2px 0}
.pp-md .pp-math-display .katex-display{margin:0}
.pp-md .pp-math-error{color:${tk.status.danger}}
.pp-md .pp-chip{text-shadow:none;display:inline-flex;align-items:center;gap:4px;vertical-align:baseline;margin:0 1px;padding:1px 8px;border-radius:10px;border:0;
  font:600 0.84em ${fontFamily.ui};line-height:1.5;background:${alpha(tk.accent.base, 0.16)};color:var(--pp-accent,${tk.accent.text});cursor:pointer;transition:background .15s,box-shadow .15s}
.pp-md .pp-chip::before{content:'';width:10px;height:3px;border-radius:2px;background:currentColor;opacity:.75}
.pp-md .pp-chip:hover,.pp-md .pp-chip.pp-on{background:${alpha(tk.accent.base, 0.26)};box-shadow:0 0 0 2px ${alpha(tk.accent.base, 0.25)}}
.pp-md .pp-chip-gone{background:${tk.bg.field};color:${tk.text.faint};cursor:default;text-decoration:line-through}
.pp-md .pp-chip-gone::before{display:none}
.pp-md .pp-ref{font-weight:600;color:var(--pp-heading,${tk.text.primary})}
.pp-md.pp-placeholder{color:var(--pp-muted,${tk.text.faint});font-style:italic}
.pp-md.pp-loading{white-space:pre-wrap;color:${tk.text.faint}}
.pp-title{color:var(--pp-heading,${tk.text.primary});font-family:var(--pp-font-heading,${fontFamily.ui});font-weight:var(--pp-hw,700);text-shadow:var(--pp-shadow,none);letter-spacing:var(--pp-track,-0.015em);line-height:1.2}
.pp-title::placeholder{color:var(--pp-muted,${tk.text.faint});opacity:.7}
.pp-step-grid{display:grid;gap:calc(28px * var(--pp-space,1)) calc(32px * var(--pp-space,1));align-items:start}
.pp-head{display:flex;align-items:baseline;gap:12px}
.pp-num{flex-shrink:0;color:var(--pp-accent,${tk.accent.text});font:700 12px ${fontFamily.ui};letter-spacing:.06em;text-shadow:var(--pp-shadow,none)}
.pp-num i{font-style:normal;color:var(--pp-muted,${tk.text.faint});font-weight:500}
[data-pp-num] .pp-head{flex-direction:column;align-items:flex-start;gap:calc(14px * var(--pp-space,1))}
[data-pp-num] .pp-head>input{align-self:stretch}
[data-pp-num=pill] .pp-num{padding:5px 11px;border-radius:999px;background:var(--pp-wash,${tk.bg.field});color:var(--pp-heading,${tk.text.primary});font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;text-shadow:none}
[data-pp-num=pill] .pp-num i{color:var(--pp-muted,${tk.text.muted})}
[data-pp-num=meta] .pp-num{color:var(--pp-muted,${tk.text.muted});font:500 13px var(--pp-font-body,${fontFamily.ui});letter-spacing:0}
[data-pp-num=meta] .pp-num i{color:inherit}
[data-pp-tiles] .pp-render{padding:14px 14px 12px;border-radius:calc(var(--pp-radius,${radius.lg}px) + 4px);background:var(--pp-surface,${tk.bg.panel})}
.pp-block{position:relative;min-width:0}
@keyframes pp-in{from{transform:translateY(10px)}to{transform:none}}
@keyframes pp-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){@keyframes pp-in{from{transform:none}to{transform:none}}@keyframes pp-fade{from{opacity:1}to{opacity:1}}}
`;
}
