import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultWireframeSpec, type Look, type LooksDocument, type Prop } from "@nightplot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YardEditor, type YardEditorProps } from "./yard-editor";
import { lightTotal, measurementsOf, newDraft, setCount, startFrom } from "./model";

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

  it("names a new prop after its shape only when no name was typed", () => {
    setup({ query: { view: "new" } });
    const name = document.getElementById("ye-name") as HTMLInputElement;
    expect(name.value).toBe("");
    fireEvent.click(document.querySelector('[data-start="triangle"]') as HTMLButtonElement);
    const after = document.getElementById("ye-name") as HTMLInputElement;
    expect(after.value).toBe("");
    expect(after.placeholder).toContain("Triangle 1");
  });

  it("shows the yard with its props, and opens a Look on the Looks page", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Your yard" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Peak/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Warm white/ }).getAttribute("href")).toBe("/looks/warm");
  });

  it("says when a prop is in no Look and links to Add to Looks", () => {
    setup();
    const add = screen.getAllByRole("link", { name: "Add to Looks…" });
    expect(add[0]!.getAttribute("href")).toBe("/looks?add=peak");
  });

  it("switches the yard to Street and back", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Street" }));
    expect(screen.getByRole("img", { name: "Yard from the street" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(screen.queryByRole("img", { name: "Yard from the street" })).toBeNull();
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

  it("a rename reply does not put an older yard point back", async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    const seen: { url: string; body: { yard?: { x: number; y: number }; label?: string } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { yard?: { x: number; y: number }; label?: string } : {};
      seen.push({ url: String(url), body });
      if (String(url).endsWith("/api/props/peak") && init?.method === "PATCH") return gate;
      if (String(url).includes("/yard")) {
        return new Response(JSON.stringify({ prop: { ...triangleProp(), label: "Peak", yard: body.yard } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const prop = { ...triangleProp(), yard: { x: 2, y: 1 } };
    setup({ props: [prop] });
    fireEvent.click(screen.getAllByRole("button", { name: /Peak/ })[0]!);
    const name = document.getElementById("ye-name") as HTMLInputElement;
    name.focus();
    fireEvent.change(name, { target: { value: "Box" } });
    fireEvent.keyDown(name, { key: "Enter" });
    const x = document.getElementById("ye-x") as HTMLInputElement;
    x.focus();
    fireEvent.change(x, { target: { value: "3" } });
    fireEvent.keyDown(x, { key: "Enter" });
    await waitFor(() => expect(seen.some((call) => call.url.includes("/yard") && call.body.yard?.x === 3)).toBe(true));
    release(new Response(JSON.stringify({ prop: { ...prop, label: "Box", yard: { x: 2, y: 1 } } }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Box" })).toBeTruthy());
    const y = document.getElementById("ye-y") as HTMLInputElement;
    y.focus();
    fireEvent.change(y, { target: { value: "0" } });
    fireEvent.keyDown(y, { key: "Enter" });
    await waitFor(() => {
      const yards = seen.filter((call) => call.url.includes("/yard"));
      expect(yards[yards.length - 1]?.body).toEqual({ yard: { x: 3, y: 0 } });
    });
    expect(screen.getByRole("heading", { name: "Box" })).toBeTruthy();
  });

  it("sends the wireframe and LED product when a prop is duplicated", async () => {
    const wireframe = { ...defaultWireframeSpec({ sides: 4, pitchMm: 80 }), locks: [{ role: "post.0", physicalIndex: 4 }] };
    const prop: Prop = {
      ...triangleProp(),
      id: "well",
      label: "Well",
      kind: "wireframe",
      wireframe,
      design: { ...triangleProp().design!, ledProductId: "led-porch" },
    };
    setup({ props: [prop] });
    fireEvent.click(screen.getAllByRole("button", { name: /Well/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/props"))).toBe(true));
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/props"));
    expect(post?.body).toMatchObject({ label: "Well copy", ledProductId: "led-porch", wireframe });
  });
});

describe("prop canvas behaviour", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
  });

  function windowProp(): Prop {
    const d = setCount(startFrom(newDraft("Box"), "window", "m", 0.1), 80);
    return {
      id: "box",
      label: "Box",
      kind: "window",
      elementIds: [],
      layout: d.layout!,
      design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: measurementsOf(d), ledCount: lightTotal(d.layout), edges: [] },
      yard: { x: 0, y: 0 },
    };
  }

  function openCanvas() {
    return render(
      <YardEditor
        props={[windowProp()]}
        attachments={[]}
        lights={[]}
        lightViews={[]}
        sessions={[]}
        looks={looks}
        looksReady={false}
        yardClear={false}
        query={{ prop: "box", view: "edit" }}
      />,
    );
  }

  it("switches Trace and Select, and the next run between lit and dark", () => {
    openCanvas();
    fireEvent.click(screen.getByRole("button", { name: "Trace" }));
    expect(screen.getByRole("button", { name: "Trace" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/empty space for the next run/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lit" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Lit" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Select / move" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Stopped tracing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trace" }));
    fireEvent.click(screen.getByRole("button", { name: "Done tracing" }));
    expect(screen.getByRole("button", { name: "Select / move" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Trace" }));
    fireEvent.click(screen.getByRole("button", { name: "Select / move" }));
    expect(screen.getByRole("button", { name: "Select / move" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("types a run length in metres and a per-run light count, and can delete the run", () => {
    openCanvas();
    const run = document.querySelector("[data-run]") as HTMLButtonElement;
    const runName = run.textContent ?? "";
    fireEvent.click(run);
    const length = document.getElementById("ye-rlen") as HTMLInputElement;
    length.focus();
    fireEvent.change(length, { target: { value: "3" } });
    fireEvent.keyDown(length, { key: "Enter" });
    expect(document.querySelector(`[data-run="${run.dataset.run}"]`)?.parentElement?.textContent).toContain("3.00 m");

    fireEvent.click(screen.getByRole("button", { name: runName }));
    const lights = document.getElementById("ye-rlights") as HTMLInputElement;
    lights.focus();
    fireEvent.change(lights, { target: { value: "7" } });
    fireEvent.keyDown(lights, { key: "Enter" });
    expect(screen.getByText(/Edited by hand/)).toBeTruthy();
    expect(document.querySelector(`[data-run="${run.dataset.run}"]`)?.parentElement?.textContent).toContain("7");

    fireEvent.click(screen.getByText("Delete run"));
    expect(document.querySelector(`[data-run="${run.dataset.run}"]`)).toBeNull();
  });
});
