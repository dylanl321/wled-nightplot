import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiscoverPanel } from "@/components/discover-panel";
import {
  ESPALEXA_PORT_WARNING,
  discoverRow,
} from "@/test/fixtures";

describe("DiscoverPanel portWarning", () => {
  it("shows Espalexa copy and the host:port hatch on a default-port reject", () => {
    render(
      <DiscoverPanel
        enrolled={[]}
        initialCandidates={[
          discoverRow({
            portWarning: ESPALEXA_PORT_WARNING,
          }),
        ]}
      />,
    );

    expect(screen.getByText("192.168.1.80")).toBeTruthy();
    expect(screen.queryByText("192.168.1.80:80")).toBeNull();
    expect(screen.getByText(ESPALEXA_PORT_WARNING)).toBeTruthy();
    expect(ESPALEXA_PORT_WARNING).toMatch(/:80/);
    expect(ESPALEXA_PORT_WARNING).toMatch(/Type host:port/);
    expect(ESPALEXA_PORT_WARNING).toMatch(/will not try another port/);
    expect(screen.getByRole("button", { name: "Type host:port" })).toBeTruthy();
  });

  it("fills Type an address from the hatch without guessing a port", () => {
    render(
      <DiscoverPanel
        enrolled={[]}
        initialCandidates={[
          discoverRow({
            portWarning: ESPALEXA_PORT_WARNING,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Type host:port" }));
    const field = screen.getByPlaceholderText("host or host:port");
    expect(field).toHaveProperty("value", "192.168.1.80:");
  });

  it("keeps a native WLED found card quiet when portWarning is absent", () => {
    render(
      <DiscoverPanel
        enrolled={[]}
        initialCandidates={[
          discoverRow({
            key: "192.168.1.72:80",
            hostname: "192.168.1.72",
            displayHost: "192.168.1.72",
            status: "found",
            reason: null,
            reasonCode: null,
            name: "Porch rail",
            ledCount: 60,
            firmware: "WLED 0.15.4",
            bead: "#ffa000",
            portWarning: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Porch rail")).toBeTruthy();
    expect(screen.queryByText(/Espalexa/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Type host:port" })).toBeNull();
  });

  it("shows the same copy on an answered Espalexa found card", () => {
    render(
      <DiscoverPanel
        enrolled={[]}
        initialCandidates={[
          discoverRow({
            status: "found",
            reason: null,
            reasonCode: null,
            name: "Hue-shaped",
            ledCount: 30,
            bead: "#ffa000",
            portWarning: ESPALEXA_PORT_WARNING,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Hue-shaped")).toBeTruthy();
    expect(screen.getByText(ESPALEXA_PORT_WARNING)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Type host:port" })).toBeTruthy();
  });
});
