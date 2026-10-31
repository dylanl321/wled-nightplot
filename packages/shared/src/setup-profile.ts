/**
 * Saved setup profile for fleet apply: LED type, optional colour order,
 * optional shared length/GPIO, Safe brightness / current limit, name pattern.
 */

import {
  isProvisionLedType,
  nativeOrderFromColorOrder,
  PROVISION_GPIO_MAX,
  PROVISION_GPIO_MIN,
  PROVISION_LENGTH_MAX,
  PROVISION_LENGTH_MIN,
  type ProvisionLedType,
} from "./provision.ts";

export const SETUP_PROFILE_NAME_MAX = 48;
export const WLED_DISPLAY_NAME_MAX = 32;

export type SetupProfile = {
  id: string;
  name: string;
  ledType?: ProvisionLedType;
  colorOrder?: string | null;
  gpio?: number | null;
  length?: number | null;
  bootBrightness?: number | null;
  currentLimitMa?: number | null;
  namePattern?: string | null;
  /**
   * WLED bus index to write. Missing / null means every writable output.
   */
  outputIndex?: number | null;
};

export type SetupProfileDraft = Omit<SetupProfile, "id"> & { id?: string };

export function isSetupProfile(value: unknown): value is SetupProfile {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SetupProfile>;
  if (typeof row.id !== "string" || !row.id) return false;
  if (typeof row.name !== "string" || !row.name.trim()) return false;
  if (row.ledType !== undefined && !isProvisionLedType(row.ledType)) return false;
  if (row.colorOrder != null && typeof row.colorOrder !== "string") return false;
  if (row.gpio != null && !Number.isInteger(row.gpio)) return false;
  if (row.length != null && !Number.isInteger(row.length)) return false;
  if (row.bootBrightness != null && !Number.isInteger(row.bootBrightness)) return false;
  if (row.currentLimitMa != null && !Number.isInteger(row.currentLimitMa)) return false;
  if (row.namePattern != null && typeof row.namePattern !== "string") return false;
  if (row.outputIndex != null && !Number.isInteger(row.outputIndex)) return false;
  return true;
}

export function validateSetupProfile(draft: SetupProfileDraft): string | null {
  if (!draft.name.trim()) return "A setup profile needs a name.";
  if (draft.name.trim().length > SETUP_PROFILE_NAME_MAX) {
    return `Profile name is at most ${SETUP_PROFILE_NAME_MAX} characters.`;
  }
  if (draft.ledType !== undefined && !isProvisionLedType(draft.ledType)) {
    return "LED type must be a mapped strip driver. Unknown types are not written.";
  }
  if (draft.colorOrder != null && draft.colorOrder.trim()) {
    const order = nativeOrderFromColorOrder(draft.colorOrder, draft.ledType ?? "ws281x");
    if (order === null) {
      return "Colour order must be a WLED RGB permutation (GRB, RGB, …) or GRBW on SK6812.";
    }
  }
  if (draft.gpio != null && (draft.gpio < PROVISION_GPIO_MIN || draft.gpio > PROVISION_GPIO_MAX)) {
    return `GPIO is ${PROVISION_GPIO_MIN}–${PROVISION_GPIO_MAX}.`;
  }
  if (
    draft.length != null &&
    (draft.length < PROVISION_LENGTH_MIN || draft.length > PROVISION_LENGTH_MAX)
  ) {
    return `Length is ${PROVISION_LENGTH_MIN}–${PROVISION_LENGTH_MAX} nodes.`;
  }
  if (draft.bootBrightness != null && (draft.bootBrightness < 1 || draft.bootBrightness > 255)) {
    return "Boot brightness is 1–255.";
  }
  if (draft.currentLimitMa != null && (draft.currentLimitMa < 0 || draft.currentLimitMa > 65000)) {
    return "Current limit is 0–65000 mA.";
  }
  if (draft.outputIndex != null && (!Number.isInteger(draft.outputIndex) || draft.outputIndex < 0)) {
    return "Output index is a 0-based writable bus, or leave it empty for every writable output.";
  }
  if (draft.namePattern != null && draft.namePattern.length > WLED_DISPLAY_NAME_MAX + 16) {
    return "Name pattern is too long.";
  }
  if (!setupProfileHasWork(draft)) {
    return "A setup profile needs at least one field to write.";
  }
  return null;
}

