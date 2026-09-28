import type { Element } from "@nightplot/shared";

/** Display-only. Not stored on the Element and not sent to the API. */
export const ELEMENT_HUES = [
  "#d4a574",
  "#7ee0d0",
  "#b48cff",
  "#8fb8ff",
  "#e7a0b4",
  "#c8d98a",
] as const;

export const LOCATE_LIT = "#fff4dc";
export const LOCATE_OFF = "#000000";

export const STRIP = {
  per: 100,
  pitch: 9.4,
  gutter: 34,
  pad: 6,
  rowHeight: 78,
  rowGap: 10,
} as const;

export type Range = { start: number; stop: number };

export type Hit = {
  x: number;
  y: number;
  r: number;
  idx: number;
  b: number;
};

export type LedSelection = Range & { anchor: number };

export type IdFactory = () => string;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function stripMetrics(ledCount: number): { rows: number; width: number; height: number } {
  const count = Math.max(ledCount, 1);
  const rows = Math.max(1, Math.ceil(count / STRIP.per));
  const width = STRIP.gutter + STRIP.pad * 2 + STRIP.per * STRIP.pitch;
  const height = rows * STRIP.rowHeight + Math.max(0, rows - 1) * STRIP.rowGap;
  return { rows, width, height };
}

export function rowTop(row: number): number {
  return row * (STRIP.rowHeight + STRIP.rowGap);
}

export function beadCenterY(row: number): number {
  return rowTop(row) + 44;
}

export function boundaryX(boundary: number, row: number): number {
  return STRIP.gutter + STRIP.pad + (boundary - row * STRIP.per) * STRIP.pitch;
}

export function pieces(
  start: number,
  stop: number,
  per = STRIP.per,
): { r: number; a: number; b: number }[] {
  const out: { r: number; a: number; b: number }[] = [];
  let index = start;
  while (index < stop) {
    const row = Math.floor(index / per);
    const end = Math.min(stop, (row + 1) * per);
    out.push({ r: row, a: index, b: end });
    index = end;
  }
  return out;
}

export function nextHue(used: readonly string[]): string {
  return (
    ELEMENT_HUES.find((hue) => !used.includes(hue)) ??
    ELEMENT_HUES[used.length % ELEMENT_HUES.length]!
  );
}

export function assignHues(
  elements: readonly { id: string }[],
  stored: Readonly<Record<string, string>>,
): Record<string, string> {
  const next: Record<string, string> = {};
  const used: string[] = [];
  for (const element of elements) {
    const kept = stored[element.id];
    const hue =
      kept && (ELEMENT_HUES as readonly string[]).includes(kept) && !used.includes(kept)
        ? kept
        : nextHue(used);
    next[element.id] = hue;
    used.push(hue);
  }
  return next;
}

export function bounds(
  element: Element,
  elements: readonly Element[],
  ledCount: number,
): { lo: number; hi: number } {
  const others = elements.filter((item) => item.id !== element.id);
  const lo = Math.max(0, ...others.filter((item) => item.stop <= element.start).map((item) => item.stop));
  const hi = Math.min(
    ledCount,
    ...others.filter((item) => item.start >= element.stop).map((item) => item.start),
  );
  return { lo, hi };
}

export function gapAt(
  index: number,
  elements: readonly Element[],
  ledCount: number,
): { lo: number; hi: number } {
  return {
    lo: Math.max(0, ...elements.filter((item) => item.stop <= index).map((item) => item.stop)),
    hi: Math.min(ledCount, ...elements.filter((item) => item.start > index).map((item) => item.start)),
  };
}

