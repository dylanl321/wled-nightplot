"use client";

import type { Element } from "@nightplot/shared";
import { useEffect, useReducer, useRef } from "react";
import { readDraft, sameSegments, writeDraft, type StoredDraft } from "./draft-storage";
import {
  carve,
  changeCount,
  combineElements,
  drawnRange,
  duplicateElement,
  edgeHit,
  edgeAt,
  bounds,
  clamp,
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
  moveEdge,
  neighbourAt,
  snapTo,
  shiftedRange,
  splitElement,
  type Range,
} from "./ops";

export type Tool = "select" | "range" | "split" | "locate";

export type Focus =
  | { kind: "cursor" }
  | { kind: "sel" }
  | { kind: "seg"; id: string }
  | { kind: "edge"; id: string; which: "start" | "end" };

export type Drag =
  | { kind: "move"; id: string; anchor: number; orig: Element; pre: Element[]; x0: number; moved: boolean }
  | { kind: "start" | "end"; id: string; orig: Element; pre: Element[]; x0: number; moved: boolean }
  | { kind: "draw"; anchor: number; moved: boolean; free: boolean };

export type EditorState = {
  focus: Focus;
  menuOpen: boolean;
  keyMoved: boolean;
  lastNudge: { key: string; at: number } | null;
  els: Element[];
  saved: Element[];
  draftBaseline: Element[];
  draftLedCount: number;
  draftConflict: boolean;
  draftReady: boolean;
  storageAvailable: boolean;
  sel: string[];
  ledSel: LedSelection | null;
  mode: Tool;
  hover: Hit | null;
  cursor: number | null;
  markedStart: number | null;
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
  | { type: "arrow"; delta: number; alt?: boolean; at?: number }
  | { type: "focus-set"; id: string; what: "seg" | "start" | "end" }
  | { type: "focus-cycle"; back?: boolean }
  | { type: "menu-toggle" }
  | { type: "cut-cursor" }
  | { type: "cursor-set"; index: number }
  | { type: "cursor-step"; delta: number }
  | { type: "mark-start" }
  | { type: "mark-end" }
  | { type: "tool"; mode: Tool }
  | { type: "snap" }
  | { type: "hover"; hover: Hit | null }
  | { type: "down"; hit: Hit; shift: boolean }
  | { type: "move"; hit: Hit; alt?: boolean }
  | { type: "up" }
  | { type: "leave" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "revert" }
  | { type: "label"; value: string }
  | { type: "color"; hex?: string; white?: number }
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
  | { type: "server"; previous: Element[]; next: Element[]; lengthChanged: boolean; ledCount: number }
  | { type: "recover"; stored: StoredDraft | null }
  | { type: "resolve-draft" }
  | { type: "draft-storage"; available: boolean };

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
    menuOpen: false,
    lastNudge: null,
    ...(extra.sel ? {
      focus: extra.sel.length === 1 ? { kind: "seg" as const, id: extra.sel[0]! } : { kind: "cursor" as const },
      cursor: els.find((el) => el.id === extra.sel?.[0])?.start ?? state.cursor,
    } : {}),
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

function blockedEdge(
  el: Element, which: "start" | "end", els: Element[], outward: boolean, detach: boolean,
): string {
  const nb = neighbourAt(el, which, els);
  return nb && outward
    ? detach ? `Up against ${nb.label}. Let go of Alt / ⌥ to move the shared edge.`
      : `${nb.label} can't get shorter than 1 LED`
    : `${el.label} can't get shorter than 1 LED, or the strip ends here`;
}

function blockedShift(el: Element, els: Element[], count: number, delta: number): string {
  const limits = bounds(el, els, count);
  const stripEnd = delta < 0 ? limits.lo === 0 : limits.hi === count;
  return stripEnd ? `${el.label} reaches the strip ${delta < 0 ? "start" : "end"}.`
    : `${el.label} is touching the Segment ${delta < 0 ? "before" : "after"}. Tab to grab an edge instead.`;
}

function applyDrag(state: EditorState, hit: Hit, alt = false): EditorState {
  const drag = state.drag;
  if (!drag) return { ...state, hover: hit };
  if (drag.kind !== "draw" && !drag.moved && Math.abs(hit.x - drag.x0) < 4) return state;
  if (drag.kind === "start" || drag.kind === "end") {
    const target = snapTo(hit.b, state.snap);
    const result = moveEdge(drag.pre, drag.id, drag.kind, target, alt, state.ledCount);
    const current = state.els.find((el) => el.id === drag.id);
    const value = drag.kind === "start" ? current?.start : current?.stop;
    return {
      ...state, hover: hit, els: result.els,
      cursor: drag.kind === "start" ? result.value : result.value - 1,
      drag: { ...drag, moved: true }, keyMoved: false,
      toast: value === result.value && target !== value
        ? blockedEdge(drag.orig, drag.kind, drag.pre, drag.kind === "start" ? target < result.value : target > result.value, alt)
        : null,
    };
  }
  if (drag.kind === "move") {
    const next = shiftedRange(drag.orig, drag.anchor, hit.idx, drag.pre, state.ledCount, state.snap);
    const delta = hit.idx - drag.anchor;
    const blocked = next.start === drag.orig.start && snapTo(drag.orig.start + delta, state.snap) !== drag.orig.start;
    return { ...state, hover: hit, els: withElement(state, drag.id, next),
      cursor: drag.anchor + next.start - drag.orig.start, drag: { ...drag, moved: true }, keyMoved: false,
      toast: blocked ? blockedShift(drag.orig, drag.pre, state.ledCount, delta) : null };
  }
  if (drag.kind !== "draw") return { ...state, hover: hit };
  const gap = drag.free ? gapAt(drag.anchor, state.els, state.ledCount) : { lo: 0, hi: state.ledCount };
  return {
    ...state,
    hover: hit,
    draftRange: drawnRange(drag.anchor, hit.idx, gap),
    cursor: clamp(hit.idx, gap.lo, gap.hi - 1),
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
    focus: elements[0] ? { kind: "seg", id: elements[0].id } : { kind: "cursor" },
    menuOpen: false,
    keyMoved: false,
    lastNudge: null,
    els: elements,
    saved: elements,
    draftBaseline: elements,
    draftLedCount: ledCount,
    draftConflict: false,
    draftReady: false,
    storageAvailable: true,
    sel: elements[0] ? [elements[0].id] : [],
    ledSel: null,
    mode: "select",
    hover: null,
    cursor: ledCount > 0 ? clamp(elements[0]?.start ?? 0, 0, ledCount - 1) : null,
    markedStart: null,
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
  // Only consecutive arrows share an undo step. Pointer motion and toast expiry don't split it.
  if (!["arrow", "hover", "leave", "toast-clear"].includes(action.type)) state = { ...state, lastNudge: null };
  switch (action.type) {
    case "menu-toggle":
      return state.ledSel ? { ...state, menuOpen: !state.menuOpen } : state;
    case "focus-set": {
      const el = state.els.find((item) => item.id === action.id);
      if (!el) return state;
      return { ...state, sel: [el.id], ledSel: null, menuOpen: false, keyMoved: true,
        mode: "select",
        focus: action.what === "seg" ? { kind: "seg", id: el.id } : { kind: "edge", id: el.id, which: action.what },
        cursor: action.what === "end" ? el.stop - 1 : el.start };
    }
    case "focus-cycle": {
      const focus = state.focus;
      if (focus.kind === "cursor") {
        const el = state.cursor === null ? null : elementAt(state.cursor, state.els);
        return el ? editorReducer(state, { type: "focus-set", id: el.id, what: "seg" }) : state;
      }
      if (focus.kind === "sel") return state;
      const cycle = ["seg", "start", "end"] as const;
      const index = focus.kind === "seg" ? 0 : focus.which === "start" ? 1 : 2;
      return editorReducer(state, { type: "focus-set", id: focus.id, what: cycle[(index + (action.back ? 2 : 1)) % 3]! });
    }
    case "arrow": {
      if (state.drag || !Number.isFinite(action.delta) || state.ledCount < 1) return state;
      const base = { ...state, menuOpen: false, keyMoved: true, toast: null };
      const focus = state.focus;
      if (focus.kind === "cursor") return { ...base, cursor: clamp((state.cursor ?? 0) + action.delta, 0, state.ledCount - 1) };
      if (focus.kind === "sel" && state.ledSel) {
        const range = state.ledSel;
        const head = range.start < range.anchor ? range.start : range.stop - 1;
        const limits = state.mode === "range" || elementAt(range.anchor, state.els)
          ? { lo: 0, hi: state.ledCount } : gapAt(range.anchor, state.els, state.ledCount);
        const cursor = clamp(head + action.delta, limits.lo, limits.hi - 1);
        return { ...base, cursor, ledSel: extendLed(range, cursor, limits) };
      }
      if (!("id" in focus)) return base;
      const el = state.els.find((item) => item.id === focus.id);
      if (!el) return { ...base, focus: { kind: "cursor" } };
      let els: Element[], cursor: number, toast: string | null = null;
      if (focus.kind === "edge") {
        const old = focus.which === "start" ? el.start : el.stop;
        const result = moveEdge(state.els, el.id, focus.which, old + action.delta, Boolean(action.alt), state.ledCount);
        els = result.els;
        cursor = focus.which === "start" ? result.value : result.value - 1;
        if (result.value === old) {
          const outward = focus.which === "start" ? action.delta < 0 : action.delta > 0;
          toast = blockedEdge(el, focus.which, state.els, outward, Boolean(action.alt));
        }
      } else {
        const next = nudgeElement(el, state.els, state.ledCount, action.delta);
        els = withElement(state, el.id, next);
        cursor = clamp((state.cursor ?? el.start) + next.start - el.start, next.start, next.stop - 1);
        if (next.start === el.start) {
          toast = blockedShift(el, state.els, state.ledCount, action.delta);
        }
      }
      if (rangesEqual(els, state.els)) return { ...base, cursor, toast };
      const key = focus.kind + el.id + (focus.kind === "edge" ? focus.which + (action.alt ? "a" : "") : "");
      const at = action.at ?? Date.now();
      const coalesce = state.lastNudge?.key === key && at - state.lastNudge.at < 1200;
      return { ...base, els, cursor, toast, fut: [],
        hist: coalesce ? state.hist : [...state.hist, state.els].slice(-HISTORY), lastNudge: { key, at } };
    }
    case "cursor-set":
    case "cursor-step": {
      if (state.ledCount < 1) return state;
      const requested = action.type === "cursor-set" ? action.index : (state.cursor ?? 0) + action.delta;
      if (!Number.isFinite(requested)) return state;
      const cursor = Math.max(0, Math.min(state.ledCount - 1, Math.round(requested)));
      return { ...state, cursor, hover: null, focus: { kind: "cursor" }, menuOpen: false, keyMoved: true };
    }
    case "mark-start":
      return state.cursor === null ? state : {
        ...state, markedStart: state.cursor, ledSel: null, focus: { kind: "cursor" }, menuOpen: false,
        toast: `Start marked at LED ${state.cursor}. Move to the last LED, then Mark end.`,
      };
    case "mark-end": {
      if (state.cursor === null || state.markedStart === null) return state;
      return {
        ...state,
        ledSel: {
          start: Math.min(state.markedStart, state.cursor),
          stop: Math.max(state.markedStart, state.cursor) + 1,
          anchor: state.markedStart,
        },
        sel: [], focus: { kind: "sel" }, menuOpen: true, keyMoved: true, markedStart: null, toast: null,
      };
    }
    case "tool": {
      return { ...state, mode: action.mode, menuOpen: false,
        ...(action.mode !== "select" ? { focus: { kind: "cursor" as const }, ledSel: null, sel: [] } : {}) };
    }
    case "snap":
      return { ...state, snap: !state.snap };
    case "hover":
      return state.drag ? state : {
        ...state, hover: action.hover, keyMoved: false,
        cursor: state.mode === "locate" ? action.hover?.idx ?? state.cursor : state.cursor,
      };
    case "leave":
      return state.drag ? state : { ...state, hover: null };
    case "down": {
      const hit = action.hit;
      state = { ...state, menuOpen: false, keyMoved: false, hover: hit, cursor: hit.idx };
      if (state.mode === "locate") return { ...state, hover: hit, cursor: hit.idx };
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
            focus: { kind: "sel" },
            ledSel: extendLed(state.ledSel, hit.idx, { lo: 0, hi: state.ledCount }),
          };
        }
        return {
          ...state,
          sel: [],
          focus: { kind: "sel" },
          ledSel: null,
          drag: { kind: "draw", anchor: hit.idx, moved: false, free: false },
          draftRange: { start: hit.idx, stop: hit.idx + 1 },
        };
      }
      const selected = state.sel.length === 1 ? (state.els.find((element) => element.id === state.sel[0]) ?? null) : null;
      const found = elementAt(hit.idx, state.els);
      if (found && action.shift) {
        const sel = state.sel.includes(found.id) ? state.sel.filter((id) => id !== found.id) : [...state.sel, found.id];
        return { ...state, sel, ledSel: null, focus: { kind: "cursor" } };
      }
      const ledEdge = found ? edgeAt(hit.idx, found) : null;
      const edge = ledEdge ?? edgeHit(hit, selected, state.ledCount);
      const edgeEl = ledEdge ? found : selected;
      if (edge && edgeEl) {
        return {
          ...state,
          ledSel: null, sel: [edgeEl.id], focus: { kind: "edge", id: edgeEl.id, which: edge },
          cursor: edge === "start" ? edgeEl.start : edgeEl.stop - 1,
          drag: { kind: edge, id: edgeEl.id, orig: { ...edgeEl }, pre: state.els, x0: hit.x, moved: false },
        };
      }
      if (found) {
        return {
          ...state,
          sel: [found.id],
          focus: { kind: "seg", id: found.id },
          ledSel: null,
          drag: { kind: "move", id: found.id, anchor: hit.idx, orig: { ...found }, pre: state.els, x0: hit.x, moved: false },
        };
      }
      if (action.shift && state.ledSel) {
        return {
          ...state,
          sel: [],
          focus: { kind: "sel" },
          ledSel: extendLed(state.ledSel, hit.idx, gapAt(state.ledSel.anchor, state.els, state.ledCount)),
        };
      }
      return {
        ...state,
        sel: [],
        focus: { kind: "sel" },
        ledSel: null,
        drag: { kind: "draw", anchor: hit.idx, moved: false, free: true },
        draftRange: { start: hit.idx, stop: hit.idx + 1 },
      };
    }
    case "move":
      return applyDrag(state, action.hit, action.alt);
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
          focus: { kind: "sel" }, menuOpen: drag.moved,
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
        ...restoreFocus(state, prev),
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
        ...restoreFocus(state, next),
      };
    }
    case "revert":
      return commit(state, state.saved, { sel: [], ledSel: null, toast: null,
        draftBaseline: state.saved, draftLedCount: state.ledCount, draftConflict: false });
    case "label": {
      const element = one(state);
      if (!element) return state;
      return commit(state, withElement(state, element.id, { label: action.value }), { sel: [element.id] });
    }
    case "color": {
      const element = one(state);
      if (!element) return state;
      const color = { hex: action.hex ?? element.color?.hex ?? "#F1AD61",
        white: action.white ?? element.color?.white ?? 0 };
      return commit(state, withElement(state, element.id, { color }), { sel: [element.id] });
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
    case "cut-cursor":
    case "split-half": {
      const element = one(state);
      if (!element || element.stop - element.start < 2) return state;
      const boundary = action.type === "cut-cursor" ? state.cursor ?? element.start
        : element.start + Math.floor((element.stop - element.start) / 2);
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
      return { ...state, sel: ids, ledSel: null, menuOpen: false,
        focus: ids.length === 1 ? { kind: "seg", id: ids[0]! } : { kind: "cursor" },
        cursor: state.els.find((el) => el.id === ids[0])?.start ?? state.cursor };
    }
    case "clear-led":
      return { ...state, ledSel: null, menuOpen: false, focus: { kind: "cursor" } };
    case "escape": {
      if (state.menuOpen) return { ...state, menuOpen: false };
      if (state.focus.kind === "edge") return { ...state, focus: { kind: "seg", id: state.focus.id } };
      return { ...state, sel: [], ledSel: null, markedStart: null, mode: "select", drag: null,
        draftRange: null, menuOpen: false, focus: { kind: "cursor" } };
    }
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
      return { ...state, sel, ledSel: null, menuOpen: false, mode: "select", keyMoved: true,
        focus: action.shift ? { kind: "cursor" } : { kind: "seg", id: action.id },
        cursor: state.els.find((el) => el.id === action.id)?.start ?? state.cursor };
    }
    case "replace":
      return commit(state, action.elements, {
        sel: action.elements[0] ? [action.elements[0].id] : [],
        ledSel: null,
      });
    case "recover": {
      if (!action.stored) return { ...state, draftReady: true };
      const conflict = action.stored.ledCount !== state.ledCount ||
        !sameSegments(action.stored.saved, state.saved);
      const els = action.stored.draft;
      return { ...state, els, draftBaseline: action.stored.saved,
        draftLedCount: action.stored.ledCount, draftConflict: conflict, draftReady: true,
        sel: els[0] ? [els[0].id] : [], focus: els[0] ? { kind: "seg", id: els[0].id } : { kind: "cursor" },
        cursor: state.ledCount > 0 ? clamp(els[0]?.start ?? 0, 0, state.ledCount - 1) : null };
    }
    case "resolve-draft":
      return { ...state, draftConflict: false, draftBaseline: state.saved, draftLedCount: state.ledCount };
    case "draft-storage":
      return state.storageAvailable === action.available ? state : { ...state, storageAvailable: action.available };
    case "server": {
      const dirty = changeCount(state.els, action.previous) > 0;
      if (!dirty || sameSegments(state.els, action.next)) {
        const adopt = !dirty;
        const sel = state.sel.filter((id) => action.next.some((element) => element.id === id));
        return {
          ...state,
          els: action.next,
          saved: action.next,
          draftBaseline: action.next,
          draftLedCount: action.ledCount,
          draftConflict: false,
          ledCount: action.ledCount,
          cursor: state.cursor === null || action.ledCount < 1
            ? null : Math.min(state.cursor, action.ledCount - 1),
          markedStart: action.lengthChanged ? null : state.markedStart,
          sel: sel.length ? sel : action.next[0] ? [action.next[0].id] : [],
          ledSel: adopt ? null : state.ledSel,
          drag: adopt ? null : state.drag,
          draftRange: adopt ? null : state.draftRange,
          hist: adopt ? [] : state.hist,
          fut: adopt ? [] : state.fut,
          ...restoreFocus(state, action.next, action.ledCount),
          ...(adopt && state.focus.kind === "sel" ? { focus: { kind: "cursor" as const } } : {}),
        };
      }
      return { ...state, saved: action.next, ledCount: action.ledCount,
        draftConflict: state.draftConflict || action.lengthChanged ||
          !sameSegments(state.draftBaseline, action.next) };
    }
    default:
      return state;
  }
}

