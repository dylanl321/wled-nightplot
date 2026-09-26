/** Start is inclusive, stop is exclusive. Length is derived — never stored as a third number. */

export type RangeSpan = {
  start: number;
  stop: number;
};

export type DraftRange = RangeSpan & {
  id?: string;
  label: string;
};

export type RangeErrorCode = "invert" | "overlap" | "over-ledCount";

export type RangeIssue = {
  code: RangeErrorCode;
  message: string;
  elementId?: string;
  otherId?: string;
  start: number;
  stop: number;
};

export function elementLength(start: number, stop: number): number {
  return stop - start;
}

export function rangesOverlap(a: RangeSpan, b: RangeSpan): boolean {
  return a.start < b.stop && b.start < a.stop;
}

export function isWholeIndex(n: number): boolean {
  return Number.isInteger(n) && Number.isFinite(n);
}

export function rangeLabel(draft: { label: string }): string {
  const trimmed = draft.label.trim();
  return trimmed || "Untitled";
}

export function validateDeclaredRanges(
  drafts: DraftRange[],
  ledCount: number,
): RangeIssue[] {
  const issues: RangeIssue[] = [];

  for (const draft of drafts) {
    if (!isWholeIndex(draft.start) || !isWholeIndex(draft.stop)) {
      issues.push({
        code: "invert",
        elementId: draft.id,
        start: draft.start,
        stop: draft.stop,
        message: `${rangeLabel(draft)} needs whole LED indexes for start and stop.`,
      });
      continue;
    }
    if (draft.start >= draft.stop) {
      issues.push({
        code: "invert",
        elementId: draft.id,
        start: draft.start,
        stop: draft.stop,
        message: `${rangeLabel(draft)} is inverted: start ${draft.start} is not before stop ${draft.stop}.`,
      });
    }
    if (draft.start < 0 || draft.stop > ledCount) {
      issues.push({
        code: "over-ledCount",
        elementId: draft.id,
        start: draft.start,
        stop: draft.stop,
        message: `${rangeLabel(draft)} ${draft.start}–${draft.stop} runs past the strip (${ledCount} LEDs).`,
      });
    }
  }

  for (let i = 0; i < drafts.length; i += 1) {
    const a = drafts[i];
    if (!a || !isOpenRange(a)) continue;
    for (let j = i + 1; j < drafts.length; j += 1) {
      const b = drafts[j];
      if (!b || !isOpenRange(b) || !rangesOverlap(a, b)) continue;
      const start = Math.max(a.start, b.start);
      const stop = Math.min(a.stop, b.stop);
      const lastLed = stop - 1;
      issues.push({
        code: "overlap",
        elementId: a.id,
        otherId: b.id,
        start,
        stop,
        message: `${rangeLabel(a)} overlaps ${rangeLabel(b)} on LEDs ${start}–${lastLed}.`,
      });
    }
  }

  return issues;
}

export function firstFreeRange(
  declared: RangeSpan[],
  ledCount: number,
): RangeSpan | null {
  const sorted = declared.filter(isOpenRange).sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const span of sorted) {
    if (span.start > cursor) return { start: cursor, stop: Math.min(span.start, ledCount) };
    cursor = Math.max(cursor, span.stop);
  }
  if (cursor < ledCount) return { start: cursor, stop: ledCount };
  return null;
}

export function unionIntervals(spans: RangeSpan[]): RangeSpan[] {
  const sorted = spans.filter(isOpenRange).sort((a, b) => a.start - b.start);
  const out: RangeSpan[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (!last || span.start > last.stop) {
      out.push({ start: span.start, stop: span.stop });
    } else {
      last.stop = Math.max(last.stop, span.stop);
    }
  }
  return out;
}

export function intervalDifference(left: RangeSpan[], right: RangeSpan[]): RangeSpan[] {
  const cutters = unionIntervals(right);
  const out: RangeSpan[] = [];
  for (const span of unionIntervals(left)) {
    let cursor = span.start;
    for (const cut of cutters) {
      if (cut.stop <= cursor || cut.start >= span.stop) continue;
      if (cut.start > cursor) out.push({ start: cursor, stop: Math.min(cut.start, span.stop) });
      cursor = Math.max(cursor, cut.stop);
    }
    if (cursor < span.stop) out.push({ start: cursor, stop: span.stop });
  }
  return out;
}

export function symmetricDifference(a: RangeSpan[], b: RangeSpan[]): RangeSpan[] {
  return [...intervalDifference(a, b), ...intervalDifference(b, a)];
}

export function overlapOf(a: RangeSpan, b: RangeSpan): number {
  return Math.max(0, Math.min(a.stop, b.stop) - Math.max(a.start, b.start));
}

function isOpenRange(span: RangeSpan): boolean {
  return isWholeIndex(span.start) && isWholeIndex(span.stop) && span.start < span.stop;
}
