"use client";

import type { Element, LightDetail } from "@nightplot/shared";
import { useEffect, useRef } from "react";
import { postJson } from "@/lib/api";
import type { Drag, EditorState } from "./use-editor-state";
import { LOCATE_LIT, LOCATE_OFF, type Range } from "./ops";

export type LocateMode = "cursor" | "hold";

export type LocateSpan = {
  start: number;
  stop: number;
  color: string;
};

export type LocateFrame = {
  start: number;
  stop: number;
  color: string;
  caption: string;
  /** When set, Preview paints these spans and blacks every other LED. */
  spans?: LocateSpan[];
};

/**
 * The frame posted to Preview. Hover, then a LED selection or draw, then the
 * one selected Element. Anything else is the whole strip off, so the beads
 * and the controller show the same thing.
 */
export function locateFrame(input: {
  enabled: boolean;
  lightName: string;
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  drawing: Range | null;
  ledSel: Range | null;
  element: Element | null;
  hue: string | null;
  mode: LocateMode;
  elements: Element[];
  hues: Record<string, string>;
}): LocateFrame | null {
  if (!input.enabled || input.ledCount < 1) return null;
  const name = input.lightName;
  if (input.mode === "hold") return holdFrame(input);
  if (input.hoverIndex != null && !input.dragging) {
    const index = input.hoverIndex;
    return {
      start: index,
      stop: index + 1,
      color: LOCATE_LIT,
      caption: `Lighting LED ${index} on ${name}`,
    };
  }
  const range = input.drawing ?? input.ledSel;
  if (range && range.stop > range.start) {
    return {
      start: range.start,
      stop: range.stop,
      color: LOCATE_LIT,
      caption: `Lighting ${range.start}–${range.stop} on ${name}`,
    };
  }
  if (input.element && input.element.stop > input.element.start && input.hue) {
    return {
      start: input.element.start,
      stop: input.element.stop,
      color: input.hue,
      caption: `Lighting ${input.element.label} on ${name}`,
    };
  }
  return {
    start: 0,
    stop: input.ledCount,
    color: LOCATE_OFF,
    caption: "Preview on · pick something to light",
  };
}

function holdFrame(input: {
  lightName: string;
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  elements: Element[];
  hues: Record<string, string>;
}): LocateFrame {
  const spans = holdSpans(input);
  if (spans.length === 0) {
    return {
      start: 0,
      stop: input.ledCount,
      color: LOCATE_OFF,
      caption: "Preview on · no Elements to keep lit",
    };
  }
  const marked = holdMarksCursor(input);
  return {
    start: Math.min(...spans.map((span) => span.start)),
    stop: Math.max(...spans.map((span) => span.stop)),
    color: spans[0]?.color ?? LOCATE_LIT,
    spans,
    caption: marked
      ? `LED ${input.hoverIndex} is the bright one. Elements stay lit on ${input.lightName}.`
      : `Elements stay lit on ${input.lightName}.`,
  };
}

function holdHoverIndex(input: {
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
}): number | null {
  if (input.hoverIndex == null || input.dragging) return null;
  if (input.hoverIndex < 0 || input.hoverIndex >= input.ledCount) return null;
  return input.hoverIndex;
}

function clippedElementRange(
  element: Element,
  ledCount: number,
): { start: number; stop: number } | null {
  const start = Math.max(0, Math.min(ledCount, element.start));
  const stop = Math.max(0, Math.min(ledCount, element.stop));
  if (stop <= start) return null;
  return { start, stop };
}

function holdCoversIndex(input: { ledCount: number; elements: Element[] }, index: number): boolean {
  return input.elements.some((element) => {
    const range = clippedElementRange(element, input.ledCount);
    return range != null && index >= range.start && index < range.stop;
  });
}

/** True when Hold marks the hover LED — only a gap, never a punch through an Element. */
export function holdMarksCursor(input: {
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  elements: Element[];
}): boolean {
  const index = holdHoverIndex(input);
  return index != null && !holdCoversIndex(input, index);
}

/**
 * Elements keep their colours as whole ranges. Punching the hover LED into an
 * Element splits that range on every mousemove and is a flash source.
 * The cursor is the bright locate colour only when it sits in a gap.
 */
export function holdSpans(input: {
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  elements: Element[];
  hues: Record<string, string>;
}): LocateSpan[] {
  const index = holdHoverIndex(input);
  const spans: LocateSpan[] = [];
  const ordered = [...input.elements].sort((a, b) => a.start - b.start);
  for (const element of ordered) {
    const range = clippedElementRange(element, input.ledCount);
    if (!range) continue;
    spans.push({ start: range.start, stop: range.stop, color: input.hues[element.id] ?? "#d4a574" });
  }
  if (index != null && !holdCoversIndex(input, index)) {
    spans.push({ start: index, stop: index + 1, color: LOCATE_LIT });
  }
  return spans;
}

export function drawingRange(state: EditorState): Range | null {
  const drag: Drag | null = state.drag;
  if (drag?.kind !== "draw") return null;
  return state.draftRange;
}

