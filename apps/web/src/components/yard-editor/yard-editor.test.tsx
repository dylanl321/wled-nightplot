import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Look, LooksDocument, Prop } from "@nightplot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YardEditor, type YardEditorProps } from "./yard-editor";
import { newDraft, startFrom, measurementsOf } from "./model";

function triangleProp(): Prop {
  const d = startFrom(newDraft("Peak"), "triangle", "m", 0.1);
  return {
    id: "peak",
    label: "Peak",
    kind: "tree",
    elementIds: [],
    layout: d.layout!,
    design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: measurementsOf(d), ledCount: 60, edges: [] },
    yard: { x: 1, y: 0 },
  };
}

const look: Look = { id: "warm", name: "Warm white", slot: 1, style: { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" }, overrides: [], propIds: [] };
const looks: LooksDocument = { version: 1, looks: [look], playlists: [], schedule: null };

function setup(over: Partial<YardEditorProps> = {}) {
  return render(
    <YardEditor
      props={[triangleProp()]}
      attachments={[]}
      lights={[]}
      lightViews={[]}
      sessions={[]}
      looks={looks}
      looksReady={false}
      yardClear={false}
      query={{}}
      {...over}
    />,
  );
}

describe("YardEditor", () => {
  let calls: { url: string; method: string; body: unknown }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url.endsWith("/api/props") && init?.method === "POST") {
        return new Response(JSON.stringify({ prop: { ...body, id: "new-1", elementIds: [], design: { unit: "m", pitchMm: 100, ledProductId: null, ledCount: 40, edges: [] } } }), { status: 200 });
      }
      if (url.includes("/yard")) return new Response(JSON.stringify({ prop: { ...triangleProp(), id: "new-1", label: "Line 1", yard: body.yard } }), { status: 200 });
      if (url.endsWith("/api/looks")) return new Response(JSON.stringify(body), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  it("shows the yard with its props and Looks", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Your yard" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Peak/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Warm white/ })).toBeTruthy();
  });

  it("builds a new prop on a clean canvas, saves it, and asks where to place it", async () => {
    setup();
    fireEvent.click(screen.getAllByRole("button", { name: "+ New prop" })[0]!);
    expect(screen.getByText("A clean canvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    expect(screen.queryByText("Start from")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Save and place" })[0]!);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Place Line 1" })).toBeTruthy());
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/props"));
    expect(post?.body).toMatchObject({ label: "Line 1", kind: "roofline" });
    fireEvent.click(screen.getByRole("button", { name: "Next to the others" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/props/new-1/yard"))).toBe(true));
  });

  it("asks before leaving a prop with changes", () => {
    setup({ query: { prop: "peak", view: "edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Change shape" }));
    fireEvent.click(screen.getByRole("button", { name: "Window" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(screen.getByText(/Leave without saving/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("heading", { name: "Peak" })).toBeTruthy();
  });

  it("switches a prop on in a Look and saves the Looks", async () => {
    setup({ query: { look: "warm" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Peak/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Switch on in this Look" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/api/looks"))).toBe(true), { timeout: 2000 });
    const put = calls.find((c) => c.method === "PUT");
    expect((put?.body as LooksDocument).looks[0]!.propIds).toEqual(["peak"]);
  });
});
