import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightsHome } from "@/components/lights-home";
import {
  ESPALEXA_PORT_WARNING,
  discoverRow,
  isLightsListPath,
  lightView,
  requestPath,
} from "@/test/fixtures";

const LAST_COLOUR = "#ffa000";

function fetchSpy() {
  const fetch = vi.fn(async () => {
    throw new Error("Lights list must not probe.");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("LightsHome cached beads", () => {
  it("renders last-seen copy and grey beads — never a stored last colour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T20:00:00.000Z"));
    const fetch = fetchSpy();

    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            reachability: "no-answer",
            bead: "unknown",
            on: null,
            brightness: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("No answer · last seen 2 h ago")).toBeTruthy();
    const strip = screen.getByRole("img", { name: "Garage strip" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps cached Online status on unknown beads without probing the list", () => {
    const fetch = fetchSpy();

    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "unknown",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Online · on · 50%")).toBeTruthy();
    const strip = screen.getByRole("img", { name: "Garage strip" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(fetch).not.toHaveBeenCalled();
    expect(
      fetch.mock.calls.some((call) => isLightsListPath(requestPath(String(call[0])))),
    ).toBe(false);
  });

  it("shows Espalexa portWarning on the unenrolled tray", () => {
    render(
      <LightsHome
        lights={[]}
        unenrolled={[
          discoverRow({
            status: "found",
            reason: null,
            reasonCode: null,
            name: "Hue-shaped",
            portWarning: ESPALEXA_PORT_WARNING,
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("Hue-shaped is on this network but not added"),
    ).toBeTruthy();
    expect(screen.getByText("192.168.1.80")).toBeTruthy();
    expect(screen.getByText(ESPALEXA_PORT_WARNING)).toBeTruthy();
  });
});
