/**
 * Trace and edit gestures. The canvas forwards pointer and key events here
 * and does what the effect says. It does not decide what a click means.
 *
 * Trace: idle → tracing → lengthEntry → tracing → idle.
 * Edit: idle → draggingPoint | draggingRun | boxSelecting | panning → idle.
 * Length entry is accepted so a digit does not fall through; typing the
 * length itself is a later phase. The first Escape in length entry only
 * clears the draft.
 */

export type PointerButton = 0 | 1 | 2;
export type PointerKind = "mouse" | "touch" | "pen";
export type RunChoice = "lit" | "dark";
export type PointRole = "wire-in" | "tail" | "corner";

export type ToolHit =
  | { kind: "empty" }
  | { kind: "point"; id: string; role: PointRole; onlyPoint: boolean }
  | { kind: "run"; id: string };

export type ToolGesture =
  | "idle"
  | "tracing"
  | "lengthEntry"
  | "draggingPoint"
  | "draggingRun"
  | "boxSelecting"
  | "panning";

export type ToolState = {
  mode: "trace" | "edit";
  gesture: ToolGesture;
  /** Left click uses this. Right click uses the opposite. */
  nextRun: RunChoice;
  lengthDraft: string;
  dragId: string | null;
  press: { button: PointerButton; pointerType: PointerKind } | null;
};

/** A still finger on a point for this long removes it. */
export const LONG_PRESS_MS = 500;

export type ToolPointer = {
  type: "pointer";
  phase: "down" | "move" | "up" | "cancel";
  button: PointerButton;
  pointerType: PointerKind;
  hit: ToolHit;
  /** True once the pointer has moved past the tap slop. */
  moved: boolean;
  /** True when a finger stayed on a point for `LONG_PRESS_MS`. */
  held?: boolean;
  /** 2 is the second click of a double-click. */
  detail: number;
  shift: boolean;
  /** Space or the middle button: pan, never a point. */
  modifierPan: boolean;
};

export type ToolEvent =
  | ToolPointer
  | { type: "key"; key: string; typing: boolean; meta: boolean; chainPoints: number }
  | { type: "mode"; mode: "trace" | "edit" }
  | { type: "toggleNext" };

export type ToolEffect =
  | { type: "none" }
  | { type: "preview" }
  | { type: "place"; kind: "lit" | "wire" }
  | { type: "join"; pointId: string; kind: "lit" | "wire" }
  | { type: "removePoint"; pointId: string }
  | { type: "selectPoint"; pointId: string }
  | { type: "popTail" }
  | { type: "refuseWireIn" }
  | { type: "removeWireIn" }
  | { type: "finishChain" }
  | { type: "clearLength" }
  | { type: "toggleNext" }
  | { type: "endGesture" };

export type ToolStep = { state: ToolState; effect: ToolEffect };

export function initialTool(mode: "trace" | "edit", nextRun: RunChoice = "lit"): ToolState {
  return {
    mode,
    gesture: mode === "trace" ? "tracing" : "idle",
    nextRun,
    lengthDraft: "",
    dragId: null,
    press: null,
  };
}

