/**
 * First-time WLED strip provision (CONFIG-40).
 *
 * Lifts the reviewed Nightplot cfg/bus path — `hw.led.ins[]` pin / len / type
 * plus firmware-scoped compatibility mappings (WS281x RGB and SK6812 RGBW).
 * Existing bus fields we do not own are cloned, not replaced with guessed
 * defaults.
 */

import type { RangeLengthStory } from "./range.ts";

export const PROVISION_LED_TYPES = ["ws281x", "sk6812-rgbw"] as const;
export type ProvisionLedType = (typeof PROVISION_LED_TYPES)[number];

export function isProvisionLedType(value: unknown): value is ProvisionLedType {
  return typeof value === "string" && (PROVISION_LED_TYPES as readonly string[]).includes(value);
}

export function provisionLedTypeLabel(ledType: ProvisionLedType): string {
  if (ledType === "sk6812-rgbw") return "SK6812 RGBW";
  return "WS281x";
}

export function draftLedTypeFromSettings(
  ledType: ProvisionLedType | "unknown",
): ProvisionLedType {
  return isProvisionLedType(ledType) ? ledType : "ws281x";
}

export type ProvisionFieldKey = "ledType" | "length" | "gpio";

export type WledStripProvision = {
  ledType: ProvisionLedType | "unknown";
  length: number | null;
  gpio: number | null;
  nativeType: number | null;
};

export type WledStripProvisionDraft = {
  ledType: ProvisionLedType;
  length: number;
  gpio: number;
};

export type NativeCompatibilityMapping = {
  readonly id: string;
  readonly firmwareVersions: readonly string[];
  readonly protocol: ProvisionLedType;
  readonly native: { readonly type: number; readonly order: number };
};

/**
 * Numeric WLED values are accepted only through this explicit, firmware-scoped
 * table (Nightplot `WLED_COMPATIBILITY_MAPPINGS` + WLED `wled00/const.h`).
 * Existing buses do not need a mapping when their native type/order encoding
 * is preserved byte-for-byte — but this slice still refuses writes on
 * firmware that is not in the table.
 *
 * SK6812 RGBW is `TYPE_SK6812_RGBW` (30). Order 0 is `COL_ORDER_GRB`,
 * documented as GRB(w) — GRBW on RGBW types. RGBWW (e.g. `TYPE_WS2805` 32)
 * is not mapped.
 *
 * Convert authors that mapping `order` (GRBW / 0 for SK6812) only when the
 * native type changes. Same-type length / GPIO writes preserve the live
 * `order`. Extra colour-order rows and an order picker are out of scope.
 */
export const WLED_COMPATIBILITY_MAPPINGS: readonly NativeCompatibilityMapping[] = [
  {
    id: "wled-0.14-ws281x-rgb-grb",
    firmwareVersions: ["0.14.0"],
    protocol: "ws281x",
    native: { type: 22, order: 0 },
  },
  {
    id: "wled-0.14-sk6812-rgbw-grbw",
    firmwareVersions: ["0.14.0"],
    protocol: "sk6812-rgbw",
    native: { type: 30, order: 0 },
  },
  {
    id: "wled-0.15-ws281x-rgb-grb-driver",
    firmwareVersions: ["0.15.0"],
    protocol: "ws281x",
    native: { type: 22, order: 0 },
  },
  {
    id: "wled-0.15-sk6812-rgbw-grbw-driver",
    firmwareVersions: ["0.15.0"],
    protocol: "sk6812-rgbw",
    native: { type: 30, order: 0 },
  },
  {
    id: "wled-0.15-ws281x-rgb-grb",
    firmwareVersions: ["0.15.3", "0.15.4"],
    protocol: "ws281x",
    native: { type: 22, order: 0 },
  },
  {
    id: "wled-0.15-sk6812-rgbw-grbw",
    firmwareVersions: ["0.15.3", "0.15.4"],
    protocol: "sk6812-rgbw",
    native: { type: 30, order: 0 },
  },
  {
    id: "wled-16-ws281x-rgb-grb",
    firmwareVersions: ["16.0.1"],
    protocol: "ws281x",
    native: { type: 22, order: 0 },
  },
  {
    id: "wled-16-sk6812-rgbw-grbw",
    firmwareVersions: ["16.0.1"],
    protocol: "sk6812-rgbw",
    native: { type: 30, order: 0 },
  },
];

