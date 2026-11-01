import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOKS, DEFAULT_PLAYLIST, LOOK_CAPTION, type Look } from "@nightplot/shared";
import { LooksPage } from "./looks-page";
import { LookView } from "./look-view";
import { PresetFold } from "./preset-fold";
import { segmentWarnings } from "./looks-helpers";
import type { LooksPayload } from "./use-looks";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const window = {
  id: "prop-window", lightId: "porch", lightName: "Porch", label: "Front window", kind: "window" as const,
  elementIds: ["el-1"], sections: [],
  layout: {
    source: "trace" as const, units: "m" as const, pitchM: 0.1, startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 1 }, { id: "c2", x: 1, y: 1 }],
    run: [{ id: "e1", from: "c1", to: "c2", kind: "lit" as const }],
  },
};

function payload(looks: Look[] = DEFAULT_LOOKS): LooksPayload {
  return {
    version: 1, looks, playlists: [DEFAULT_PLAYLIST], schedule: null,
    yard: { lights: [{ id: "porch", name: "Porch" }], props: [window] as unknown as LooksPayload["yard"]["props"], elements: [] },
    caption: LOOK_CAPTION,
  };
}

const lights = [{ id: "porch", name: "Porch", firmware: "0.15.0", lastLookPush: null }];

function stubFetch() {
  const puts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/looks/now")) return new Response(JSON.stringify({ rows: [] }));
    if (url.includes("/api/looks/effects")) return new Response(JSON.stringify({ effects: [], palettes: [], source: "fallback" }));
    if (init?.method === "PUT") { const body = JSON.parse(String(init.body)); puts.push(body); return new Response(JSON.stringify({ ...payload(), ...body })); }
    return new Response("{}");
  }));
  return puts;
}

afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });

describe("Looks page", () => {
  it("shows a card per Look and says nothing has reached a Light never sent to", async () => {
    stubFetch();
    render(<LooksPage initial={payload()} lights={lights} />);
    for (const look of DEFAULT_LOOKS) expect(screen.getByRole("button", { name: `Edit ${look.name}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: /not on the lights · Send/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${DEFAULT_LOOKS[0]!.name}` }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/looks/${DEFAULT_LOOKS[0]!.id}`));
  });

  it("flags a prop that is in no Look", () => {
    stubFetch();
    render(<LooksPage initial={payload(DEFAULT_LOOKS.map((look) => ({ ...look, propIds: [] })))} lights={lights} />);
    expect(screen.getByText("Front window is new.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Front window to Looks…" }));
    expect(screen.getByRole("dialog", { name: "Add to Looks" })).toBeTruthy();
  });
});

describe("Look editor", () => {
  it("turns a prop Off and saves it out of the Look", async () => {
    const puts = stubFetch() as { looks: Look[] }[];
    const look = { ...DEFAULT_LOOKS[0]!, propIds: ["prop-window"] };
    render(<LookView initial={payload([look, ...DEFAULT_LOOKS.slice(1)])} lights={lights} lookId={look.id} startProp={null} />);
    const group = screen.getByRole("group", { name: "Front window in this Look" });
    const off = Array.from(group.querySelectorAll("button")).find((button) => button.textContent === "Off")!;
    fireEvent.click(off);
    expect(off.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 2000 });
    const saved = puts.at(-1)!.looks.find((row) => row.id === look.id)!;
    expect(saved.propIds ?? []).not.toContain("prop-window");
  });
});

describe("Looks follow-ups", () => {
  it("warns when a Look needs more segments than a Light holds", () => {
    const now = [{ lightId: "porch", lightName: "Porch", online: true, previewing: false, on: true, lookId: null, playlistId: null, preset: null, playlist: null, changes: [], lastSentAt: null, maxSegments: 4, segments: { [DEFAULT_LOOKS[0]!.id]: 6, [DEFAULT_LOOKS[1]!.id]: 2 } }];
    const warnings = segmentWarnings(now, DEFAULT_LOOKS);
    expect(warnings).toEqual([expect.objectContaining({ lookId: DEFAULT_LOOKS[0]!.id, need: 6, max: 4, lightName: "Porch" })]);
    expect(segmentWarnings([{ ...now[0]!, maxSegments: null }], DEFAULT_LOOKS)).toEqual([]);
  });

  it("turns on a WLED preset read from one Light on the ticked Lights", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/sync/presets/porch") return new Response(JSON.stringify({ presets: [{ id: 1, name: "Amber", kind: "preset" }, { id: 4, name: "Loop", kind: "playlist" }] }));
      posts.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ kind: "preset", sourceLightId: null, rows: [], message: "2 of 2 report the preset on.", caption: "" }));
    }));
    const two = [...lights, { id: "eave", name: "Eave", firmware: "0.15.0", lastLookPush: null }];
    render(<PresetFold lights={two} />);
    fireEvent.click(screen.getByRole("button", { name: "Read presets" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Preset" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText(/2 of 2 report the preset on/)).toBeTruthy();
    expect(posts).toEqual([{ lightIds: ["porch", "eave"], presetId: 4 }]);
  });

  it("gives a wireframe face its own style", async () => {
    const puts = stubFetch() as { looks: Look[] }[];
    const box = { ...window, id: "prop-box", label: "Well house", kind: "wireframe" as const,
      wireframe: { template: "polygon-prism-box-x", sides: 4, pitchMm: 100, path: null, locks: [], hidden: [], sharedPostRule: "half" } };
    const doc = payload([{ ...DEFAULT_LOOKS[0]!, propIds: ["prop-box"] }]);
    doc.yard.props = [box] as unknown as LooksPayload["yard"]["props"];
    render(<LookView initial={doc} lights={lights} lookId={DEFAULT_LOOKS[0]!.id} startProp="prop-box" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Wireframe part" }), { target: { value: "face.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Give it its own style" }));
    expect(screen.getByRole("heading", { name: "Well house › Face 2" })).toBeTruthy();
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 2000 });
    const saved = puts.at(-1)!.looks[0]!.overrides.find((row) => row.wireframeGroup === "face.1");
    expect(saved).toMatchObject({ propId: "prop-box", sharedPostRule: "half" });
  });
});
