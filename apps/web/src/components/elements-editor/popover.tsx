"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EditorPopover({ label, children, className = "" }: {
  label: string; children: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
      className={cn("inline-flex min-h-[30px] items-center gap-2 rounded-md border border-transparent px-2 text-[12px]", className)}>
      {label}<span aria-hidden="true">▾</span>
    </button>
    {open ? <div id={id} role="dialog" aria-label={label} className="absolute top-full right-0 z-30 mt-2 w-[min(300px,calc(100vw-48px))] rounded-xl border border-[#3a4150] bg-[#12141a] p-4 text-foreground shadow-xl"
      onBlur={(event) => { if (event.relatedTarget && !root.current?.contains(event.relatedTarget)) setOpen(false); }}>
      {children}
    </div> : null}
  </div>;
}
