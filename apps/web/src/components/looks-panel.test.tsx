import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOKS, DEFAULT_PLAYLIST, LOOK_CAPTION } from "@nightplot/shared";
import { lightView } from "@/test/fixtures";
import { LooksPanel, type LooksPayload } from "./looks-panel";

const lights = [
  lightView({ id: "porch", name: "Porch", reachability: "online", propCount: 1 }),
  lightView({ id: "eave", name: "Eave", reachability: "online", propCount: 0 }),
];

const initial: LooksPayload = {
  version: 1,
  looks: DEFAULT_LOOKS,
  playlists: [DEFAULT_PLAYLIST],
  schedule: null,
  yard: {
    lights: lights.map((light) => ({ id: light.id, name: light.name })),
    props: [{ id: "prop-window", lightId: "porch", lightName: "Porch", label: "Front window", kind: "window", elementIds: ["el-1"] }],
    elements: [{ id: "el-1", lightId: "porch", lightName: "Porch", label: "Front window · top", start: 0, stop: 20 }],
  },
  caption: LOOK_CAPTION,
};

const arch = {
  id: "prop-arch",
  lightId: "porch",
  lightName: "Porch",
  label: "Arch",
  kind: "arch" as const,
  elementIds: ["el-a"],
  layout: {
    source: "trace" as const,
    units: "m" as const,
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 1, y: 1 }],
    run: [{ id: "e1", from: "c1", to: "c2", kind: "lit" as const }, { id: "e2", from: "c2", to: "c3", kind: "lit" as const }],
  },
  sections: [
    { id: "left", name: "Left", edgeIds: ["e1"], pinnedRanges: [], color: "#ff0000" },
    { id: "right", name: "Right", edgeIds: ["e2"], pinnedRanges: [], color: "#0000ff" },
  ],
};

describe("Looks with sections", () => {
  it("lists each section with its own colour, and saves a colour, an effect, and a section left out", async () => {
    const puts: { looks: { id: string; overrides: Record<string, unknown>[] }[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as (typeof puts)[number];
      puts.push(body);
      return new Response(JSON.stringify({ ...initial, ...body }));
    }));
    render(<LooksPanel lights={lights} initial={{ ...initial, yard: { ...initial.yard, props: [...initial.yard.props, arch] } }} />);
    expect(screen.getByLabelText("Arch Left colour")).toHaveProperty("value", "#ff0000");
    expect(screen.getByLabelText("Arch Right colour")).toHaveProperty("value", "#0000ff");
    fireEvent.change(screen.getByLabelText("Arch Left colour"), { target: { value: "#ff00ff" } });
    fireEvent.change(screen.getByLabelText("Arch Left effect"), { target: { value: "13" } });
    fireEvent.click(screen.getByLabelText("Arch Right in this Look"));
    expect(screen.getByLabelText("Arch Right colour")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Save library" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const overrides = puts[0]!.looks.find((row) => row.id === DEFAULT_LOOKS[0]!.id)!.overrides;
    expect(overrides).toEqual([
      expect.objectContaining({ propId: "prop-arch", sectionId: "left", style: expect.objectContaining({ color: "#ff00ff", fx: 13 }) }),
      expect.objectContaining({ propId: "prop-arch", sectionId: "right", off: true }),
    ]);
    fireEvent.click(screen.getByLabelText("Arch Right in this Look"));
    expect(screen.getByLabelText("Arch Right colour")).toHaveProperty("value", "#0000ff");
  });
});

describe("Looks", () => {
  it("saves an edited Look and shows Prop overrides when Props exist", async () => {
    const puts: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      puts.push(body);
      return new Response(JSON.stringify({ ...initial, looks: body.looks, playlists: body.playlists, schedule: body.schedule }));
    }));
    render(<LooksPanel lights={lights} initial={initial} />);
    expect(screen.getByRole("button", { name: "Override this Prop" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Override this face" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Warm white name"), { target: { value: "Amber porch" } });
    fireEvent.click(screen.getByRole("button", { name: "Save library" }));
    await waitFor(() => expect(puts[0]).toMatchObject({
      looks: expect.arrayContaining([expect.objectContaining({ name: "Amber porch", slot: 1 })]),
    }));
    expect(await screen.findByText("Saved in Nightplot. Push to write the controllers.")).toBeTruthy();
  });

  it("pushes selected Lights and lists per-Light results", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/looks" && init?.method === "PUT") {
        return new Response(JSON.stringify(initial));
      }
      if (path === "/api/looks/push") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { lightIds: string[]; includeSchedule: boolean };
        expect(body.lightIds).toEqual(["porch"]);
        expect(body.includeSchedule).toBe(false);
        return new Response(JSON.stringify({
          kind: "looks",
          rows: [{ lightId: "porch", lightName: "Porch", status: "matched", detail: "Reports the 7 Looks as the same preset numbers.", safetyBackupId: "b1" }],
          message: "1 of 1 report the Looks.",
          caption: LOOK_CAPTION,
        }));
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }));
    render(<LooksPanel lights={lights} initial={initial} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Eave/ }));
    fireEvent.click(screen.getByRole("button", { name: "Push Looks" }));
    expect(await screen.findByText("1 of 1 report the Looks.")).toBeTruthy();
    expect(screen.getByText(/Safety backup b1/)).toBeTruthy();
  });

  it("turns on a Look through the existing preset path", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      posts.push({ path, body });
      return new Response(JSON.stringify({ kind: "preset", sourceLightId: null, rows: [], message: "2 of 2 report the preset on.", caption: "" }));
    }));
    render(<LooksPanel lights={lights} initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on Warm white" }));
    expect(await screen.findByText("2 of 2 report the preset on.")).toBeTruthy();
    expect(posts[0]).toEqual({ path: "/api/sync/preset", body: { lightIds: ["porch", "eave"], presetId: 1 } });
  });

  it("offers a wireframe face override when a wireframe Prop exists", async () => {
    const puts: Record<string, unknown>[] = [];
    const withWireframe: LooksPayload = {
      ...initial,
      yard: {
        ...initial.yard,
        props: [{
          id: "prop-well",
          lightId: "porch",
          lightName: "Porch",
          label: "Well house",
          kind: "wireframe",
          elementIds: ["well-face-0"],
          wireframe: {
            template: "polygon-prism-box-x",
            sides: 8,
            pitchMm: 100,
            path: null,
            locks: [],
            hidden: [],
            sharedPostRule: "half",
          },
        }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      puts.push(body);
      return new Response(JSON.stringify({ ...withWireframe, looks: body.looks }));
    }));
    render(<LooksPanel lights={lights} initial={withWireframe} />);
    fireEvent.click(screen.getByRole("button", { name: "Override this face" }));
    fireEvent.click(screen.getByRole("button", { name: "Save library" }));
    await waitFor(() => {
      const looks = puts[0]?.looks as { overrides?: { wireframeGroup?: string }[] }[];
      expect(looks?.[0]?.overrides?.some((row) => row.wireframeGroup === "face.0")).toBe(true);
    });
  });
});
