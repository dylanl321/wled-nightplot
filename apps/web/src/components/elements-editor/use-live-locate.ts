"use client";

import type { Element, LightDetail } from "@nightplot/shared";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api";
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

/** Send immediately, then at most once per 50 ms. Movement never postpones a send. */
export const LOCATE_INTERVAL_MS = 50;
/** Opening/closing may probe and reread; hops normally require only one controller write. */
export const LOCATE_BOUNDARY_TIMEOUT_MS = 15_000;
export const LOCATE_HOP_TIMEOUT_MS = 5_000;

/** Preview body identity — start/stop/color or spans, plus brightness. Caption is not sent. */
export function locatePayloadKey(frame: LocateFrame, brightness: number | null): string {
  const painted = frame.spans
    ? frame.spans.map((span) => `${span.start}:${span.stop}:${span.color}`).join("|")
    : `${frame.start}:${frame.stop}:${frame.color}`;
  return `${painted}@${brightness ?? ""}`;
}

export function locatePreviewBody(frame: LocateFrame, brightness: number | null) {
  const painted = frame.spans
    ? { spans: frame.spans }
    : { start: frame.start, stop: frame.stop, color: frame.color };
  return brightness != null ? { ...painted, brightness } : painted;
}

type LocateInput = {
  enabled: boolean;
  lightId: string;
  ledCount: number;
  frame: LocateFrame | null;
  brightness: number | null;
  onDetail: (detail: LightDetail) => void;
};

type LocateStatus = {
  error: { kind: "frame" | "end"; message: string } | null;
  stopping: boolean;
};

const IDLE: LocateStatus = { error: null, stopping: false };

export function useLiveLocate(input: LocateInput) {
  const latest = useRef(input);
  const sender = useRef<ReturnType<typeof createLocateSender> | null>(null);
  const [reported, setReported] = useState({ lightId: input.lightId, status: IDLE });

  useEffect(() => {
    latest.current = input;
  });
  useEffect(() => {
    const current = createLocateSender(
      input.lightId,
      (detail) => latest.current.onDetail(detail),
      (status) => setReported({ lightId: input.lightId, status }),
    );
    sender.current = current;
    return () => {
      sender.current = null;
      current.dispose();
    };
  }, [input.lightId]);
  const payloadKey = input.frame ? locatePayloadKey(input.frame, input.brightness) : "";
  useEffect(() => {
    sender.current?.update(latest.current);
  }, [input.enabled, input.lightId, payloadKey]);

  const status = reported.lightId === input.lightId ? reported.status : IDLE;
  return { ...status, retry: () => sender.current?.retry() };
}

/**
 * One sender owns one Light for its whole lifetime. A toggle-off is an end
 * barrier: finish the current request, end once, then allow a new Preview.
 * Server-wide ownership and cancellation across tabs are a separate concern.
 */
function createLocateSender(
  lightId: string,
  onDetail: (detail: LightDetail) => void,
  onStatus: (status: LocateStatus) => void,
) {
  let enabled = false;
  let disposed = false;
  let desired: { frame: LocateFrame; brightness: number | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flight = false;
  let open = false;
  let mustEnd = false;
  let firstAcknowledged = false;
  let lastAcknowledged: string | null = null;
  let lastStarted: number | null = null;
  let status = IDLE;

  function publish(next: LocateStatus) {
    status = next;
    if (!disposed) onStatus(next);
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (flight) return;
    if (mustEnd) {
      void end();
      return;
    }
    if (disposed || !enabled || !desired || status.error) return;
    if (locatePayloadKey(desired.frame, desired.brightness) === lastAcknowledged) {
      clearTimer();
      return;
    }
    if (timer !== null) return; // Keep the deadline, replace only the desired frame.
    const wait = lastStarted === null ? 0 : Math.max(0, LOCATE_INTERVAL_MS - (Date.now() - lastStarted));
    timer = setTimeout(() => void send(), wait);
  }

  async function send() {
    timer = null;
    if (flight || disposed || !enabled || !desired || mustEnd || status.error) return;
    const next = desired;
    const key = locatePayloadKey(next.frame, next.brightness);
    if (key === lastAcknowledged) return;
    flight = true;
    open = true; // A lost response does not prove the server sent nothing.
    lastStarted = Date.now();
    try {
      const detail = await requestLocate(
        `/api/lights/${lightId}/preview`,
        locatePreviewBody(next.frame, next.brightness),
        firstAcknowledged ? LOCATE_HOP_TIMEOUT_MS : LOCATE_BOUNDARY_TIMEOUT_MS,
      );
      lastAcknowledged = key;
      if (!disposed && enabled && !mustEnd && !firstAcknowledged) {
        firstAcknowledged = true;
        onDetail(detail);
      }
    } catch (error) {
      lastAcknowledged = null;
      publish({
        ...status,
        error: {
          kind: "frame",
          message: `Preview paused. ${errorMessage(error)} The last write is not confirmed.`,
        },
      });
    } finally {
      flight = false;
      schedule();
    }
  }

  async function end() {
    flight = true;
    try {
      const detail = await requestLocate(
        `/api/lights/${lightId}/preview/end`,
        {},
        LOCATE_BOUNDARY_TIMEOUT_MS,
      );
      if ((detail as LightDetail & { restored?: boolean }).restored === false) {
        throw new Error("The previous look could not be restored.");
      }
      if (!disposed) onDetail(detail);
      publish(IDLE);
    } catch (error) {
      // 404 means there is no session to end (e.g. a rejected first frame).
      if (error instanceof Error && "status" in error && error.status === 404) {
        publish(IDLE);
      } else {
        publish({
          stopping: false,
          error: {
            kind: "end",
            message: `End Preview is not confirmed. ${errorMessage(error)} Reload this Light or use All Off.`,
          },
        });
      }
    } finally {
      open = false;
      mustEnd = false;
      firstAcknowledged = false;
      lastAcknowledged = null;
      lastStarted = null;
      flight = false;
      schedule();
    }
  }

  return {
    update(input: LocateInput) {
      desired = input.frame ? { frame: input.frame, brightness: input.brightness } : null;
      const active = input.enabled && desired !== null;
      if (!active) {
        enabled = false;
        clearTimer();
        if (open) {
          mustEnd = true;
          publish({ ...status, stopping: true });
        }
      } else {
        enabled = true;
      }
      schedule();
    },
    retry() {
      if (disposed || !enabled || status.error?.kind !== "frame" || mustEnd) return;
      // Explicit retry only; the failed frame was never acknowledged.
      publish(IDLE);
      schedule();
    },
    dispose() {
      disposed = true;
      enabled = false;
      desired = null;
      clearTimer();
      if (open) mustEnd = true;
      schedule();
    },
  };
}

async function requestLocate(path: string, body: unknown, timeoutMs: number): Promise<LightDetail> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const detail = await fetchJson<LightDetail>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!detail.light || !Array.isArray(detail.elements)) {
      throw new Error("The server returned an incomplete response.");
    }
    return detail;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The server did not respond in time.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
