/** An Expression Block's lines with line `i` switched on or off (an off line is kept, compiled as a comment). */
export function toggleLineOff<L extends { off?: boolean }>(lines: readonly L[], i: number): L[] {
  return lines.map((l, j) => {
    if (j !== i) return l;
    if (!l.off) return { ...l, off: true };
    const { off: _o, ...rest } = l;
    void _o;
    return rest as L;
  });
}
