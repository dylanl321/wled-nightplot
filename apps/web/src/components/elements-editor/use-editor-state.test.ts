import type { Element } from "@nightplot/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { beadCenterY, boundaryX, hitFromSvg } from "./ops";
import { editorReducer, initialEditorState, useEditorState } from "./use-editor-state";

function door(start = 10, stop = 20): Element {
  return { id: "a", lightId: "l", label: "Door", start, stop };
}

describe("editor reducer", () => {
  it("keeps the cursor after leaving and locates without changing ranges", () => {
    let state = initialEditorState([door()], 30, "l");
    state = editorReducer(state, { type: "cursor-set", index: 12 });
    state = editorReducer(state, { type: "leave" });
    state = editorReducer(state, { type: "cursor-step", delta: 100 });
    expect(state.cursor).toBe(29);
    expect(state.hover).toBeNull();
    expect(state.els).toEqual([door()]);
    expect(state.hist).toHaveLength(0);
  });

  it("marks a range in either direction and includes the final LED", () => {
    let state = initialEditorState([], 30, "l");
    state = editorReducer(state, { type: "cursor-set", index: 7 });
    state = editorReducer(state, { type: "mark-start" });
    state = editorReducer(state, { type: "cursor-set", index: 3 });
    state = editorReducer(state, { type: "mark-end" });
    expect(state.ledSel).toMatchObject({ start: 3, stop: 8 });
    state = editorReducer(state, { type: "new-from-sel" });
    expect(state.els[0]).toMatchObject({ start: 3, stop: 8, label: "Segment 1" });
    state = editorReducer(state, { type: "undo" });
    expect(state.els).toEqual([]);
  });

  it("undo after a drag restores the pre-drag Segments in one step", () => {
    let state = initialEditorState([door()], 100, "l");
    const down = hitFromSvg(boundaryX(12, 0) + 4, beadCenterY(0), 100);
    state = editorReducer(state, { type: "down", hit: down, shift: false });
    const moved = hitFromSvg(boundaryX(22, 0) + 4, beadCenterY(0), 100);
    state = editorReducer(state, { type: "move", hit: moved });
    state = editorReducer(state, { type: "up" });
    expect(state.els[0]).toMatchObject({ start: 20, stop: 30 });
    expect(state.hist).toHaveLength(1);
    state = editorReducer(state, { type: "undo" });
    expect(state.els[0]).toMatchObject({ start: 10, stop: 20 });
    expect(state.hist).toHaveLength(0);
  });

  it("clamps a keyboard nudge at the strip start", () => {
    const { result } = renderHook(() => useEditorState([door(0, 10)], 30, "l"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(result.current.state.els[0]).toMatchObject({ start: 0, stop: 10 });
  });

  it("ignores nudges while an input is focused", () => {
    const { result } = renderHook(() => useEditorState([door(5, 10)], 30, "l"));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(result.current.state.els[0]).toMatchObject({ start: 5, stop: 10 });
    input.remove();
  });

  it("keeps a dirty draft when saved Segments are unchanged, and adopts a new strip length", () => {
    const saved = [door(0, 10)];
    let state = initialEditorState(saved, 30, "l");
    state = editorReducer(state, { type: "nudge", delta: 1 });
    expect(state.els[0]?.start).toBe(1);
    state = editorReducer(state, {
      type: "server",
      previous: saved,
      next: saved,
      lengthChanged: false,
      ledCount: 30,
    });
    expect(state.els[0]?.start).toBe(1);
    const clipped = [{ ...door(0, 10), stop: 8 }];
    state = editorReducer(state, {
      type: "server",
      previous: saved,
      next: clipped,
      lengthChanged: true,
      ledCount: 8,
    });
    expect(state.els).toEqual(clipped);
    expect(state.ledCount).toBe(8);
    expect(state.hist).toHaveLength(0);
  });
});
