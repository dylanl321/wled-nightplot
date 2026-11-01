import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { deleteRun, layoutFromMeasurements, layoutStrings } from "@nightplot/shared";
import { YardHome } from "./yard-home";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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
  it("says a Mini tree whose runs changed is a drawn shape", () => {
    const tree = layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "tree", params: { height: 2, base: 2 } })!;
    const layout = deleteRun(tree, layoutStrings(tree)[0]!.run[1]!.id);
    render(
      <YardHome
        props={[{
          id: "x",
          label: "X",
          kind: "tree",
          elementIds: [],
          layout,
          design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: { shape: "tree", height: 2, base: 2 }, ledCount: 22, edges: [] },
        }]}
        attachments={[]}
        lights={[]}
        looksReady={false}
        yardClear={false}
        looksKnown
        yardKnown
      />,
    );
    expect(screen.getByText("Drawn shape · started as Mini tree")).toBeTruthy();
  });

  it("switches between the drawing and the street", () => {
    render(
      <YardHome
        props={[{ id: "roof", label: "Front roof", kind: "roofline", elementIds: [], lightId: "l1" }]}
        attachments={[]}
        lights={[]}
        looksReady={false}
        yardClear={false}
        looksKnown
        yardKnown
      />,
    );
    expect(screen.getByRole("button", { name: "2D", pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Street" }));
    expect(screen.getByRole("img", { name: "Yard from the street" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(screen.queryByRole("img", { name: "Yard from the street" })).toBeNull();
  });
});

describe("Your yard and Looks", () => {
  it("offers Add to Looks for a prop that is in no Look", () => {
    const prop = { id: "p1", label: "Wreath", kind: "custom", elementIds: [], design: { ledCount: 20 } } as unknown as Parameters<typeof YardHome>[0]["props"][number];
    const look = { id: "l1", name: "Warm", slot: 1, style: { fx: 0, pal: 0, sx: 128, ix: 128, bri: 128, color: "#ffffff" }, overrides: [], propIds: [] };
    render(<YardHome props={[prop]} attachments={[]} lights={[]} looksReady={false} yardClear={false} looksKnown yardKnown looks={[look]} />);
    expect(screen.getByRole("link", { name: "Add to Looks…" }).getAttribute("href")).toBe("/looks?add=p1");
  });
});
