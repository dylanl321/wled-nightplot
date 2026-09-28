"use client";

import type { LightDetail } from "@nightplot/shared";
import { act, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPath } from "@/test/fixtures";
import {
  COUNT_OFF_MAX_LEDS,
  countOffFrame,
  holdMarksCursor,
  holdSpans,
  locateFrame,
  locatePayloadKey,
  LOCATE_INTERVAL_MS,
  LOCATE_BOUNDARY_TIMEOUT_MS,
  LOCATE_HOP_TIMEOUT_MS,
  useLiveLocate,
  type LocateFrame,
} from "./use-live-locate";

describe("count-off Preview", () => {
  it("counts from one across the full strip, including a short final run", () => {
    const picture = countOffFrame(21, "Garage");
    expect(picture).toMatchObject({ pixels: true, start: 0, stop: 21 });
    expect(picture?.spans).toEqual([
      { start: 0, stop: 9, color: "#2c4e49" },
      { start: 9, stop: 10, color: "#fff4dc" },
      { start: 10, stop: 19, color: "#2c4e49" },
      { start: 19, stop: 20, color: "#fff4dc" },
      { start: 20, stop: 21, color: "#2c4e49" },
    ]);
    expect(countOffFrame(9, "Garage")?.spans).toEqual([{ start: 0, stop: 9, color: "#2c4e49" }]);
  });

  it("never silently truncates a pixel Preview past the 512-span cap", () => {
    expect(countOffFrame(COUNT_OFF_MAX_LEDS, "Garage")?.spans).toHaveLength(512);
    expect(countOffFrame(COUNT_OFF_MAX_LEDS + 1, "Garage")).toBeNull();
  });
});

const frame: LocateFrame = { start: 4, stop: 5, color: "#fff4dc", caption: "Lighting LED 4" };

function led(index: number, caption = `Lighting LED ${index}`): LocateFrame {
  return { start: index, stop: index + 1, color: "#fff4dc", caption };
}

function detail() {
  return { light: { id: "light-1" }, elements: [] } as unknown as LightDetail;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function response(status = 200, body: unknown = detail()) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function input(frame = led(1), enabled = true, lightId = "light-1") {
  return { enabled, lightId, ledCount: 60, frame, brightness: 180, onDetail: vi.fn() };
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
      caption: "Segments stay lit",
      spans: [
        { start: 0, stop: 4, color: "#d4a574" },
        { start: 4, stop: 5, color: "#fff4dc" },
      ],
    };
    expect(locatePayloadKey(spans, 180)).not.toBe(locatePayloadKey(led(4), 180));
    expect(locatePayloadKey(led(4), 180)).not.toBe(locatePayloadKey(led(4), 200));
  });
});