export function gaps(elements: readonly Element[], ledCount: number): Range[] {
  const sorted = [...elements]
    .filter((element) => element.stop > element.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  let cursor = 0;
  for (const element of sorted) {
    if (element.start > cursor) out.push({ start: cursor, stop: element.start });
    cursor = Math.max(cursor, element.stop);
  }
  if (cursor < ledCount) out.push({ start: cursor, stop: ledCount });
  return out;
}

export function elementAt(index: number, elements: readonly Element[]): Element | null {
  return elements.find((element) => index >= element.start && index < element.stop) ?? null;
}

export function hits(elements: readonly Element[], range: Range): Element[] {
  return elements.filter((element) => element.start < range.stop && element.stop > range.start);
}

export function snapTo(value: number, snap: boolean): number {
  return snap ? Math.round(value / 5) * 5 : value;
}

export function hitFromSvg(x: number, y: number, ledCount: number): Hit {
  const count = Math.max(ledCount, 1);
  const { rows } = stripMetrics(count);
  const row = clamp(Math.floor(y / (STRIP.rowHeight + STRIP.rowGap)), 0, rows - 1);
  const fraction = (x - STRIP.gutter - STRIP.pad) / STRIP.pitch;
  const idx = Math.min(
    count - 1,
    row * STRIP.per + clamp(Math.floor(fraction), 0, STRIP.per - 1),
  );
  const boundary = Math.min(count, row * STRIP.per + clamp(Math.round(fraction), 0, STRIP.per));
  return { x, y, r: row, idx, b: boundary };
}

export function clientToSvg(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  ledCount: number,
): Hit | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const { width, height } = stripMetrics(ledCount);
  const x = ((clientX - rect.left) * width) / rect.width;
  const y = ((clientY - rect.top) * height) / rect.height;
  return hitFromSvg(x, y, ledCount);
}

export function edgeHit(
  hit: Hit,
  element: Element | null,
  ledCount: number,
): "start" | "end" | null {
  if (!element || element.stop <= element.start) return null;
  const stop = Math.min(element.stop, ledCount);
  if (stop <= element.start) return null;
  const startRow = Math.floor(element.start / STRIP.per);
  const endRow = Math.floor((stop - 1) / STRIP.per);
  if (hit.r === endRow && Math.abs(hit.x - boundaryX(stop, endRow)) < 7) return "end";
  if (hit.r === startRow && Math.abs(hit.x - boundaryX(element.start, startRow)) < 7) return "start";
  return null;
}

export function carve(elements: readonly Element[], range: Range, nextId: IdFactory): Element[] {
  const out: Element[] = [];
  for (const element of elements) {
    if (!(element.start < range.stop && element.stop > range.start)) {
      out.push(element);
      continue;
    }
    if (element.start < range.start) out.push({ ...element, stop: range.start });
    if (element.stop > range.stop) {
      if (element.start < range.start) {
        out.push({
          id: nextId(),
          lightId: element.lightId,
          label: `${element.label} 2`,
          start: range.stop,
          stop: element.stop,
        });
      } else {
        out.push({ ...element, start: range.stop });
      }
    }
  }
  return out;
}

export function splitElement(
  elements: readonly Element[],
  id: string,
  boundary: number,
  nextId: IdFactory,
): Element[] | null {
  const element = elements.find((item) => item.id === id);
  if (!element || boundary <= element.start || boundary >= element.stop) return null;
  const right: Element = {
    id: nextId(),
    lightId: element.lightId,
    label: `${element.label} 2`,
    start: boundary,
    stop: element.stop,
  };
  return [
    ...elements.map((item) => (item.id === id ? { ...item, stop: boundary } : item)),
    right,
  ];
}

export type MergeCheck = {
  ok: boolean;
  chosen: Element[];
  start: number;
  stop: number;
  between: Element[];
};

export function mergeCheck(elements: readonly Element[], selected: readonly string[]): MergeCheck {
  if (selected.length < 2) return { ok: false, chosen: [], start: 0, stop: 0, between: [] };
  const chosen = elements
    .filter((element) => selected.includes(element.id))
    .sort((a, b) => a.start - b.start);
  if (chosen.length < 2) return { ok: false, chosen: [], start: 0, stop: 0, between: [] };
  const start = chosen[0]!.start;
  const stop = Math.max(...chosen.map((element) => element.stop));
  const between = elements.filter(
    (element) => !selected.includes(element.id) && element.start < stop && element.stop > start,
  );
  return { ok: between.length === 0, chosen, start, stop, between };
}

