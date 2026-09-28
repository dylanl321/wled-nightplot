import {
  APPLY_ADOPT_EMPTY_REASON,
  APPLY_ADOPT_UNKNOWN_REASON,
  APPLY_EMPTY_READ_CAPTION,
  APPLY_UNKNOWN_SEGMENTS_MESSAGE,
  APPLY_UNREAD_CAPTION,
  FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION,
  PHYSICAL_LENGTH_CAPTION,
  applyOutcome,
  applyUnknownSegments,
  applyUnreadFailed,
  type ApplyResult,
  type LightDetail as LightDetailPayload,
} from "@nightplot/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightDetail } from "@/components/light-detail";
import {
  isLightsListPath,
  isOneLightProbe,
  lightDetail,
  lightView,
  requestPath,
} from "@/test/fixtures";

describe("Segments Preview recovery", () => {
  it("uses the existing Preview sender for the phone remote and ends it on return", async () => {
    const initial = lightDetail({ light: lightView({ reachability: "online", on: true, brightness: 180 }) });
    const writes: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (init?.method === "POST") writes.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(initial));
    }));

    render(<LightDetail initial={initial} tab="elements" />);
    fireEvent.click(screen.getByRole("button", { name: "Phone remote" }));
    const remote = screen.getByRole("dialog", { name: "Garage phone remote" });
    fireEvent.click(within(remote).getByRole("button", { name: "Next LED" }));
    fireEvent.click(within(remote).getByRole("button", { name: "Start Preview" }));
    await waitFor(() => expect(writes.some((write) => write.path.endsWith("/preview") &&
      (write.body as { start?: number }).start === 1)).toBe(true));
    fireEvent.click(within(remote).getByRole("button", { name: "Next LED" }));
    await waitFor(() => expect(writes.some((write) => write.path.endsWith("/preview") &&
      (write.body as { start?: number }).start === 2)).toBe(true));

    fireEvent.click(within(remote).getByRole("button", { name: "End Preview & return" }));
    expect(screen.queryByRole("dialog", { name: "Garage phone remote" })).toBeNull();
    await waitFor(() => expect(writes.filter((write) => write.path.endsWith("/preview/end"))).toHaveLength(1));
    expect(writes.every((write) => !write.path.endsWith("/apply"))).toBe(true);
  });

  it("waits for an in-flight remote hop before ending Preview on return", async () => {
    const initial = lightDetail({ light: lightView({ reachability: "online", on: true, brightness: 180 }) });
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => { release = resolve; });
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      paths.push(path);
      if (path.endsWith("/preview")) await inFlight;
      return new Response(JSON.stringify(initial));
    }));

    render(<LightDetail initial={initial} tab="elements" />);
    fireEvent.click(screen.getByRole("button", { name: "Phone remote" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start Preview" }));
    await waitFor(() => expect(paths.some((path) => path.endsWith("/preview"))).toBe(true));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "End Preview & return" }));
    expect(paths.filter((path) => path.endsWith("/preview/end"))).toHaveLength(0);
    await act(async () => { release(); await inFlight; });
    await waitFor(() => expect(paths.filter((path) => path.endsWith("/preview/end"))).toHaveLength(1));
  });

  it("offers recovery before Preview and only clears after confirmation, leaving Preview off", async () => {
    const initial = { ...initialDetail(), frozenPreview: true };
    const writes: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (init?.method === "POST") writes.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(path.endsWith("/preview/recover") ? {
        ...initial, frozenPreview: false,
        recovery: { cleared: true, wrote: true, restored: false, message: "Frozen LEDs cleared. Saved Segments are unchanged. Preview is off." },
      } : initial));
    }));
    render(<LightDetail initial={initial} tab="elements" />);
    expect(screen.getByText(`Hostname: ${initial.light.hostname}`)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Light on strip" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Recover Preview…" }));
    expect(screen.getByText(/Clearing these LEDs discards/)).toBeTruthy();
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Recover Preview…" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear frozen LEDs" }));
    await screen.findByText("Frozen LEDs cleared. Saved Segments are unchanged. Preview is off.");
    expect(writes).toEqual([{ path: `/api/lights/${initial.light.id}/preview/recover`, body: { discardFrozenPixels: true } }]);
    expect(screen.queryByRole("region", { name: "Preview recovery" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Light on strip" });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it.each([
    { status: 422, body: { error: "recovery-unconfirmed", message: "Clearing frozen LEDs was not confirmed. Refresh before retrying." } },
    { status: 200, body: {} },
  ])("keeps Preview blocked when recovery is unconfirmed ($status)", async ({ status, body }) => {
    const initial = { ...initialDetail(), frozenPreview: true };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(requestPath(String(input)).endsWith("/preview/recover") ? body : initial),
      { status: requestPath(String(input)).endsWith("/preview/recover") ? status : 200 },
    )));
    render(<LightDetail initial={initial} tab="elements" />);
    fireEvent.click(screen.getByRole("button", { name: "Recover Preview…" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear frozen LEDs" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not confirmed");
    expect((screen.getByRole("button", { name: "Light on strip" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Recover Preview…" })).toBeTruthy();
  });

  it("surfaces a frozen-controller refusal without claiming an uncertain write", async () => {
    const initial = initialDetail();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (requestPath(String(input)).endsWith("/preview")) return new Response(JSON.stringify({
        error: "pixel-preview-frozen", sent: false,
        message: "The controller is holding frozen LEDs. Nightplot has no snapshot of their original colours to restore. Nothing was sent.",
      }), { status: 422 });
      return new Response(JSON.stringify(initial));
    }));
    render(<LightDetail initial={initial} tab="elements" />);
    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was sent.");
    expect(screen.getByRole("alert").textContent).not.toContain("last write is not confirmed");
    expect(screen.queryByText("Preview not confirmed")).toBeNull();
    expect(screen.getByText("Preview paused", { exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry Preview" })).toBeTruthy();
  });

  function initialDetail() {
    return lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 180,
        bead: "#ffa000",
        segmentCount: 1,
      }),
    });
  }

  it("dims the background live while preserving cursor and overall brightness", async () => {
    const initial = initialDetail();
    const bodies: { pixels: boolean; brightness: number; spans: { start: number; stop: number; color: string }[] }[] = [];
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      paths.push(path);
      if (path.endsWith("/preview")) bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(initial), { status: 200 });
    }));
    render(<LightDetail initial={initial} tab="elements" />);
    const cursor = screen.getByRole("textbox", { name: "Cursor LED" });
    fireEvent.change(cursor, { target: { value: "4" } });
    fireEvent.blur(cursor);
    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));
    fireEvent.click(screen.getByRole("button", { name: /Segments 35%/ }));
    const slider = screen.getByRole("slider", { name: "Segment brightness" });
    expect((slider as HTMLInputElement).value).toBe("35");
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies.at(-1)).toMatchObject({ pixels: true, brightness: 180 });
    expect(bodies.at(-1)?.spans).toContainEqual({ start: 4, stop: 5, color: "#fff4dc" });
    fireEvent.change(slider, { target: { value: "0" } });
    await waitFor(() => {
      const spans = bodies.at(-1)!.spans;
      expect(spans.filter((span) => span.start !== 4).every((span) => span.color === "#000000")).toBe(true);
    });
    expect(bodies.at(-1)?.spans).toContainEqual({ start: 4, stop: 5, color: "#fff4dc" });
    expect(bodies.at(-1)?.brightness).toBe(180);
    expect(paths.some((path) => path.includes("/apply") || path.includes("/provision"))).toBe(false);
  });

  it("shows a failed Preview, clears its live claim, and offers explicit retry", async () => {
    const initial = initialDetail();
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (path.endsWith("/preview") && ++attempts === 1) {
        return new Response(JSON.stringify({ message: "Controller did not take the temporary look." }), { status: 422 });
      }
      return new Response(JSON.stringify(initial), { status: 200 });
    }));
    render(<LightDetail initial={initial} tab="elements" />);
    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Preview paused");
    expect(screen.getByText("Preview not confirmed")).toBeTruthy();
    expect(screen.queryByText(/Lighting .* on Garage/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry Preview" }));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps Apply disabled after toggling off until End Preview completes", async () => {
    const initial = initialDetail();
    let finishEnd!: () => void;
    const endGate = new Promise<void>((resolve) => { finishEnd = resolve; });
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      paths.push(path);
      if (path.endsWith("/preview/end")) await endGate;
      return new Response(JSON.stringify({ ...initial, restored: true }), { status: 200 });
    }));
    render(<LightDetail initial={initial} tab="elements" />);
    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));
    await waitFor(() => expect(paths.some((path) => path.endsWith("/preview"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));
    expect(screen.getByText("Ending Preview…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finishEnd(); });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(screen.queryByText("Ending Preview…")).toBeNull();
  });
});

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
    expect(await screen.findByText(/On · 50%/)).toBeTruthy();

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
    expect(screen.getByRole("img", { name: "Garage strip, 60 LEDs, RGB" })).toBeTruthy();
  });

  it("shows the calculated strip length and each Segment’s length", () => {
    const initial = lightDetail({
      light: lightView({
        spacingMm: 16.67,
        spacingKind: "pitch",
        reachability: "online",
        on: true,
        brightness: 180,
        bead: "#ffa000",
        segmentCount: 1,
      }),
    });
    render(<LightDetail initial={initial} mode="ranges" />);
    expect(screen.getByText(/60 LEDs · 1 m · WS281x RGB/)).toBeTruthy();
    expect(screen.getByText(PHYSICAL_LENGTH_CAPTION)).toBeTruthy();
    expect(screen.getByText("1 m", { exact: true })).toBeTruthy();
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

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (path === `/api/lights/${initial.light.id}/preview`) {
        return new Response(JSON.stringify(after), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === `/api/lights/${initial.light.id}/preview/end`) {
        return new Response(JSON.stringify({ ...initial, session: null, liveCaption: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LightDetail initial={initial} mode="live" />);
    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));

    expect(await screen.findByText(/Software-green from the fixture/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      const paths = fetchMock.mock.calls.map((call) => requestPath(String(call[0])));
      expect(paths).toContain(`/api/lights/${initial.light.id}/preview/end`);
    });
  });
});

