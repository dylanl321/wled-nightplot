import { randomUUID } from "node:crypto";
import {
  BLINK_COLOR,
  BLINK_PULSE_MS,
  blinkRefuseReason,
  countRangeMatches,
  fixtureCaption,
  hexToRgb,
  parseHexColor,
  previewLocateCaption,
  previewRefuseReason,
  resolveLiveTarget,
  restoreSegmentsFromSnapshot,
  shouldRestoreOnEnd,
  snapshotSegmentCount,
  type Element,
  type HostPort,
  type Light,
  type LiveEndKind,
  type LiveRead,
  type LiveRestoreSnapshot,
  type LiveSession,
  type LiveSessionKind,
  type SeenByYou,
  type WledSnapshot,
  type WledNativeRestore,
} from "@nightplot/shared";
import {
  firstLocateWrite,
  isLocateOverlayWrite,
  locateHopWrite,
  stabilizeLocateOverlayIds,
  previewWrite,
  previewWriteLeavingOverlay,
  previewWriteSpans,
  restoreWriteLeavingOverlay,
  writeBodiesEqual,
  pixelPreviewWrite,
  openPixelPreview,
  restorePixelPreview,
  type ReadLiveFn,
  type WriteStateFn,
  type WledStateWrite,
} from "../wled/live.ts";
import type { ProbeFn } from "../wled/client.ts";

export type LiveEngine = {
  revision(lightId: string): number;
  block(lightId: string): () => void;
  settle(lightId: string): Promise<void>;
  get(lightId: string): LiveSession | undefined;
  list(): LiveSession[];
  startPreview: (args: StartArgs) => Promise<LiveActionResult>;
  startBlink: (args: StartArgs) => Promise<LiveActionResult>;
  end: (lightId: string, kind: LiveEndKind) => Promise<LiveActionResult>;
  recoverFrozen: (light: Light, probe: ProbeFn) => Promise<FrozenRecoveryResult>;
  seen: (lightId: string, seenByYou: Exclude<SeenByYou, null>) => LiveSession | null;
  read: (light: Light) => Promise<LiveRead | null>;
  identifyHost: (target: HostPort, ledCount: number, snapshot: WledSnapshot) => Promise<LiveActionResult>;
};

export type StartArgs = {
  light: Light;
  live: WledSnapshot | null;
  elements: Element[];
  elementId?: string | null;
  /** Ad-hoc locate range. When set, Preview paints this span and blacks the rest. */
  range?: { start: number; stop: number } | null;
  /** Several coloured spans. When set, Preview paints these and blacks the rest. */
  spans?: { start: number; stop: number; color: string }[] | null;
  color?: string;
  brightness?: number;
  pixels?: boolean;
  revision?: number;
  /**
   * Session update only. `true` still reads `/json/live`. `false` skips.
   * Omitted: locate hops (range / spans) skip; a named Element / whole-strip
   * Preview still reads. A skipped read is not strip proof. Preview is not Apply.
   */
  reread?: boolean;
};

export type LiveActionResult =
  | {
      ok: true;
      session: LiveSession | null;
      live: LiveRead | null;
      reported: { matched: number; total: number } | null;
      caption: string;
      restored?: boolean;
      /** True when a Preview session already existed and paint was updated. */
      updated?: boolean;
      /** False when the hop body matched the last write — no controller POST. */
      wrote?: boolean;
      /** False when this hop skipped `/json/live`. Not a claimed report. */
      reread?: boolean;
      /**
       * First-locate leftover clears when restore segment count is unknown.
       * Soft overlay write may still have gone. Not clear-as-success.
       */
      leftoverClears?: "unknown";
    }
  | { ok: false; status: 400 | 403 | 404 | 422; error: string; message: string; sent?: false };

type FrozenRecoveryResult =
  | { ok: true; snapshot: WledSnapshot; wrote: boolean; message: string }
  | Extract<LiveActionResult, { ok: false }>;

