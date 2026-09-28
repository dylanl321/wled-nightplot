import { randomUUID } from "node:crypto";
import {
  BLINK_COLOR,
  blinkRefuseReason,
  countRangeMatches,
  fixtureCaption,
  parseHexColor,
  previewRefuseReason,
  resolveLiveTarget,
  restoreSegmentsFromSnapshot,
  shouldRestoreOnEnd,
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
  previewWrite,
  previewWriteSpans,
  restoreWrite,
  restoreWriteFromSnapshot,
  type ReadLiveFn,
  type WriteStateFn,
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
};

export type LiveActionResult =
  | {
      ok: true;
      session: LiveSession | null;
      live: LiveRead | null;
      reported: { matched: number; total: number } | null;
      caption: string;
      restored?: boolean;
    }
  | { ok: false; status: 400 | 403 | 404 | 422; error: string; message: string };

export function createLiveEngine(deps: {
  write: WriteStateFn;
  readLive: ReadLiveFn;
  findLight: (id: string) => Light | undefined;
}): LiveEngine {
  const sessions = new Map<string, LiveSession>();

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
    const color =
      kind === "blink"
        ? BLINK_COLOR
        : parseHexColor(args.color ?? "") ?? "#4f7dff";
    const brightness = clampByte(args.brightness ?? args.live?.brightness ?? 180);
    const reason =
      kind === "blink"
        ? blinkRefuseReason({ reachable, busyKind: busyKind(args.light.id) })
        : previewRefuseReason({
            reachable,
            hasTarget: target.stop > target.start,
            busyKind: busyKind(args.light.id),
          });
    if (reason) {
      const error = reason.includes("hasn’t answered")
        ? "offline"
        : reason.includes("already running") || reason.includes("End the Preview")
          ? "busy"
          : "no-target";
      return { ok: false, status: 422, error, message: reason };
    }
    if (!args.live) {
      return {
        ok: false,
        status: 422,
        error: "offline",
        message: "This Light hasn’t answered. Refresh it first.",
      };
    }

    const existing = sessions.get(args.light.id);
    const restore = existing?.restore ?? restoreFrom(args.live);
    const dest: HostPort = { hostname: args.light.hostname, port: args.light.port };
    const sent = await deps.write(
      dest,
      painted
        ? previewWriteSpans(painted, brightness, args.light.ledCount)
        : previewWrite(
            target.start,
            target.stop,
            color,
            brightness,
            kind === "preview" && adHoc ? args.light.ledCount : undefined,
          ),
    );
    if (!sent) {
      return {
        ok: false,
        status: 422,
        error: "write-failed",
        message: "The controller did not take the temporary look. Nothing else changed.",
      };
    }
    const live = await deps.readLive(dest, args.light.ledCount);
    const source = live?.source ?? "controller";
    const session: LiveSession = {
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
      caption: fixtureCaption(source),
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
