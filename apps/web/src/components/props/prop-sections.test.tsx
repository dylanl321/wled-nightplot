import { countLayout, defaultSections, layoutFromMeasurements, type PropLayout } from "@nightplot/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PropSectionsStep } from "./prop-sections";

function tree(): PropLayout {
  return layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "tree", params: { height: 2, base: 2 } })!;
}

function lengths(layout: PropLayout) {
  return countLayout(layout).edges.map((edge) => Math.round(edge.lengthM * 1000) / 1000);
}

describe("section light stepper", () => {
  it("adds lights to one edge without moving a corner or changing the other edge", () => {
    const layout = tree();
    const before = countLayout(layout).edges.map((edge) => edge.lights);
    const onLayout = vi.fn();
    render(
      <PropSectionsStep
        layout={layout}
        sections={defaultSections(layout)}
        measurements={{ shape: "tree", height: 2, base: 2 }}
        onLayout={onLayout}
        onSections={() => {}}
        onInvalid={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More lights on this edge" }));
    const next = onLayout.mock.calls[0]![0] as PropLayout;
    expect(lengths(next)).toEqual(lengths(layout));
    expect(next.corners).toEqual(layout.corners);
    const after = countLayout(next).edges.map((edge) => edge.lights);
    expect(after[0]).toBe(before[0]! + 1);
    expect(after.slice(1)).toEqual(before.slice(1));
  });
});
