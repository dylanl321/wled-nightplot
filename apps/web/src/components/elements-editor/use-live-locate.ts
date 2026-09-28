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
  const hover = input.hoverIndex != null && !input.dragging;
  return {
    start: spans[0]?.start ?? 0,
    stop: spans[spans.length - 1]?.stop ?? input.ledCount,
    color: spans[0]?.color ?? LOCATE_LIT,
    spans,
    caption: hover
      ? `LED ${input.hoverIndex} is the bright one. Elements stay lit on ${input.lightName}.`
      : `Elements stay lit on ${input.lightName}.`,
  };
}

/** Elements keep their colours. The LED under the cursor is the bright locate colour. */
export function holdSpans(input: {
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  elements: Element[];
  hues: Record<string, string>;
}): LocateSpan[] {
  const index = input.hoverIndex != null && !input.dragging ? input.hoverIndex : null;
  const spans: LocateSpan[] = [];
  let punched = false;
  const ordered = [...input.elements].sort((a, b) => a.start - b.start);
  for (const element of ordered) {
    const start = Math.max(0, Math.min(input.ledCount, element.start));
    const stop = Math.max(0, Math.min(input.ledCount, element.stop));
    if (stop <= start) continue;
    const color = input.hues[element.id] ?? "#d4a574";
    if (index != null && index >= start && index < stop) {
      if (start < index) spans.push({ start, stop: index, color });
      spans.push({ start: index, stop: index + 1, color: LOCATE_LIT });
      if (index + 1 < stop) spans.push({ start: index + 1, stop, color });
      punched = true;
    } else {
      spans.push({ start, stop, color });
    }
  }
  if (index != null && !punched && index >= 0 && index < input.ledCount) {
    spans.push({ start: index, stop: index + 1, color: LOCATE_LIT });
  }
  return spans;
}

export function drawingRange(state: EditorState): Range | null {
  const drag: Drag | null = state.drag;
  if (drag?.kind !== "draw") return null;
  return state.draftRange;
}

export function useLiveLocate(input: {
  enabled: boolean;
  lightId: string;
  ledCount: number;
  frame: LocateFrame | null;
  brightness: number | null;
  onDetail: (detail: LightDetail) => void;
}) {
  const onDetail = useRef(input.onDetail);
  onDetail.current = input.onDetail;
  const enabled = useRef(input.enabled);
  enabled.current = input.enabled;
  const open = useRef(false);
  const flight = useRef<Promise<void> | null>(null);
  const pending = useRef<LocateFrame | null | undefined>(undefined);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (open.current) void endPreview(input.lightId, onDetail.current);
      open.current = false;
    };
  }, [input.lightId]);

  const frameKey = input.frame
    ? input.frame.spans
      ? input.frame.spans.map((span) => `${span.start}:${span.stop}:${span.color}`).join("|")
      : `${input.frame.start}:${input.frame.stop}:${input.frame.color}`
    : "";

  useEffect(() => {
    const frame = input.frame;
    if (!input.enabled || !frame) {
      pending.current = undefined;
      if (open.current) {
        open.current = false;
        void endPreview(input.lightId, onDetail.current);
      }
      return;
    }
    async function send(next: LocateFrame) {
      if (flight.current) {
        pending.current = next;
        return;
      }
      const run = (async () => {
        if (!enabled.current || disposed.current) return;
        open.current = true;
        const res = await postJson<LightDetail>(`/api/lights/${input.lightId}/preview`, {
          ...(next.spans
            ? { spans: next.spans }
            : { start: next.start, stop: next.stop, color: next.color }),
          ...(input.brightness != null ? { brightness: input.brightness } : {}),
        });
        if (disposed.current || !enabled.current) {
          open.current = false;
          await endPreview(input.lightId, onDetail.current);
          return;
        }
        if (res.ok) onDetail.current(res.data);
      })();
      flight.current = run;
      try {
        await run;
      } finally {
        flight.current = null;
        const queued = pending.current;
        pending.current = undefined;
        if (queued && enabled.current && !disposed.current) await send(queued);
      }
    }

    const timer = window.setTimeout(() => {
      void send(frame);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [input.enabled, input.lightId, input.brightness, frameKey]);
}

async function endPreview(lightId: string, onDetail: (detail: LightDetail) => void) {
  const res = await postJson<LightDetail>(`/api/lights/${lightId}/preview/end`, {});
  if (res.ok) onDetail(res.data);
}
