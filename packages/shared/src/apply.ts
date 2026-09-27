import { parseHexColor, type LiveSessionKind } from "./live.ts";
import type { RangeSpan } from "./range.ts";

export type AppliedRange = {
  label: string;
  start: number;
  stop: number;
};

export type ApplyStatus = "matched" | "mismatch" | "failed";

export type ApplyRow = {
  label: string;
  sent: RangeSpan;
  read: RangeSpan | null;
  matched: boolean;
};

export type ApplyResult = {
  status: ApplyStatus;
  matched: boolean;
  rows: ApplyRow[];
  sent: AppliedRange[];
  /** Known reread spans. `null` when segments were unknown — not an empty list. */
  read: RangeSpan[] | null;
  message: string;
  caption: string;
};

/** Fail-closed Apply copy when the reread did not report `state.seg`. */
export const APPLY_UNKNOWN_SEGMENTS_MESSAGE =
  "Wrote, but segments are unknown. Not treating as success.";

/** ApplyFailed adopt copy when `apply.read` is unknown (`null`). */
export const APPLY_ADOPT_UNKNOWN_REASON =
  "Controller ranges are unknown. Nothing to take.";

/** ApplyFailed adopt copy when the reread was a known empty list. */
export const APPLY_ADOPT_EMPTY_REASON =
  "The controller reported no ranges to take.";

export type ReaddressStep = {
  done: boolean;
  text: string;
};

export type ReaddressDecision =
  | { ok: true; sameMac: boolean }
  | { ok: false; error: "mac-mismatch" | "mac-unknown"; message: string };

/** Fail-closed Apply copy when the snapshot did not name a colour. */
export const APPLY_UNKNOWN_COLOUR_REASON =
  "Colour is unknown. Apply will not invent a look.";

/**
 * A colour Apply may write. Info-only / missing / non-hex is unknown —
 * never treat that as `#ffa000`.
 */
export function knownApplyColor(color: string | null | undefined): string | null {
  if (!color) return null;
  return parseHexColor(color);
}

export function applyRefuseReason(input: {
  reachable: boolean;
  issueMessage?: string | null;
  elementCount: number;
  busyKind?: LiveSessionKind | null;
  /** Live snapshot colour. Missing or non-hex refuses — never invent `#ffa000`. */
  segmentColor?: string | null;
}): string | null {
  if (!input.reachable) {
    return "This Light hasn’t answered. Refresh or re-address it first.";
  }
  if (input.busyKind === "preview") {
    return "End the Preview first. Preview is not Apply.";
  }
  if (input.busyKind === "blink") {
    return "Wait for Blink to finish.";
  }
  if (input.issueMessage) return input.issueMessage;
  if (input.elementCount < 1) return "Declare at least one Element first.";
  if (!knownApplyColor(input.segmentColor)) {
    return APPLY_UNKNOWN_COLOUR_REASON;
  }
  return null;
}

