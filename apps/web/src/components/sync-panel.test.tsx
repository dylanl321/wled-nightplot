import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LightView } from "@nightplot/shared";
import { SyncPanel } from "./sync-panel";

const light = (id: string, name: string) => ({ id, name, reachability: "online" }) as unknown as LightView;
const lights = [light("desk", "Desk"), light("shelf", "Shelf"), light("porch", "Porch")];

describe("Sync", () => {
  it("asks before copying presets with differences, then lists each Light's reread", async () => {
    const bodies: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      bodies.push({ path, body });
      if (path === "/api/sync/presets" && body.confirmWarnings !== true) return new Response(JSON.stringify({
        error: "confirm-warnings", message: "Review these differences, then confirm. Nothing was sent.",
        warnings: [{ lightId: "shelf", lightName: "Shelf", message: "Shelf has 90 LEDs; the source has 60." }],
      }), { status: 409 });
      return new Response(JSON.stringify({ kind: "presets", sourceLightId: "desk",
        rows: [{ lightId: "shelf", lightName: "Shelf", status: "matched", detail: "Reports the same 2 presets as Desk.", safetyBackupId: "b1" }],
        message: "1 of 1 have the copied presets.", caption: "Not Hardware Done." }));
    }));
    render(<SyncPanel lights={lights} />);
    const copy = screen.getByRole("button", { name: "Copy presets" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Shelf" }));
    fireEvent.click(copy);
    expect(await screen.findByText("Shelf has 90 LEDs; the source has 60.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy anyway" }));
    expect(await screen.findByText("1 of 1 have the copied presets.")).toBeTruthy();
    expect(screen.getByText(/Safety backup b1/)).toBeTruthy();
    await waitFor(() => expect(bodies.at(-1)?.body).toEqual({ sourceLightId: "desk", targetLightIds: ["shelf"], confirmWarnings: true }));
  });

  it("sends turning on a preset to Looks", () => {
    render(<SyncPanel lights={lights} />);
    expect(screen.getByRole("link", { name: "Looks" }).getAttribute("href")).toBe("/looks");
  });

  it("explains that Sync needs two Lights", () => {
    render(<SyncPanel lights={[lights[0]!]} />);
    expect(screen.getByText(/needs at least two Lights/)).toBeTruthy();
  });
});
