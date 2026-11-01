"use client";

import {
  HIDDEN_REASONS,
  SHARED_POST_RULES,
  WIREFRAME_DEFAULT_SIDES,
  WIREFRAME_GROUPS,
  WIREFRAME_LOCK_NUDGES,
  WIREFRAME_SIDES_MAX,
  WIREFRAME_SIDES_MIN,
  buildNetLayout,
  compileWireframe,
  defaultWireframeSpec,
  hiddenSpanFromRange,
  polylineToEdgeIds,
  predictedIndexForRole,
  reattachWireframe,
  widenMarkerIndices,
  type ApplyResult,
  type HiddenReason,
  type LightDetail,
  type LookOverride,
  type Prop,
  type SharedPostRule,
  type WireframeHiddenSpan,
  type WireframeLock,
  type WireframePathPoint,
  type WireframeSpec,
} from "@nightplot/shared";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  holdSpans,
  locatePayloadKey,
  useLiveLocate,
  type LocateFrame,
} from "@/components/elements-editor/use-live-locate";
import { ELEMENT_HUES, LOCATE_LIT } from "@/components/elements-editor/ops";
import { Button } from "@/components/ui/button";
import { LedLoader } from "@/components/ui/led-loader";
import { fetchJson, patchJson, postJson, putJson } from "@/lib/api";
import type { LooksPayload } from "@/components/looks/use-looks";
import { WireframeNet } from "@/components/props/wireframe-net";

const TAP = "min-h-11 min-w-11 touch-manipulation";
const TAP_WIDE = "min-h-14 w-full touch-manipulation rounded-2xl text-[16px] font-semibold";
const TAP_PRIMARY = "min-h-16 w-full touch-manipulation rounded-2xl text-[18px] font-semibold";
const FIELD = "min-h-11 w-full rounded-xl border border-input bg-[#07080a] px-3 text-[16px] text-foreground outline-none focus:border-primary";

type Phase = "draw" | "lock" | "review" | "colour";

type PropPayload = LightDetail & {
  apply?: ApplyResult;
  prop?: Prop;
  message?: string;
};

