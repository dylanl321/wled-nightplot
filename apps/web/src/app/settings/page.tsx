import type { LedProduct, LightsPayload, NightplotSettings } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { NightplotSettingsPanel } from "@/components/nightplot-settings-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const result = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{ settings: NightplotSettings }>("/api/settings"),
    fetchJson<{ products: LedProduct[] }>("/api/led-products"),
  ]);
  if (result.some((item) => item.status === "rejected"))
    return <AppShell lightCount={0} nav="settings"><ServerDown detail="Could not load Settings." /></AppShell>;
  const [lights, settings, products] = result.map((item) => (item as PromiseFulfilledResult<unknown>).value) as
    [LightsPayload, { settings: NightplotSettings }, { products: LedProduct[] }];
  return <AppShell lights={lights.lights} lightCount={lights.lights.length} nav="settings" sessions={lights.sessions}>
    <NightplotSettingsPanel initial={settings.settings} products={products.products} lights={lights.lights} />
  </AppShell>;
}
