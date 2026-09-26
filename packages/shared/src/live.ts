import type { BeadColor } from "./bead.ts";

export const PREVIEW_SWATCHES = [
  "#ffc978",
  "#ff4a3d",
  "#3dff7a",
  "#4f7dff",
  "#f4f1ea",
] as const;

export const BLINK_PULSE_MS = 3000;
export const BLINK_COLOR = "#f4f1ea";

export type LiveSessionKind = "preview" | "blink";
export type LiveSource = "fixture" | "controller";
export type SeenByYou = "yes" | "no" | null;
export type LiveEndKind = "complete" | "error" | "cancel-without-restore";

export type LiveTarget = {
  elementId: string | null;
  label: string;
  start: number;
  stop: number;
};

export type LiveRestoreSnapshot = {
  on: boolean | null;
  brightness: number | null;
  color: string | null;
  segments: { start: number; stop: number; color: string | null }[];
};

export type LiveSession = {
  id: string;
  kind: LiveSessionKind;
  lightId: string;
  target: LiveTarget;
  color: string;
  brightness: number;
  startedAt: string;
  restore: LiveRestoreSnapshot;
  source: LiveSource;
  seenByYou: SeenByYou;
};

export type LiveRead = {
  leds: (string | null)[];
  source: LiveSource;
};

export type ProofRung = {
  key: "sent" | "reported" | "person";
  label: string;
  done: boolean;
  detail?: string;
};

export function parseHexColor(raw: string): string | null {
  const hex = raw.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  return `#${hex}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const parsed = parseHexColor(hex);
  if (!parsed) return null;
  return [
    Number.parseInt(parsed.slice(1, 3), 16),
    Number.parseInt(parsed.slice(3, 5), 16),
    Number.parseInt(parsed.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function colorsMatch(a: string | null, b: string | null, slop = 8): boolean {
  if (!a || !b) return false;
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) return false;
  return left.every((n, i) => Math.abs(n - right[i]!) <= slop);
}

export function previewRefuseReason(input: {
  reachable: boolean;
  hasTarget: boolean;
  busyKind?: LiveSessionKind | null;
}): string | null {
  if (!input.reachable) {
    return "This Light hasn’t answered. Refresh it first.";
  }
  if (!input.hasTarget) {
    return "Pick an Element, or Preview the whole strip.";
  }
  if (input.busyKind === "blink") {
    return "A Blink is already running.";
  }
  return null;
}

export function blinkRefuseReason(input: {
  reachable: boolean;
  busyKind?: LiveSessionKind | null;
}): string | null {
  if (!input.reachable) {
    return "This Light hasn’t answered. Refresh it first.";
  }
  if (input.busyKind === "preview") {
    return "End the Preview first.";
  }
  if (input.busyKind === "blink") {
    return "A Blink is already running.";
  }
  return null;
}

/** Preview and Blink restore. All Off (R5) is the cancel-without-restore path. */
export function shouldRestoreOnEnd(end: LiveEndKind): boolean {
  return end !== "cancel-without-restore";
}

export function resolveLiveTarget(
  elements: { id: string; label: string; start: number; stop: number }[],
  ledCount: number,
  elementId?: string | null,
): LiveTarget {
  if (elementId) {
    const found = elements.find((element) => element.id === elementId);
    if (found) {
      return {
        elementId: found.id,
        label: found.label,
        start: found.start,
        stop: found.stop,
      };
    }
  }
  if (elements.length === 1 && !elementId) {
    const only = elements[0]!;
    return {
      elementId: only.id,
      label: only.label,
      start: only.start,
      stop: only.stop,
    };
  }
  return {
    elementId: null,
    label: "Whole strip",
    start: 0,
    stop: ledCount,
  };
}

export function parseLiveLeds(body: unknown, ledCount: number): LiveRead | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const raw = root.leds;
  if (!Array.isArray(raw) || ledCount < 1) return null;
  const source: LiveSource = root.nightplot === "fixture" ? "fixture" : "controller";

  if (raw.every((item) => typeof item === "string")) {
    return {
      source,
      leds: padLeds(
        raw.map((item) => parseHexColor(item)),
        ledCount,
      ),
    };
  }
  if (raw.every((item) => Array.isArray(item))) {
    return {
      source,
      leds: padLeds(
        raw.map((item) => {
          const rgb = item as unknown[];
          if (rgb.length < 3) return null;
          return rgbToHex(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]));
        }),
        ledCount,
      ),
    };
  }
  if (raw.every((item) => typeof item === "number") && raw.length >= ledCount * 3) {
    const leds: (string | null)[] = [];
    for (let i = 0; i < ledCount; i += 1) {
      leds.push(rgbToHex(Number(raw[i * 3]), Number(raw[i * 3 + 1]), Number(raw[i * 3 + 2])));
    }
    return { source, leds };
  }
  return null;
}

export function countRangeMatches(
  leds: (string | null)[],
  start: number,
  stop: number,
  color: string,
): { matched: number; total: number } {
  let matched = 0;
  let total = 0;
  for (let i = start; i < stop && i < leds.length; i += 1) {
    total += 1;
    if (colorsMatch(leds[i] ?? null, color)) matched += 1;
  }
  return { matched, total };
}

export function beadsFromLive(
  leds: (string | null)[] | null,
  ledCount: number,
  reachable: boolean,
): BeadColor[] {
  if (!reachable) return Array.from({ length: ledCount }, () => "unknown");
  if (!leds) return Array.from({ length: ledCount }, () => "unknown");
  return padLeds(leds, ledCount).map((led) => led ?? null);
}

export function fixtureCaption(source: LiveSource): string {
  if (source === "fixture") {
    return "Software-green from the fixture. Not Hardware Done.";
  }
  return "The controller reported this. A person still has to confirm — not Hardware Done.";
}

export function proofLadder(input: {
  sentAt: string | null;
  reported: { matched: number; total: number } | null;
  seenByYou: SeenByYou;
  label: string;
}): ProofRung[] {
  return [
    {
      key: "sent",
      label: "Sent to controller",
      done: Boolean(input.sentAt),
      detail: input.sentAt ?? undefined,
    },
    {
      key: "reported",
      label: input.reported
        ? `Controller reports ${input.reported.matched} / ${input.reported.total} in ${input.label}`
        : "Controller reports",
      done: Boolean(input.reported && input.reported.total > 0 && input.reported.matched === input.reported.total),
      detail: input.reported && input.reported.matched !== input.reported.total
        ? "readback does not match yet"
        : input.reported
          ? "others untouched"
          : undefined,
    },
    {
      key: "person",
      label:
        input.seenByYou === "yes"
          ? "You said you see it"
          : input.seenByYou === "no"
            ? "You said no / not sure"
            : `Is ${input.label} that colour right now?`,
      done: input.seenByYou === "yes",
    },
  ];
}

function padLeds(leds: (string | null)[], ledCount: number): (string | null)[] {
  const out = leds.slice(0, ledCount);
  while (out.length < ledCount) out.push(null);
  return out;
}
