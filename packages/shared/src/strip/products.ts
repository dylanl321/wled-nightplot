/**
 * Operator LED product catalog (CONFIG-52) and Light attach / draft fill
 * (CONFIG-53).
 *
 * Nightplot-owned SKUs — form factor, driver, optional defaults — separate
 * from WLED bus writes. A catalog row is not Hardware Done. formFactor is
 * metadata; it is never written to WLED. Attaching a product persists
 * `ledProductId` only. SK6812 RGBW is a registered driver products may name.
 */
import {
  PROVISION_GPIO_MAX,
  PROVISION_GPIO_MIN,
  PROVISION_LED_TYPES,
  PROVISION_LENGTH_MAX,
  PROVISION_LENGTH_MIN,
  type ProvisionLedType,
  type WledStripProvisionDraft,
} from "../provision.ts";
import { getStrip } from "./catalog.ts";
import {
  defaultStripPreset,
  provisionDraftFromPreset,
  STRIP_PRESETS,
  type StripPreset,
} from "./presets.ts";
import type { StripBead, StripChannel } from "./types.ts";

export const LED_FORM_FACTORS = ["discrete", "cob", "diffused"] as const;
export type LedFormFactor = (typeof LED_FORM_FACTORS)[number];

export const LED_VOLTAGES = [5, 12, 24] as const;
export type LedVoltage = (typeof LED_VOLTAGES)[number];

export const LED_IP_RATINGS = ["IP20", "IP30", "IP44", "IP65", "IP67", "IP68"] as const;

/** Centre-to-centre pitch or one COB section, in millimetres. */
export const LED_SPACING_MM_MAX = 10_000;
export const LED_WATTS_PER_METER_MAX = 200;
export const LED_WIDTH_MM_MAX = 200;

export const PHYSICAL_LENGTH_CAPTION = "Calculated from the recipe and the node count.";

export type LedSpacingKind = "pitch" | "section";

/** Shared recipe vs this Light (CONFIG-113). Attach is bookkeeping. */
export const LED_CATALOG_SHARED_HEADING = "Shared catalog";
export const LED_CATALOG_PER_LIGHT_HEADING = "This Light";
export const LED_CATALOG_SHARED_COPY =
  "LED type and IC recipe. Several Lights can attach the same row.";
export const LED_CATALOG_PER_LIGHT_COPY =
  "Length, GPIO, ranges, and field overrides. Apply writes only this Light’s bus.";
export const LED_CATALOG_ATTACH_COPY =
  "Attach is Nightplot bookkeeping — not Apply, not a WLED write, not Hardware Done.";
export const LED_CATALOG_DELETE_COPY =
  "Delete removes a recipe only when no Light attaches it. Unknown or partial attach counts refuse. There is no “I understand” override. Delete is not Apply, not a WLED write, not Hardware Done.";
export const LED_CATALOG_DELETE_CAPTION =
  "Catalog delete is bookkeeping. Not Apply, not a WLED write, not Hardware Done.";
export const LED_CATALOG_DELETE_CLEARED =
  "Removed from the catalog. Not a WLED write, not Apply, not Hardware Done.";
export const LED_CATALOG_DELETE_REFUSE_ATTACHED =
  "Lights still attach this recipe. Detach them on Strip first. There is no override.";
export const LED_CATALOG_DELETE_REFUSE_UNKNOWN =
  "Unknown or partial attach count is not safe. There is no “I understand” override.";

export type LedProduct = {
  id: string;
  label: string;
  notes: string;
  formFactor: LedFormFactor;
  driverId: string;
  channels?: readonly StripChannel[];
  colorOrder?: string;
  bead?: StripBead;
  defaultLength?: number;
  defaultGpio?: number;
  /** Centre-to-centre millimetres. Used for discrete and diffused. */
  pitchMm?: number;
  /** Millimetres of one addressable section. Used for COB. */
  sectionLengthMm?: number;
  voltage?: LedVoltage;
  wattsPerMeter?: number;
  ipRating?: string;
  widthMm?: number;
  /** Shortest cut, millimetres. Not the addressable section. */
  cutLengthMm?: number;
  densityNotes?: string;
};

export type LedProductDraft = Omit<LedProduct, "id" | "notes"> & {
  id?: string;
  notes?: string;
};

