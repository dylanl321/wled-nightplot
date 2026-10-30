import type { Element } from "@nightplot/shared";

const PREFIX = "nightplot:segment-draft:v1:";

export type StoredDraft = { saved: Element[]; draft: Element[]; ledCount: number };

function validElements(value: unknown, lightId: string): value is Element[] {
  return Array.isArray(value) && value.length <= 4096 && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const el = item as Record<string, unknown>;
    const color = el.color;
    return typeof el.id === "string" && typeof el.label === "string" && el.lightId === lightId &&
      typeof el.start === "number" && Number.isSafeInteger(el.start) &&
      typeof el.stop === "number" && Number.isSafeInteger(el.stop) &&
      (color === undefined || (color !== null && typeof color === "object" &&
        typeof (color as Record<string, unknown>).hex === "string" &&
        typeof (color as Record<string, unknown>).white === "number" &&
        Number.isFinite((color as Record<string, number>).white)));
  });
}

export function sameSegments(left: readonly Element[], right: readonly Element[]): boolean {
  return left.length === right.length && left.every((el, index) => {
    const other = right[index];
    return other && el.id === other.id && el.lightId === other.lightId && el.label === other.label &&
      el.start === other.start && el.stop === other.stop &&
      el.color?.hex === other.color?.hex && el.color?.white === other.color?.white;
  });
}

export function readDraft(lightId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + lightId);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    if (typeof value.ledCount === "number" && Number.isSafeInteger(value.ledCount) && value.ledCount >= 0 &&
      validElements(value.saved, lightId) && validElements(value.draft, lightId) &&
      !sameSegments(value.saved, value.draft)) {
      return { saved: value.saved, draft: value.draft, ledCount: value.ledCount as number };
    }
  } catch { /* Private browsing, disabled storage, or an older/corrupt draft. */ }
  return null;
}

export function writeDraft(lightId: string, value: StoredDraft | null): boolean {
  try {
    if (value) window.localStorage.setItem(PREFIX + lightId, JSON.stringify(value));
    else window.localStorage.removeItem(PREFIX + lightId);
    return true;
  } catch { return false; }
}
