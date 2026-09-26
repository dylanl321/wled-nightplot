"use client";

import {
  BLINK_PULSE_MS,
  PREVIEW_SWATCHES,
  blinkRefuseReason,
  previewRefuseReason,
  proofLadder,
  resolveLiveTarget,
  type LightDetail,
  type LiveSession,
} from "@nightplot/shared";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

const SWATCH_NAMES: Record<string, string> = {
  "#ffc978": "warm",
  "#ff4a3d": "red",
  "#3dff7a": "green",
  "#4f7dff": "blue",
  "#f4f1ea": "white",
};

export function TestLivePanel({
  detail,
  unreachable,
  selectedId,
  onSelect,
  onDetail,
}: {
  detail: LightDetail;
  unreachable: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDetail: (next: LightDetail) => void;
}) {
  const light = detail.light;
  const [color, setColor] = useState<string>(PREVIEW_SWATCHES[3]);
  const [brightness, setBrightness] = useState(light.brightness ?? 180);
  const [busy, setBusy] = useState<"preview" | "blink" | "end" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const session = detail.session;

  const target = useMemo(
    () => resolveLiveTarget(detail.elements, light.ledCount, selectedId),
    [detail.elements, light.ledCount, selectedId],
  );
  const previewReason = previewRefuseReason({
    reachable: !unreachable,
    hasTarget: target.stop > target.start,
    busyKind: session?.kind ?? null,
  });
  const blinkReason = blinkRefuseReason({
    reachable: !unreachable,
    busyKind: session?.kind ?? null,
  });

  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const ms = Math.max(0, Date.now() - Date.parse(session.startedAt));
      const s = Math.floor(ms / 1000);
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (session?.kind !== "blink") return;
    const wait = window.setTimeout(() => {
      void endSession("blink");
    }, BLINK_PULSE_MS);
    return () => window.clearTimeout(wait);
    // end once per blink session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.kind]);

  async function run(kind: "preview" | "blink") {
    const reason = kind === "preview" ? previewReason : blinkReason;
    if (reason) {
      setNotice(reason);
      return;
    }
    setBusy(kind);
    setNotice(null);
    const path =
      kind === "preview"
        ? `/api/lights/${light.id}/preview`
        : `/api/lights/${light.id}/blink`;
    const res = await postJson<LightDetail>(path, {
      elementId: target.elementId,
      color,
      brightness,
    });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Nothing was sent.");
      return;
    }
    onDetail(res.data);
  }

  async function endSession(kind: "preview" | "blink") {
    setBusy("end");
    const res = await postJson<LightDetail>(`/api/lights/${light.id}/${kind}/end`, {});
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Could not restore.");
      return;
    }
    onDetail(res.data);
  }

  async function see(seen: "yes" | "no") {
    const res = await postJson<LightDetail>(`/api/lights/${light.id}/preview/seen`, {
      seen,
    });
    if (!res.ok) {
      setNotice(res.data.message ?? "Could not record that.");
      return;
    }
    onDetail(res.data);
  }

  const proofLabel = session?.target.label ?? target.label;
  const rungs = proofLadder({
    sentAt: session?.startedAt ?? null,
    reported:
      session && detail.liveLeds
        ? {
            matched: detail.liveLeds
              .slice(session.target.start, session.target.stop)
              .filter((led) => led === session.color).length,
            total: Math.max(0, session.target.stop - session.target.start),
          }
        : null,
    seenByYou: session?.seenByYou ?? null,
    label: proofLabel,
  });

  const colorName = SWATCH_NAMES[color] ?? color;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Chip
          active={target.elementId === null}
          onClick={() => onSelect(null)}
        >
          Whole strip
        </Chip>
        {detail.elements.map((element) => (
          <Chip
            key={element.id}
            active={selectedId === element.id}
            onClick={() => onSelect(element.id)}
          >
            {element.label}
          </Chip>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-3.5 rounded-xl border border-border bg-[#0e1014] p-4">
          <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2.5">
            <span className="text-xs text-quiet">Colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {PREVIEW_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={SWATCH_NAMES[swatch] ?? swatch}
                  onClick={() => setColor(swatch)}
                  className="size-[26px] rounded-full"
                  style={{
                    background: swatch,
                    boxShadow:
                      color === swatch
                        ? "0 0 0 2px #0e1014, 0 0 0 3.5px #ece7dc"
                        : undefined,
                  }}
                />
              ))}
              <span className="ml-auto font-mono text-xs text-[#c9c3b8]">{color}</span>
            </div>
          </div>
          <div className="grid grid-cols-[84px_minmax(0,1fr)_40px] items-center gap-2.5">
            <span className="text-xs text-quiet">Brightness</span>
            <input
              type="range"
              min={1}
              max={255}
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
              className="h-1 w-full accent-primary"
              aria-label="Preview brightness"
            />
            <span className="text-right font-mono text-xs">
              {Math.round((brightness / 255) * 100)}%
            </span>
          </div>
          <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2.5">
            <span className="text-xs text-quiet">Effect</span>
            <div className="flex h-[34px] items-center rounded-md border border-input px-2.5 text-[13px]">
              Solid
              <span className="ml-auto text-xs text-quiet">native solid</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={Boolean(previewReason) || busy !== null}
              onClick={() => void run("preview")}
            >
              {busy === "preview" ? "Sending…" : `Preview on ${target.label}`}
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(blinkReason) || busy !== null}
              onClick={() => void run("blink")}
            >
              {busy === "blink" ? "Pulsing…" : `Blink ${target.label}`}
            </Button>
          </div>
          {previewReason ? (
            <p className="text-[13px] text-destructive">{previewReason}</p>
          ) : blinkReason && blinkReason !== previewReason ? (
            <p className="text-[13px] text-destructive">{blinkReason}</p>
          ) : null}
          {notice ? <p className="text-[13px] text-destructive">{notice}</p> : null}
        </div>

        <ProofCard
          session={session}
          rungs={rungs}
          label={proofLabel}
          colorName={colorName}
          caption={detail.liveCaption}
          onSee={see}
        />
      </div>

      {session ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[#1f4a45] bg-[#0b1514] px-3.5 py-2.5 sm:flex-row sm:items-center">
          <span className="size-2 rounded-full bg-online shadow-[0_0_8px_#7ee0d0]" />
          <span>
            {session.kind === "preview" ? "Preview" : "Blink"} live on{" "}
            <span className="font-medium">{session.target.label}</span>
          </span>
          <span className="font-mono text-xs text-muted-foreground">{elapsed}</span>
          <span className="text-[13px] text-quiet">
            {session.kind === "preview"
              ? "Ending puts the previous look back."
              : "Pulse ends and restores on its own."}
          </span>
          {session.kind === "preview" ? (
            <Button
              variant="outline"
              className="sm:ml-auto"
              disabled={busy !== null}
              onClick={() => void endSession("preview")}
            >
              End preview
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-quiet">
          Preview is temporary. Range Apply lives on Edit ranges. All Off would end a
          Preview without restoring — that path is R5.
        </p>
      )}
    </div>
  );
}

function ProofCard({
  session,
  rungs,
  label,
  colorName,
  caption,
  onSee,
}: {
  session: LiveSession | null;
  rungs: ReturnType<typeof proofLadder>;
  label: string;
  colorName: string;
  caption: string | null;
  onSee: (seen: "yes" | "no") => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-[#0e1014] p-4">
      <span className="mb-2.5 font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
        Proof
      </span>
      {rungs.map((rung) => (
        <div
          key={rung.key}
          className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 py-1.5"
        >
          <span
            className={cn(
              "mt-0.5 flex size-[18px] items-center justify-center rounded-full border text-[10px]",
              rung.done
                ? "border-online text-online"
                : rung.key === "person"
                  ? "border-dashed border-primary"
                  : "border-input text-quiet",
            )}
          >
            {rung.done ? "✓" : ""}
          </span>
          <div className="flex flex-col gap-2">
            <span>{rung.label}</span>
            {rung.key === "person" && session?.kind === "preview" && session.seenByYou === null ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="default" onClick={() => onSee("yes")}>
                  Yes, I see it
                </Button>
                <Button variant="outline" size="default" onClick={() => onSee("no")}>
                  No / not sure
                </Button>
              </div>
            ) : null}
          </div>
          {rung.detail ? (
            <span className="font-mono text-[11px] text-quiet">{rung.detail}</span>
          ) : null}
        </div>
      ))}
      <p className="mt-3 text-[12px] leading-5 text-primary">
        {caption ??
          "Software stops at “controller reports”. The last rung is a person."}
      </p>
      <div className="mt-auto flex items-center gap-2.5 border-t border-border pt-2.5">
        <span className="text-xs text-quiet">Keep it as {label}’s saved look?</span>
        <Button
          variant="outline"
          className="ml-auto"
          disabled
          title="Range Apply is on Edit ranges. This is not a saved look."
        >
          Apply to {label}
        </Button>
      </div>
      <p className="sr-only">
        Preview colour name {colorName}. Range Apply is on Edit ranges.
      </p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[7px] border px-2.5 py-1.5 text-[13px]",
        active
          ? "border-primary bg-[#27221d] text-primary"
          : "border-input text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function liveBeadColor(
  index: number,
  detail: LightDetail,
  fallback: string | null | "unknown",
): string | null | "unknown" {
  if (detail.light.reachability === "no-answer") return "unknown";
  const led = detail.liveLeds?.[index];
  if (typeof led === "string") return led;
  if (led === null) return null;
  return fallback;
}
