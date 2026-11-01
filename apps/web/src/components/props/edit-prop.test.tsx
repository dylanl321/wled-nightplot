import type { Prop } from "@nightplot/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditProp } from "./edit-prop";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

/** A saved 3 m roofline at 10 cm: one run, 30 lights. */
function savedRoof(): Prop {
  const run = [{ id: "e1", from: "c1", to: "c2", kind: "lit" as const }];
  return {
    id: "roof",
    label: "Front roof",
    kind: "custom",
    elementIds: [],
    design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: { shape: "custom" }, ledCount: 30, edges: [] },
    layout: {
      source: "trace",
      units: "m",
      pitchM: 0.1,
      startOffsetM: 0,
      corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 3, y: 0 }],
      run,
      strings: [{ id: "s1", startId: "c1", run }],
    },
    sections: [],
  } as Prop;
}

afterEach(() => push.mockReset());

describe("sections from a saved prop", () => {
  it("opens straight to sections, edits one, and saves it with the prop", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ prop: savedRoof(), message: "saved" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    render(<EditProp prop={savedRoof()} start="sections" />);
    expect(screen.getByRole("heading", { name: "Name the sections" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New section" }));
    fireEvent.change(screen.getByLabelText("Section name"), { target: { value: "Eave" } });
    fireEvent.change(screen.getByLabelText("Section colour"), { target: { value: "#3dd68c" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add · / }));
    expect(screen.getByRole("button", { name: /^In this section · / })).toBeTruthy();
    expect(screen.getByText("30 lights")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^In this section · / }));
    fireEvent.change(screen.getByLabelText("Pinned ranges"), { target: { value: "10-16" } });
    expect(screen.getByText("7 lights")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe("/api/props/roof");
    const sections = calls[0]!.body.sections as { name: string; color: string; edgeIds: string[]; pinnedRanges: { start: number; stop: number }[] }[];
    expect(sections).toEqual([expect.objectContaining({ name: "Eave", color: "#3dd68c", edgeIds: [], pinnedRanges: [{ start: 10, stop: 17 }] })]);
    expect(push).toHaveBeenCalledWith("/");
  });

  it("Back from sections opened directly returns to the yard without saving", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<EditProp prop={savedRoof()} start="sections" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]!);
    expect(push).toHaveBeenCalledWith("/");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("Edit path goes to the drawing", async () => {
    render(<EditProp prop={savedRoof()} start="sections" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit path" }));
    expect(await screen.findByTestId("layout-canvas")).toBeTruthy();
  });
});