describe("LightDetail info-only segments", () => {
  it("says Segments unknown when segmentCount is missing — not 0 reported", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
        })}
        mode="inspect"
      />,
    );

    expect(screen.getByText(/Segments unknown/)).toBeTruthy();
    expect(screen.queryByText(/0 segments reported/)).toBeNull();
  });

  it("does not treat unknown segments as empty rails when editing ranges", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [],
          display: {
            declared: [
              {
                id: "el-door",
                label: "Door",
                start: 0,
                stop: 60,
                length: 60,
                differs: false,
                error: false,
              },
            ],
            reported: [],
            regions: [],
            notes: [{ text: "Segments unknown — no report to compare." }],
          },
        })}
        mode="ranges"
      />,
    );

    expect(screen.getByText("Segments unknown — no report to compare.")).toBeTruthy();
    expect(screen.queryByText(/not on the controller/)).toBeNull();
    expect(screen.queryByText("Declared ranges match the last save")).toBeNull();
    const row = screen.getByRole("button", { name: /Door 0–60/ });
    expect(row.textContent).toMatch(/ok/);
    expect(row.textContent).not.toMatch(/matches/i);
    const apply = screen.getByRole("button", { name: "Apply" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/leftover segments can be cleared/)).toBeTruthy();
  });

  it("still compares a known empty seg list as empty when editing ranges", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 0,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [],
          display: {
            declared: [
              {
                id: "el-door",
                label: "Door",
                start: 0,
                stop: 60,
                length: 60,
                differs: true,
                error: false,
              },
            ],
            reported: [],
            regions: [{ kind: "drift", start: 0, stop: 60 }],
            notes: [{ text: "Door is not on the controller" }],
          },
        })}
        mode="ranges"
      />,
    );

    expect(screen.getByText("Door is 0–60 here. The controller has nothing there.")).toBeTruthy();
    expect(screen.queryByText("Segments unknown — no report to compare.")).toBeNull();
    const row = screen.getByRole("button", { name: /Door 0–60/ });
    expect(row.textContent).toMatch(/ok/);
    expect(row.textContent).not.toMatch(/matches/i);
    expect(screen.getByText(/doesn’t match this page/)).toBeTruthy();
  });

  it("still says matches on Edit ranges when a known report compares equal", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 1,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [{ start: 0, stop: 60, differs: false }],
          display: {
            declared: [
              {
                id: "el-door",
                label: "Door",
                start: 0,
                stop: 60,
                length: 60,
                differs: false,
                error: false,
              },
            ],
            reported: [{ start: 0, stop: 60, differs: false }],
            regions: [],
            notes: [],
          },
        })}
        mode="ranges"
      />,
    );

    const row = screen.getByRole("button", { name: /Door 0–60/ });
    expect(row.textContent).toMatch(/ok/);
    expect(row.textContent).not.toMatch(/matches/i);
    expect(screen.queryByText(/not on the controller/)).toBeNull();
  });

  it("still names a known empty segment list on Inspect", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 0,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
        })}
        mode="inspect"
      />,
    );

    expect(screen.getByText(/0 segments reported/)).toBeTruthy();
    expect(screen.queryByText(/Segments unknown/)).toBeNull();
  });
});

