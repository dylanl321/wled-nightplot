"use client";

import {
  FIND_LENGTH_NUDGES,
  answerLitToEnd,
  beginSearch,
  confirmableLength,
  findLengthCeilingChoices,
  findLengthConfirmDraft,
  findLengthDraft,
  findLengthExpandChoices,
  findLengthRestoreDraft,
  findLengthSpans,
  findLengthWriteBody,
  isolatedLength,
  needsCeilingWrite,
  needsLongerCeiling,
  nudgeFindLength,
  startFindLength,
  type FindLengthState,
  type LightDetail,
  type ProvisionRead,
  type ProvisionWriteResult,
  type WledStripProvisionOutputDraft,
} from "@nightplot/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  locatePayloadKey,
  useLiveLocate,
  type LocateFrame,
} from "@/components/elements-editor/use-live-locate";
import { Button } from "@/components/ui/button";
import { LedLoader } from "@/components/ui/led-loader";
import { postJson } from "@/lib/api";

type ProvisionPayload = LightDetail & {
  provision: ProvisionRead;
  provisionWrite?: ProvisionWriteResult;
  message?: string;
};

const TOUCH = "min-h-16 w-full rounded-2xl text-[18px] font-semibold";

export function FindLengthFlow({
  lightId,
  lightName,
  outputLabel,
  totalLedCount,
  draft,
  outputStart,
  onClose,
  onApplied,
}: {
  lightId: string;
  lightName: string;
  outputLabel: string;
  totalLedCount: number;
  draft: WledStripProvisionOutputDraft;
  outputStart: number;
  onClose: () => void;
  onApplied: (payload: ProvisionPayload) => void;
}) {
  const [state, setState] = useState(() =>
    startFindLength({
      outputIndex: draft.index,
      outputStart,
      currentLength: draft.length,
      ledType: draft.ledType,
      gpio: draft.gpio,
    }),
  );
  const [busy, setBusy] = useState<"ceiling" | "confirm" | "cancel" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stripLeds, setStripLeds] = useState(totalLedCount);
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  const frame = searchFrame(state, lightName, stripLeds);
  const locate = useLiveLocate({
    enabled: state.phase === "search" && busy === null && !closing,
    lightId,
    ledCount: stripLeds,
    frame,
    brightness: null,
    onDetail: (detail) => {
      setStripLeds(detail.light.ledCount);
    },
  });
  const previewReady =
    frame !== null &&
    locate.acknowledgedKey === locatePayloadKey(frame, null) &&
    !locate.error &&
    !locate.stopping;

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
      if (!ids?.length || ids.includes(lightId)) {
        setClosing(true);
        onClose();
      }
    }
    window.addEventListener("nightplot:all-off", onAllOff);
    return () => window.removeEventListener("nightplot:all-off", onAllOff);
  }, [lightId, onClose]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (busy === null) void cancel();
    }
  }

  async function writeOutput(next: WledStripProvisionOutputDraft): Promise<ProvisionPayload | null> {
    const res = await postJson<ProvisionPayload>(`/api/lights/${lightId}/provision`, findLengthWriteBody(next));
    const payload = res.data as ProvisionPayload;
    if (payload.light) setStripLeds(payload.light.ledCount);
    if (!res.ok) {
      setNotice(payload.message ?? payload.provisionWrite?.message ?? "Strip provision was not written.");
      return null;
    }
    if (payload.provisionWrite && !payload.provisionWrite.matched) {
      setNotice(payload.provisionWrite.message);
      return null;
    }
    onApplied(payload);
    window.dispatchEvent(new Event("nightplot:lights-changed"));
    return payload;
  }

  async function chooseCeiling(ceiling: number) {
    setNotice(null);
    if (!needsCeilingWrite(state.originalLength, ceiling)) {
      setState(beginSearch(state, ceiling));
      return;
    }
    setBusy("ceiling");
    const restored = await locate.stop();
    if (!restored) {
      setBusy(null);
      setNotice("End Preview is not confirmed. Reload this Light or use All Off.");
      return;
    }
    const written = await writeOutput(findLengthDraft(state, ceiling));
    setBusy(null);
    if (!written) return;
    setState(beginSearch(state, ceiling));
  }

  async function confirm() {
    const next = findLengthConfirmDraft(state);
    if (!next || !previewReady) return;
    setBusy("confirm");
    setNotice(null);
    const restored = await locate.stop();
    if (!restored) {
      setBusy(null);
      setNotice("End Preview is not confirmed. Reload this Light or use All Off.");
      return;
    }
    const written = await writeOutput(next);
    setBusy(null);
    if (!written) return;
    onClose();
  }

  async function cancel() {
    setBusy("cancel");
    setNotice(null);
    const restored = await locate.stop();
    if (!restored) {
      setBusy(null);
      setNotice("End Preview is not confirmed. Reload this Light or use All Off.");
      return;
    }
    if (state.expanded) {
      const written = await writeOutput(findLengthRestoreDraft(state));
      setBusy(null);
      if (!written) return;
    } else {
      setBusy(null);
    }
    onClose();
  }

  const isolated = isolatedLength(state);
  const blocked = busy !== null || locate.stopping || closing;
  const expand = needsLongerCeiling(state);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`Find length · ${outputLabel}`}
      onKeyDown={keyDown}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background px-5 text-foreground"
      style={{
        paddingTop: "max(20px, env(safe-area-inset-top))",
        paddingBottom: "max(24px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col gap-5 overflow-y-auto">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[12px] text-primary">Strip · Find length</p>
            <h2 className="text-[20px] font-semibold">{outputLabel}</h2>
            <p className="text-[13px] text-muted-foreground">{lightName}</p>
          </div>
          <Button
            ref={close}
            type="button"
            variant="outline"
            onClick={() => void cancel()}
            disabled={blocked}
          >
            Cancel
          </Button>
        </header>

        {state.phase === "pick-ceiling" ? (
          <CeilingStep
            current={state.originalLength}
            choices={findLengthCeilingChoices(state.originalLength)}
            busy={blocked}
            onChoose={(ceiling) => void chooseCeiling(ceiling)}
          />
        ) : expand ? (
          <ExpandStep
            ceiling={state.ceiling}
            choices={findLengthExpandChoices(state.ceiling)}
            busy={blocked}
            onChoose={(ceiling) => void chooseCeiling(ceiling)}
          />
        ) : (
          <SearchStep
            state={state}
            isolated={isolated}
            previewReady={previewReady}
            stopping={locate.stopping}
            error={locate.error?.message ?? notice}
            canRetry={Boolean(locate.error)}
            blocked={blocked}
            onYes={() => setState(answerLitToEnd(state, true))}
            onNo={() => setState(answerLitToEnd(state, false))}
            onNudge={(delta) => setState(nudgeFindLength(state, delta))}
            onRetry={() => locate.retry()}
            onConfirm={() => void confirm()}
          />
        )}

        {notice && state.phase === "pick-ceiling" ? (
          <p role="alert" className="text-[13px] text-destructive">
            {notice}
          </p>
        ) : null}
        {busy === "ceiling" ? <LedLoader label="Writing search length" /> : null}
        {busy === "confirm" ? <LedLoader label="Writing this output" /> : null}
        {busy === "cancel" ? <LedLoader label="Restoring" /> : null}

        <p className="text-[12px] text-muted-foreground">
          Preview is temporary. Use this length writes this output through Apply, then reads it
          back. Cancel ends Preview and restores the previous look
          {state.expanded ? "; it also writes the previous length back" : ""}. All Off cancels
          without restoring. Helper glow is not Hardware Done.
        </p>
      </div>
    </div>
  );
}

