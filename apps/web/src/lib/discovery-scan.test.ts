import { describe, expect, it, vi } from "vitest";
import {
  discoveryScanInFlight,
  runDiscoveryScan,
  shouldStartDiscoveryScan,
} from "./discovery-scan";

describe("background Find", () => {
  it("skips a scan while the tab is hidden or one is already running", () => {
    expect(shouldStartDiscoveryScan({ visibility: "visible", inFlight: false })).toBe(true);
    expect(shouldStartDiscoveryScan({ visibility: "hidden", inFlight: false })).toBe(false);
    expect(shouldStartDiscoveryScan({ visibility: "visible", inFlight: true })).toBe(false);
  });

  it("runs one POST and shares it with a second caller", async () => {
    let release: (response: Response) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);

    const first = runDiscoveryScan();
    const second = runDiscoveryScan();
    expect(discoveryScanInFlight()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = String((fetch.mock.calls as unknown[][])[0]?.[0]);
    expect(url).toContain("/api/discover");

    release(
      new Response(JSON.stringify({ candidates: [{ status: "found" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.candidates).toEqual(b.candidates);
    }
    expect(discoveryScanInFlight()).toBe(false);
  });
});
