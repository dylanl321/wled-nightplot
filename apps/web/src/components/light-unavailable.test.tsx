import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/app-shell";
import { LightUnavailable } from "@/components/light-unavailable";
import { lightView } from "@/test/fixtures";

const LAST_COLOUR = "#ffa000";

describe("LightUnavailable detail miss", () => {
  it("keeps enrolled Lights and does not use ServerDown copy", () => {
    render(
      <AppShell
        lights={[
          lightView({
            name: "Garage",
            reachability: "no-answer",
            bead: "unknown",
            on: null,
            brightness: null,
          }),
        ]}
        lightCount={1}
        nav="light"
        activeLightId="light-garage"
      >
        <LightUnavailable kind="load-failed" detail="This Light failed" listed />
      </AppShell>,
    );

    expect(screen.getByText("This Light did not load")).toBeTruthy();
    expect(screen.getByText(/Enrolled Lights stay listed/)).toBeTruthy();
    expect(screen.getByText("This Light failed")).toBeTruthy();
    expect(screen.getByText("Garage")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Lights" })).toBeTruthy();

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/list is not loaded/);
    expect(body).not.toMatch(/Couldn’t reach the configure server/);

    const strip = screen.getByRole("img", { name: "LED strip" });
    expect(strip.innerHTML).not.toContain(LAST_COLOUR);
    expect(strip.innerHTML).toContain("#1d1d1f");
  });

  it("keeps the not-on-Lights copy when this address was never enrolled", () => {
    render(
      <AppShell
        lights={[lightView({ name: "Garage" })]}
        lightCount={1}
        nav="light"
      >
        <LightUnavailable kind="missing" detail="That Light is not on Lights" listed />
      </AppShell>,
    );

    expect(screen.getByText("That Light is not on Lights")).toBeTruthy();
    expect(screen.getByText(/never enrolled/)).toBeTruthy();
    expect(screen.getByText("Garage")).toBeTruthy();
    expect(screen.queryByText("This Light did not load")).toBeNull();
    expect(screen.getAllByText("That Light is not on Lights")).toHaveLength(1);

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/list is not loaded/);
  });
});
