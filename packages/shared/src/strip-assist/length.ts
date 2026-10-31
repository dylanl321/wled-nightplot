import {
  PROVISION_LENGTH_MAX,
  PROVISION_LENGTH_MIN,
  type ProvisionLedType,
  type WledStripProvisionOutputDraft,
} from "../provision.ts";

/** Yard-scale search ceilings. 2048 is the provision max. */
export const FIND_LENGTH_CEILINGS = [150, 300, 600, 1000, 2000, PROVISION_LENGTH_MAX] as const;
export const FIND_LENGTH_NUDGES = [1, 10, 50] as const;

/** Canvas S3: isolate a 1,000-LED run in this many yes/no answers, then confirm. */
export const FIND_LENGTH_ANSWERS_FOR_1K = 12;

export const FIND_LENGTH_DIM = "#2c4e49";
export const FIND_LENGTH_END = "#fff4dc";
export const FIND_LENGTH_OFF = "#000000";

export type FindLengthPhase = "pick-ceiling" | "search";

export type FindLengthState = {
  outputIndex: number;
  outputStart: number;
  originalLength: number;
  ledType: ProvisionLedType;
  gpio: number;
  ceiling: number;
  /** Exclusive: physical length is greater than `low`. */
  low: number;
  /** Inclusive: physical length is at most `high`. */
  high: number;
  candidate: number;
  answers: number;
  expanded: boolean;
  phase: FindLengthPhase;
};

export type FindLengthSpan = {
  start: number;
  stop: number;
  color: string;
};

export function startFindLength(input: {
  outputIndex: number;
  outputStart: number;
  currentLength: number;
  ledType: ProvisionLedType;
  gpio: number;
}): FindLengthState {
  const current = clampLength(input.currentLength);
  return {
    outputIndex: input.outputIndex,
    outputStart: Math.max(0, input.outputStart),
    originalLength: current,
    ledType: input.ledType,
    gpio: input.gpio,
    ceiling: current,
    low: 0,
    high: current,
    candidate: current,
    answers: 0,
    expanded: false,
    phase: "pick-ceiling",
  };
}

export function findLengthCeilingChoices(current: number): number[] {
  const length = clampLength(current);
  const choices = new Set<number>([length]);
  for (const ceiling of FIND_LENGTH_CEILINGS) {
    if (ceiling > length) choices.add(ceiling);
  }
  return [...choices].sort((a, b) => a - b);
}

export function findLengthExpandChoices(ceiling: number): number[] {
  return FIND_LENGTH_CEILINGS.filter((entry) => entry > ceiling);
}

export function needsCeilingWrite(originalLength: number, ceiling: number): boolean {
  return clampLength(ceiling) !== clampLength(originalLength);
}

export function beginSearch(state: FindLengthState, ceiling: number): FindLengthState {
  const next = clampLength(ceiling);
  return {
    ...state,
    ceiling: next,
    low: 0,
    high: next,
    candidate: next,
    answers: 0,
    expanded: next !== state.originalLength,
    phase: "search",
  };
}

/**
 * Yes: the physical end is lit, so length ≤ candidate.
 * No: the physical end is still dark, so length > candidate.
 */
export function answerLitToEnd(state: FindLengthState, litToEnd: boolean): FindLengthState {
  if (state.phase !== "search") return state;
  const answers = state.answers + 1;
  if (litToEnd) {
    const high = state.candidate;
    if (high <= state.low + 1) {
      return { ...state, high, candidate: high, answers };
    }
    return { ...state, high, candidate: midpoint(state.low, high), answers };
  }
  const low = state.candidate;
  if (low >= state.ceiling) {
    return { ...state, low, answers };
  }
  if (state.high <= low + 1) {
    return { ...state, low, candidate: state.high, answers };
  }
  return { ...state, low, candidate: midpoint(low, state.high), answers };
}

