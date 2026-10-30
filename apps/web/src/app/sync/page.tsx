import type { LightsPayload } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { ServerDown } from "@/components/server-down";
import { SyncPanel } from "@/components/sync-panel";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  let lights: LightsPayload;
  try { lights = await fetchJson<LightsPayload>("/api/lights"); }
  catch { return <AppShell lightCount={0} nav="sync"><ServerDown detail="Could not load Lights." /></AppShell>; }
  return <AppShell lights={lights.lights} lightCount={lights.lights.length} nav="sync" sessions={lights.sessions}>
    <SyncPanel lights={lights.lights} />
  </AppShell>;
}