const holdElements = [
  { id: "a", lightId: "light-1", label: "Segment 1", start: 0, stop: 8 },
  { id: "b", lightId: "light-1", label: "Segment 2", start: 10, stop: 14 },
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
  it("keeps other LEDs coloured with a bright cursor inside a Segment", () => {
    const parked = holdSpans(holdArgs(null));
    const overElement = holdSpans(holdArgs(4));
    expect(parked).toEqual([
      { start: 0, stop: 8, color: "#d4a574" },
      { start: 10, stop: 14, color: "#7ee0d0" },
    ]);
    expect(overElement).toEqual([
      { start: 0, stop: 4, color: "#d4a574" },
      { start: 5, stop: 8, color: "#d4a574" },
      { start: 10, stop: 14, color: "#7ee0d0" },
      { start: 4, stop: 5, color: "#fff4dc" },
    ]);
    expect(holdMarksCursor(holdArgs(4))).toBe(true);
  });

  it("updates while the cursor moves across the same Segment", () => {
    expect(holdSpans(holdArgs(1))).not.toEqual(holdSpans(holdArgs(7)));
    expect(locatePayloadKey(locateHold(1), 180)).not.toBe(locatePayloadKey(locateHold(7), 180));
  });

  it("dims only the background, including zero and full brightness", () => {
    expect(holdSpans({ ...holdArgs(4), backgroundPercent: 35 })).toEqual([
      { start: 0, stop: 4, color: "#4a3a29" },
      { start: 5, stop: 8, color: "#4a3a29" },
      { start: 10, stop: 14, color: "#2c4e49" },
      { start: 4, stop: 5, color: "#fff4dc" },
    ]);
    const dark = holdSpans({ ...holdArgs(4), backgroundPercent: 0 });
    expect(dark.slice(0, -1).every((span) => span.color === "#000000")).toBe(true);
    expect(dark.at(-1)?.color).toBe("#fff4dc");
    expect(holdSpans({ ...holdArgs(4), backgroundPercent: 100 })).toEqual(holdSpans(holdArgs(4)));
  });

  it("marks a gap LED without splitting the Segments around it", () => {
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
  it("marks the cursor on a Segment as well as in gaps", () => {
    const onElement = locateHold(4);
    const inGap = locateHold(9);
    expect(onElement.caption).toBe("LED 4 is the bright one. Segments stay lit on Porch.");
    expect(onElement.pixels).toBe(true);
    expect(inGap.caption).toBe("LED 9 is the bright one. Segments stay lit on Porch.");
    expect(onElement.start).toBe(0);
    expect(onElement.stop).toBe(14);
    expect(inGap.start).toBe(0);
    expect(inGap.stop).toBe(14);
  });
});

describe("locateFrame cursor-only", () => {
  it("stays a single LED span — no hold Segment table", () => {
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

  it("All Off cancels a pending response and sends no restoring End Preview", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const paths: string[] = [];
    const bodies: unknown[] = [];
    stubPreview({ bodies, paths, gate: () => gate.promise });
    const { unmount } = renderHook(() => useLiveLocate(input()));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(bodies).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new CustomEvent("nightplot:all-off", { detail: { lightIds: ["light-1"] } }));
    });
    await act(async () => { gate.resolve(); await Promise.resolve(); });
    await finish(unmount);
    expect(paths.filter((path) => path.endsWith("/preview/end"))).toEqual([]);
    expect(bodies).toHaveLength(1);
  });

  it("sends immediately and every 50 ms during an uninterrupted sweep, then settles", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    const sentAt: number[] = [];
    stubPreview({ bodies, gate: async () => { sentAt.push(Date.now()); } });
    const started = Date.now();
    const { rerender, unmount } = renderHook((next) => useLiveLocate(next), {
      initialProps: input(led(0)),
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(bodies).toHaveLength(1);
    for (let index = 1; index <= 20; index++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      rerender(input(led(index)));
    }
    expect(bodies).toHaveLength(5); // Updates arrived before movement stopped.
    expect(sentAt.map((time) => time - started)).toEqual([0, 50, 100, 150, 200]);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS); });
    expect(bodies.at(-1)).toMatchObject({ start: 20, stop: 21 });
    expect(bodies).toHaveLength(6);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(bodies).toHaveLength(6);
    await finish(unmount);
  });

  it("keeps the minimum interval when a request finishes before the next deadline", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const bodies: unknown[] = [];
    stubPreview({ bodies, gate: () => bodies.length === 1 ? gate.promise : Promise.resolve() });
    const { rerender, unmount } = renderHook((next) => useLiveLocate(next), {
      initialProps: input(),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender(input(led(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      gate.resolve();
    });
    expect(bodies).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29); });
    expect(bodies).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(bodies).toHaveLength(2);
    await finish(unmount);
  });

  it("cancels an unsent deadline when the cursor returns to the acknowledged position", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    stubPreview({ bodies });
    const { rerender, unmount } = renderHook((next) => useLiveLocate(next), { initialProps: input() });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender(input(led(2)));
    rerender(input(led(1)));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(bodies).toHaveLength(1);
    await finish(unmount);
  });

  it.each(["http", "network", "incomplete"] as const)(
    "pauses after a %s failure and sends only the latest frame on explicit retry",
    async (failure) => {
      vi.useFakeTimers();
      const bodies: unknown[] = [];
      vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
        if (path.endsWith("/preview/end")) return response();
        bodies.push(JSON.parse(String(init.body)));
        if (bodies.length === 1) {
          if (failure === "network") throw new TypeError("Failed to fetch");
          if (failure === "incomplete") return response(200, {});
          return response(422, { message: "Controller did not take the temporary look." });
        }
        return response();
      }));
      const { result, rerender, unmount } = renderHook((next) => useLiveLocate(next), {
        initialProps: input(),
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.error?.kind).toBe("frame");
      rerender(input(led(9)));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(bodies).toHaveLength(1);
      act(() => result.current.retry());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(bodies).toHaveLength(2);
      expect(bodies.at(-1)).toMatchObject({ start: 9 });
      expect(result.current.error).toBeNull();
      await finish(unmount);
    },
  );

  it("does not deduplicate a failed frame when retrying the same position", async () => {
    vi.useFakeTimers();
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path.endsWith("/preview/end")) return response();
      return ++posts === 1 ? response(422, { message: "Write failed." }) : response();
    }));
    const { result, unmount } = renderHook(() => useLiveLocate(input()));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => result.current.retry());
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(posts).toBe(2);
    expect(result.current.error).toBeNull();
    await finish(unmount);
  });

  it("aborts a hung opening request, pauses, and does not automatically replay it", async () => {
    vi.useFakeTimers();
    let posts = 0;
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => {
      if (path.endsWith("/preview/end")) return Promise.resolve(response());
      posts++;
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }));
    const { result, rerender, unmount } = renderHook((next) => useLiveLocate(next), {
      initialProps: input(),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCATE_BOUNDARY_TIMEOUT_MS); });
    expect(aborted).toBe(true);
    expect(result.current.error?.message).toContain("did not respond in time");
    rerender(input(led(12)));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(posts).toBe(1);
    await finish(unmount);
  });

  it("ends once after an in-flight frame before restarting on a rapid off/on toggle", async () => {
    vi.useFakeTimers();
    const frameGate = deferred();
    const endGate = deferred();
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      paths.push(path);
      if (paths.length === 1) await frameGate.promise;
      if (path.endsWith("/preview/end")) await endGate.promise;
      return response();
    }));
    const { result, rerender, unmount } = renderHook((next) => useLiveLocate(next), {
      initialProps: input(),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender(input(led(2), false));
    expect(result.current.stopping).toBe(true);
    rerender(input(led(3), true));
    expect(paths).toEqual(["/api/lights/light-1/preview"]);
    await act(async () => { frameGate.resolve(); });
    expect(paths).toEqual(["/api/lights/light-1/preview", "/api/lights/light-1/preview/end"]);
    await act(async () => {
      endGate.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(paths).toEqual([
      "/api/lights/light-1/preview",
      "/api/lights/light-1/preview/end",
      "/api/lights/light-1/preview",
    ]);
    expect(result.current.stopping).toBe(false);
    await finish(unmount);
  });

  it("uses the shorter timeout for a hung hop after the opening frame succeeds", async () => {
    vi.useFakeTimers();
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => {
      if (path.endsWith("/preview/end") || ++posts === 1) return Promise.resolve(response());
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }));
    const { result, rerender, unmount } = renderHook((next) => useLiveLocate(next), {
      initialProps: input(),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender(input(led(2)));
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS); });
    expect(posts).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCATE_HOP_TIMEOUT_MS - 1); });
    expect(result.current.error).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.error?.kind).toBe("frame");
    await finish(unmount);
  });

  it("cancels a first frame if disabled before its timer runs", async () => {
    vi.useFakeTimers();
    const paths: string[] = [];
    stubPreview({ paths, bodies: [] });
    const { rerender, unmount } = renderHook((next) => useLiveLocate(next), { initialProps: input() });
    rerender(input(led(1), false));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(paths).toEqual([]);
    await finish(unmount);
  });

  it("waits for an in-flight frame before a single unmount cleanup and ignores its result", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const paths: string[] = [];
    const onDetail = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      paths.push(path);
      if (path.endsWith("/preview")) await gate.promise;
      return response();
    }));
    const { unmount } = renderHook(() => useLiveLocate({ ...input(), onDetail }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    expect(paths).toEqual(["/api/lights/light-1/preview"]);
    await act(async () => { gate.resolve(); });
    expect(paths).toEqual(["/api/lights/light-1/preview", "/api/lights/light-1/preview/end"]);
    expect(onDetail).not.toHaveBeenCalled();
  });

  it("finishes an old Light without applying its delayed response to a new Light", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const paths: string[] = [];
    const onOld = vi.fn();
    const onNew = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      paths.push(path);
      if (path === "/api/lights/light-1/preview") await gate.promise;
      return response();
    }));
    const { rerender, unmount } = renderHook((next) => useLiveLocate(next), {
      initialProps: { ...input(), onDetail: onOld },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender({ ...input(led(5), true, "light-2"), onDetail: onNew });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(onNew).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); });
    expect(onOld).not.toHaveBeenCalled();
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(paths.filter((path) => path === "/api/lights/light-1/preview/end")).toHaveLength(1);
    await finish(unmount);
  });

  it("does not reopen automatically if End Preview cannot restore the previous look", async () => {
    vi.useFakeTimers();
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      paths.push(path);
      return response(200, path.endsWith("/preview/end") ? { ...detail(), restored: false } : detail());
    }));
    const { result, rerender, unmount } = renderHook((next) => useLiveLocate(next), {
      initialProps: input(),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender(input(led(1), false));
    rerender(input(led(2), true));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.error?.kind).toBe("end");
    expect(result.current.stopping).toBe(false);
    expect(paths.filter((path) => path.endsWith("/preview"))).toHaveLength(1);
    await finish(unmount);
  });

  it("does not send an abandoned opening request during Strict Mode effect replay", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    stubPreview({ bodies });
    const { unmount } = renderHook(() => useLiveLocate(input()), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(bodies).toHaveLength(1);
    await finish(unmount);
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
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
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
          onDetail: () => undefined,
        }),
      { initialProps: { next: led(1) } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ start: 1, stop: 2 });

    rerender({ next: led(2) });
    rerender({ next: led(3) });
    rerender({ next: led(7) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(1);

    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
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
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(1);

    rerender({ next: led(4, "Lighting LED 4 on Eave") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(1);

    rerender({ next: led(5) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
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
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(1);
    expect(details).toHaveLength(1);

    rerender({ next: led(2) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(2);
    expect(details).toHaveLength(1);

    await finish(unmount);
    expect(details).toHaveLength(1);
  });

  it("hold sweep updates the bright cursor with latest-only pixel frames", async () => {
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
          onDetail: () => undefined,
        }),
      { initialProps: { next: locateHold(1) } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({
      spans: [
        { start: 0, stop: 1, color: "#d4a574" },
        { start: 2, stop: 8, color: "#d4a574" },
        { start: 10, stop: 14, color: "#7ee0d0" },
        { start: 1, stop: 2, color: "#fff4dc" },
      ],
      brightness: 180,
      pixels: true,
    });

    rerender({ next: locateHold(4) });
    rerender({ next: locateHold(7) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({
      pixels: true,
      spans: [
        { start: 0, stop: 7, color: "#d4a574" },
        { start: 10, stop: 14, color: "#7ee0d0" },
        { start: 7, stop: 8, color: "#fff4dc" },
      ],
    });

    rerender({ next: locateHold(9) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCATE_INTERVAL_MS);
    });
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toEqual({
      spans: [
        { start: 0, stop: 8, color: "#d4a574" },
        { start: 10, stop: 14, color: "#7ee0d0" },
        { start: 9, stop: 10, color: "#fff4dc" },
      ],
      brightness: 180,
      pixels: true,
    });
    await finish(unmount);
  });
});