export function combineElements(
  elements: readonly Element[],
  selected: readonly string[],
): { ok: true; elements: Element[]; id: string } | { ok: false; between: Element[] } {
  const check = mergeCheck(elements, selected);
  if (check.chosen.length < 2) return { ok: false, between: [] };
  if (!check.ok) return { ok: false, between: check.between };
  const keep = { ...check.chosen[0]!, start: check.start, stop: check.stop };
  return {
    ok: true,
    id: keep.id,
    elements: [...elements.filter((element) => !selected.includes(element.id)), keep],
  };
}

export function duplicateElement(
  elements: readonly Element[],
  id: string,
  ledCount: number,
  nextId: IdFactory,
):
  | { ok: true; elements: Element[]; id: string }
  | { ok: false; length: number; largest: number } {
  const element = elements.find((item) => item.id === id);
  if (!element) return { ok: false, length: 0, largest: 0 };
  const length = element.stop - element.start;
  const runs = gaps(elements, ledCount);
  const run =
    runs.find((gap) => gap.start >= element.stop && gap.stop - gap.start >= length) ??
    runs.find((gap) => gap.stop - gap.start >= length);
  if (!run) {
    const largest = Math.max(0, ...runs.map((gap) => gap.stop - gap.start));
    return { ok: false, length, largest };
  }
  const copy: Element = {
    id: nextId(),
    lightId: element.lightId,
    label: `${element.label} copy`,
    start: run.start,
    stop: run.start + length,
  };
  return { ok: true, elements: [...elements, copy], id: copy.id };
}

export function extendOk(elements: readonly Element[], element: Element, range: Range): boolean {
  const start = Math.min(element.start, range.start);
  const stop = Math.max(element.stop, range.stop);
  return !elements.some(
    (other) => other.id !== element.id && other.start < stop && other.stop > start,
  );
}

export function extendInto(
  elements: readonly Element[],
  id: string,
  range: Range,
): Element[] | null {
  const element = elements.find((item) => item.id === id);
  if (!element || !extendOk(elements, element, range)) return null;
  return elements.map((item) =>
    item.id === id
      ? { ...item, start: Math.min(item.start, range.start), stop: Math.max(item.stop, range.stop) }
      : item,
  );
}

export function carveNew(
  elements: readonly Element[],
  range: Range,
  lightId: string,
  nextId: IdFactory,
): { elements: Element[]; id: string; taken: string[] } {
  const taken = hits(elements, range).map((element) => element.label);
  const base = carve(elements, range, nextId);
  const created: Element = {
    id: nextId(),
    lightId,
    label: `Element ${base.length + 1}`,
    start: range.start,
    stop: range.stop,
  };
  return { elements: [...base, created], id: created.id, taken };
}

export function fillGap(
  elements: readonly Element[],
  range: Range,
  lightId: string,
  nextId: IdFactory,
): { elements: Element[]; id: string } {
  const created: Element = {
    id: nextId(),
    lightId,
    label: `Element ${elements.length + 1}`,
    start: range.start,
    stop: range.stop,
  };
  return { elements: [...elements, created], id: created.id };
}

export type NudgeEdge = "start" | "end" | "body";

export function nudgeElement(
  element: Element,
  elements: readonly Element[],
  ledCount: number,
  delta: number,
  which: NudgeEdge = "body",
): Pick<Element, "start" | "stop"> {
  const { lo, hi } = bounds(element, elements, ledCount);
  if (which === "end") {
    return { start: element.start, stop: clamp(element.stop + delta, element.start + 1, hi) };
  }
  if (which === "start") {
    return { start: clamp(element.start + delta, lo, element.stop - 1), stop: element.stop };
  }
  const length = element.stop - element.start;
  const start = clamp(element.start + delta, lo, hi - length);
  return { start, stop: start + length };
}

