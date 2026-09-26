/** Start is inclusive, stop is exclusive. Length is derived — never stored as a third number. */
export function elementLength(start: number, stop: number): number {
  return stop - start;
}

export function rangesOverlap(
  a: { start: number; stop: number },
  b: { start: number; stop: number },
): boolean {
  return a.start < b.stop && b.start < a.stop;
}
