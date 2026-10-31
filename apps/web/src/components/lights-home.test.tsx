import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("shows a ticking last-answer age even on an Online cached Light, without probing", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-26T18:00:12.000Z"));
      const fetch = fetchSpy();
      render(<LightsHome unenrolled={[]} lights={[lightView({ reachability: "online", on: true,
        lastSeenAt: "2026-09-26T18:00:00.000Z" })]} />);
      expect(screen.getByText("Answered 12s ago")).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(screen.getByText("Answered 17s ago")).toBeTruthy();
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("does not invent an answer when lastSeenAt is missing", () => {
    const fetch = fetchSpy();
    render(<LightsHome unenrolled={[]} lights={[lightView({ reachability: "online", lastSeenAt: null })]} />);
    expect(screen.getByText("Answer time unknown")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ends a Lights-card Blink after the pulse instead of leaving the Light changed", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({
        ok: true, status: 200, json: async () => ({}),
      }));
      vi.stubGlobal("fetch", fetch);
      render(<LightsHome unenrolled={[]} lights={[lightView({ reachability: "online", on: true })]} />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Blink" })); });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/blink$/);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(fetch.mock.calls[1]?.[0])).toMatch(/\/blink\/end$/);
      expect(screen.getByRole("button", { name: "Blink" }).hasAttribute("disabled")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

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

    expect(screen.getByText(/last seen 2 h ago/)).toBeTruthy();
    expect(screen.getByText(/shown grey, not its last colour/)).toBeTruthy();
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

    expect(screen.getByText(/60 LEDs · SK6812 RGBW · 192\.168\.1\.40/)).toBeTruthy();
    const strip = screen.getByRole("img", { name: "Porch strip, RGBW" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#141519");
    expect(strip.querySelectorAll("circle").length).toBeGreaterThan(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a calculated length beside the LED count when the recipe has a pitch", () => {
    const fetch = fetchSpy();
    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            spacingMm: 16.67,
            spacingKind: "pitch",
            reachability: "online",
            on: true,
            bead: "#7ee0d0",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/60 LEDs · 1 m · WS281x RGB · 192\.168\.1\.40/)).toBeTruthy();
    expect(screen.getByText("Calculated from the recipe and the node count.")).toBeTruthy();
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

    expect(screen.getByText("Power unknown")).toBeTruthy();
    expect(screen.queryByText("Off")).toBeNull();
    const strip = screen.getByRole("img", { name: "Garage strip, RGB" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(strip.innerHTML).not.toContain("#141519");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says segments unknown when segmentCount is missing — not 0 segments", () => {
    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            reachability: "online",
            on: null,
            brightness: null,
            bead: "unknown",
            segmentCount: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/not read yet/i)).toBeTruthy();
    expect(screen.queryByText(/0 segments/)).toBeNull();
  });

  it("still names a known empty segment list", () => {
    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({
            reachability: "online",
            on: true,
            brightness: 128,
            bead: "#ffa000",
            segmentCount: 0,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/0 segments/)).toBeTruthy();
    expect(screen.queryByText(/segments unknown/i)).toBeNull();
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

    expect(screen.getByText("Off")).toBeTruthy();
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

    expect(screen.getByText("On · 50%")).toBeTruthy();
    const strip = screen.getByRole("img", { name: "Garage strip, RGB" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not probe setup profiles until the saved-profile control is used", () => {
    const fetch = fetchSpy();
    render(
      <LightsHome
        unenrolled={[]}
        lights={[lightView(), lightView({ id: "light-porch", name: "Porch", displayHost: "192.168.1.41" })]}
      />,
    );
    expect(screen.getByText("Select Lights to apply a setup profile.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply setup profile" }).hasAttribute("disabled")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts Apply setup profile for the selected Lights and lists per-Light results", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/lights/setup-profile") && init?.method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { lightId: "light-garage", name: "Garage", status: "applied" },
              { lightId: "light-porch", name: "Porch", status: "failed", reason: "This Light hasn’t answered." },
            ],
            message: "Applied on 1. 1 failed.",
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    render(
      <LightsHome
        unenrolled={[]}
        lights={[
          lightView({ reachability: "online", on: true }),
          lightView({
            id: "light-porch",
            name: "Porch",
            displayHost: "192.168.1.41",
            hostKey: "192.168.1.41:80",
            reachability: "online",
            on: true,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Garage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Porch" }));
    fireEvent.change(screen.getByPlaceholderText("yard-{nn}"), { target: { value: "yard-{nn}" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply setup profile" }));
    });

    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/api\/lights\/setup-profile$/);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      lightIds: string[];
      profile: { namePattern?: string; outputIndex?: number | null };
    };
    expect(body.lightIds).toEqual(["light-garage", "light-porch"]);
    expect(body.profile.namePattern).toBe("yard-{nn}");
    expect(body.profile.outputIndex).toBeNull();
    expect(screen.getByText("Garage · Applied")).toBeTruthy();
    expect(screen.getByText("Porch · This Light hasn’t answered.")).toBeTruthy();
  });

  it("posts a chosen output index with Apply setup profile", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/lights/setup-profile") && init?.method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ lightId: "light-garage", name: "Garage", status: "applied" }],
            message: "Applied on 1.",
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    render(
      <LightsHome unenrolled={[]} lights={[lightView({ reachability: "online", on: true })]} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Garage" }));
    fireEvent.change(screen.getByLabelText("Setup profile output"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("yard-{nn}"), { target: { value: "yard-{nn}" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply setup profile" }));
    });

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      profile: { outputIndex?: number | null };
    };
    expect(body.profile.outputIndex).toBe(1);
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

    expect(screen.getByText(/WLED · 192\.168\.1\.80/)).toBeTruthy();
    expect(screen.queryByText(/192\.168\.1\.80:80/)).toBeNull();
    expect(screen.getByText(ESPALEXA_PORT_WARNING)).toBeTruthy();
  });
});
