import type { LedProduct, LightsPayload } from "@nightplot/shared";

export const dynamic = "force-dynamic";
import { AppShell } from "@/components/app-shell";
import { LedProductsPanel } from "@/components/led-products-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import { catalogPageModel } from "@/lib/catalog-page-load";

export default async function LedProductsPage() {
  const [lightsResult, productsResult] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{ products: LedProduct[] }>("/api/led-products"),
  ]);
  const model = catalogPageModel(lightsResult, productsResult);

  if (model.kind === "server-down") {
    return (
      <AppShell lightCount={0} nav="catalog">
        <ServerDown detail={model.error} />
      </AppShell>
    );
  }

  return (
    <AppShell
      lights={model.lights.lights}
      lightCount={model.lights.lights.length}
      nav="catalog"
      sessions={model.lights.sessions}
    >
      <LedProductsPanel
        initialProducts={model.kind === "ready" ? model.products : []}
        loadError={model.kind === "products-miss" ? model.error : undefined}
      />
    </AppShell>
  );
}