function restoreFocus(state: EditorState, els: Element[], count = state.ledCount): Partial<EditorState> {
  const focus = state.focus;
  const el = "id" in focus ? els.find((item) => item.id === focus.id) : null;
  return {
    focus: "id" in focus && !el ? { kind: "cursor" } : focus,
    cursor: count < 1 ? null : clamp(el && focus.kind === "edge"
      ? focus.which === "start" ? el.start : el.stop - 1
      : el && focus.kind === "seg" ? clamp(state.cursor ?? el.start, el.start, el.stop - 1) : state.cursor ?? 0, 0, count - 1),
    lastNudge: null, menuOpen: false,
  };
}

export function useEditorState(elements: Element[], ledCount: number, lightId: string) {
  const [state, dispatch] = useReducer(
    editorReducer,
    { elements, ledCount, lightId },
    (seed) => initialEditorState(seed.elements, seed.ledCount, seed.lightId),
  );
  const seen = useRef({ elements, ledCount });

  useEffect(() => {
    dispatch({ type: "recover", stored: readDraft(lightId) });
  }, [lightId]);

  useEffect(() => {
    if (!state.draftReady || state.lightId !== lightId) return;
    const dirty = !sameSegments(state.els, state.saved);
    const stored = dirty ? { saved: state.draftBaseline, draft: state.els,
      ledCount: state.draftLedCount } : null;
    dispatch({ type: "draft-storage", available: writeDraft(lightId, stored) });
  }, [state.draftReady, lightId, state.els, state.saved, state.draftBaseline, state.draftLedCount, state.lightId]);

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
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
      )) {
        return;
      }
      const key = event.key.toLowerCase();
      if (target instanceof HTMLElement && target.closest("button") && (key === "enter" || key === " ")) return;
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (key === "l") dispatch({ type: "tool", mode: "locate" });
      else if (["home", "end", "[", "]"].includes(key)) {
        event.preventDefault();
        if (key === "[") dispatch({ type: "mark-start" });
        else if (key === "]") dispatch({ type: "mark-end" });
        else if (key === "home" || key === "end") dispatch({ type: "cursor-set", index: key === "home" ? 0 : state.ledCount - 1 });
      }
      else if (key === "tab" && !(target instanceof HTMLElement && target.closest("a, [role='dialog']"))) {
        if (state.focus.kind === "seg" || state.focus.kind === "edge" ||
          (state.focus.kind === "cursor" && state.cursor !== null && elementAt(state.cursor, state.els))) {
          event.preventDefault();
          dispatch({ type: "focus-cycle", back: event.shiftKey });
        }
      }
      else if (key === "v") dispatch({ type: "tool", mode: "select" });
      else if (key === "r") {
        dispatch({ type: "tool", mode: state.mode === "range" ? "select" : "range" });
      } else if (key === "c") {
        dispatch({ type: "tool", mode: state.mode === "split" ? "select" : "split" });
      } else if (key === "n" || key === "enter") {
        if (state.ledSel) {
          event.preventDefault();
          dispatch({ type: key === "n" ? "new-from-sel" : "menu-toggle" });
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
        dispatch({ type: "arrow", delta: (key === "arrowleft" ? -1 : 1) * (event.shiftKey ? 10 : 1), alt: event.altKey });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.mode, state.ledSel, state.cursor, state.ledCount, state.focus, state.els]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: "toast-clear" }), 2200);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  return { state, dispatch, dirtyCount: changeCount(state.els, state.saved),
    draftReady: state.draftReady, storageAvailable: state.storageAvailable };
}
