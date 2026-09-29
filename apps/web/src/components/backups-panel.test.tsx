import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BackupSummary } from "@nightplot/shared";
import { BackupsPanel } from "./backups-panel";

const id = "03c75c3e-9846-458e-b458-8739f0bff750";
const summary: BackupSummary = { id, at: "2026-09-28T18:00:00.000Z", reason: "manual", lightId: null,
  lightName: null, lightCount: 1, segmentCount: 1, productCount: 0, hasControllerReference: false,
  hasDeviceFiles: false, deviceCaptureStatus: "none" };
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
        backup: { id, lights: 1, segments: 1, products: 0, activity: 0, settings: true },
        current: { lights: 2, segments: 3, products: 1, activity: 2, settings: true },
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
    fireEvent.click(screen.getByRole("button", { name: "Review Nightplot restore" }));
    expect(await screen.findByText(/Current: 2 Lights, 3 Segments/)).toBeTruthy();
    expect(screen.getByText(/including Settings/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pin backup" })).toBeTruthy();
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

  it("reviews a separate WLED restore and does not upload without the backup id", async () => {
    const device = {
      ...summary, hasDeviceFiles: true, lightId: "porch", lightName: "Porch",
    };
    const selected = {
      ...document,
      lightId: "porch",
      deviceFiles: {
        cfgJson: "{}", presetsJson: "{}", lightId: "porch", host: "192.168.1.40:80",
        mac: "AA:BB:CC:DD:EE:FF", firmware: "WLED 0.15.0", capturedAt: device.at,
      },
    };
    const requests: { path: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      requests.push({ path, body: String(init?.body ?? "") });
      if (path.endsWith("/restore-wled/check")) return new Response(JSON.stringify({
        ok: true, message: "Upload configuration and presets.", macMatch: true, firmwareMatch: true,
        requiresFirmwareConfirm: false, lightId: "porch", lightName: "Porch",
        captured: { mac: "AA:BB:CC:DD:EE:FF", firmware: "WLED 0.15.0", host: "192.168.1.40:80", capturedAt: device.at },
        live: { mac: "AA:BB:CC:DD:EE:FF", firmware: "WLED 0.15.0", host: "192.168.1.40:80" },
      }));
      if (path.endsWith("/restore-wled")) return new Response(JSON.stringify({
        safetyBackupId: "safety-wled", message: "Uploaded WLED files.",
      }));
      if (path === "/api/backups") return new Response(JSON.stringify({ backups: [device] }));
      return new Response(JSON.stringify({ backup: selected }));
    }));
    render(<BackupsPanel initial={[device]} lights={[{ id: "porch", name: "Porch" } as never]} />);
    fireEvent.click(screen.getByRole("button", { name: /manual/ }));
    expect(await screen.findByText(/MAC AA:BB:CC:DD:EE:FF/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review WLED restore" }));
    expect(await screen.findByText(/Upload configuration and presets to Porch/)).toBeTruthy();
    const upload = screen.getByRole("button", { name: "Upload WLED files" }) as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Confirm WLED backup ID" }), { target: { value: id } });
    fireEvent.click(upload);
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/restore-wled") &&
      request.body?.includes("\"confirmId\":\"" + id + "\""))).toBe(true));
    expect(await screen.findByText(/Safety backup: safety-wled/)).toBeTruthy();
  });

  it("shows per-Light export completeness and an incomplete capture error", () => {
    const incomplete: BackupSummary = {
      ...summary, lightId: "porch", lightName: "Porch", hasControllerReference: true,
      deviceCaptureStatus: "incomplete", deviceCaptureError: "presets.json returned HTTP 404",
    };
    render(<BackupsPanel initial={[incomplete]} lights={[{ id: "porch", name: "Porch" } as never]} />);
    expect(screen.getByText("Porch — incomplete: presets.json returned HTTP 404")).toBeTruthy();
    expect(screen.getByText(/WLED export incomplete/)).toBeTruthy();
  });
});
