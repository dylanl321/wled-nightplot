export type SegmentPaletteColor = { name: string; hex: string };

export type NightplotSettings = {
  version: 1;
  revision: number;
  defaultLedProductId: string | null;
  stripSuggestions: { ledCount: number | null; gpio: number | null };
  preview: { hex: string; brightness: number; heldDimPercent: 60 };
  appearance: "dark" | "light";
  findIntervalSeconds: 0 | 30 | 60 | 120;
  palette: SegmentPaletteColor[];
  backupRetention: { enabled: boolean; limit: number };
};

export const DEFAULT_PALETTE: SegmentPaletteColor[] = [
  { name: "Amber", hex: "#F1AD61" }, { name: "Coral", hex: "#EE8276" },
  { name: "Teal", hex: "#4BC9B0" }, { name: "Azure", hex: "#74A6F7" },
  { name: "Violet", hex: "#B996EA" }, { name: "Lime", hex: "#B8D46A" },
  { name: "Rose", hex: "#E593B6" }, { name: "Ice", hex: "#72C6DE" },
];

export function defaultNightplotSettings(): NightplotSettings {
  return { version: 1, revision: 0, defaultLedProductId: null,
    stripSuggestions: { ledCount: null, gpio: null },
    preview: { hex: "#F1AD61", brightness: 128, heldDimPercent: 60 },
    appearance: "dark", findIntervalSeconds: 60,
    palette: DEFAULT_PALETTE.map((color) => ({ ...color })),
    backupRetention: { enabled: false, limit: 100 } };
}

const hex = /^#[0-9a-fA-F]{6}$/;
const integer = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const optionalInteger = (value: unknown, min: number, max: number) =>
  value === null || integer(value, min, max);
const onlyKeys = (value: object, keys: string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));

export function isNightplotSettings(value: unknown): value is NightplotSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as NightplotSettings;
  return onlyKeys(s, ["version", "revision", "defaultLedProductId", "stripSuggestions", "preview", "appearance", "findIntervalSeconds", "palette", "backupRetention"]) &&
    s.version === 1 && integer(s.revision, 0, Number.MAX_SAFE_INTEGER) &&
    (s.defaultLedProductId === null || (typeof s.defaultLedProductId === "string" && s.defaultLedProductId.length > 0)) &&
    !!s.stripSuggestions && typeof s.stripSuggestions === "object" &&
    onlyKeys(s.stripSuggestions, ["ledCount", "gpio"]) && optionalInteger(s.stripSuggestions.ledCount, 1, 100000) &&
    optionalInteger(s.stripSuggestions.gpio, 0, 48) && !!s.preview && typeof s.preview === "object" &&
    onlyKeys(s.preview, ["hex", "brightness", "heldDimPercent"]) &&
    hex.test(s.preview.hex) && integer(s.preview.brightness, 1, 255) &&
    s.preview.heldDimPercent === 60 && (s.appearance === "dark" || s.appearance === "light") &&
    [0, 30, 60, 120].includes(s.findIntervalSeconds) &&
    Array.isArray(s.palette) && s.palette.length === 8 && s.palette.every((color) =>
      color && typeof color === "object" && onlyKeys(color, ["name", "hex"]) &&
      typeof color.name === "string" && color.name.trim().length > 0 &&
      color.name.length <= 32 && typeof color.hex === "string" && hex.test(color.hex)) &&
    !!s.backupRetention && typeof s.backupRetention === "object" &&
    onlyKeys(s.backupRetention, ["enabled", "limit"]) && typeof s.backupRetention.enabled === "boolean" &&
    integer(s.backupRetention.limit, 1, 100);
}