export function WireframeFlow({
  lightId,
  lightName,
  ledCount,
  rgbw,
  unreachable,
  existing,
  initialLabel,
  initialPhase = "draw",
  onClose,
  onApplied,
}: {
  lightId: string;
  lightName: string;
  ledCount: number;
  rgbw: boolean;
  unreachable: boolean;
  existing?: Prop | null;
  initialLabel?: string;
  initialPhase?: "draw" | "lock";
  onClose: () => void;
  onApplied: (payload: PropPayload) => void;
}) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [label, setLabel] = useState(existing?.label ?? initialLabel ?? "Wireframe");
  const [spec, setSpec] = useState<WireframeSpec>(
    () => existing?.wireframe ?? defaultWireframeSpec(),
  );
  const [points, setPoints] = useState<WireframePathPoint[]>(existing?.wireframe?.path?.points ?? []);
  const [role, setRole] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => {
    const first = compileWireframe(existing?.wireframe ?? defaultWireframeSpec(), ledCount);
    return predictedIndexForRole(first, first.roles[0]?.id ?? "") ?? 0;
  });
  const [widen, setWiden] = useState(true);
  const [hiddenReason, setHiddenReason] = useState<HiddenReason>("wire");
  const [hiddenCount, setHiddenCount] = useState(2);
  const [busy, setBusy] = useState<"save" | "apply" | "looks" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apply, setApply] = useState<ApplyResult | null>(null);
  const [savedProp, setSavedProp] = useState<Prop | null>(existing ?? null);
  const [library, setLibrary] = useState<LooksPayload | null>(null);
  const [lookId, setLookId] = useState<string | null>(null);
  const [faceColor, setFaceColor] = useState("#ff0000");
  const [faceFills, setFaceFills] = useState<Record<number, string>>({});
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  const compiled = useMemo(() => compileWireframe(spec, ledCount), [spec, ledCount]);
  const layout = useMemo(() => buildNetLayout(spec.sides), [spec.sides]);
  const selectedRole = role ?? compiled.roles[0]?.id ?? null;

  const frame = lockFrame({
    enabled: phase === "lock" && !unreachable && busy === null,
    lightName,
    ledCount,
    cursor,
    widen,
    rgbw,
    existing: savedProp ? compiled.segments.map((segment, index) => ({
      id: `${savedProp.id}-preview-${index}`,
      lightId,
      label: segment.label,
      start: segment.start,
      stop: segment.stop,
    })) : [],
  });
  const locate = useLiveLocate({
    enabled: phase === "lock" && !unreachable && busy === null,
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

  function jumpToRole(nextRole: string | null) {
    if (!nextRole) return;
    const index = predictedIndexForRole(compiled, nextRole);
    if (index != null) setCursor(index);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (busy === null) void leave();
    } else if (phase === "lock" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      if ((event.target as HTMLElement).tagName === "BUTTON") return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  function step(delta: number) {
    if (ledCount < 1) return;
    setCursor((current) => Math.max(0, Math.min(ledCount - 1, current + delta)));
  }

  function addPoint(point: WireframePathPoint) {
    setPoints((current) => {
      const last = current[current.length - 1];
      if (last && last.edgeId === point.edgeId && Math.hypot(last.x - point.x, last.y - point.y) < 4) {
        return current;
      }
      return [...current, point];
    });
  }

  function finishDraw(nextPoints = points) {
    const edgeIds = polylineToEdgeIds(layout, nextPoints);
    const nextPath = nextPoints.length > 0
      ? { points: nextPoints, edgeIds }
      : null;
    const attached = reattachWireframe(spec, nextPath);
    setSpec(attached.spec);
    setStaleNote(staleCopy(attached.staleLocks, attached.staleHidden));
  }

  function setSides(sides: number) {
    const next = Math.max(WIREFRAME_SIDES_MIN, Math.min(WIREFRAME_SIDES_MAX, sides));
    setSpec((current) => defaultWireframeSpec({
      sides: next,
      pitchMm: current.pitchMm,
      sharedPostRule: current.sharedPostRule,
    }));
    setPoints([]);
    setStaleNote(null);
    setFaceFills({});
  }

  function lockRole() {
    if (!selectedRole) return;
    setSpec((current) => ({
      ...current,
      locks: [
        ...current.locks.filter((lock) => lock.role !== selectedRole),
        { role: selectedRole, physicalIndex: cursor },
      ],
    }));
    setNotice(null);
  }

  function dropLock(target: string) {
    setSpec((current) => ({
      ...current,
      locks: current.locks.filter((lock) => lock.role !== target),
    }));
  }

  function markHidden() {
    if (!selectedRole) return;
    const span: WireframeHiddenSpan = hiddenCount > 0
      ? { afterRole: selectedRole, count: hiddenCount, reason: hiddenReason }
      : hiddenSpanFromRange(cursor, cursor + 1, spec.locks, compiled.roles, hiddenReason) ?? {
          afterRole: selectedRole,
          count: 1,
          reason: hiddenReason,
        };
    setSpec((current) => ({
      ...current,
      hidden: [...current.hidden.filter((row) => row.afterRole !== span.afterRole), span],
    }));
  }

  async function leave() {
    setBusy(null);
    await locate.stop();
    onClose();
  }

  async function submit(applyWrite: boolean) {
    setNotice(null);
    setBusy(applyWrite ? "apply" : "save");
    const restored = await locate.stop();
    if (applyWrite && !restored && phase === "lock") {
      setBusy(null);
      setNotice("Preview could not be confirmed ended and restored. Apply was not sent.");
      return;
    }
    const body = { kind: "wireframe", label, wireframe: spec, apply: applyWrite };
    const res = savedProp
      ? await patchJson<PropPayload>(`/api/lights/${lightId}/props/${savedProp.id}`, body)
      : await postJson<PropPayload>(`/api/lights/${lightId}/props`, body);
    const payload = res.data as PropPayload;
    setBusy(null);
    if (payload.apply) setApply(payload.apply);
    if (!res.ok) {
      setNotice(payload.message ?? payload.apply?.message ?? "Wireframe was not saved.");
      return;
    }
    if (payload.prop) setSavedProp(payload.prop);
    onApplied(payload);
    window.dispatchEvent(new Event("nightplot:lights-changed"));
    const nextLibrary = await fetchLooks();
    if (nextLibrary?.looks?.[0]) {
      setLibrary(nextLibrary);
      setLookId(nextLibrary.looks[0].id);
      setPhase("colour");
      return;
    }
    if (applyWrite && payload.apply?.matched) onClose();
    if (!applyWrite) onClose();
  }

  async function fetchLooks(): Promise<LooksPayload | null> {
    try {
      return await fetchJson<LooksPayload>("/api/looks");
    } catch {
      return null;
    }
  }

  async function colourFace(faceIndex: number) {
    const prop = savedProp;
    const currentLook = library?.looks.find((row) => row.id === lookId);
    if (!prop || !currentLook || !library) return;
    setBusy("looks");
    setNotice(null);
    const override: LookOverride = {
      propId: prop.id,
      wireframeGroup: `face.${faceIndex}`,
      sharedPostRule: spec.sharedPostRule,
      style: { ...currentLook.style, color: faceColor, fx: 0 },
    };
    const nextLooks = library.looks.map((row) => (
      row.id === currentLook.id
        ? {
            ...row,
            overrides: [
              ...row.overrides.filter((entry) => !(entry.propId === prop.id && entry.wireframeGroup === override.wireframeGroup)),
              override,
            ],
          }
        : row
    ));
    const res = await putJson<LooksPayload>("/api/looks", {
      looks: nextLooks,
      playlists: library.playlists,
      schedule: library.schedule,
    });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Look override was not saved.");
      return;
    }
    setLibrary(res.data);
    setFaceFills((current) => ({ ...current, [faceIndex]: faceColor }));
  }

  function goLock() {
    finishDraw();
    jumpToRole(selectedRole);
    setPhase("lock");
  }

  function goDefault() {
    setPoints([]);
    finishDraw([]);
    jumpToRole(selectedRole);
    setPhase("lock");
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Wireframe on ${lightName}`}
      onKeyDown={keyDown}
      className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden overscroll-x-none bg-background text-foreground"
      style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2">
        <div className="min-w-0">
          <p className="text-[12px] text-primary">Wireframe · {phaseLabel(phase)}</p>
          <h2 className="truncate text-[18px] font-semibold">{lightName}</h2>
        </div>
        <Button
          ref={close}
          type="button"
          variant="outline"
          className={`${TAP} px-4`}
          onClick={() => void leave()}
          disabled={busy !== null}
        >
          Cancel
        </Button>
      </header>

      {phase === "draw" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 space-y-2 px-4 pb-2">
            <p className="text-[13px] text-muted-foreground">
              One finger draws in pixel order. Two fingers pinch and pan. 10 cm pitch is a guess; the Find-length census is the count.
            </p>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-[13px] text-muted-foreground">
                Name
                <input aria-label="Prop name" value={label} onChange={(event) => setLabel(event.target.value)} className={FIELD} />
              </label>
              <div className="flex flex-col gap-1 text-[13px] text-muted-foreground">
                Sides
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Fewer sides" className={`${TAP} rounded-xl border border-input bg-secondary text-[20px]`}
                    onClick={() => setSides(spec.sides - 1)} disabled={spec.sides <= WIREFRAME_SIDES_MIN}>−</button>
                  <input aria-label="Wireframe sides" type="number" min={WIREFRAME_SIDES_MIN} max={WIREFRAME_SIDES_MAX}
                    value={spec.sides} onChange={(event) => setSides(Number(event.target.value))}
                    className={`${FIELD} w-14 text-center`} />
                  <button type="button" aria-label="More sides" className={`${TAP} rounded-xl border border-input bg-secondary text-[20px]`}
                    onClick={() => setSides(spec.sides + 1)} disabled={spec.sides >= WIREFRAME_SIDES_MAX}>+</button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4">
            <WireframeNet
              layout={layout}
              pathEdgeIds={compiled.pathEdgeIds}
              points={points}
              mode="draw"
              onDrawPoint={addPoint}
              onDrawEnd={() => finishDraw()}
            />
          </div>
          <p className="shrink-0 px-4 py-2 text-[12px] text-muted-foreground">
            Census {ledCount} LEDs · {compiled.pathEdgeIds.length || spec.sides * 5} edges · {compiled.roles.length} lock roles.
            {staleNote ? ` ${staleNote}` : ""}
          </p>
          <ThumbDock>
            <Button type="button" className={TAP_PRIMARY} onClick={goLock}>Lock corners on the strip</Button>
            <Button type="button" variant="outline" className={TAP_WIDE} onClick={goDefault}>Use default wiring</Button>
          </ThumbDock>
        </div>
      ) : null}

      {phase === "lock" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-x-none px-4">
            <p className="text-[13px] text-muted-foreground">
              {unreachable
                ? "This Light hasn’t answered. Preview cannot start."
                : locate.stopping
                  ? "Ending Preview…"
                  : locate.error
                    ? locate.error.message
                    : previewReady
                      ? "Preview on · temporary. Light the predicted corner, then nudge and lock."
                      : "Starting Preview…"}
            </p>
            <div className="mt-3 rounded-2xl border border-border bg-card px-4 py-4 text-center">
              <p className="text-[12px] text-muted-foreground">Cursor</p>
              <p className="font-mono text-[clamp(2.4rem,12vw,3.4rem)] font-semibold leading-none tabular-nums">{cursor}</p>
              <p className="mt-1 font-mono text-[13px] text-muted-foreground">of {Math.max(0, ledCount - 1)}</p>
              <p className="mt-2 text-[15px] font-medium">{selectedRole ? roleLabel(selectedRole) : "Pick a corner"}</p>
            </div>
            <label className="mt-3 flex flex-col gap-1 text-[13px] text-muted-foreground">
              Corner
              <select aria-label="Lock role" className={FIELD} value={selectedRole ?? ""} onChange={(event) => {
                setRole(event.target.value);
                jumpToRole(event.target.value);
              }}>
                {compiled.roles.map((row) => (
                  <option key={row.id} value={row.id}>
                    {roleLabel(row.id)}{spec.locks.some((lock) => lock.role === row.id) ? " · locked" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${TAP} mt-3 flex items-center gap-3 text-[15px]`}>
              <input type="checkbox" checked={widen} onChange={(event) => setWiden(event.target.checked)} className="h-5 w-5" />
              Widen probe to 3 LEDs
            </label>
            {compiled.staleLocks.length > 0 || compiled.staleHidden.length > 0 ? (
              <p className="mt-3 text-[13px] text-amber-200">{staleCopy(compiled.staleLocks, compiled.staleHidden)}</p>
            ) : null}
            {spec.locks.length > 0 ? (
              <ul className="mt-3 rounded-xl border border-border bg-[#12141a] px-3 py-2 text-[13px]">
                {spec.locks.map((lock) => (
                  <li key={lock.role} className="flex items-center justify-between gap-2 py-1">
                    <span className="min-w-0 truncate">{roleLabel(lock.role)} · LED {lock.physicalIndex}</span>
                    <Button type="button" variant="ghost" className={`${TAP} px-3`} onClick={() => dropLock(lock.role)}>Drop</Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-[13px] text-muted-foreground">
                Hidden after
                <input aria-label="Hidden count" type="number" min={1} max={ledCount} value={hiddenCount}
                  onChange={(event) => setHiddenCount(Math.max(1, Number(event.target.value) || 1))}
                  className={FIELD} />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[13px] text-muted-foreground">
                Reason
                <select aria-label="Hidden reason" className={FIELD}
                  value={hiddenReason} onChange={(event) => setHiddenReason(event.target.value as HiddenReason)}>
                  {HIDDEN_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <Button type="button" variant="outline" className={`${TAP} px-3`} onClick={markHidden}>Mark</Button>
            </div>
          </div>
          <ThumbDock ariaLabel="Thumb nudge">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-label="Previous LED" disabled={cursor <= 0} onClick={() => step(-1)}
                className="min-h-14 touch-manipulation rounded-2xl border border-input bg-secondary text-[28px] disabled:opacity-40">←</button>
              <button type="button" aria-label="Next LED" disabled={cursor >= ledCount - 1} onClick={() => step(1)}
                className="min-h-14 touch-manipulation rounded-2xl border border-input bg-secondary text-[28px] disabled:opacity-40">→</button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {WIREFRAME_LOCK_NUDGES.flatMap((amount) => ([
                <Button key={`m${amount}`} type="button" variant="outline" className={TAP} onClick={() => step(-amount)} disabled={cursor <= 0}>−{amount}</Button>,
                <Button key={`p${amount}`} type="button" variant="outline" className={TAP} onClick={() => step(amount)} disabled={cursor >= ledCount - 1}>+{amount}</Button>,
              ]))}
            </div>
            <Button type="button" className={TAP_PRIMARY} onClick={lockRole} disabled={!selectedRole}>
              Lock this corner
            </Button>
            <Button type="button" className={TAP_WIDE} onClick={() => setPhase("review")}>Review this wireframe</Button>
            <Button type="button" variant="outline" className={`${TAP} w-full`} onClick={() => setPhase("draw")}>Back to the net</Button>
          </ThumbDock>
        </div>
      ) : null}

      {phase === "review" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-x-none px-4">
            <p className="text-[13px] text-muted-foreground">
              {label} · {spec.sides}-sided box+X. Apply writes the ledmap and one Segment per face, then reads both back.
            </p>
            <label className="mt-3 flex flex-col gap-1 text-[13px] text-muted-foreground">
              Shared posts
              <select aria-label="Shared post rule" className={FIELD}
                value={spec.sharedPostRule}
                onChange={(event) => setSpec((current) => ({ ...current, sharedPostRule: event.target.value as SharedPostRule }))}>
                {SHARED_POST_RULES.map((rule) => <option key={rule} value={rule}>{postRuleLabel(rule)}</option>)}
              </select>
            </label>
            <ul className="mt-3 rounded-xl border border-border bg-[#12141a] px-4 py-3 text-[14px]">
              {compiled.segments.map((segment) => (
                <li key={`${segment.label}-${segment.start}`} className="flex justify-between gap-3 py-1">
                  <span className="min-w-0 truncate">{label} · {segment.label}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{segment.start}–{segment.stop}</span>
                </li>
              ))}
            </ul>
            {compiled.staleLocks.length > 0 ? (
              <p className="mt-3 text-[13px] text-amber-200">{staleCopy(compiled.staleLocks, compiled.staleHidden)}</p>
            ) : null}
            {apply ? (
              <p className={apply.matched ? "mt-3 text-[13px] text-online" : "mt-3 text-[13px] text-destructive"}>
                {apply.message} {apply.caption}
              </p>
            ) : null}
            {notice ? <p role="alert" className="mt-3 text-[13px] text-destructive">{notice}</p> : null}
            <p className="mt-3 text-[12px] text-muted-foreground">
              Preview is temporary. Apply persists. Fixture or sim green is not Hardware Done.
            </p>
          </div>
          <ThumbDock>
            <Button type="button" className={TAP_PRIMARY} onClick={() => void submit(true)} disabled={busy !== null || unreachable || !label.trim()}>
              {busy === "apply" ? "Applying…" : "Apply this Prop"}
            </Button>
            {busy === "apply" ? <LedLoader label="Applying" /> : null}
            <Button type="button" variant="outline" className={TAP_WIDE} onClick={() => void submit(false)} disabled={busy !== null || !label.trim()}>
              {busy === "save" ? "Saving…" : "Save without Apply"}
            </Button>
            <Button type="button" variant="outline" className={`${TAP} w-full`} onClick={() => { setApply(null); setNotice(null); setPhase("lock"); }}>
              Back to locks
            </Button>
          </ThumbDock>
        </div>
      ) : null}

      {phase === "colour" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 space-y-2 px-4 pb-2">
            <p className="text-[13px] text-muted-foreground">
              Tap a face to colour it on the selected Look. Shared posts follow {postRuleLabel(spec.sharedPostRule)}. This writes a Look override, not a second ledmap.
            </p>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-[13px] text-muted-foreground">
                Look
                <select aria-label="Look for face colour" className={FIELD}
                  value={lookId ?? ""} onChange={(event) => setLookId(event.target.value)}>
                  {(library?.looks ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col items-center gap-1 text-[13px] text-muted-foreground">
                Colour
                <input aria-label="Face colour" type="color" value={faceColor} onChange={(event) => setFaceColor(event.target.value)}
                  className="h-11 w-11 rounded-md border border-border bg-background" />
              </label>
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4">
            <WireframeNet
              layout={layout}
              pathEdgeIds={compiled.pathEdgeIds}
              points={points}
              mode="colour"
              faceFills={faceFills}
              onFaceTap={(index) => void colourFace(index)}
            />
          </div>
          <div className="grid shrink-0 grid-cols-4 gap-2 px-4 py-2">
            {layout.faces.map((face) => (
              <button
                key={face.id}
                type="button"
                aria-label={`Colour face ${face.index + 1}`}
                className={`${TAP} touch-manipulation rounded-xl border border-border bg-[#12141a] text-[13px]`}
                style={faceFills[face.index] ? { background: faceFills[face.index] } : undefined}
                onClick={() => void colourFace(face.index)}
              >
                {face.index + 1}
              </button>
            ))}
          </div>
          {notice ? <p role="alert" className="px-4 text-[13px] text-destructive">{notice}</p> : null}
          <p className="shrink-0 px-4 pb-1 text-[12px] text-muted-foreground">
            Groups: {WIREFRAME_GROUPS.join(", ")}. Sides default {WIREFRAME_DEFAULT_SIDES}.
          </p>
          <ThumbDock>
            <Button type="button" className={TAP_PRIMARY} onClick={onClose} disabled={busy !== null}>Done</Button>
          </ThumbDock>
        </div>
      ) : null}
    </div>
  );
}

function ThumbDock({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? "Thumb actions"}
      data-thumb-dock="true"
      className="shrink-0 space-y-2 border-t border-border bg-background px-4 pt-3"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  );
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "draw":
      return "draw the line";
    case "lock":
      return "lock corners";
    case "review":
      return "review";
    case "colour":
      return "colour faces";
    default: {
      const _never: never = phase;
      return _never;
    }
  }
}

function roleLabel(id: string): string {
  const match = /^(top|bottom|post|diag\.(?:down|up))\.(\d+)\.(start|end)$/.exec(id);
  if (!match) return id;
  const kind = match[1]!;
  const index = Number(match[2]) + 1;
  const end = match[3] === "start" ? "start" : "end";
  switch (kind) {
    case "top":
      return `Top ${index} ${end}`;
    case "bottom":
      return `Bottom ${index} ${end}`;
    case "post":
      return `Post ${index} ${end}`;
    case "diag.down":
      return `Down diagonal ${index} ${end}`;
    case "diag.up":
      return `Up diagonal ${index} ${end}`;
    default: {
      const _never: never = kind as never;
      return _never;
    }
  }
}

function postRuleLabel(rule: SharedPostRule): string {
  switch (rule) {
    case "half":
      return "Split each post between the two faces";
    case "left":
      return "Give the post to the left face";
    case "right":
      return "Give the post to the right face";
    case "own":
      return "Posts are their own Segment";
    default: {
      const _never: never = rule;
      return _never;
    }
  }
}

function staleCopy(locks: readonly WireframeLock[], hidden: readonly WireframeHiddenSpan[]): string | null {
  if (locks.length === 0 && hidden.length === 0) return null;
  const names = [
    ...locks.map((lock) => roleLabel(lock.role)),
    ...hidden.map((span) => roleLabel(span.afterRole)),
  ];
  return `Stale after the re-draw: ${names.join(", ")}. Those roles are no longer on this path. Relock or drop them.`;
}

function lockFrame(input: {
  enabled: boolean;
  lightName: string;
  ledCount: number;
  cursor: number;
  widen: boolean;
  rgbw: boolean;
  existing: { id: string; lightId: string; label: string; start: number; stop: number }[];
}): LocateFrame | null {
  if (!input.enabled || input.ledCount < 1) return null;
  const hues = Object.fromEntries(input.existing.map((element, index) => [element.id, ELEMENT_HUES[index % ELEMENT_HUES.length]]));
  const spans = holdSpans({
    ledCount: input.ledCount,
    hoverIndex: input.cursor,
    dragging: false,
    elements: input.existing,
    hues,
    rgbw: input.rgbw,
    backgroundPercent: 60,
  });
  const extra = widenMarkerIndices(input.cursor, input.ledCount, input.widen)
    .filter((index) => index !== input.cursor)
    .map((index) => ({ start: index, stop: index + 1, color: LOCATE_LIT }));
  const all = [...spans, ...extra];
  if (all.length === 0) {
    return {
      start: input.cursor,
      stop: input.cursor + 1,
      color: LOCATE_LIT,
      caption: `Lighting LED ${input.cursor} on ${input.lightName}`,
    };
  }
  return {
    start: Math.min(...all.map((span) => span.start)),
    stop: Math.max(...all.map((span) => span.stop)),
    color: all[0]?.color ?? LOCATE_LIT,
    spans: all,
    pixels: true,
    caption: `LED ${input.cursor} is the bright one on ${input.lightName}. Widen lights two neighbours.`,
  };
}