function CeilingStep({
  current,
  choices,
  busy,
  onChoose,
}: {
  current: number;
  choices: number[];
  busy: boolean;
  onChoose: (ceiling: number) => void;
}) {
  return (
    <section className="flex flex-1 flex-col gap-4 rounded-[22px] border border-border bg-card px-4 py-6">
      <p className="text-[16px] leading-6">
        This output is {current} LEDs. Walk to the far end. Find length lights that many nodes and
        asks whether the physical end is lit.
      </p>
      <p className="text-[14px] leading-5 text-muted-foreground">
        If the strip is longer, write a longer search length first. That is Apply — the controller
        may restart.
      </p>
      <div className="grid gap-3">
        {choices.map((ceiling) => (
          <button
            key={ceiling}
            type="button"
            disabled={busy}
            onClick={() => onChoose(ceiling)}
            className={`${TOUCH} border ${
              ceiling === current
                ? "border-primary bg-secondary text-foreground"
                : "border-input bg-background"
            }`}
          >
            {ceiling === current ? `Search within ${ceiling}` : `Search up to ${ceiling}`}
          </button>
        ))}
      </div>
    </section>
  );
}

function ExpandStep({
  ceiling,
  choices,
  busy,
  onChoose,
}: {
  ceiling: number;
  choices: number[];
  busy: boolean;
  onChoose: (ceiling: number) => void;
}) {
  return (
    <section className="flex flex-1 flex-col gap-4 rounded-[22px] border border-border bg-card px-4 py-6">
      <p className="text-[16px] leading-6">
        The physical end stayed dark at {ceiling} LEDs. This output is still shorter than the
        strip.
      </p>
      {choices.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">
          Nightplot will not search past {ceiling} from here. Raise the node count on Strip and
          Apply, then Find length again.
        </p>
      ) : (
        <div className="grid gap-3">
          {choices.map((next) => (
            <button
              key={next}
              type="button"
              disabled={busy}
              onClick={() => onChoose(next)}
              className={`${TOUCH} border border-input bg-background`}
            >
              Write {next} and keep searching
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SearchStep({
  state,
  isolated,
  previewReady,
  stopping,
  error,
  canRetry,
  blocked,
  onYes,
  onNo,
  onNudge,
  onRetry,
  onConfirm,
}: {
  state: FindLengthState;
  isolated: number | null;
  previewReady: boolean;
  stopping: boolean;
  error: string | null;
  canRetry: boolean;
  blocked: boolean;
  onYes: () => void;
  onNo: () => void;
  onNudge: (delta: number) => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const length = confirmableLength(state);
  const cannotAnswer = blocked || !previewReady || Boolean(error);
  return (
    <section className="flex flex-1 flex-col gap-5 rounded-[22px] border border-border bg-card px-4 py-6 text-center">
      <p className="text-[14px] text-muted-foreground">
        {stopping
          ? "Ending Preview…"
          : error
            ? "Preview needs attention"
            : previewReady
              ? "Preview on · temporary"
              : "Waiting for Preview…"}
      </p>
      <div aria-live="polite" aria-atomic="true">
        <p className="text-[13px] text-muted-foreground">Trying</p>
        <p className="font-mono text-[clamp(4.5rem,20vw,8rem)] font-semibold leading-none tabular-nums">
          {state.candidate}
        </p>
        <p className="mt-2 text-[15px] text-muted-foreground">LEDs on this output</p>
      </div>
      <p className="text-[16px] leading-6">
        {isolated != null
          ? `Search narrowed to ${isolated} LEDs. Confirm if the physical end matches.`
          : "Look at the physical end. Is it lit?"}
      </p>
      <div className="mt-auto grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={cannotAnswer}
          onClick={onYes}
          className={`${TOUCH} border border-primary bg-secondary`}
        >
          Yes · lit to the end
        </button>
        <button
          type="button"
          disabled={cannotAnswer}
          onClick={onNo}
          className={`${TOUCH} border border-input bg-background`}
        >
          No · still dark
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[...FIND_LENGTH_NUDGES].reverse().map((step) => (
          <button
            key={`-${step}`}
            type="button"
            aria-label={`Shorter by ${step}`}
            disabled={cannotAnswer || state.candidate <= 1}
            onClick={() => onNudge(-step)}
            className="min-h-14 rounded-xl border border-input bg-background text-[16px] font-semibold disabled:opacity-40"
          >
            −{step}
          </button>
        ))}
        {FIND_LENGTH_NUDGES.map((step) => (
          <button
            key={`+${step}`}
            type="button"
            aria-label={`Longer by ${step}`}
            disabled={cannotAnswer || state.candidate >= state.ceiling}
            onClick={() => onNudge(step)}
            className="min-h-14 rounded-xl border border-input bg-background text-[16px] font-semibold disabled:opacity-40"
          >
            +{step}
          </button>
        ))}
      </div>
      {error ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
          {canRetry ? (
            <Button type="button" variant="outline" className="min-h-14 text-[16px]" onClick={onRetry}>
              Retry Preview
            </Button>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        className="min-h-16 text-[18px]"
        disabled={cannotAnswer || length == null}
        onClick={onConfirm}
      >
        Use this length
      </Button>
    </section>
  );
}

function searchFrame(
  state: FindLengthState,
  lightName: string,
  totalLedCount: number,
): LocateFrame | null {
  if (state.phase !== "search") return null;
  const spans = findLengthSpans(state, totalLedCount);
  if (spans.length === 0) return null;
  return {
    start: 0,
    stop: Math.max(1, totalLedCount),
    color: "#000000",
    spans,
    pixels: true,
    caption: `Find length on ${lightName} · lighting ${state.candidate} LEDs. Preview is temporary.`,
  };
}

