"use client";

import type { Element } from "@nightplot/shared";
import { useEffect, useReducer, useRef } from "react";
import {
  carve,
  changeCount,
  combineElements,
  drawnRange,
  duplicateElement,
  edgeHit,
  elementAt,
  elementsEqual,
  extendInto,
  extendLed,
  fillGap,
  gapAt,
  carveNew,
  type Hit,
  type LedSelection,
  mergeCheck,
  nudgeElement,
  type NudgeEdge,
  resizedStart,
  resizedStop,
  shiftedRange,
  splitElement,
  type Range,
} from "./ops";

export type Tool = "select" | "range" | "split";

export type Drag =
  | { kind: "move"; id: string; anchor: number; orig: Element; pre: Element[] }
  | { kind: "start" | "end"; id: string; orig: Element; pre: Element[] }
  | { kind: "draw"; anchor: number; moved: boolean; free: boolean };

export type EditorState = {
  els: Element[];
  saved: Element[];
  sel: string[];
  ledSel: LedSelection | null;
  mode: Tool;
  hover: Hit | null;
  drag: Drag | null;
  draftRange: Range | null;
  hist: Element[][];
  fut: Element[][];
  snap: boolean;
  toast: string | null;
  lightId: string;
  ledCount: number;
};

export type EditorAction =
  | { type: "tool"; mode: Tool }
  | { type: "snap" }
  | { type: "hover"; hover: Hit | null }
  | { type: "down"; hit: Hit; shift: boolean }
  | { type: "move"; hit: Hit }
  | { type: "up" }
  | { type: "leave" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "revert" }
  | { type: "label"; value: string }
  | { type: "start"; value: number }
  | { type: "stop"; value: number }
  | { type: "nudge"; delta: number; which?: NudgeEdge }
  | { type: "duplicate" }
  | { type: "split-half" }
  | { type: "merge" }
  | { type: "delete" }
  | { type: "new-from-sel" }
  | { type: "extend"; id: string }
  | { type: "remove-from" }
  | { type: "select-here" }
  | { type: "clear-led" }
  | { type: "escape" }
  | { type: "add-gap"; start: number; stop: number }
  | { type: "toast-clear" }
  | { type: "select-row"; id: string; shift: boolean }
  | { type: "replace"; elements: Element[] }
  | { type: "server"; previous: Element[]; next: Element[]; lengthChanged: boolean; ledCount: number };

const HISTORY = 80;

function nextId(): string {
  return crypto.randomUUID();
}

function commit(
  state: EditorState,
  els: Element[],
  extra: Partial<EditorState> = {},
): EditorState {
  return {
    ...state,
    hist: [...state.hist, state.els].slice(-HISTORY),
    fut: [],
    els,
    drag: null,
    draftRange: null,
    ...extra,
  };
}

function withElement(state: EditorState, id: string, patch: Partial<Element>): Element[] {
  return state.els.map((element) => (element.id === id ? { ...element, ...patch } : element));
}

function one(state: EditorState): Element | null {
  if (state.sel.length !== 1) return null;
  return state.els.find((element) => element.id === state.sel[0]) ?? null;
}

function applyDrag(state: EditorState, hit: Hit): EditorState {
  const drag = state.drag;
  if (!drag) return { ...state, hover: hit };
  if (drag.kind === "start") {
    return {
      ...state,
      hover: hit,
      els: withElement(state, drag.id, {
        start: resizedStart(drag.orig, hit.b, state.els, state.ledCount, state.snap),
      }),
    };
  }
  if (drag.kind === "end") {
    return {
      ...state,
      hover: hit,
      els: withElement(state, drag.id, {
        stop: resizedStop(drag.orig, hit.b, state.els, state.ledCount, state.snap),
      }),
    };
  }
  if (drag.kind === "move") {
    const next = shiftedRange(drag.orig, drag.anchor, hit.idx, state.els, state.ledCount, state.snap);
    return { ...state, hover: hit, els: withElement(state, drag.id, next) };
  }
  if (drag.kind !== "draw") return { ...state, hover: hit };
  const gap = drag.free ? gapAt(drag.anchor, state.els, state.ledCount) : { lo: 0, hi: state.ledCount };
  return {
    ...state,
    hover: hit,
    draftRange: drawnRange(drag.anchor, hit.idx, gap),
    drag: { kind: "draw", anchor: drag.anchor, free: drag.free, moved: drag.moved || hit.idx !== drag.anchor },
  };
}

