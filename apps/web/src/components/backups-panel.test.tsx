import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BackupSummary } from "@nightplot/shared";
import { BackupsPanel } from "./backups-panel";

const id = "03c75c3e-9846-458e-b458-8739f0bff750";
const summary: BackupSummary = { id, at: "2026-09-28T18:00:00.000Z", reason: "manual", lightId: null,
  lightName: null, lightCount: 1, segmentCount: 1, productCount: 0, hasControllerReference: false, hasDeviceFiles: false };
const document = { version: 1, ...summary, data: {
  lights: [{ id: "porch", name: "Porch", hostname: "192.168.1.40", port: 80 }],
  elements: [{ id: "door" }], products: [], activity: [],
}, controller: null };

describe("Backups management", () => {
  it("reviews counts, requires the exact ID for restore and clear, and shows the reusable LED loader", async () => {
    const requests: { path: string; method?: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      requests.push({ path, method: init?.method, body: String(init?.body ?? "") });
      if (path.endsWith("/restore/check")) return new Response(JSON.stringify({
        backup: { id, lights: 1, segments: 1, products: 0, activity: 0 },
        current: { lights: 2, segments: 3, products: 1, activity: 2 },
        expectedDigest: "before", expectedCurrentDigest: "current",
      }));
      if (path.endsWith("/restore")) return new Response(JSON.stringify({ safetyBackupId: "safety", message: "Nightplot data restored." }));
      if (init?.method === "DELETE") return new Response(JSON.stringify({ removed: true }));
      if (path === "/api/backups") return new Response(JSON.stringify({ backups: [summary] }));
      return new Response(JSON.stringify({ backup: document }));
    }));
    render(<BackupsPanel initial={[summary]} />);
    fireEvent.click(screen.getByRole("button", { name: /manual/ }));
    expect(await screen.findByText(`ID: ${id}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review restore" }));
    expect(await screen.findByText(/Current: 2 Lights, 3 Segments/)).toBeTruthy();
    const restore = screen.getByRole("button", { name: "Restore Nightplot data" }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Confirm backup ID" }), { target: { value: id } });
    fireEvent.click(restore);
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/restore") &&
      request.body?.includes("\"confirmId\":\"" + id + "\""))).toBe(true));
    expect(await screen.findByText(/Safety backup: safety/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear backup…" }));
    expect((screen.getByRole("button", { name: "Clear this backup" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Confirm backup ID" }), { target: { value: id } });
    fireEvent.click(screen.getByRole("button", { name: "Clear this backup" }));
    await waitFor(() => expect(requests.some((request) => request.method === "DELETE")).toBe(true));
  });
});
