import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeysBar } from "./keys-bar";
import { initialEditorState, type Focus } from "./use-editor-state";

const elements = [
  { id: "a", lightId: "l", label: "Eave", start: 0, stop: 10 },
  { id: "b", lightId: "l", label: "Gable", start: 10, stop: 20 },
];

describe("focus keys", () => {
  it.each([
    [{ kind: "cursor" }, "move the cursor", "select Eave"],
    [{ kind: "sel" }, "grow or shrink from LED 24", "new Segment"],
    [{ kind: "seg", id: "a" }, "shift the whole Segment", "grab its start edge"],
    [{ kind: "edge", id: "a", which: "end" }, "move the stop edge", "leave Gable where it is"],
  ] as [Focus, string, string][])("describes %j", (focus, action, next) => {
    const state = { ...initialEditorState(elements, 30, "l"), focus,
      ledSel: focus.kind === "sel" ? { start: 24, stop: 28, anchor: 24 } : null };
    render(<KeysBar state={state} hues={{ a: "#d4a574" }} live spacingMm={10} />);
    expect(screen.getByText(action)).toBeTruthy();
    expect(screen.getByText(next)).toBeTruthy();
    if (focus.kind === "edge") {
      expect(screen.getByText(/Shared with Gable/)).toBeTruthy();
      expect(screen.getByText(/bright LED on the strip is its last LED/)).toBeTruthy();
    }
  });
});
