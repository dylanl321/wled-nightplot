import { ledProductSpacing, type LedProduct, type LightsPayload } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { PropWizard, type SpacingChoice } from "@/components/props/prop-wizard";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function NewPropPage() {
  const [lightsResult, productsResult] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{ products: LedProduct[] }>("/api/led-products"),
  ]);
  if (lightsResult.status === "rejected") {
    return <AppShell lightCount={0} nav="lights"><ServerDown detail="Could not open New prop." /></AppShell>;
  }
  const products: SpacingChoice[] = productsResult.status === "fulfilled"
    ? productsResult.value.products.flatMap((product) => {
      const spacing = ledProductSpacing(product);
      if (!spacing || !(spacing.mm > 0)) return [];
      return [{ id: product.id, name: product.label, pitchMm: spacing.mm }];
    })
    : [];
  return (
    <AppShell immersive lights={lightsResult.value.lights} lightCount={lightsResult.value.lights.length} nav="lights" sessions={lightsResult.value.sessions}>
      <PropWizard products={products} />
    </AppShell>
  );
}
