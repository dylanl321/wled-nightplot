import type { LightsPayload } from "@nightplot/shared";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { LooksPage as LooksScreen } from "@/components/looks/looks-page";
import type { LooksPayload } from "@/components/looks/use-looks";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import "@/components/looks/looks.css";

export const dynamic = "force-dynamic";

export default async function LooksPage() {
  const result = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<LooksPayload>("/api/looks"),
  ]);
  if (result.some((item) => item.status === "rejected")) {
    return <AppShell lightCount={0} nav="looks"><ServerDown detail="Could not load Looks." /></AppShell>;
  }
  const [lights, looks] = result.map((item) => (item as PromiseFulfilledResult<unknown>).value) as [LightsPayload, LooksPayload];
  const roster = lights.lights.map((light) => ({ id: light.id, name: light.name, firmware: light.firmware, lastLookPush: light.lastLookPush ?? null }));
  return (
    <AppShell lights={lights.lights} lightCount={lights.lights.length} nav="looks" sessions={lights.sessions}>
      <Suspense><LooksScreen initial={looks} lights={roster} /></Suspense>
    </AppShell>
  );
}
