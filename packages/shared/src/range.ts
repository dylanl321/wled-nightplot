/** Start is inclusive, stop is exclusive. Length is derived — never stored as a third number. */

export type RangeSpan = {
  start: number;
  stop: number;
};

export type DraftRange = RangeSpan & {
  id?: string;
  label: string;
  color?: { hex: string; white: number };
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

export type RangeLengthKind = "same" | "grow" | "shrink";

export type RangeLengthClip = {
  id?: string;
  label: string;
  start: number;
  previousStop: number;
  stop: number;
};

export type RangeLengthDrop = {
  id?: string;
  label: string;
  start: number;
  stop: number;
};

export type RangeLengthStory = {
  previousLedCount: number;
  nextLedCount: number;
  kind: RangeLengthKind;
  rewritten: boolean;
  clipped: RangeLengthClip[];
  dropped: RangeLengthDrop[];
  uncovered: RangeSpan[];
  notes: string[];
};

export type RangeLengthReconcile<T extends DraftRange = DraftRange> = RangeLengthStory & {
  elements: T[];
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
    const inverted = draft.start >= draft.stop;
    const pastStrip = rangeRunsPastStrip(draft, ledCount);
    if (inverted) {
      const invertCore = `${rangeLabel(draft)} is inverted: start ${draft.start} is not before stop ${draft.stop}`;
      issues.push({
        code: "invert",
        elementId: draft.id,
        start: draft.start,
        stop: draft.stop,
        message: pastStrip
          ? `${invertCore}, and ${draft.start}–${draft.stop} runs past the strip (${ledCount} LEDs).`
          : `${invertCore}.`,
      });
    }
    if (pastStrip) {
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

/**
 * After a length-changing Strip Apply: clip or drop ranges that run past the
 * new strip (honest rewrite + flag). Grow does not invent Elements — leftover
 * coverage is flagged. Same length is a no-op.
 */
export function reconcileDeclaredRangesForLedCount<T extends DraftRange>(
  drafts: T[],
  previousLedCount: number,
  nextLedCount: number,
): RangeLengthReconcile<T> {
  const kind: RangeLengthKind =
    nextLedCount === previousLedCount ? "same" : nextLedCount > previousLedCount ? "grow" : "shrink";

  if (kind === "same") {
    return {
      previousLedCount,
      nextLedCount,
      kind,
      rewritten: false,
      clipped: [],
      dropped: [],
      uncovered: uncoveredOnStrip(drafts, nextLedCount),
      notes: [],
      elements: drafts,
    };
  }

  if (kind === "grow") {
    const uncovered = uncoveredOnStrip(drafts, nextLedCount);
    return {
      previousLedCount,
      nextLedCount,
      kind,
      rewritten: false,
      clipped: [],
      dropped: [],
      uncovered,
      notes: growLengthNotes(drafts, previousLedCount, nextLedCount, uncovered),
      elements: drafts,
    };
  }

  const clipped: RangeLengthClip[] = [];
  const dropped: RangeLengthDrop[] = [];
  const elements: T[] = [];

  for (const draft of drafts) {
    if (!isWholeIndex(draft.start) || !isWholeIndex(draft.stop)) {
      elements.push(draft);
      continue;
    }
    if (draft.start >= nextLedCount) {
      dropped.push({
        id: draft.id,
        label: draft.label,
        start: draft.start,
        stop: draft.stop,
      });
      continue;
    }
    if (draft.stop > nextLedCount) {
      clipped.push({
        id: draft.id,
        label: draft.label,
        start: draft.start,
        previousStop: draft.stop,
        stop: nextLedCount,
      });
      elements.push({ ...draft, stop: nextLedCount });
      continue;
    }
    elements.push(draft);
  }

  const uncovered = uncoveredOnStrip(elements, nextLedCount);
  return {
    previousLedCount,
    nextLedCount,
    kind,
    rewritten: clipped.length > 0 || dropped.length > 0,
    clipped,
    dropped,
    uncovered,
    notes: shrinkLengthNotes({
      previousLedCount,
      nextLedCount,
      clipped,
      dropped,
      remaining: elements,
      uncovered,
    }),
    elements,
  };
}

export function rangeLengthStory<T extends DraftRange>(
  reconcile: RangeLengthReconcile<T>,
): RangeLengthStory {
  return {
    previousLedCount: reconcile.previousLedCount,
    nextLedCount: reconcile.nextLedCount,
    kind: reconcile.kind,
    rewritten: reconcile.rewritten,
    clipped: reconcile.clipped,
    dropped: reconcile.dropped,
    uncovered: reconcile.uncovered,
    notes: reconcile.notes,
  };
}

function uncoveredOnStrip(drafts: DraftRange[], ledCount: number): RangeSpan[] {
  if (!isWholeIndex(ledCount) || ledCount < 1) return [];
  const covering = drafts.filter(
    (draft) =>
      isOpenRange(draft) && draft.start >= 0 && draft.stop <= ledCount,
  );
  return intervalDifference([{ start: 0, stop: ledCount }], covering);
}

function growLengthNotes(
  drafts: DraftRange[],
  previousLedCount: number,
  nextLedCount: number,
  uncovered: RangeSpan[],
): string[] {
  if (drafts.length === 0) {
    return [
      `Strip grew from ${previousLedCount} to ${nextLedCount} LEDs. No Segments declared.`,
    ];
  }
  const notes = [
    `Strip grew from ${previousLedCount} to ${nextLedCount} LEDs. Declared Segments were not extended.`,
  ];
  for (const gap of uncovered) {
    notes.push(`LEDs ${gap.start}–${gap.stop} are not in a Segment.`);
  }
  return notes;
}

function shrinkLengthNotes(input: {
  previousLedCount: number;
  nextLedCount: number;
  clipped: RangeLengthClip[];
  dropped: RangeLengthDrop[];
  remaining: DraftRange[];
  uncovered: RangeSpan[];
}): string[] {
  if (
    input.clipped.length === 0 &&
    input.dropped.length === 0 &&
    input.remaining.length === 0
  ) {
    return [
      `Strip shrank from ${input.previousLedCount} to ${input.nextLedCount} LEDs. No Segments declared.`,
    ];
  }
  const notes: string[] = [];
  for (const row of input.clipped) {
    notes.push(
      `${rangeLabel(row)} ${row.start}–${row.previousStop} was clipped to ${row.start}–${row.stop}. It ran past the new strip (${input.nextLedCount} LEDs).`,
    );
  }
  for (const row of input.dropped) {
    notes.push(
      `${rangeLabel(row)} ${row.start}–${row.stop} was dropped. It started past the new strip (${input.nextLedCount} LEDs).`,
    );
  }
  if (input.clipped.length === 0 && input.dropped.length === 0) {
    notes.push(
      `Strip shrank from ${input.previousLedCount} to ${input.nextLedCount} LEDs.`,
    );
  }
  for (const gap of input.uncovered) {
    notes.push(`LEDs ${gap.start}–${gap.stop} are not in a Segment.`);
  }
  return notes;
}

function isOpenRange(span: RangeSpan): boolean {
  return isWholeIndex(span.start) && isWholeIndex(span.stop) && span.start < span.stop;
}

/** Inclusive start / exclusive stop — start at ledCount or stop below 0 is past the strip. */
function rangeRunsPastStrip(span: RangeSpan, ledCount: number): boolean {
  return span.start < 0 || span.start >= ledCount || span.stop < 0 || span.stop > ledCount;
}
