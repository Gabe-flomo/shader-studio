/** Move the item at `from` to index `to`, returning a new array. No-op (same array) if `to` is out of bounds or equal to `from`. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length || from === to) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