export function createLiveEngine(deps: {
  write: WriteStateFn;
  readLive: ReadLiveFn;
  findLight: (id: string) => Light | undefined;
  wait?: (ms: number) => Promise<void>;
}): LiveEngine {
  const sessions = new Map<string, LiveSession>();
  const lastWrites = new Map<string, WledStateWrite>();
  const nativeRestores = new Map<string, WledNativeRestore>();
  const pixelSessions = new Set<string>();
  const revisions = new Map<string, number>();
  const blocked = new Map<string, number>();
  const flights = new Map<string, Promise<unknown>>();
  function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const run = (flights.get(id) ?? Promise.resolve()).catch(() => undefined).then(work);
    flights.set(id, run);
    void run.finally(() => { if (flights.get(id) === run) flights.delete(id); }).catch(() => undefined);
    return run;
  }

  function busyKind(lightId: string): LiveSessionKind | null {
    return sessions.get(lightId)?.kind ?? null;
  }

  async function read(light: Light): Promise<LiveRead | null> {
    return deps.readLive({ hostname: light.hostname, port: light.port }, light.ledCount);
  }

  async function start(
    kind: LiveSessionKind,
    args: StartArgs,
  ): Promise<LiveActionResult> {
    if (blocked.has(args.light.id) || (args.revision !== undefined && args.revision !== (revisions.get(args.light.id) ?? 0))) {
      return { ok: false, status: 422, error: "cancelled", message: "Preview was cancelled by All Off. Nothing was sent." };
    }
    const reachable = args.light.reachability === "online" && args.live !== null;
    if (args.pixels && args.spans?.some((span) => span.start < 0 || span.stop > args.light.ledCount)) return {
      ok: false, status: 422, error: "range-outside-strip", message: "A Preview range is outside this strip. Nothing was sent.",
    };
    const painted = kind === "preview" ? normalizeSpans(args.spans, args.light.ledCount, args.pixels ? 512 : 64) : null;
    const adHoc = painted ? null : adHocRange(args.range, args.light.ledCount);
    const target = adHoc
      ? {
          elementId: null,
          label: `${adHoc.start}–${adHoc.stop}`,
          start: adHoc.start,
          stop: adHoc.stop,
        }
      : painted
        ? {
            elementId: null,
            label: "Segments",
            start: painted[0]?.start ?? 0,
            stop: painted[painted.length - 1]?.stop ?? args.light.ledCount,
          }
        : resolveLiveTarget(args.elements, args.light.ledCount, args.elementId);
    const existing = sessions.get(args.light.id);
    const openPreview = existing?.kind === "preview" ? existing : null;
    const updating = kind === "preview" && openPreview != null;
    const color =
      kind === "blink"
        ? BLINK_COLOR
        : parseHexColor(args.color ?? "") ?? "#4f7dff";
    const brightness = clampByte(
      args.brightness ?? (updating ? openPreview.brightness : args.live?.brightness) ?? 180,
    );
    const reason =
      kind === "blink"
        ? blinkRefuseReason({ reachable, busyKind: busyKind(args.light.id) })
        : previewRefuseReason({
            reachable,
            hasTarget: target.stop > target.start,
            busyKind: updating ? null : busyKind(args.light.id),
          });
    if (reason) {
      const error = reason.includes("hasn’t answered")
        ? "offline"
        : reason.includes("already running") || reason.includes("End the Preview")
          ? "busy"
          : "no-target";
      return { ok: false, status: 422, error, message: reason };
    }
    if (!updating && !args.live) {
      return {
        ok: false,
        status: 422,
        error: "offline",
        message: "This Light hasn’t answered. Refresh it first.",
      };
    }

    const restore = updating ? openPreview.restore : (existing?.restore ?? restoreFrom(args.live!));
    const dest: HostPort = { hostname: args.light.hostname, port: args.light.port };
    const last = lastWrites.get(args.light.id);
    const usePixels = kind === "preview" && (args.pixels === true || pixelSessions.has(args.light.id));
    const nativeRestore = updating ? nativeRestores.get(args.light.id) : args.live?.nativeRestore;
    if (usePixels && (!nativeRestore || !/^WLED (?:0\.1[45]\.|16\.)/.test(args.light.firmware ?? ""))) {
      const unavailable = !nativeRestore ? args.live?.nativeRestoreUnavailable : undefined;
      if (unavailable === "frozen") return {
        ok: false, status: 422, error: "pixel-preview-frozen", sent: false,
        message: "The controller is holding frozen LEDs. Nightplot has no snapshot of their original colours to restore. Use Recover Preview to deliberately clear them, or restore a saved look in WLED. Nothing was sent.",
      };
      if (unavailable === "playlist") return {
        ok: false, status: 422, error: "pixel-preview-playlist", sent: false,
        message: "The controller is running a playlist that Nightplot cannot restore. Stop the playlist in WLED, then Refresh and retry Preview. Nothing was sent.",
      };
      return {
        ok: false, status: 422, error: "pixel-preview-unavailable", sent: false,
        message: updating
          ? "This Preview has no complete snapshot for Segments stay lit. End Preview, Refresh, then try again. Nothing was sent."
          : "Segments stay lit needs a complete controller state on supported WLED firmware. Refresh and retry, or use Cursor only. Nothing was sent.",
      };
    }
    const authored: WledStateWrite = usePixels
      ? pixelPreviewWrite(painted ?? [{ start: target.start, stop: target.stop, color }], brightness, args.light.ledCount)
      : painted
      ? previewWriteSpans(painted, brightness, args.light.ledCount)
      : previewWrite(
          target.start,
          target.stop,
          color,
          brightness,
          kind === "preview" && adHoc ? args.light.ledCount : undefined,
        );
    const picture = usePixels ? authored : stabilizeLocateOverlayIds(authored, last);
    const sameWrite = last != null && writeBodiesEqual(last, picture);
    const locateHop = painted != null || adHoc != null;
    const leftoverUnknown =
      locateHop && snapshotSegmentCount({ segments: restore.segments }) === null;
    let wrote = false;
    if (!sameWrite) {
      const body = usePixels
        ? last?.seg?.some((segment) => segment.i) ? picture : openPixelPreview(picture, nativeRestore!, last)
        : locateHop
        ? isLocateOverlayWrite(last)
          ? locateHopWrite(picture, last)
          : firstLocateWrite(
              picture,
              // First restore snapshot — not a hop reread of the Preview paint.
              snapshotSegmentCount({ segments: restore.segments }),
            ).body
        : previewWriteLeavingOverlay(picture, last);
      // Retain the original before sending: a lost response is not proof no
      // pixels changed. End Preview must still have a snapshot to restore.
      if (usePixels) {
        nativeRestores.set(args.light.id, nativeRestore!);
        pixelSessions.add(args.light.id);
        if (!updating) sessions.set(args.light.id, {
          id: randomUUID(), kind, lightId: args.light.id, target, color, brightness,
          startedAt: new Date().toISOString(), restore, source: "controller", seenByYou: null,
        });
      }
      const sent = await deps.write(dest, body);
      if (!sent) {
        return {
          ok: false,
          status: 422,
          error: "write-failed",
          message: usePixels
            ? "The temporary look was not confirmed. Preview is paused; its original snapshot is kept for End Preview."
            : "The controller did not take the temporary look. Nothing else changed.",
        };
      }
      // Remapped overlay ids — sequential 0…n would shift later Elements
      // on the next gap-cursor hop (`locateHopWrite` keys by id).
      lastWrites.set(args.light.id, picture);
      if (!updating && args.live?.nativeRestore) nativeRestores.set(args.light.id, args.live.nativeRestore);
      if (usePixels) pixelSessions.add(args.light.id);
      wrote = true;
    }
    const shouldReread = shouldRereadPreview({
      updating,
      locateHop,
      reread: args.reread,
    });
    const live = shouldReread ? await deps.readLive(dest, args.light.ledCount) : null;
    const source = live?.source ?? (updating ? openPreview.source : "controller");
    const leftoverClears = leftoverUnknown ? ("unknown" as const) : undefined;
    const session: LiveSession = updating
      ? {
          ...openPreview,
          target,
          color,
          brightness,
          source,
          leftoverClears,
        }
      : {
          id: randomUUID(),
          kind,
          lightId: args.light.id,
          target,
          color,
          brightness,
          startedAt: new Date().toISOString(),
          restore,
          source,
          seenByYou: null,
          leftoverClears,
        };
    sessions.set(args.light.id, session);
    const reported = live
      ? countRangeMatches(live.leds, target.start, target.stop, color)
      : null;
    return {
      ok: true,
      session,
      live,
      reported,
      caption: previewLocateCaption({
        source,
        live,
        leftoverUnknown,
      }),
      updated: updating,
      wrote,
      reread: shouldReread,
      leftoverClears: leftoverUnknown ? "unknown" : undefined,
    };
  }

  async function end(lightId: string, kind: LiveEndKind): Promise<LiveActionResult> {
    const session = sessions.get(lightId);
    if (!session) {
      return { ok: false, status: 404, error: "not_found", message: "Nothing live on this Light." };
    }
    const light = deps.findLight(lightId);
    if (!light) {
      sessions.delete(lightId);
      return { ok: false, status: 404, error: "not_found", message: "That Light is not on Lights." };
    }
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    let restored = false;
    if (shouldRestoreOnEnd(kind) && !blocked.has(lightId)) {
      restored = await deps.write(
        dest,
        pixelSessions.has(lightId)
          ? restorePixelPreview(nativeRestores.get(lightId)!, light.ledCount)
          : restoreWriteLeavingOverlay(session.restore, lastWrites.get(lightId)),
      );
      if (!restored && pixelSessions.has(lightId)) return {
        ok: false, status: 422, error: "restore-failed",
        message: "The previous look was not restored. The Preview snapshot is kept for another End Preview attempt.",
      };
    }
    const live = await deps.readLive(dest, light.ledCount);
    sessions.delete(lightId);
    lastWrites.delete(lightId);
    nativeRestores.delete(lightId);
    pixelSessions.delete(lightId);
    return {
      ok: true,
      session: null,
      live,
      reported: null,
      caption: fixtureCaption(live?.source ?? session.source),
      restored,
    };
  }

  function recoverFrozen(light: Light, probe: ProbeFn): Promise<FrozenRecoveryResult> {
    const revision = revisions.get(light.id) ?? 0;
    return serial(light.id, async () => {
      const refuse = (error: string, message: string): FrozenRecoveryResult => ({
        ok: false, status: 422, error, message: `${message} Nothing was sent.`, sent: false,
      });
      const cancelled = () => blocked.has(light.id) || revision !== (revisions.get(light.id) ?? 0);
      if (cancelled()) return refuse("cancelled", "Recovery was cancelled by All Off.");
      if (sessions.has(light.id)) return refuse("busy", "A Preview or Blink still owns this Light. End it to restore its snapshot.");
      const target = { hostname: light.hostname, port: light.port };
      const before = await probe(target).catch(() => null);
      if (!before || before.kind !== "found") return refuse("offline", "The controller did not return a fresh state. Refresh and try again.");
      const snapshot = before.snapshot;
      if (!light.mac || snapshot.mac !== light.mac || snapshot.ledCount !== light.ledCount) {
        return refuse("controller-changed", "The controller identity or strip length changed. Refresh before recovery.");
      }
      if (!/^WLED (?:0\.1[45]\.|16\.)/.test(snapshot.firmware)) return refuse("unsupported", "This firmware is not supported for frozen-pixel recovery.");
      if (snapshot.nativeRestore) return {
        ok: true, snapshot, wrote: false,
        message: "The controller is no longer frozen. Nothing was sent. You can start Preview again.",
      };
      const frozen = snapshot.frozenSegments;
      if (!frozen?.length) return refuse("state-unknown", "Recovery needs complete controller state with known frozen LEDs and no active playlist.");
      // All Off may arrive while the probe is in flight. Never write after its cancellation.
      if (cancelled()) return refuse("cancelled", "Recovery was cancelled by All Off.");
      const written = await deps.write(target, {
        seg: frozen.map((segment) => ({ ...segment, frz: false })),
      }).catch(() => false);
      const after = await probe(target).catch(() => null);
      const reread = after?.kind === "found" ? after.snapshot : null;
      if (!written || !reread || reread.mac !== light.mac || reread.ledCount !== light.ledCount || !reread.nativeRestore) return {
        ok: false, status: 422, error: "recovery-unconfirmed",
        message: "Clearing frozen LEDs was not confirmed. Refresh to check the controller before retrying. The previous per-LED colours cannot be restored.",
      };
      return {
        ok: true, snapshot: reread, wrote: true,
        message: "The controller reports frozen LEDs cleared. Their previous per-LED colours were discarded. Saved Segments are unchanged. Preview is off.",
      };
    });
  }

  return {
    revision: (id) => revisions.get(id) ?? 0,
    block(id) {
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
      blocked.set(id, (blocked.get(id) ?? 0) + 1);
      return () => {
        const remaining = (blocked.get(id) ?? 1) - 1;
        if (remaining > 0) blocked.set(id, remaining); else blocked.delete(id);
      };
    },
    settle: (id) => serial(id, async () => undefined),
    get: (id) => sessions.get(id),
    list: () => [...sessions.values()],
    startPreview: (args) => serial(args.light.id, () => start("preview", args)),
    startBlink: (args) => serial(args.light.id, () => start("blink", args)),
    end: (id, kind) => serial(id, () => end(id, kind)),
    recoverFrozen,
    seen(lightId, seenByYou) {
      const session = sessions.get(lightId);
      if (!session) return null;
      const next = { ...session, seenByYou };
      sessions.set(lightId, next);
      return next;
    },
    read,
  async identifyHost(target, ledCount, snapshot) {
      const native = snapshot.nativeRestore;
      if (!native || native.seg.some((segment) => segment.stop > ledCount)) {
        return {
          ok: false, status: 422, error: "restore-unavailable", sent: false,
          message: "Blink needs a complete controller state to restore this Light. Refresh and try again. Nothing was sent.",
        };
      }
      // WLED may retain other active segments and a segment's own off switch.
      // Clear those for the pulse; restore their full native state afterward.
      const pulse: WledStateWrite = {
        on: true, bri: 220, tt: 0,
        seg: [
          ...native.seg.filter((segment) => segment.id !== 0).map((segment) => ({ id: segment.id, start: 0, stop: 0 })),
          { id: 0, start: 0, stop: ledCount, on: true, bri: 255, fx: 0, col: [hexToRgb(BLINK_COLOR)!] },
        ],
      };
      const sent = await deps.write(target, pulse);
      if (!sent) {
        return {
          ok: false,
          status: 422,
          error: "write-failed",
          message: "Blink did not reach that address.",
        };
      }
      const pulsed = await deps.readLive(target, ledCount);
      await (deps.wait?.(BLINK_PULSE_MS) ?? new Promise<void>((resolve) => setTimeout(resolve, BLINK_PULSE_MS)));
      const restored = await deps.write(target, {
        on: native.on, bri: native.bri, tt: 0,
        seg: [
          ...(!native.seg.some((segment) => segment.id === 0) ? [{ id: 0, start: 0, stop: 0 }] : []),
          ...native.seg.map((segment) => ({ ...segment })),
        ],
      });
      if (!restored) return {
        ok: false, status: 422, error: "restore-failed",
        message: "Blink ran, but the previous look was not restored. Check this Light in WLED.",
      };
      const live = await deps.readLive(target, ledCount);
      return {
        ok: true,
        session: null,
        live: pulsed,
        reported: pulsed ? countRangeMatches(pulsed.leds, 0, ledCount, BLINK_COLOR) : null,
        caption: fixtureCaption(pulsed?.source ?? "controller"),
        restored,
      };
    },
  };
}

