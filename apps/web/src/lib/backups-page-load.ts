import type { LightsPayload, NightplotBackupMeta } from "@nightplot/shared";

export type BackupsPageModel =
  | { kind: "server-down"; error?: string }
  | {
      kind: "ready";
      lights: LightsPayload;
      backups: NightplotBackupMeta[];
      skippedInvalid: number;
      restoreCaption?: string;
      controllerCaption?: string;
    }
  | {
      kind: "backups-miss";
      lights: LightsPayload;
      error?: string;
    };

function settledMessage(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status !== "rejected") return undefined;
  return result.reason instanceof Error ? result.reason.message : "Unknown error";
}

/** Lights failure is ServerDown. Backups-only failure keeps the enrolled list. */
export function backupsPageModel(
  lights: PromiseSettledResult<LightsPayload>,
  backups: PromiseSettledResult<{
    backups?: NightplotBackupMeta[];
    skippedInvalid?: number;
    restoreCaption?: string;
    controllerCaption?: string;
  }>,
): BackupsPageModel {
  if (lights.status === "rejected") {
    return { kind: "server-down", error: settledMessage(lights) };
  }
  if (backups.status === "fulfilled") {
    return {
      kind: "ready",
      lights: lights.value,
      backups: backups.value.backups ?? [],
      skippedInvalid: backups.value.skippedInvalid ?? 0,
      restoreCaption: backups.value.restoreCaption,
      controllerCaption: backups.value.controllerCaption,
    };
  }
  return {
    kind: "backups-miss",
    lights: lights.value,
    error: settledMessage(backups),
  };
}