export type LedProductIssue = {
  error: "invalid" | "unknown_driver" | "bad_form_factor" | "bad_defaults" | "bad_override";
  message: string;
};

export type LedProductParse =
  | { ok: true; product: LedProduct }
  | ({ ok: false } & LedProductIssue);

export type InheritedLedFields = {
  channels: readonly StripChannel[];
  colorOrder: string;
  bead: StripBead;
};

const COLOR_ORDER = /^[RGBW]{3,4}$/i;
const PRODUCT_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function isLedFormFactor(value: unknown): value is LedFormFactor {
  return (
    typeof value === "string" && (LED_FORM_FACTORS as readonly string[]).includes(value)
  );
}

export function isLedVoltage(value: unknown): value is LedVoltage {
  return typeof value === "number" && (LED_VOLTAGES as readonly number[]).includes(value);
}

/** Spacing that applies to this form factor. The other field is kept and unused. */
export function ledProductSpacing(
  product: Pick<LedProduct, "formFactor" | "pitchMm" | "sectionLengthMm">,
): { mm: number; kind: LedSpacingKind } | null {
  if (product.formFactor === "cob") {
    return product.sectionLengthMm != null
      ? { mm: product.sectionLengthMm, kind: "section" }
      : null;
  }
  return product.pitchMm != null ? { mm: product.pitchMm, kind: "pitch" } : null;
}

/** Node count times spacing. Null when either side is missing or not positive. */
export function physicalLengthMm(nodeCount: number, spacingMm: number): number | null {
  if (!Number.isFinite(nodeCount) || nodeCount <= 0) return null;
  if (!Number.isFinite(spacingMm) || spacingMm <= 0) return null;
  return nodeCount * spacingMm;
}

export function formatPhysicalLength(mm: number): string | null {
  if (!Number.isFinite(mm) || mm <= 0) return null;
  if (mm >= 1000) {
    const metres = Math.round((mm / 1000) * 100) / 100;
    const text = metres.toFixed(2).replace(/\.?0+$/, "");
    return `${text} m`;
  }
  return `${Math.round(mm)} mm`;
}

export function formatNodeLength(
  nodeCount: number,
  spacingMm: number | null | undefined,
): string | null {
  if (spacingMm == null) return null;
  const mm = physicalLengthMm(nodeCount, spacingMm);
  if (mm == null) return null;
  return formatPhysicalLength(mm);
}

export function inheritLedProductFields(product: LedProduct): InheritedLedFields | null {
  const driver = getStrip(product.driverId);
  if (!driver) return null;
  return {
    channels: product.channels ?? driver.channels,
    colorOrder: product.colorOrder ?? driver.colorOrder,
    bead: product.bead ?? driver.bead,
  };
}

export type LedProductAttachParse =
  | { ok: true; ledProductId: string | null }
  | { ok: false; error: "invalid"; message: string };

export type LedProductAttachResolve =
  | { ok: true; ledProductId: string | null; product: LedProduct | null }
  | { ok: false; error: "not_found" | "unknown_driver"; message: string };

export type ProvisionDraftFromProduct =
  | { ok: true; draft: WledStripProvisionDraft }
  | { ok: false; error: "unknown_driver" | "unsupported_led_type"; message: string };

export type LedProductAttachRef = {
  id: string;
  name: string;
  ledProductId: string | null;
};

export type LedProductAttachCount =
  | {
      known: true;
      complete: true;
      count: number;
      lights: LedProductAttachRef[];
    }
  | {
      known: false;
      complete: false;
      error: "unknown" | "partial";
      message: string;
    };

export type CatalogDeleteCheckStatus = "ok" | "blocked" | "unknown";

export type CatalogDeleteCheck = {
  key: "attaches";
  label: "Lights attach";
  status: CatalogDeleteCheckStatus;
  detail: string;
};

export type LedProductDeleteDecision =
  | { ok: true; count: 0 }
  | {
      ok: false;
      error: "in_use" | "unknown_refs";
      message: string;
      attached: number | null;
      lights: LedProductAttachRef[];
    };

export type LedProductDeleteImpact = {
  count: LedProductAttachCount;
  checks: CatalogDeleteCheck[];
  decision: LedProductDeleteDecision;
};

export function provisionLedTypeForDriver(driverId: string): ProvisionLedType | null {
  return (PROVISION_LED_TYPES as readonly string[]).includes(driverId)
    ? (driverId as ProvisionLedType)
    : null;
}

