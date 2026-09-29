import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lightDetail } from "@/test/fixtures";
import { ControllerReplacement } from "./controller-replacement";

describe("controller replacement review", () => {
  it("shows the checked address/MAC, confirms separately, and never requests Apply", async () => {
    const initial = lightDetail();
    const onUpdated = vi.fn();
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ path, body });
      if (path.endsWith("/check")) return new Response(JSON.stringify({
        previous: { hostKey: initial.light.hostKey, mac: initial.light.mac, name: initial.light.name },
        replacement: { hostKey: "192.168.1.80:8080", mac: "aa:bb:cc:dd:ee:ff", name: "New WLED", ledCount: 60 },
        segmentCount: 1,
      }));
      return new Response(JSON.stringify({ ...initial,
        message: "Controller replaced. Use Apply separately." }));
    }));
    render(<ControllerReplacement detail={initial} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace controller…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Replacement host or host:port" }),
      { target: { value: "192.168.1.80:8080" } });
    fireEvent.click(screen.getByRole("button", { name: "Check replacement" }));
    expect(await screen.findByText(/Replacement: New WLED/)).toBeTruthy();
    expect(screen.getByText(/1 saved Segment stays on this Light/)).toBeTruthy();
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `Confirm replacement for ${initial.light.name}` }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(calls.map((call) => call.path)).toEqual([
      `/api/lights/${initial.light.id}/replacement/check`, `/api/lights/${initial.light.id}/replacement`,
    ]);
    expect(calls[1]?.body).toMatchObject({ confirm: true, expectedMac: "aa:bb:cc:dd:ee:ff",
      previousMac: initial.light.mac });
  });

  it("clears a checked replacement when the host changes", async () => {
    const initial = lightDetail();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      previous: { hostKey: initial.light.hostKey, mac: initial.light.mac, name: initial.light.name },
      replacement: { hostKey: "192.168.1.80:80", mac: "aa:bb:cc:dd:ee:ff", name: "New", ledCount: 60 },
      segmentCount: 1,
    }))));
    render(<ControllerReplacement detail={initial} onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace controller…" }));
    fireEvent.click(screen.getByRole("button", { name: "Check replacement" }));
    expect(await screen.findByRole("button", { name: `Confirm replacement for ${initial.light.name}` })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Replacement host or host:port" }),
      { target: { value: "192.168.1.81" } });
    expect(screen.queryByRole("button", { name: `Confirm replacement for ${initial.light.name}` })).toBeNull();
  });
});