export function setupProfileHasWork(draft: Pick<
  SetupProfileDraft,
  "ledType" | "colorOrder" | "gpio" | "length" | "bootBrightness" | "currentLimitMa" | "namePattern"
>): boolean {
  return (
    draft.ledType !== undefined ||
    (typeof draft.colorOrder === "string" && draft.colorOrder.trim().length > 0) ||
    draft.gpio != null ||
    draft.length != null ||
    draft.bootBrightness != null ||
    draft.currentLimitMa != null ||
    (typeof draft.namePattern === "string" && draft.namePattern.trim().length > 0)
  );
}

export function setupProfileWritesStrip(draft: Pick<
  SetupProfileDraft,
  "ledType" | "colorOrder" | "gpio" | "length"
>): boolean {
  return (
    draft.ledType !== undefined ||
    (typeof draft.colorOrder === "string" && draft.colorOrder.trim().length > 0) ||
    draft.gpio != null ||
    draft.length != null
  );
}

export function setupProfileWritesSafe(draft: Pick<
  SetupProfileDraft,
  "bootBrightness" | "currentLimitMa" | "namePattern"
>): boolean {
  return (
    draft.bootBrightness != null ||
    draft.currentLimitMa != null ||
    (typeof draft.namePattern === "string" && draft.namePattern.trim().length > 0)
  );
}

export function normalizeSetupProfile(draft: SetupProfileDraft, id: string): SetupProfile {
  return {
    id,
    name: draft.name.trim(),
    ...(draft.ledType ? { ledType: draft.ledType } : {}),
    ...(typeof draft.colorOrder === "string" && draft.colorOrder.trim()
      ? { colorOrder: draft.colorOrder.trim().toUpperCase() }
      : {}),
    ...(draft.gpio != null ? { gpio: draft.gpio } : {}),
    ...(draft.length != null ? { length: draft.length } : {}),
    ...(draft.bootBrightness != null ? { bootBrightness: draft.bootBrightness } : {}),
    ...(draft.currentLimitMa != null ? { currentLimitMa: draft.currentLimitMa } : {}),
    ...(typeof draft.namePattern === "string" && draft.namePattern.trim()
      ? { namePattern: draft.namePattern.trim() }
      : {}),
    ...(draft.outputIndex != null ? { outputIndex: draft.outputIndex } : {}),
  };
}

/** Writable bus indexes this profile will write. */
export function setupProfileTargetIndexes(
  profile: Pick<SetupProfile, "outputIndex">,
  writableIndexes: number[],
): { ok: true; indexes: number[] } | { ok: false; reason: string } {
  if (profile.outputIndex == null) {
    return writableIndexes.length > 0
      ? { ok: true, indexes: writableIndexes }
      : { ok: false, reason: "None of this controller’s buses are a strip we provision." };
  }
  if (!writableIndexes.includes(profile.outputIndex)) {
    return {
      ok: false,
      reason: `This Light has no writable output ${profile.outputIndex + 1}.`,
    };
  }
  return { ok: true, indexes: [profile.outputIndex] };
}

export function mergeSetupProfile(
  saved: SetupProfile | null,
  overlay: Partial<SetupProfileDraft> | null,
): SetupProfileDraft | null {
  if (!saved && !overlay) return null;
  const base: SetupProfileDraft = saved
    ? { ...saved }
    : { name: overlay?.name?.trim() || "Setup profile" };
  if (!overlay) return base;
  return {
    ...base,
    ...overlay,
    name: overlay.name?.trim() || base.name,
  };
}

/**
 * `{n}` is 1-based index, `{nn}` is zero-padded to two digits,
 * `{name}` is the current display name, `{host}` is the host label.
 */
export function applyNamePattern(
  pattern: string,
  input: { index: number; currentName: string; host: string },
): string {
  const n = Number.isInteger(input.index) && input.index > 0 ? input.index : 1;
  const rendered = pattern
    .replaceAll("{nn}", String(n).padStart(2, "0"))
    .replaceAll("{n}", String(n))
    .replaceAll("{name}", input.currentName)
    .replaceAll("{host}", input.host)
    .trim();
  return rendered.slice(0, WLED_DISPLAY_NAME_MAX) || input.currentName.slice(0, WLED_DISPLAY_NAME_MAX);
}
