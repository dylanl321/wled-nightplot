import { baseFirmwareVersion, isSupportedProvisionFirmware } from "../provision.ts";

export type WledHealth = {
  uptimeSeconds: number | null;
  wifiSignalPercent: number | null;
  wifiRssiDbm: number | null;
  freeHeapBytes: number | null;
  compatibilityNotice: string | null;
};

/** /json/info fields are optional across WLED builds; never turn missing data into zero. */
export function parseWledHealth(info: Record<string, unknown>, firmware: string): WledHealth {
  const wifi = record(info.wifi);
  const version = baseFirmwareVersion(firmware);
  const parts = version?.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  const old = parts && (parts[0]! < 0 || (parts[0] === 0 && parts[1]! < 14));
  const compatibilityNotice = old
    ? "This WLED version predates Nightplot’s verified Strip provision firmware (0.14.0+). Strip Apply is refused; review an upgrade on the controller."
    : !isSupportedProvisionFirmware(firmware)
      ? "This firmware is not in Nightplot’s verified Strip provision table. Strip Apply may be refused; no compatibility is assumed."
      : null;
  return {
    uptimeSeconds: unsigned(info.uptime),
    wifiSignalPercent: bounded(wifi?.signal, 0, 100),
    wifiRssiDbm: bounded(wifi?.rssi, -130, 0),
    freeHeapBytes: unsigned(info.freeheap),
    compatibilityNotice,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function bounded(value: unknown, low: number, high: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high ? value : null;
}
function unsigned(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
