import type { ActivityEntry } from "./activity.ts";
import type { LedProduct } from "./strip/products.ts";
import type { Element, Light } from "./lights.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

export type BackupReason = "manual" | "pre-apply" | "pre-safe" | "pre-provision" |
  "pre-delete" | "pre-replacement" | "pre-catalog" | "pre-restore";

export type BackupData = {
  lights: Light[];
  elements: Element[];
  products: LedProduct[];
  activity: ActivityEntry[];
};

/** Reference-only. Never sufficient to replay a full WLED configuration. */
export type ControllerReference = {
  hostKey: string;
  mac: string | null;
  ledCount: number;
  reported: Pick<WledSnapshot, "on" | "brightness" | "segments" | "segmentColor">;
  safeSettings?: Record<string, unknown>;
  stripSettings?: Record<string, unknown>;
};

export type BackupDocument = {
  version: 1;
  id: string;
  at: string;
  reason: BackupReason;
  lightId: string | null;
  lightName: string | null;
  data: BackupData;
  controller: ControllerReference | null;
};

export type BackupSummary = Pick<BackupDocument, "id" | "at" | "reason" | "lightId" | "lightName"> & {
  lightCount: number;
  segmentCount: number;
  productCount: number;
  hasControllerReference: boolean;
};
