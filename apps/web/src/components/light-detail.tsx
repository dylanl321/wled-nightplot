"use client";

import {
  APPLY_UNKNOWN_SEGMENTS_MESSAGE,
  adoptControllerRangesReason,
  adoptableControllerRanges,
  adoptReportedRanges,
  applyRefuseReason,
  knownApplyColor,
  buildRangeDisplay,
  firstFreeRange,
  reportedRangeRails,
  stripBeadCaption,
  validateDeclaredRanges,
  type ApplyResult,
  type Element,
  type LightDetail as LightDetailPayload,
  type ReaddressStep,
} from "@nightplot/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeleteLight } from "@/components/delete-light";
import { SafeSettingsPanel } from "@/components/safe-settings";
import { StripBeads, type StripSpan } from "@/components/strip-beads";
import { StripProvisionPanel } from "@/components/strip-provision";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TestLivePanel, liveBeadColor } from "@/components/test-live";
import { fetchJson, patchJson, postJson } from "@/lib/api";
import { displayBead, inspectPowerHow, lightPowerStatus } from "@/lib/power-status";
import { lastSeenLabel, snapshotLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

export function LightDetail({
  initial,
  mode: initialMode,
}: {
  initial: LightDetailPayload;
  mode: "inspect" | "ranges" | "live" | "safe" | "strip";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"inspect" | "ranges" | "live" | "safe" | "strip">(
    initialMode,
  );
  const [detail, setDetail] = useState(initial);
  const [draft, setDraft] = useState<Element[]>(initial.elements);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.session?.target.elementId ?? initial.elements[0]?.id ?? null,
  );
  const [busy, setBusy] = useState<"save" | "refresh" | "apply" | "readdress" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [apply, setApply] = useState<ApplyResult | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressHost, setAddressHost] = useState(initial.light.displayHost);
  const [addressSteps, setAddressSteps] = useState<ReaddressStep[] | null>(null);

  const light = detail.light;
  const unreachable = light.reachability === "no-answer";
  const detailRef = useRef(detail);
  const draftRef = useRef(draft);
  detailRef.current = detail;
  draftRef.current = draft;

  useEffect(() => {
    function onLightsChanged() {
      void fetchJson<LightDetailPayload>(`/api/lights/${initial.light.id}`)
        .then((next) => {
          setDraft(adoptElementsAfterStrip(detailRef.current, draftRef.current, next));
          setDetail(next);
        })
        .catch(() => {
          /* keep the open Light */
        });
    }
    window.addEventListener("nightplot:lights-changed", onLightsChanged);
    return () => window.removeEventListener("nightplot:lights-changed", onLightsChanged);
  }, [initial.light.id]);

  function goMode(next: "inspect" | "ranges" | "live" | "safe" | "strip") {
    setMode(next);
    const path =
      next === "ranges"
        ? `/lights/${light.id}?mode=ranges`
        : next === "live"
          ? `/lights/${light.id}?mode=live`
          : next === "safe"
            ? `/lights/${light.id}?mode=safe`
            : next === "strip"
              ? `/lights/${light.id}?mode=strip`
              : `/lights/${light.id}`;
    window.history.replaceState(null, "", path);
  }
  const issues = useMemo(
    () => validateDeclaredRanges(draft, light.ledCount),
    [draft, light.ledCount],
  );
  const display = useMemo(() => {
    if (mode === "inspect") return detail.display;
    const segmentsKnown = detail.light.segmentCount !== null;
    const reported =
      unreachable || !segmentsKnown ? null : reportedRangeRails(detail.reported);
    return buildRangeDisplay(draft, reported, issues, { reachable: !unreachable });
  }, [
    detail.display,
    detail.light.segmentCount,
    detail.reported,
    draft,
    issues,
    mode,
    unreachable,
  ]);

  const dirty = useMemo(() => !sameRanges(draft, detail.elements), [draft, detail.elements]);
  const selected = draft.find((element) => element.id === selectedId) ?? null;
  const firstIssue = issues[0] ?? null;
  const canSave = dirty && issues.length === 0 && busy === null;
  const applyReason = applyRefuseReason({
    reachable: !unreachable,
    issueMessage: firstIssue?.message ?? null,
    elementCount: draft.length,
    busyKind: detail.session?.kind ?? null,
    segmentCount: light.segmentCount,
    segmentColor: knownApplyColor(typeof light.bead === "string" ? light.bead : null),
  });
  const canApply = applyReason === null && busy === null;

  const declared: StripSpan[] = display.declared
    .filter((rail) => rail.stop > rail.start)
    .map((rail) => ({
      start: rail.start,
      stop: rail.stop,
      label: rail.label,
      sel: (mode === "ranges" || mode === "live") && rail.id === selectedId,
      error: rail.error,
      differs: rail.differs,
    }));

  async function refresh() {
    setBusy("refresh");
    setNotice(null);
    try {
      const next = await fetchJson<LightDetailPayload>(`/api/lights/${light.id}`);
      setDetail(next);
      if (!dirty) setDraft(next.elements);
      router.refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Refresh failed.");
    }
    setBusy(null);
  }

  async function save() {
    if (!canSave) return;
    setBusy("save");
    setNotice(null);
    const res = await patchJson<LightDetailPayload>(`/api/lights/${light.id}/elements`, {
      elements: draft.map((element) => ({
        id: element.id,
        label: element.label,
        start: element.start,
        stop: element.stop,
      })),
    });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Draft was not saved.");
      return;
    }
    setDetail(res.data);
    setDraft(res.data.elements);
    router.refresh();
  }

  function revert() {
    setDraft(detail.elements);
    setSelectedId(detail.elements[0]?.id ?? null);
    setNotice(null);
    setApply(null);
  }

  async function applyRanges() {
    if (applyReason) {
      setNotice(applyReason);
      return;
    }
    setBusy("apply");
    setNotice(null);
    const res = await postJson<LightDetailPayload>(`/api/lights/${light.id}/apply`, {
      elements: draft.map((element) => ({
        id: element.id,
        label: element.label,
        start: element.start,
        stop: element.stop,
      })),
    });
    setBusy(null);
    const payload = res.data as LightDetailPayload & { apply?: ApplyResult; message?: string };
    if (payload.apply) setApply(payload.apply);
    if (res.ok && payload.apply?.matched) {
      setDetail(payload);
      setDraft(payload.elements);
      router.refresh();
      return;
    }
    if (res.status === 409 && payload.light) {
      setDetail(payload);
      return;
    }
    setNotice(payload.message ?? "Apply did not succeed.");
  }

  function useControllerRanges() {
    if (!apply) return;
    const rails = adoptableControllerRanges(apply);
    if (rails.length === 0) return;
    const next = adoptReportedRanges(draft, rails);
    setDraft(next);
    setSelectedId(next[0]?.id ?? null);
    setApply(null);
    setNotice(null);
  }

  async function readdress() {
    setBusy("readdress");
    setNotice(null);
    const res = await postJson<
      LightDetailPayload & {
        readdress?: { steps?: ReaddressStep[]; switched?: boolean };
        steps?: ReaddressStep[];
        message?: string;
      }
    >(`/api/lights/${light.id}/readdress`, { host: addressHost });
    setBusy(null);
    const payload = res.data as LightDetailPayload & {
      readdress?: { steps?: ReaddressStep[] };
      steps?: ReaddressStep[];
      message?: string;
    };
    const steps = payload.readdress?.steps ?? payload.steps ?? null;
    if (steps) setAddressSteps(steps);
    if (res.ok && payload.light) {
      setDetail(payload);
      setAddressHost(payload.light.displayHost);
      router.refresh();
      return;
    }
    setNotice(payload.message ?? "Address was not changed.");
  }

  function addElement() {
    const gap = firstFreeRange(draft, light.ledCount);
    if (!gap) {
      setNotice("No free LEDs left on this strip.");
      return;
    }
    const next: Element = {
      id: crypto.randomUUID(),
      lightId: light.id,
      label: `Element ${draft.length + 1}`,
      start: gap.start,
      stop: gap.stop,
    };
    setDraft((current) => [...current, next]);
    setSelectedId(next.id);
    setNotice(null);
  }

  function removeSelected() {
    if (!selected) return;
    const rest = draft.filter((element) => element.id !== selected.id);
    setDraft(rest);
    setSelectedId(rest[0]?.id ?? null);
  }

  function patchSelected(patch: Partial<Element>) {
    if (!selected) return;
    setDraft((current) =>
      current.map((element) =>
        element.id === selected.id ? { ...element, ...patch } : element,
      ),
    );
  }

  const pitch = light.ledCount <= 80 ? 13.4 : 8.7;
  const bead = displayBead(light);
  const status = lightPowerStatus(light);

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-1 flex-col gap-4 px-5 py-6 sm:px-8 sm:py-8">
      <Link href="/" className="text-[13px] text-muted-foreground lg:hidden">
        ‹ Lights
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{light.name}</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
              unreachable
                ? "border-[#5a2f33] text-destructive"
                : "border-[#1f4a45] text-online",
            )}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: unreachable ? "#e07070" : "#7ee0d0" }}
            />
            {unreachable ? "No answer" : "Online"}
          </span>
          <div className="ml-auto flex gap-1.5">
            <Chip>{light.controllerKind.toUpperCase()}</Chip>
            <Chip>{light.stripChip}</Chip>
          </div>
        </div>
        <p className="font-mono text-xs text-quiet">
          {light.displayHost}
          {light.mac ? ` · ${light.mac}` : ""}
          {light.firmware ? ` · ${light.firmware}` : ""}
          {` · ${light.ledCount} LEDs`}
        </p>
        {light.staleInfoName ? (
          <p className="text-[12px] text-quiet">
            /json/info still reports {light.staleInfoName} until reboot. The title uses the name
            from /json/cfg.
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex rounded-[9px] border border-input bg-[#12141a] p-[3px] text-[13px]">
          <ModeButton active={mode === "inspect"} onClick={() => goMode("inspect")}>
            Inspect
          </ModeButton>
          <ModeButton active={mode === "strip"} onClick={() => goMode("strip")}>
            Strip
          </ModeButton>
          <ModeButton active={mode === "ranges"} onClick={() => goMode("ranges")}>
            Edit ranges
          </ModeButton>
          <ModeButton active={mode === "live"} onClick={() => goMode("live")}>
            Test live
          </ModeButton>
          <ModeButton active={mode === "safe"} onClick={() => goMode("safe")}>
            Safe settings
          </ModeButton>
        </div>
        <div className="flex items-center gap-3 text-xs text-quiet sm:ml-auto">
          <span>{unreachable ? lastSeenLabel(light.lastSeenAt) : snapshotLabel(detail.snapshotAt)}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-[13px] text-foreground"
            disabled={busy === "refresh"}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-[#07080a] px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-quiet">
          <span className={mode === "live" ? "text-online" : "text-[#c9c3b8]"}>
            {mode === "ranges"
              ? "Draft"
              : mode === "live"
                ? "What the strip reports"
                : mode === "safe" || mode === "strip"
                  ? "Last snapshot"
                  : "Last snapshot"}
          </span>
          {mode === "ranges" ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-primary">
                <span className="h-2 w-3 rounded-[2px] border border-dashed border-primary" />
                drift
              </span>
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <span className="h-2 w-3 rounded-[2px] border border-destructive bg-[rgba(224,112,112,0.2)]" />
                overlap
              </span>
            </>
          ) : null}
          <span className="sm:ml-auto">
            {stripBeadCaption(light.stripBead)} · above: declared · below: reported
          </span>
        </div>
        <div className="overflow-x-auto">
          <StripBeads
            id={`light-${light.id}-${mode}`}
            count={Math.max(light.ledCount, 1)}
            perRow={Math.min(Math.max(light.ledCount, 1), 100)}
            pitch={pitch}
            color={(index) =>
              mode === "live" ? liveBeadColor(index, detail, bead) : bead
            }
            brightness={
              unreachable
                ? 1
                : mode === "live" && detail.session
                  ? Math.max(0.35, (detail.session.brightness ?? 180) / 255)
                  : 0.8
            }
            rgbw={light.stripBead === "rgbw"}
            declared={declared}
            reported={mode === "live" ? [] : display.reported}
            regions={
              mode === "live"
                ? [
                    {
                      kind: "sel",
                      start: selected?.start ?? 0,
                      stop: selected?.stop ?? light.ledCount,
                    },
                  ]
                : display.regions
            }
            handles={mode === "ranges" && Boolean(selected)}
            ariaLabel={`${light.name} strip, ${light.ledCount} LEDs, ${stripBeadCaption(light.stripBead)}`}
          />
        </div>
      </div>

      {mode === "safe" ? (
        <SafeSettingsPanel
          lightId={light.id}
          unreachable={unreachable}
          onUpdated={(next) => {
            setDetail(next);
            router.refresh();
          }}
        />
      ) : mode === "strip" ? (
        <StripProvisionPanel
          lightId={light.id}
          unreachable={unreachable}
          onUpdated={(next) => {
            setDraft(adoptElementsAfterStrip(detailRef.current, draftRef.current, next));
            setDetail(next);
            router.refresh();
          }}
        />
      ) : mode === "inspect" ? (
        <InspectFacts
          detail={detail}
          status={status}
          addressOpen={addressOpen}
          addressHost={addressHost}
          addressSteps={addressSteps}
          busy={busy === "readdress"}
          onToggleAddress={() => {
            setAddressOpen((open) => !open);
            setAddressSteps(null);
            setAddressHost(light.displayHost);
          }}
          onHost={setAddressHost}
          onCheck={() => void readdress()}
          onSafe={() => goMode("safe")}
          onStrip={() => goMode("strip")}
        />
      ) : mode === "live" ? (
        <TestLivePanel
          detail={detail}
          unreachable={unreachable}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDetail={setDetail}
        />
      ) : (
        <EditRanges
          draft={draft}
          selected={selected}
          issues={issues}
          display={display}
          comparable={!unreachable && light.segmentCount !== null}
          onSelect={setSelectedId}
          onPatch={patchSelected}
          onAdd={addElement}
          onRemove={removeSelected}
        />
      )}

      {mode === "ranges" && apply && apply.status !== "matched" ? (
        <ApplyFailed apply={apply} onAdopt={useControllerRanges} onRetry={() => void applyRanges()} />
      ) : null}

      {mode === "ranges" ? (
        <div className="mt-auto flex flex-col gap-3 rounded-[10px] border border-input bg-[#12141a] px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <span
              className={
                dirty || firstIssue || display.notes[0] ? "text-primary" : "text-quiet"
              }
            >
              {dirty
                ? `${changedCount(draft, detail.elements)} unsaved change${
                    changedCount(draft, detail.elements) === 1 ? "" : "s"
                  }`
                : apply?.matched
                  ? "Controller reports the ranges we sent"
                  : firstIssue
                    ? firstIssue.message
                    : display.notes[0]?.text
                      ? display.notes[0].text
                      : "Declared ranges match the last save"}
            </span>
            <span className="text-[13px] text-quiet">
              Apply writes to the controller, then reads it back. Preview stays temporary.
            </span>
            {apply?.matched ? (
              <span className="text-[12px] text-primary">{apply.caption}</span>
            ) : null}
            {applyReason ? (
              <span className="text-[13px] text-destructive">{applyReason}</span>
            ) : firstIssue ? (
              <span className="text-[13px] text-destructive">{firstIssue.message}</span>
            ) : null}
            {notice ? <span className="text-[13px] text-destructive">{notice}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button variant="outline" onClick={revert} disabled={!dirty || busy !== null}>
              Revert
            </Button>
            <Button variant="outline" onClick={() => void save()} disabled={!canSave}>
              {busy === "save" ? "Saving…" : "Save declared"}
            </Button>
            <Button onClick={() => void applyRanges()} disabled={!canApply} title={applyReason ?? undefined}>
              {busy === "apply" ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      ) : notice ? (
        <p className="text-[13px] text-destructive">{notice}</p>
      ) : null}

      {mode === "inspect" ? (
        <DeleteLight
          lightId={light.id}
          name={light.name}
          initialChecks={detail.deleteChecks}
        />
      ) : null}

      <p className="text-[11px] tracking-[0.14em] text-quiet uppercase">
        configure · r6 · strip + safe
      </p>
    </div>
  );
}

function InspectFacts({
  detail,
  status,
  addressOpen,
  addressHost,
  addressSteps,
  busy,
  onToggleAddress,
  onHost,
  onCheck,
  onSafe,
  onStrip,
}: {
  detail: LightDetailPayload;
  status: string;
  addressOpen: boolean;
  addressHost: string;
  addressSteps: ReaddressStep[] | null;
  busy: boolean;
  onToggleAddress: () => void;
  onHost: (value: string) => void;
  onCheck: () => void;
  onSafe: () => void;
  onStrip: () => void;
}) {
  const light = detail.light;
  const how = inspectPowerHow(light);
  const drift = detail.display.notes[0]?.text;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <FactCard eyebrow="Who it is">
          <p className="leading-[1.55] text-[#c9c3b8]">
            Called <span className="text-foreground">{light.name}</span>, at{" "}
            <span className="font-mono text-foreground">{light.displayHost}</span>.
          </p>
          {light.mac ? (
            <p className="font-mono text-[12px] text-quiet">{light.mac}</p>
          ) : null}
          <button type="button" onClick={onToggleAddress} className="text-[13px] text-foreground">
            {addressOpen ? "Close re-address" : "Re-address"}
          </button>
        </FactCard>
        <FactCard eyebrow="What it has">
          <p className="leading-[1.55] text-[#c9c3b8]">
            <span className="text-foreground">{light.ledCount} LEDs</span>
            {" ("}
            <span className="text-foreground">{stripBeadCaption(light.stripBead)}</span>
            {") in "}
            <span className="text-foreground">{detail.elements.length}</span>
            {detail.elements.length === 1 ? " Element" : " Elements"}.
            {light.segmentCount === null
              ? " Segments unknown."
              : ` ${light.segmentCount} segment${light.segmentCount === 1 ? "" : "s"} reported.`}
            {light.firmware ? ` ${light.firmware}.` : null}
          </p>
          <button type="button" onClick={onStrip} className="text-[13px] text-foreground">
            Strip — type, length, GPIO, or a catalog product
          </button>
          {detail.elements.length === 0 ? (
            <p className="text-[12px] text-quiet">
              No Elements declared yet. Edit ranges to name them.
            </p>
          ) : null}
          {drift ? <p className="text-[12px] text-primary">{drift}</p> : null}
        </FactCard>
        <FactCard eyebrow="How it’s doing">
          <p className="leading-[1.55] text-[#c9c3b8]">{how}</p>
          <p className="text-[12px] text-quiet">{status}</p>
          <button type="button" onClick={onSafe} className="text-[13px] text-foreground">
            Safe settings
          </button>
        </FactCard>
      </div>
      {addressOpen ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[#3a4150] bg-[#12141a] p-4">
          <span className="font-medium">Re-address</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="font-mono text-[13px] text-quiet">{light.displayHost} →</span>
            <Input
              value={addressHost}
              onChange={(event) => onHost(event.target.value)}
              aria-label="New host or host:port"
              className="font-mono"
            />
            <Button onClick={onCheck} disabled={busy || !addressHost.trim()}>
              {busy ? "Checking…" : "Check"}
            </Button>
          </div>
          {addressSteps?.length ? (
            <div className="flex flex-col gap-1.5 text-[13px]">
              {addressSteps.map((step) => (
                <div key={step.text} className="flex gap-2">
                  <span className={step.done ? "text-online" : "text-destructive"}>
                    {step.done ? "✓" : "–"}
                  </span>
                  <span className="text-[#c9c3b8]">{step.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-quiet">
              Probes the new address first. Switches only when the same MAC answers. Identity
              comes from that snapshot.
            </p>
          )}
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
    <div className="flex flex-col gap-2 rounded-[14px] border border-[#5a2f33] bg-[#1a1113] p-4">
      <span className="text-[16px] font-semibold text-destructive">{apply.message}</span>
      {rows.length > 0 ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          {rows.map((row) => (
            <div key={`${row.label}-${row.sent.start}`} className="contents">
              <span className="text-muted-foreground">Sent</span>
              <span className="font-mono">
                {row.label} {row.sent.start}–{row.sent.stop}
              </span>
              <span className="text-muted-foreground">Read back</span>
              <span className={cn("font-mono", row.matched ? undefined : "text-destructive")}>
                {row.read
                  ? `${row.label} ${row.read.start}–${row.read.stop}`
                  : unknownReread
                    ? "unknown"
                    : "nothing"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-[12px] leading-5 text-[#c9c3b8]">
        {unknownReread
          ? "Your draft is kept."
          : "Your draft is kept. Nothing else on the controller changed."}
      </p>
      <p className="text-[12px] text-primary">{apply.caption}</p>
      <div className="mt-1 flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onAdopt}
            disabled={adoptReason !== null}
            title={adoptReason ?? undefined}
          >
            Use controller’s
          </Button>
          <Button className="flex-1" onClick={onRetry}>
            Apply again
          </Button>
        </div>
        {adoptReason ? <p className="text-[12px] text-quiet">{adoptReason}</p> : null}
      </div>
    </div>
  );
}

function EditRanges({
  draft,
  selected,
  issues,
  display,
  comparable,
  onSelect,
  onPatch,
  onAdd,
  onRemove,
}: {
  draft: Element[];
  selected: Element | null;
  issues: ReturnType<typeof validateDeclaredRanges>;
  display: ReturnType<typeof buildRangeDisplay>;
  comparable: boolean;
  onSelect: (id: string) => void;
  onPatch: (patch: Partial<Element>) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const selectedIssues = issues.filter(
    (issue) => issue.elementId === selected?.id || issue.otherId === selected?.id,
  );
  const selectedRail = display.declared.find((rail) => rail.id === selected?.id);
  const reportedForSelected = display.reported.find(
    (rail) => selected && rail.start <= selected.start && rail.stop >= selected.stop,
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border p-4",
          selectedIssues.length
            ? "border-primary/70 bg-[#15130f]"
            : "border-border bg-[#0e1014]",
        )}
      >
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-quiet" aria-label="Element kind">
                {selectedKind(
                  selectedRail?.error === true,
                  selectedRail?.differs === true,
                  comparable,
                )}
              </span>
              <Input
                value={selected.label}
                onChange={(event) => onPatch({ label: event.target.value })}
                className="max-w-[220px] font-sans"
                aria-label="Element label"
              />
              <button
                type="button"
                onClick={onRemove}
                className="ml-auto text-[13px] text-quiet hover:text-foreground"
              >
                Remove from draft
              </button>
            </div>
            {reportedForSelected ? (
              <p className="text-[12px] text-muted-foreground">
                controller reports {reportedForSelected.start}–{reportedForSelected.stop}
              </p>
            ) : null}
            <div className="grid grid-cols-3 gap-2.5 font-mono">
              <Field label="Start · first LED">
                <Input
                  inputMode="numeric"
                  value={Number.isFinite(selected.start) ? String(selected.start) : ""}
                  onChange={(event) =>
                    onPatch({ start: parseIndex(event.target.value, selected.start) })
                  }
                  aria-label="Start, first LED, inclusive"
                />
              </Field>
              <Field
                label="Stop · after last LED"
                tone={selectedIssues.some((issue) => issue.code !== "overlap") ? "bad" : undefined}
              >
                <Input
                  inputMode="numeric"
                  value={Number.isFinite(selected.stop) ? String(selected.stop) : ""}
                  onChange={(event) =>
                    onPatch({ stop: parseIndex(event.target.value, selected.stop) })
                  }
                  aria-label="Stop, after last LED, exclusive"
                  className={
                    selectedIssues.length ? "border-destructive text-destructive" : undefined
                  }
                />
              </Field>
              <Field label="Length">
                <div className="flex h-9 items-center px-2.5 text-muted-foreground">
                  {selected.stop > selected.start ? selected.stop - selected.start : "—"}
                </div>
              </Field>
            </div>
            {selectedIssues.map((issue) => (
              <p key={`${issue.code}-${issue.start}-${issue.stop}`} className="text-[13px] text-destructive">
                {issue.message}
              </p>
            ))}
          </>
        ) : (
          <p className="text-[13px] text-quiet">
            No Element selected. Add one from the free LEDs, then type start and stop.
          </p>
        )}
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-[#0e1014] text-[13px]">
        {draft.length === 0 ? (
          <p className="px-3.5 py-3 text-quiet">Nothing declared yet.</p>
        ) : (
          draft.map((element) => {
            const rail = display.declared.find((item) => item.id === element.id);
            const rowIssues = issues.filter(
              (issue) => issue.elementId === element.id || issue.otherId === element.id,
            );
            const status = rowStatus(rowIssues[0]?.code, rail?.differs === true, comparable);
            return (
              <button
                key={element.id}
                type="button"
                onClick={() => onSelect(element.id)}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border px-3.5 py-3 text-left",
                  selected?.id === element.id && "bg-secondary",
                )}
              >
                <span className={rail?.error ? "text-primary" : undefined}>{element.label}</span>
                <span
                  className={cn(
                    "font-mono",
                    rail?.error ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {element.start}–{element.stop}
                </span>
                <span
                  className={cn(
                    "text-[12px]",
                    status === "matches" && "text-quiet",
                    (status === "drift" || status === "no compare") && "text-primary",
                    (status === "overlap" || status === "invert" || status === "over-ledCount") &&
                      "text-destructive",
                  )}
                >
                  {status === "over-ledCount" ? "past strip" : status}
                </span>
              </button>
            );
          })
        )}
        <button
          type="button"
          onClick={onAdd}
          className="px-3.5 py-3 text-left text-foreground hover:bg-secondary/60"
        >
          + Element from free LEDs
        </button>
      </div>
    </div>
  );
}

function FactCard({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-[#0e1014] p-4">
      <span className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
        {eyebrow}
      </span>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "bad";
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className={cn(
          "font-sans text-[11px]",
          tone === "bad" ? "text-destructive" : "text-quiet",
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[5px] border border-input px-2 py-0.5 font-mono text-[11px] text-[#c9c3b8]">
      {children}
    </span>
  );
}

function ModeButton({
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
        "flex-1 rounded-md px-3.5 py-1.5 text-center sm:flex-none",
        active ? "bg-[#2f3542] font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function selectedKind(
  error: boolean,
  differs: boolean,
  comparable: boolean,
): "overlap" | "drift" | "no compare" | "seg" {
  if (error) return "overlap";
  if (differs) return "drift";
  if (!comparable) return "no compare";
  return "seg";
}

function rowStatus(
  code: "invert" | "overlap" | "over-ledCount" | undefined,
  differs: boolean,
  comparable: boolean,
): "matches" | "drift" | "overlap" | "invert" | "over-ledCount" | "no compare" {
  if (code) return code;
  if (!comparable) return "no compare";
  return differs ? "drift" : "matches";
}

function parseIndex(raw: string, fallback: number): number {
  if (raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function adoptElementsAfterStrip(
  current: LightDetailPayload,
  draftNow: Element[],
  next: LightDetailPayload,
): Element[] {
  const lengthChanged = next.light.ledCount !== current.light.ledCount;
  const dirtyNow = !sameRanges(draftNow, current.elements);
  if (lengthChanged || !dirtyNow) return next.elements;
  return draftNow;
}

function sameRanges(a: Element[], b: Element[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
  const right = [...b].sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
  return left.every(
    (row, index) =>
      row.label === right[index]?.label &&
      row.start === right[index]?.start &&
      row.stop === right[index]?.stop,
  );
}

function changedCount(a: Element[], b: Element[]): number {
  if (a.length !== b.length) return Math.abs(a.length - b.length) || 1;
  return a.filter((row) => {
    const match = b.find((item) => item.id === row.id);
    return !match || match.label !== row.label || match.start !== row.start || match.stop !== row.stop;
  }).length || 1;
}