/** TYPE_WS2812_RGB — first strip member. */
export const WLED_WS281X_NATIVE_TYPE = 22;

/** TYPE_SK6812_RGBW — WLED const.h (0.14.4 / 0.15.x / master). */
export const WLED_SK6812_RGBW_NATIVE_TYPE = 30;

/**
 * Out-of-scope WLED bus kinds (analog PWM, network, HUB75). Observing one
 * yields refuse — we do not convert those to WS281x.
 */
const UNSUPPORTED_NUMERIC_TYPES: ReadonlySet<number> = new Set([
  0, 41, 42, 43, 44, 45, 50, 51, 80, 81, 105,
]);

export const PROVISION_LENGTH_MIN = 1;
export const PROVISION_LENGTH_MAX = 2048;
export const PROVISION_GPIO_MIN = 0;
export const PROVISION_GPIO_MAX = 48;

export type ProvisionFingerprint = {
  firmware: string | null;
  source: "cfg";
  writable: boolean;
  mappingId: string | null;
  fields: ProvisionFieldKey[];
};

export type ProvisionRead = {
  settings: WledStripProvision;
  fingerprint: ProvisionFingerprint;
  caption: string;
  refuse: string | null;
  buses: number;
};

export type ProvisionWriteResult = {
  status: "matched" | "mismatch" | "refused" | "failed";
  matched: boolean;
  sent: WledStripProvisionDraft;
  read: WledStripProvision;
  snapshotLedCount: number | null;
  fingerprint: ProvisionFingerprint;
  message: string;
  caption: string;
  /** Present after a successful length-changing Apply. Absent on same length / mismatch. */
  ranges?: RangeLengthStory | null;
};

const emptySettings = (): WledStripProvision => ({
  ledType: "unknown",
  length: null,
  gpio: null,
  nativeType: null,
});

export function provisionCaption(source: "fixture" | "controller"): string {
  if (source === "fixture") {
    return "Software-green from the fixture. Not Hardware Done.";
  }
  return "Read from /json/cfg. Not Hardware Done.";
}

/** `WLED 0.15.4` / `0.15.4+foo` → `0.15.4` (Nightplot `baseFirmwareVersion`). */
export function baseFirmwareVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  const trimmed = version.trim().replace(/^wled\s+/i, "");
  return trimmed.split(/[+-]/, 1)[0] || null;
}

export function resolveProvisionMapping(
  firmware: string | null | undefined,
  ledType: ProvisionLedType,
): NativeCompatibilityMapping | null {
  const base = baseFirmwareVersion(firmware);
  if (!base) return null;
  return (
    WLED_COMPATIBILITY_MAPPINGS.find(
      (entry) => entry.protocol === ledType && entry.firmwareVersions.includes(base),
    ) ?? null
  );
}

export function resolveAnyProvisionMapping(
  firmware: string | null | undefined,
): NativeCompatibilityMapping | null {
  const base = baseFirmwareVersion(firmware);
  if (!base) return null;
  return (
    WLED_COMPATIBILITY_MAPPINGS.find((entry) => entry.firmwareVersions.includes(base)) ??
    null
  );
}

export function resolveWs281xMapping(
  firmware: string | null | undefined,
): NativeCompatibilityMapping | null {
  return resolveProvisionMapping(firmware, "ws281x");
}

export function isSupportedProvisionFirmware(firmware: string | null | undefined): boolean {
  return resolveAnyProvisionMapping(firmware) !== null;
}

export function ledTypeFromNative(type: number | null): ProvisionLedType | "unknown" {
  if (type === WLED_WS281X_NATIVE_TYPE) return "ws281x";
  if (type === WLED_SK6812_RGBW_NATIVE_TYPE) return "sk6812-rgbw";
  return "unknown";
}

export function rawWledBuses(config: unknown): Record<string, unknown>[] {
  if (!isRecord(config)) return [];
  const hw = isRecord(config.hw) ? config.hw : null;
  const led = hw && isRecord(hw.led) ? hw.led : null;
  const ins = led?.ins;
  if (!Array.isArray(ins)) return [];
  return ins.map((entry) => cloneRecord(isRecord(entry) ? entry : {}));
}

