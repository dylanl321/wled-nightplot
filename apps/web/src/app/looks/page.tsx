import type { LightsPayload } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { LooksPanel, type LooksPayload } from "@/components/looks-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

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
  return (
    <AppShell lights={lights.lights} lightCount={lights.lights.length} nav="looks" sessions={lights.sessions}>
      <LooksPanel lights={lights.lights} initial={looks} />
    </AppShell>
  );
}
