import type { RangeDisplay, RangeSpan } from "@nightplot/shared";

/** One line per real difference. Repeated controller segments are listed once. */
export function explainDrift(display: RangeDisplay): string[] {
  const declared = display.declared.filter((rail) => rail.stop > rail.start);
  if (declared.length === 0) return [];
  const lines: string[] = [];
  const seenElements = new Set<string>();
  for (const rail of declared) {
    if (!rail.differs) continue;
    const there = bestOverlap(rail, display.reported);
    const key = `${rail.label}:${rail.start}:${rail.stop}:${there?.start ?? ""}:${there?.stop ?? ""}`;
    if (seenElements.has(key)) continue;
    seenElements.add(key);
    if (!there) {
      lines.push(`${rail.label} is ${rail.start}–${rail.stop} here. The controller has nothing there.`);
      continue;
    }
    if (there.start === rail.start && there.stop === rail.stop) continue;
    lines.push(
      `${rail.label} is ${rail.start}–${rail.stop} here. The controller has ${there.start}–${there.stop}.`,
    );
  }

  const uncovered: RangeSpan[] = [];
  const seenSpans = new Set<string>();
  for (const span of display.reported) {
    if (!span.differs) continue;
    const key = `${span.start}:${span.stop}`;
    if (seenSpans.has(key)) continue;
    seenSpans.add(key);
    const covered = declared.some((rail) => rail.start < span.stop && rail.stop > span.start);
    if (covered) continue;
    uncovered.push(span);
  }
  uncovered.sort((a, b) => a.start - b.start || a.stop - b.stop);
  if (uncovered.length === 1) {
    const span = uncovered[0]!;
    lines.push(
      `The controller still has ${span.start}–${span.stop}. No Segment on this page covers it.`,
    );
  } else if (uncovered.length > 1) {
    lines.push(
      `The controller still has ${joinRanges(uncovered)}. No Segment on this page covers them.`,
    );
  }
  return lines;
}

function joinRanges(spans: RangeSpan[]): string {
  const labels = spans.map((span) => `${span.start}–${span.stop}`);
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function bestOverlap(rail: RangeSpan, reported: RangeSpan[]): RangeSpan | null {
  let best: RangeSpan | null = null;
  let bestOverlap = 0;
  for (const span of reported) {
    const overlap = Math.min(rail.stop, span.stop) - Math.max(rail.start, span.start);
    if (overlap > bestOverlap) {
      best = span;
      bestOverlap = overlap;
    }
  }
  return best;
}