export function reduceTool(state: ToolState, event: ToolEvent): ToolStep {
  switch (event.type) {
    case "pointer":
      return onPointer(state, event);
    case "key":
      return onKey(state, event);
    case "mode":
      return modeOf(state, event.mode);
    case "toggleNext":
      return { state: { ...state, nextRun: state.nextRun === "lit" ? "dark" : "lit" }, effect: { type: "toggleNext" } };
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

/** `np:point:<id>` and `np:run:<id>` are the only names the canvas sets. */
export function hitFromShape(
  shapeName: string | null,
  input: { tailId: string; wireInIds: readonly string[]; onlyPoint: boolean },
): ToolHit {
  if (!shapeName?.startsWith("np:")) return { kind: "empty" };
  if (shapeName.startsWith("np:point:")) {
    const id = shapeName.slice("np:point:".length);
    const role: PointRole = input.wireInIds.includes(id) ? "wire-in" : id === input.tailId ? "tail" : "corner";
    return { kind: "point", id, role, onlyPoint: input.onlyPoint };
  }
  if (shapeName.startsWith("np:run:")) return { kind: "run", id: shapeName.slice("np:run:".length) };
  return { kind: "empty" };
}

function onPointer(state: ToolState, event: ToolPointer): ToolStep {
  if (event.modifierPan || event.button === 1) return pan(state, event);
  if (event.phase === "cancel") return release(state);
  // A finger has no right-click. A tap selects the point; a still hold removes it.
  if (event.phase === "up" && event.pointerType !== "mouse" && !event.moved && event.hit.kind === "point") {
    return touchPoint(state, event);
  }
  if (state.mode === "edit") return editPointer(state, event);
  return tracePointer(state, event);
}

function touchPoint(state: ToolState, event: ToolPointer): ToolStep {
  const hit = event.hit;
  if (hit.kind !== "point") return { state, effect: { type: "none" } };
  const gesture = state.mode === "trace" && state.gesture !== "idle" ? "tracing" : "idle";
  const next: ToolState = { ...state, gesture, press: null, dragId: null, lengthDraft: "" };
  if (event.held) {
    if (hit.role === "wire-in" && !hit.onlyPoint) return { state: next, effect: { type: "refuseWireIn" } };
    if (hit.role === "wire-in") return { state: next, effect: { type: "removeWireIn" } };
    return { state: next, effect: { type: "removePoint", pointId: hit.id } };
  }
  return { state: next, effect: { type: "selectPoint", pointId: hit.id } };
}

function tracePointer(state: ToolState, event: ToolPointer): ToolStep {
  if (event.phase === "down") {
    const pressed = { ...state, press: { button: event.button, pointerType: event.pointerType } };
    if (event.hit.kind === "empty" && (state.gesture === "tracing" || state.gesture === "idle" || state.gesture === "lengthEntry")) {
      return { state: pressed, effect: { type: "preview" } };
    }
    return { state: pressed, effect: { type: "none" } };
  }
  if (event.phase === "move") {
    if (event.moved && state.press) return { state, effect: { type: "none" } };
    if (state.gesture === "tracing" || state.gesture === "lengthEntry") return { state, effect: { type: "preview" } };
    return { state, effect: { type: "none" } };
  }
  const next = { ...state, press: null };
  if (event.moved || state.gesture === "lengthEntry") return { state: next, effect: { type: "none" } };
  if (event.detail >= 2) return finish(next);
  return click(next, event);
}

function click(state: ToolState, event: ToolPointer): ToolStep {
  const kind = kindFor(state.nextRun, event.button);
  const hit = event.hit;
  if (hit.kind === "empty") return act(state, { type: "place", kind }, true);
  if (hit.kind === "run") return { state, effect: { type: "none" } };
  if (hit.role === "wire-in" && event.button === 2) {
    return { state, effect: hit.onlyPoint ? { type: "removeWireIn" } : { type: "refuseWireIn" } };
  }
  if (hit.role === "tail" || event.button === 2) return { state, effect: { type: "removePoint", pointId: hit.id } };
  return act(state, { type: "join", pointId: hit.id, kind }, true);
}

function editPointer(state: ToolState, event: ToolPointer): ToolStep {
  if (event.phase === "down") {
    const press = { button: event.button, pointerType: event.pointerType };
    if (event.button === 2) return { state: { ...state, press }, effect: { type: "none" } };
    if (event.hit.kind === "point") {
      return { state: { ...state, gesture: "draggingPoint", dragId: event.hit.id, press }, effect: { type: "none" } };
    }
    if (event.hit.kind === "run") {
      return { state: { ...state, gesture: "draggingRun", dragId: event.hit.id, press }, effect: { type: "none" } };
    }
    if (event.shift) {
      return { state: { ...state, gesture: "boxSelecting", press }, effect: { type: "none" } };
    }
    return { state: { ...state, press }, effect: { type: "none" } };
  }
  if (event.phase === "move") {
    if (state.gesture === "idle" && event.moved && state.press?.button === 0 && event.hit.kind === "empty") {
      const gesture = event.shift ? "boxSelecting" : "panning";
      return { state: { ...state, gesture }, effect: { type: "none" } };
    }
    return { state, effect: { type: "none" } };
  }
  if (state.gesture === "draggingPoint" || state.gesture === "draggingRun" || state.gesture === "boxSelecting" || state.gesture === "panning") {
    return { state: { ...state, gesture: "idle", dragId: null, press: null }, effect: { type: "endGesture" } };
  }
  return { state: { ...state, press: null }, effect: { type: "none" } };
}

function pan(state: ToolState, event: ToolPointer): ToolStep {
  if (event.phase === "up" || event.phase === "cancel") return release(state);
  if (state.gesture === "panning") return { state, effect: { type: "none" } };
  return { state: { ...state, gesture: "panning", press: { button: event.button, pointerType: event.pointerType } }, effect: { type: "none" } };
}

function release(state: ToolState): ToolStep {
  if (state.mode === "trace") {
    const gesture = state.gesture === "lengthEntry" ? "lengthEntry" : state.gesture === "idle" ? "idle" : "tracing";
    return { state: { ...state, gesture, press: null, dragId: null }, effect: { type: "none" } };
  }
  return { state: { ...state, gesture: "idle", press: null, dragId: null }, effect: { type: "endGesture" } };
}

function onKey(state: ToolState, event: Extract<ToolEvent, { type: "key" }>): ToolStep {
  if (event.typing || event.meta) return { state, effect: { type: "none" } };
  if (event.key === "d" || event.key === "D") {
    return { state: { ...state, nextRun: state.nextRun === "lit" ? "dark" : "lit" }, effect: { type: "toggleNext" } };
  }
  if (state.mode !== "trace") return { state, effect: { type: "none" } };
  if (state.gesture === "lengthEntry") return lengthKey(state, event.key);
  if (isLengthKey(event.key) && state.gesture === "tracing") {
    return { state: { ...state, gesture: "lengthEntry", lengthDraft: event.key }, effect: { type: "none" } };
  }
  if (event.key === "Escape") return state.gesture === "tracing" ? finish(state) : { state, effect: { type: "none" } };
  if (event.key === "Enter") return state.gesture === "tracing" ? finish(state) : { state, effect: { type: "none" } };
  if (event.key === "Backspace" && state.gesture === "tracing") {
    if (event.chainPoints <= 1) return { state, effect: { type: "refuseWireIn" } };
    return { state, effect: { type: "popTail" } };
  }
  return { state, effect: { type: "none" } };
}

function lengthKey(state: ToolState, key: string): ToolStep {
  if (key === "Escape") return { state: { ...state, gesture: "tracing", lengthDraft: "" }, effect: { type: "clearLength" } };
  if (key === "Enter") return { state: { ...state, gesture: "tracing" }, effect: { type: "none" } };
  if (key === "Backspace") {
    const lengthDraft = state.lengthDraft.slice(0, -1);
    return lengthDraft
      ? { state: { ...state, lengthDraft }, effect: { type: "none" } }
      : { state: { ...state, gesture: "tracing", lengthDraft: "" }, effect: { type: "clearLength" } };
  }
  if (isLengthKey(key)) return { state: { ...state, lengthDraft: state.lengthDraft + key }, effect: { type: "none" } };
  return { state, effect: { type: "none" } };
}

function finish(state: ToolState): ToolStep {
  return { state: { ...state, gesture: "idle", lengthDraft: "", press: null, dragId: null }, effect: { type: "finishChain" } };
}

function act(state: ToolState, effect: ToolEffect, open: boolean): ToolStep {
  return { state: { ...state, gesture: open ? "tracing" : state.gesture }, effect };
}

function modeOf(state: ToolState, mode: "trace" | "edit"): ToolStep {
  if (mode === "trace") {
    return { state: { ...state, mode, gesture: "tracing", press: null, dragId: null }, effect: { type: "none" } };
  }
  return { state: { ...state, mode, gesture: "idle", lengthDraft: "", press: null, dragId: null }, effect: { type: "none" } };
}

/** Left button follows the toggle. Right button is the opposite. Touch is a left button. */
function kindFor(next: RunChoice, button: PointerButton): "lit" | "wire" {
  const left = next === "dark" ? "wire" : "lit";
  if (button === 2) return left === "lit" ? "wire" : "lit";
  return left;
}

function isLengthKey(key: string): boolean {
  return /^[0-9.]$/.test(key);
}
