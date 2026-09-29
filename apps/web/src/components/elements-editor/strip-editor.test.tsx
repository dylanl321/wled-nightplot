import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StripEditor } from "./strip-editor";
import { initialEditorState } from "./use-editor-state";
import { stripMetrics } from "./ops";

describe("Segment strip drag", () => {
  it("cancels native Safari selection before starting a captured drag", () => {
    const dispatch = vi.fn();
    render(<StripEditor
      svgId="strip-test" label="Segment strip" ledCount={20} rgbw={false}
      state={initialEditorState([], 20, "light-1")} hues={{}} issueWord={() => undefined}
      resting={() => null} live={false} frame={null} liveLabel="Preview"
      onLive={vi.fn()} dispatch={dispatch}
    />);
    const svg = screen.getByRole("img", { name: "Segment strip" }) as unknown as SVGSVGElement;
    const { width, height } = stripMetrics(20);
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width, height, right: width, bottom: height,
      x: 0, y: 0, toJSON: () => ({}),
    });
    const capture = vi.fn();
    svg.setPointerCapture = capture;
    const down = new MouseEvent("pointerdown", {
      bubbles: true, cancelable: true, button: 0, clientX: 55, clientY: 44,
    });
    Object.defineProperty(down, "pointerId", { value: 1 });
    svg.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(capture).toHaveBeenCalledWith(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "down" }));
    expect(svg.getAttribute("style")).toContain("user-select: none");
    expect(svg.getAttribute("class")).toContain("[&_text]:pointer-events-none");
  });
});
