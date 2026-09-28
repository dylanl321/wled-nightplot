"use client";

import { formatNodeLength } from "@nightplot/shared";
import type { ReactNode } from "react";
import { bounds, elementAt, neighbourAt } from "./ops";
import type { EditorState } from "./use-editor-state";

export function Key({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-b-2 border-[#3a4150] bg-[#12141a] px-[5px] font-mono text-[11px] text-foreground">{children}</kbd>;
}

function Group({ keys, children }: { keys: string[]; children: ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-1.5">{keys.map((key) => <Key key={key}>{key}</Key>)}{children}</span>;
}

export function KeysBar({ state, hues, live, spacingMm }: {
  state: EditorState; hues: Record<string, string>; live: boolean; spacingMm?: number | null;
}) {
  const focus = state.focus;
  const el = "id" in focus ? state.els.find((item) => item.id === focus.id) : null;
  const here = state.cursor === null ? null : elementAt(state.cursor, state.els);
  const limits = el ? bounds(el, state.els, state.ledCount) : null;
  const nb = el && focus.kind === "edge" ? neighbourAt(el, focus.which, state.els) : null;
  const hue = el ? hues[el.id] ?? "#d4a574" : focus.kind === "sel" ? "#ece7dc" : "#9a9488";
  const range = state.ledSel;
  const title = el ? `${el.label}${focus.kind === "edge" ? ` · ${focus.which === "start" ? "start" : "stop"} edge` : ""}`
    : focus.kind === "sel" ? `${range ? range.stop - range.start : 0} LEDs selected` : "Cursor";
  const length = range ? formatNodeLength(range.stop - range.start, spacingMm ?? null) : null;
  return <div aria-label="Keyboard focus" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-[#0e1014] px-5 py-2.5 text-[13px]">
    <span className="inline-flex min-h-[26px] max-w-full items-center gap-2 rounded-md border px-2.5 py-0.5 font-medium [overflow-wrap:anywhere]" style={{ color: hue, borderColor: hue }}>
      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: hue }} />{title}
    </span>
    <Group keys={["←", "→"]}>{focus.kind === "edge" ? `move the ${focus.which === "start" ? "start" : "stop"} edge`
      : focus.kind === "seg" ? "shift the whole Segment"
      : focus.kind === "sel" ? `grow or shrink from LED ${range?.anchor}` : "move the cursor"}</Group>
    <Group keys={["⇧"]}>10 at a time</Group>
    {focus.kind === "cursor" ? <>
      <Group keys={["[", "]"]}>mark start / end</Group>
      {here ? <Group keys={["Tab"]}>select {here.label}</Group> : null}
    </> : focus.kind === "sel" ? <>
      <Group keys={["N"]}>new Segment</Group><Group keys={["Enter"]}>more options</Group><Group keys={["Esc"]}>clear</Group>
    </> : <>
      {nb ? <Group keys={["Alt / ⌥"]}>leave {nb.label} where it is</Group> : null}
      <Group keys={["Tab"]}>{focus.kind === "seg" ? "grab its start edge" : focus.which === "start" ? "grab the stop edge" : "grab the whole Segment"}</Group>
      <Group keys={["Esc"]}>{focus.kind === "edge" ? "back to the Segment" : "deselect"}</Group>
    </>}
    <span className="ml-auto text-[12px] text-muted-foreground">
      {focus.kind === "cursor" ? state.mode === "locate" ? "Locate: the cursor follows the pointer." : "Click a Segment’s first or last LED to grab that edge."
        : focus.kind === "sel" && range ? `${range.start}–${range.stop}${length ? ` · ${length}` : ""}`
        : el && limits ? focus.kind === "seg" ? `${el.start - limits.lo} free before · ${limits.hi - el.stop} free after`
          : nb ? `Shared with ${nb.label}. It grows or shrinks to stay touching.`
            : focus.kind === "edge" && focus.which === "start" ? `${el.start - limits.lo} free before` : `${limits.hi - el.stop} free after`
          : ""}
      {focus.kind === "edge" && live ? <span className="ml-2 text-online">The bright LED on the strip is its {focus.which === "start" ? "first" : "last"} LED.</span> : null}
    </span>
  </div>;
}
