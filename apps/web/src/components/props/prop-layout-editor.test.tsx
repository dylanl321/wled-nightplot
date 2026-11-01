import type { PropLayout } from "@nightplot/shared";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PropLayoutEditor } from "./prop-layout-editor";

/** jsdom has no PointerEvent, so a MouseEvent carries the pointer fields. */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType = "mouse";
  constructor(type: string, init: MouseEventInit & { pointerId: number }) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId;
  }
}

function tap(node: HTMLElement, x: number, y: number, extra: MouseEventInit = {}) {
  for (const type of ["pointerdown", "pointerup"]) {
    act(() => {
      node.dispatchEvent(new TestPointerEvent(type, { pointerId: 1, clientX: x, clientY: y, button: 0, ...extra }));
    });
  }
}

/** One 1 m lit run from (0,0) to (1,0) at 10 cm spacing: 10 lights. */
function oneRun(): PropLayout {
  return {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }],
    run: [{ id: "e1", from: "c1", to: "c2", kind: "lit" }],
    strings: [{ id: "s1", startId: "c1", run: [{ id: "e1", from: "c1", to: "c2", kind: "lit" }] }],
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 456 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 456 });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

async function stagePoint(world: { x: number; y: number }) {
  const node = await screen.findByTestId("layout-canvas");
  const ppm = Number(node.dataset.ppm);
  return { node, x: Number(node.dataset.ox) + world.x * ppm, y: Number(node.dataset.oy) - world.y * ppm };
}

describe("PropLayoutEditor on the Konva stage", () => {
  it("a tap on empty space in Trace adds a run from the end, without changing the first run", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="trace" onDone={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    const at = await stagePoint({ x: 1, y: 0.5 });
    tap(at.node, at.x, at.y, { altKey: true });
    expect(screen.getByText(/^15 lights ·/)).toBeTruthy();
    expect(screen.getByText(/String A: Wire in, 2 runs/)).toBeTruthy();
  });

  it("Undo and Redo, by button and by Ctrl+Z", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="trace" onDone={vi.fn()} onBack={vi.fn()} />);
    const at = await stagePoint({ x: 1, y: 1 });
    tap(at.node, at.x, at.y, { altKey: true });
    expect(screen.getByText(/^20 lights ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByText(/^20 lights ·/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
  });

  it("Mark dark arms only the next run, then turns itself off", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="trace" onDone={vi.fn()} onBack={vi.fn()} />);
    const mark = screen.getByRole("button", { name: "Mark dark" });
    expect(mark.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mark);
    expect(mark.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("The next run is dark: the wire jumps and no lights are on it.")).toBeTruthy();
    const at = await stagePoint({ x: 2, y: 0 });
    tap(at.node, at.x, at.y, { altKey: true });
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    expect(screen.getByText(/2 runs/)).toBeTruthy();
    expect(mark.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/The next run is dark/)).toBeNull();
    expect(screen.getByText(/Trace adds runs/)).toBeTruthy();
    const next = await stagePoint({ x: 2, y: 1 });
    tap(next.node, next.x, next.y, { altKey: true });
    expect(screen.getByText(/^20 lights ·/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /A2 · dark/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /A3 · dark/ })).toBeNull();
    expect(screen.getByRole("button", { name: "A3" })).toBeTruthy();
  });

  it("Add another string starts a second string at the tap", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="trace" onDone={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add another string" }));
    const at = await stagePoint({ x: 0, y: 1 });
    tap(at.node, at.x, at.y, { altKey: true });
    expect(screen.getByText(/String B: Wire in, 0 runs/)).toBeTruthy();
    const next = await stagePoint({ x: 1, y: 1 });
    tap(next.node, next.x, next.y, { altKey: true });
    expect(screen.getByText(/String B: Wire in, 1 run/)).toBeTruthy();
    expect(screen.getByText(/^20 lights ·/)).toBeTruthy();
  });

  it("in Edit, a tap on empty space adds nothing", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    const at = await stagePoint({ x: 2, y: 2 });
    tap(at.node, at.x, at.y);
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    expect(screen.getByText(/String A: Wire in, 1 run/)).toBeTruthy();
  });

  it("Done hands back the drawing with strings", async () => {
    const done = vi.fn();
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="trace" onDone={done} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done.mock.calls[0]![0].strings).toHaveLength(1);
  });
});

