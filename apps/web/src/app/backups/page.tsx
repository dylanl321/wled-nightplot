import type { BackupSummary, LightsPayload } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { BackupsPanel } from "@/components/backups-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const [lights, backups] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{ backups: BackupSummary[] }>("/api/backups"),
  ]);
  if (lights.status === "rejected" || backups.status === "rejected") {
    return <AppShell lightCount={0} nav="backups"><ServerDown detail="Could not load Backups." /></AppShell>;
  }
  return <AppShell lights={lights.value.lights} lightCount={lights.value.lights.length}
    nav="backups" sessions={lights.value.sessions}>
    <BackupsPanel initial={backups.value.backups} lights={lights.value.lights} />
  </AppShell>;
}