export function spansMatch(a: RangeSpan[], b: RangeSpan[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort(byStart);
  const right = [...b].sort(byStart);
  return left.every(
    (span, index) => span.start === right[index]?.start && span.stop === right[index]?.stop,
  );
}

export function applyRows(sent: AppliedRange[], read: RangeSpan[]): ApplyRow[] {
  const used = new Set<number>();
  const rows: ApplyRow[] = sent.map((item) => {
    const hit = read.findIndex(
      (span, index) =>
        !used.has(index) && span.start === item.start && span.stop === item.stop,
    );
    if (hit >= 0) {
      used.add(hit);
      return {
        label: item.label,
        sent: { start: item.start, stop: item.stop },
        read: read[hit]!,
        matched: true,
      };
    }
    const fallback = read.findIndex((_, index) => !used.has(index));
    if (fallback >= 0) {
      used.add(fallback);
      return {
        label: item.label,
        sent: { start: item.start, stop: item.stop },
        read: read[fallback]!,
        matched: false,
      };
    }
    return {
      label: item.label,
      sent: { start: item.start, stop: item.stop },
      read: null,
      matched: false,
    };
  });
  read.forEach((span, index) => {
    if (used.has(index)) return;
    rows.push({
      label: `Segment ${index + 1}`,
      sent: { start: 0, stop: 0 },
      read: span,
      matched: false,
    });
  });
  return rows;
}

/**
 * Honest Apply result when reread `segments` is unknown (`null`).
 * Does not call `applyOutcome` and does not invent a match against `[]`.
 */
export function applyUnknownSegments(
  sent: AppliedRange[],
  source: "fixture" | "controller",
): ApplyResult {
  return {
    status: "failed",
    matched: false,
    rows: [],
    sent,
    read: null,
    message: APPLY_UNKNOWN_SEGMENTS_MESSAGE,
    caption: applyCaption(source),
  };
}

/**
 * Compare a known reread. Pass `null` only when segments are unknown —
 * that refuses (does not treat unknown as empty). A known empty `[]`
 * still compares as empty.
 */
export function applyOutcome(
  sent: AppliedRange[],
  read: RangeSpan[] | null,
  source: "fixture" | "controller",
): ApplyResult {
  if (read === null) {
    return applyUnknownSegments(sent, source);
  }
  const matched = spansMatch(sent, read);
  return {
    status: matched ? "matched" : "mismatch",
    matched,
    rows: applyRows(sent, read),
    sent,
    read,
    message: matched
      ? "Controller reports the ranges we sent."
      : "Apply didn’t stick. Your draft is kept.",
    caption: applyCaption(source),
  };
}

/**
 * Ranges ApplyFailed may adopt. Unknown (`read: null`) and a known empty
 * list are none — never fall back to a last-known report.
 */
export function adoptableControllerRanges(apply: ApplyResult): RangeSpan[] {
  if (apply.read == null || apply.read.length === 0) return [];
  return apply.read;
}

/** Why **Use controller’s** is unavailable, or null when there are ranges to take. */
export function adoptControllerRangesReason(apply: ApplyResult): string | null {
  if (adoptableControllerRanges(apply).length > 0) return null;
  return apply.read === null ? APPLY_ADOPT_UNKNOWN_REASON : APPLY_ADOPT_EMPTY_REASON;
}

export function applyCaption(source: "fixture" | "controller"): string {
  if (source === "fixture") {
    return "Software-green from the fixture. Not Hardware Done.";
  }
  return "The controller reported these ranges. Not Hardware Done until you see them on the strip.";
}

export function normalizeMac(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = raw.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return hex.length === 12 ? hex : null;
}

export function macsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeMac(a);
  const right = normalizeMac(b);
  return Boolean(left && right && left === right);
}

export function shortMac(mac: string | null | undefined): string {
  const hex = normalizeMac(mac);
  if (!hex) return "unknown";
  const parts = hex.match(/.{2}/g) ?? [];
  return `${parts[0]}:${parts[1]}:…:${parts[4]}:${parts[5]}`;
}

/** Same-MAC continuity: never switch the stored host until the new address proves it. */
export function readdressContinuity(input: {
  enrolledMac: string | null;
  snapshotMac: string | null;
  sameHost: boolean;
}): ReaddressDecision {
  if (input.sameHost) return { ok: true, sameMac: true };
  const enrolled = normalizeMac(input.enrolledMac);
  const incoming = normalizeMac(input.snapshotMac);
  if (enrolled && incoming && enrolled === incoming) {
    return { ok: true, sameMac: true };
  }
  if (enrolled && incoming && enrolled !== incoming) {
    return {
      ok: false,
      error: "mac-mismatch",
      message:
        "Different controller at that address. Kept the current host until the same MAC answers.",
    };
  }
  if (enrolled && !incoming) {
    return {
      ok: false,
      error: "mac-unknown",
      message:
        "That address answered, but without a MAC we can match. Kept the current host.",
    };
  }
  return { ok: true, sameMac: false };
}

export function adoptReportedRanges<T extends AppliedRange & { id: string; lightId: string }>(
  draft: T[],
  reported: RangeSpan[],
): T[] {
  return reported.map((span, index) => {
    const keep = draft[index];
    return {
      ...(keep ?? {
        id: `adopted-${index}`,
        lightId: draft[0]?.lightId ?? "",
        label: `Element ${index + 1}`,
      }),
      start: span.start,
      stop: span.stop,
      label: keep?.label ?? `Element ${index + 1}`,
    } as T;
  });
}

function byStart(a: RangeSpan, b: RangeSpan): number {
  return a.start - b.start || a.stop - b.stop;
}