/**
 * Fill the Strip provision draft from a catalog product + its driver.
 * `ledType` is the registered driver id when that id is a provision type
 * (ws281x or sk6812-rgbw). Length / GPIO come from product defaults, then
 * the caller fallback, then the first seeded preset. Channel / color / bead
 * inherit is catalog metadata — Apply writes the mapped native type only.
 */
export function provisionDraftFromProduct(
  product: LedProduct,
  fallback?: Partial<Pick<WledStripProvisionDraft, "length" | "gpio">>,
): ProvisionDraftFromProduct {
  if (!getStrip(product.driverId)) {
    return {
      ok: false,
      error: "unknown_driver",
      message: "driverId must name a registered strip driver.",
    };
  }
  const ledType = provisionLedTypeForDriver(product.driverId);
  if (!ledType) {
    return {
      ok: false,
      error: "unsupported_led_type",
      message:
        "This driver is not a strip type we provision. Fields were not filled. Nothing was written.",
    };
  }
  const seeded = provisionDraftFromPreset(defaultStripPreset());
  return {
    ok: true,
    draft: {
      ledType,
      length: product.defaultLength ?? fallback?.length ?? seeded.length,
      gpio: product.defaultGpio ?? fallback?.gpio ?? seeded.gpio,
    },
  };
}

export function provisionApplyBodyFromProduct(product: LedProduct):
  | { ok: true; body: { provision: WledStripProvisionDraft } }
  | { ok: false; error: "unknown_driver" | "unsupported_led_type"; message: string } {
  const filled = provisionDraftFromProduct(product);
  if (!filled.ok) return filled;
  return { ok: true, body: { provision: filled.draft } };
}

export function parseLedProductAttach(input: unknown): LedProductAttachParse {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "invalid", message: "Send { ledProductId }." };
  }
  const row = input as Record<string, unknown>;
  if (!("ledProductId" in row)) {
    return { ok: false, error: "invalid", message: "Send { ledProductId }." };
  }
  if (row.ledProductId === null) {
    return { ok: true, ledProductId: null };
  }
  if (typeof row.ledProductId !== "string" || !row.ledProductId.trim()) {
    return {
      ok: false,
      error: "invalid",
      message: "ledProductId must be a catalog id or null.",
    };
  }
  return { ok: true, ledProductId: row.ledProductId.trim() };
}

export function parseLedProductAttachRef(
  value: unknown,
): { ok: true; ref: LedProductAttachRef } | { ok: false; error: "partial" } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "partial" };
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) {
    return { ok: false, error: "partial" };
  }
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.id.trim();
  if (!("ledProductId" in row) || row.ledProductId === undefined || row.ledProductId === null) {
    return { ok: true, ref: { id: row.id, name, ledProductId: null } };
  }
  if (typeof row.ledProductId === "string") {
    return {
      ok: true,
      ref: { id: row.id, name, ledProductId: row.ledProductId.trim() || null },
    };
  }
  return { ok: false, error: "partial" };
}

/**
 * Count Lights that attach `productId`. A non-list or a row we cannot read
 * is unknown / partial — not zero, and not safe to delete.
 */
export function countLedProductAttaches(
  lights: unknown,
  productId: string,
): LedProductAttachCount {
  const id = productId.trim();
  if (!Array.isArray(lights)) {
    return {
      known: false,
      complete: false,
      error: "unknown",
      message: LED_CATALOG_DELETE_REFUSE_UNKNOWN,
    };
  }
  const attached: LedProductAttachRef[] = [];
  for (const row of lights) {
    const parsed = parseLedProductAttachRef(row);
    if (!parsed.ok) {
      return {
        known: false,
        complete: false,
        error: "partial",
        message: LED_CATALOG_DELETE_REFUSE_UNKNOWN,
      };
    }
    if (id && parsed.ref.ledProductId === id) {
      attached.push(parsed.ref);
    }
  }
  return {
    known: true,
    complete: true,
    count: attached.length,
    lights: attached,
  };
}

