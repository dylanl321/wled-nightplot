import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorStage, type EditorStageHandle } from "./editor-stage";

const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 2 };
const limits = { minPpm: 5, maxPpm: 500 };

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 456 + 56 }); // 56 px stay clear for the zoom buttons
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 856 });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

function cameraOf(node: HTMLElement) {
  return { ppm: Number(node.dataset.ppm), ox: Number(node.dataset.ox), oy: Number(node.dataset.oy) };
}

/** jsdom has no PointerEvent, so a MouseEvent carries the pointer fields. */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId: number }) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId;
  }
}

function pointer(type: "down" | "move" | "up", node: HTMLElement, id: number, x: number, y: number, extra: MouseEventInit = {}) {
  act(() => {
    node.dispatchEvent(new TestPointerEvent(`pointer${type}`, { pointerId: id, clientX: x, clientY: y, button: 0, ...extra }));
  });
}

describe("EditorStage", () => {
  it("opens fitted to the bounds with a canvas and three controls", () => {
    render(<EditorStage bounds={bounds} limits={limits} label="Prop drawing" gridM={0.5} />);
    const stage = screen.getByTestId("editor-stage");
    expect(stage).toHaveProperty("tagName", "DIV");
    expect(stage.querySelector("canvas")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Prop drawing" })).toBe(stage);
    expect(cameraOf(stage)).toEqual({ ppm: 100, ox: 28, oy: 528 });
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Fit" })).toBeDefined();
  });

  it("Zoom in and Zoom out step about the centre, and Fit returns", () => {
    const changes = vi.fn();
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" onCameraChange={changes} />);
    const stage = screen.getByTestId("editor-stage");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(cameraOf(stage).ppm).toBeCloseTo(125);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(cameraOf(stage).ppm).toBeCloseTo(80);
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(cameraOf(stage)).toEqual({ ppm: 100, ox: 28, oy: 528 });
    expect(changes).toHaveBeenCalled();
  });

  it("a background tap reports world metres and does not pan", () => {
    const tap = vi.fn();
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" onBackgroundTap={tap} />);
    const stage = screen.getByTestId("editor-stage");
    pointer("down", stage, 1, 128, 428);
    pointer("move", stage, 1, 130, 429);
    pointer("up", stage, 1, 130, 429);
    expect(tap).toHaveBeenCalledTimes(1);
    const world = tap.mock.calls[0]![0].world;
    expect(world.x).toBeCloseTo(1.02);
    expect(world.y).toBeCloseTo(0.99);
    expect(cameraOf(stage)).toEqual({ ppm: 100, ox: 28, oy: 528 });
  });

  it("a background drag past the slop pans and is not a tap", () => {
    const tap = vi.fn();
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" onBackgroundTap={tap} />);
    const stage = screen.getByTestId("editor-stage");
    pointer("down", stage, 1, 100, 100);
    pointer("move", stage, 1, 140, 80);
    pointer("move", stage, 1, 160, 70);
    pointer("up", stage, 1, 160, 70);
    expect(tap).not.toHaveBeenCalled();
    expect(cameraOf(stage)).toEqual({ ppm: 100, ox: 88, oy: 498 });
  });

  it("middle-button drag pans from the first pixel", () => {
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" />);
    const stage = screen.getByTestId("editor-stage");
    pointer("down", stage, 1, 100, 100, { button: 1 });
    pointer("move", stage, 1, 103, 100, { button: 1 });
    pointer("up", stage, 1, 103, 100, { button: 1 });
    expect(cameraOf(stage).ox).toBeCloseTo(31);
  });

  it("space + drag pans and never taps", () => {
    const tap = vi.fn();
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" onBackgroundTap={tap} />);
    const stage = screen.getByTestId("editor-stage");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    pointer("down", stage, 1, 100, 100);
    pointer("move", stage, 1, 102, 104);
    pointer("up", stage, 1, 102, 104);
    fireEvent.keyUp(window, { code: "Space", key: " " });
    expect(tap).not.toHaveBeenCalled();
    expect(cameraOf(stage)).toEqual({ ppm: 100, ox: 30, oy: 532 });
  });

  it("two fingers pinch, and a second finger cancels the pending tap", () => {
    const tap = vi.fn();
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" onBackgroundTap={tap} />);
    const stage = screen.getByTestId("editor-stage");
    pointer("down", stage, 1, 100, 400);
    pointer("down", stage, 2, 200, 400);
    pointer("move", stage, 2, 300, 400);
    pointer("up", stage, 1, 100, 400);
    pointer("up", stage, 2, 300, 400);
    expect(tap).not.toHaveBeenCalled();
    expect(cameraOf(stage).ppm).toBeCloseTo(200);
  });

  it("the wheel zooms toward the pointer", () => {
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" />);
    const stage = screen.getByTestId("editor-stage");
    const before = cameraOf(stage);
    const at = { x: 228, y: 428 };
    const worldBefore = { x: (at.x - before.ox) / before.ppm, y: (before.oy - at.y) / before.ppm };
    fireEvent.wheel(stage, { deltaY: -100, clientX: at.x, clientY: at.y });
    const after = cameraOf(stage);
    expect(after.ppm).toBeGreaterThan(before.ppm);
    expect((at.x - after.ox) / after.ppm).toBeCloseTo(worldBefore.x, 1);
    expect((after.oy - at.y) / after.ppm).toBeCloseTo(worldBefore.y, 1);
  });

  it("exposes fit, zoom, and the stage transform through a ref", () => {
    const ref = createRef<EditorStageHandle>();
    render(<EditorStage ref={ref} bounds={bounds} limits={limits} label="Drawing" />);
    const world = ref.current!.toWorld({ x: 228, y: 328 });
    expect(world.x).toBeCloseTo(2);
    expect(world.y).toBeCloseTo(2);
    act(() => ref.current!.zoomIn());
    expect(ref.current!.camera().ppm).toBeCloseTo(125);
    act(() => ref.current!.fit());
    expect(ref.current!.camera().ppm).toBeCloseTo(100);
  });

  it("presses on the zoom controls do not pan or tap", () => {
    const tap = vi.fn();
    render(<EditorStage bounds={bounds} limits={limits} label="Drawing" onBackgroundTap={tap} />);
    const button = screen.getByRole("button", { name: "Fit" });
    pointer("down", button, 1, 430, 20);
    pointer("up", button, 1, 430, 20);
    expect(tap).not.toHaveBeenCalled();
  });
});
