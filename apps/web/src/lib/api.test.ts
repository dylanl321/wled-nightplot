import { describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api";

describe("fetchJson failures", () => {
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
