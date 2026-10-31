import type { LightDetail, WledStripProvisionOutputDraft } from "@nightplot/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindLengthFlow } from "./find-length";
import { lightDetail, lightView, requestPath } from "@/test/fixtures";

const draft: WledStripProvisionOutputDraft = {
  index: 0,
  ledType: "ws281x",
  length: 60,
  gpio: 16,
};

function detail(): LightDetail {
  return lightDetail({
    light: lightView({
      name: "Garage",
      reachability: "online",
      on: true,
      brightness: 180,
      ledCount: 60,
    }),
  });
}

function provisionOk(length: number, index = 0) {
  return {
    ...detail(),
    light: { ...detail().light, ledCount: index === 0 ? length : 60 + length },
    provision: {
      settings: { ledType: "ws281x", length, gpio: 16, nativeType: 22, nativeOrder: 0, colorOrder: "GRB" },
      outputs: [
        {
          index,
          start: index === 0 ? 0 : 60,
          settings: { ledType: "ws281x", length, gpio: 16, nativeType: 22, nativeOrder: 0, colorOrder: "GRB" },
          refuse: null,
          writable: true,
        },
      ],
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
    },
    provisionWrite: {
      status: "matched",
      matched: true,
      sent: { ledType: "ws281x", length, gpio: 16 },
      read: { ledType: "ws281x", length, gpio: 16, nativeType: 22, nativeOrder: 0, colorOrder: "GRB" },
      snapshotLedCount: length,
      fingerprint: {
        firmware: "WLED 0.15.4",
        source: "cfg",
        writable: true,
        mappingId: "wled-0.15-ws281x-rgb-grb",
        fields: ["ledType", "length", "gpio"],
      },
      message: "Controller reports the strip we sent.",
      caption: "Software-green from the fixture. Not Hardware Done.",
    },
  };
}

function renderFlow(
  extra?: Partial<{
    outputLabel: string;
    totalLedCount: number;
    draft: WledStripProvisionOutputDraft;
    outputStart: number;
  }>,
) {
  const writes: { path: string; body: unknown }[] = [];
  const applied = vi.fn();
  const closed = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (init?.method === "POST") writes.push({ path, body });
      if (path.endsWith("/provision")) {
        const length =
          (body as { provision?: { outputs?: { length?: number }[] } }).provision?.outputs?.[0]
            ?.length ?? draft.length;
        return new Response(JSON.stringify(provisionOk(length)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(detail()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  render(
    <FindLengthFlow
      lightId="light-garage"
      lightName="Garage"
      outputLabel="This output"
      totalLedCount={60}
      draft={draft}
      outputStart={0}
      onClose={closed}
      onApplied={applied}
      {...extra}
    />,
  );
  return { writes, applied, closed };
}

describe("Find length", () => {
  it("confirms a length through Preview end, then one-output provision", async () => {
    const { writes, applied, closed } = renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Find length · This output" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Search within 60" }));
    await waitFor(() =>
      expect(
        writes.some(
          (write) =>
            write.path.endsWith("/preview") &&
            (write.body as { pixels?: boolean }).pixels === true,
        ),
      ).toBe(true),
    );
    const preview = writes.find((write) => write.path.endsWith("/preview"));
    expect(preview?.body).toMatchObject({
      pixels: true,
      spans: expect.arrayContaining([
        { start: 59, stop: 60, color: "#fff4dc" },
      ]),
    });
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Use this length" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this length" }));
    await waitFor(() => {
      expect(writes.some((write) => write.path.endsWith("/preview/end"))).toBe(true);
      expect(
        writes.some(
          (write) =>
            write.path.endsWith("/provision") &&
            JSON.stringify(write.body) ===
              JSON.stringify({
                provision: { outputs: [{ index: 0, ledType: "ws281x", length: 60, gpio: 16 }] },
              }),
        ),
      ).toBe(true);
    });
    expect(writes.findIndex((write) => write.path.endsWith("/preview/end"))).toBeLessThan(
      writes.findIndex((write) => write.path.endsWith("/provision")),
    );
    expect(applied).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it("cancels by ending Preview and does not write length", async () => {
    const { writes, closed } = renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Find length · This output" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Search within 60" }));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Yes · lit to the end" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(writes.some((write) => write.path.endsWith("/preview/end"))).toBe(true));
    expect(writes.some((write) => write.path.endsWith("/provision"))).toBe(false);
    expect(closed).toHaveBeenCalled();
  });

  it("restores the previous length when a longer search ceiling is cancelled", async () => {
    const { writes, closed } = renderFlow({
      draft: { ...draft, length: 30 },
      totalLedCount: 30,
    });
    const dialog = screen.getByRole("dialog", { name: "Find length · This output" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Search within 30" }));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "No · still dark" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "No · still dark" }));
    fireEvent.click(await screen.findByRole("button", { name: "Write 150 and keep searching" }));
    await waitFor(() =>
      expect(
        writes.some(
          (write) =>
            write.path.endsWith("/provision") &&
            (write.body as { provision: { outputs: { length: number }[] } }).provision.outputs[0]
              ?.length === 150,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      const provisions = writes.filter((write) => write.path.endsWith("/provision"));
      expect(provisions.at(-1)?.body).toEqual({
        provision: { outputs: [{ index: 0, ledType: "ws281x", length: 30, gpio: 16 }] },
      });
    });
    expect(writes.some((write) => write.path.endsWith("/preview/end"))).toBe(true);
    expect(closed).toHaveBeenCalled();
  });

  it("lights only the chosen output on a multi-output Light", async () => {
    const { writes } = renderFlow({
      outputLabel: "Output 2",
      draft: { index: 1, ledType: "ws281x", length: 40, gpio: 2 },
      outputStart: 60,
      totalLedCount: 100,
    });
    const dialog = screen.getByRole("dialog", { name: "Find length · Output 2" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Search within 40" }));
    await waitFor(() =>
      expect(writes.some((write) => write.path.endsWith("/preview"))).toBe(true),
    );
    expect(writes.find((write) => write.path.endsWith("/preview"))?.body).toMatchObject({
      pixels: true,
      spans: [
        { start: 0, stop: 60, color: "#000000" },
        { start: 60, stop: 99, color: "#2c4e49" },
        { start: 99, stop: 100, color: "#fff4dc" },
      ],
    });
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Use this length" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this length" }));
    await waitFor(() =>
      expect(
        writes.some(
          (write) =>
            write.path.endsWith("/provision") &&
            JSON.stringify(write.body) ===
              JSON.stringify({
                provision: { outputs: [{ index: 1, ledType: "ws281x", length: 40, gpio: 2 }] },
              }),
        ),
      ).toBe(true),
    );
  });

  it("closes on All Off without requesting restoration", async () => {
    const { writes, closed } = renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Find length · This output" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Search within 60" }));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Yes · lit to the end" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    act(() =>
      window.dispatchEvent(
        new CustomEvent("nightplot:all-off", { detail: { lightIds: ["light-garage"] } }),
      ),
    );
    expect(closed).toHaveBeenCalled();
    expect(writes.some((write) => write.path.endsWith("/preview/end"))).toBe(false);
  });
});
