import type { Element } from "@nightplot/shared";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { beadCenterY, boundaryX, hitFromSvg } from "./ops";
import { editorReducer, initialEditorState, useEditorState } from "./use-editor-state";
import { readDraft, writeDraft } from "./draft-storage";

function door(start = 10, stop = 20): Element {
  return { id: "a", lightId: "l", label: "Door", start, stop };
}

describe("editor reducer", () => {
  beforeEach(() => window.localStorage.clear());
  function hit(index: number) {
    const row = Math.floor(index / 100);
    return hitFromSvg(boundaryX(index, row) + 4.6, beadCenterY(row), 100);
  }
  function click(index: number, state = initialEditorState([door()], 100, "l")) {
    return editorReducer(editorReducer(state, { type: "down", hit: hit(index), shift: false }), { type: "up" });
  }

  it("focuses an edge LED and moves the boundary and cursor together", () => {
    let state = click(19);
    expect(state.focus).toEqual({ kind: "edge", id: "a", which: "end" });
    expect(state.els).toEqual([door()]);
    state = editorReducer(state, { type: "arrow", delta: 1 });
    expect(state.els[0]?.stop).toBe(21);
    expect(state.cursor).toBe(20);
    expect(state.menuOpen).toBe(false);
  });

  it("shifts a body and grows or shrinks a free selection from its anchor", () => {
    let state = editorReducer(click(15), { type: "arrow", delta: 3 });
    expect(state.els[0]).toMatchObject({ start: 13, stop: 23 });
    expect(state.cursor).toBe(18);
    state = click(30, state);
    expect(state.menuOpen).toBe(false);
    state = editorReducer(state, { type: "arrow", delta: 3 });
    expect(state.ledSel).toEqual({ start: 30, stop: 34, anchor: 30 });
    state = editorReducer(state, { type: "arrow", delta: -5 });
    expect(state.ledSel).toEqual({ start: 28, stop: 31, anchor: 30 });
    expect(state.cursor).toBe(28);
  });

  it("cycles focus in both directions and escapes one level at a time", () => {
    let state = click(15);
    state = editorReducer(state, { type: "focus-cycle" });
    expect(state.focus).toEqual({ kind: "edge", id: "a", which: "start" });
    state = editorReducer(state, { type: "focus-cycle" });
    expect(state.focus).toEqual({ kind: "edge", id: "a", which: "end" });
    state = editorReducer(state, { type: "focus-cycle" });
    expect(state.focus.kind).toBe("seg");
    state = editorReducer(state, { type: "focus-cycle", back: true });
    expect(state.focus).toEqual({ kind: "edge", id: "a", which: "end" });
    state = editorReducer(state, { type: "escape" });
    expect(state.focus.kind).toBe("seg");
    state = editorReducer(state, { type: "escape" });
    expect(state.focus.kind).toBe("cursor");
    expect(state.sel).toEqual([]);
  });

  it("coalesces consecutive arrows, but splits undo at a new target, edit, or timeout", () => {
    let state = click(19);
    for (let i = 0; i < 5; i++) state = editorReducer(state, { type: "arrow", delta: 1, at: 100 + i * 100 });
    expect(state.hist).toHaveLength(1);
    expect(editorReducer(state, { type: "undo" }).els).toEqual([door()]);
    state = editorReducer(state, { type: "arrow", delta: 1, at: 1800 });
    expect(state.hist).toHaveLength(2);
    state = editorReducer(state, { type: "focus-set", id: "a", what: "start" });
    state = editorReducer(state, { type: "arrow", delta: 1, at: 1900 });
    expect(state.hist).toHaveLength(3);
    state = editorReducer(state, { type: "label", value: "Renamed" });
    state = editorReducer(state, { type: "arrow", delta: 1, at: 2000 });
    expect(state.hist).toHaveLength(5);
  });

  it("keeps edge clicks under the drag threshold unchanged", () => {
    let state = initialEditorState([door()], 100, "l");
    const down = hit(19);
    state = editorReducer(state, { type: "down", hit: down, shift: false });
    state = editorReducer(state, { type: "move", hit: { ...down, x: down.x + 3, b: 21 } });
    state = editorReducer(state, { type: "up" });
    expect(state.els).toEqual([door()]);
    expect(state.hist).toHaveLength(0);
  });

  it("uses the same shared-edge operation for drags and Alt detaching", () => {
    let state = initialEditorState([door(), { ...door(20, 30), id: "b", label: "Eave" }], 100, "l");
    state = editorReducer(state, { type: "down", hit: hit(19), shift: false });
    state = editorReducer(state, { type: "move", hit: { ...hit(24), b: 24 } });
    expect(state.els.map((el) => [el.start, el.stop])).toEqual([[10, 24], [24, 30]]);
    expect(state.cursor).toBe(23);
    state = editorReducer(state, { type: "move", hit: { ...hit(17), b: 17 }, alt: true });
    expect(state.els.map((el) => [el.start, el.stop])).toEqual([[10, 17], [20, 30]]);
    state = editorReducer(state, { type: "up" });
    expect(state.hist).toHaveLength(1);
  });

  it("opens options on drag release and Enter, and Escape closes before clearing", () => {
    let state = click(30);
    expect(state.menuOpen).toBe(false);
    state = editorReducer(state, { type: "menu-toggle" });
    expect(state.menuOpen).toBe(true);
    state = editorReducer(state, { type: "escape" });
    expect(state.ledSel).not.toBeNull();
    expect(state.menuOpen).toBe(false);
    state = editorReducer(state, { type: "down", hit: hit(30), shift: false });
    state = editorReducer(state, { type: "move", hit: hit(35) });
    state = editorReducer(state, { type: "up" });
    expect(state.menuOpen).toBe(true);
    expect(state.ledSel).toMatchObject({ start: 30, stop: 36 });
  });

  it("keeps hover separate from focus unless Locate is active", () => {
    let state = click(15);
    state = editorReducer(state, { type: "hover", hover: hit(70) });
    expect(state.cursor).toBe(15);
    state = editorReducer(state, { type: "tool", mode: "locate" });
    state = editorReducer(state, { type: "hover", hover: hit(70) });
    expect(state.cursor).toBe(70);
    expect(state.focus.kind).toBe("cursor");
    expect(state.els).toEqual([door()]);
  });

  it("supports arrows after a button click, Enter options, Tab, and Shift stepping", () => {
    const { result } = renderHook(() => useEditorState([door()], 100, "l"));
    const button = document.createElement("button");
    document.body.appendChild(button);
    act(() => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, shiftKey: true }));
    });
    expect(result.current.state.els[0]).toMatchObject({ start: 20, stop: 30 });
    act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(result.current.state.focus).toMatchObject({ kind: "edge", which: "start" });
    button.remove();
  });

  it("explains blocked shared edges without creating an undo step", () => {
    let state = click(19, initialEditorState([door(), { ...door(20, 21), id: "b", label: "Gable" }], 100, "l"));
    state = editorReducer(state, { type: "arrow", delta: 1 });
    expect(state.toast).toBe("Gable can't get shorter than 1 LED");
    expect(state.hist).toHaveLength(0);
    state = editorReducer(state, { type: "arrow", delta: 1, alt: true });
    expect(state.toast).toContain("Let go of Alt / ⌥");
    expect(state.hist).toHaveLength(0);
  });

  it("falls back when undo removes the focused Segment and clamps the cursor on a length change", () => {
    let state = click(35);
    state = editorReducer(state, { type: "new-from-sel" });
    expect(state.focus.kind).toBe("seg");
    state = editorReducer(state, { type: "undo" });
    expect(state.focus.kind).toBe("cursor");
    state = editorReducer(state, { type: "server", previous: state.saved, next: [door(0, 5)], ledCount: 5, lengthChanged: true });
    expect(state.cursor).toBe(4);
  });

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

  it("keeps a dirty draft when saved Segments are unchanged, and flags a new strip length", () => {
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
    expect(state.els[0]?.start).toBe(1);
    expect(state.ledCount).toBe(8);
    expect(state.draftConflict).toBe(true);
  });

  it("restores a Light's dirty Segments after reload and removes the draft after revert", () => {
    const first = renderHook(() => useEditorState([door()], 100, "l"));
    act(() => first.result.current.dispatch({ type: "nudge", delta: 1 }));
    expect(readDraft("l")?.draft[0]?.start).toBe(11);
    expect(readDraft("another-light")).toBeNull();
    first.unmount();
    const reloaded = renderHook(() => useEditorState([door()], 100, "l"));
    expect(reloaded.result.current.state.els[0]?.start).toBe(11);
    expect(reloaded.result.current.dirtyCount).toBe(1);
    expect(reloaded.result.current.state.draftConflict).toBe(false);
    act(() => reloaded.result.current.dispatch({ type: "revert" }));
    expect(readDraft("l")).toBeNull();
  });

  it("requires review if the saved Segments changed while the draft was away", () => {
    writeDraft("l", { saved: [door()], draft: [door(11, 20)], ledCount: 100 });
    const { result } = renderHook(() => useEditorState([door(12, 20)], 100, "l"));
    expect(result.current.state.els[0]?.start).toBe(11);
    expect(result.current.state.saved[0]?.start).toBe(12);
    expect(result.current.state.draftConflict).toBe(true);
    act(() => result.current.dispatch({ type: "resolve-draft" }));
    expect(result.current.state.draftConflict).toBe(false);
    expect(readDraft("l")?.draft[0]?.start).toBe(11);
  });

  it("preserves a colour-only edit and clears the draft when the server saves it", () => {
    const first = renderHook(() => useEditorState([door()], 100, "l"));
    act(() => first.result.current.dispatch({ type: "color", hex: "#aabbcc", white: 12 }));
    expect(first.result.current.dirtyCount).toBe(1);
    expect(readDraft("l")?.draft[0]?.color).toEqual({ hex: "#aabbcc", white: 12 });
    const saved = [door()];
    const next = [{ ...door(), color: { hex: "#aabbcc", white: 12 } }];
    act(() => first.result.current.dispatch({ type: "server", previous: saved, next,
      lengthChanged: false, ledCount: 100 }));
    expect(first.result.current.dirtyCount).toBe(0);
    expect(readDraft("l")).toBeNull();
  });

  it("rejects corrupt or wrong-Light draft data", () => {
    window.localStorage.setItem("nightplot:segment-draft:v1:l", "{broken");
    expect(readDraft("l")).toBeNull();
    writeDraft("l", { saved: [door()], draft: [door(11, 20)], ledCount: 100 });
    const data = readDraft("l")!;
    writeDraft("other", data);
    expect(readDraft("other")).toBeNull();
  });
});
