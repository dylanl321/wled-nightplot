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
    fireEvent.click(screen.getByRole("button", { name: "Next: Lit" }));
    expect(screen.getByRole("button", { name: "Next: Dark" }).getAttribute("aria-pressed")).toBe("true");
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

describe("YardEditor attach, one string at a time", () => {
  const s1 = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
    { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
  ];
  const s2 = [
    { id: "e3", from: "c4", to: "c5", kind: "lit" as const },
    { id: "e5", from: "c5", to: "c6", kind: "lit" as const },
  ];
  const tree: Prop = {
    id: "tree",
    label: "Tree",
    kind: "custom",
    elementIds: [],
    layout: {
      source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0,
      corners: [
        { id: "c1", x: 0, y: 0 }, { id: "c2", x: 0, y: 1 }, { id: "c3", x: -0.5, y: 1.5 },
        { id: "c4", x: 0.6, y: 0.2 }, { id: "c5", x: 0.6, y: 1.2 }, { id: "c6", x: 1, y: 1.8 },
      ],
      run: s1,
      strings: [{ id: "s1", startId: "c1", run: s1 }, { id: "s2", startId: "c4", run: s2 }],
    },
    design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: { shape: "custom" }, ledCount: 34, edges: [{ id: "e1", label: "Side 1", lengthMm: 1000, ledCount: 10 }, { id: "e2", label: "Side 2", lengthMm: 707, ledCount: 7 }, { id: "e3", label: "Side 3", lengthMm: 1000, ledCount: 10 }, { id: "e5", label: "Side 4", lengthMm: 721, ledCount: 7 }] },
    sections: [
      { id: "left", name: "Left", edgeIds: ["e1", "e2"], pinnedRanges: [] },
      { id: "right", name: "Right", edgeIds: ["e3", "e5"], pinnedRanges: [] },
    ],
    yard: { x: 1, y: 0 },
  };
  const lights = [{
    id: "porch", name: "Porch", ledCount: 100, lastSnapshot: null,
    outputs: [
      { id: "out-a", index: 0, start: 0, ledCount: 50, stripKind: "ws281x", gpio: null, nativeType: null, nativeOrder: null, colorOrder: null },
      { id: "out-b", index: 1, start: 50, ledCount: 50, stripKind: "ws281x", gpio: null, nativeType: null, nativeOrder: null, colorOrder: null },
    ],
  }] as YardEditorProps["lights"];

  let posts: { url: string; body: Record<string, unknown> }[];
  beforeEach(() => {
    posts = [];
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(url).endsWith("/attach")) {
        posts.push({ url: String(url), body });
        return new Response(JSON.stringify({ prop: { ...tree, lightId: "porch" }, apply: { matched: true, message: "Read back." } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  function open(attachments: YardEditorProps["attachments"] = []) {
    return render(
      <YardEditor props={[tree]} attachments={attachments} lights={lights} lightViews={[]} sessions={[]} looks={looks} looksReady={false} yardClear={false} query={{ prop: "tree", fold: "controller" }} />,
    );
  }

  it("asks per string, sends the string id, and moves on to the string still waiting", async () => {
    open();
    const pick = screen.getByLabelText("String") as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.textContent)).toEqual([
      "String 1 · 17 lights · not attached",
      "String 2 · 17 lights · not attached",
    ]);
    fireEvent.change(screen.getByLabelText("Controller"), { target: { value: "porch" } });
    expect(screen.getByText(/string 1 of 2, 17 lights on Porch/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ lightId: "porch", outputId: "out-a", startIndex: 0, stringId: "s1", apply: true });
    // The next string waiting is picked, and it can sit on the other output.
    await waitFor(() => expect((screen.getByLabelText("String") as HTMLSelectElement).value).toBe("s2"));
    expect(Array.from((screen.getByLabelText("String") as HTMLSelectElement).options).map((o) => o.textContent)[0]).toMatch(/String 1 .* attached$/);
    fireEvent.change(screen.getByLabelText("Output"), { target: { value: "out-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body).toMatchObject({ outputId: "out-b", startIndex: 0, stringId: "s2" });
  });

  it("lets a string follow another string of its own prop on the same output", async () => {
    open([{ propId: "tree", lightId: "porch", outputId: "out-a", startIndex: 3, afterPropId: null, stringId: "s1" }]);
    expect((screen.getByLabelText("String") as HTMLSelectElement).value).toBe("s2");
    const where = screen.getByLabelText(/Where on this output/) as HTMLSelectElement;
    expect(Array.from(where.options).map((o) => o.textContent)).toEqual(["From the first light", "After string 1"]);
    fireEvent.change(where, { target: { value: "tree\u0000s1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ stringId: "s2", startIndex: null, afterPropId: "tree", afterStringId: "s1" });
  });

  it("sends no string id for a prop with one string", async () => {
    render(<YardEditor props={[triangleOne()]} attachments={[]} lights={lights} lightViews={[]} sessions={[]} looks={looks} looksReady={false} yardClear={false} query={{ prop: "peak", fold: "controller" }} />);
    expect(screen.queryByLabelText("String")).toBeNull();
    fireEvent.change(screen.getByLabelText("Controller"), { target: { value: "porch" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).not.toHaveProperty("stringId");
  });
});

function triangleOne(): Prop {
  return { ...triangleProp(), design: { ...triangleProp().design!, ledCount: 20, edges: [{ id: "a", label: "Side", lengthMm: 2000, ledCount: 20 }] } };
}
