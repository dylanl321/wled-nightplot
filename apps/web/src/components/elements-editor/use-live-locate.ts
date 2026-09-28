"use client";

import type { Element, LightDetail } from "@nightplot/shared";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api";
import type { Drag, EditorState } from "./use-editor-state";
import { LOCATE_LIT, LOCATE_OFF, type Range } from "./ops";

export type LocateMode = "cursor" | "hold" | "count";

/** Two painted spans per ten LEDs; the pixel Preview API accepts at most 512. */
export const COUNT_OFF_MAX_LEDS = 2560;
const COUNT_OFF_BASE = "#2c4e49";

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
  /** Stable WLED individual-pixel canvas; requires a restorable controller snapshot. */
  pixels?: boolean;
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
  backgroundPercent?: number;
}): LocateFrame | null {
  if (!input.enabled || input.ledCount < 1) return null;
  const name = input.lightName;
  if (input.mode === "count") return countOffFrame(input.ledCount, name);
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

/** Zero-based strip indices 9, 19, … are the 10th, 20th, … LEDs counted from one. */
export function countOffFrame(ledCount: number, lightName: string): LocateFrame | null {
  if (!Number.isInteger(ledCount) || ledCount < 1 || ledCount > COUNT_OFF_MAX_LEDS) return null;
  const spans: LocateSpan[] = [];
  for (let start = 0; start < ledCount; start += 10) {
    const marker = start + 9;
    spans.push({ start, stop: Math.min(marker, ledCount), color: COUNT_OFF_BASE });
    if (marker < ledCount) spans.push({ start: marker, stop: marker + 1, color: LOCATE_LIT });
  }
  return {
    start: 0, stop: ledCount, color: COUNT_OFF_BASE, spans, pixels: true,
    caption: `Count off on ${lightName} · every 10th LED is bright (10, 20, …)`,
  };
}

function holdFrame(input: {
  lightName: string;
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  elements: Element[];
  hues: Record<string, string>;
  backgroundPercent?: number;
}): LocateFrame {
  const spans = holdSpans(input);
  if (spans.length === 0) {
    return {
      start: 0,
      stop: input.ledCount,
      color: LOCATE_OFF,
      caption: "Preview on · no Segments to keep lit",
    };
  }
  const marked = holdMarksCursor(input);
  return {
    start: Math.min(...spans.map((span) => span.start)),
    stop: Math.max(...spans.map((span) => span.stop)),
    color: spans[0]?.color ?? LOCATE_LIT,
    spans,
    pixels: true,
    caption: marked
      ? `LED ${input.hoverIndex} is the bright one. Segments stay lit on ${input.lightName}.`
      : `Segments stay lit on ${input.lightName}.`,
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

/** Hold marks the cursor both inside a Segment and in unused LEDs. */
export function holdMarksCursor(input: {
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  elements: Element[];
}): boolean {
  const index = holdHoverIndex(input);
  return index != null;
}

/**
 * A logical paint frame, not controller segment geometry. Split the color
 * spans around the bright cursor; the server paints one stable pixel canvas.
 */
export function holdSpans(input: {
  ledCount: number;
  hoverIndex: number | null;
  dragging: boolean;
  elements: Element[];
  hues: Record<string, string>;
  backgroundPercent?: number;
}): LocateSpan[] {
  const index = holdHoverIndex(input);
  const spans: LocateSpan[] = [];
  const ordered = [...input.elements].sort((a, b) => a.start - b.start);
  for (const element of ordered) {
    const range = clippedElementRange(element, input.ledCount);
    if (!range) continue;
    const color = dimPreviewColor(input.hues[element.id] ?? "#d4a574", input.backgroundPercent ?? 100);
    if (index !== null && index >= range.start && index < range.stop) {
      if (range.start < index) spans.push({ start: range.start, stop: index, color });
      if (index + 1 < range.stop) spans.push({ start: index + 1, stop: range.stop, color });
    } else spans.push({ start: range.start, stop: range.stop, color });
  }
  if (index != null) {
    spans.push({ start: index, stop: index + 1, color: LOCATE_LIT });
  }
  return spans;
}

/** Preview-only attenuation. Cursor and controller brightness are unchanged. */
export function dimPreviewColor(color: string, percent: number): string {
  const level = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 100)) / 100;
  return `#${[1, 3, 5].map((offset) =>
    Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * level).toString(16).padStart(2, "0"),
  ).join("")}`;
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
  return `${painted}@${brightness ?? ""}${frame.pixels ? ":pixels" : ""}`;
}

export function locatePreviewBody(frame: LocateFrame, brightness: number | null) {
  const painted = frame.spans
    ? { spans: frame.spans }
    : { start: frame.start, stop: frame.stop, color: frame.color };
  return { ...painted, ...(brightness != null ? { brightness } : {}), ...(frame.pixels ? { pixels: true } : {}) };
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
  error: { kind: "frame" | "end"; message: string; notSent?: boolean; code?: string } | null;
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
    function cancelForAllOff(event: Event) {
      const ids = (event as CustomEvent<{ lightIds?: string[] }>).detail?.lightIds;
      if (!ids?.length || ids.includes(input.lightId)) current.cancel();
    }
    window.addEventListener("nightplot:all-off", cancelForAllOff);
    return () => {
      window.removeEventListener("nightplot:all-off", cancelForAllOff);
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
  let generation = 0;

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
    const attempt = generation;
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
      if (attempt !== generation) return;
      lastAcknowledged = key;
      if (!disposed && enabled && !mustEnd && !firstAcknowledged) {
        firstAcknowledged = true;
        onDetail(detail);
      }
    } catch (error) {
      if (attempt !== generation) return;
      lastAcknowledged = null;
      const notSent = error instanceof Error && "sent" in error && error.sent === false;
      publish({
        ...status,
        error: {
          kind: "frame",
          message: `Preview paused. ${errorMessage(error)}${notSent ? "" : " The last write is not confirmed."}`,
          notSent,
          code: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined,
        },
      });
    } finally {
      flight = false;
      schedule();
    }
  }

  async function end() {
    flight = true;
    const attempt = generation;
    try {
      const detail = await requestLocate(
        `/api/lights/${lightId}/preview/end`,
        {},
        LOCATE_BOUNDARY_TIMEOUT_MS,
      );
      if (attempt !== generation) return;
      if ((detail as LightDetail & { restored?: boolean }).restored === false) {
        throw new Error("The previous look could not be restored.");
      }
      if (!disposed) onDetail(detail);
      publish(IDLE);
    } catch (error) {
      if (attempt !== generation) return;
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
    cancel() {
      generation++;
      enabled = false;
      desired = null;
      mustEnd = false;
      open = false;
      lastAcknowledged = null;
      firstAcknowledged = false;
      lastStarted = null;
      clearTimer();
      publish(IDLE);
    },
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