describe("LightDetail info-only power", () => {
  it("does not say Online · off when on is missing — unknown-grey, not null-as-off", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
        })}
        mode="ranges"
      />,
    );

    expect(screen.getByText("Power unknown")).toBeTruthy();
    expect(screen.queryByText("Online · off")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByText("Answering. Off.")).toBeNull();
    const strip = screen.getByRole("img", { name: "Garage strip, 60 LEDs, RGB" });
    expect(strip.innerHTML).not.toContain("#ffa000");
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(strip.innerHTML).not.toContain("#141519");
  });

  it("still names known off on Inspect", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: false,
            brightness: 0,
            bead: null,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
        })}
        mode="ranges"
      />,
    );

    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.queryByText("Power unknown")).toBeNull();
    const strip = screen.getByRole("img", { name: "Garage strip, 60 LEDs, RGB" });
    expect(strip.innerHTML).toContain("#141519");
    expect(strip.innerHTML).not.toContain("#1d1d1f");
  });
});

describe("LightDetail RGBW honesty", () => {
  it("names the driver chip — not WS281x RGBW from snapshot.rgbw", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            rgbw: true,
            stripKind: "ws281x",
            stripBead: "rgb",
            stripChip: "WS281x RGB",
          }),
        })}
        mode="ranges"
      />,
    );

    expect(screen.getByText(/WS281x RGB/)).toBeTruthy();
    expect(screen.queryByText("WS281x RGBW")).toBeNull();
  });

  it("grows a second die for SK6812 RGBW", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            name: "Porch",
            reachability: "online",
            on: true,
            brightness: 180,
            bead: "#ffa000",
            rgbw: true,
            stripKind: "sk6812-rgbw",
            stripBead: "rgbw",
            stripChip: "SK6812 RGBW",
          }),
        })}
        mode="ranges"
      />,
    );

    expect(screen.getByText(/60 LEDs · SK6812 RGBW/)).toBeTruthy();
    const lit = screen.getByRole("img", { name: "Porch strip, 60 LEDs, RGBW" });
    expect(lit.innerHTML).toContain("#fff4dc");
    expect(lit.innerHTML).toContain("#ffa000");
  });

  it("keeps unreachable RGBW beads grey — never the last colour", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            name: "Porch",
            reachability: "no-answer",
            on: null,
            brightness: null,
            bead: "unknown",
            rgbw: true,
            stripKind: "sk6812-rgbw",
            stripBead: "rgbw",
            stripChip: "SK6812 RGBW",
          }),
        })}
        mode="ranges"
      />,
    );

    const grey = screen.getByRole("img", { name: "Porch strip, 60 LEDs, RGBW" });
    expect(grey.innerHTML).not.toContain("#ffa000");
    expect(grey.innerHTML).not.toContain("#fff4dc");
    expect(grey.innerHTML).toContain("#141519");
    expect(screen.getByText(/Beads stay grey/)).toBeTruthy();
    expect(screen.getByText(/SK6812 RGBW/)).toBeTruthy();
  });
});

