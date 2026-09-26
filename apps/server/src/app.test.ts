import { describe, expect, it } from "vitest";
import { app } from "./app.ts";

describe("configure server", () => {
  it("reports health for R0", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      service: "nightplot-configure",
      slice: "R0",
    });
  });

  it("exposes catalogs with WLED and WS281x registered", async () => {
    const res = await app.request("/api/catalogs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      controllers: { id: string }[];
      strips: { id: string }[];
      discovery: { implementation: string }[];
    };
    expect(body.controllers[0]?.id).toBe("wled");
    expect(body.strips[0]?.id).toBe("ws281x");
    expect(body.discovery.every((row) => row.implementation === "placeholder")).toBe(
      true,
    );
  });

  it("returns no enrolled Lights", async () => {
    const res = await app.request("/api/lights");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lights: unknown[]; elements: unknown[] };
    expect(body.lights).toEqual([]);
    expect(body.elements).toEqual([]);
  });

  it("keeps Discover / Preview / Apply / All Off unwired", async () => {
    for (const path of ["/api/discover", "/api/preview", "/api/apply", "/api/all-off"]) {
      const res = await app.request(path, { method: "POST" });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("not_implemented");
      expect(body.message).toMatch(/Nothing was sent to hardware/);
    }
  });
});
