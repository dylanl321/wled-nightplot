/**
 * First-time WLED strip provision (CONFIG-40).
 *
 * Lifts the reviewed Nightplot cfg/bus path — `hw.led.ins[]` pin / len / type
 * plus firmware-scoped compatibility mappings (WS281x RGB and SK6812 RGBW).
 * Existing bus fields we do not own are cloned, not replaced with guessed
 * defaults.
 */

import { softwareHonestyCaption, type LiveSource } from "./live.ts";
import type { RangeLengthStory } from "./range.ts";

export const PROVISION_LED_TYPES = ["ws281x", "sk6812-rgbw", "fw1906"] as const;
export type ProvisionLedType = (typeof PROVISION_LED_TYPES)[number];

export function isProvisionLedType(value: unknown): value is ProvisionLedType {
  return typeof value === "string" && (PROVISION_LED_TYPES as readonly string[]).includes(value);
}

export function provisionLedTypeLabel(ledType: ProvisionLedType): string {
  if (ledType === "sk6812-rgbw") return "SK6812 RGBW";
  if (ledType === "fw1906") return "FW1906 RGB+CCT";
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
  /** WLED `hw.led.ins[].order` (`COL_ORDER_*`). Null when cfg omitted it. */
  nativeOrder: number | null;
  /**
   * Decoded live order (GRB / GRBW / …). Unknown encodings stay
   * `WLED order N` — never a silent blank.
   */
  colorOrder: string | null;
};

export type WledStripProvisionDraft = {
  ledType: ProvisionLedType;
  length: number;
  gpio: number;
};

/** One `hw.led.ins[]` row. Analog / network / multi-pin buses stay listed with a refuse. */
export type ProvisionBusRead = {
  index: number;
  start: number | null;
  settings: WledStripProvision;
  refuse: string | null;
  writable: boolean;
};

