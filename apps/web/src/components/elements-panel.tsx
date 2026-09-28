"use client";

import {
  APPLY_UNKNOWN_SEGMENTS_MESSAGE,
  PREVIEW_SWATCHES,
  adoptControllerRangesReason,
  previewRefuseReason,
  proofLadder,
  type ApplyResult,
  type Element,
  type LightDetail as LightDetailPayload,
  type RangeDisplay,
} from "@nightplot/shared";
import { useState } from "react";
import { StripBeads, type StripSpan } from "@/components/strip-beads";
import { liveBeadColor } from "@/components/test-live";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";
import { inspectPowerHow } from "@/lib/power-status";
import { cn } from "@/lib/utils";

const SWATCH_NAMES: Record<string, string> = {
  "#ffc978": "warm",
  "#ff4a3d": "red",
  "#3dff7a": "green",
  "#4f7dff": "blue",
  "#f4f1ea": "white",
};

export function ElementsPanel({
  detail,
  draft,
  display,
  declared,
  issues,
  selectedId,
  selected,
  comparable,
  dirty,
  apply,
  applyReason,
  canApply,
  canSave,
  busy,
  notice,
  rangeErrorKey,
  rangeDriftKey,
  changed,
  onSelect,
  onPatch,
  onAdd,
  onRemove,
  onSave,
  onRevert,
  onApply,
  onAdopt,
  onDetail,
  onSettings,
}: {
  detail: LightDetailPayload;
  draft: Element[];
  display: RangeDisplay;
  declared: StripSpan[];
  issues: { code: "invert" | "overlap" | "over-ledCount"; message: string; elementId?: string; otherId?: string; start: number; stop: number }[];
  selectedId: string | null;
  selected: Element | null;
  comparable: boolean;
  dirty: boolean;
  apply: ApplyResult | null;
  applyReason: string | null;
  canApply: boolean;
  canSave: boolean;
  busy: "save" | "refresh" | "apply" | "readdress" | "blink" | null;
  notice: string | null;
  rangeErrorKey: "invert" | "overlap" | "past strip" | undefined;
  rangeDriftKey: boolean;
  changed: number;
  onSelect: (id: string) => void;
  onPatch: (patch: Partial<Element>) => void;
  onAdd: () => void;
  onRemove: () => void;
  onSave: () => void;
  onRevert: () => void;
  onApply: () => void;
  onAdopt: () => void;
  onDetail: (next: LightDetailPayload) => void;
  onSettings: () => void;
}) {
  const light = detail.light;
  const unreachable = light.reachability === "no-answer";
  const bead = displayBeadLocal(light);
  const previewing = detail.session?.kind === "preview";
  const pitch = light.ledCount <= 80 ? 13.4 : 9.4;
  const applyFailed = Boolean(apply && apply.status !== "matched");
  const segmentsUnknown = light.segmentCount === null;
  const drifted = display.declared.filter((rail) => rail.differs);
  const showDrift = !applyFailed && !segmentsUnknown && !unreachable && comparable && rangeDriftKey;
  const bannerOwnsReason = segmentsUnknown || (unreachable && !applyFailed && !showDrift);

  return (
    <div className="flex flex-col gap-4">
      {applyFailed && apply ? (
        <ApplyFailed apply={apply} onAdopt={onAdopt} onRetry={onApply} />
      ) : segmentsUnknown ? (
        <div className="rounded-xl border border-border bg-[#12141a] px-4 py-3.5">
          <p className="text-[15px] font-medium">
            {display.notes[0]?.text ?? "Segments unknown"}
          </p>
          {applyReason ? (
            <p className="mt-1 text-[13px] text-destructive">{applyReason}</p>
          ) : null}
        </div>
      ) : unreachable ? (
        <div className="rounded-xl border border-[#5a2f33] bg-[#1a1113] px-4 py-3.5">
          <p className="text-[15px] font-medium text-destructive">{inspectPowerHow(light)}</p>
          <button type="button" onClick={onSettings} className="mt-1 text-[13px] text-primary">
            Change address
          </button>
        </div>
      ) : showDrift ? (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/70 bg-[#15130f] px-4 py-3.5 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            {drifted.length > 0 ? (
              <>
                <p className="text-[15px] font-medium text-primary">
                  {drifted.length} Element{drifted.length === 1 ? "" : "s"} don’t match the controller
                </p>
                <p className="text-[13px] text-[#c9c3b8]">
                  {drifted.map((rail) => rail.label).join(", ")}. The dashed brackets show where.
                </p>
                {display.notes[0]?.text ? (
                  <p className="text-[13px] text-[#c9c3b8]">{display.notes[0].text}</p>
                ) : null}
              </>
            ) : (
              <p className="text-[15px] font-medium text-primary">
                {display.notes[0]?.text ?? "Declared ranges don’t match the controller"}
              </p>
            )}
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              variant="outline"
              className="h-9 text-[13px]"
              onClick={onAdopt}
              disabled={display.reported.length === 0 || busy !== null}
            >
              Use controller’s
            </Button>
            <Button className="h-9 text-[13px]" onClick={onApply} disabled={!canApply} title={applyReason ?? undefined}>
              {busy === "apply" ? "Applying…" : "Apply mine"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-[14px] border border-border bg-[#07080a] px-5 pt-4 pb-3">
        <div className="overflow-x-auto">
          <StripBeads
            id={`light-${light.id}`}
            count={Math.max(light.ledCount, 1)}
            perRow={100}
            pitch={pitch}
            gutter={30}
            top={34}
            bottom={28}
            fontSize={12}
            color={(index) => (previewing ? liveBeadColor(index, detail, bead) : bead)}
            brightness={
              unreachable
                ? 1
                : previewing
                  ? Math.max(0.35, (detail.session?.brightness ?? 180) / 255)
                  : 0.85
            }
            rgbw={light.stripBead === "rgbw"}
            declared={declared}
            reported={previewing ? [] : display.reported}
            regions={
              previewing && selected
                ? [{ kind: "sel", start: selected.start, stop: selected.stop }]
                : display.regions
            }
            ariaLabel={`${light.name} strip, ${light.ledCount} LEDs, ${light.stripBead === "rgbw" ? "RGBW" : "RGB"}`}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[5px] w-4 border-x border-t border-[#9a9488]" />
            Your Elements
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[5px] w-4 border-x border-b border-[#6b7384]" />
            Controller segments
          </span>
          {rangeDriftKey ? (
            <>
              <span className="sr-only" aria-label="Range drift key">
                drift
              </span>
              <span className="inline-flex items-center gap-1.5 text-primary">
                <span className="h-[5px] w-4 border-x border-t border-dashed border-primary" />
                Doesn’t match
              </span>
            </>
          ) : null}
          {rangeErrorKey ? (
            <span className="inline-flex items-center gap-1.5 text-destructive" aria-label="Range error key">
              <span className="h-[5px] w-4 border border-destructive bg-[rgba(224,112,112,0.2)]" />
              {rangeErrorKey}
            </span>
          ) : null}
          <span className="ml-auto font-mono">
            {light.ledCount} LEDs · {light.stripChip}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border bg-[#0e1014]">
        <div className="grid grid-cols-[80px_minmax(0,1.3fr)_120px_70px_minmax(0,1.3fr)_110px] gap-3.5 border-b border-border px-[18px] py-2.5 text-[12px] text-muted-foreground">
          <span>Where</span>
          <span>Element</span>
          <span>LEDs</span>
          <span>Count</span>
          <span>Controller</span>
          <span />
        </div>
        {draft.length === 0 ? (
          <p className="px-[18px] py-3 text-[13px] text-muted-foreground">Nothing declared yet.</p>
        ) : (
          draft.map((element) => (
            <ElementRow
              key={element.id}
              element={element}
              detail={detail}
              display={display}
              issues={issues}
              comparable={comparable}
              selected={selected?.id === element.id}
              ledCount={Math.max(light.ledCount, 1)}
              onSelect={() => onSelect(element.id)}
              onPatch={onPatch}
              onRemove={onRemove}
              onDetail={onDetail}
            />
          ))
        )}
        <button
          type="button"
          onClick={onAdd}
          className="w-full px-[18px] py-3 text-left text-[13px] text-muted-foreground hover:bg-secondary/60"
        >
          + Add Element
        </button>
        {notice ? <p className="px-[18px] pb-3 text-[13px] text-destructive">{notice}</p> : null}
      </div>

      {dirty ? (
        <div className="sticky bottom-4 flex flex-col gap-2 rounded-xl border border-input bg-[#12141a] px-3.5 py-3 shadow-[0_-12px_40px_rgba(0,0,0,0.5)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-primary">
              {dirty
                ? `${changed} unsaved change${changed === 1 ? "" : "s"}`
                : "Declared ranges"}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={onRevert} disabled={!dirty || busy !== null}>
                Revert
              </Button>
              <Button variant="outline" onClick={onSave} disabled={!canSave}>
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
              <Button
                aria-label="Apply"
                onClick={onApply}
                disabled={!canApply}
                title={applyReason ?? undefined}
              >
                {busy === "apply" ? "Applying…" : dirty ? "Save & Apply" : "Apply"}
              </Button>
            </div>
          </div>
          {!bannerOwnsReason && applyReason ? (
            <p className="text-[13px] text-destructive">{applyReason}</p>
          ) : null}
        </div>
      ) : (
        <Button
          className="sr-only"
          aria-label="Apply"
          onClick={onApply}
          disabled={!canApply}
          title={applyReason ?? undefined}
        >
          Apply
        </Button>
      )}
      {!dirty && !bannerOwnsReason && applyReason ? (
        <p className="text-[13px] text-destructive">{applyReason}</p>
      ) : null}
    </div>
  );
}

function ElementRow({
  element,
  detail,
  display,
  issues,
  comparable,
  selected,
  ledCount,
  onSelect,
  onPatch,
  onRemove,
  onDetail,
}: {
  element: Element;
  detail: LightDetailPayload;
  display: RangeDisplay;
  issues: { code: "invert" | "overlap" | "over-ledCount"; message: string; elementId?: string; otherId?: string; start: number; stop: number }[];
  comparable: boolean;
  selected: boolean;
  ledCount: number;
  onSelect: () => void;
  onPatch: (patch: Partial<Element>) => void;
  onRemove: () => void;
  onDetail: (next: LightDetailPayload) => void;
}) {
  const rail = display.declared.find((item) => item.id === element.id);
  const rowIssues = issues.filter(
    (issue) => issue.elementId === element.id || issue.otherId === element.id,
  );
  const kind = selectedKind(rowIssues[0]?.code, rail?.differs === true, comparable);
  const errorWord = rangeErrorLabel(rowIssues[0]?.code);
  const reported = display.reported.find(
    (item) => item.start < element.stop && item.stop > element.start,
  );
  const controller =
    errorWord ??
    (kind === "no compare"
      ? "no compare"
      : kind === "drift"
        ? reported
          ? `Reports ${reported.start}–${reported.stop}`
          : "drift"
        : "Matches");
  const count = element.stop > element.start ? element.stop - element.start : 0;
  const width = Math.max(0, Math.min(100, (count / ledCount) * 100));
  const left = Math.max(0, Math.min(100, (element.start / ledCount) * 100));
  const session = detail.session;
  const previewHere =
    session?.kind === "preview" &&
    (session.target.elementId === element.id || session.target.elementId === null);
  const [color, setColor] = useState<string>(PREVIEW_SWATCHES[3]);
  const [brightness, setBrightness] = useState(detail.light.brightness ?? 180);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);

  async function preview() {
    if (previewHere && session?.kind === "preview") {
      setPreviewBusy(true);
      const res = await postJson<LightDetailPayload>(`/api/lights/${detail.light.id}/preview/end`, {});
      setPreviewBusy(false);
      if (!res.ok) {
        setPreviewNotice(res.data.message ?? "Could not restore.");
        return;
      }
      onDetail(res.data);
      return;
    }
    const reason = previewRefuseReason({
      reachable: detail.light.reachability !== "no-answer",
      hasTarget: element.stop > element.start,
      busyKind: session?.kind ?? null,
    });
    if (reason) {
      setPreviewNotice(reason);
      return;
    }
    setPreviewBusy(true);
    setPreviewNotice(null);
    const res = await postJson<LightDetailPayload>(`/api/lights/${detail.light.id}/preview`, {
      elementId: element.id,
      color,
      brightness,
    });
    setPreviewBusy(false);
    if (!res.ok) {
      setPreviewNotice(res.data.message ?? "Nothing was sent.");
      return;
    }
    onDetail(res.data);
  }

  async function see(seen: "yes" | "no") {
    const res = await postJson<LightDetailPayload>(`/api/lights/${detail.light.id}/preview/seen`, {
      seen,
    });
    if (!res.ok) {
      setPreviewNotice(res.data.message ?? "Could not record that.");
      return;
    }
    onDetail(res.data);
  }

  const rungs =
    previewHere && session
      ? proofLadder({
          sentAt: session.startedAt,
          reported: detail.liveMatch ?? null,
          seenByYou: session.seenByYou,
          label: session.target.label,
        })
      : [];

  return (
    <div
      className={cn(
        "border-b border-border",
        selected && "bg-[#12141a] shadow-[inset_2px_0_0_#d4a574]",
      )}
    >
      <div className="flex items-center gap-3.5 px-[18px] py-[13px]">
        <button
          type="button"
          onClick={onSelect}
          className="grid min-w-0 flex-1 grid-cols-[80px_minmax(0,1.3fr)_120px_70px_minmax(0,1.3fr)] items-center gap-3.5 text-left"
        >
          <span className="relative h-1.5 rounded-[3px] bg-border">
            <span
              className="absolute inset-y-0 rounded-[3px]"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: selected ? "#d4a574" : "#6b7384",
              }}
            />
          </span>
          <span className="text-[15px] font-medium">{element.label}</span>
          <span className="font-mono text-[13px] text-[#c9c3b8]">
            {element.start}–{element.stop}
          </span>
          <span className="font-mono text-muted-foreground">{count}</span>
          <span
            className={cn(
              "text-[13px]",
              (kind === "drift" || kind === "no compare") && "text-primary",
              errorWord && "text-destructive",
              kind === "seg" && "text-muted-foreground",
            )}
          >
            {selected ? (
              <span className="sr-only" aria-label="Element kind">
                {kind}
              </span>
            ) : null}
            <span>{controller}</span>
          </span>
        </button>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-[30px] px-3 text-[13px]",
            previewHere && "border-online text-online",
          )}
          disabled={previewBusy}
          onClick={() => {
            onSelect();
            void preview();
          }}
        >
          {previewHere ? "End Preview" : "Preview"}
        </Button>
      </div>
      {selected ? (
        <div className="flex flex-col gap-3 pr-[18px] pb-4 pl-[112px] pt-1">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              value={element.label}
              onChange={(event) => onPatch({ label: event.target.value })}
              aria-label="Element label"
              className="max-w-[220px] font-sans"
            />
            <Input
              inputMode="numeric"
              value={Number.isFinite(element.start) ? String(element.start) : ""}
              onChange={(event) => onPatch({ start: parseIndex(event.target.value, element.start) })}
              aria-label="Start, first LED, inclusive"
              className="w-24"
            />
            <Input
              inputMode="numeric"
              value={Number.isFinite(element.stop) ? String(element.stop) : ""}
              onChange={(event) => onPatch({ stop: parseIndex(event.target.value, element.stop) })}
              aria-label="Stop, after last LED, exclusive"
              className={cn("w-24", rowIssues.length && "border-destructive text-destructive")}
            />
            <button type="button" onClick={onRemove} className="text-[13px] text-muted-foreground">
              Remove
            </button>
          </div>
          {rowIssues.map((issue) => (
            <p key={`${issue.code}-${issue.start}-${issue.stop}`} className="text-[13px] text-destructive">
              {issue.message}
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              {PREVIEW_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={SWATCH_NAMES[swatch] ?? swatch}
                  onClick={() => setColor(swatch)}
                  className="size-[22px] rounded-full"
                  style={{
                    background: swatch,
                    boxShadow:
                      color === swatch ? "0 0 0 2px #0c0d10, 0 0 0 4px #ece7dc" : undefined,
                  }}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              Brightness
              <input
                type="range"
                min={1}
                max={255}
                value={brightness}
                onChange={(event) => setBrightness(Number(event.target.value))}
                className="h-1 w-[140px] accent-primary"
                aria-label="Preview brightness"
              />
              <span className="font-mono">{Math.round((brightness / 255) * 100)}%</span>
            </label>
            {previewHere ? (
              <div className="ml-auto flex items-center gap-2 text-[13px]">
                <span>Lit the right LEDs?</span>
                <Button variant="outline" className="h-[30px] px-3 text-[13px]" onClick={() => void see("yes")}>
                  Yes
                </Button>
                <Button variant="outline" className="h-[30px] px-3 text-[13px]" onClick={() => void see("no")}>
                  No
                </Button>
              </div>
            ) : null}
          </div>
          <p className="text-[12px] text-muted-foreground">
            Temporary. Ending the Preview restores the previous look. Nothing is saved to the controller.
          </p>
          {previewHere ? <p>Preview live on {session?.target.label}</p> : null}
          {rungs.map((rung) => (
            <p key={rung.key} className="text-[13px] text-muted-foreground">
              {rung.label}
            </p>
          ))}
          {previewNotice ? <p className="text-[13px] text-destructive">{previewNotice}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ApplyFailed({
  apply,
  onAdopt,
  onRetry,
}: {
  apply: ApplyResult;
  onAdopt: () => void;
  onRetry: () => void;
}) {
  const adoptReason = adoptControllerRangesReason(apply);
  const unknownReread =
    apply.read === null || apply.message === APPLY_UNKNOWN_SEGMENTS_MESSAGE;
  const rows =
    apply.rows.length > 0
      ? apply.rows
      : apply.sent.map((item) => ({
          label: item.label,
          sent: { start: item.start, stop: item.stop },
          read: null,
          matched: false,
        }));
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#5a2f33] bg-[#1a1113] px-4 py-3.5">
      <span className="text-[15px] font-medium text-destructive">{apply.message}</span>
      {rows.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1.2fr)_auto_auto] gap-x-3 gap-y-1 text-[13px]">
          <span className="text-muted-foreground">Element</span>
          <span className="text-muted-foreground">Sent</span>
          <span className="text-muted-foreground">Read back</span>
          {rows.map((row) => (
            <div key={`${row.label}-${row.sent.start}`} className="contents">
              <span>{row.label}</span>
              <span className="font-mono">
                {row.sent.start}–{row.sent.stop}
              </span>
              <span className={cn("font-mono", row.matched ? undefined : "text-destructive")}>
                {row.read
                  ? `${row.read.start}–${row.read.stop}`
                  : unknownReread
                    ? "unknown"
                    : "nothing"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-[13px] text-[#c9c3b8]">
        {unknownReread ? "Your draft is kept." : "Your draft is kept. Nothing else on the controller changed."}
      </p>
      <p className="text-[13px] text-primary">{apply.caption}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-9 text-[13px]"
          onClick={onAdopt}
          disabled={adoptReason !== null}
          title={adoptReason ?? undefined}
        >
          Use controller’s
        </Button>
        <Button className="h-9 text-[13px]" onClick={onRetry}>
          Apply again
        </Button>
      </div>
      {adoptReason ? <p className="text-[12px] text-muted-foreground">{adoptReason}</p> : null}
    </div>
  );
}

function displayBeadLocal(light: LightDetailPayload["light"]) {
  if (light.reachability === "no-answer" || light.on == null) return "unknown" as const;
  return light.bead;
}

function rangeErrorLabel(
  code: "invert" | "overlap" | "over-ledCount" | undefined,
): "invert" | "overlap" | "past strip" | undefined {
  if (code === "over-ledCount") return "past strip";
  if (code) return code;
  return undefined;
}

function selectedKind(
  code: "invert" | "overlap" | "over-ledCount" | undefined,
  differs: boolean,
  comparable: boolean,
): "overlap" | "invert" | "past strip" | "drift" | "no compare" | "seg" {
  return rangeErrorLabel(code) ?? (differs ? "drift" : comparable ? "seg" : "no compare");
}

function parseIndex(raw: string, fallback: number): number {
  if (raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
