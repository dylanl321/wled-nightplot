import { buildNetLayout, type WireframePathPoint } from "@nightplot/shared";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WireframeNet } from "./wireframe-net";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean } = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "touch";
    this.isPrimary = init.isPrimary ?? true;
  }
}

function send(node: Element, type: string, init: { pointerId: number; clientX: number; clientY: number }) {
  act(() => {
    node.dispatchEvent(new TestPointerEvent(type, init));
  });
}

const box = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 390,
  bottom: 240,
  width: 390,
  height: 240,
  toJSON() {
    return {};
  },
};

describe("Wireframe net", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 390 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 240 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws a snapped polyline with one pointer and pinches with two", () => {
    const points: WireframePathPoint[] = [];
    const ended = vi.fn();
    const layout = buildNetLayout(8);
    render(
      <div style={{ width: 390, height: 240 }}>
        <WireframeNet
          layout={layout}
          pathEdgeIds={[]}
          points={points}
          mode="draw"
          onDrawPoint={(point) => points.push(point)}
          onDrawEnd={ended}
        />
      </div>,
    );
    const net = screen.getByRole("img", { name: "Unfolded box+X net" });
    expect(net.className).toContain("overflow-hidden");
    expect(net.style.touchAction).toBe("none");
    const startScale = Number(net.getAttribute("data-scale"));
    expect(startScale).toBeGreaterThan(1);

    send(net, "pointerdown", { pointerId: 1, clientX: 40, clientY: 30 });
    send(net, "pointermove", { pointerId: 1, clientX: 90, clientY: 30 });
    send(net, "pointerup", { pointerId: 1, clientX: 90, clientY: 30 });
    expect(points.length).toBeGreaterThan(0);
    expect(ended).toHaveBeenCalled();
    expect(points.some((point) => point.edgeId?.startsWith("top.") || point.edgeId?.startsWith("post."))).toBe(true);

    send(net, "pointerdown", { pointerId: 11, clientX: 80, clientY: 80 });
    send(net, "pointerdown", { pointerId: 12, clientX: 160, clientY: 80 });
    send(net, "pointermove", { pointerId: 12, clientX: 240, clientY: 80 });
    const zoomed = Number(net.getAttribute("data-scale"));
    expect(zoomed).toBeGreaterThan(startScale);
  });

  it("pans with one finger in colour mode and taps a face", () => {
    const tapped = vi.fn();
    const layout = buildNetLayout(8);
    render(
      <WireframeNet
        layout={layout}
        pathEdgeIds={[]}
        points={[]}
        mode="colour"
        onFaceTap={tapped}
      />,
    );
    const net = screen.getByRole("img", { name: "Unfolded box+X net" });
    const before = Number(net.getAttribute("data-tx"));
    send(net, "pointerdown", { pointerId: 1, clientX: 120, clientY: 80 });
    send(net, "pointermove", { pointerId: 1, clientX: 40, clientY: 80 });
    send(net, "pointerup", { pointerId: 1, clientX: 40, clientY: 80 });
    expect(Number(net.getAttribute("data-tx"))).not.toBe(before);

    send(net, "pointerdown", { pointerId: 3, clientX: 40, clientY: 120 });
    send(net, "pointerup", { pointerId: 3, clientX: 40, clientY: 120 });
    expect(tapped).toHaveBeenCalled();
  });
});