export type WledStripProvisionOutputDraft = WledStripProvisionDraft & {
  index: number;
  colorOrder?: string | null;
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
 * documented as GRB(w) — GRBW on RGBW types. FW1906 is `TYPE_FW1906` (28),
 * RGB + CW + WW; WLED 0.14 does not define it. Other RGBCCT ICs (e.g.
 * `TYPE_WS2805` 32) are recognised by name but not mapped.
 *
 * Convert authors that mapping `order` (GRBW / 0 for SK6812) only when the
 * native type changes. Same-type length / GPIO writes preserve the live
 * `order`. Extra colour-order rows and an order picker are out of scope.
 */
export const WLED_COMPATIBILITY_MAPPINGS: readonly NativeCompatibilityMapping[] = [
  {
    id: "wled-0.14-ws281x-rgb-grb",
    firmwareVersions: ["0.14.0", "0.14.1", "0.14.2", "0.14.3", "0.14.4"],
    protocol: "ws281x",
    native: { type: 22, order: 0 },
  },
  {
    id: "wled-0.14-sk6812-rgbw-grbw",
    firmwareVersions: ["0.14.0", "0.14.1", "0.14.2", "0.14.3", "0.14.4"],
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
    id: "wled-0.15-fw1906-rgbcct-grb-driver",
    firmwareVersions: ["0.15.0"],
    protocol: "fw1906",
    native: { type: 28, order: 0 },
  },
  {
    id: "wled-0.15-ws281x-rgb-grb",
    firmwareVersions: ["0.15.1", "0.15.2", "0.15.3", "0.15.4", "0.15.5"],
    protocol: "ws281x",
    native: { type: 22, order: 0 },
  },
  {
    id: "wled-0.15-sk6812-rgbw-grbw",
    firmwareVersions: ["0.15.1", "0.15.2", "0.15.3", "0.15.4", "0.15.5"],
    protocol: "sk6812-rgbw",
    native: { type: 30, order: 0 },
  },
  {
    id: "wled-0.15-fw1906-rgbcct-grb",
    firmwareVersions: ["0.15.1", "0.15.2", "0.15.3", "0.15.4", "0.15.5"],
    protocol: "fw1906",
    native: { type: 28, order: 0 },
  },
  {
    id: "wled-16-ws281x-rgb-grb",
    firmwareVersions: ["16.0.0", "16.0.1"],
    protocol: "ws281x",
    native: { type: 22, order: 0 },
  },
  {
    id: "wled-16-sk6812-rgbw-grbw",
    firmwareVersions: ["16.0.0", "16.0.1"],
    protocol: "sk6812-rgbw",
    native: { type: 30, order: 0 },
  },
  {
    id: "wled-16-fw1906-rgbcct-grb",
    firmwareVersions: ["16.0.0", "16.0.1"],
    protocol: "fw1906",
    native: { type: 28, order: 0 },
  },
];

/** TYPE_WS2812_RGB — first strip member. */
export const WLED_WS281X_NATIVE_TYPE = 22;

/** TYPE_SK6812_RGBW — WLED const.h (0.14.4 / 0.15.x / master). */
export const WLED_SK6812_RGBW_NATIVE_TYPE = 30;

/** TYPE_FW1906 — WLED const.h (0.15.x / 16 / main). Not in 0.14. */
export const WLED_FW1906_NATIVE_TYPE = 28;

/**
 * Names for WLED `TYPE_*` values (`wled00/const.h`, 0.15 / 16) so an unmapped
 * bus is identified honestly instead of a bare number. Naming a type is not
 * support for writing it.
 */
const WLED_NATIVE_TYPE_NAMES: Readonly<Record<number, string>> = {
  18: "WS2812 white (1 ch)",
  19: "WS2812 white (3 ch)",
  20: "WS2812 CCT",
  21: "WS2812 WWA",
  22: "WS281x RGB",
  23: "GS8608",
  24: "WS2811 400 kHz",
  25: "TM1829",
  26: "UCS8903",
  27: "APA106",
  28: "FW1906 RGB+CCT",
  29: "UCS8904 RGBW",
  30: "SK6812 RGBW",
  31: "TM1814 RGBW",
  32: "WS2805 RGB+CCT",
  33: "TM1914",
  34: "SM16825 RGB+CCT",
  40: "On/off relay",
  41: "PWM white",
  42: "PWM CCT",
  43: "PWM RGB",
  44: "PWM RGBW",
  45: "PWM RGB+CCT",
  46: "PWM RGB+A+CCT",
  50: "WS2801",
  51: "APA102",
  52: "LPD8806",
  53: "P9813",
  54: "LPD6803",
  80: "Network DDP RGB",
  81: "Network E1.31 RGB",
  82: "Network Art-Net RGB",
  88: "Network DDP RGBW",
  89: "Network Art-Net RGBW",
};

/** `WLED type 28 (FW1906 RGB+CCT)`; unnamed values stay `WLED type N`. */
export function nativeTypeLabel(type: number | null): string | null {
  if (type === null) return null;
  const name = WLED_NATIVE_TYPE_NAMES[type];
  return name ? `WLED type ${type} (${name})` : `WLED type ${type}`;
}

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
  /** First understood writable bus, for the existing single-strip Strip form. */
  settings: WledStripProvision;
  /** Every `hw.led.ins[]` entry, including buses we will not convert. */
  outputs: ProvisionBusRead[];
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
  /**
   * True when Apply did not change native type and therefore left `order`
   * untouched. Absent when nothing was written.
   */
  orderPreserved?: boolean;
};

const emptySettings = (): WledStripProvision => ({
  ledType: "unknown",
  length: null,
  gpio: null,
  nativeType: null,
  nativeOrder: null,
  colorOrder: null,
});

/**
 * WLED `COL_ORDER_*` in `wled00/const.h` (0.14 / 0.15 / 16): 0 GRB, 1 RGB,
 * 2 BRG, 3 RBG, 4 BGR, 5 GBR. RGBW types append W — order 0 is GRBW on
 * SK6812. Extra packed encodings stay numeric.
 */
