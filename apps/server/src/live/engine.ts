import { randomUUID } from "node:crypto";
import {
  BLINK_COLOR,
  blinkRefuseReason,
  countRangeMatches,
  fixtureCaption,
  parseHexColor,
  previewHopCaption,
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
} from "@nightplot/shared";
import {
  firstLocateWrite,
  isLocateOverlayWrite,
  locateHopWrite,
  stabilizeLocateOverlayIds,
  previewWrite,
  previewWriteLeavingOverlay,
  previewWriteSpans,
  restoreWrite,
  restoreWriteFromSnapshot,
  writeBodiesEqual,
  type ReadLiveFn,
  type WriteStateFn,
  type WledStateWrite,
} from "../wled/live.ts";

export type LiveEngine = {
  get(lightId: string): LiveSession | undefined;
  list(): LiveSession[];
  startPreview: (args: StartArgs) => Promise<LiveActionResult>;
  startBlink: (args: StartArgs) => Promise<LiveActionResult>;
  end: (lightId: string, kind: LiveEndKind) => Promise<LiveActionResult>;
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
    }
  | { ok: false; status: 400 | 403 | 404 | 422; error: string; message: string };

export function createLiveEngine(deps: {
  write: WriteStateFn;
  readLive: ReadLiveFn;
  findLight: (id: string) => Light | undefined;
}): LiveEngine {
  const sessions = new Map<string, LiveSession>();
  const lastWrites = new Map<string, WledStateWrite>();

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
    const reachable = args.light.reachability === "online" && args.live !== null;
    const painted = kind === "preview" ? normalizeSpans(args.spans, args.light.ledCount) : null;
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
            label: "Elements",
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
    const authored: WledStateWrite = painted
      ? previewWriteSpans(painted, brightness, args.light.ledCount)
      : previewWrite(
          target.start,
          target.stop,
          color,
          brightness,
          kind === "preview" && adHoc ? args.light.ledCount : undefined,
        );
    const picture = stabilizeLocateOverlayIds(authored, last);
    const sameWrite = last != null && writeBodiesEqual(last, picture);
    let wrote = false;
    if (!sameWrite) {
      const locateHop = painted != null || adHoc != null;
      const body = locateHop
        ? isLocateOverlayWrite(last)
          ? locateHopWrite(picture, last)
          : firstLocateWrite(
              picture,
              // First restore snapshot — not a hop reread of the Preview paint.
              snapshotSegmentCount({ segments: restore.segments }),
            )
        : previewWriteLeavingOverlay(picture, last);
      const sent = await deps.write(dest, body);
      if (!sent) {
        return {
          ok: false,
          status: 422,
          error: "write-failed",
          message: "The controller did not take the temporary look. Nothing else changed.",
        };
      }
      // Remapped overlay ids — sequential 0…n would shift later Elements
      // on the next gap-cursor hop (`locateHopWrite` keys by id).
      lastWrites.set(args.light.id, picture);
      wrote = true;
    }
    const locateHop = painted != null || adHoc != null;
    const shouldReread = shouldRereadPreview({
      updating,
      locateHop,
      reread: args.reread,
    });
    const live = shouldReread ? await deps.readLive(dest, args.light.ledCount) : null;
    const source = live?.source ?? (updating ? openPreview.source : "controller");
    const session: LiveSession = updating
      ? {
          ...openPreview,
          target,
          color,
          brightness,
          source,
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
      caption: live ? fixtureCaption(source) : previewHopCaption(source),
      updated: updating,
      wrote,
      reread: shouldReread,
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
    if (shouldRestoreOnEnd(kind)) {
      restored = await deps.write(dest, restoreWrite(session.restore));
    }
    const live = await deps.readLive(dest, light.ledCount);
    sessions.delete(lightId);
    lastWrites.delete(lightId);
    return {
      ok: true,
      session: null,
      live,
      reported: null,
      caption: fixtureCaption(live?.source ?? session.source),
      restored,
    };
  }

  return {
    get: (id) => sessions.get(id),
    list: () => [...sessions.values()],
    startPreview: (args) => start("preview", args),
    startBlink: (args) => start("blink", args),
    end,
    seen(lightId, seenByYou) {
      const session = sessions.get(lightId);
      if (!session) return null;
      const next = { ...session, seenByYou };
      sessions.set(lightId, next);
      return next;
    },
    read,
    async identifyHost(target, ledCount, snapshot) {
      const restore = restoreWriteFromSnapshot(snapshot);
      const sent = await deps.write(target, previewWrite(0, ledCount, BLINK_COLOR, 220));
      if (!sent) {
        return {
          ok: false,
          status: 422,
          error: "write-failed",
          message: "Blink did not reach that address.",
        };
      }
      const pulsed = await deps.readLive(target, ledCount);
      const restored = await deps.write(target, restore);
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
  return clipped.sort((a, b) => a.start - b.start || a.stop - b.stop).slice(0, 64);
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
