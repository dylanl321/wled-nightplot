import { describe, expect, it } from "vitest";
import { idleGesture, reduceGesture } from "./gestures.ts";

describe("prop editor gestures", () => {
  it("commits a traced corner only when the finger lifts", () => {
    let state = idleGesture("trace");
    const down = reduceGesture(state, { type: "down", pointerId: 1, x: 10, y: 20, t: 0, hit: { kind: "empty" } });
    expect(down.effects).toEqual([{ type: "preview", x: 10, y: 20 }]);
    expect(down.effects.some((effect) => effect.type === "commit")).toBe(false);
    const moved = reduceGesture(down.state, { type: "move", pointerId: 1, x: 14, y: 22, t: 20 });
    expect(moved.effects[0]).toEqual({ type: "preview", x: 14, y: 22 });
    const up = reduceGesture(moved.state, { type: "up", pointerId: 1, x: 14, y: 22, t: 40 });
    expect(up.effects).toEqual([{ type: "commit", x: 14, y: 22 }]);
  });

  it("cancels a pending corner when a second finger lands, and ignores the next tap", () => {
    const down = reduceGesture(idleGesture("trace"), { type: "down", pointerId: 1, x: 0, y: 0, t: 0, hit: { kind: "empty" } });
    const second = reduceGesture(down.state, { type: "down", pointerId: 2, x: 30, y: 0, t: 10, hit: { kind: "empty" } });
    expect(second.effects).toEqual([{ type: "cancel" }]);
    expect(second.state.pendingId).toBeNull();
    expect(second.state.pinching).toBe(true);
    const up1 = reduceGesture(second.state, { type: "up", pointerId: 1, x: 0, y: 0, t: 40 });
    const up2 = reduceGesture(up1.state, { type: "up", pointerId: 2, x: 30, y: 0, t: 50 });
    expect(up2.state.ignoreUntil).toBe(290);
    const ignored = reduceGesture(up2.state, { type: "down", pointerId: 3, x: 4, y: 4, t: 100, hit: { kind: "empty" } });
    expect(ignored.effects).toEqual([]);
    expect(ignored.state.pendingId).toBeNull();
  });

  it("keeps a gesture that starts on a corner as a drag", () => {
    const down = reduceGesture(idleGesture("trace"), { type: "down", pointerId: 1, x: 0, y: 0, t: 0, hit: { kind: "corner", id: "c1" } });
    expect(down.state.pendingId).toBeNull();
    expect(down.state.drag?.cornerId).toBe("c1");
    const moved = reduceGesture(down.state, { type: "move", pointerId: 1, x: 5, y: 0, t: 10 });
    expect(moved.effects).toEqual([{ type: "drag", cornerId: "c1", x: 5, y: 0 }]);
  });

  it("pans with one finger on empty canvas only in Edit", () => {
    const down = reduceGesture(idleGesture("edit"), { type: "down", pointerId: 1, x: 0, y: 0, t: 0, hit: { kind: "empty" } });
    const moved = reduceGesture(down.state, { type: "move", pointerId: 1, x: 8, y: 3, t: 10 });
    expect(moved.effects).toEqual([{ type: "pan", dx: 8, dy: 3 }]);
  });

  it("starts the ignore window after Fit", () => {
    const fit = reduceGesture(idleGesture("trace"), { type: "fit", t: 10 });
    expect(fit.state.ignoreUntil).toBe(260);
    const down = reduceGesture(fit.state, { type: "down", pointerId: 1, x: 1, y: 1, t: 20, hit: { kind: "empty" } });
    expect(down.state.pendingId).toBeNull();
  });
});
