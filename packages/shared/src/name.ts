import type { Light, LightNameSource } from "./lights.ts";

export type LightNameResolution = {
  name: string;
  nameSource: LightNameSource;
  staleInfoName: string | null;
  infoLagging: boolean;
};

/**
 * Prefer a confirmed `/json/cfg` display name over a lagging `/json/info` name.
 * Real WLED often keeps the old info name until reboot.
 */
export function resolveLightName(input: {
  infoName: string;
  cfgName?: string | null;
  existing?: Pick<Light, "name" | "nameSource" | "staleInfoName">;
}): LightNameResolution {
  const infoName = input.infoName.trim() || "WLED";
  const cfgName =
    typeof input.cfgName === "string" && input.cfgName.trim() ? input.cfgName.trim() : null;

  if (cfgName) {
    const lagging = cfgName !== infoName;
    return {
      name: cfgName,
      nameSource: lagging ? "cfg" : "info",
      staleInfoName: lagging ? infoName : null,
      infoLagging: lagging,
    };
  }

  const existing = input.existing;
  if (existing?.nameSource === "cfg" && existing.name.trim()) {
    const stored = existing.name.trim();
    if (infoName === stored) {
      return { name: infoName, nameSource: "info", staleInfoName: null, infoLagging: false };
    }
    const pending = existing.staleInfoName?.trim() || null;
    if (!pending || infoName === pending) {
      return {
        name: stored,
        nameSource: "cfg",
        staleInfoName: pending ?? infoName,
        infoLagging: true,
      };
    }
    return { name: infoName, nameSource: "info", staleInfoName: null, infoLagging: false };
  }

  return { name: infoName, nameSource: "info", staleInfoName: null, infoLagging: false };
}

export function applyResolvedName<T extends Light>(light: T, resolved: LightNameResolution): T {
  return {
    ...light,
    name: resolved.name,
    nameSource: resolved.nameSource,
    staleInfoName: resolved.staleInfoName,
  };
}
