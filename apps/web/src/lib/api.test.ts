import { describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api";

describe("fetchJson failures", () => {
  it("preserves an explicit no-write refusal and its reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "pixel-preview-frozen", message: "Frozen LEDs. Nothing was sent.", sent: false,
    }), { status: 422 })));
    await expect(fetchJson("/api/lights/light-1/preview")).rejects.toMatchObject({
      status: 422, code: "pixel-preview-frozen", message: "Frozen LEDs. Nothing was sent.", sent: false,
    });
  });

  it("attaches HTTP status so Inspect can tell a 404 from a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ message: "That Light is not on Lights." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(fetchJson("/api/lights/missing")).rejects.toMatchObject({
      message: "That Light is not on Lights.",
      status: 404,
    });
  });
});
