"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

export function PhoneRemote({
  lightName,
  ledCount,
  cursor,
  live,
  blocked,
  stopping,
  error,
  onStep,
  onPreview,
  onEnd,
  onClose,
}: {
  lightName: string;
  ledCount: number;
  cursor: number;
  live: boolean;
  blocked: boolean;
  stopping: boolean;
  error: string | null;
  onStep: (delta: number) => void;
  onPreview: () => void;
  onEnd: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation(); // The editor's shortcuts must not change Segments behind the remote.
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if ((event.target as HTMLElement).tagName === "BUTTON") return;
      event.preventDefault();
      if (!blocked && !stopping && !error) onStep(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Tab") {
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (buttons.length === 0) return;
      if (event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault();
        buttons.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
        event.preventDefault();
        buttons[0]?.focus();
      }
    }
  }

  const cannotMove = blocked || stopping || Boolean(error) || ledCount < 1;
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`${lightName} phone remote`}
      onKeyDown={keyDown}
      className="fixed inset-0 z-50 overflow-y-auto bg-background px-5 text-foreground"
      style={{ paddingTop: "max(20px, env(safe-area-inset-top))", paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-7">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[12px] text-primary">Locate · phone remote</p>
            <h2 className="text-[20px] font-semibold">{lightName}</h2>
          </div>
          <Button ref={close} type="button" variant="outline" onClick={onClose}>
            {live ? "End Preview & return" : "Return to Segments"}
          </Button>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-7 rounded-[22px] border border-border bg-card px-4 py-8 text-center">
          <p className="text-[14px] text-muted-foreground">
            {stopping ? "Ending Preview…" : error ? "Preview needs attention" : live ? "Preview on · temporary" : "Preview off"}
          </p>
          <div aria-live="polite" aria-atomic="true">
            <p className="text-[13px] text-muted-foreground">LED</p>
            <p className="font-mono text-[clamp(5rem,22vw,9rem)] font-semibold leading-none tabular-nums">{cursor}</p>
            <p className="mt-2 font-mono text-[14px] text-muted-foreground">of {Math.max(0, ledCount - 1)}</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-4">
            <button type="button" aria-label="Previous LED" disabled={cannotMove || cursor <= 0} onClick={() => onStep(-1)} className="min-h-32 rounded-2xl border border-input bg-secondary text-[64px] disabled:opacity-40">←</button>
            <button type="button" aria-label="Next LED" disabled={cannotMove || cursor >= ledCount - 1} onClick={() => onStep(1)} className="min-h-32 rounded-2xl border border-input bg-secondary text-[64px] disabled:opacity-40">→</button>
          </div>
        </div>

        {error ? <p role="alert" className="text-[13px] text-destructive">{error} Return to Segments for recovery or All Off.</p> : null}
        <div className="flex flex-col gap-3">
          {live ? (
            <Button type="button" variant="outline" className="min-h-14 text-[16px]" onClick={onEnd} disabled={stopping}>
              {stopping ? "Ending Preview…" : "End Preview"}
            </Button>
          ) : (
            <Button type="button" className="min-h-14 text-[16px]" onClick={onPreview} disabled={blocked || stopping || Boolean(error) || ledCount < 1}>
              Start Preview
            </Button>
          )}
          <p className="text-center text-[12px] text-muted-foreground">Preview changes the live strip temporarily. Nothing is saved or Applied.</p>
        </div>
      </div>
    </div>
  );
}
