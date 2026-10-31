"use client";

import {
  PROP_TEMPLATES,
  canFinishPropTaps,
  firstFreeRange,
  nextPropLabel,
  nextTapRole,
  outputCaption,
  outputIdAt,
  partialSegmentsFromTaps,
  segmentsFromPropTaps,
  type ApplyResult,
  type Element,
  type LightDetail,
  type LightOutput,
  type Prop,
  type PropKind,
  type PropTap,
} from "@nightplot/shared";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  holdSpans,
  locatePayloadKey,
  useLiveLocate,
  type LocateFrame,
} from "@/components/elements-editor/use-live-locate";
import { ELEMENT_HUES, LOCATE_LIT } from "@/components/elements-editor/ops";
import { Button } from "@/components/ui/button";
import { LedLoader } from "@/components/ui/led-loader";
import { postJson } from "@/lib/api";
import { WireframeFlow } from "@/components/props/wireframe-flow";

const TOUCH = "min-h-16 w-full rounded-2xl text-[18px] font-semibold";
const NUDGES = [1, 10, 50] as const;

type Phase = "pick" | "walk" | "review" | "draw" | "lock";

type PropPayload = LightDetail & {
  apply?: ApplyResult;
  prop?: Prop;
  message?: string;
};

export function AddPropFlow({
  lightId,
  lightName,
  ledCount,
  outputs,
  existing,
  props,
  rgbw,
  unreachable,
  onClose,
  onApplied,
}: {
  lightId: string;
  lightName: string;
  ledCount: number;
  outputs: LightOutput[];
  existing: Element[];
  props: Prop[];
  rgbw: boolean;
  unreachable: boolean;
  onClose: () => void;
  onApplied: (payload: PropPayload) => void;
}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [kind, setKind] = useState<PropKind>("window");
  const [label, setLabel] = useState(() => nextPropLabel("window", props));
  const [cursor, setCursor] = useState(() => startCursor(existing, ledCount));
  const [taps, setTaps] = useState<PropTap[]>([]);
  const [busy, setBusy] = useState<"save" | "apply" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apply, setApply] = useState<ApplyResult | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  const previewSegments = useMemo(
    () => partialSegmentsFromTaps({ kind, label, taps, ledCount, outputs }),
    [kind, label, taps, ledCount, outputs],
  );
  const review = useMemo(
    () => segmentsFromPropTaps({ kind, label, taps, ledCount, outputs }),
    [kind, label, taps, ledCount, outputs],
  );
  const frame = walkFrame({
    enabled: phase === "walk" && !unreachable && busy === null,
    lightName,
    ledCount,
    cursor,
    existing,
    preview: previewSegments,
    rgbw,
  });
  const locate = useLiveLocate({
    enabled: phase === "walk" && !unreachable && busy === null,
    lightId,
    ledCount,
    frame,
    brightness: null,
    onDetail: () => {
      /* Cursor hops do not refresh the Light. */
    },
  });
  const previewReady =
    frame !== null &&
    locate.acknowledgedKey === locatePayloadKey(frame, null) &&
    !locate.error &&
    !locate.stopping;
  const nextRole = nextTapRole(kind, taps.length);
  const canFinish = canFinishPropTaps(kind, taps.length) && review.ok;
  const output = outputIdAt(cursor, outputs);
  const outputLabel = outputs.find((row) => row.id === output);

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

  useEffect(() => {
    function onAllOff(event: Event) {
      const ids = (event as CustomEvent<{ lightIds?: string[] }>).detail?.lightIds;
      if (!ids?.length || ids.includes(lightId)) onClose();
    }
    window.addEventListener("nightplot:all-off", onAllOff);
    return () => window.removeEventListener("nightplot:all-off", onAllOff);
  }, [lightId, onClose]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (busy === null) void leave();
    } else if (phase === "walk" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      if ((event.target as HTMLElement).tagName === "BUTTON") return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  function pick(next: PropKind) {
    setKind(next);
    setLabel(nextPropLabel(next, props));
    setTaps([]);
    setNotice(null);
    setApply(null);
  }

  function step(delta: number) {
    if (ledCount < 1) return;
    setCursor((current) => Math.max(0, Math.min(ledCount - 1, current + delta)));
  }

  function mark() {
    if (nextRole === null) return;
    setTaps((current) => [...current, { index: cursor }]);
    setNotice(null);
  }

  function undoMark() {
    setTaps((current) => current.slice(0, -1));
    setNotice(null);
    setApply(null);
  }

  async function leave() {
    setBusy(null);
    await locate.stop();
    onClose();
  }

  if (kind === "wireframe" && (phase === "draw" || phase === "lock")) {
    return (
      <WireframeFlow
        lightId={lightId}
        lightName={lightName}
        ledCount={ledCount}
        rgbw={rgbw}
        unreachable={unreachable}
        initialLabel={label}
        initialPhase={phase}
        onClose={() => void leave()}
        onApplied={onApplied}
      />
    );
  }

  async function submit(applyWrite: boolean) {
    if (!review.ok) {
      setNotice(review.message);
      return;
    }
    setNotice(null);
    setBusy(applyWrite ? "apply" : "save");
    const restored = await locate.stop();
    if (applyWrite && !restored) {
      setBusy(null);
      setNotice("Preview could not be confirmed ended and restored. Apply was not sent.");
      return;
    }
    const res = await postJson<PropPayload>(`/api/lights/${lightId}/props`, {
      kind,
      label,
      taps,
      apply: applyWrite,
    });
    const payload = res.data as PropPayload;
    setBusy(null);
    if (payload.apply) setApply(payload.apply);
    if (!res.ok) {
      setNotice(payload.message ?? payload.apply?.message ?? "Prop was not saved.");
      return;
    }
    onApplied(payload);
    window.dispatchEvent(new Event("nightplot:lights-changed"));
    if (applyWrite && payload.apply?.matched) onClose();
    if (!applyWrite) onClose();
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`Add prop on ${lightName}`}
      onKeyDown={keyDown}
      className="fixed inset-0 z-50 overflow-y-auto bg-background px-5 text-foreground"
      style={{ paddingTop: "max(20px, env(safe-area-inset-top))", paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[12px] text-primary">Add prop · {phaseLabel(phase)}</p>
            <h2 className="text-[20px] font-semibold">{lightName}</h2>
          </div>
          <Button ref={close} type="button" variant="outline" onClick={() => void leave()} disabled={busy !== null}>
            Cancel
          </Button>
        </header>

        {phase === "pick" ? (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] text-muted-foreground">
              Pick a shape. Then walk the lit cursor and tap each corner or end. You never type a count. A wireframe is an unfolded box+X — draw one line, or lock from the cursor only.
            </p>
            <div className="grid grid-cols-1 gap-2">
              {PROP_TEMPLATES.map((template) => (
                <button
                  key={template.kind}
                  type="button"
                  aria-pressed={kind === template.kind}
                  onClick={() => pick(template.kind)}
                  className={`rounded-2xl border px-4 py-3 text-left ${
                    kind === template.kind ? "border-primary bg-card" : "border-border bg-[#12141a]"
                  }`}
                >
                  <p className="text-[16px] font-medium">{template.label}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">{template.summary}</p>
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-2 text-[13px] text-muted-foreground">
              Name
              <input
                aria-label="Prop name"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="h-12 rounded-xl border border-input bg-[#07080a] px-3 text-[16px] text-foreground outline-none focus:border-primary"
              />
            </label>
            {kind === "wireframe" ? (
              <div className="flex flex-col gap-3">
                <Button type="button" className={TOUCH} onClick={() => setPhase("draw")} disabled={ledCount < 1 || !label.trim()}>
                  Open the net
                </Button>
                <Button type="button" variant="outline" className="min-h-14 text-[16px]" onClick={() => setPhase("lock")} disabled={ledCount < 1 || !label.trim()}>
                  Lock from the lit cursor
                </Button>
              </div>
            ) : (
              <Button type="button" className={TOUCH} onClick={() => setPhase("walk")} disabled={ledCount < 1 || !label.trim()}>
                Walk the strip
              </Button>
            )}
          </div>
        ) : null}

        {phase === "walk" ? (
          <div className="flex flex-col gap-5">
            <p className="text-[14px] text-muted-foreground">
              {unreachable
                ? "This Light hasn’t answered. Preview cannot start."
                : locate.stopping
                  ? "Ending Preview…"
                  : locate.error
                    ? locate.error.message
                    : previewReady
                      ? `Preview on · temporary. Mark ${nextRole?.toLowerCase() ?? "the next corner"}.`
                      : "Starting Preview…"}
            </p>
            <div className="flex flex-col items-center gap-3 rounded-[22px] border border-border bg-card px-4 py-6 text-center">
              <p className="text-[13px] text-muted-foreground">Cursor</p>
              <p className="font-mono text-[clamp(4rem,18vw,7rem)] font-semibold leading-none tabular-nums">{cursor}</p>
              <p className="font-mono text-[14px] text-muted-foreground">
                of {Math.max(0, ledCount - 1)}
                {outputLabel ? ` · ${outputCaption(outputLabel)}` : ""}
              </p>
              <p className="text-[15px] font-medium">{nextRole ?? "All marks are in. Review this Prop."}</p>
              <div className="grid w-full grid-cols-2 gap-3">
                <button type="button" aria-label="Previous LED" disabled={cursor <= 0} onClick={() => step(-1)} className="min-h-28 rounded-2xl border border-input bg-secondary text-[56px] disabled:opacity-40">←</button>
                <button type="button" aria-label="Next LED" disabled={cursor >= ledCount - 1} onClick={() => step(1)} className="min-h-28 rounded-2xl border border-input bg-secondary text-[56px] disabled:opacity-40">→</button>
              </div>
              <div className="grid w-full grid-cols-3 gap-2">
                {NUDGES.map((amount) => (
                  <div key={amount} className="grid grid-cols-2 gap-1">
                    <Button type="button" variant="outline" className="min-h-12" onClick={() => step(-amount)} disabled={cursor <= 0}>−{amount}</Button>
                    <Button type="button" variant="outline" className="min-h-12" onClick={() => step(amount)} disabled={cursor >= ledCount - 1}>+{amount}</Button>
                  </div>
                ))}
              </div>
            </div>
            {taps.length > 0 ? (
              <ol className="rounded-xl border border-border bg-[#12141a] px-4 py-3 text-[13px]">
                {taps.map((tap, index) => (
                  <li key={`${tap.index}-${index}`}>Mark {index + 1}: LED {tap.index}</li>
                ))}
              </ol>
            ) : null}
            <div className="flex flex-col gap-3">
              {nextRole ? (
                <Button type="button" className={TOUCH} onClick={mark} disabled={unreachable || Boolean(locate.error)}>
                  Mark {nextRole.toLowerCase()}
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="min-h-14 text-[16px]" onClick={undoMark} disabled={taps.length === 0}>
                Undo last mark
              </Button>
              <Button type="button" className="min-h-14 text-[16px]" onClick={() => setPhase("review")} disabled={!canFinish}>
                Review this Prop
              </Button>
            </div>
          </div>
        ) : null}

        {phase === "review" ? (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] text-muted-foreground">
              {label} · {PROP_TEMPLATES.find((row) => row.kind === kind)?.label}. Apply writes every Segment on this Light, including this Prop, then reads the controller back.
            </p>
            {review.ok ? (
              <ul className="rounded-xl border border-border bg-[#12141a] px-4 py-3 text-[14px]">
                {review.segments.map((segment) => (
                  <li key={`${segment.label}-${segment.start}`} className="flex justify-between gap-3 py-1">
                    <span>{segment.label}</span>
                    <span className="font-mono text-muted-foreground">{segment.start}–{segment.stop}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-destructive">{review.message}</p>
            )}
            {apply ? (
              <p className={apply.matched ? "text-[13px] text-online" : "text-[13px] text-destructive"}>
                {apply.message} {apply.caption}
              </p>
            ) : null}
            {notice ? <p role="alert" className="text-[13px] text-destructive">{notice}</p> : null}
            <Button type="button" className={TOUCH} onClick={() => void submit(true)} disabled={!review.ok || busy !== null || unreachable}>
              {busy === "apply" ? "Applying…" : "Apply this Prop"}
            </Button>
            {busy === "apply" ? <LedLoader label="Applying" /> : null}
            <Button type="button" variant="outline" className="min-h-14 text-[16px]" onClick={() => void submit(false)} disabled={!review.ok || busy !== null}>
              {busy === "save" ? "Saving…" : "Save without Apply"}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setApply(null); setNotice(null); setPhase("walk"); }}>
              Back to marks
            </Button>
            <p className="text-center text-[12px] text-muted-foreground">
              Preview is temporary. Apply persists. Fixture or sim green is not Hardware Done.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "pick":
      return "shape";
    case "walk":
      return "tap corners";
    case "review":
      return "review";
    case "draw":
      return "draw the line";
    case "lock":
      return "lock corners";
    default: {
      const _never: never = phase;
      return _never;
    }
  }
}

function startCursor(existing: Element[], ledCount: number): number {
  const free = firstFreeRange(existing, ledCount);
  if (free) return free.start;
  return ledCount > 0 ? 0 : 0;
}

function walkFrame(input: {
  enabled: boolean;
  lightName: string;
  ledCount: number;
  cursor: number;
  existing: Element[];
  preview: { label: string; start: number; stop: number }[];
  rgbw: boolean;
}): LocateFrame | null {
  if (!input.enabled || input.ledCount < 1) return null;
  const extras: Element[] = input.preview.map((segment, index) => ({
    id: `prop-draft-${index}`,
    lightId: "draft",
    label: segment.label,
    start: segment.start,
    stop: segment.stop,
  }));
  const elements = [...input.existing, ...extras];
  const hues = Object.fromEntries(elements.map((element, index) => [element.id, ELEMENT_HUES[index % ELEMENT_HUES.length]]));
  const spans = holdSpans({
    ledCount: input.ledCount,
    hoverIndex: input.cursor,
    dragging: false,
    elements,
    hues,
    rgbw: input.rgbw,
    backgroundPercent: 60,
  });
  if (spans.length === 0) {
    return {
      start: input.cursor,
      stop: input.cursor + 1,
      color: LOCATE_LIT,
      caption: `Lighting LED ${input.cursor} on ${input.lightName}`,
    };
  }
  return {
    start: Math.min(...spans.map((span) => span.start)),
    stop: Math.max(...spans.map((span) => span.stop)),
    color: spans[0]?.color ?? LOCATE_LIT,
    spans,
    pixels: true,
    caption: `LED ${input.cursor} is the bright one. Marked sides stay lit on ${input.lightName}.`,
  };
}
