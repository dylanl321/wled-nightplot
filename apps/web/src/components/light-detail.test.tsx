import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightDetail } from "@/components/light-detail";
import {
  isLightsListPath,
  isOneLightProbe,
  lightDetail,
  lightView,
  requestPath,
} from "@/test/fixtures";

describe("LightDetail Refresh", () => {
  it("Refresh probes this Light only — never the enrolled list", async () => {
    const initial = lightDetail();
    const next = lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#7ee0d0",
      }),
      snapshotAt: "2026-09-26T20:00:00.000Z",
    });

    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(String(input));
      if (isOneLightProbe(path, initial.light.id)) {
        return new Response(JSON.stringify(next), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<LightDetail initial={initial} mode="inspect" />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Online")).toBeTruthy();

    const paths = fetch.mock.calls.map((call) => requestPath(String(call[0])));
    expect(paths.some((path) => isOneLightProbe(path, initial.light.id))).toBe(true);
    expect(paths.some(isLightsListPath)).toBe(false);
  });
});
