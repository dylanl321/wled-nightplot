import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Light } from "@nightplot/shared";
import { FileLedProductsStore } from "./led-products-store.ts";
import { FileLightsStore } from "./lights-store.ts";
import { FileSettingsStore } from "./settings-store.ts";
import { StoreUnreadableError } from "./store-error.ts";

const light = { id: "a", name: "Desk", hostname: "10.0.0.2", port: 80, hostKey: "10.0.0.2:80",
  ledCount: 60, mac: null } as unknown as Light;

function file(name: string, body: string) {
  const path = join(mkdtempSync(join(tmpdir(), "nightplot-store-")), name);
  writeFileSync(path, body);
  return path;
}

describe("unreadable stores are not empty", () => {
  it("Lights: a corrupt file throws on read and is never overwritten", () => {
    const path = file("lights.json", "{ not json");
    const store = new FileLightsStore(path);
    expect(() => store.load()).toThrow(StoreUnreadableError);
    expect(() => store.upsert(light)).toThrow(/Nothing was changed/);
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });

  it("Lights: a write refuses when Segment rows could not be parsed, instead of dropping them", () => {
    const path = file("lights.json", JSON.stringify({ version: 1, lights: [light],
      elements: [{ id: "e", lightId: "a", label: "Odd", start: "0", stop: 4 }] }));
    const store = new FileLightsStore(path);
    expect(store.load()).toHaveLength(1);
    expect(() => store.replace({ ...light, name: "Renamed" })).toThrow(/1 Segment rows/);
  });

  it("Lights: a missing file is a known empty store, and replaced files leave a last-good copy", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nightplot-store-")), "lights.json");
    const store = new FileLightsStore(path);
    expect(store.load()).toEqual([]);
    store.upsert(light);
    expect(existsSync(`${path}.last-good`)).toBe(false);
    store.replace({ ...light, name: "Renamed" });
    expect(JSON.parse(readFileSync(`${path}.last-good`, "utf8")).lights[0].name).toBe("Desk");
  });

  it("LED products: a corrupt catalog is not reseeded over", () => {
    const path = file("led-products.json", JSON.stringify({ version: 1, products: [{ id: "x" }] }));
    expect(() => new FileLedProductsStore(path).list()).toThrow(/1 products Nightplot does not understand/);
    expect(JSON.parse(readFileSync(path, "utf8")).products).toEqual([{ id: "x" }]);
  });

  it("Settings: a corrupt file throws the shared error", () => {
    expect(() => new FileSettingsStore(file("settings.json", "[]")).read()).toThrow(StoreUnreadableError);
  });
});
