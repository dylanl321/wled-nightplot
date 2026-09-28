"use client";

import type { Element, LightDetail } from "@nightplot/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPath } from "@/test/fixtures";
import { holdSpans, useLiveLocate, type LocateFrame } from "./use-live-locate";

const frame: LocateFrame = { start: 4, stop: 5, color: "#fff4dc", caption: "Lighting LED 4" };

function detail() {
  return { light: { id: "light-1" }, elements: [] } as unknown as LightDetail;
}

describe("holdSpans", () => {
  it("keeps each Element’s colour and punches the LED under the cursor", () => {
    const spans = holdSpans({
      ledCount: 20,
      hoverIndex: 4,
      dragging: false,
      elements: [
        { id: "a", lightId: "light-1", label: "Element 1", start: 0, stop: 8 },
        { id: "b", lightId: "light-1", label: "Element 2", start: 10, stop: 14 },
      ],
      hues: { a: "#d4a574", b: "#7ee0d0" },
    });
    expect(spans).toEqual([
      { start: 0, stop: 4, color: "#d4a574" },
      { start: 4, stop: 5, color: "#fff4dc" },
      { start: 5, stop: 8, color: "#d4a574" },
      { start: 10, stop: 14, color: "#7ee0d0" },
    ]);
  });
});

describe("useLiveLocate", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts the locate range, and ends Preview when the hook unmounts", async () => {
    vi.useFakeTimers();
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(String(input));
        paths.push(path);
        if (path.endsWith("/preview") && init?.method === "POST" && !path.endsWith("/preview/end")) {
          const body = JSON.parse(String(init.body)) as { start: number; stop: number; color: string };
          expect(body).toMatchObject({ start: 4, stop: 5, color: "#fff4dc" });
        }
        return new Response(JSON.stringify(detail()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

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
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(paths.some((path) => path === "/api/lights/light-1/preview")).toBe(true);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(paths.some((path) => path === "/api/lights/light-1/preview/end")).toBe(true);
  });
});