describe("LightDetail Apply unknown colour", () => {
  it("disables Apply when colour is unknown — does not invent #ffa000", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: 1,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
        })}
        mode="ranges"
      />,
    );

    const apply = screen.getByRole("button", { name: "Apply" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(apply.getAttribute("title")).toMatch(/will not invent a look/);
    expect(screen.getByText(/Colour is unknown/)).toBeTruthy();
  });

  it("keeps Apply available when the snapshot named a colour", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#4f7dff",
            segmentCount: 1,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
        })}
        mode="ranges"
      />,
    );

    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText(/Colour is unknown/)).toBeNull();
  });

  it("refuses Apply as soon as Light on strip is on — does not wait for the first hop", () => {
    const initial = lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#4f7dff",
        segmentCount: 1,
      }),
      snapshotAt: "2026-09-26T20:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(String(input));
        if (path === `/api/lights/${initial.light.id}/preview/end`) {
          return new Response(JSON.stringify({ ...initial, session: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        await new Promise(() => undefined);
        return new Response(JSON.stringify(initial), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    render(
      <LightDetail
        initial={initial}
        mode="ranges"
      />,
    );

    const apply = screen.getByRole("button", { name: "Apply" });
    expect((apply as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));

    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/End the Preview first\. Preview is not Apply/)).toBeTruthy();
  });

  it("captions first locate when restore segment count is unknown — not leftover-clear success", async () => {
    const initial = lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#4f7dff",
        segmentCount: null,
        lastSeenAt: "2026-09-26T20:00:00.000Z",
      }),
      snapshotAt: "2026-09-26T20:00:00.000Z",
      display: {
        declared: [
          {
            id: "el-door",
            label: "Door",
            start: 0,
            stop: 60,
            length: 60,
            differs: false,
            error: false,
          },
        ],
        reported: [],
        regions: [],
        notes: [{ text: "Segments unknown — no report to compare." }],
      },
    });
    const after: LightDetailPayload = {
      ...initial,
      session: {
        id: "sess-preview",
        kind: "preview",
        lightId: initial.light.id,
        target: { elementId: null, label: "4–5", start: 4, stop: 5 },
        color: "#fff4dc",
        brightness: 180,
        startedAt: "2026-09-26T20:00:00.000Z",
        restore: {
          on: true,
          brightness: 128,
          color: "#4f7dff",
          segments: null,
        },
        source: "fixture",
        seenByYou: null,
        leftoverClears: "unknown",
      },
      liveCaption: `Software-green from the fixture. Not Hardware Done. ${FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION}`,
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
        if (path === `/api/lights/${initial.light.id}`) {
          return new Response(JSON.stringify(after), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (path === `/api/lights/${initial.light.id}/preview/end`) {
          return new Response(JSON.stringify({ ...initial, session: null, liveCaption: null }), {
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
    render(<LightDetail initial={initial} mode="ranges" />);

    fireEvent.click(screen.getByRole("button", { name: "Light on strip" }));

    expect(await screen.findByText(FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION, { exact: false })).toBeTruthy();
    expect(screen.getByText(/Leftover controller segments were not cleared/)).toBeTruthy();
    expect(screen.getByText(/Not treating leftover lights as this locate/)).toBeTruthy();
    expect(screen.queryByText(/Applied/)).toBeNull();
    expect(screen.queryByText(/controller reported this/)).toBeNull();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION, { exact: false })).toBeTruthy();
    expect(screen.getByText(/Leftover controller segments were not cleared/)).toBeTruthy();
    expect(screen.getByText(/Not treating leftover lights as this locate/)).toBeTruthy();
    expect(screen.queryByText(/Applied/)).toBeNull();
    expect(screen.queryByText(/^Software-green from the fixture\. Not Hardware Done\.$/)).toBeNull();
  });
});