function rangesEqual(left: readonly Element[], right: readonly Element[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((element, index) => {
    const other = right[index];
    return (
      !!other &&
      element.id === other.id &&
      element.label === other.label &&
      element.start === other.start &&
      element.stop === other.stop
    );
  });
}

export function initialEditorState(
  elements: Element[],
  ledCount: number,
  lightId: string,
): EditorState {
  return {
    els: elements,
    saved: elements,
    sel: elements[0] ? [elements[0].id] : [],
    ledSel: null,
    mode: "select",
    hover: null,
    drag: null,
    draftRange: null,
    hist: [],
    fut: [],
    snap: false,
    toast: null,
    lightId,
    ledCount,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "tool": {
      if (action.mode === "range") return { ...state, mode: "range", sel: [] };
      if (action.mode === "split") return { ...state, mode: "split", ledSel: null };
      return { ...state, mode: "select" };
    }
    case "snap":
      return { ...state, snap: !state.snap };
    case "hover":
      return state.drag ? state : { ...state, hover: action.hover };
    case "leave":
      return state.drag ? state : { ...state, hover: null };
    case "down": {
      const hit = action.hit;
      if (state.mode === "split") {
        const found = elementAt(hit.idx, state.els);
        if (!found || hit.b <= found.start || hit.b >= found.stop) return state;
        const next = splitElement(state.els, found.id, hit.b, nextId);
        if (!next) return state;
        return commit(state, next, {
          sel: [found.id],
          ledSel: null,
          toast: `Split at ${hit.b} · ${found.start}–${hit.b} and ${hit.b}–${found.stop}`,
        });
      }
      if (state.mode === "range") {
        if (action.shift && state.ledSel) {
          return {
            ...state,
            sel: [],
            ledSel: extendLed(state.ledSel, hit.idx, { lo: 0, hi: state.ledCount }),
          };
        }
        return {
          ...state,
          sel: [],
          ledSel: null,
          drag: { kind: "draw", anchor: hit.idx, moved: false, free: false },
          draftRange: { start: hit.idx, stop: hit.idx + 1 },
        };
      }
      const selected = state.sel.length === 1 ? (state.els.find((element) => element.id === state.sel[0]) ?? null) : null;
      const edge = edgeHit(hit, selected, state.ledCount);
      if (edge && selected) {
        return {
          ...state,
          ledSel: null,
          drag: { kind: edge, id: selected.id, orig: { ...selected }, pre: state.els },
        };
      }
      const found = elementAt(hit.idx, state.els);
      if (found) {
        if (action.shift) {
          const sel = state.sel.includes(found.id)
            ? state.sel.filter((id) => id !== found.id)
            : [...state.sel, found.id];
          return { ...state, ledSel: null, sel };
        }
        return {
          ...state,
          sel: [found.id],
          ledSel: null,
          drag: { kind: "move", id: found.id, anchor: hit.idx, orig: { ...found }, pre: state.els },
        };
      }
      if (action.shift && state.ledSel) {
        return {
          ...state,
          sel: [],
          ledSel: extendLed(state.ledSel, hit.idx, gapAt(state.ledSel.anchor, state.els, state.ledCount)),
        };
      }
      return {
        ...state,
        sel: [],
        ledSel: null,
        drag: { kind: "draw", anchor: hit.idx, moved: false, free: true },
        draftRange: { start: hit.idx, stop: hit.idx + 1 },
      };
    }
    case "move":
      return applyDrag(state, action.hit);
    case "up": {
      const drag = state.drag;
      if (!drag) return state;
      if (drag.kind === "draw") {
        const range =
          drag.moved && state.draftRange
            ? state.draftRange
            : { start: drag.anchor, stop: drag.anchor + 1 };
        return {
          ...state,
          drag: null,
          draftRange: null,
          sel: [],
          ledSel: { ...range, anchor: drag.anchor },
        };
      }
      const changed = !rangesEqual(drag.pre, state.els);
      return {
        ...state,
        drag: null,
        ...(changed ? { hist: [...state.hist, drag.pre].slice(-HISTORY), fut: [] as Element[][] } : {}),
      };
    }
    case "undo": {
      if (!state.hist.length) return state;
      const prev = state.hist[state.hist.length - 1]!;
      return {
        ...state,
        els: prev,
        hist: state.hist.slice(0, -1),
        fut: [state.els, ...state.fut],
        sel: state.sel.filter((id) => prev.some((element) => element.id === id)),
        drag: null,
        draftRange: null,
      };
    }
    case "redo": {
      if (!state.fut.length) return state;
      const next = state.fut[0]!;
      return {
        ...state,
        els: next,
        fut: state.fut.slice(1),
        hist: [...state.hist, state.els].slice(-HISTORY),
        sel: state.sel.filter((id) => next.some((element) => element.id === id)),
      };
    }
    case "revert":
      return commit(state, state.saved, { sel: [], ledSel: null, toast: null });
    case "label": {
      const element = one(state);
      if (!element) return state;
      return commit(state, withElement(state, element.id, { label: action.value }), { sel: [element.id] });
    }
    case "start":
    case "stop": {
      const element = one(state);
      if (!element) return state;
      const field = action.type;
      return commit(state, withElement(state, element.id, { [field]: action.value }), { sel: [element.id] });
    }
    case "nudge": {
      const element = one(state);
      if (!element) return state;
      const which = action.which ?? "body";
      const next = nudgeElement(element, state.els, state.ledCount, action.delta, which);
      return commit(state, withElement(state, element.id, next), { sel: [element.id] });
    }
    case "duplicate": {
      const element = one(state);
      if (!element) return state;
      const result = duplicateElement(state.els, element.id, state.ledCount, nextId);
      if (!result.ok) {
        return {
          ...state,
          toast: `No free run of ${result.length} LEDs. Largest free run is ${result.largest}.`,
        };
      }
      return commit(state, result.elements, { sel: [result.id], ledSel: null });
    }
    case "split-half": {
      const element = one(state);
      if (!element || element.stop - element.start < 2) return state;
      const boundary = element.start + Math.floor((element.stop - element.start) / 2);
      const next = splitElement(state.els, element.id, boundary, nextId);
      if (!next) return state;
      return commit(state, next, {
        sel: [element.id],
        ledSel: null,
        toast: `Split at ${boundary} · ${element.start}–${boundary} and ${boundary}–${element.stop}`,
      });
    }
    case "merge": {
      const check = mergeCheck(state.els, state.sel);
      if (check.chosen.length < 2) return state;
      if (!check.ok) {
        return { ...state, toast: `${check.between.map((element) => element.label).join(", ")} sits between them` };
      }
      const result = combineElements(state.els, state.sel);
      if (!result.ok) return state;
      return commit(state, result.elements, { sel: [result.id], ledSel: null });
    }
    case "delete": {
      if (!state.sel.length) return state;
      return commit(
        state,
        state.els.filter((element) => !state.sel.includes(element.id)),
        { sel: [], ledSel: null },
      );
    }
    case "new-from-sel": {
      const range = state.ledSel;
      if (!range) return state;
      const made = carveNew(state.els, range, state.lightId, nextId);
      return commit(state, made.elements, {
        sel: [made.id],
        ledSel: null,
        toast: made.taken.length
          ? `Took ${range.stop - range.start} LEDs from ${made.taken.join(", ")}`
          : null,
      });
    }
    case "extend": {
      const range = state.ledSel;
      if (!range) return state;
      const next = extendInto(state.els, action.id, range);
      if (!next) return state;
      return commit(state, next, { sel: [action.id], ledSel: null });
    }
    case "remove-from": {
      const range = state.ledSel;
      if (!range) return state;
      const taken = state.els.filter(
        (element) => element.start < range.stop && element.stop > range.start,
      );
      if (!taken.length) return state;
      return commit(state, carve(state.els, range, nextId), {
        ledSel: null,
        sel: [],
        toast: `Freed ${range.start}–${range.stop} from ${taken.map((element) => element.label).join(", ")}`,
      });
    }
    case "select-here": {
      const range = state.ledSel;
      if (!range) return state;
      const ids = state.els
        .filter((element) => element.start < range.stop && element.stop > range.start)
        .map((element) => element.id);
      return { ...state, sel: ids, ledSel: null };
    }
    case "clear-led":
      return { ...state, ledSel: null };
    case "escape":
      return { ...state, sel: [], ledSel: null, mode: "select", drag: null, draftRange: null };
    case "add-gap": {
      const made = fillGap(state.els, { start: action.start, stop: action.stop }, state.lightId, nextId);
      return commit(state, made.elements, { sel: [made.id], ledSel: null });
    }
    case "toast-clear":
      return state.toast ? { ...state, toast: null } : state;
    case "select-row": {
      const sel = action.shift
        ? state.sel.includes(action.id)
          ? state.sel.filter((id) => id !== action.id)
          : [...state.sel, action.id]
        : [action.id];
      return { ...state, sel, ledSel: null };
    }
    case "replace":
      return commit(state, action.elements, {
        sel: action.elements[0] ? [action.elements[0].id] : [],
        ledSel: null,
      });
    case "server": {
      const dirty = changeCount(state.els, action.previous) > 0;
      if (!dirty || action.lengthChanged || changeCount(state.els, action.next) === 0) {
        const adopt = action.lengthChanged || !dirty;
        const sel = state.sel.filter((id) => action.next.some((element) => element.id === id));
        return {
          ...state,
          els: action.next,
          saved: action.next,
          ledCount: action.ledCount,
          sel: sel.length ? sel : action.next[0] ? [action.next[0].id] : [],
          ledSel: adopt ? null : state.ledSel,
          drag: adopt ? null : state.drag,
          draftRange: adopt ? null : state.draftRange,
          hist: adopt ? [] : state.hist,
          fut: adopt ? [] : state.fut,
        };
      }
      return { ...state, saved: action.next, ledCount: action.ledCount };
    }
    default:
      return state;
  }
}

export function useEditorState(elements: Element[], ledCount: number, lightId: string) {
  const [state, dispatch] = useReducer(
    editorReducer,
    { elements, ledCount, lightId },
    (seed) => initialEditorState(seed.elements, seed.ledCount, seed.lightId),
  );
  const seen = useRef({ elements, ledCount });

  useEffect(() => {
    const previous = seen.current;
    if (elementsEqual(previous.elements, elements) && previous.ledCount === ledCount) return;
    seen.current = { elements, ledCount };
    dispatch({
      type: "server",
      previous: previous.elements,
      next: elements,
      lengthChanged: ledCount !== previous.ledCount,
      ledCount,
    });
  }, [elements, ledCount]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (key === "v") dispatch({ type: "tool", mode: "select" });
      else if (key === "r") {
        dispatch({ type: "tool", mode: state.mode === "range" ? "select" : "range" });
      } else if (key === "c") {
        dispatch({ type: "tool", mode: state.mode === "split" ? "select" : "split" });
      } else if (key === "n" || key === "enter") {
        if (state.ledSel) {
          event.preventDefault();
          dispatch({ type: "new-from-sel" });
        }
      } else if (key === "d") dispatch({ type: "duplicate" });
      else if (key === "s") dispatch({ type: "split-half" });
      else if (key === "m") dispatch({ type: "merge" });
      else if (key === "backspace" || key === "delete") {
        event.preventDefault();
        dispatch({ type: state.ledSel ? "remove-from" : "delete" });
      } else if (key === "escape") {
        dispatch({ type: "escape" });
      } else if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        const delta = key === "arrowleft" ? -1 : 1;
        if (event.altKey) {
          dispatch({ type: "nudge", delta, which: event.shiftKey ? "start" : "end" });
        } else {
          dispatch({ type: "nudge", delta: delta * (event.shiftKey ? 10 : 1) });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.mode, state.ledSel]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: "toast-clear" }), 2200);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  return { state, dispatch, dirtyCount: changeCount(state.els, state.saved) };
}
