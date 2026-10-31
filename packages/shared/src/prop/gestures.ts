/**
 * Pointer decisions for the prop editor. Nothing is committed before the
 * finger lifts. A second finger before that lift cancels a pending corner.
 */

export type GestureMode = "trace" | "edit";

export type GestureHit =
  | { kind: "empty" }
  | { kind: "corner"; id: string }
  | { kind: "edge"; id: string };

export type GesturePointer = { id: number; x: number; y: number };

export type GestureState = {
  mode: GestureMode;
  pointers: GesturePointer[];
  pendingId: number | null;
  drag: { pointerId: number; cornerId: string; moved: boolean } | null;
  pinching: boolean;
  ignoreUntil: number;
};

export type GestureEvent =
  | { type: "down"; pointerId: number; x: number; y: number; t: number; hit: GestureHit }
  | { type: "move"; pointerId: number; x: number; y: number; t: number }
  | { type: "up"; pointerId: number; x: number; y: number; t: number }
  | { type: "fit"; t: number };

export type GestureEffect =
  | { type: "preview"; x: number; y: number }
  | { type: "commit"; x: number; y: number }
  | { type: "drag"; cornerId: string; x: number; y: number }
  | { type: "commit-drag"; cornerId: string; x: number; y: number; tap: boolean }
  | { type: "cancel" }
  | { type: "pan"; dx: number; dy: number }
  | { type: "pinch"; ratio: number; cx: number; cy: number }
  | { type: "edge"; id: string };

export function idleGesture(mode: GestureMode): GestureState {
  return { mode, pointers: [], pendingId: null, drag: null, pinching: false, ignoreUntil: 0 };
}

export function reduceGesture(state: GestureState, event: GestureEvent): { state: GestureState; effects: GestureEffect[] } {
  switch (event.type) {
    case "down":
      return onDown(state, event);
    case "move":
      return onMove(state, event);
    case "up":
      return onUp(state, event);
    case "fit":
      return { state: { ...state, ignoreUntil: event.t + 250, pendingId: null }, effects: [{ type: "cancel" }] };
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

function onDown(state: GestureState, event: Extract<GestureEvent, { type: "down" }>): { state: GestureState; effects: GestureEffect[] } {
  const pointers = upsert(state.pointers, event);
  if (state.pendingId != null && event.pointerId !== state.pendingId) {
    return {
      state: { ...state, pointers, pendingId: null, pinching: true, drag: null },
      effects: [{ type: "cancel" }],
    };
  }
  if (pointers.length >= 2) {
    return { state: { ...state, pointers, pendingId: null, drag: null, pinching: true }, effects: [{ type: "cancel" }] };
  }
  if (event.t < state.ignoreUntil) {
    return { state: { ...state, pointers }, effects: [] };
  }
  if (event.hit.kind === "corner") {
    return {
      state: { ...state, pointers, drag: { pointerId: event.pointerId, cornerId: event.hit.id, moved: false }, pendingId: null },
      effects: [],
    };
  }
  if (event.hit.kind === "edge") {
    return { state: { ...state, pointers, pendingId: null }, effects: [{ type: "edge", id: event.hit.id }] };
  }
  if (state.mode === "edit") {
    return { state: { ...state, pointers, drag: { pointerId: event.pointerId, cornerId: "", moved: false } }, effects: [] };
  }
  return {
    state: { ...state, pointers, pendingId: event.pointerId },
    effects: [{ type: "preview", x: event.x, y: event.y }],
  };
}

function onMove(state: GestureState, event: Extract<GestureEvent, { type: "move" }>): { state: GestureState; effects: GestureEffect[] } {
  const pointers = upsert(state.pointers, event);
  if (state.pinching || pointers.length >= 2) {
    const [a, b] = pointers;
    if (!a || !b) return { state: { ...state, pointers, pinching: true }, effects: [] };
    const previous = state.pointers;
    const [pa, pb] = previous;
    const effects: GestureEffect[] = [];
    if (pa && pb && previous.length >= 2) {
      const before = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const after = Math.hypot(b.x - a.x, b.y - a.y);
      if (before > 0 && Math.abs(after - before) > 0.5) {
        effects.push({ type: "pinch", ratio: after / before, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
      } else {
        effects.push({ type: "pan", dx: (a.x + b.x) / 2 - (pa.x + pb.x) / 2, dy: (a.y + b.y) / 2 - (pa.y + pb.y) / 2 });
      }
    }
    return { state: { ...state, pointers, pinching: true, pendingId: null }, effects };
  }
  if (state.pendingId === event.pointerId) {
    return { state: { ...state, pointers }, effects: [{ type: "preview", x: event.x, y: event.y }] };
  }
  if (state.drag?.pointerId === event.pointerId) {
    if (state.drag.cornerId === "") {
      const previous = state.pointers.find((pointer) => pointer.id === event.pointerId);
      const dx = previous ? event.x - previous.x : 0;
      const dy = previous ? event.y - previous.y : 0;
      return { state: { ...state, pointers, drag: { ...state.drag, moved: true } }, effects: [{ type: "pan", dx, dy }] };
    }
    return {
      state: { ...state, pointers, drag: { ...state.drag, moved: true } },
      effects: [{ type: "drag", cornerId: state.drag.cornerId, x: event.x, y: event.y }],
    };
  }
  return { state: { ...state, pointers }, effects: [] };
}

function onUp(state: GestureState, event: Extract<GestureEvent, { type: "up" }>): { state: GestureState; effects: GestureEffect[] } {
  const pointers = state.pointers.filter((pointer) => pointer.id !== event.pointerId);
  if (state.pinching) {
    const still = pointers.length >= 2;
    return {
      state: { ...state, pointers, pinching: still, pendingId: null, drag: null, ignoreUntil: still ? state.ignoreUntil : event.t + 250 },
      effects: [],
    };
  }
  if (state.pendingId === event.pointerId) {
    return {
      state: { ...state, pointers, pendingId: null },
      effects: [{ type: "commit", x: event.x, y: event.y }],
    };
  }
  if (state.drag?.pointerId === event.pointerId && state.drag.cornerId) {
    return {
      state: { ...state, pointers, drag: null },
      effects: [{ type: "commit-drag", cornerId: state.drag.cornerId, x: event.x, y: event.y, tap: !state.drag.moved }],
    };
  }
  return { state: { ...state, pointers, drag: null }, effects: [] };
}

function upsert(pointers: GesturePointer[], event: { pointerId: number; x: number; y: number }): GesturePointer[] {
  const next = pointers.filter((pointer) => pointer.id !== event.pointerId);
  next.push({ id: event.pointerId, x: event.x, y: event.y });
  return next;
}
