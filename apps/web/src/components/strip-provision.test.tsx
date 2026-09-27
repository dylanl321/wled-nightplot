import type { LightDetail as LightDetailPayload, ProvisionRead } from "@nightplot/shared";
import {
  getStripPreset,
  listStripPresets,
  provisionApplyBodyFromPreset,
} from "@nightplot/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightDetail } from "@/components/light-detail";
import { StripProvisionPanel } from "@/components/strip-provision";
import { lightDetail, lightView, requestPath } from "@/test/fixtures";

const provision: ProvisionRead = {
  settings: { ledType: "ws281x", length: 60, gpio: 16, nativeType: 22 },
  fingerprint: {
    firmware: "WLED 0.15.4",
    source: "cfg",
    writable: true,
    mappingId: "wled-0.15-ws281x-rgb-grb",
    fields: ["ledType", "length", "gpio"],
  },
  caption: "Software-green from the fixture. Not Hardware Done.",
  refuse: null,
  buses: 1,
};

function payload(overrides: Partial<LightDetailPayload> = {}): LightDetailPayload {
  return {
    ...lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#ffa000",
      }),
    }),
    provision,
    ...overrides,
  };
}

describe("Strip provision", () => {
  it("offers Strip on an enrolled Light", () => {
    render(<LightDetail initial={payload()} mode="inspect" />);
    expect(screen.getByRole("button", { name: "Strip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /type, length, GPIO/ })).toBeTruthy();
  });

  it("keeps a write→reread mismatch on the failure UI", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ...payload(),
            provisionWrite: {
              status: "mismatch",
              matched: false,
              sent: { ledType: "ws281x", length: 150, gpio: 2 },
              read: { ledType: "ws281x", length: 60, gpio: 16, nativeType: 22 },
              snapshotLedCount: 60,
              fingerprint: provision.fingerprint,
              message: "Wrote, but /json/cfg did not match. Not treating as success.",
              caption: provision.caption,
            },
            message: "Wrote, but /json/cfg did not match. Not treating as success.",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);

    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Apply didn’t stick")).toBeTruthy();
    expect(screen.getByText(/ws281x · 150 nodes · GPIO 2/)).toBeTruthy();
    expect(screen.getByText(/Not treating as success/)).toBeTruthy();
    expect(screen.getByText(/Not Hardware Done/)).toBeTruthy();
    expect(screen.queryByText("Controller reports the strip we sent.")).toBeNull();

    await waitFor(() => {
      const posts = fetch.mock.calls.filter((call) => {
        const init = call[1] as RequestInit | undefined;
        return init?.method === "POST";
      });
      expect(posts.length).toBe(1);
    });
  });

  it("fills the form from a catalog preset and Apply posts that payload", async () => {
    const preset = getStripPreset("ws281x-300-gpio2") ?? listStripPresets()[2]!;
    const posts: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            ...payload(),
            provisionWrite: {
              status: "matched",
              matched: true,
              sent: preset,
              read: {
                ledType: preset.ledType,
                length: preset.length,
                gpio: preset.gpio,
                nativeType: 22,
              },
              snapshotLedCount: preset.length,
              fingerprint: provision.fingerprint,
              message: "Controller reports the strip we sent.",
              caption: provision.caption,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);

    expect(await screen.findByRole("button", { name: preset.label })).toBeTruthy();
    expect((screen.getByLabelText("Node count") as HTMLInputElement).value).toBe("60");
    expect((screen.getByLabelText("GPIO pin") as HTMLInputElement).value).toBe("16");

    fireEvent.click(screen.getByRole("button", { name: preset.label }));

    await waitFor(() => {
      expect((screen.getByLabelText("Node count") as HTMLInputElement).value).toBe(
        String(preset.length),
      );
      expect((screen.getByLabelText("GPIO pin") as HTMLInputElement).value).toBe(
        String(preset.gpio),
      );
    });
    expect(screen.getByRole("button", { name: preset.label }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(posts).toEqual([provisionApplyBodyFromPreset(preset)]);
    });
  });

  it("lets fields override a selected preset before Apply", async () => {
    const preset = listStripPresets()[1]!;
    const posts: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/provision") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            ...payload(),
            message: "Strip provision was not written.",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/provision")) {
        return new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<StripProvisionPanel lightId="light-garage" unreachable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: preset.label }));
    fireEvent.change(screen.getByLabelText("Node count"), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(posts).toEqual([
        { provision: { ledType: "ws281x", length: 180, gpio: preset.gpio } },
      ]);
    });
    expect(screen.getByRole("button", { name: preset.label }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
