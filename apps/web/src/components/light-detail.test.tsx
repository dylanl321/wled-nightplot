import {
  APPLY_ADOPT_EMPTY_REASON,
  APPLY_ADOPT_UNKNOWN_REASON,
  APPLY_UNKNOWN_SEGMENTS_MESSAGE,
  applyOutcome,
  applyUnknownSegments,
  applyUnreadFailed,
  type ApplyResult,
  type LightDetail as LightDetailPayload,
} from "@nightplot/shared";
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
    expect(row.textContent).toMatch(/no compare/);
    expect(row.textContent).not.toMatch(/matches/);
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

    expect(screen.getByText("Door is not on the controller")).toBeTruthy();
    expect(screen.queryByText("Segments unknown — no report to compare.")).toBeNull();
    const row = screen.getByRole("button", { name: /Door 0–60/ });
    expect(row.textContent).toMatch(/drift/);
    expect(row.textContent).not.toMatch(/matches/);
    expect(row.textContent).not.toMatch(/no compare/);
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
    expect(row.textContent).toMatch(/matches/);
    expect(row.textContent).not.toMatch(/no compare/);
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
        mode="inspect"
      />,
    );

    expect(screen.getByText("Online · unknown")).toBeTruthy();
    expect(screen.queryByText("Online · off")).toBeNull();
    expect(screen.getByText(/Power unknown/)).toBeTruthy();
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
        mode="inspect"
      />,
    );

    expect(screen.getByText("Online · off")).toBeTruthy();
    expect(screen.getByText("Answering. Off.")).toBeTruthy();
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
        mode="inspect"
      />,
    );

    expect(screen.getByText("WS281x RGB")).toBeTruthy();
    expect(screen.queryByText("WS281x RGBW")).toBeNull();
    expect(screen.getByText(/RGB · above: declared · below: reported/)).toBeTruthy();
    expect(paragraphWith(/60 LEDs \(RGB\) in/)).toBeTruthy();
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
        mode="inspect"
      />,
    );

    expect(screen.getByText("SK6812 RGBW")).toBeTruthy();
    expect(screen.getByText(/RGBW · above: declared · below: reported/)).toBeTruthy();
    expect(paragraphWith(/60 LEDs \(RGBW\) in/)).toBeTruthy();
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
        mode="inspect"
      />,
    );

    const grey = screen.getByRole("img", { name: "Porch strip, 60 LEDs, RGBW" });
    expect(grey.innerHTML).not.toContain("#ffa000");
    expect(grey.innerHTML).not.toContain("#fff4dc");
    expect(grey.innerHTML).toContain("#141519");
    expect(screen.getByText(/Beads stay grey/)).toBeTruthy();
    expect(screen.getByText("SK6812 RGBW")).toBeTruthy();
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

describe("LightDetail selected Element kind chip", () => {
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

    expect(selectedKindChip().textContent).toBe("no compare");
  });

  it("says no compare when the Light is unreachable — not seg", () => {
    render(<LightDetail initial={lightDetail()} mode="ranges" />);

    expect(selectedKindChip().textContent).toBe("no compare");
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

    expect(selectedKindChip().textContent).toBe("drift");
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

    expect(selectedKindChip().textContent).toBe("seg");
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
  return screen.getByLabelText("Element kind");
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

function paragraphWith(pattern: RegExp): HTMLElement {
  return screen.getByText((_, node) => {
    if (node?.tagName !== "P") return false;
    return pattern.test(node.textContent ?? "");
  });
}
