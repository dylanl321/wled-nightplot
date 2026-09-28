"use client";

import {
  BLINK_PULSE_MS,
  adoptReportedRanges,
  adoptableControllerRanges,
  applyRefuseReason,
  blinkRefuseReason,
  buildRangeDisplay,
  firstFreeRange,
  knownApplyColor,
  reportedRangeRails,
  validateDeclaredRanges,
  type ApplyResult,
  type Element,
  type LightDetail as LightDetailPayload,
  type ReaddressStep,
} from "@nightplot/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ElementsPanel } from "@/components/elements-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { fetchJson, patchJson, postJson } from "@/lib/api";
import { inspectPowerHow } from "@/lib/power-status";
import { brightnessPct, lastSeenLabel, snapshotLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

type DetailTab = "elements" | "settings";
type LegacyMode = "inspect" | "ranges" | "live" | "safe" | "strip";

export function LightDetail({
  initial,
  mode,
  tab: tabProp,
}: {
  initial: LightDetailPayload;
  mode?: LegacyMode;
  tab?: DetailTab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<DetailTab>(tabProp ?? tabFromMode(mode));
  const [detail, setDetail] = useState(initial);
  const [draft, setDraft] = useState<Element[]>(initial.elements);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.session?.target.elementId ?? initial.elements[0]?.id ?? null,
  );
  const [busy, setBusy] = useState<"save" | "refresh" | "apply" | "readdress" | "blink" | null>(
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
    if (!mode) return;
    const path =
      tab === "settings" ? `/lights/${initial.light.id}?tab=settings` : `/lights/${initial.light.id}`;
    if (window.location.search.includes("mode=")) {
      window.history.replaceState(null, "", path);
    }
  }, [initial.light.id, mode, tab]);

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

  useEffect(() => {
    if (detail.session?.kind !== "blink") return;
    const wait = window.setTimeout(() => {
      void postJson<LightDetailPayload>(`/api/lights/${light.id}/blink/end`, {}).then((res) => {
        if (res.ok) setDetail(res.data);
      });
    }, BLINK_PULSE_MS);
    return () => window.clearTimeout(wait);
  }, [detail.session?.id, detail.session?.kind, light.id]);

  function goTab(next: DetailTab) {
    setTab(next);
    const path =
      next === "settings" ? `/lights/${light.id}?tab=settings` : `/lights/${light.id}`;
    window.history.replaceState(null, "", path);
  }

  const issues = useMemo(
    () => validateDeclaredRanges(draft, light.ledCount),
    [draft, light.ledCount],
  );
  const display = useMemo(() => {
    const segmentsKnown = detail.light.segmentCount !== null;
    const reported =
      unreachable || !segmentsKnown ? null : reportedRangeRails(detail.reported);
    return buildRangeDisplay(draft, reported, issues, { reachable: !unreachable });
  }, [detail.light.segmentCount, detail.reported, draft, issues, unreachable]);

  const dirty = useMemo(() => !sameRanges(draft, detail.elements), [draft, detail.elements]);
  const selected = draft.find((element) => element.id === selectedId) ?? null;
  const selectedRangeIssues = issuesForElement(issues, selected?.id);
  const rangeErrorKey =
    rangeErrorLabel(selectedRangeIssues[0]?.code) ?? rangeErrorLabel(issues[0]?.code);
  const rangeDriftKey = rangeDriftPresent(display);
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
  const blinkReason = blinkRefuseReason({
    reachable: !unreachable,
    busyKind: detail.session?.kind ?? null,
  });

  const declared = display.declared
    .filter((rail) => rail.stop > rail.start)
    .map((rail) => ({
      start: rail.start,
      stop: rail.stop,
      label: rail.label,
      sel: rail.id === selectedId,
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
    if (!canSave) return false;
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
      return false;
    }
    setDetail(res.data);
    setDraft(res.data.elements);
    router.refresh();
    return true;
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
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }
    setBusy("apply");
    setNotice(null);
    const res = await postJson<LightDetailPayload>(`/api/lights/${light.id}/apply`, {
      elements: draftRef.current.map((element) => ({
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
    setNotice(payload.message ?? payload.apply?.message ?? "Apply did not succeed.");
  }

  function useControllerRanges() {
    const rails = apply ? adoptableControllerRanges(apply) : [];
    if (rails.length === 0) return;
    const next = adoptReportedRanges(draft, rails);
    setDraft(next);
    setSelectedId(next[0]?.id ?? null);
    setApply(null);
    setNotice(null);
    setDetail((current) => ({
      ...current,
      reported: rails.map((rail) => ({ start: rail.start, stop: rail.stop, differs: false })),
      light: { ...current.light, segmentCount: rails.length },
    }));
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

  async function blink() {
    if (blinkReason) {
      setNotice(blinkReason);
      return;
    }
    setBusy("blink");
    setNotice(null);
    const res = await postJson<LightDetailPayload>(`/api/lights/${light.id}/blink`, {});
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Nothing was sent.");
      return;
    }
    setDetail(res.data);
  }

  const status = powerLine(light);
  const updated = unreachable
    ? lastSeenLabel(light.lastSeenAt).replace(/^last seen/, "Updated")
    : snapshotLabel(detail.snapshotAt).replace(/^Snapshot/, "Updated");

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col gap-4 px-6 py-6 sm:px-10">
      <p className="text-[13px] text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Lights
        </Link>
        <span> / {light.name}</span>
      </p>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.01em]">{light.name}</h1>
          <span className={cn("inline-flex items-center gap-1.5 text-[14px]", status.className)}>
            <span className="size-[7px] rounded-full" style={{ background: status.dot }} />
            {status.label}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12px] text-muted-foreground" suppressHydrationWarning>
              {updated}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-[34px] px-3 text-[13px]"
              onClick={() => void refresh()}
              disabled={busy === "refresh"}
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-[34px] px-3 text-[13px]"
              onClick={() => void blink()}
              disabled={unreachable || Boolean(blinkReason) || busy !== null}
            >
              {busy === "blink" ? "Blinking…" : "Blink"}
            </Button>
          </div>
        </div>
        {unreachable ? (
          <p className="text-[13px] text-destructive">{inspectPowerHow(light)}</p>
        ) : null}
        <div className="flex gap-6 border-b border-border">
          <TabButton active={tab === "elements"} onClick={() => goTab("elements")}>
            Elements
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => goTab("settings")}>
            Settings
          </TabButton>
        </div>
      </header>

      {tab === "settings" ? (
        <SettingsPanel
          detail={detail}
          addressOpen={addressOpen}
          addressHost={addressHost}
          addressSteps={addressSteps}
          addressBusy={busy === "readdress"}
          onToggleAddress={() => {
            setAddressOpen((open) => !open);
            setAddressSteps(null);
            setAddressHost(light.displayHost);
          }}
          onHost={setAddressHost}
          onCheck={() => void readdress()}
          onUpdated={(next) => {
            setDraft(adoptElementsAfterStrip(detailRef.current, draftRef.current, next));
            setDetail(next);
            router.refresh();
          }}
        />
      ) : (
        <ElementsPanel
          detail={detail}
          draft={draft}
          display={display}
          declared={declared}
          issues={issues}
          selectedId={selectedId}
          selected={selected}
          comparable={!unreachable && light.segmentCount !== null}
          dirty={dirty}
          apply={apply}
          applyReason={applyReason}
          canApply={canApply}
          canSave={canSave}
          busy={busy}
          notice={notice}
          rangeErrorKey={rangeErrorKey}
          rangeDriftKey={rangeDriftKey}
          changed={changedCount(draft, detail.elements)}
          onSelect={setSelectedId}
          onPatch={patchSelected}
          onAdd={addElement}
          onRemove={removeSelected}
          onSave={() => void save()}
          onRevert={revert}
          onApply={() => void applyRanges()}
          onAdopt={useControllerRanges}
          onDetail={setDetail}
          onSettings={() => goTab("settings")}
        />
      )}
      {tab === "settings" && notice ? (
        <p className="text-[13px] text-destructive">{notice}</p>
      ) : null}
    </div>
  );
}

function powerLine(light: LightDetailPayload["light"]): {
  label: string;
  className: string;
  dot: string;
} {
  if (light.reachability === "no-answer") {
    return { label: "Not answering", className: "text-destructive", dot: "#e07070" };
  }
  if (light.on === true) {
    const pct = brightnessPct(light.brightness);
    return {
      label: pct !== null ? `On · ${pct}%` : "On",
      className: "text-online",
      dot: "#7ee0d0",
    };
  }
  if (light.on === false) {
    return { label: "Off", className: "text-[#c9c3b8]", dot: "#3e3c37" };
  }
  return { label: "Power unknown", className: "text-[#c9c3b8]", dot: "#3e3c37" };
}

function TabButton({
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
        "pb-2.5 text-[14px]",
        active
          ? "font-medium shadow-[inset_0_-2px_0_#d4a574]"
          : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function tabFromMode(mode: LegacyMode | undefined): DetailTab {
  if (mode === "inspect" || mode === "strip" || mode === "safe") return "settings";
  return "elements";
}

function issuesForElement(
  issues: ReturnType<typeof validateDeclaredRanges>,
  elementId: string | undefined | null,
) {
  return issues.filter(
    (issue) => issue.elementId === elementId || issue.otherId === elementId,
  );
}

function rangeErrorLabel(
  code: "invert" | "overlap" | "over-ledCount" | undefined,
): "invert" | "overlap" | "past strip" | undefined {
  if (code === "over-ledCount") return "past strip";
  if (code) return code;
  return undefined;
}

function rangeDriftPresent(display: {
  declared: { differs: boolean }[];
  reported: { differs: boolean }[];
  regions: { kind: string }[];
}): boolean {
  return (
    display.declared.some((rail) => rail.differs) ||
    display.reported.some((rail) => rail.differs) ||
    display.regions.some((region) => region.kind === "drift")
  );
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
  return (
    a.filter((row) => {
      const match = b.find((item) => item.id === row.id);
      return (
        !match || match.label !== row.label || match.start !== row.start || match.stop !== row.stop
      );
    }).length || 1
  );
}
