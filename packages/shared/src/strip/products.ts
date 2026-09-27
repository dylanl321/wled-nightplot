/**
 * Operator LED product catalog (CONFIG-52) and Light attach / draft fill
 * (CONFIG-53).
 *
 * Nightplot-owned SKUs — form factor, driver, optional defaults — separate
 * from WLED bus writes. A catalog row is not Hardware Done. formFactor is
 * metadata; it is never written to WLED. Attaching a product persists
 * `ledProductId` only. RGBW native provision maps are CONFIG-54.
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

export function provisionLedTypeForDriver(driverId: string): ProvisionLedType | null {
  return (PROVISION_LED_TYPES as readonly string[]).includes(driverId)
    ? (driverId as ProvisionLedType)
    : null;
}

/**
 * Fill the Strip provision draft from a catalog product + its driver.
 * `ledType` is the registered driver id when that id is a provision type
 * (today: ws281x). Length / GPIO come from product defaults, then the
 * caller fallback, then the first seeded preset. Channel / color / bead
 * inherit is not written here — RGBW native maps are CONFIG-54.
 */
export function provisionDraftFromProduct(
  product: LedProduct,
  fallback?: Partial<Pick<WledStripProvisionDraft, "length" | "gpio">>,
): ProvisionDraftFromProduct {
  if (!getStrip(product.driverId)) {
    return {
      ok: false,
      error: "unknown_driver",
      message: "driverId must name a registered strip driver (today: ws281x).",
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
      message: "driverId must name a registered strip driver (today: ws281x).",
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
      message: "driverId must name a registered strip driver (today: ws281x).",
    };
  }
  const driverId = row.driverId.trim();
  if (!getStrip(driverId)) {
    return {
      ok: false,
      error: "unknown_driver",
      message: "driverId must name a registered strip driver (today: ws281x).",
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
  | { ok: true; fields: Partial<Pick<LedProduct, "channels" | "colorOrder" | "bead" | "defaultLength" | "defaultGpio" | "densityNotes">> }
  | ({ ok: false } & LedProductIssue) {
  const fields: Partial<
    Pick<
      LedProduct,
      "channels" | "colorOrder" | "bead" | "defaultLength" | "defaultGpio" | "densityNotes"
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
        message: "bead must be rgb or rgbw. RGBW native provision maps are not this catalog.",
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

  return { ok: true, fields };
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
