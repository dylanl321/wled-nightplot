import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoverPanel } from "@/components/discover-panel";
import {
  ESPALEXA_PORT_WARNING,
  discoverRow,
  lightView,
} from "@/test/fixtures";

describe("DiscoverPanel Find load miss", () => {
  it("shows enrolled Lights and Find failure without ServerDown copy", () => {
    render(
      <DiscoverPanel
        enrolled={[lightView({ name: "Garage" })]}
        initialCandidates={[]}
        findError="Find session failed"
      />,
    );

    expect(screen.getByText("Find did not load")).toBeTruthy();
    expect(
      screen.getByText(/Enrolled Lights stay listed/),
    ).toBeTruthy();
    expect(screen.getByText("Find session failed")).toBeTruthy();
    expect(screen.getByText(/1 Light already on/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find Lights" })).toBeTruthy();

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/list is not loaded/);
    expect(body).not.toMatch(/Couldn’t reach the configure server/);
  });

  it("clears the Find load miss after Find Lights retries", async () => {
    const fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(
      <DiscoverPanel
        enrolled={[lightView()]}
        initialCandidates={[]}
        findError="Find session failed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Find Lights" }));
    expect(await screen.findByRole("button", { name: "Find Lights" })).toBeTruthy();
    expect(screen.queryByText("Find did not load")).toBeNull();
    expect(screen.getByText(/1 Light already on/)).toBeTruthy();
    expect(fetch).toHaveBeenCalled();
  });
});

describe("DiscoverPanel Find copy", () => {
  it("names the four-at-a-time probe bound and the 3 s dead-host stop", () => {
    render(<DiscoverPanel enrolled={[]} initialCandidates={[]} />);
    expect(screen.getByText(/up to four collected hosts at a time/)).toBeTruthy();
    expect(screen.getByText(/dead probe stops/)).toBeTruthy();
    expect(screen.getByText(/3 s/)).toBeTruthy();
  });

  it("shows generic probe-failed reason without inventing a 3 s wait", () => {
    render(
      <DiscoverPanel
        enrolled={[]}
        initialCandidates={[
          discoverRow({
            key: "192.168.1.90:80",
            hostname: "192.168.1.90",
            displayHost: "192.168.1.90",
            status: "rejected",
            reason: "probe failed.",
            reasonCode: "probe-failed",
          }),
        ]}
      />,
    );
    expect(screen.getByText("192.168.1.90")).toBeTruthy();
    expect(screen.getByText("probe failed.")).toBeTruthy();
    expect(screen.getAllByText("Probe failed").length).toBeGreaterThan(0);
    expect(screen.queryByText(/didn’t return a snapshot in 3 s/)).toBeNull();
  });

  it("shows elapsed probe-failed copy when the server measured a wait", () => {
    render(
      <DiscoverPanel
        enrolled={[]}
        initialCandidates={[
          discoverRow({
            key: "192.168.1.90:80",
            hostname: "192.168.1.90",
            displayHost: "192.168.1.90",
            status: "rejected",
            reason: "192.168.1.90 didn’t return a snapshot in 2 s.",
            reasonCode: "probe-failed",
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("192.168.1.90 didn’t return a snapshot in 2 s."),
    ).toBeTruthy();
  });
});

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
