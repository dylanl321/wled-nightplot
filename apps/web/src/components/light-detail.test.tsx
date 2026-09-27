import type { LightDetail as LightDetailPayload } from "@nightplot/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightDetail } from "@/components/light-detail";
import {
  isLightsListPath,
  isOneLightProbe,
  lightDetail,
  lightView,
  requestPath,
} from "@/test/fixtures";

describe("LightDetail Refresh", () => {
  it("Refresh probes this Light only — never the enrolled list", async () => {
    const initial = lightDetail();
    const next = lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#7ee0d0",
      }),
      snapshotAt: "2026-09-26T20:00:00.000Z",
    });

    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (isOneLightProbe(path, initial.light.id)) {
        return new Response(JSON.stringify(next), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<LightDetail initial={initial} mode="inspect" />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Online")).toBeTruthy();

    const paths = fetch.mock.calls.map((call) => requestPath(String(call[0])));
    expect(paths.some((path) => isOneLightProbe(path, initial.light.id))).toBe(true);
    expect(paths.some(isLightsListPath)).toBe(false);
  });
});

describe("LightDetail reported rails", () => {
  it("does not crash when Preview match counts land on reported", () => {
    const initial = {
      ...lightDetail({
        light: lightView({
          reachability: "online",
          on: true,
          brightness: 180,
          bead: "#ffa000",
          segmentCount: 1,
        }),
      }),
      reported: { matched: 26, total: 26 },
    } as unknown as LightDetailPayload;

    expect(() => render(<LightDetail initial={initial} mode="ranges" />)).not.toThrow();
    expect(screen.getByText(/above: declared · below: reported/)).toBeTruthy();
  });

  it("keeps mapping reported rails after a successful Preview", async () => {
    const initial = lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 180,
        bead: "#ffa000",
        segmentCount: 1,
      }),
      reported: [{ start: 0, stop: 60, differs: false }],
    });
    const after: LightDetailPayload = {
      ...initial,
      session: {
        id: "sess-preview",
        kind: "preview",
        lightId: initial.light.id,
        target: { elementId: "el-door", label: "Door", start: 0, stop: 60 },
        color: "#4f7dff",
        brightness: 180,
        startedAt: "2026-09-26T20:00:00.000Z",
        restore: {
          on: true,
          brightness: 180,
          color: "#ffa000",
          segments: [{ start: 0, stop: 60, color: "#ffa000" }],
        },
        source: "fixture",
        seenByYou: null,
      },
      liveLeds: Array.from({ length: 60 }, () => "#4f7dff"),
      liveCaption: "Software-green from the fixture. Not Hardware Done.",
      liveMatch: { matched: 60, total: 60 },
      reported: [{ start: 0, stop: 60, differs: false }],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(String(input));
        if (path === `/api/lights/${initial.light.id}/preview`) {
          return new Response(JSON.stringify(after), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    render(<LightDetail initial={initial} mode="live" />);
    fireEvent.click(screen.getByRole("button", { name: /Preview on Door/ }));

    expect(await screen.findByText(/Preview live on/)).toBeTruthy();
    expect(screen.getByText(/Controller reports 60 \/ 60 in Door/)).toBeTruthy();
  });
});

describe("LightDetail Elements after length change", () => {
  it("does not claim declared ranges still match when they run past the strip", () => {
    const initial = lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#ffa000",
        ledCount: 30,
        elementCount: 1,
        driftLabel: "Door 0–60 runs past the strip (30 LEDs).",
      }),
      elements: [{ id: "el-door", lightId: "light-garage", label: "Door", start: 0, stop: 60 }],
      reported: [{ start: 0, stop: 30, differs: true }],
      display: {
        declared: [
          {
            id: "el-door",
            label: "Door",
            start: 0,
            stop: 60,
            length: 60,
            differs: true,
            error: true,
          },
        ],
        reported: [{ start: 0, stop: 30, differs: true }],
        regions: [],
        notes: [{ text: "Door 0–60 runs past the strip (30 LEDs)." }],
      },
    });

    render(<LightDetail initial={initial} mode="ranges" />);

    expect(screen.queryByText("Declared ranges match the last save")).toBeNull();
    expect(screen.getAllByText(/Door 0–60 runs past the strip \(30 LEDs\)/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("past strip")).toBeTruthy();
  });
});
