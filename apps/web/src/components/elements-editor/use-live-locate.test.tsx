"use client";

import type { LightDetail } from "@nightplot/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPath } from "@/test/fixtures";
import {
  holdMarksCursor,
  holdSpans,
  locateDebounceMs,
  locateFrame,
  locatePayloadKey,
  LOCATE_HOLD_MS,
  LOCATE_MOVE_MS,
  useLiveLocate,
  type LocateFrame,
} from "./use-live-locate";

const frame: LocateFrame = { start: 4, stop: 5, color: "#fff4dc", caption: "Lighting LED 4" };

function led(index: number, caption = `Lighting LED ${index}`): LocateFrame {
  return { start: index, stop: index + 1, color: "#fff4dc", caption };
}

function detail() {
  return { light: { id: "light-1" }, elements: [] } as unknown as LightDetail;
}

async function finish(unmount: () => void) {
  unmount();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function stubPreview(args: {
  bodies: unknown[];
  paths?: string[];
  gate?: () => Promise<void>;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      args.paths?.push(path);
      if (path.endsWith("/preview") && init?.method === "POST" && !path.endsWith("/preview/end")) {
        args.bodies.push(JSON.parse(String(init.body)));
        if (args.gate) await args.gate();
      }
      return new Response(JSON.stringify(detail()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("locatePayloadKey", () => {
  it("ignores caption and treats the same start/stop/color as identical", () => {
    expect(locatePayloadKey(led(4, "Lighting LED 4 on Porch"), 180)).toBe(
      locatePayloadKey(led(4, "Lighting LED 4 on Eave"), 180),
    );
  });

  it("changes when spans or brightness change", () => {
    const spans: LocateFrame = {
      start: 0,
      stop: 8,
      color: "#d4a574",
      caption: "Elements stay lit",
      spans: [
        { start: 0, stop: 4, color: "#d4a574" },
        { start: 4, stop: 5, color: "#fff4dc" },
      ],
    };
    expect(locatePayloadKey(spans, 180)).not.toBe(locatePayloadKey(led(4), 180));
    expect(locatePayloadKey(led(4), 180)).not.toBe(locatePayloadKey(led(4), 200));
  });
});

describe("locateDebounceMs", () => {
  it("stays short on a hold, and lengthens only while hover/drag is bursting", () => {
    expect(locateDebounceMs({ moving: false, msSinceLastSchedule: 20 })).toBe(LOCATE_HOLD_MS);
    expect(locateDebounceMs({ moving: true, msSinceLastSchedule: null })).toBe(LOCATE_HOLD_MS);
    expect(locateDebounceMs({ moving: true, msSinceLastSchedule: 40 })).toBe(LOCATE_MOVE_MS);
    expect(locateDebounceMs({ moving: true, msSinceLastSchedule: 400 })).toBe(LOCATE_HOLD_MS);
  });
});

const holdElements = [
  { id: "a", lightId: "light-1", label: "Element 1", start: 0, stop: 8 },
  { id: "b", lightId: "light-1", label: "Element 2", start: 10, stop: 14 },
];
const holdHues = { a: "#d4a574", b: "#7ee0d0" };

function holdArgs(hoverIndex: number | null, dragging = false) {
  return {
    ledCount: 20,
    hoverIndex,
    dragging,
    elements: holdElements,
    hues: holdHues,
  };
}

describe("holdSpans", () => {
  it("keeps each Element as a whole colour — hover does not punch split segs", () => {
    const parked = holdSpans(holdArgs(null));
    const overElement = holdSpans(holdArgs(4));
    expect(parked).toEqual([
      { start: 0, stop: 8, color: "#d4a574" },
      { start: 10, stop: 14, color: "#7ee0d0" },
    ]);
    expect(overElement).toEqual(parked);
    expect(holdMarksCursor(holdArgs(4))).toBe(false);
  });

  it("stays identical while the cursor moves across the same Element", () => {
    expect(holdSpans(holdArgs(1))).toEqual(holdSpans(holdArgs(7)));
    expect(locatePayloadKey(locateHold(1), 180)).toBe(locatePayloadKey(locateHold(7), 180));
  });

  it("marks a gap LED without splitting the Elements around it", () => {
    expect(holdSpans(holdArgs(9))).toEqual([
      { start: 0, stop: 8, color: "#d4a574" },
      { start: 10, stop: 14, color: "#7ee0d0" },
      { start: 9, stop: 10, color: "#fff4dc" },
    ]);
    expect(holdMarksCursor(holdArgs(9))).toBe(true);
  });

  it("ignores hover while dragging, same as a parked cursor", () => {
    expect(holdSpans(holdArgs(9, true))).toEqual(holdSpans(holdArgs(null)));
    expect(holdMarksCursor(holdArgs(9, true))).toBe(false);
  });
});

describe("locateFrame hold", () => {
  it("does not claim the hover LED is bright when it sits on an Element", () => {
    const onElement = locateHold(4);
    const inGap = locateHold(9);
    expect(onElement.caption).toBe("Elements stay lit on Porch.");
    expect(onElement.caption).not.toMatch(/bright one/);
    expect(inGap.caption).toBe("LED 9 is the bright one. Elements stay lit on Porch.");
    expect(onElement.start).toBe(0);
    expect(onElement.stop).toBe(14);
    expect(inGap.start).toBe(0);
    expect(inGap.stop).toBe(14);
  });
});

describe("locateFrame cursor-only", () => {
  it("stays a single LED span — no hold Element table", () => {
    const frame = locateFrame({
      enabled: true,
      lightName: "Porch",
      ledCount: 20,
      hoverIndex: 4,
      dragging: false,
      drawing: null,
      ledSel: null,
      element: null,
      hue: null,
      mode: "cursor",
      elements: holdElements,
      hues: holdHues,
    });
    expect(frame).toEqual({
      start: 4,
      stop: 5,
      color: "#fff4dc",
      caption: "Lighting LED 4 on Porch",
    });
    expect(frame?.spans).toBeUndefined();
  });
});

function locateHold(hoverIndex: number | null): LocateFrame {
  const frame = locateFrame({
    enabled: true,
    lightName: "Porch",
    ledCount: 20,
    hoverIndex,
    dragging: false,
    drawing: null,
    ledSel: null,
    element: null,
    hue: null,
    mode: "hold",
    elements: holdElements,
    hues: holdHues,
  });
  if (!frame) throw new Error("hold locateFrame must return a frame");
  return frame;
}

describe("useLiveLocate", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts the locate range, and ends Preview when the hook unmounts", async () => {
    vi.useFakeTimers();
    const paths: string[] = [];
    const bodies: unknown[] = [];
    stubPreview({ bodies, paths });

    const { unmount } = renderHook(() =>
      useLiveLocate({
        enabled: true,
        lightId: "light-1",
        ledCount: 60,
        frame,
        brightness: 180,
        onDetail: () => undefined,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(paths.some((path) => path === "/api/lights/light-1/preview")).toBe(true);
    expect(bodies[0]).toMatchObject({ start: 4, stop: 5, color: "#fff4dc", brightness: 180 });

    await finish(unmount);
    expect(paths.some((path) => path === "/api/lights/light-1/preview/end")).toBe(true);
  });

  it("drops superseded frames while a hop is in flight — only the latest posts", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let previewPosts = 0;
    stubPreview({
      bodies,
      gate: async () => {
        previewPosts += 1;
        if (previewPosts === 1) await gate;
      },
    });

    const { rerender, unmount } = renderHook(
      ({ next }: { next: LocateFrame }) =>
        useLiveLocate({
          enabled: true,
          lightId: "light-1",
          ledCount: 60,
          frame: next,
          brightness: 180,
          moving: true,
          onDetail: () => undefined,
        }),
      { initialProps: { next: led(1) } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ start: 1, stop: 2 });

    rerender({ next: led(2) });
    rerender({ next: led(3) });
    rerender({ next: led(7) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_MOVE_MS);
    });
    expect(bodies).toHaveLength(1);

    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ start: 7, stop: 8, color: "#fff4dc" });
    await finish(unmount);
  });

  it("skips POST when the payload equals the last sent hop", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    stubPreview({ bodies });

    const { rerender, unmount } = renderHook(
      ({ next }: { next: LocateFrame }) =>
        useLiveLocate({
          enabled: true,
          lightId: "light-1",
          ledCount: 60,
          frame: next,
          brightness: 180,
          onDetail: () => undefined,
        }),
      { initialProps: { next: led(4, "Lighting LED 4 on Porch") } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(1);

    rerender({ next: led(4, "Lighting LED 4 on Eave") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(1);

    rerender({ next: led(5) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ start: 5, stop: 6 });
    await finish(unmount);
  });

  it("does not refresh LightDetail on every hop — caption may still change locally", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    stubPreview({ bodies });
    const details: LightDetail[] = [];

    const { rerender, unmount } = renderHook(
      ({ next }: { next: LocateFrame }) =>
        useLiveLocate({
          enabled: true,
          lightId: "light-1",
          ledCount: 60,
          frame: next,
          brightness: 180,
          onDetail: (nextDetail) => {
            details.push(nextDetail);
          },
        }),
      { initialProps: { next: led(1) } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(1);
    expect(details).toHaveLength(1);

    rerender({ next: led(2) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(2);
    expect(details).toHaveLength(1);

    await finish(unmount);
    expect(details).toHaveLength(2);
  });

  it("uses the longer settle while hover hops keep arriving", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    stubPreview({ bodies });

    const { rerender, unmount } = renderHook(
      ({ next }: { next: LocateFrame }) =>
        useLiveLocate({
          enabled: true,
          lightId: "light-1",
          ledCount: 60,
          frame: next,
          brightness: 180,
          moving: true,
          onDetail: () => undefined,
        }),
      { initialProps: { next: led(1) } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    rerender({ next: led(2) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_MOVE_MS);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ start: 2, stop: 3 });
    await finish(unmount);
  });

  it("hold sweep across one Element posts the same spans once", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    stubPreview({ bodies });

    const { rerender, unmount } = renderHook(
      ({ next }: { next: LocateFrame }) =>
        useLiveLocate({
          enabled: true,
          lightId: "light-1",
          ledCount: 20,
          frame: next,
          brightness: 180,
          moving: true,
          onDetail: () => undefined,
        }),
      { initialProps: { next: locateHold(1) } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_HOLD_MS);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({
      spans: [
        { start: 0, stop: 8, color: "#d4a574" },
        { start: 10, stop: 14, color: "#7ee0d0" },
      ],
      brightness: 180,
    });

    rerender({ next: locateHold(4) });
    rerender({ next: locateHold(7) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_MOVE_MS);
    });
    expect(bodies).toHaveLength(1);

    rerender({ next: locateHold(9) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_MOVE_MS);
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual({
      spans: [
        { start: 0, stop: 8, color: "#d4a574" },
        { start: 10, stop: 14, color: "#7ee0d0" },
        { start: 9, stop: 10, color: "#fff4dc" },
      ],
      brightness: 180,
    });
    await finish(unmount);
  });
});
