import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BackupsPanel } from "./backups-panel";

const backup = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-09-29T00:00:00.000Z",
  reason: "manual" as const,
  reasonLabel: "Saved backup",
  note: null,
  completeness: "complete" as const,
  incomplete: [],
  counts: { lights: 1, elements: 2, ledProducts: 3, activity: 0 },
  hasControllerCapture: false,
  controllerCaption: null,
};

describe("Backups panel", () => {
  it("requires explicit confirm before delete or restore", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/diff")) {
        return new Response(JSON.stringify({
          diff: {
            lights: { wouldAdd: [], wouldRemove: [], wouldChange: [] },
            elements: { current: 2, backup: 2, wouldAdd: 0, wouldRemove: 0, wouldChange: 0 },
            ledProducts: { wouldAdd: [], wouldRemove: [], wouldChange: [] },
            activity: { current: 0, backup: 0 },
            summary: "Lights match. Restores Nightplot data only. Nothing is sent to a controller.",
          },
        }));
      }
      if (url.includes("/api/backups/") && !init?.method) {
        return new Response(JSON.stringify({
          details: { lights: [], ledProducts: [], activityCount: 0, controller: null, incomplete: [] },
        }));
      }
      return new Response(JSON.stringify({ backups: [backup] }));
    });
    vi.stubGlobal("fetch", fetch);
    render(<BackupsPanel initialBackups={[backup]} />);
    expect(screen.getByText("Saved backup")).toBeTruthy();
    const deleteButton = screen.getByRole("button", { name: "Delete backup" });
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review restore" }));
    const restoreButton = await screen.findByRole("button", { name: "Restore Nightplot data" });
    expect(restoreButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/Restore Nightplot data from this backup/));
    expect(restoreButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(restoreButton);
    await waitFor(() => {
      expect(fetch.mock.calls.some((call) => String(call[0]).includes("/restore") && String(call[1]?.body).includes("\"confirm\":true"))).toBe(true);
    });
    fireEvent.click(screen.getByLabelText(/Delete this backup from Nightplot/));
    fireEvent.click(screen.getByRole("button", { name: "Delete backup" }));
    await waitFor(() => {
      expect(fetch.mock.calls.some((call) => call[1]?.method === "DELETE" && String(call[1]?.body).includes("\"confirm\":true"))).toBe(true);
    });
  });
});
