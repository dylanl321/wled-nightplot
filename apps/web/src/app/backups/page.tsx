import type { LightsPayload, NightplotBackupMeta } from "@nightplot/shared";

export const dynamic = "force-dynamic";
import { AppShell } from "@/components/app-shell";
import { BackupsPanel } from "@/components/backups-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import { backupsPageModel } from "@/lib/backups-page-load";

export default async function BackupsPage() {
  const [lightsResult, backupsResult] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{
      backups: NightplotBackupMeta[];
      skippedInvalid?: number;
      restoreCaption?: string;
      controllerCaption?: string;
    }>("/api/backups"),
  ]);
  const model = backupsPageModel(lightsResult, backupsResult);

  if (model.kind === "server-down") {
    return (
      <AppShell lightCount={0} nav="backups">
        <ServerDown detail={model.error} />
      </AppShell>
    );
  }

  return (
    <AppShell
      lights={model.lights.lights}
      lightCount={model.lights.lights.length}
      nav="backups"
      sessions={model.lights.sessions}
    >
      <BackupsPanel
        initialBackups={model.kind === "ready" ? model.backups : []}
        skippedInvalid={model.kind === "ready" ? model.skippedInvalid : 0}
        restoreCaption={model.kind === "ready" ? model.restoreCaption : undefined}
        controllerCaption={model.kind === "ready" ? model.controllerCaption : undefined}
        loadError={model.kind === "backups-miss" ? model.error : undefined}
      />
    </AppShell>
  );
}
