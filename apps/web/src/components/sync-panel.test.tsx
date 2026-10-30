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

  it("turns on a preset read from the source on the source and targets", async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/sync/presets/desk") return new Response(JSON.stringify({
        presets: [{ id: 1, name: "Amber", kind: "preset" }, { id: 4, name: "Loop", kind: "playlist" }] }));
      posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ kind: "preset", sourceLightId: null, rows: [], message: "2 of 2 report the preset on.", caption: "" }));
    }));
    render(<SyncPanel lights={lights} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Porch" }));
    fireEvent.click(screen.getByRole("button", { name: "Read presets" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Preset" }), { target: { value: "4" } });
    expect(screen.getByText("4 · Loop (playlist)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("2 of 2 report the preset on.")).toBeTruthy();
    expect(posts).toEqual([{ lightIds: ["desk", "porch"], presetId: 4 }]);
  });

  it("explains that Sync needs two Lights", () => {
    render(<SyncPanel lights={[lights[0]!]} />);
    expect(screen.getByText(/needs at least two Lights/)).toBeTruthy();
  });
});
