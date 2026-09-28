import type { LedProduct, LightsPayload } from "@nightplot/shared";
import { seedLedProductsFromPresets } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { catalogPageModel } from "@/lib/catalog-page-load";
import { lightView } from "@/test/fixtures";

function lightsPayload(lights = [lightView()]): LightsPayload {
  return { lights, elements: [], unenrolled: [] };
}

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(message: string): PromiseRejectedResult {
  return { status: "rejected", reason: new Error(message) };
}

const catalog = { products: seedLedProductsFromPresets() satisfies LedProduct[] };

describe("catalogPageModel", () => {
  it("uses ServerDown when Lights fail even if the catalog answered", () => {
    const model = catalogPageModel(rejected("Lights list failed"), fulfilled(catalog));
    expect(model).toEqual({
      kind: "server-down",
      error: "Lights list failed",
    });
  });

  it("uses ServerDown when both loads fail, naming the Lights error", () => {
    const model = catalogPageModel(
      rejected("Couldn’t reach the configure server"),
      rejected("LED products failed"),
    );
    expect(model.kind).toBe("server-down");
    if (model.kind !== "server-down") return;
    expect(model.error).toBe("Couldn’t reach the configure server");
  });

  it("keeps enrolled Lights when the catalog alone fails", () => {
    const lights = lightsPayload();
    const model = catalogPageModel(fulfilled(lights), rejected("LED products failed"));
    expect(model).toEqual({
      kind: "products-miss",
      lights,
      error: "LED products failed",
    });
  });

  it("returns catalog rows when both loads succeed", () => {
    const lights = lightsPayload();
    const model = catalogPageModel(fulfilled(lights), fulfilled(catalog));
    expect(model).toEqual({
      kind: "ready",
      lights,
      products: catalog.products,
    });
  });
});
