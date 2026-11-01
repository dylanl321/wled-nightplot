import { describe, expect, it } from "vitest";
import { hitFromShape, initialTool, reduceTool, type ToolPointer, type ToolState } from "./tool-machine";

function pointer(patch: Partial<ToolPointer> & Pick<ToolPointer, "phase" | "button" | "hit">): ToolPointer {
  return {
    type: "pointer",
    pointerType: "mouse",
    moved: false,
    detail: 0,
    shift: false,
    modifierPan: false,
    ...patch,
  };
}

const empty = { kind: "empty" as const };
const wireIn = { kind: "point" as const, id: "c1", role: "wire-in" as const, onlyPoint: false };
const onlyWire = { kind: "point" as const, id: "c1", role: "wire-in" as const, onlyPoint: true };
const tail = { kind: "point" as const, id: "c2", role: "tail" as const, onlyPoint: false };
const corner = { kind: "point" as const, id: "c9", role: "corner" as const, onlyPoint: false };

function click(state: ToolState, hit: ToolPointer["hit"], button: 0 | 1 | 2 = 0, pointerType: ToolPointer["pointerType"] = "mouse") {
  const down = reduceTool(state, pointer({ phase: "down", button, hit, pointerType }));
  return reduceTool(down.state, pointer({ phase: "up", button, hit, pointerType }));
}