describe("LightDetail Segments after length change", () => {
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
    expect(selectedKindChip().textContent).toBe("past strip");
    expect(screen.getByText(/Runs past the strip end at 30 \(past strip\)/)).toBeTruthy();
    expect(screen.getAllByText(/runs past the strip \(30 LEDs\)/).length).toBeGreaterThan(0);
    dirtyLabel();
    expectSaveRefused();
  });
});

describe("LightDetail selected Segment kind chip", () => {
  it("says no compare when segments are unknown — not seg", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [],
          display: {
            declared: [
              {
                id: "el-door",
                label: "Door",
                start: 0,
                stop: 60,
                length: 60,
                differs: false,
                error: false,
              },
            ],
            reported: [],
            regions: [],
            notes: [{ text: "Segments unknown — no report to compare." }],
          },
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("ok");
    expect(screen.getByText("Segments unknown — no report to compare.")).toBeTruthy();
    expect(screen.queryByText("overlap")).toBeNull();
    expect(screen.queryByText("seg")).toBeNull();
  });

  it("disables Light on strip when the Light has not answered", () => {
    render(<LightDetail initial={lightDetail()} mode="ranges" />);

    const show = screen.getByRole("button", { name: "Light on strip" });
    expect((show as HTMLButtonElement).disabled).toBe(true);
    expect(show.getAttribute("title")).toMatch(/hasn’t answered/);
    expect(screen.getAllByText(/hasn’t answered/).length).toBeGreaterThan(0);
    expect(selectedKindChip().textContent).toBe("ok");
    expect(screen.queryByText("overlap")).toBeNull();
    expect(screen.queryByText("seg")).toBeNull();
  });

  it("still says overlap when ranges overlap and compare is refused", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
            elementCount: 2,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          elements: [
            { id: "el-door", lightId: "light-garage", label: "Door", start: 0, stop: 40 },
            { id: "el-eave", lightId: "light-garage", label: "Eave", start: 20, stop: 60 },
          ],
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("overlap");
    expect(screen.getByText(/Overlaps another Segment \(overlap\)/)).toBeTruthy();
    expect(screen.getByText(/overlaps Eave/)).toBeTruthy();
    dirtyLabel();
    expectSaveRefused();
  });

  it("says invert when the selected range is inverted — not overlap", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          elements: [{ id: "el-door", lightId: "light-garage", label: "Door", start: 40, stop: 20 }],
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("invert");
    expect(screen.getByText(/Stop must be after Start \(invert\)/)).toBeTruthy();
    expect(screen.getAllByText(/is inverted/).length).toBeGreaterThan(0);
    expect(screen.queryByText("overlap")).toBeNull();
    dirtyLabel();
    expectSaveRefused();
  });

  it("names past strip when an inverted range starts past the strip", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
            ledCount: 60,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          elements: [{ id: "el-door", lightId: "light-garage", label: "Door", start: 80, stop: 40 }],
        })}
        mode="ranges"
      />,
    );

    expect(screen.getAllByText(/is inverted/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/80–40 runs past the strip \(60 LEDs\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Door 80–40 runs past the strip \(60 LEDs\)/)).toBeTruthy();
  });

  it("says past strip when the selected range runs past the strip — not overlap", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
            ledCount: 60,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          elements: [{ id: "el-door", lightId: "light-garage", label: "Door", start: 0, stop: 80 }],
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("past strip");
    expect(screen.getByText(/Runs past the strip end at 60 \(past strip\)/)).toBeTruthy();
    expect(screen.getAllByText(/runs past the strip \(60 LEDs\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText("overlap")).toBeNull();
    dirtyLabel();
    expectSaveRefused();
  });

  it("still says drift when a known report differs", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 0,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [],
          display: {
            declared: [
              {
                id: "el-door",
                label: "Door",
                start: 0,
                stop: 60,
                length: 60,
                differs: true,
                error: false,
              },
            ],
            reported: [],
            regions: [{ kind: "drift", start: 0, stop: 60 }],
            notes: [{ text: "Door is not on the controller" }],
          },
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("ok");
    expect(screen.getByText("Door is 0–60 here. The controller has nothing there.")).toBeTruthy();
    expect(screen.getByText(/doesn’t match this page/)).toBeTruthy();
    expect(screen.queryByText("overlap")).toBeNull();
  });

  it("still says seg when a known report matches", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 1,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [{ start: 0, stop: 60, differs: false }],
          display: {
            declared: [
              {
                id: "el-door",
                label: "Door",
                start: 0,
                stop: 60,
                length: 60,
                differs: false,
                error: false,
              },
            ],
            reported: [{ start: 0, stop: 60, differs: false }],
            regions: [],
            notes: [],
          },
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("ok");
    expect(screen.queryByText(/not on the controller/)).toBeNull();
    expect(screen.queryByText("overlap")).toBeNull();
  });
});

