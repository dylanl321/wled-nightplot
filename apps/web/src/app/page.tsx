import type { CatalogSnapshot, LightsPayload } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { LightsEmpty } from "@/components/lights-empty";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

export default async function LightsPage() {
  let lights: LightsPayload | null = null;
  let catalogs: CatalogSnapshot | null = null;
  let error: string | undefined;

  try {
    [lights, catalogs] = await Promise.all([
      fetchJson<LightsPayload>("/api/lights"),
      fetchJson<CatalogSnapshot>("/api/catalogs"),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown error";
  }

  if (!lights || !catalogs) {
    return (
      <AppShell lightCount={0} nav="lights">
        <ServerDown detail={error} />
      </AppShell>
    );
  }

  const firstController = catalogs.controllers[0];
  const firstStrip = catalogs.strips[0];

  return (
    <AppShell lightCount={lights.lights.length} nav="lights">
      <LightsEmpty />
      <p className="px-5 pb-6 text-[11px] tracking-[0.14em] text-quiet uppercase sm:px-8">
        configure · r0
        {firstController && firstStrip
          ? ` · ${firstController.chip} / ${firstStrip.chip} registered`
          : null}
      </p>
    </AppShell>
  );
}
