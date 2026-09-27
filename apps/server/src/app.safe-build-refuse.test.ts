import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileLedProductsStore } from "./store/led-products-store.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import type { ProbeFn } from "./wled/client.ts";
import type { ReadLiveFn, WriteStateFn } from "./wled/live.ts";

const BUILD_REFUSE = "This firmware’s config isn’t a shape we write. Nothing was sent.";

const buildSafeWrite = vi.hoisted(() =>
  vi.fn(() => ({ ok: false as const, message: BUILD_REFUSE })),
);

vi.mock("@nightplot/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nightplot/shared")>();
  return {
    ...actual,
    buildSafeWrite: () => buildSafeWrite(),
  };
});

const { createApp } = await import("./app.ts");

describe("safe buildSafeWrite refuse body", () => {
  it("buildSafeWrite refuse 422 includes safeWrite — not notice-only", async () => {
    const snapshot = {
      name: "WLED",
      firmware: "WLED 0.15.4",
      mac: "e8:9f:6d:7f:2a:04",
      ledCount: 60,
      rgbw: false,
      on: true,
      brightness: 128,
      segmentColor: "#ffa000",
      segments: [{ start: 0, stop: 60 }],
    };
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const products = new FileLedProductsStore(join(dir, "led-products.json"));
    const cfg = {
      id: { name: "WLED" },
      def: { on: true, bri: 128, ps: 0 },
      light: { tr: { dur: 7 } },
      hw: { led: { maxpwr: 850 } },
    };
    let wrote = false;
    const write: WriteStateFn = async () => true;
    const readLive: ReadLiveFn = async () => ({ source: "fixture", leds: [] });
    const probe: ProbeFn = async () => ({ kind: "found", snapshot });
    const app = createApp({
      store,
      products,
      probe,
      write,
      readLive,
      readCfg: async () => structuredClone(cfg),
      writeCfg: async () => {
        wrote = true;
        return true;
      },
      collect: async () => [],
    });

    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    expect(enroll.status).toBe(201);
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;

    buildSafeWrite.mockClear();
    const res = await app.request(`/api/lights/${id}/safe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { displayName: "Porch rail" } }),
    });
    expect(res.status).toBe(422);
    expect(buildSafeWrite).toHaveBeenCalled();
    const body = (await res.json()) as {
      error: string;
      message: string;
      safeWrite?: {
        status: string;
        matched: boolean;
        sent: { displayName: string };
        message: string;
      };
    };
    expect(body.error).toBe("refused");
    expect(body.message).toBe(BUILD_REFUSE);
    expect(body.safeWrite).toEqual(
      expect.objectContaining({
        status: "refused",
        matched: false,
        sent: { displayName: "Porch rail" },
        message: BUILD_REFUSE,
      }),
    );
    expect(wrote).toBe(false);
  });
});