describe("tool state machine", () => {
  it("walks idle, tracing, length entry, tracing, idle", () => {
    let step = reduceTool(initialTool("trace"), { type: "key", key: "Enter", typing: false, meta: false, chainPoints: 2 });
    expect(step.state.gesture).toBe("idle");
    expect(step.effect.type).toBe("finishChain");
    step = click(step.state, empty);
    expect(step.state.gesture).toBe("tracing");
    expect(step.effect).toEqual({ type: "place", kind: "lit" });
    step = reduceTool(step.state, { type: "key", key: "6", typing: false, meta: false, chainPoints: 2 });
    expect(step.state.gesture).toBe("lengthEntry");
    expect(step.state.lengthDraft).toBe("6");
    step = reduceTool(step.state, { type: "key", key: "Escape", typing: false, meta: false, chainPoints: 2 });
    expect(step.state.gesture).toBe("tracing");
    expect(step.state.lengthDraft).toBe("");
    expect(step.effect.type).toBe("clearLength");
    step = reduceTool(step.state, { type: "key", key: "Enter", typing: false, meta: false, chainPoints: 2 });
    expect(step.state.gesture).toBe("idle");
  });

  it("walks the edit gestures back to idle", () => {
    const edit = initialTool("edit");
    for (const [hit, gesture] of [
      [corner, "draggingPoint"],
      [{ kind: "run", id: "e1" }, "draggingRun"],
    ] as const) {
      const down = reduceTool(edit, pointer({ phase: "down", button: 0, hit }));
      expect(down.state.gesture).toBe(gesture);
      const up = reduceTool(down.state, pointer({ phase: "up", button: 0, hit }));
      expect(up.state.gesture).toBe("idle");
      expect(up.effect.type).toBe("endGesture");
    }
    const box = reduceTool(edit, pointer({ phase: "down", button: 0, hit: empty, shift: true }));
    expect(box.state.gesture).toBe("boxSelecting");
    expect(reduceTool(box.state, pointer({ phase: "up", button: 0, hit: empty, shift: true })).state.gesture).toBe("idle");
    const pan = reduceTool(edit, pointer({ phase: "down", button: 1, hit: empty, modifierPan: true }));
    expect(pan.state.gesture).toBe("panning");
    expect(pan.state.press).toEqual({ button: 1, pointerType: "mouse" });
    expect(reduceTool(pan.state, pointer({ phase: "up", button: 1, hit: empty, modifierPan: true })).state.gesture).toBe("idle");
  });

  it("tells mouse buttons and touch apart", () => {
    const tracing = initialTool("trace");
    expect(click(tracing, empty, 0, "touch").effect).toEqual({ type: "place", kind: "lit" });
    expect(click(tracing, empty, 0, "pen").effect).toEqual({ type: "place", kind: "lit" });
    expect(click(tracing, empty, 2, "mouse").effect).toEqual({ type: "place", kind: "wire" });
    const dark = reduceTool(tracing, { type: "key", key: "d", typing: false, meta: false, chainPoints: 1 });
    expect(dark.state.nextRun).toBe("dark");
    expect(click(dark.state, empty, 0, "mouse").effect).toEqual({ type: "place", kind: "wire" });
    expect(click(dark.state, empty, 2, "mouse").effect).toEqual({ type: "place", kind: "lit" });
    expect(reduceTool(tracing, { type: "key", key: "d", typing: true, meta: false, chainPoints: 1 }).state.nextRun).toBe("lit");
  });

  it("Backspace on a one-point chain keeps the wire-in, and a longer chain pops the tail", () => {
    const tracing = initialTool("trace");
    const stuck = reduceTool(tracing, { type: "key", key: "Backspace", typing: false, meta: false, chainPoints: 1 });
    expect(stuck.effect.type).toBe("refuseWireIn");
    expect(stuck.state.gesture).toBe("tracing");
    const popped = reduceTool(tracing, { type: "key", key: "Backspace", typing: false, meta: false, chainPoints: 3 });
    expect(popped.effect.type).toBe("popTail");
    expect(popped.state.gesture).toBe("tracing");
  });

  it("right-click on the wire-in is refused unless it is the only point", () => {
    const tracing = initialTool("trace");
    const refused = click(tracing, wireIn, 2);
    expect(refused.effect.type).toBe("refuseWireIn");
    expect(refused.state.gesture).toBe("tracing");
    expect(click(tracing, onlyWire, 2).effect.type).toBe("removeWireIn");
    expect(click(tracing, tail, 0).effect).toEqual({ type: "removePoint", pointId: "c2" });
    expect(click(tracing, corner, 0).effect).toEqual({ type: "join", pointId: "c9", kind: "lit" });
    expect(click(tracing, corner, 2).effect).toEqual({ type: "removePoint", pointId: "c9" });
  });

  it("a drag does not place, and a double-click finishes the chain", () => {
    const tracing = initialTool("trace");
    const down = reduceTool(tracing, pointer({ phase: "down", button: 0, hit: empty }));
    const dragged = reduceTool(down.state, pointer({ phase: "up", button: 0, hit: empty, moved: true }));
    expect(dragged.effect.type).toBe("none");
    expect(dragged.state.gesture).toBe("tracing");
    const doubled = reduceTool(tracing, pointer({ phase: "up", button: 0, hit: empty, detail: 2 }));
    expect(doubled.effect.type).toBe("finishChain");
    expect(doubled.state.gesture).toBe("idle");
  });

  it("a finger tap selects a point, and a hold removes it", () => {
    const tracing = initialTool("trace");
    expect(click(tracing, tail, 0, "touch").effect).toEqual({ type: "selectPoint", pointId: "c2" });
    expect(click(tracing, corner, 0, "touch").effect).toEqual({ type: "selectPoint", pointId: "c9" });
    expect(click(tracing, wireIn, 0, "touch").effect).toEqual({ type: "selectPoint", pointId: "c1" });
    const held = reduceTool(tracing, pointer({ phase: "up", button: 0, hit: corner, pointerType: "touch", held: true }));
    expect(held.effect).toEqual({ type: "removePoint", pointId: "c9" });
    expect(held.state.gesture).toBe("tracing");
    const wire = reduceTool(tracing, pointer({ phase: "up", button: 0, hit: wireIn, pointerType: "touch", held: true }));
    expect(wire.effect.type).toBe("refuseWireIn");
    const only = reduceTool(tracing, pointer({ phase: "up", button: 0, hit: onlyWire, pointerType: "touch", held: true }));
    expect(only.effect.type).toBe("removeWireIn");
    const slid = reduceTool(tracing, pointer({ phase: "up", button: 0, hit: tail, pointerType: "touch", moved: true }));
    expect(slid.effect.type).toBe("none");
    const edit = reduceTool(initialTool("edit"), pointer({ phase: "up", button: 0, hit: corner, pointerType: "touch" }));
    expect(edit.effect).toEqual({ type: "selectPoint", pointId: "c9" });
    expect(edit.state.gesture).toBe("idle");
  });

  it("reads point and run names off the canvas", () => {
    expect(hitFromShape("np:point:c1", { tailId: "c2", wireInIds: ["c1"], onlyPoint: false })).toEqual(wireIn);
    expect(hitFromShape("np:point:c2", { tailId: "c2", wireInIds: ["c1"], onlyPoint: false })).toEqual(tail);
    expect(hitFromShape("np:run:e4", { tailId: "c2", wireInIds: ["c1"], onlyPoint: false })).toEqual({ kind: "run", id: "e4" });
    expect(hitFromShape(null, { tailId: "c2", wireInIds: ["c1"], onlyPoint: false })).toEqual(empty);
  });
});