describe("run list", () => {
  it("shows every run's length and count without a tap", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    await screen.findByTestId("layout-canvas");
    expect(screen.getByLabelText("A1 length (m)")).toHaveProperty("value", "1.00");
    expect(screen.getByLabelText("A1 lights")).toHaveProperty("value", "10");
  });

  it("typing 3 m gives round(3 ÷ spacing) lights", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    const field = await screen.findByLabelText("A1 length (m)");
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.submit(field.closest("form")!);
    expect(screen.getByText(/^30 lights ·/)).toBeTruthy();
    expect(screen.getByLabelText("A1 lights")).toHaveProperty("value", "30");
  });

  it("typing a count stores it on the run, and a later length edit clears it", async () => {
    const done = vi.fn();
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={done} onBack={vi.fn()} />);
    const count = await screen.findByLabelText("A1 lights");
    fireEvent.change(count, { target: { value: "12" } });
    fireEvent.submit(count.closest("form")!);
    expect(screen.getByText(/^12 lights ·/)).toBeTruthy();
    expect(screen.getByLabelText("A1 length (m)")).toHaveProperty("value", "1.00");
    expect(screen.getByText(/lights typed in/)).toBeTruthy();
    const length = screen.getByLabelText("A1 length (m)");
    fireEvent.change(length, { target: { value: "2" } });
    fireEvent.submit(length.closest("form")!);
    expect(screen.getByText(/^20 lights ·/)).toBeTruthy();
    expect(screen.queryByText(/lights typed in/)).toBeNull();
  });

  it("feet show feet", async () => {
    const feet = { ...oneRun(), units: "ft" as const };
    render(<PropLayoutEditor name="Ridge" initial={feet} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    expect(await screen.findByLabelText("A1 length (ft)")).toHaveProperty("value", "3' 3\"");
  });

  it("deletes a run by its button, by Delete, and Undo brings it back", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="trace" onDone={vi.fn()} onBack={vi.fn()} />);
    const at = await stagePoint({ x: 2, y: 0 });
    tap(at.node, at.x, at.y, { altKey: true });
    expect(screen.getByText(/^20 lights ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "A2" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete A2" }));
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    expect(screen.queryByLabelText("A2 lights")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]!);
    expect(screen.getByText(/^20 lights ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "A1" }));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    expect(screen.getByLabelText("A1 length (m)")).toHaveProperty("value", "1.00");
  });

  it("shows the grid scale, a filled Snap control, and editable spacing", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    expect(await screen.findByTestId("grid-scale")).toHaveProperty("textContent", "1 square = 0.5 m");
    expect(screen.getByRole("button", { name: "Snap" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Metres" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Light spacing (cm)")).toHaveProperty("value", "10");
    expect(screen.getByText(/worked out from the length and spacing/)).toBeTruthy();
  });

  it("switching to feet keeps the corners and shows feet and inches", async () => {
    const done = vi.fn();
    render(<PropLayoutEditor name="Wall" initial={oneRun()} mode="edit" onDone={done} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Feet" }));
    expect(screen.getByLabelText("Light spacing (in)")).toHaveProperty("value", "3.94");
    expect(screen.getByTestId("grid-scale")).toHaveProperty("textContent", "1 square = 1 ft");
    expect(screen.getByLabelText("A1 length (ft)")).toHaveProperty("value", "3' 3\"");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const layout = done.mock.calls[0]![0];
    expect(layout.units).toBe("ft");
    expect(layout.corners).toEqual(oneRun().corners);
  });

  it("editing the spacing recounts lights and leaves the corners", async () => {
    const done = vi.fn();
    render(<PropLayoutEditor name="Wall" initial={oneRun()} mode="edit" onDone={done} onBack={vi.fn()} />);
    const spacing = await screen.findByLabelText("Light spacing (cm)");
    fireEvent.change(spacing, { target: { value: "20" } });
    fireEvent.submit(spacing.closest("form")!);
    expect(screen.getByText(/^5 lights ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const layout = done.mock.calls[0]![0];
    expect(layout.pitchM).toBeCloseTo(0.2, 6);
    expect(layout.corners).toEqual(oneRun().corners);
  });

  it("rejects a length that is not a measurement and leaves the drawing", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    const field = await screen.findByLabelText("A1 length (m)");
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.submit(field.closest("form")!);
    expect(screen.getByText("Enter a length in metres, greater than zero.")).toBeTruthy();
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    expect(field).toHaveProperty("value", "abc");
  });

  it("rejects zero lights and an empty length", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    const lights = await screen.findByLabelText("A1 lights");
    fireEvent.change(lights, { target: { value: "0" } });
    fireEvent.submit(lights.closest("form")!);
    expect(screen.getByText("Enter a whole number of lights, or leave it empty.")).toBeTruthy();
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
  });

  it("says a new length moves the end, and shows a short run that can be merged", async () => {
    const run = [
      { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
      { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
    ];
    const layout = {
      ...oneRun(),
      corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 1.05, y: 0 }],
      run,
      strings: [{ id: "s1", startId: "c1", run }],
    };
    render(<PropLayoutEditor name="Wall" initial={layout} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    expect(await screen.findByText(/moves that run's end along the run/)).toBeTruthy();
    expect(screen.getByText(/1 run is shorter than the light spacing/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^A2/ }).textContent).toMatch(/short/);
    fireEvent.click(screen.getByRole("button", { name: "Merge short runs" }));
    expect(screen.queryByText(/shorter than the light spacing/)).toBeNull();
    expect(screen.getByText(/^10 lights ·/)).toBeTruthy();
    expect(screen.queryByLabelText("A2 lights")).toBeNull();
  });

  it("a traced point holds to the inch grid", async () => {
    const feet = { ...oneRun(), units: "ft" as const };
    render(<PropLayoutEditor name="Wall" initial={feet} mode="trace" onDone={vi.fn()} onBack={vi.fn()} />);
    const at = await stagePoint({ x: 1, y: 0.5 });
    tap(at.node, at.x, at.y);
    expect(await screen.findByLabelText("A2 length (ft)")).toHaveProperty("value", "1' 8\"");
  });

  it("uses the prop name as the tab title and shows the keys", async () => {
    render(<PropLayoutEditor name="Wall" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    expect(document.title).toBe("Wall");
    expect(screen.getByText(/Arrow keys nudge the selected corner/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" }).className).toContain("bg-primary");
    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
  });

  it("names a run and warns before Name sections when runs overlap", async () => {
    const run = [
      { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
      { id: "e2", from: "c2", to: "c1", kind: "lit" as const },
    ];
    const layout = {
      ...oneRun(),
      corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }],
      run,
      strings: [{ id: "s1", startId: "c1", run }],
    };
    const done = vi.fn();
    render(<PropLayoutEditor name="Wall" initial={layout} mode="edit" doneLabel="Name sections" onDone={done} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "A1" }));
    const position = screen.getByLabelText("A1 position name");
    fireEvent.change(position, { target: { value: "top" } });
    fireEvent.submit(position.closest("form")!);
    expect(screen.getByRole("button", { name: /A1 · top/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Name sections" }));
    expect(screen.getByRole("dialog", { name: "Check the drawing" })).toBeTruthy();
    expect(screen.getByText(/lies on top of another/)).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Name sections" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("Escape clears a selection or a tool and does not leave the editor", async () => {
    const done = vi.fn();
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" doneLabel="Name sections" onDone={done} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "A1" }));
    expect(screen.getByRole("button", { name: "A1" }).closest("li")?.getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "A1" }).closest("li")?.getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add point" }));
    expect(screen.getByText(/Add point is on/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(done).not.toHaveBeenCalled();
    expect(screen.queryByText(/Add point is on/)).toBeNull();
    expect(screen.getByRole("button", { name: "Name sections" })).toBeTruthy();
  });

  it("a click on empty canvas deselects, and a pan keeps the selection", async () => {
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "A1" }));
    const stage = await screen.findByTestId("layout-canvas");
    const current = () => screen.getByRole("button", { name: "A1" }).closest("li")?.getAttribute("aria-current");
    expect(current()).toBe("true");
    act(() => {
      stage.dispatchEvent(new TestPointerEvent("pointerdown", { pointerId: 1, clientX: 30, clientY: 30, button: 0 }));
      stage.dispatchEvent(new TestPointerEvent("pointermove", { pointerId: 1, clientX: 90, clientY: 70, button: 0 }));
      stage.dispatchEvent(new TestPointerEvent("pointerup", { pointerId: 1, clientX: 90, clientY: 70, button: 0 }));
    });
    expect(current()).toBe("true");
    const empty = await stagePoint({ x: 3, y: 2 });
    tap(empty.node, empty.x, empty.y);
    expect(current()).toBeNull();
  });

  it("Delete point merges the two runs at the selected corner", async () => {
    const run = [{ id: "e1", from: "c1", to: "c2", kind: "lit" as const, name: "near", lockedLights: 12 }];
    const layout = { ...oneRun(), run, strings: [{ id: "s1", startId: "c1", run }] };
    const done = vi.fn();
    render(<PropLayoutEditor name="Ridge" initial={layout} mode="edit" onDone={done} onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete point" })).toHaveProperty("disabled", true);
    fireEvent.click(await screen.findByRole("button", { name: /A1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add point" }));
    expect(screen.getByText(/String A: Wire in, 2 runs/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete point" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Delete point" }));
    expect(screen.getByText(/The two runs are now one/)).toBeTruthy();
    expect(screen.getByText(/String A: Wire in, 1 run/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const saved = done.mock.calls[0]![0];
    expect(saved.run).toHaveLength(1);
    expect(saved.run[0]).toMatchObject({ id: "e1", name: "near", lockedLights: 12, from: "c1", to: "c2" });
  });

  it("warns about a gap and adds an unlit connector", async () => {
    const run = [
      { id: "e1", from: "c1", to: "c2", kind: "lit" as const, name: "near" },
      { id: "e2", from: "c3", to: "c4", kind: "lit" as const, name: "far" },
    ];
    const layout = {
      ...oneRun(),
      corners: [
        { id: "c1", x: 0, y: 0 },
        { id: "c2", x: 1, y: 0 },
        { id: "c3", x: 2, y: 0 },
        { id: "c4", x: 3, y: 0 },
      ],
      run,
      strings: [{ id: "s1", startId: "c1", run }],
    };
    const done = vi.fn();
    render(<PropLayoutEditor name="Ridge" initial={layout} mode="edit" onDone={done} onBack={vi.fn()} />);
    expect(screen.getByText(/The wire has a gap/)).toBeTruthy();
    expect(screen.getByText(/^20 lights · 3\.00 m of wire$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add unlit connector" }));
    expect(screen.getByText(/Added an unlit connector/)).toBeTruthy();
    expect(screen.queryByText(/The wire has a gap/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const saved = done.mock.calls[0]![0];
    expect(saved.run.map((edge: { kind: string }) => edge.kind)).toEqual(["lit", "wire", "lit"]);
    expect(saved.run[0]).toMatchObject({ id: "e1", name: "near" });
    expect(saved.run[2]).toMatchObject({ id: "e2", name: "far" });
  });

  it("saves a change and says Saved", async () => {
    const autosave = vi.fn(async (_layout: PropLayout) => true);
    render(<PropLayoutEditor name="Ridge" initial={oneRun()} mode="edit" onDone={vi.fn()} onBack={vi.fn()} onAutosave={autosave} />);
    const field = await screen.findByLabelText("A1 lights");
    fireEvent.change(field, { target: { value: "14" } });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveProperty("textContent", "Saved"));
    expect(autosave).toHaveBeenCalled();
    const saved = autosave.mock.calls.at(-1)?.[0];
    expect(saved?.run[0]?.lockedLights).toBe(14);
  });
});