export function needsLongerCeiling(state: FindLengthState): boolean {
  return state.phase === "search" && state.low >= state.ceiling;
}

export function nudgeFindLength(state: FindLengthState, delta: number): FindLengthState {
  if (state.phase !== "search") return state;
  if (!Number.isInteger(delta) || delta === 0) return state;
  return {
    ...state,
    candidate: clampInt(state.candidate + delta, PROVISION_LENGTH_MIN, state.ceiling),
  };
}

export function isolatedLength(state: FindLengthState): number | null {
  if (state.phase !== "search") return null;
  if (state.high === state.low + 1) return state.high;
  return null;
}

export function confirmableLength(state: FindLengthState): number | null {
  if (state.phase !== "search") return null;
  if (state.candidate < PROVISION_LENGTH_MIN || state.candidate > state.ceiling) return null;
  return state.candidate;
}

export function findLengthSpans(state: FindLengthState, totalLedCount: number): FindLengthSpan[] {
  const strip = Number.isInteger(totalLedCount) ? totalLedCount : 0;
  if (strip < 1 || state.phase !== "search") return [];
  const outStart = state.outputStart;
  const mark = outStart + state.candidate - 1;
  const prefixStop = outStart + state.candidate;
  const spans: FindLengthSpan[] = [];
  if (outStart > 0) {
    spans.push({ start: 0, stop: Math.min(outStart, strip), color: FIND_LENGTH_OFF });
  }
  if (state.candidate > 1 && outStart < strip) {
    spans.push({ start: outStart, stop: Math.min(mark, strip), color: FIND_LENGTH_DIM });
  }
  if (mark >= 0 && mark < strip) {
    spans.push({ start: mark, stop: Math.min(mark + 1, strip), color: FIND_LENGTH_END });
  }
  if (prefixStop < strip) {
    spans.push({ start: prefixStop, stop: strip, color: FIND_LENGTH_OFF });
  }
  return mergeAdjacent(spans);
}

export function findLengthCaption(state: FindLengthState, lightName: string): string {
  switch (state.phase) {
    case "pick-ceiling":
      return `Find length on ${lightName}. Preview has not started.`;
    case "search":
      return `Find length on ${lightName} · lighting ${state.candidate} LEDs. Preview is temporary.`;
    default: {
      const _exhaustive: never = state.phase;
      return _exhaustive;
    }
  }
}

export function findLengthDraft(
  state: FindLengthState,
  length: number,
): WledStripProvisionOutputDraft {
  return {
    index: state.outputIndex,
    ledType: state.ledType,
    length,
    gpio: state.gpio,
  };
}

export function findLengthConfirmDraft(state: FindLengthState): WledStripProvisionOutputDraft | null {
  const length = confirmableLength(state);
  return length == null ? null : findLengthDraft(state, length);
}

export function findLengthRestoreDraft(state: FindLengthState): WledStripProvisionOutputDraft {
  return findLengthDraft(state, state.originalLength);
}

export function findLengthWriteBody(draft: WledStripProvisionOutputDraft): {
  provision: { outputs: WledStripProvisionOutputDraft[] };
} {
  return { provision: { outputs: [draft] } };
}

export function worstCaseHalvingAnswers(ceiling: number): number {
  return Math.ceil(Math.log2(Math.max(1, clampLength(ceiling)))) + 1;
}

function midpoint(low: number, high: number): number {
  return low + Math.ceil((high - low) / 2);
}

function clampLength(value: number): number {
  return clampInt(value, PROVISION_LENGTH_MIN, PROVISION_LENGTH_MAX);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function mergeAdjacent(spans: FindLengthSpan[]): FindLengthSpan[] {
  const merged: FindLengthSpan[] = [];
  for (const span of spans) {
    if (span.stop <= span.start) continue;
    const last = merged.at(-1);
    if (last && last.stop === span.start && last.color === span.color) {
      last.stop = span.stop;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}
