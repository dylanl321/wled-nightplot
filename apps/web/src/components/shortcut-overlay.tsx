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
      className="hidden min-h-11 items-center rounded-md px-3 py-1 text-[13px] text-muted-foreground hover:bg-secondary/60 lg:inline-flex">
      Shortcuts <kbd className="ml-1 rounded border border-input px-1 font-mono">?</kbd>
    </button>
    {open ? <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-0 lg:items-center lg:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="nightplot-shortcuts-title"
        className="relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl lg:max-h-[min(760px,90dvh)] lg:max-w-lg lg:rounded-xl">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="lg:pr-28">
          <h2 id="nightplot-shortcuts-title" className="text-lg font-semibold">Keyboard shortcuts</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Press ? anywhere outside a text field to open this sheet. Escape closes it.</p>
        </div>
        <h3 className="mt-5 text-sm font-semibold">On a Light’s Segments tab</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">Editor keys do not act while typing in a field. These edit the draft or move focus; they do not Apply to a Light.</p>
        <dl className="mt-3 grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px] lg:grid-cols-[minmax(105px,auto)_1fr] lg:text-[12px]">
          {SEGMENT_SHORTCUTS.map(([keys, meaning]) => <div key={keys} className="col-span-2 grid grid-cols-subgrid gap-x-4 border-t border-border pt-2">
            <dt className="font-mono text-primary [overflow-wrap:anywhere]">{keys}</dt><dd className="[overflow-wrap:anywhere]">{meaning}</dd>
          </div>)}
        </dl>
        </div>
        <button ref={close} type="button" onClick={() => setOpen(false)}
          className="min-h-14 w-full shrink-0 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[16px] font-semibold lg:absolute lg:top-5 lg:right-5 lg:min-h-11 lg:w-auto lg:rounded-md lg:border lg:border-input lg:px-3 lg:pb-1.5 lg:text-[13px]">Close</button>
      </div>
    </div> : null}
  </>;
}