function restoreFrom(snapshot: WledSnapshot): LiveRestoreSnapshot {
  return {
    on: snapshot.on,
    brightness: snapshot.brightness,
    color: snapshot.segmentColor,
    segments: restoreSegmentsFromSnapshot(snapshot.segments, snapshot.segmentColor),
  };
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function normalizeSpans(
  spans: { start: number; stop: number; color: string }[] | null | undefined,
  ledCount: number,
  limit = 64,
): { start: number; stop: number; color: string }[] | null {
  if (!spans || spans.length === 0) return null;
  const clipped = spans.flatMap((span) => {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.stop)) return [];
    const color = parseHexColor(span.color);
    if (!color) return [];
    const start = Math.max(0, Math.min(ledCount, span.start));
    const stop = Math.max(0, Math.min(ledCount, span.stop));
    return stop > start ? [{ start, stop, color }] : [];
  });
  if (clipped.length === 0) return null;
  return clipped.sort((a, b) => a.start - b.start || a.stop - b.stop).slice(0, limit);
}

function adHocRange(
  range: { start: number; stop: number } | null | undefined,
  ledCount: number,
): { start: number; stop: number } | null {
  if (!range) return null;
  if (!Number.isInteger(range.start) || !Number.isInteger(range.stop)) return null;
  const start = Math.max(0, Math.min(ledCount, range.start));
  const stop = Math.max(0, Math.min(ledCount, range.stop));
  if (stop <= start) return null;
  return { start, stop };
}

/** Start always reads. Locate hops skip unless `reread: true`. Classic Preview still reads. */
export function shouldRereadPreview(input: {
  updating: boolean;
  locateHop: boolean;
  reread?: boolean;
}): boolean {
  if (!input.updating) return true;
  if (input.reread === true) return true;
  if (input.reread === false) return false;
  return !input.locateHop;
}

/**
 * Rails / beads for a Preview hop that must not re-probe.
 * Built from the session restore — never a new snapshot of the Preview paint.
 */
export function previewDisplaySnapshot(
  light: Light,
  restore: LiveRestoreSnapshot,
): WledSnapshot {
  return {
    name: light.name,
    firmware: light.firmware ?? "",
    mac: light.mac,
    ledCount: light.ledCount,
    rgbw: light.rgbw,
    on: restore.on,
    brightness: restore.brightness,
    segmentColor: restore.color,
    segments: restore.segments
      ? restore.segments.map((seg) => ({ start: seg.start, stop: seg.stop }))
      : null,
  };
}
