"use client";

import { useEffect, useRef, useState } from "react";

const SEGMENT_SHORTCUTS = [
  ["L / V / R / C", "Locate / Select / Pick LEDs / Cut"],
  ["← / →", "Move focus one LED · Shift moves ten"],
  ["Tab / Shift Tab", "Cycle Segment and edges"],
  ["Alt / ⌥", "Detach a shared edge"],
  ["[ / ]", "Mark start / end"],
  ["N / Enter", "New Segment / selection options"],
  ["D / S / M", "Duplicate / split in half / combine"],
  ["Space", "Scan / pause"],
  ["Home / End", "Strip start / end"],
  ["⌫ / Delete", "Delete selection"],
  ["Ctrl / ⌘ Z", "Undo · Shift to redo"],
  ["Esc", "Close options / step back / clear"],
] as const;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(
    "input, textarea, select, [contenteditable], [role='textbox']",
  ));
}

export function ShortcutOverlay() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      } else if (open && event.key === "Tab") {
        // Close is the only focusable control in this modal.
        event.preventDefault();
        close.current?.focus();
      } else if (event.key === "?" && !event.repeat && !event.altKey && !event.ctrlKey &&
        !event.metaKey && !isTyping(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement : trigger.current;
    close.current?.focus();
    return () => previousFocus.current?.focus();
  }, [open]);

  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)}
      aria-keyshortcuts="?" aria-haspopup="dialog" aria-expanded={open}
      className="rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-secondary/60">
      Shortcuts <kbd className="ml-1 rounded border border-input px-1 font-mono">?</kbd>
    </button>
    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="nightplot-shortcuts-title"
        className="max-h-[min(760px,90dvh)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="nightplot-shortcuts-title" className="text-lg font-semibold">Keyboard shortcuts</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Press ? anywhere outside a text field to open this sheet. Escape closes it.</p>
          </div>
          <button ref={close} type="button" onClick={() => setOpen(false)}
            className="rounded-md border border-input px-3 py-1.5 text-[13px]">Close</button>
        </div>
        <h3 className="mt-5 text-sm font-semibold">On a Light’s Segments tab</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">Editor keys do not act while typing in a field. These edit the draft or move focus; they do not Apply to a Light.</p>
        <dl className="mt-3 grid grid-cols-[minmax(105px,auto)_1fr] gap-x-4 gap-y-2 text-[12px]">
          {SEGMENT_SHORTCUTS.map(([keys, meaning]) => <div key={keys} className="col-span-2 grid grid-cols-subgrid gap-x-4 border-t border-border pt-2">
            <dt className="font-mono text-primary">{keys}</dt><dd>{meaning}</dd>
          </div>)}
        </dl>
      </div>
    </div> : null}
  </>;
}