export function catalogDeleteAttachedDetail(lights: readonly LedProductAttachRef[]): string {
  if (lights.length === 0) return LED_CATALOG_DELETE_REFUSE_ATTACHED;
  const names = lights.map((light) => light.name);
  if (names.length === 1) {
    return `${names[0]} still attaches this recipe. Detach on Strip first. There is no override.`;
  }
  const who = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} Lights`;
  return `${who} still attach this recipe. Detach on Strip first. There is no override.`;
}

export function catalogDeleteChecks(count: LedProductAttachCount): CatalogDeleteCheck[] {
  if (!count.known) {
    return [
      {
        key: "attaches",
        label: "Lights attach",
        status: "unknown",
        detail: count.message,
      },
    ];
  }
  if (count.count > 0) {
    return [
      {
        key: "attaches",
        label: "Lights attach",
        status: "blocked",
        detail: catalogDeleteAttachedDetail(count.lights),
      },
    ];
  }
  return [
    {
      key: "attaches",
      label: "Lights attach",
      status: "ok",
      detail: "No Lights attach this recipe. Removing it is catalog bookkeeping only.",
    },
  ];
}

export function canDeleteCatalog(checks: readonly CatalogDeleteCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status === "ok");
}

export function catalogDeleteProgress(checks: readonly CatalogDeleteCheck[]): {
  done: number;
  total: number;
} {
  return {
    done: checks.filter((check) => check.status === "ok").length,
    total: checks.length,
  };
}

export function catalogDeleteRefuseReason(
  checks: readonly CatalogDeleteCheck[],
): string | null {
  if (canDeleteCatalog(checks)) return null;
  const unknown = checks.find((check) => check.status === "unknown");
  if (unknown) return LED_CATALOG_DELETE_REFUSE_UNKNOWN;
  const blocked = checks.find((check) => check.status === "blocked");
  return blocked?.detail ?? LED_CATALOG_DELETE_REFUSE_ATTACHED;
}

export function decideLedProductDelete(
  count: LedProductAttachCount,
): LedProductDeleteDecision {
  if (!count.known) {
    return {
      ok: false,
      error: "unknown_refs",
      message: LED_CATALOG_DELETE_REFUSE_UNKNOWN,
      attached: null,
      lights: [],
    };
  }
  if (count.count > 0) {
    return {
      ok: false,
      error: "in_use",
      message: catalogDeleteAttachedDetail(count.lights),
      attached: count.count,
      lights: count.lights,
    };
  }
  return { ok: true, count: 0 };
}

export function ledProductDeleteImpact(
  lights: unknown,
  productId: string,
): LedProductDeleteImpact {
  const count = countLedProductAttaches(lights, productId);
  return {
    count,
    checks: catalogDeleteChecks(count),
    decision: decideLedProductDelete(count),
  };
}

export function unknownLedProductDeleteImpact(): LedProductDeleteImpact {
  return ledProductDeleteImpact(null, "");
}

export function resolveLedProductAttach(
  ledProductId: string | null,
  lookup: (id: string) => LedProduct | undefined,
): LedProductAttachResolve {
  if (ledProductId === null) {
    return { ok: true, ledProductId: null, product: null };
  }
  const product = lookup(ledProductId);
  if (!product) {
    return {
      ok: false,
      error: "not_found",
      message: "That LED product is not in the catalog.",
    };
  }
  if (!getStrip(product.driverId)) {
    return {
      ok: false,
      error: "unknown_driver",
      message: "driverId must name a registered strip driver.",
    };
  }
  return { ok: true, ledProductId: product.id, product };
}

export function seedLedProductsFromPresets(
  presets: readonly StripPreset[] = STRIP_PRESETS,
): LedProduct[] {
  return presets.map((preset) => ({
    id: `led-${preset.id}`,
    label: `WS281x discrete · ${preset.length} nodes · GPIO ${preset.gpio}`,
    notes:
      `Seeded from strip preset ${preset.id}. Form factor is Nightplot metadata — not written to WLED. ` +
      "Documented default — not a confirmed install, not Hardware Done.",
    formFactor: "discrete",
    driverId: preset.ledType,
    defaultLength: preset.length,
    defaultGpio: preset.gpio,
    densityNotes: densityNotesFromPreset(preset),
  }));
}

export function parseLedProductInput(input: unknown): LedProductParse {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      error: "invalid",
      message: "Send { label, formFactor, driverId }.",
    };
  }
  const row = input as Record<string, unknown>;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!label) {
    return { ok: false, error: "invalid", message: "label is required." };
  }

  if (!isLedFormFactor(row.formFactor)) {
    return {
      ok: false,
      error: "bad_form_factor",
      message:
        "formFactor must be discrete, cob, or diffused. It is metadata — not written to WLED.",
    };
  }

  if (typeof row.driverId !== "string" || !row.driverId.trim()) {
    return {
      ok: false,
      error: "unknown_driver",
      message: "driverId must name a registered strip driver.",
    };
  }
  const driverId = row.driverId.trim();
  if (!getStrip(driverId)) {
    return {
      ok: false,
      error: "unknown_driver",
      message: "driverId must name a registered strip driver.",
    };
  }

  let id: string | undefined;
  if (row.id !== undefined) {
    if (typeof row.id !== "string" || !PRODUCT_ID.test(row.id.trim())) {
      return {
        ok: false,
        error: "invalid",
        message: "id must be a short slug (letters, numbers, . _ -).",
      };
    }
    id = row.id.trim();
  }

  if (row.notes !== undefined && typeof row.notes !== "string") {
    return { ok: false, error: "invalid", message: "notes must be a string." };
  }

  const overrides = parseOverrides(row);
  if (!overrides.ok) return overrides;

  const product: LedProduct = {
    id: id ?? "",
    label,
    notes: typeof row.notes === "string" ? row.notes.trim() : "",
    formFactor: row.formFactor,
    driverId,
    ...overrides.fields,
  };
  return { ok: true, product };
}

export function validateLedProduct(product: LedProduct): LedProductIssue | null {
  const parsed = parseLedProductInput({
    ...product,
    id: product.id || undefined,
  });
  if (!parsed.ok) {
    return { error: parsed.error, message: parsed.message };
  }
  if (product.id && !PRODUCT_ID.test(product.id)) {
    return {
      error: "invalid",
      message: "id must be a short slug (letters, numbers, . _ -).",
    };
  }
  return null;
}

function parseOverrides(
  row: Record<string, unknown>,
):
  | {
      ok: true;
      fields: Partial<
        Pick<
          LedProduct,
          | "channels"
          | "colorOrder"
          | "bead"
          | "defaultLength"
          | "defaultGpio"
          | "densityNotes"
          | "pitchMm"
          | "sectionLengthMm"
          | "voltage"
          | "wattsPerMeter"
          | "ipRating"
          | "widthMm"
          | "cutLengthMm"
        >
      >;
    }
  | ({ ok: false } & LedProductIssue) {
  const fields: Partial<
    Pick<
      LedProduct,
      | "channels"
      | "colorOrder"
      | "bead"
      | "defaultLength"
      | "defaultGpio"
      | "densityNotes"
      | "pitchMm"
      | "sectionLengthMm"
      | "voltage"
      | "wattsPerMeter"
      | "ipRating"
      | "widthMm"
      | "cutLengthMm"
    >
  > = {};

  if (row.channels !== undefined) {
    const channels = parseChannels(row.channels);
    if (!channels) {
      return {
        ok: false,
        error: "bad_override",
        message: "channels must be a non-empty list of r, g, b, and/or w.",
      };
    }
    fields.channels = channels;
  }

  if (row.colorOrder !== undefined) {
    if (typeof row.colorOrder !== "string" || !COLOR_ORDER.test(row.colorOrder.trim())) {
      return {
        ok: false,
        error: "bad_override",
        message: "colorOrder must be 3–4 letters from R, G, B, W.",
      };
    }
    fields.colorOrder = row.colorOrder.trim().toUpperCase();
  }

  if (row.bead !== undefined) {
    if (row.bead !== "rgb" && row.bead !== "rgbw") {
      return {
        ok: false,
        error: "bad_override",
        message: "bead must be rgb or rgbw. Form factor stays metadata.",
      };
    }
    fields.bead = row.bead;
  }

  if (row.defaultLength !== undefined) {
    if (!isWholeInRange(row.defaultLength, PROVISION_LENGTH_MIN, PROVISION_LENGTH_MAX)) {
      return {
        ok: false,
        error: "bad_defaults",
        message: `defaultLength is ${PROVISION_LENGTH_MIN}–${PROVISION_LENGTH_MAX} nodes.`,
      };
    }
    fields.defaultLength = row.defaultLength as number;
  }

  if (row.defaultGpio !== undefined) {
    if (!isWholeInRange(row.defaultGpio, PROVISION_GPIO_MIN, PROVISION_GPIO_MAX)) {
      return {
        ok: false,
        error: "bad_defaults",
        message: `defaultGpio is ${PROVISION_GPIO_MIN}–${PROVISION_GPIO_MAX}.`,
      };
    }
    fields.defaultGpio = row.defaultGpio as number;
  }

  if (row.densityNotes !== undefined) {
    if (typeof row.densityNotes !== "string") {
      return { ok: false, error: "invalid", message: "densityNotes must be a string." };
    }
    const densityNotes = row.densityNotes.trim();
    if (densityNotes) fields.densityNotes = densityNotes;
  }

  const physical = parsePhysical(row);
  if (!physical.ok) return physical;
  Object.assign(fields, physical.fields);

  return { ok: true, fields };
}

function parsePhysical(
  row: Record<string, unknown>,
):
  | {
      ok: true;
      fields: Partial<
        Pick<
          LedProduct,
          | "pitchMm"
          | "sectionLengthMm"
          | "voltage"
          | "wattsPerMeter"
          | "ipRating"
          | "widthMm"
          | "cutLengthMm"
        >
      >;
    }
  | ({ ok: false } & LedProductIssue) {
  const fields: Partial<
    Pick<
      LedProduct,
      | "pitchMm"
      | "sectionLengthMm"
      | "voltage"
      | "wattsPerMeter"
      | "ipRating"
      | "widthMm"
      | "cutLengthMm"
    >
  > = {};

  const pitch = parseMm(row.pitchMm, "pitchMm", LED_SPACING_MM_MAX);
  if (!pitch.ok) return pitch;
  if (pitch.value != null) fields.pitchMm = pitch.value;

  const section = parseMm(row.sectionLengthMm, "sectionLengthMm", LED_SPACING_MM_MAX);
  if (!section.ok) return section;
  if (section.value != null) fields.sectionLengthMm = section.value;

  if (row.voltage !== undefined) {
    if (!isLedVoltage(row.voltage)) {
      return {
        ok: false,
        error: "bad_defaults",
        message: "voltage must be 5, 12, or 24.",
      };
    }
    fields.voltage = row.voltage;
  }

  const watts = parseMm(row.wattsPerMeter, "wattsPerMeter", LED_WATTS_PER_METER_MAX);
  if (!watts.ok) return watts;
  if (watts.value != null) fields.wattsPerMeter = watts.value;

  if (row.ipRating !== undefined) {
    if (typeof row.ipRating !== "string") {
      return { ok: false, error: "bad_defaults", message: "ipRating must be a string." };
    }
    const ip = row.ipRating.trim().toUpperCase();
    if (ip) {
      if (!(LED_IP_RATINGS as readonly string[]).includes(ip)) {
        return {
          ok: false,
          error: "bad_defaults",
          message: "ipRating must be IP20, IP30, IP44, IP65, IP67, or IP68.",
        };
      }
      fields.ipRating = ip;
    }
  }

  const width = parseMm(row.widthMm, "widthMm", LED_WIDTH_MM_MAX);
  if (!width.ok) return width;
  if (width.value != null) fields.widthMm = width.value;

  const cut = parseMm(row.cutLengthMm, "cutLengthMm", LED_SPACING_MM_MAX);
  if (!cut.ok) return cut;
  if (cut.value != null) fields.cutLengthMm = cut.value;

  return { ok: true, fields };
}

function parseMm(
  value: unknown,
  name: string,
  max: number,
): { ok: true; value?: number } | ({ ok: false } & LedProductIssue) {
  if (value === undefined) return { ok: true };
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    return {
      ok: false,
      error: "bad_defaults",
      message: `${name} must be above 0 and at most ${max}.`,
    };
  }
  return { ok: true, value };
}

function parseChannels(value: unknown): StripChannel[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const channels: StripChannel[] = [];
  for (const item of value) {
    if (item !== "r" && item !== "g" && item !== "b" && item !== "w") return null;
    if (channels.includes(item)) return null;
    channels.push(item);
  }
  return channels;
}

function isWholeInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function densityNotesFromPreset(preset: StripPreset): string | undefined {
  const match = preset.notes.match(/\(([^)]+\/m[^)]*)\)/);
  return match?.[1];
}
