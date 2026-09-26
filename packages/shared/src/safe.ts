export const SAFE_FIELDS = [
  "displayName",
  "turnOnAtBoot",
  "bootBrightness",
  "bootPreset",
  "defaultTransition",
  "currentLimitMa",
] as const;

export type SafeFieldKey = (typeof SAFE_FIELDS)[number];

export type WledSafeSettings = {
  displayName: string | null;
  turnOnAtBoot: boolean | null;
  bootBrightness: number | null;
  bootPreset: number | null;
  defaultTransition: number | null;
  currentLimitMa: number | null;
};

export type SafeFingerprint = {
  firmware: string | null;
  source: "cfg";
  fields: SafeFieldKey[];
  writable: boolean;
};

export type SafeRead = {
  settings: WledSafeSettings;
  fingerprint: SafeFingerprint;
  caption: string;
  refuse: string | null;
};

export type SafeWriteResult = {
  status: "matched" | "mismatch" | "refused" | "failed";
  matched: boolean;
  sent: Partial<WledSafeSettings>;
  read: WledSafeSettings;
  fingerprint: SafeFingerprint;
  message: string;
  caption: string;
};

const emptySettings = (): WledSafeSettings => ({
  displayName: null,
  turnOnAtBoot: null,
  bootBrightness: null,
  bootPreset: null,
  defaultTransition: null,
  currentLimitMa: null,
});

export function safeCaption(source: "fixture" | "controller"): string {
  if (source === "fixture") {
    return "Software-green from the fixture. Not Hardware Done.";
  }
  return "Read from /json/cfg. Not Hardware Done.";
}

export function parseWledCfg(
  body: unknown,
  firmware: string | null = null,
  source: "fixture" | "controller" = "controller",
): SafeRead {
  const caption = safeCaption(source);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return refusedRead(
      firmware,
      "No /json/cfg on this controller. Safe settings were not written.",
      caption,
    );
  }
  const root = body as Record<string, unknown>;
  const id = isRecord(root.id) ? root.id : null;
  const def = isRecord(root.def) ? root.def : null;
  const light = isRecord(root.light) ? root.light : null;
  const tr = light && isRecord(light.tr) ? light.tr : null;
  const hw = isRecord(root.hw) ? root.hw : null;
  const led = hw && isRecord(hw.led) ? hw.led : null;

  const settings = emptySettings();
  const fields: SafeFieldKey[] = [];

  if (typeof id?.name === "string") {
    settings.displayName = id.name;
    fields.push("displayName");
  }
  if (typeof def?.on === "boolean") {
    settings.turnOnAtBoot = def.on;
    fields.push("turnOnAtBoot");
  }
  if (typeof def?.bri === "number" && Number.isFinite(def.bri)) {
    settings.bootBrightness = clamp(def.bri, 1, 255);
    fields.push("bootBrightness");
  }
  if (typeof def?.ps === "number" && Number.isFinite(def.ps)) {
    settings.bootPreset = clamp(def.ps, 0, 250);
    fields.push("bootPreset");
  }
  if (typeof tr?.dur === "number" && Number.isFinite(tr.dur)) {
    settings.defaultTransition = clamp(tr.dur, 0, 655);
    fields.push("defaultTransition");
  }
  if (typeof led?.maxpwr === "number" && Number.isFinite(led.maxpwr)) {
    settings.currentLimitMa = clamp(led.maxpwr, 0, 65000);
    fields.push("currentLimitMa");
  }

  const writable = fields.length > 0;
  return {
    settings,
    fingerprint: { firmware, source: "cfg", fields, writable },
    caption,
    refuse: writable
      ? null
      : "This firmware’s config isn’t a shape we write. Nothing was sent.",
  };
}

export function safeRefuseReason(input: {
  reachable: boolean;
  read: SafeRead | null;
  busyKind?: "preview" | "blink" | null;
  draft?: Partial<WledSafeSettings> | null;
}): string | null {
  if (!input.reachable) {
    return "This Light hasn’t answered. Refresh or re-address it first.";
  }
  if (input.busyKind === "preview") {
    return "End the Preview first. Safe settings are not a live look.";
  }
  if (input.busyKind === "blink") {
    return "Wait for Blink to finish.";
  }
  if (!input.read) {
    return "No /json/cfg on this controller. Safe settings were not written.";
  }
  if (input.read.refuse) return input.read.refuse;
  if (!input.read.fingerprint.writable) {
    return "This firmware’s config isn’t a shape we write. Nothing was sent.";
  }
  if (input.draft) {
    const unknown = requestedFields(input.draft).filter(
      (key) => !input.read!.fingerprint.fields.includes(key),
    );
    if (unknown.length > 0) {
      return `This firmware doesn’t expose ${fieldLabel(unknown[0]!)}. Nothing was written.`;
    }
    const invalid = validateSafeDraft(input.draft, input.read.fingerprint.fields);
    if (invalid) return invalid;
    if (requestedFields(input.draft).length === 0) {
      return "Send at least one Safe settings field.";
    }
  }
  return null;
}

