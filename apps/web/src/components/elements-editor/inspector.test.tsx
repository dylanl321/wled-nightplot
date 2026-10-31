import type { Element, LightOutput } from "@nightplot/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ElementInspector } from "./inspector";
import { initialEditorState } from "./use-editor-state";

const outputs: LightOutput[] = [
  {
    id: "out-a",
    index: 0,
    start: 0,
    ledCount: 40,
    stripKind: "ws281x",
    gpio: 16,
    nativeType: 22,
    nativeOrder: 0,
    colorOrder: "GRB",
  },
  {
    id: "out-b",
    index: 1,
    start: 40,
    ledCount: 60,
    stripKind: "ws281x",
    gpio: 2,
    nativeType: 22,
    nativeOrder: 0,
    colorOrder: "GRB",
  },
];

function element(): Element {
  return { id: "a", lightId: "l", label: "Door", start: 0, stop: 20, outputId: "out-a" };
}

describe("ElementInspector output picker", () => {
  it("lets you pick which output a Segment belongs to", () => {
    const dispatch = vi.fn();
    const state = initialEditorState([element()], 100, "l", outputs);
    render(
      <ElementInspector
        state={state}
        hues={{ a: "#e8ae66" }}
        issuesFor={() => []}
        dispatch={dispatch}
        outputs={outputs}
      />,
    );
    const select = screen.getByLabelText("Segment output") as HTMLSelectElement;
    expect(select.value).toBe("out-a");
    fireEvent.change(select, { target: { value: "out-b" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "output", outputId: "out-b" });
  });

  it("hides the picker on a single-output Light", () => {
    const state = initialEditorState([element()], 40, "l", [outputs[0]!]);
    render(
      <ElementInspector
        state={state}
        hues={{ a: "#e8ae66" }}
        issuesFor={() => []}
        dispatch={vi.fn()}
        outputs={[outputs[0]!]}
      />,
    );
    expect(screen.queryByLabelText("Segment output")).toBeNull();
  });
});