/** First hop / intentional hold. Short enough that a parked LED does not feel sticky. */
export const LOCATE_HOLD_MS = 80;
/** Hover or drag while frames keep changing. Trailing settle; latest frame wins. */
export const LOCATE_MOVE_MS = 220;
/** Two schedules closer than this count as a sweep, not a hold. */
export const LOCATE_BURST_GAP_MS = 140;

/** Preview body identity — start/stop/color or spans, plus brightness. Caption is not sent. */
export function locatePayloadKey(frame: LocateFrame, brightness: number | null): string {
  const painted = frame.spans
    ? frame.spans.map((span) => `${span.start}:${span.stop}:${span.color}`).join("|")
    : `${frame.start}:${frame.stop}:${frame.color}`;
  return `${painted}@${brightness ?? ""}`;
}

export function locateDebounceMs(input: {
  moving: boolean;
  msSinceLastSchedule: number | null;
}): number {
  if (!input.moving) return LOCATE_HOLD_MS;
  if (input.msSinceLastSchedule != null && input.msSinceLastSchedule < LOCATE_BURST_GAP_MS) {
    return LOCATE_MOVE_MS;
  }
  return LOCATE_HOLD_MS;
}

export function locatePreviewBody(frame: LocateFrame, brightness: number | null) {
  const painted = frame.spans
    ? { spans: frame.spans }
    : { start: frame.start, stop: frame.stop, color: frame.color };
  return brightness != null ? { ...painted, brightness } : painted;
}

export function useLiveLocate(input: {
  enabled: boolean;
  lightId: string;
  ledCount: number;
  frame: LocateFrame | null;
  brightness: number | null;
  /** Hover or drag — stronger trailing settle than a parked hold. */
  moving?: boolean;
  onDetail: (detail: LightDetail) => void;
}) {
  const onDetail = useRef(input.onDetail);
  onDetail.current = input.onDetail;
  const enabled = useRef(input.enabled);
  enabled.current = input.enabled;
  const brightness = useRef(input.brightness);
  brightness.current = input.brightness;
  const lightId = useRef(input.lightId);
  lightId.current = input.lightId;
  const desired = useRef<LocateFrame | null>(null);
  const lastSentKey = useRef<string | null>(null);
  const hopDetailApplied = useRef(false);
  const open = useRef(false);
  const flight = useRef<Promise<void> | null>(null);
  const disposed = useRef(false);
  const lastScheduleAt = useRef<number | null>(null);
  const flush = useRef<() => Promise<void>>(async () => undefined);

  flush.current = async function runFlush() {
    if (flight.current) return;
    const next = desired.current;
    if (!enabled.current || disposed.current || !next) return;
    const key = locatePayloadKey(next, brightness.current);
    if (key === lastSentKey.current) return;

    const run = (async () => {
      if (!enabled.current || disposed.current) return;
      open.current = true;
      const res = await postJson<LightDetail>(
        `/api/lights/${lightId.current}/preview`,
        locatePreviewBody(next, brightness.current),
      );
      lastSentKey.current = key;
      if (disposed.current || !enabled.current) {
        open.current = false;
        lastSentKey.current = null;
        hopDetailApplied.current = false;
        await endPreview(lightId.current, onDetail.current);
        return;
      }
      // First hop only. Later hops omit LightDetail so beads do not chase /json/live.
      if (res.ok && !hopDetailApplied.current) {
        hopDetailApplied.current = true;
        onDetail.current(res.data);
      }
    })();

    flight.current = run;
    try {
      await run;
    } finally {
      flight.current = null;
      const latest = desired.current;
      if (
        !disposed.current &&
        enabled.current &&
        latest &&
        locatePayloadKey(latest, brightness.current) !== lastSentKey.current
      ) {
        await flush.current();
      }
    }
  };

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (open.current) void endPreview(input.lightId, onDetail.current);
      open.current = false;
      lastSentKey.current = null;
      hopDetailApplied.current = false;
      desired.current = null;
    };
  }, [input.lightId]);

  const payloadKey = input.frame ? locatePayloadKey(input.frame, input.brightness) : "";
  const moving = Boolean(input.moving);

  useEffect(() => {
    desired.current = input.frame;
    if (!input.enabled || !input.frame) {
      lastSentKey.current = null;
      hopDetailApplied.current = false;
      lastScheduleAt.current = null;
      if (open.current) {
        open.current = false;
        void endPreview(input.lightId, onDetail.current);
      }
      return;
    }
    if (flight.current) {
      // Latest-wins: desired already replaced. Do not queue superseded hops.
      return;
    }
    const now = Date.now();
    const delay = locateDebounceMs({
      moving,
      msSinceLastSchedule: lastScheduleAt.current == null ? null : now - lastScheduleAt.current,
    });
    lastScheduleAt.current = now;
    const timer = window.setTimeout(() => {
      void flush.current();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [input.enabled, input.lightId, payloadKey, moving]);
}

async function endPreview(lightId: string, onDetail: (detail: LightDetail) => void) {
  const res = await postJson<LightDetail>(`/api/lights/${lightId}/preview/end`, {});
  if (res.ok) onDetail(res.data);
}
