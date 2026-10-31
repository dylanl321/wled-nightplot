import type { LightsPayload, YardCheckResult, YardUndoToken } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { YardPanel } from "@/components/yard-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function YardPage() {
  const [lights, check] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<YardCheckResult & { undo?: YardUndoToken | null }>("/api/yard-check"),
  ]);
  if (lights.status === "rejected") {
    return <AppShell lightCount={0} nav="yard"><ServerDown detail="Could not load Yard." /></AppShell>;
  }
  return (
    <AppShell lights={lights.value.lights} lightCount={lights.value.lights.length} nav="yard" sessions={lights.value.sessions}>
      <YardPanel
        lights={lights.value.lights}
        initial={check.status === "fulfilled" ? check.value : null}
      />
    </AppShell>
  );
}
