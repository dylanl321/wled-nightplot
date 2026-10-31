import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YARD_CAPTION, type YardCheckResult } from "@nightplot/shared";
import { lightView } from "@/test/fixtures";
import { YardPanel } from "./yard-panel";

const lights = [
  lightView({ id: "porch", name: "Porch", reachability: "online" }),
  lightView({ id: "eave", name: "Eave", reachability: "no-answer", lastSeenAt: "2026-10-31T10:00:00.000Z" }),
];

const check: YardCheckResult = {
  checkedAt: "2026-10-31T12:00:00.000Z",
  caption: YARD_CAPTION,
  rows: [
    {
      lightId: "porch",
      name: "Porch",
      hostname: "192.168.1.40",
      port: 80,
      hostKey: "192.168.1.40:80",
      mac: "aa:bb:cc:dd:ee:ff",
      reachability: "online",
      lastSeenAt: "2026-10-31T12:00:00.000Z",
      firmware: { status: "match", detail: "WLED 0.15.4", enrolled: "WLED 0.15.4", live: "WLED 0.15.4" },
      outputs: { status: "match", detail: "1 output · 60 LEDs.", expectedCount: 1, liveCount: 1, expectedLeds: 60, liveLeds: 60 },
      looks: { status: "mismatch", detail: "Managed Look preset slots differ.", libraryChanged: false },
      schedule: { status: "not-pushed", detail: "Nightplot has not pushed the nightly Schedule to this Light. That is not a match." },
      sync: { status: "not-pushed", detail: "Nightplot has not pushed a WLED sync group to this Light." },
      lit: { status: "lit", detail: "On.", on: true, preset: 1 },
      props: [{ id: "window", label: "Front window", kind: "window" }],
      canFix: true,
      canBlink: true,
      lastLookPushAt: "2026-10-31T11:00:00.000Z",
    },
    {
      lightId: "eave",
      name: "Eave",
      hostname: "192.168.1.41",
      port: 80,
      hostKey: "192.168.1.41:80",
      mac: "aa:bb:cc:dd:ee:00",
      reachability: "no-answer",
      lastSeenAt: "2026-10-31T10:00:00.000Z",
      firmware: { status: "unknown", detail: "Last enrolled firmware WLED 0.15.4. WLED did not answer.", enrolled: "WLED 0.15.4", live: null },
      outputs: { status: "unknown", detail: "Nightplot expects 1 output · 60 LEDs. WLED did not answer.", expectedCount: 1, liveCount: null, expectedLeds: 60, liveLeds: null },
      looks: { status: "unknown", detail: "Nightplot has not pushed Looks to this Light. WLED did not answer.", libraryChanged: false },
      schedule: { status: "unknown", detail: "Nightplot has not pushed a Schedule to this Light. WLED did not answer." },
      sync: { status: "unknown", detail: "Nightplot has not pushed a sync group to this Light. WLED did not answer." },
      lit: { status: "unknown", detail: "Power is unknown. WLED did not answer.", on: null, preset: null },
      props: [],
      canFix: false,
      canBlink: false,
      lastLookPushAt: null,
    },
  ],
};

describe("Yard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists reachability, drift, Props, and last-seen on an unreachable Light", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/yard-check") return new Response(JSON.stringify({ ...check, undo: null }));
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }));
    render(<YardPanel lights={lights} initial={{ ...check, undo: null }} />);
    expect(screen.getByText("Porch")).toBeTruthy();
    expect(screen.getByText("Looks · Differs")).toBeTruthy();
    expect(screen.getByText(/Front window/)).toBeTruthy();
    expect(screen.getByText(/last seen/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix all drift" })).toBeTruthy();
  });

  it("fixes one Light and lists the reread", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/yard-check") return new Response(JSON.stringify({ ...check, undo: null }));
      if (path === "/api/yard-check/fix") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { lightIds?: string[] };
        expect(body.lightIds).toEqual(["porch"]);
        return new Response(JSON.stringify({
          kind: "yard-fix",
          rows: [{ lightId: "porch", lightName: "Porch", status: "matched", detail: "Reports the Looks.", safetyBackupId: "b1" }],
          message: "1 of 1 report the Looks again.",
          caption: YARD_CAPTION,
          undo: { at: "2026-10-31T12:01:00.000Z", backupIds: ["b1"], lightIds: ["porch"] },
        }));
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }));
    render(<YardPanel lights={lights} initial={{ ...check, undo: null }} />);
    expect(screen.getByText("Porch")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Fix" })[0]!);
    expect(await screen.findByText("1 of 1 report the Looks again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("reviews a season file and shows a Looks-missing warning", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/yard-check") return new Response(JSON.stringify({ ...check, undo: null }));
      if (path === "/api/season/review") {
        return new Response(JSON.stringify({
          ok: true,
          migratedFrom: "lights-store",
          incoming: { lights: 1, segments: 1, props: 0, profiles: 0, looks: null },
          current: { lights: 2, segments: 1, props: 1, profiles: 0, looks: 7 },
          diff: {
            lights: { current: 2, incoming: 1, added: [], removed: ["Eave"], changed: [] },
            segments: { current: 1, incoming: 1, added: [], removed: [], changed: [] },
            props: { current: 1, incoming: 0, added: [], removed: ["Front window"], changed: [] },
            profiles: { current: 0, incoming: 0, added: [], removed: [], changed: [] },
            looks: { current: 7, incoming: 0, added: [], removed: ["Warm white"], changed: [], missingInFile: true },
            playlists: { current: 1, incoming: 0, added: [], removed: [], changed: [] },
            schedule: { current: false, incoming: false, changed: false, missingInFile: true },
            devicesComplete: 0,
            devicesIncomplete: 0,
          },
          expectedDigest: "abc",
          expectedCurrentDigest: "def",
          looksMissing: true,
          message: "This file has no Looks. Restore will leave the current Looks library in place.",
        }));
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }));
    render(<YardPanel lights={lights} initial={{ ...check, undo: null }} />);
    expect(screen.getByText("Porch")).toBeTruthy();
    const file = new File([JSON.stringify({ version: 1, lights: [] })], "season.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify({ version: 1, lights: [] }) });
    fireEvent.change(screen.getByLabelText("Choose season file"), { target: { files: [file] } });
    expect(await screen.findByText(/Looks are missing/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore season" })).toBeTruthy());
  });
});
