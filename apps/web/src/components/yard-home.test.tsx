import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { YardHome } from "./yard-home";

describe("Your yard", () => {
  it("shows one next step and New prop when nothing is designed", () => {
    render(
      <YardHome
        props={[]}
        attachments={[]}
        lights={[]}
        looksReady={false}
        yardClear={false}
        looksKnown
        yardKnown
      />,
    );
    expect(screen.getByRole("heading", { name: "Your yard" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "New prop" })).toHaveLength(1);
    expect(screen.getAllByText("Next")).toHaveLength(1);
    expect(screen.getAllByText("Not yet").length).toBeGreaterThan(0);
    expect(screen.getByText("No props yet. A prop is a shape — a roofline, a window, an arch — and it does not need a controller.")).toBeTruthy();
  });

  it("lists an unattached prop with its light count", () => {
    render(
      <YardHome
        props={[{
          id: "roof",
          label: "Front roof",
          kind: "roofline",
          elementIds: [],
          design: {
            unit: "ft",
            pitchMm: 100,
            ledProductId: null,
            measurements: { shape: "roofline", length: 40 },
            ledCount: 122,
            edges: [],
          },
        }]}
        attachments={[]}
        lights={[]}
        looksReady={false}
        yardClear={false}
        looksKnown
        yardKnown
      />,
    );
    expect(screen.getByText("Front roof")).toBeTruthy();
    expect(screen.getByText("122 lights")).toBeTruthy();
    expect(screen.getByText("Not attached")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Attach" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Yard drawing" })).toBeTruthy();
    expect(screen.getByText(/Drag a prop to where it sits in the yard/)).toBeTruthy();
    const layout = document.querySelector("[data-yard-layout='split']");
    expect(layout?.className).toContain("lg:grid-cols-[380px_minmax(0,1fr)]");
    expect(layout?.querySelector("[aria-label='Yard drawing']")).toBeTruthy();
  });

  it("has no yard drawing until there is a prop", () => {
    render(<YardHome props={[]} attachments={[]} lights={[]} looksReady={false} yardClear={false} looksKnown yardKnown />);
    expect(screen.queryByRole("region", { name: "Yard drawing" })).toBeNull();
    expect(document.querySelector("[data-yard-layout='stack']")).toBeTruthy();
  });
});