export const WLED_COL_ORDER_RGB = ["GRB", "RGB", "BRG", "RBG", "BGR", "GBR"] as const;

export function busNativeOrder(bus: Record<string, unknown>): number | null {
  return integer(bus.order);
}

export function nativeOrderFromColorOrder(
  colorOrder: string,
  ledType: ProvisionLedType | "unknown",
): number | null {
  const trimmed = colorOrder.trim().toUpperCase();
  if (!trimmed) return null;
  const rgb = trimmed.endsWith("W") ? trimmed.slice(0, -1) : trimmed;
  const index = (WLED_COL_ORDER_RGB as readonly string[]).indexOf(rgb);
  if (index < 0) return null;
  if (ledType === "sk6812-rgbw" && trimmed.endsWith("W")) return index;
  if (ledType !== "sk6812-rgbw" && trimmed.endsWith("W")) return null;
  return index;
}

export function colorOrderFromNative(
  nativeOrder: number | null,
  ledType: ProvisionLedType | "unknown",
): string | null {
  if (nativeOrder === null) return null;
  const rgb =
    Number.isInteger(nativeOrder) && nativeOrder >= 0
      ? WLED_COL_ORDER_RGB[nativeOrder]
      : undefined;
  if (!rgb) return `WLED order ${nativeOrder}`;
  return ledType === "sk6812-rgbw" ? `${rgb}W` : rgb;
}

/** Convert / catalog default for a mapped type. Null when the live type is unknown. */
export function catalogColorOrder(ledType: ProvisionLedType | "unknown"): string | null {
  if (ledType === "sk6812-rgbw") return "GRBW";
  if (ledType === "ws281x" || ledType === "fw1906") return "GRB";
  return null;
}

/** Strip copy for the live bus order. Never a silent blank when order ≠ catalog default. */
export function stripColorOrderCopy(input: {
  colorOrder: string | null;
  ledType: ProvisionLedType | "unknown";
  afterSameTypeApply?: boolean;
}): string {
  const live = input.colorOrder;
  if (!live) {
    return "Colour order on this bus was not in /json/cfg.";
  }
  const catalog = catalogColorOrder(input.ledType);
  const differs = catalog !== null && live !== catalog;
  if (!differs) {
    return `Colour order on this bus: ${live}.`;
  }
  if (input.afterSameTypeApply) {
    return `Colour order on this bus: ${live}. This is not ${catalog} — Apply kept the order already on the box.`;
  }
  return `Colour order on this bus: ${live}. This is not ${catalog}.`;
}

