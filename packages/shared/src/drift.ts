import {
  elementLength,
  intervalDifference,
  overlapOf,
  rangeLabel,
  rangesOverlap,
  symmetricDifference,
  type DraftRange,
  type RangeIssue,
  type RangeSpan,
} from "./range.ts";

export type DeclaredRail = {
  id?: string;
  label: string;
  start: number;
  stop: number;
  length: number;
  differs: boolean;
  error: boolean;
};

export type ReportedRail = {
  start: number;
  stop: number;
  differs: boolean;
};

export type DisplayRegion = {
  kind: "drift" | "error";
  start: number;
  stop: number;
};

export type DriftNote = {
  text: string;
  start?: number;
  stop?: number;
  elementId?: string;
};

export type RangeDisplay = {
  declared: DeclaredRail[];
  reported: ReportedRail[];
  regions: DisplayRegion[];
  notes: DriftNote[];
};

/**
 * Inspect `reported` is range rails. A Preview match-count object is not.
 * Non-arrays (and rows without start/stop) yield no rails — never `.map` a count.
 */
export function reportedRangeRails(reported: unknown): RangeSpan[] {
  if (!Array.isArray(reported)) return [];
  const rails: RangeSpan[] = [];
  for (const row of reported) {
    if (!row || typeof row !== "object") continue;
    const start = (row as { start?: unknown }).start;
    const stop = (row as { stop?: unknown }).stop;
    if (typeof start === "number" && typeof stop === "number") {
      rails.push({ start, stop });
    }
  }
  return rails;
}

/**
 * Dual-rail display data: declared above, reported below.
 * Drift is the coverage gap. Overlap paints red. Unreachable (no reported)
 * does not invent a last report.
 */
export function buildRangeDisplay(
  declared: DraftRange[],
  reported: RangeSpan[],
  issues: RangeIssue[] = [],
  options: { reachable?: boolean } = {},
): RangeDisplay {
  const reachable = options.reachable ?? true;
  const liveReported = reachable ? reported.filter((span) => span.start < span.stop) : [];
  const overlapIssues = issues.filter((issue) => issue.code === "overlap");
  const validityIssues = issues.filter(
    (issue) => issue.code === "over-ledCount" || issue.code === "invert",
  );
  const erroredIds = new Set(
    issues
      .filter(
        (issue) =>
          issue.code === "overlap" || issue.code === "over-ledCount" || issue.code === "invert",
      )
      .flatMap((issue) => [issue.elementId, issue.otherId].filter(Boolean)),
  );

  const declaredRails: DeclaredRail[] = declared.map((draft) => ({
    id: draft.id,
    label: draft.label,
    start: draft.start,
    stop: draft.stop,
    length: elementLength(draft.start, draft.stop),
    differs:
      reachable &&
      !liveReported.some((span) => span.start === draft.start && span.stop === draft.stop),
    error: Boolean(draft.id && erroredIds.has(draft.id)) || overlapIssues.some((issue) =>
      issue.elementId === draft.id || issue.otherId === draft.id,
    ),
  }));

  const reportedRails: ReportedRail[] = liveReported.map((span) => ({
    start: span.start,
    stop: span.stop,
    differs: !declared.some((draft) => draft.start === span.start && draft.stop === span.stop),
  }));

  const regions: DisplayRegion[] = [];
  for (const issue of overlapIssues) {
    if (issue.stop > issue.start) {
      regions.push({ kind: "error", start: issue.start, stop: issue.stop });
    }
  }

  const notes: DriftNote[] = [];
  pushValidityNotes(notes, validityIssues);

  if (!reachable) {
    notes.push({ text: "No current report to compare." });
    return { declared: declaredRails, reported: [], regions, notes };
  }

  const validDeclared = declared.filter((draft) => draft.start < draft.stop);
  for (const gap of symmetricDifference(validDeclared, liveReported)) {
    regions.push({ kind: "drift", start: gap.start, stop: gap.stop });
  }

  if (validDeclared.length === 0 && liveReported.length > 0) {
    notes.push({
      text:
        liveReported.length === 1
          ? "Controller reports 1 range. Nothing declared yet."
          : `Controller reports ${liveReported.length} ranges. Nothing declared yet.`,
    });
    return { declared: declaredRails, reported: reportedRails, regions, notes };
  }

  const pairs = pairByOverlap(validDeclared, liveReported);
  const pairedDeclared = new Set(pairs.map((pair) => pair.declared));
  const pairedReported = new Set(pairs.map((pair) => pair.reported));

  for (const pair of pairs) {
    if (pair.declared.start === pair.reported.start && pair.declared.stop === pair.reported.stop) {
      continue;
    }
    const declaredLen = elementLength(pair.declared.start, pair.declared.stop);
    const reportedLen = elementLength(pair.reported.start, pair.reported.stop);
    if (declaredLen !== reportedLen) {
      const delta = Math.abs(reportedLen - declaredLen);
      notes.push({
        text: `${rangeLabel(pair.declared)} reports ${delta} ${
          reportedLen < declaredLen ? "fewer" : "more"
        } LED${delta === 1 ? "" : "s"} than declared`,
        start: pair.reported.start,
        stop: pair.reported.stop,
        elementId: pair.declared.id,
      });
    } else {
      notes.push({
        text: `${rangeLabel(pair.declared)} reports ${pair.reported.start}–${pair.reported.stop}`,
        start: pair.reported.start,
        stop: pair.reported.stop,
        elementId: pair.declared.id,
      });
    }
  }

  for (const draft of validDeclared) {
    if (pairedDeclared.has(draft)) continue;
    notes.push({
      text: `${rangeLabel(draft)} is not on the controller`,
      start: draft.start,
      stop: draft.stop,
      elementId: draft.id,
    });
  }

  for (const span of liveReported) {
    if (pairedReported.has(span)) continue;
    notes.push({
      text: `Controller reports extra ${span.start}–${span.stop}`,
      start: span.start,
      stop: span.stop,
    });
  }

  if (notes.length === 0 && intervalDifference(validDeclared, liveReported).length === 0) {
    const split =
      validDeclared.length !== liveReported.length &&
      validDeclared.length > 0 &&
      liveReported.length > 0;
    if (split) {
      notes.push({
        text: `Controller reports ${liveReported.length} range${
          liveReported.length === 1 ? "" : "s"
        } · Nightplot has ${validDeclared.length} Elements`,
      });
    }
  }

  return { declared: declaredRails, reported: reportedRails, regions, notes };
}

function pairByOverlap<A extends RangeSpan, B extends RangeSpan>(
  declared: A[],
  reported: B[],
): { declared: A; reported: B }[] {
  const used = new Set<number>();
  const pairs: { declared: A; reported: B }[] = [];
  const order = declared
    .map((_, index) => index)
    .sort((i, j) => declared[i]!.start - declared[j]!.start);

  for (const index of order) {
    const draft = declared[index]!;
    let best = -1;
    let bestLen = 0;
    for (let j = 0; j < reported.length; j += 1) {
      if (used.has(j)) continue;
      const span = reported[j]!;
      if (!rangesOverlap(draft, span)) continue;
      const len = overlapOf(draft, span);
      if (len > bestLen) {
        bestLen = len;
        best = j;
      }
    }
    if (best >= 0) {
      used.add(best);
      pairs.push({ declared: draft, reported: reported[best]! });
    }
  }
  return pairs;
}

function pushValidityNotes(notes: DriftNote[], issues: RangeIssue[]): void {
  for (const issue of issues) {
    notes.push({
      text: issue.message,
      start: issue.start,
      stop: issue.stop,
      elementId: issue.elementId,
    });
  }
}