export function busHasInsList(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const hw = isRecord(config.hw) ? config.hw : null;
  const led = hw && isRecord(hw.led) ? hw.led : null;
  return Array.isArray(led?.ins);
}

export function busPins(bus: Record<string, unknown>): number[] | null {
  return pins(bus.pin ?? bus.pins ?? bus.gpio);
}

export function busLength(bus: Record<string, unknown>): number | null {
  return integer(bus.len ?? bus.length);
}

export function busNativeType(bus: Record<string, unknown>): number | null {
  return integer(bus.type);
}

export function parseWledProvision(
  body: unknown,
  firmware: string | null = null,
  source: "fixture" | "controller" = "controller",
): ProvisionRead {
  const caption = provisionCaption(source);
  const mapping = resolveAnyProvisionMapping(firmware);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return refusedRead(
      firmware,
      "No /json/cfg on this controller. Strip provision was not written.",
      caption,
      mapping,
    );
  }
  if (!busHasInsList(body)) {
    return refusedRead(
      firmware,
      "This firmware’s config isn’t a shape we write. Nothing was sent.",
      caption,
      mapping,
    );
  }
  const buses = rawWledBuses(body);
  if (buses.length === 0) {
    return refusedRead(
      firmware,
      "No LED bus on this firmware. Nothing was written.",
      caption,
      mapping,
    );
  }
  if (buses.length > 1) {
    return refusedRead(
      firmware,
      "This Light has more than one bus. First-time provision is one strip. Nothing was written.",
      caption,
      mapping,
      buses.length,
    );
  }

  const bus = buses[0]!;
  const gpioList = busPins(bus);
  if (gpioList && gpioList.length > 1) {
    return refusedRead(
      firmware,
      "This bus uses more than one pin. Strip provision is a single GPIO. Nothing was written.",
      caption,
      mapping,
      1,
    );
  }

  const nativeType = busNativeType(bus);
  if (nativeType !== null && UNSUPPORTED_NUMERIC_TYPES.has(nativeType)) {
    return refusedRead(
      firmware,
      "This bus type is not a strip we provision. Nothing was written.",
      caption,
      mapping,
      1,
    );
  }

  const settings: WledStripProvision = {
    ledType: ledTypeFromNative(nativeType),
    length: busLength(bus),
    gpio: gpioList?.[0] ?? null,
    nativeType,
  };

  const typeMapping =
    settings.ledType === "unknown"
      ? null
      : resolveProvisionMapping(firmware, settings.ledType);
  const firmwareOk = mapping !== null;
  const writable = firmwareOk;
  const refuse = firmwareOk
    ? null
    : "This firmware isn’t in the strip compatibility table. Nothing was written.";

  return {
    settings,
    fingerprint: {
      firmware,
      source: "cfg",
      writable,
      mappingId: typeMapping?.id ?? mapping?.id ?? null,
      fields: writable ? ["ledType", "length", "gpio"] : [],
    },
    caption,
    refuse,
    buses: 1,
  };
}

export function provisionRefuseReason(input: {
  reachable: boolean;
  read: ProvisionRead | null;
  busyKind?: "preview" | "blink" | null;
  draft?: WledStripProvisionDraft | null;
}): string | null {
  if (!input.reachable) {
    return "This Light hasn’t answered. Refresh or re-address it first.";
  }
  if (input.busyKind === "preview") {
    return "End the Preview first. Preview is not Apply.";
  }
  if (input.busyKind === "blink") {
    return "Wait for Blink to finish.";
  }
  if (!input.read) {
    return "No /json/cfg on this controller. Strip provision was not written.";
  }
  if (input.read.refuse) return input.read.refuse;
  if (!input.read.fingerprint.writable) {
    return "This firmware isn’t in the strip compatibility table. Nothing was written.";
  }
  if (input.draft) {
    const invalid = validateProvisionDraft(input.draft);
    if (invalid) return invalid;
  }
  return null;
}