export function provisionCaption(source: LiveSource): string {
  return softwareHonestyCaption(source) ?? "Read from /json/cfg. Not Hardware Done.";
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
  if (type === WLED_FW1906_NATIVE_TYPE) return "fw1906";
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
  source: LiveSource = "controller",
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

  const firmwareOk = mapping !== null;
  const outputs = buses.map((bus, index) => inspectBus(bus, index, firmwareOk));
  const writableOutputs = outputs.filter((output) => output.writable);
  const firstWritable = writableOutputs[0] ?? null;
  const settings = firstWritable?.settings ?? emptySettings();
  const typeMapping =
    settings.ledType === "unknown"
      ? null
      : resolveProvisionMapping(firmware, settings.ledType);

  if (!firmwareOk) {
    return {
      settings,
      outputs,
      fingerprint: {
        firmware,
        source: "cfg",
        writable: false,
        mappingId: null,
        fields: [],
      },
      caption,
      refuse: "This firmware isn’t in the strip compatibility table. Nothing was written.",
      buses: buses.length,
    };
  }

  if (!firstWritable) {
    const onlyRefuse =
      outputs.length === 1 && outputs[0]?.refuse
        ? `${outputs[0].refuse} Nothing was written.`
        : "None of this controller’s buses are a strip we provision. Nothing was written.";
    return {
      settings: emptySettings(),
      outputs,
      fingerprint: {
        firmware,
        source: "cfg",
        writable: false,
        mappingId: mapping.id,
        fields: [],
      },
      caption,
      refuse: onlyRefuse,
      buses: buses.length,
    };
  }

  return {
    settings,
    outputs,
    fingerprint: {
      firmware,
      source: "cfg",
      writable: true,
      mappingId: typeMapping?.id ?? mapping.id,
      fields: ["ledType", "length", "gpio"],
    },
    caption,
    refuse: null,
    buses: buses.length,
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
 *
 * Writes the full `ins[]` list so other outputs are cloned, not dropped.
 */
export function buildProvisionWrite(
  draft: WledStripProvisionDraft,
  rawCfg: unknown,
  fingerprint: ProvisionFingerprint,
):
  | {
      ok: true;
      body: Record<string, unknown>;
      sent: WledStripProvisionDraft;
      orderPreserved: boolean;
    }
  | { ok: false; message: string } {
  const parsed = parseWledProvision(rawCfg, fingerprint.firmware, "controller");
  const target = parsed.outputs.find((output) => output.writable);
  const built = buildProvisionOutputsWrite(
    target
      ? [{ ...draft, index: target.index }]
      : [{ ...draft, index: 0 }],
    rawCfg,
    fingerprint,
  );
  if (!built.ok) return built;
  return {
    ok: true,
    body: built.body,
    sent: {
      ledType: built.sent[0]?.ledType ?? draft.ledType,
      length: built.sent[0]?.length ?? draft.length,
      gpio: built.sent[0]?.gpio ?? draft.gpio,
    },
    orderPreserved: built.orderPreserved,
  };
}

export function buildProvisionOutputsWrite(
  drafts: WledStripProvisionOutputDraft[],
  rawCfg: unknown,
  fingerprint: ProvisionFingerprint,
):
  | {
      ok: true;
      body: Record<string, unknown>;
      sent: WledStripProvisionOutputDraft[];
      orderPreserved: boolean;
    }
  | { ok: false; message: string } {
  const parsed = parseWledProvision(rawCfg, fingerprint.firmware, "controller");
  const reason = provisionRefuseReason({
    reachable: true,
    read: {
      ...parsed,
      fingerprint,
      refuse: fingerprint.writable
        ? parsed.refuse
        : parsed.refuse ??
          "This firmware isn’t in the strip compatibility table. Nothing was written.",
    },
  });
  if (reason) return { ok: false, message: reason };
  if (drafts.length === 0) {
    return { ok: false, message: "No LED bus draft to write. Nothing was written." };
  }

  const buses = rawWledBuses(rawCfg).map(cloneRecord);
  if (buses.length === 0) {
    return { ok: false, message: "No LED bus on this firmware. Nothing was written." };
  }

  let orderPreserved = true;
  const sent: WledStripProvisionOutputDraft[] = [];
  for (const draft of drafts) {
    const invalid = validateProvisionDraft(draft);
    if (invalid) return { ok: false, message: invalid };
    const busRead = parsed.outputs.find((output) => output.index === draft.index);
    if (!busRead?.writable) {
      return {
        ok: false,
        message: `Output ${draft.index + 1} is not a strip we provision. Nothing was written.`,
      };
    }
    const mapping = resolveProvisionMapping(fingerprint.firmware, draft.ledType);
    if (!mapping) {
      return {
        ok: false,
        message: "This firmware isn’t in the strip compatibility table. Nothing was written.",
      };
    }
    const current = buses[draft.index];
    if (!current) {
      return { ok: false, message: "No LED bus on this firmware. Nothing was written." };
    }
    const applied = applyDraftToBus(current, draft, mapping);
    if (!applied.ok) return applied;
    buses[draft.index] = applied.bus;
    if (!applied.orderPreserved) orderPreserved = false;
    sent.push({
      index: draft.index,
      ledType: draft.ledType,
      length: draft.length,
      gpio: draft.gpio,
      ...(draft.colorOrder ? { colorOrder: draft.colorOrder } : {}),
    });
  }

  recomputeBusStarts(buses);
  return {
    ok: true,
    body: { hw: { led: { ins: buses } } },
    sent,
    orderPreserved,
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
  expectedSnapshotLedCount: number = sent.length,
): boolean {
  return snapshotLedCount === expectedSnapshotLedCount;
}

export function provisionWriteExpectedLedCount(ins: Record<string, unknown>[]): number | null {
  const lengths = ins.map(busLength);
  if (lengths.some((value) => value === null)) return null;
  return lengths.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function provisionOutputsMatch(
  sent: WledStripProvisionOutputDraft[],
  read: ProvisionRead,
): boolean {
  return sent.every((draft) => {
    const bus = read.outputs.find((output) => output.index === draft.index);
    return Boolean(bus && provisionFieldsMatch(draft, bus.settings));
  });
}

export function provisionMismatchNote(
  sent: WledStripProvisionDraft,
  read: WledStripProvision,
  snapshotLedCount: number | null,
  expectedSnapshotLedCount: number = sent.length,
): string {
  if (!provisionFieldsMatch(sent, read)) {
    return "Wrote, but /json/cfg did not match. Not treating as success.";
  }
  if (!provisionSnapshotMatch(sent, snapshotLedCount, expectedSnapshotLedCount)) {
    return `cfg reports the bus we sent, but the snapshot still has ${
      snapshotLedCount ?? "unknown"
    } LEDs. Not treating as success.`;
  }
  return "Controller reports the strip we sent.";
}

function inspectBus(
  bus: Record<string, unknown>,
  index: number,
  firmwareOk: boolean,
): ProvisionBusRead {
  const gpioList = busPins(bus);
  const nativeType = busNativeType(bus);
  const ledType = ledTypeFromNative(nativeType);
  const nativeOrder = busNativeOrder(bus);
  const settings: WledStripProvision = {
    ledType,
    length: busLength(bus),
    gpio: gpioList?.[0] ?? null,
    nativeType,
    nativeOrder,
    colorOrder: colorOrderFromNative(nativeOrder, ledType),
  };
  if (gpioList && gpioList.length > 1) {
    return {
      index,
      start: integer(bus.start),
      settings,
      refuse: "This bus uses more than one pin. Strip provision is a single GPIO.",
      writable: false,
    };
  }
  if (nativeType !== null && UNSUPPORTED_NUMERIC_TYPES.has(nativeType)) {
    return {
      index,
      start: integer(bus.start),
      settings,
      refuse: "This bus type is not a strip we provision.",
      writable: false,
    };
  }
  return {
    index,
    start: integer(bus.start),
    settings,
    refuse: firmwareOk ? null : "This firmware isn’t in the strip compatibility table.",
    writable: firmwareOk,
  };
}

function applyDraftToBus(
  current: Record<string, unknown>,
  draft: WledStripProvisionOutputDraft,
  mapping: NativeCompatibilityMapping,
):
  | { ok: true; bus: Record<string, unknown>; orderPreserved: boolean }
  | { ok: false; message: string } {
  const next = cloneRecord(current);
  next.pin = [draft.gpio];
  next.len = draft.length;
  const nativeType = busNativeType(current);
  let orderPreserved = nativeType === mapping.native.type;
  if (!orderPreserved) {
    next.type = mapping.native.type;
    next.order = mapping.native.order;
  }
  if (draft.colorOrder != null && draft.colorOrder.trim()) {
    const order = nativeOrderFromColorOrder(draft.colorOrder, draft.ledType);
    if (order === null) {
      return {
        ok: false,
        message: "Colour order must be a WLED RGB permutation (GRB, RGB, …) or GRBW on SK6812.",
      };
    }
    next.order = order;
    orderPreserved = busNativeOrder(current) === order && nativeType === mapping.native.type;
  }
  return { ok: true, bus: next, orderPreserved };
}

function recomputeBusStarts(buses: Record<string, unknown>[]): void {
  let start = 0;
  for (const bus of buses) {
    bus.start = start;
    start += busLength(bus) ?? 0;
  }
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
    outputs: [],
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
