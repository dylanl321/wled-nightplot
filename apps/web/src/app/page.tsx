import type { LightsPayload } from "@nightplot/shared";

export const dynamic = "force-dynamic";
import { AppShell } from "@/components/app-shell";
import { LightsHome } from "@/components/lights-home";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

export default async function LightsPage() {
  let lights: LightsPayload | null = null;
  let error: string | undefined;

  try {
    lights = await fetchJson<LightsPayload>("/api/lights");
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown error";
  }

  if (!lights) {
    return (
      <AppShell lightCount={0} nav="lights">
        <ServerDown detail={error} />
      </AppShell>
    );
  }

  return (
    <AppShell
      lights={lights.lights}
      lightCount={lights.lights.length}
      nav="lights"
      sessions={lights.sessions}
    >
      <LightsHome lights={lights.lights} unenrolled={lights.unenrolled} />
      <p className="px-5 pb-6 text-[11px] tracking-[0.14em] text-quiet uppercase sm:px-8">
        configure · r3 · test live
      </p>
    </AppShell>
  );
}
