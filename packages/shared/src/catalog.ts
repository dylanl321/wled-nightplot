import { listControllers } from "./controller/catalog.ts";
import { listDiscoveryMechanisms } from "./discovery/catalog.ts";
import { listStripPresets, listStrips } from "./strip/catalog.ts";

export const CURRENT_SLICE = "R6" as const;

export function catalogSnapshot() {
  return {
    slice: CURRENT_SLICE,
    controllers: listControllers(),
    strips: listStrips(),
    stripPresets: listStripPresets(),
    discovery: listDiscoveryMechanisms(),
  };
}

export type CatalogSnapshot = ReturnType<typeof catalogSnapshot>;