export function resizedStart(
  original: Element,
  boundary: number,
  elements: readonly Element[],
  ledCount: number,
  snap: boolean,
): number {
  const { lo } = bounds(original, elements, ledCount);
  return clamp(snapTo(boundary, snap), lo, original.stop - 1);
}

export function resizedStop(
  original: Element,
  boundary: number,
  elements: readonly Element[],
  ledCount: number,
  snap: boolean,
): number {
  const { hi } = bounds(original, elements, ledCount);
  return clamp(snapTo(boundary, snap), original.start + 1, hi);
}

export function shiftedRange(
  original: Element,
  anchor: number,
  index: number,
  elements: readonly Element[],
  ledCount: number,
  snap: boolean,
): Range {
  const { lo, hi } = bounds(original, elements, ledCount);
  const length = original.stop - original.start;
  const start = clamp(snapTo(original.start + index - anchor, snap), lo, hi - length);
  return { start, stop: start + length };
}

export function drawnRange(anchor: number, index: number, gap: { lo: number; hi: number }): Range {
  return {
    start: clamp(Math.min(anchor, index), gap.lo, gap.hi - 1),
    stop: clamp(Math.max(anchor, index) + 1, gap.lo + 1, gap.hi),
  };
}

export function extendLed(selection: LedSelection, index: number, gap: { lo: number; hi: number }): LedSelection {
  const drawn = drawnRange(selection.anchor, index, gap);
  return { ...drawn, anchor: selection.anchor };
}

export function changeCount(draft: readonly Element[], saved: readonly Element[]): number {
  const ids = new Set([...draft, ...saved].map((element) => element.id));
  let count = 0;
  for (const id of ids) {
    const left = draft.find((element) => element.id === id);
    const right = saved.find((element) => element.id === id);
    if (
      !left ||
      !right ||
      left.label !== right.label ||
      left.start !== right.start ||
      left.stop !== right.stop
    ) {
      count += 1;
    }
  }
  return count;
}

export function elementsEqual(left: readonly Element[], right: readonly Element[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((element, index) => {
    const other = right[index];
    return (
      !!other &&
      element.id === other.id &&
      element.lightId === other.lightId &&
      element.label === other.label &&
      element.start === other.start &&
      element.stop === other.stop
    );
  });
}

export function parseIndex(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ordinal(value: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const mod = value % 100;
  return `${value}${suffixes[(mod - 20) % 10] || suffixes[mod] || suffixes[0]}`;
}

export type SelectionFacts = {
  hit: Element[];
  inside: Element | null;
  extend: Element[];
  free: number;
};

export function selectionFacts(elements: readonly Element[], range: Range): SelectionFacts {
  const hit = hits(elements, range);
  const inside =
    hit.length === 1 && hit[0]!.start <= range.start && hit[0]!.stop >= range.stop ? hit[0]! : null;
  const extend = elements.filter(
    (element) =>
      element.start <= range.stop &&
      element.stop >= range.start &&
      !(element.start <= range.start && element.stop >= range.stop) &&
      extendOk(elements, element, range),
  );
  const covered = hit.reduce(
    (sum, element) =>
      sum + (Math.min(element.stop, range.stop) - Math.max(element.start, range.start)),
    0,
  );
  return { hit, inside, extend, free: range.stop - range.start - covered };
}

export type IssueWord = "invert" | "overlap" | "past strip";

export function issueWord(
  code: "invert" | "overlap" | "over-ledCount" | undefined,
): IssueWord | undefined {
  if (code === "over-ledCount") return "past strip";
  if (code) return code;
  return undefined;
}

export function issueSentence(
  code: "invert" | "overlap" | "over-ledCount" | undefined,
  ledCount: number,
): string {
  if (code === "invert") return "Stop must be after Start (invert).";
  if (code === "over-ledCount") return `Runs past the strip end at ${ledCount} (past strip).`;
  if (code === "overlap") return "Overlaps another Element (overlap).";
  return "";
}