export function validateProvisionDraft(draft: WledStripProvisionDraft): string | null {
  if (!isProvisionLedType(draft.ledType)) {
    return "LED type must be a mapped strip driver. Unknown types are not written.";
  }
  if (
    !Number.isFinite(draft.length) ||
    !Number.isInteger(draft.length) ||
    draft.length < PROVISION_LENGTH_MIN ||
    draft.length > PROVISION_LENGTH_MAX
  ) {
    return `Length is ${PROVISION_LENGTH_MIN}–${PROVISION_LENGTH_MAX} nodes.`;
  }
  if (
    !Number.isFinite(draft.gpio) ||
    !Number.isInteger(draft.gpio) ||
    draft.gpio < PROVISION_GPIO_MIN ||
    draft.gpio > PROVISION_GPIO_MAX
  ) {
    return `GPIO is ${PROVISION_GPIO_MIN}–${PROVISION_GPIO_MAX}.`;
  }
  return null;
}

/**
 * Strip Apply `/json/cfg` patch. Length and GPIO always land on a cloned bus.
 * Native `type` + `order` come from the firmware mapping only when the live
 * native type differs (convert, including unknown → mapped). Convert to
 * SK6812 RGBW therefore authors GRBW (`order: 0`). Same-type writes leave
 * the existing `order` untouched.
 */
export function buildProvisionWrite(
  draft: WledStripProvisionDraft,
  rawCfg: unknown,
  fingerprint: ProvisionFingerprint,
):
  | { ok: true; body: Record<string, unknown>; sent: WledStripProvisionDraft }
  | { ok: false; message: string } {
  const parsed = parseWledProvision(rawCfg, fingerprint.firmware, "controller");
  const reason = provisionRefuseReason({
    reachable: true,
    read: {
      ...parsed,
      fingerprint,
      refuse: fingerprint.writable ? parsed.refuse : parsed.refuse ?? "This firmware isn’t in the strip compatibility table. Nothing was written.",
    },
    draft,
  });
  if (reason) return { ok: false, message: reason };

  const mapping = resolveProvisionMapping(fingerprint.firmware, draft.ledType);
  if (!mapping) {
    return {
      ok: false,
      message: "This firmware isn’t in the strip compatibility table. Nothing was written.",
    };
  }

  const buses = rawWledBuses(rawCfg);
  const current = buses[0] ? cloneRecord(buses[0]) : null;
  if (!current) {
    return { ok: false, message: "No LED bus on this firmware. Nothing was written." };
  }

  const next = cloneRecord(current);
  next.pin = [draft.gpio];
  next.len = draft.length;
  const nativeType = busNativeType(current);
  // Convert only. Same-type length / GPIO must not rewrite colour order.
  if (nativeType !== mapping.native.type) {
    next.type = mapping.native.type;
    next.order = mapping.native.order;
  }

  const sent: WledStripProvisionDraft = {
    ledType: draft.ledType,
    length: draft.length,
    gpio: draft.gpio,
  };
  return {
    ok: true,
    body: { hw: { led: { ins: [next] } } },
    sent,
  };
}

export function provisionFieldsMatch(
  sent: WledStripProvisionDraft,
  read: WledStripProvision,
): boolean {
  return (
    read.ledType === sent.ledType &&
    read.length === sent.length &&
    read.gpio === sent.gpio
  );
}

export function provisionSnapshotMatch(
  sent: WledStripProvisionDraft,
  snapshotLedCount: number | null,
): boolean {
  return snapshotLedCount === sent.length;
}

export function provisionMismatchNote(
  sent: WledStripProvisionDraft,
  read: WledStripProvision,
  snapshotLedCount: number | null,
): string {
  if (!provisionFieldsMatch(sent, read)) {
    return "Wrote, but /json/cfg did not match. Not treating as success.";
  }
  if (!provisionSnapshotMatch(sent, snapshotLedCount)) {
    return `cfg reports the bus we sent, but the snapshot still has ${
      snapshotLedCount ?? "unknown"
    } LEDs. Not treating as success.`;
  }
  return "Controller reports the strip we sent.";
}

function refusedRead(
  firmware: string | null,
  refuse: string,
  caption: string,
  mapping: NativeCompatibilityMapping | null,
  buses = 0,
): ProvisionRead {
  return {
    settings: emptySettings(),
    fingerprint: {
      firmware,
      source: "cfg",
      writable: false,
      mappingId: mapping?.id ?? null,
      fields: [],
    },
    caption,
    refuse,
    buses,
  };
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function pins(value: unknown): number[] | null {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const parsed = values.map(integer);
  return parsed.length > 0 && parsed.every((entry): entry is number => entry !== null)
    ? [...new Set(parsed)]
    : null;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
