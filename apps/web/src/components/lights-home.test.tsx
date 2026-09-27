import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightsHome } from "@/components/lights-home";
import {
  ESPALEXA_PORT_WARNING,
  discoverRow,
  lightView,
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
    const strip = screen.getByRole("img", { name: "Garage strip, RGB" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("paints RGBW as two dies and keeps unreachable beads grey", () => {
    const fetch = fetchSpy();
    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            name: "Porch",
            reachability: "no-answer",
            bead: "unknown",
            on: null,
            brightness: null,
            stripKind: "sk6812-rgbw",
            stripBead: "rgbw",
            stripChip: "SK6812 RGBW",
            rgbw: true,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/60 LEDs · RGBW · 1 Element/)).toBeTruthy();
    const strip = screen.getByRole("img", { name: "Porch strip, RGBW" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#141519");
    expect(strip.querySelectorAll("circle").length).toBeGreaterThan(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not say Online · off when on is missing — unknown-grey, not null-as-off", () => {
    const fetch = fetchSpy();

    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Online · unknown")).toBeTruthy();
    expect(screen.queryByText("Online · off")).toBeNull();
    const strip = screen.getByRole("img", { name: "Garage strip, RGB" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(strip.innerHTML).not.toContain("#141519");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still names known off", () => {
    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            reachability: "online",
            on: false,
            brightness: 0,
            bead: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Online · off")).toBeTruthy();
    const strip = screen.getByRole("img", { name: "Garage strip, RGB" });
    expect(strip.innerHTML).toContain("#141519");
    expect(strip.innerHTML).not.toContain("#1d1d1f");
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
    const strip = screen.getByRole("img", { name: "Garage strip, RGB" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(fetch).not.toHaveBeenCalled();
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
    expect(screen.getByText(/192\.168\.1\.80 · found via ssdp/)).toBeTruthy();
    expect(screen.queryByText(/192\.168\.1\.80:80/)).toBeNull();
    expect(screen.getByText(ESPALEXA_PORT_WARNING)).toBeTruthy();
  });
});
