import type { LedProduct, LightsPayload } from "@nightplot/shared";

export type CatalogPageModel =
  | { kind: "server-down"; error?: string }
  | {
      kind: "ready";
      lights: LightsPayload;
      products: LedProduct[];
    }
  | {
      kind: "products-miss";
      lights: LightsPayload;
      error?: string;
    };

function settledMessage(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status !== "rejected") return undefined;
  return result.reason instanceof Error ? result.reason.message : "Unknown error";
}

/** Lights failure is ServerDown. Catalog-only failure keeps the enrolled list. */
export function catalogPageModel(
  lights: PromiseSettledResult<LightsPayload>,
  products: PromiseSettledResult<{ products: LedProduct[] }>,
): CatalogPageModel {
  if (lights.status === "rejected") {
    return { kind: "server-down", error: settledMessage(lights) };
  }

  if (products.status === "fulfilled") {
    return {
      kind: "ready",
      lights: lights.value,
      products: products.value.products ?? [],
    };
  }

  return {
    kind: "products-miss",
    lights: lights.value,
    error: settledMessage(products),
  };
}
