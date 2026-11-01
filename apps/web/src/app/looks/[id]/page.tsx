import type { LightsPayload } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { LookView } from "@/components/looks/look-view";
import type { LooksPayload } from "@/components/looks/use-looks";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import "@/components/looks/looks.css";

export const dynamic = "force-dynamic";

export default async function LookPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prop?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const result = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<LooksPayload>("/api/looks"),
  ]);
  if (result.some((item) => item.status === "rejected")) {
    return <AppShell lightCount={0} nav="looks"><ServerDown detail="Could not load this Look." /></AppShell>;
  }
  const [lights, looks] = result.map((item) => (item as PromiseFulfilledResult<unknown>).value) as [LightsPayload, LooksPayload];
  const roster = lights.lights.map((light) => ({ id: light.id, name: light.name, firmware: light.firmware, lastLookPush: light.lastLookPush ?? null }));
  return (
    <AppShell lights={lights.lights} lightCount={lights.lights.length} nav="looks" immersive>
      <LookView key={id} initial={looks} lights={roster} lookId={decodeURIComponent(id)} startProp={query.prop ?? null} />
    </AppShell>
  );
}
