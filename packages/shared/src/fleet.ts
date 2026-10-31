/** Shared fleet-setup result shapes. One dead controller never invents success for the others. */

export const FLEET_ENROLL_CONCURRENCY = 4;
export const FLEET_PROFILE_CONCURRENCY = 4;
export const FLEET_LOOK_CONCURRENCY = 4;
export const FLEET_YARD_CONCURRENCY = 4;

export const FLEET_BULK_CAPTION =
  "Each controller is listed by what happened. One failure does not stop the rest. Automatic backup before a lasting write; Undo is that backup, not a confirm step. Not Hardware Done.";

export type BulkEnrollStatus = "added" | "already-enrolled" | "failed";

export type BulkEnrollRow = {
  host: string;
  status: BulkEnrollStatus;
  reason?: string;
  lightId?: string;
  name?: string;
};

export type BulkEnrollResult = {
  results: BulkEnrollRow[];
  caption: string;
};

export type SetupApplyStatus = "applied" | "failed";

export type SetupApplyRow = {
  lightId: string;
  name: string;
  status: SetupApplyStatus;
  reason?: string;
  backupId?: string;
};

export type SetupApplyResult = {
  results: SetupApplyRow[];
  backupIds: string[];
  caption: string;
};

export function parseHostList(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { hosts?: unknown }).hosts;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const hosts = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return hosts.length > 0 ? [...new Set(hosts)] : null;
}

export function parseLightIdList(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { lightIds?: unknown }).lightIds;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

export function fleetEnrollSummary(rows: BulkEnrollRow[]): string {
  const added = rows.filter((row) => row.status === "added").length;
  const already = rows.filter((row) => row.status === "already-enrolled").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (already) parts.push(`${already} already enrolled`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ") || "Nothing to add.";
}

export function fleetApplySummary(rows: SetupApplyRow[]): string {
  const applied = rows.filter((row) => row.status === "applied").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  if (applied && !failed) return `Applied on ${applied} Light${applied === 1 ? "" : "s"}.`;
  if (!applied && failed) return `Nothing applied. ${failed} failed.`;
  return `Applied on ${applied}. ${failed} failed.`;
}