describe("LightDetail bead legend", () => {
  it("hides the dashed drift key when compare is refused", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
            lastSeenAt: "2026-09-26T18:00:00.000Z",
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [],
        })}
        mode="ranges"
      />,
    );

    expect(screen.queryByText(/not on the controller/)).toBeNull();
    expect(screen.queryByText("overlap")).toBeNull();
  });

  it("hides the dashed drift key when no Segment differs", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 1,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [{ start: 0, stop: 60, differs: false }],
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("ok");
    expect(screen.queryByText(/not on the controller/)).toBeNull();
  });

  it("shows the dashed drift key when a known report differs", () => {
    render(
      <LightDetail
        initial={lightDetail({
          light: lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 0,
          }),
          snapshotAt: "2026-09-26T18:00:00.000Z",
          reported: [],
        })}
        mode="ranges"
      />,
    );

    expect(selectedKindChip().textContent).toBe("ok");
    expect(screen.getByText("Door is 0–60 here. The controller has nothing there.")).toBeTruthy();
    expect(screen.getByText(/doesn’t match this page/)).toBeTruthy();
  });
});

describe("LightDetail ApplyFailed copy", () => {
  it("does not title unknown-reread refuse as Apply didn’t stick", async () => {
    const initial = applyRangesDetail();
    const apply = applyUnknownSegments(
      [{ label: "Door", start: 0, stop: 60 }],
      "controller",
    );
    stubApplyResult(initial, apply);

    render(<LightDetail initial={initial} mode="ranges" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const title = await screen.findByText(APPLY_UNKNOWN_SEGMENTS_MESSAGE);
    expect(title.tagName).toBe("SPAN");
    expect(title.textContent).not.toMatch(/didn’t stick/);
    expect(screen.queryByText("Apply didn’t stick")).toBeNull();
    expect(screen.queryByText(/Nothing else on the controller changed/)).toBeNull();
    expect(screen.getByText("Your draft is kept.")).toBeTruthy();
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.getByText(APPLY_UNREAD_CAPTION)).toBeTruthy();
    expect(screen.queryByText(/The controller reported these ranges/)).toBeNull();
  });

  it("still titles a known mismatch as Apply didn’t stick", async () => {
    const initial = applyRangesDetail();
    const apply = applyOutcome(
      [{ label: "Door", start: 0, stop: 60 }],
      [{ start: 0, stop: 40 }],
      "controller",
    );
    stubApplyResult(initial, apply);

    render(<LightDetail initial={initial} mode="ranges" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText(/Apply didn’t stick/)).toBeTruthy();
    expect(screen.queryByText(APPLY_UNKNOWN_SEGMENTS_MESSAGE)).toBeNull();
    expect(screen.getByText(/Nothing else on the controller changed/)).toBeTruthy();
    expect(screen.getByText(/The controller reported these ranges/)).toBeTruthy();
    expect(screen.queryByText(APPLY_UNREAD_CAPTION)).toBeNull();
  });

  it("treats write-failed unread apply.read as unknown — not a known empty list", async () => {
    const initial = applyRangesDetail();
    const apply = applyUnreadFailed(
      [{ label: "Door", start: 0, stop: 60 }],
      "The controller did not take the ranges. Nothing else changed.",
      "controller",
    );
    stubApplyResult(initial, apply);

    render(<LightDetail initial={initial} mode="ranges" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(
      await screen.findByText("The controller did not take the ranges. Nothing else changed."),
    ).toBeTruthy();
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.queryByText("nothing")).toBeNull();
    expect(screen.getByText(APPLY_ADOPT_UNKNOWN_REASON)).toBeTruthy();
    expect(screen.queryByText(APPLY_ADOPT_EMPTY_REASON)).toBeNull();
    expect(screen.getByText(APPLY_UNREAD_CAPTION)).toBeTruthy();
    expect(screen.queryByText(/The controller reported these ranges/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Use controller’s" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("treats reread-failed unread apply.read as unknown — not a known empty list", async () => {
    const initial = applyRangesDetail();
    const apply = applyUnreadFailed(
      [{ label: "Door", start: 0, stop: 60 }],
      "Wrote, but could not re-read. Not treating as success.",
      "controller",
    );
    stubApplyResult(initial, apply);

    render(<LightDetail initial={initial} mode="ranges" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(
      await screen.findByText("Wrote, but could not re-read. Not treating as success."),
    ).toBeTruthy();
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.queryByText("nothing")).toBeNull();
    expect(screen.getByText(APPLY_ADOPT_UNKNOWN_REASON)).toBeTruthy();
    expect(screen.queryByText(APPLY_ADOPT_EMPTY_REASON)).toBeNull();
    expect(screen.getByText(APPLY_UNREAD_CAPTION)).toBeTruthy();
    expect(screen.queryByText(/The controller reported these ranges/)).toBeNull();
  });

  it("captions a known empty apply.read as reported no ranges — not these ranges", async () => {
    const initial = applyRangesDetail();
    const apply = applyOutcome(
      [{ label: "Door", start: 0, stop: 60 }],
      [],
      "controller",
    );
    stubApplyResult(initial, apply);

    render(<LightDetail initial={initial} mode="ranges" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText(/Apply didn’t stick/)).toBeTruthy();
    expect(screen.getByText(APPLY_EMPTY_READ_CAPTION)).toBeTruthy();
    expect(APPLY_EMPTY_READ_CAPTION).toMatch(/until you look at the strip/);
    expect(APPLY_EMPTY_READ_CAPTION).not.toMatch(/\bthem\b/);
    expect(screen.queryByText(/until you see them on the strip/)).toBeNull();
    expect(screen.getByText(APPLY_ADOPT_EMPTY_REASON)).toBeTruthy();
    expect(screen.queryByText(/The controller reported these ranges/)).toBeNull();
    expect(screen.queryByText(APPLY_UNREAD_CAPTION)).toBeNull();
    expect(screen.getByText("nothing")).toBeTruthy();
    expect(screen.queryByText("unknown")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Use controller’s" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("LightDetail ApplyFailed adopt", () => {
  it("disables Use controller’s when the reread did not name ranges", async () => {
    const initial = applyRangesDetail();
    const apply = applyUnknownSegments(
      [{ label: "Door", start: 0, stop: 60 }],
      "controller",
    );
    stubApplyResult(initial, apply);

    render(<LightDetail initial={initial} mode="ranges" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText(APPLY_UNKNOWN_SEGMENTS_MESSAGE)).toBeTruthy();
    const adopt = screen.getByRole("button", { name: "Use controller’s" });
    expect((adopt as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(APPLY_ADOPT_UNKNOWN_REASON)).toBeTruthy();
    expect((screen.getByLabelText("Start, first LED, inclusive") as HTMLInputElement).value).toBe(
      "0",
    );
    expect((screen.getByLabelText("Stop, after last LED, exclusive") as HTMLInputElement).value).toBe(
      "60",
    );

    fireEvent.click(adopt);
    expect((screen.getByLabelText("Start, first LED, inclusive") as HTMLInputElement).value).toBe(
      "0",
    );
    expect((screen.getByLabelText("Stop, after last LED, exclusive") as HTMLInputElement).value).toBe(
      "60",
    );
    expect(
      (screen.getByRole("button", { name: "Use controller’s" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("adopts known controller ranges on a mismatch", async () => {
    const initial = applyRangesDetail();
    const apply = applyOutcome(
      [{ label: "Door", start: 0, stop: 60 }],
      [{ start: 0, stop: 40 }],
      "controller",
    );
    stubApplyResult(initial, apply);

    render(<LightDetail initial={initial} mode="ranges" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText(/Apply didn’t stick/)).toBeTruthy();
    const adopt = screen.getByRole("button", { name: "Use controller’s" });
    expect((adopt as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(APPLY_ADOPT_UNKNOWN_REASON)).toBeNull();

    fireEvent.click(adopt);
    expect((screen.getByLabelText("Start, first LED, inclusive") as HTMLInputElement).value).toBe(
      "0",
    );
    expect((screen.getByLabelText("Stop, after last LED, exclusive") as HTMLInputElement).value).toBe(
      "40",
    );
    expect(screen.queryByRole("button", { name: "Use controller’s" })).toBeNull();
  });
});

function selectedKindChip(): HTMLElement {
  return screen.getByLabelText("Segment kind");
}

function dirtyLabel() {
  fireEvent.change(screen.getByLabelText("Segment label"), { target: { value: "Door edited" } });
}

function expectSaveRefused() {
  const save = screen.getByRole("button", { name: "Save" });
  const apply = screen.getByRole("button", { name: "Save & Apply" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  expect((apply as HTMLButtonElement).disabled).toBe(true);
}

function applyRangesDetail(): LightDetailPayload {
  return lightDetail({
    light: lightView({
      reachability: "online",
      on: true,
      brightness: 128,
      bead: "#ffa000",
      segmentCount: 1,
    }),
    snapshotAt: "2026-09-26T20:00:00.000Z",
    reported: [{ start: 0, stop: 60, differs: false }],
    display: {
      declared: [
        {
          id: "el-door",
          label: "Door",
          start: 0,
          stop: 60,
          length: 60,
          differs: false,
          error: false,
        },
      ],
      reported: [{ start: 0, stop: 60, differs: false }],
      regions: [],
      notes: [],
    },
  });
}

function stubApplyResult(initial: LightDetailPayload, apply: ApplyResult): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (path === `/api/lights/${initial.light.id}/apply`) {
        return new Response(
          JSON.stringify({
            ...initial,
            apply,
            message: apply.message,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}
