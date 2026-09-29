import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lightDetail, lightView } from "@/test/fixtures";
import { PowerBudgetPanel } from "./power-budget";

describe("power budget planner", () => {
  it("recalculates a per-Segment colour scenario against a fetched Safe limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ safe: {
      settings: { currentLimitMa: 500 }, fingerprint: { fields: ["currentLimitMa"] }, refuse: null,
    } }))));
    const light = lightView({ reachability: "online", brightness: 255, ledCount: 30 });
    const detail = lightDetail({ light, elements: [
      { id: "a", lightId: light.id, label: "Left", start: 0, stop: 10 },
      { id: "b", lightId: light.id, label: "Right", start: 10, stop: 20 },
    ] });
    render(<PowerBudgetPanel detail={detail} />);
    expect(screen.getByText("Saved Segments at chosen colours: ≈ 1200 mA")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/500 mA configured/)).toBeTruthy());
    expect(screen.getByText(/exceeds the configured/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Left colour"), { target: { value: "#ff0000" } });
    expect(screen.getByText("Saved Segments at chosen colours: ≈ 800 mA")).toBeTruthy();
    expect(screen.getByText(/10 LEDs are outside saved Segments/)).toBeTruthy();
  });

  it("keeps the comparison unknown when the controller does not answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<PowerBudgetPanel detail={lightDetail()} />);
    await waitFor(() => expect(screen.getByText(/Safe current limit unavailable/)).toBeTruthy());
    expect(screen.getByText(/No comparison available/)).toBeTruthy();
  });
});