export function validateSafeDraft(
  draft: Partial<WledSafeSettings>,
  allowed: SafeFieldKey[] = [...SAFE_FIELDS],
): string | null {
  if (allowed.includes("displayName") && draft.displayName !== undefined) {
    if (typeof draft.displayName !== "string" || !draft.displayName.trim()) {
      return "Display name can’t be empty.";
    }
    if (draft.displayName.trim().length > 32) {
      return "Display name is 32 characters on this firmware.";
    }
  }
  if (draft.bootBrightness !== undefined && draft.bootBrightness !== null) {
    if (!Number.isFinite(draft.bootBrightness) || draft.bootBrightness < 1 || draft.bootBrightness > 255) {
      return "Boot brightness is 1–255.";
    }
  }
  if (draft.bootPreset !== undefined && draft.bootPreset !== null) {
    if (!Number.isFinite(draft.bootPreset) || draft.bootPreset < 0 || draft.bootPreset > 250) {
      return "Boot preset is 0–250 (0 is none).";
    }
  }
  if (draft.defaultTransition !== undefined && draft.defaultTransition !== null) {
    if (
      !Number.isFinite(draft.defaultTransition) ||
      draft.defaultTransition < 0 ||
      draft.defaultTransition > 655
    ) {
      return "Default transition is 0–655 units of 100 ms.";
    }
  }
  if (draft.currentLimitMa !== undefined && draft.currentLimitMa !== null) {
    if (!Number.isFinite(draft.currentLimitMa) || draft.currentLimitMa < 0 || draft.currentLimitMa > 65000) {
      return "Current limit is 0–65000 mA (0 turns ABL off).";
    }
  }
  return null;
}

export function buildSafeWrite(
  draft: Partial<WledSafeSettings>,
  fingerprint: SafeFingerprint,
): { ok: true; body: Record<string, unknown>; sent: Partial<WledSafeSettings> } | { ok: false; message: string } {
  const reason = safeRefuseReason({
    reachable: true,
    read: {
      settings: emptySettings(),
      fingerprint,
      caption: "",
      refuse: fingerprint.writable
        ? null
        : "This firmware’s config isn’t a shape we write. Nothing was sent.",
    },
    draft,
  });
  if (reason) return { ok: false, message: reason };

  const sent: Partial<WledSafeSettings> = {};
  const body: Record<string, unknown> = {};
  const allowed = new Set(fingerprint.fields);

  if (allowed.has("displayName") && typeof draft.displayName === "string") {
    sent.displayName = draft.displayName.trim();
    body.id = { name: sent.displayName };
  }
  const def: Record<string, unknown> = {};
  if (allowed.has("turnOnAtBoot") && typeof draft.turnOnAtBoot === "boolean") {
    sent.turnOnAtBoot = draft.turnOnAtBoot;
    def.on = draft.turnOnAtBoot;
  }
  if (allowed.has("bootBrightness") && typeof draft.bootBrightness === "number") {
    sent.bootBrightness = clamp(draft.bootBrightness, 1, 255);
    def.bri = sent.bootBrightness;
  }
  if (allowed.has("bootPreset") && typeof draft.bootPreset === "number") {
    sent.bootPreset = clamp(draft.bootPreset, 0, 250);
    def.ps = sent.bootPreset;
  }
  if (Object.keys(def).length > 0) body.def = def;
  if (allowed.has("defaultTransition") && typeof draft.defaultTransition === "number") {
    sent.defaultTransition = clamp(draft.defaultTransition, 0, 655);
    body.light = { tr: { dur: sent.defaultTransition } };
  }
  if (allowed.has("currentLimitMa") && typeof draft.currentLimitMa === "number") {
    sent.currentLimitMa = clamp(draft.currentLimitMa, 0, 65000);
    body.hw = { led: { maxpwr: sent.currentLimitMa } };
  }

  if (Object.keys(sent).length === 0) {
    return { ok: false, message: "Send at least one Safe settings field." };
  }
  return { ok: true, body, sent };
}

export function safeFieldsMatch(
  sent: Partial<WledSafeSettings>,
  read: WledSafeSettings,
): boolean {
  return requestedFields(sent).every((key) => read[key] === sent[key]);
}

/** Honest copy when metal `/json/info` still has the pre-rename name. */
export function safeInfoNameLagNote(
  cfgName: string | null | undefined,
  infoName: string | null | undefined,
): string | null {
  if (typeof cfgName !== "string" || !cfgName.trim()) return null;
  if (typeof infoName !== "string" || !infoName.trim()) return null;
  if (cfgName.trim() === infoName.trim()) return null;
  return `/json/info still reports “${infoName.trim()}” until reboot. The title uses the name from /json/cfg.`;
}

export function requestedFields(draft: Partial<WledSafeSettings>): SafeFieldKey[] {
  return SAFE_FIELDS.filter((key) => draft[key] !== undefined && draft[key] !== null);
}

export function fieldLabel(key: SafeFieldKey): string {
  switch (key) {
    case "displayName":
      return "display name";
    case "turnOnAtBoot":
      return "turn-on-at-boot";
    case "bootBrightness":
      return "boot brightness";
    case "bootPreset":
      return "boot preset";
    case "defaultTransition":
      return "default transition";
    case "currentLimitMa":
      return "global current limit";
  }
}

export function transitionMs(units: number | null): number | null {
  return units === null ? null : units * 100;
}

export function transitionUnitsFromMs(ms: number): number {
  return clamp(Math.round(ms / 100), 0, 655);
}

function refusedRead(firmware: string | null, refuse: string, caption: string): SafeRead {
  return {
    settings: emptySettings(),
    fingerprint: { firmware, source: "cfg", fields: [], writable: false },
    caption,
    refuse,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
