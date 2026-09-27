import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedLedProductsFromPresets } from "@nightplot/shared";
import { FileLedProductsStore } from "./led-products-store.ts";

describe("FileLedProductsStore", () => {
  it("seeds from strip presets on first boot and round-trips a create", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-led-"));
    const file = join(dir, "led-products.json");
    const first = new FileLedProductsStore(file);
    const seeded = first.list();
    expect(seeded).toEqual(seedLedProductsFromPresets());
    expect(seeded.length).toBeGreaterThanOrEqual(2);

    const raw = JSON.parse(readFileSync(file, "utf8")) as { version: number; products: unknown[] };
    expect(raw.version).toBe(1);
    expect(raw.products).toHaveLength(seeded.length);

    const created = first.create({
      id: "eave-cob",
      label: "Eave COB",
      notes: "Operator SKU. Not written to WLED.",
      formFactor: "cob",
      driverId: "ws281x",
      defaultLength: 120,
      defaultGpio: 16,
    });

    const restarted = new FileLedProductsStore(file);
    const again = restarted.list();
    expect(again).toHaveLength(seeded.length + 1);
    expect(restarted.findById(created.id)).toEqual(created);
    expect(again.slice(0, seeded.length)).toEqual(seeded);
  });

  it("does not re-seed when the file already has products", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-led-"));
    const file = join(dir, "led-products.json");
    const store = new FileLedProductsStore(file);
    store.list();
    store.create({
      id: "only-this",
      label: "Only this",
      notes: "",
      formFactor: "diffused",
      driverId: "ws281x",
    });

    const next = new FileLedProductsStore(file);
    const ids = next.list().map((row) => row.id);
    expect(ids).toContain("only-this");
    expect(ids.filter((id) => id === "only-this")).toHaveLength(1);
  });
});
